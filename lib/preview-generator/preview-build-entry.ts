import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { FileIO } from '../ast/file-io';
import {
  detectExportStyle,
  detectProviderShell,
  detectRouterShell,
  detectSSRHooks,
  extractComponentName,
  extractDeclaredPropNames,
  hasComponentExport,
  scanRenderableExportNames,
  scanSampleExports,
  type ExportStyle,
} from './scanner';
import { buildContainerSampleJsxBody } from './sample-scaffold';
import { isFrameworkReserved, isPreviewIneligibleByName } from './preview-constants';
import type { PreviewComponentEntry } from './generator';

interface BuildEntryOptions {
  allowRouterShell?: boolean;
  entryRootPaths?: Set<string>;
  /**
   * The monorepo workspace root, when `projectRoot` is a re-rooted sub-project
   * (an app target whose dev server hosts the preview, HYP-420/HYP-441). A
   * cross-package library component selected from another package resolves to a
   * `..`-path relative to `projectRoot` that still lives INSIDE this workspace
   * root. buildEntry allows such in-workspace `..` paths and rejects only paths
   * that escape `workspaceRoot` (HYP-443). Defaults to `projectRoot` for
   * single-package projects, where `..` paths are always escapes and rejected.
   */
  workspaceRoot?: string;
}

export async function buildEntry(
  projectRoot: string,
  io: FileIO,
  ssrMockFramework: string | undefined,
  componentPath: string,
  previewDir: string,
  options: BuildEntryOptions = {},
): Promise<PreviewComponentEntry | null> {
  // Guard against path traversal. This is security-sensitive: it gates which
  // files the preview reads + serves. A `..` path is allowed in EXACTLY ONE
  // case — the cross-package library case (HYP-443): projectRoot is a re-rooted
  // app target, and the component lives in a SIBLING package that
  //   (a) escapes projectRoot (so `..` is structurally required), AND
  //   (b) stays within the monorepo workspaceRoot, AND
  //   (c) workspaceRoot !== projectRoot (a real monorepo re-root, not a single
  //       package where the two coincide).
  // Everything else is rejected, including:
  //   - paths escaping the workspace (../../../etc/passwd, a sibling repo);
  //   - internal `..` tricks that normalize back INSIDE projectRoot
  //     (packages/../secret/Evil.tsx → secret/Evil.tsx) — these never need `..`
  //     to address a legitimate file, so a `..` segment is always suspicious;
  //   - single-package projects (workspaceRoot === projectRoot): every `..`
  //     path is rejected exactly as before HYP-443.
  const workspaceRoot = options.workspaceRoot ?? projectRoot;
  if (componentPath.includes('..')) {
    const resolved = resolve(projectRoot, componentPath);
    const relToProject = relative(projectRoot, resolved);
    const relToWorkspace = relative(workspaceRoot, resolved);
    // `..` prefix = escapes upward; isAbsolute = cross-drive on Windows (where
    // path.relative returns an absolute path, not a `..` chain). Mirror the
    // convention in monorepo-root.ts resolveActiveProjectRoot.
    const escapesProject = relToProject.startsWith('..') || isAbsolute(relToProject);
    const escapesWorkspace = relToWorkspace.startsWith('..') || isAbsolute(relToWorkspace);
    const crossPackageAllowed = workspaceRoot !== projectRoot && escapesProject && !escapesWorkspace;
    if (!crossPackageAllowed) {
      console.warn(`[PreviewFileManager] Skipping suspicious path: ${componentPath}`);
      return null;
    }
  }

  // Exclude framework-reserved files (Next.js App Router specials, Remix root/entry) —
  // they export metadata / use framework hooks that crash without router context.
  const fileName = basename(componentPath);
  if (isFrameworkReserved(fileName)) {
    return null;
  }

  // Exclude platform-specific RN variants (Foo.native.tsx) and CSS-in-JS style sheets
  // (Foo.css.ts) — they collide with the canonical Foo.tsx import or yield invalid
  // identifiers like `Foo.css`, breaking the generated preview file.
  if (isPreviewIneligibleByName(fileName)) {
    return null;
  }

  const absolutePath = join(projectRoot, componentPath);

  let sourceCode: string;
  try {
    sourceCode = await io.readFile(absolutePath);
  } catch {
    // Component file unreadable — skip silently
    console.warn(`[PreviewFileManager] Could not read component: ${componentPath}`);
    return null;
  }

  // Also skip extension-managed files (e.g. app/test-preview/page.tsx) to prevent
  // self-referential imports that cause circular Client Component chains.
  if (sourceCode.includes('@hyperide-managed')) {
    return null;
  }

  // HYP-546 — exclude SPA entry-root provider shells (the createRoot bootstrap
  // target wrapping the app in providers/router). They are not renderable
  // components and pollute the preview registry. Gated by !allowRouterShell so
  // an explicit web-app shell can still opt in.
  let isProviderShell = false;
  try {
    isProviderShell = detectProviderShell(sourceCode);
  } catch {
    isProviderShell = false;
  }
  if (!options.allowRouterShell && isProviderShell && options.entryRootPaths) {
    if (options.entryRootPaths.has(componentPath.replace(/\.[jt]sx?$/, ''))) {
      return null;
    }
  }

  let componentName: string;
  let sampleExports: string[];
  let exportStyle: ExportStyle;
  let isSSRRoute = false;
  try {
    // Skip router application shells (files importing BrowserRouter/HashRouter/StaticRouter).
    // These files wrap the whole app with a router provider and, when included alongside
    // the page components they import, cause a Vite/ESM temporal dead zone (TDZ) error
    // in the generated __canvas_preview__.tsx registry.
    if (detectRouterShell(sourceCode) && !options.allowRouterShell) {
      return null;
    }

    componentName = extractComponentName(sourceCode, fileName);
    if (!hasComponentExport(sourceCode, componentName)) {
      return null;
    }
    sampleExports = scanSampleExports(sourceCode);
    exportStyle = detectExportStyle(sourceCode, componentName);
    if (ssrMockFramework === 'remix') {
      isSSRRoute = detectSSRHooks(sourceCode).size > 0;
    }
  } catch {
    // Source has syntax errors (e.g. mid-edit). Don't generate a bogus entry —
    // any guess at exportStyle will produce broken imports and break the dev
    // server build, cascading failures across every component that imports it.
    // Skip the component until the user saves valid code; the file watcher
    // will re-trigger regeneration when the source parses cleanly.
    console.warn(`[PreviewFileManager] Could not parse component: ${componentPath} — skipping`);
    return null;
  }

  // Non-PascalCase name = not a React component (entry files, utils, etc.)
  if (!/^[A-Z]/.test(componentName)) {
    return null;
  }

  // Compute import path relative to preview file
  const importPath = await computeImportPath(projectRoot, io, componentPath, previewDir);

  // For compound shadcn-style modules without an authored SampleDefault,
  // try to synthesize one from the named exports so the preview can render
  // <Carousel><CarouselContent>…</CarouselContent></Carousel> instead of
  // showing a blank "Loading…" forever (HYP — auto-sample for shadcn/ui).
  let syntheticSampleDefault: PreviewComponentEntry['syntheticSampleDefault'];
  let detectedExports: string[] | undefined;
  if (!sampleExports.includes('SampleDefault')) {
    try {
      detectedExports = scanRenderableExportNames(sourceCode);
    } catch {
      detectedExports = undefined;
    }
    try {
      const synthetic = buildContainerSampleJsxBody({ sourceCode, componentName });
      if (synthetic) syntheticSampleDefault = synthetic;
    } catch {
      // Source has parse-recoverable artefacts that confuse the JSX scanner —
      // skip synthesis silently rather than block the whole entry.
    }
  }

  // HYP-465 — prop names the component statically destructures. Used by the
  // generator to filter the fallback-props blob so undeclared keys don't leak
  // onto host DOM nodes. `null` (unknown — member-access/HOC/no-params) maps to
  // `undefined` here, which the generator treats as "don't filter".
  let declaredPropNames: string[] | undefined;
  try {
    // Pass `exportStyle` so the scanned function == the export the generated
    // import binds to. For `default-anonymous` the import renders the DEFAULT
    // export, which can diverge from the same-named named export; scanning the
    // wrong one whitelists props the rendered component never reads, leaking
    // them onto host DOM nodes (HYP-465).
    declaredPropNames = extractDeclaredPropNames(sourceCode, componentName, exportStyle) ?? undefined;
  } catch {
    declaredPropNames = undefined;
  }

  return {
    componentPath,
    componentName,
    exportStyle,
    sampleExports,
    importPath,
    ...(isSSRRoute && { isSSRRoute: true }),
    ...(syntheticSampleDefault && { syntheticSampleDefault }),
    ...(detectedExports && detectedExports.length > 0 && { detectedExports }),
    ...(declaredPropNames !== undefined && { declaredPropNames }),
  };
}

