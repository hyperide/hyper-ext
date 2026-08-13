import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import type { FileIO } from '../ast/file-io';
import {
  detectExportStyle,
  detectProviderShell,
  detectRouterShell,
  detectSelfBootstrapRoot,
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
import { getSampleFilePath } from './sample-ensurer';
import type { PreviewComponentEntry } from './generator';

interface BuildEntryOptions {
  allowRouterShell?: boolean;
  entryRootPaths?: Set<string>;
  /**
   * Project-relative paths (extension-stripped) that the caller wants previewed AS AN APP.
   * A path in this set is the SPA entry root and is built as an app entry (`isAppEntry: true`):
   * the provider-shell and router-shell exclusions are skipped so the routed root enters the
   * registry, and app-mode renders it raw. This is the broad, discoverable counterpart to the
   * narrow `App.web.tsx`-only `allowRouterShell` opt-in.
   */
  appEntryPaths?: Set<string>;
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

/**
 * Read sample exports from the co-located .samples.tsx file (HYP-378).
 * Returns null when the file does not exist, is unreadable, or has no Sample* exports.
 * The samplesImportPath is relative to previewDir (without extension), ready for import.
 */
async function readSamplesFile(
  io: FileIO,
  absoluteComponentPath: string,
  previewDir: string,
): Promise<{ samplesFileExports: string[]; samplesImportPath: string } | null> {
  const samplesAbsPath = getSampleFilePath(absoluteComponentPath);
  let samplesContent: string;
  try {
    samplesContent = await io.readFile(samplesAbsPath);
  } catch {
    return null;
  }

  let samplesFileExports: string[];
  try {
    samplesFileExports = scanSampleExports(samplesContent);
  } catch {
    // .samples.tsx has a syntax error — treat as absent rather than blocking the entry.
    // Warn so the user can find and fix the file; the preview still builds from the component.
    console.warn(`[PreviewFileManager] Could not parse ${basename(samplesAbsPath)} — ignoring`);
    return null;
  }
  if (samplesFileExports.length === 0) return null;

  const relativePath = relative(previewDir, samplesAbsPath).replace(/\.\w+$/, '');
  const samplesImportPath = relativePath.startsWith('.') ? relativePath : `./${relativePath}`;
  return { samplesFileExports, samplesImportPath };
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

  // Skip extension-managed files (e.g. app/test-preview/page.tsx) to prevent self-referential
  // imports that cause circular Client Component chains. This also (correctly) excludes a
  // vite-spa-jsx-router root that the patcher injected the preview route into: rendering such
  // a root raw in app-mode would mount its <BrowserRouter> INSIDE the already-mounted app
  // router (the preview iframe loads at the patched `/test-preview` route), a nested-router
  // crash. App-mode therefore supports roots whose router lives OUTSIDE the patched file
  // (the common case: router in main.tsx, a clean App.tsx) — those carry no marker.
  if (sourceCode.includes('@hyperide-managed')) {
    return null;
  }

  // HYP-45/HYP-16: exclude a self-bootstrap root (its own createRoot mount + router/provider shell
  // in one file) from app-entry candidacy — rendering it raw in app-mode A double-mounts it (see
  // `detectSelfBootstrapRoot`). With `isAppEntry` forced false, `allowShell` stays off, so the
  // router-shell exclusion (line ~172) OR the provider-shell exclusion (line ~157) below drops it
  // from the registry; the generator then drives the already-mounted router (app-mode B). This is
  // deterministic regardless of @hyperide-managed patch timing (the ordering bug behind this crash).
  // Wrapped in try/catch: babel can throw on mid-edit source despite `errorRecovery`; an unparseable
  // file is rejected by the parse-error guard below anyway, so default to "not a self-bootstrap".
  let isSelfBootstrapRoot = false;
  try {
    isSelfBootstrapRoot = detectSelfBootstrapRoot(sourceCode);
  } catch {
    isSelfBootstrapRoot = false;
  }

  // App-mode opt-in: the caller explicitly requested THIS entry root previewed as an app.
  // Bypass the provider/router-shell exclusions below and mark the entry so the generator
  // renders it raw (own router + providers run) instead of prop-injecting it. A self-bootstrap
  // root is excluded from this opt-in (see above) so it deterministically routes to app-mode B.
  const normalizedPath = componentPath.replace(/\.[jt]sx?$/, '');
  const isAppEntry = !isSelfBootstrapRoot && (options.appEntryPaths?.has(normalizedPath) ?? false);
  const allowShell = options.allowRouterShell || isAppEntry;

  // HYP-546 (self-bootstrap gate) — exclude files that both call createRoot themselves
  // AND are in entryRootPaths. These are the double-mount hazard: the iframe already
  // runs their createRoot call, so including them in the preview registry would re-fire it.
  // Separate gate so the narrowed provider-shell check below (HYP-758) can focus on pure
  // provider wrappers without needing to cover this case.
  if (!allowShell && isSelfBootstrapRoot && options.entryRootPaths) {
    if (options.entryRootPaths.has(normalizedPath)) {
      return null;
    }
  }

  // HYP-546 (provider-shell gate, narrowed by HYP-758) — exclude pure provider-wrapper
  // shells in entryRootPaths. A pure shell imports *Provider symbols AND exports a
  // component that accepts {children} to wrap (e.g. Providers.tsx). Components that merely
  // USE a provider in their own JSX (e.g. App.tsx with <TooltipProvider> around its own
  // layout) are NOT shells and must NOT be excluded — they are real components that enter
  // the registry. The narrowed detectProviderShell now requires the children-param check.
  let isProviderShell = false;
  try {
    isProviderShell = detectProviderShell(sourceCode);
  } catch {
    isProviderShell = false;
  }
  if (!allowShell && isProviderShell && options.entryRootPaths) {
    if (options.entryRootPaths.has(normalizedPath)) {
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
    if (detectRouterShell(sourceCode) && !allowShell) {
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

  // HYP-378 — also read .samples.tsx for sample exports. Merge with component file samples
  // (.samples.tsx exports take precedence so they are not re-imported from the component).
  let samplesFileExports: string[] | undefined;
  let samplesImportPath: string | undefined;
  const samplesFileData = await readSamplesFile(io, absolutePath, previewDir);
  if (samplesFileData) {
    samplesFileExports = samplesFileData.samplesFileExports;
    samplesImportPath = samplesFileData.samplesImportPath;
    // Union merge: .samples.tsx entries first so Set dedup keeps them over component dupes
    sampleExports = [...new Set([...samplesFileData.samplesFileExports, ...sampleExports])];
  }

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
    ...(isAppEntry && { isAppEntry: true }),
    ...(samplesImportPath && { samplesImportPath }),
    ...(samplesFileExports && samplesFileExports.length > 0 && { samplesFileExports }),
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