export async function computeImportPath(
  projectRoot: string,
  io: FileIO,
  componentPath: string,
  previewDir: string,
): Promise<string> {
  // Check monorepo package import
  const packageImport = await getPackageImportPath(projectRoot, io, componentPath);
  if (packageImport) return packageImport;

  // Regular relative path. componentPath may contain in-workspace `..` segments
  // for a cross-package library component (HYP-443); join + relative normalize
  // them into a correct `../../packages/ui/src/Button`-style import. buildEntry
  // has already rejected any `..` path that escapes the workspace root.
  const absoluteComponent = join(projectRoot, componentPath);
  const relativePath = relative(previewDir, absoluteComponent).replace(/\.\w+$/, '');

  // Ensure it starts with ./
  if (!relativePath.startsWith('.')) {
    return `./${relativePath}`;
  }
  return relativePath;
}

async function getPackageImportPath(projectRoot: string, io: FileIO, componentPath: string): Promise<string | null> {
  // A `..`-prefixed cross-package path (HYP-443) must NOT be turned into a deep
  // package import (`@acme/ui/src/Button`): the library's package.json `exports`
  // map typically only exposes `"."`, so a deep subpath import is blocked by the
  // exports wall and fails to resolve. Fall through to the relative import, which
  // Vite serves directly once server.fs.allow permits cross-package reads.
  if (componentPath.startsWith('..')) return null;

  const match = componentPath.match(/packages\/([^/]+)\/(.*)/);
  if (!match) return null;

  const [, packageDir, relativePath] = match;

  // Guard against path traversal — packageDir must be a plain directory name
  if (packageDir === '..' || packageDir === '.' || packageDir.includes('\\')) return null;

  const cleanPath = relativePath.replace(/^src\//, '').replace(/\.\w+$/, '');

  // Try to read package.json for real package name (supports @scoped/packages)
  const pkgJsonPath = join(projectRoot, 'packages', packageDir, 'package.json');
  try {
    const pkgContent = await io.readFile(pkgJsonPath);
    const pkg = JSON.parse(pkgContent) as { name?: string };
    if (pkg.name) {
      return `${pkg.name}/${cleanPath}`;
    }
  } catch {
    // package.json unreadable — fall back to directory name
  }

  return `${packageDir}/${cleanPath}`;
}
