/**
 * @file Deterministic __canvas_preview__.tsx generation and preview file management.
 *
 * Accessed via: VS Code extension preview panel — component selected in explorer;
 *               SaaS canvas — component selected, triggers ensurePreviewFiles
 * Assumptions: FileIO abstraction ensures portability between Node.js and VS Code extension;
 *              _writeIfSafe never overwrites user files (P3-3 invariant)
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { basename, dirname, join, posix, relative, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { builders as b, namedTypes } from 'ast-types';
import * as recast from 'recast';
import type { FileIO } from '../ast/file-io';
import {
  type DetectionResult,
  detectFramework,
  generateBlankLayoutContent,
  generateIsolatedLayoutContent,
  generateRouteFileContent,
  getRouteFilePaths,
} from './framework-routing';
import {
  entryHasRenderableSample,
  generatePreviewContent,
  isUiPrimitive,
  PREVIEW_GENERATOR_SCHEMA_MARKER,
  type PreviewComponentEntry,
  type ProviderWrapConfig,
  type SSRMockConfig,
} from './generator';
import { buildContainerSampleJsxBody } from './sample-scaffold';
import {
  detectExportStyle,
  detectProviderShell,
  detectRouterShell,
  detectSSRHooks,
  type ExportStyle,
  extractComponentName,
  extractDeclaredPropNames,
  extractMountedRootImportSources,
  hasComponentExport,
  scanRenderableExportNames,
  scanSampleExports,
} from './scanner';

interface BuildEntryOptions {
  allowRouterShell?: boolean;
}

/**
 * Next.js App Router special file names that must not be added to the preview registry.
 * These files have framework-level semantics (metadata exports, error boundaries, etc.)
 * that conflict with being imported as Client Components.
 */
const NEXTJS_APP_ROUTER_RESERVED = new Set([
  'layout.tsx',
  'layout.ts',
  'layout.jsx',
  'layout.js',
  'error.tsx',
  'error.jsx',
  'loading.tsx',
  'loading.jsx',
  'not-found.tsx',
  'not-found.jsx',
  'template.tsx',
  'template.jsx',
  'default.tsx',
  'default.jsx',
]);

/**
 * Remix reserved file names that must not be added to the preview registry.
 * - `root.tsx` renders the full HTML document and uses Remix-specific hooks
 *   (useLoaderData, useNavigate, useLocation) that crash without Remix router context.
 * - `entry.client.tsx` / `entry.server.tsx` are hydration/SSR entry points, not components.
 */
const REMIX_RESERVED = new Set([
  'root.tsx',
  'root.jsx',
  'entry.client.tsx',
  'entry.client.jsx',
  'entry.server.tsx',
  'entry.server.jsx',
]);

/** Check if a filename is a framework-reserved file that must not appear in the preview. */
function isFrameworkReserved(fileName: string): boolean {
  return NEXTJS_APP_ROUTER_RESERVED.has(fileName) || REMIX_RESERVED.has(fileName);
}

/**
 * Files that look like components by extension+casing but aren't renderable React components:
 *
 * - Platform-specific React Native variants (Foo.native.tsx, Foo.ios.tsx, Foo.android.tsx).
 *   The web bundler resolves the bare `./Foo` to the non-suffixed file. Including the
 *   suffixed variant generates a duplicate `import { Foo } from './Foo.native'` next to
 *   `import { Foo } from './Foo'`, producing "Identifier has already been declared".
 *
 * - vanilla-extract / linaria / stylex style sheets (Foo.css.ts, Foo.css.tsx, Foo.styles.ts,
 *   Foo.module.ts). They start with PascalCase so the basename guard accepts them, but they
 *   export style tokens, not components — `extractComponentName` falls back to the filename
 *   `Foo.css` (with a dot), which then becomes an invalid JS identifier in the import line.
 */
function isPreviewIneligibleByName(fileName: string): boolean {
  // Strip terminal .tsx/.ts/.jsx/.js to inspect any inner segment (e.g. `.native`, `.css`).
  const base = fileName.replace(/\.(tsx?|jsx?)$/, '');
  if (!base.includes('.')) return false;
  const segments = base.split('.');
  // Last segment after the leading PascalCase name (e.g. `native` in `Foo.native`).
  const tail = segments.slice(1);
  // '.web' is intentionally excluded: App.web.tsx is the web entry and must be
  // previewable. Alias collision with App.tsx is resolved in deriveUniquePrefix.
  const PLATFORM_SUFFIXES = new Set(['native', 'ios', 'android']);
  const STYLE_SUFFIXES = new Set(['css', 'styles', 'style', 'module']);
  const TEST_SUFFIXES = new Set(['test', 'spec', 'stories']);
  // Co-located sample files (Component.samples.tsx) are not previewable components —
  // they're render helpers discovered separately by ensureStandaloneEntry injection.
  const SAMPLES_SUFFIXES = new Set(['samples']);
  return tail.some(
    (seg) =>
      PLATFORM_SUFFIXES.has(seg) || STYLE_SUFFIXES.has(seg) || TEST_SUFFIXES.has(seg) || SAMPLES_SUFFIXES.has(seg),
  );
}

function isExplicitWebAppShell(componentPath: string): boolean {
  return /^App\.web\.[jt]sx$/.test(basename(componentPath));
}

export interface PreviewFileManagerConfig {
  projectRoot: string;
  io: FileIO;
  isNextPagesRouter?: boolean;
  /** Wrap preview components with project-specific providers (theme, safe area, etc.) */
  providerWrap?: ProviderWrapConfig;
  /** SSR mock config — when set, route components using data hooks are wrapped in a mock router */
  ssrMock?: SSRMockConfig;
}

export class PreviewGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PreviewGenerationError';
  }
}

/** Validate that code is valid TypeScript/TSX using Babel parser */
export function isValidTypeScript(code: string): boolean {
  try {
    parse(code, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse an existing __canvas_preview__.tsx to extract registered component entries.
 * Uses @babel/parser AST to correctly handle comments, string literals,
 * type annotations with `=>`, and nested braces.
 */
export function parseExistingPreview(content: string): PreviewComponentEntry[] {
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      errorRecovery: true,
    });
  } catch {
    return [];
  }

  const pathToName = new Map<string, string>();
  const sampleAliasToPath = new Map<string, string>();
  const pathToSamples = new Map<string, string[]>();

  // 1. Extract data from top-level variable declarations
  for (const decl of iterateVarDeclarators(ast.program.body)) {
    if (decl.id.type !== 'Identifier') continue;
    const varName = decl.id.name;

    const obj = unwrapToObject(decl.init);
    if (!obj) continue;

    if (varName === 'componentRegistry') {
      for (const prop of iterateObjectProperties(obj)) {
        const key = getStringValue(prop.key);
        const value = getIdentName(prop.value);
        if (key && value) pathToName.set(key, value);
      }
    }

    if (varName === 'SampleDefaultMap' || varName === 'sampleRenderMap') {
      for (const prop of iterateObjectProperties(obj)) {
        const key = getStringValue(prop.key);
        if (!key) continue;
        const value = getIdentName(prop.value);
        if (value) {
          // Authored: `'path': ButtonSampleDefault,` — captured as alias.
          sampleAliasToPath.set(value, key);
          if (!pathToName.has(key)) {
            pathToName.set(key, stripExtension(basename(key)));
          }
        } else if (!pathToName.has(key)) {
          // Synthesized: `'path': () => (<…>),` — no alias to track, and we
          // intentionally do NOT mark sampleExports for it. The persistence
          // path for synthesized primitives is `_scanAllComponents` salvage
          // inside `_initPreviewFile` — `buildEntry` re-derives
          // `syntheticSampleDefault` from source on every regen — so we don't
          // need to round-trip a marker here. Just register the path so other
          // code (componentRegistry parser, alias inference) sees it.
          pathToName.set(key, stripExtension(basename(key)));
        }
      }
    }

    if (varName === 'sampleRenderersMap') {
      for (const prop of iterateObjectProperties(obj)) {
        const compPath = getStringValue(prop.key);
        if (!compPath) continue;
        const innerObj = unwrapToObject(prop.value);
        if (!innerObj) continue;
        const samples: string[] = [];
        for (const inner of iterateObjectProperties(innerObj)) {
          const sampleKey = getStringValue(inner.key);
          if (sampleKey) {
            samples.push(`Sample${sampleKey.charAt(0).toUpperCase()}${sampleKey.slice(1)}`);
          }
        }
        pathToSamples.set(compPath, samples);
      }
    }
  }

  // For SampleDefaultMap-only paths or paths with empty sampleRenderersMap, infer SampleDefault
  for (const [, compPath] of sampleAliasToPath) {
    const existing = pathToSamples.get(compPath);
    if (!existing || existing.length === 0) {
      pathToSamples.set(compPath, ['SampleDefault']);
    }
  }

  if (pathToName.size === 0) return [];

  // 2. Build import maps from ImportDeclaration AST nodes
  const aliasToImportPath = new Map<string, string>();
  const defaultImportNames = new Set<string>();

  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    const importPath = node.source.value;
    if (importPath === 'react' || importPath.startsWith('next/')) continue;

    for (const spec of node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier') {
        aliasToImportPath.set(spec.local.name, importPath);
        defaultImportNames.add(spec.local.name);
      } else if (spec.type === 'ImportSpecifier') {
        aliasToImportPath.set(spec.local.name, importPath);
      }
    }
  }

  // 3. Resolve import paths and build entries
  const entries: PreviewComponentEntry[] = [];

  for (const [compPath, compName] of pathToName) {
    // Try direct match via component name alias
    let importPath = aliasToImportPath.get(compName) ?? '';

    // Try match via basename
    if (!importPath) {
      const compBase = stripExtension(basename(compPath));
      for (const [, ip] of aliasToImportPath) {
        if (ip === compBase || ip.endsWith(`/${compBase}`)) {
          importPath = ip;
          break;
        }
      }
    }

    // Try match via sample alias from SampleDefaultMap
    if (!importPath) {
      for (const [alias, samplePath] of sampleAliasToPath) {
        if (samplePath === compPath) {
          importPath = aliasToImportPath.get(alias) ?? '';
          if (importPath) break;
        }
      }
    }

    const sampleExports = pathToSamples.get(compPath) ?? [];
    const exportStyle = defaultImportNames.has(compName) ? 'default-named' : 'named';

    entries.push({
      componentPath: compPath,
      componentName: compName,
      exportStyle,
      sampleExports,
      importPath,
    });
  }

  return entries;
}

// --- AST helpers for parseExistingPreview ---

import type { Expression, Node, ObjectExpression, ObjectProperty, PatternLike, VariableDeclarator } from '@babel/types';

/** Yield VariableDeclarators from top-level statements (exported or not) */
function* iterateVarDeclarators(body: ReturnType<typeof parse>['program']['body']): Generator<VariableDeclarator> {
  for (const node of body) {
    const varDecl =
      node.type === 'VariableDeclaration'
        ? node
        : node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration'
          ? node.declaration
          : null;
    if (varDecl) yield* varDecl.declarations;
  }
}

/** Yield ObjectProperty nodes from an ObjectExpression, skipping spread elements */
function* iterateObjectProperties(obj: ObjectExpression): Generator<ObjectProperty> {
  for (const prop of obj.properties) {
    if (prop.type === 'ObjectProperty') yield prop;
  }
}

/** Unwrap TSAsExpression / TSSatisfiesExpression / LogicalExpression to ObjectExpression */
function unwrapToObject(node: Expression | PatternLike | null | undefined): ObjectExpression | null {
  if (!node) return null;
  if (node.type === 'ObjectExpression') return node;
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return unwrapToObject(node.expression);
  }
  // SomeRenderers || {} — try the right operand (the fallback {})
  if (node.type === 'LogicalExpression') {
    return unwrapToObject(node.right);
  }
  return null;
}

function getStringValue(node: Node | null | undefined): string | null {
  return node?.type === 'StringLiteral' ? node.value : null;
}

function getIdentName(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'CallExpression') {
    const firstArg = node.arguments[0];
    return firstArg?.type === 'Identifier' ? firstArg.name : null;
  }
  return null;
}

function stripExtension(name: string): string {
  return name.replace(/\.\w+$/, '');
}

function pathCaseKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Recast parser using @babel/parser for TSX/TS support. Module-level constant shared across methods. */
const RECAST_PARSER = {
  parse: (source: string) =>
    parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      tokens: true,
    }),
};

export class PreviewFileManager {
  private projectRoot: string;
  private io: FileIO;
  private isNextPagesRouter: boolean;
  private providerWrap?: ProviderWrapConfig;
  private ssrMock?: SSRMockConfig;
  private _providerWrapPromise: Promise<void> | null = null;
  private _ssrMockPromise: Promise<void> | null = null;
  /** Memoized set of project-relative paths of components mounted by the entry's createRoot. */
  private _entryRootPathsPromise: Promise<Set<string>> | null = null;

  constructor(config: PreviewFileManagerConfig) {
    this.projectRoot = config.projectRoot;
    this.io = config.io;
    this.isNextPagesRouter = config.isNextPagesRouter ?? false;
    this.providerWrap = config.providerWrap;
    this.ssrMock = config.ssrMock;
  }

  /**
   * Register an async provider detection promise.
   * `ensureComponent` and `rebuild` will await it before generating content,
   * ensuring providers are available even if detection hasn't finished yet.
   */
  setProviderWrapAsync(promise: Promise<ProviderWrapConfig | null | undefined>): void {
    this._providerWrapPromise = promise.then((wrap) => {
      if (wrap) this.providerWrap = wrap;
    });
  }

  /**
   * Register an async SSR mock config detection promise.
   * Awaited alongside provider wrap before any content generation.
   */
  setSSRMockAsync(promise: Promise<SSRMockConfig | null | undefined>): void {
    this._ssrMockPromise = promise.then((cfg) => {
      if (cfg) this.ssrMock = cfg;
    });
  }

  /** Block until provider detection and SSR mock detection complete (no-op if none pending). */
  private async _awaitProviders(): Promise<void> {
    await Promise.all([this._providerWrapPromise, this._ssrMockPromise]);
  }

  /** Determine the preview file path based on project structure */
  async getPreviewFilePath(): Promise<string> {
    // Try Next.js monorepo structure first
    try {
      await this.io.access(join(this.projectRoot, 'apps/next')); // nosemgrep: path-join-resolve-traversal
      return join(this.projectRoot, 'apps/next/__canvas_preview__.tsx'); // nosemgrep: path-join-resolve-traversal
    } catch {
      // Not a monorepo
    }

    // Detect frontend root from index.html <script type="module" src="/XXX/main.*">
    // This must come BEFORE the src/ check so projects with src/ in root but client/ as
    // the actual frontend entrypoint (e.g. bulka-the-dog) are handled correctly.
    try {
      const html = await this.io.readFile(join(this.projectRoot, 'index.html')); // nosemgrep: path-join-resolve-traversal
      const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']\/([^/"']+)\/main\.[jt]sx?["']/);
      if (match && match[1] !== 'src') {
        return join(this.projectRoot, match[1], '__canvas_preview__.tsx'); // nosemgrep: path-join-resolve-traversal
      }
    } catch {
      // No index.html or no matching script tag
    }

    // Fallback: src/ — most common Vite/CRA layout (also used when src/ doesn't exist yet)
    return join(this.projectRoot, 'src/__canvas_preview__.tsx'); // nosemgrep: path-join-resolve-traversal
  }

  /**
   * Resolve the SPA entry file (the module the browser loads first) and return the
   * project-relative paths of every locally-imported component it mounts via
   * `createRoot(...).render(<tree/>)`. Memoized for the manager's lifetime — the
   * entry file does not change between component selections.
   *
   * Mirrors the entry-file candidate order used by PreviewModeManager: the
   * index.html `<script type="module">` target first, then `src/main.tsx` &c. This
   * is the createRoot bootstrap target that imports the app shell (`<App/>`), which
   * must never enter the previewable-component registry — rendering it standalone
   * fires its provider consumer hooks outside the providers main.tsx mounts (HYP-546).
   *
   * Scope: resolves DIRECT entry imports only (`import App from './app/App'`, the
   * conloca shape). A barrel/directory entry import (`import App from './app'` where
   * the shell lives in `./app/App.tsx` re-exported via `./app/index.ts`) is NOT
   * followed — that needs index-file probing + re-export tracing and is a deferred
   * follow-up (no observed target uses it; the reported bug uses a direct import).
   * Returns an empty set for non-SPA frameworks (Next/Remix/Astro have no single
   * createRoot bootstrap), so the exclusion never fires there.
   */
  private async _getEntryRootComponentPaths(): Promise<Set<string>> {
    this._entryRootPathsPromise ??= this._resolveEntryRootComponentPaths();
    return this._entryRootPathsPromise;
  }

  private async _resolveEntryRootComponentPaths(): Promise<Set<string>> {
    const entryFile = await this._detectSpaEntryFile();
    if (!entryFile) return new Set();

    let entrySource: string;
    try {
      entrySource = await this.io.readFile(join(this.projectRoot, entryFile));
    } catch {
      return new Set();
    }

    let relativeSources: Set<string>;
    try {
      relativeSources = extractMountedRootImportSources(entrySource);
    } catch {
      return new Set();
    }

    const entryDir = dirname(entryFile);
    const result = new Set<string>();
    for (const source of relativeSources) {
      // Resolve the import source relative to the entry file's dir, then express it
      // project-relative (no extension) so it can be matched against canonicalized
      // component paths regardless of the on-disk extension.
      const resolvedAbs = resolve(this.projectRoot, entryDir, source);
      const projectRel = relative(this.projectRoot, resolvedAbs);
      if (projectRel.startsWith('..')) continue; // outside project — ignore
      result.add(projectRel.replace(/\.[jt]sx?$/, ''));
    }
    return result;
  }

  /**
   * From a set of already-registered preview entries, return the CANONICAL paths of
   * those that are the SPA entry root AND a provider shell — i.e. exactly what
   * `buildEntry` excludes (HYP-546). Used by the `ensureComponent` fast path to mark
   * a persisted provider-shell entry stale and force a regen that drops it. Reads
   * each candidate's source only when it matches an entry-root path, so the common
   * non-entry-root entries cost nothing.
   */
  private async _collectEntryRootShellPaths(
    entries: { componentPath: string }[],
    canonicalPaths: Map<string, string>,
  ): Promise<Set<string>> {
    const entryRootPaths = await this._getEntryRootComponentPaths();
    const stale = new Set<string>();
    if (entryRootPaths.size === 0) return stale;

    for (const entry of entries) {
      const canonical = this.canonicalizeComponentPath(entry.componentPath, canonicalPaths);
      if (!entryRootPaths.has(canonical.replace(/\.[jt]sx?$/, ''))) continue;
      let source: string;
      try {
        source = await this.io.readFile(join(this.projectRoot, canonical));
      } catch {
        continue;
      }
      let isShell = false;
      try {
        isShell = detectProviderShell(source);
      } catch {
        isShell = false;
      }
      if (isShell) stale.add(canonical);
    }
    return stale;
  }

  /**
   * Detect the SPA browser entry file (project-relative). Returns null when no
   * Vite/CRA-style entry is found (Next.js / Remix / Astro use file-based routing
   * and have no single createRoot bootstrap). Pure FileIO — no PreviewModeManager
   * dependency, so the exclusion works on every buildEntry path uniformly.
   */
  private async _detectSpaEntryFile(): Promise<string | null> {
    // 1. index.html <script type="module" src="…"> — the authoritative entry.
    for (const htmlRel of ['index.html', 'src/index.html', 'client/index.html', 'app/index.html']) {
      let html: string;
      try {
        html = await this.io.readFile(join(this.projectRoot, htmlRel)); // nosemgrep: path-join-resolve-traversal
      } catch {
        continue;
      }
      const htmlDir = htmlRel.includes('/') ? htmlRel.slice(0, htmlRel.lastIndexOf('/')) : '';
      // HTML tag/attribute names are case-insensitive — match <SCRIPT>/TYPE/SRC too
      // (CodeQL js/bad-tag-filter: a case-sensitive <script> filter misses upper-case tags).
      for (const match of html.matchAll(/<script\b[^>]*>/gi)) {
        const tag = match[0];
        if (!/\btype=["']module["']/i.test(tag)) continue;
        const src = tag.match(/\bsrc=["']([^"']+)["']/i)?.[1];
        if (!src || src.startsWith('http://') || src.startsWith('https://') || src.startsWith('/@')) continue;
        if (!/\.[cm]?[jt]sx?$/.test(src)) continue;
        const rel = src.startsWith('/') ? src.slice(1) : posix.normalize(posix.join(htmlDir, src));
        try {
          await this.io.access(join(this.projectRoot, rel)); // nosemgrep: path-join-resolve-traversal
          return rel;
        } catch {
          /* script target not present — keep scanning */
        }
      }
    }

    // 2. Conventional Vite/CRA entry filenames under common frontend roots.
    for (const rel of ['src/main.tsx', 'src/main.ts', 'src/index.tsx', 'src/index.ts', 'client/main.tsx']) {
      try {
        await this.io.access(join(this.projectRoot, rel)); // nosemgrep: path-join-resolve-traversal
        return rel;
      } catch {
        /* not present */
      }
    }
    return null;
  }

  /**
   * Ensure given component paths are registered in the preview file.
   * - File missing (init): scan ALL project components and generate once with all imports.
   * - File exists, fast path: AST check. All present → no write. Any missing → minimal AST insert.
   * Returns the final file content.
   */
  async ensureComponent(componentPaths: string[]): Promise<string> {
    await this._awaitProviders();
    // Filter out ineligible files (*.samples.tsx, *.test.tsx, etc.) before any path logic.
    // Without this, ineligible paths would appear as perpetually-missing on every call
    // and trigger unnecessary preview rewrites / HMR churn.
    componentPaths = componentPaths.filter((p) => !isPreviewIneligibleByName(basename(p)));
    const previewPath = await this.getPreviewFilePath();
    const previewDir = dirname(previewPath);

    // Check if preview file exists
    let existingContent: string | null = null;
    try {
      existingContent = await this.io.readFile(previewPath);
    } catch {
      // File doesn't exist — init path
    }

    if (existingContent === null) {
      // Init: scan all project components for a complete first write
      return this._initPreviewFile(previewPath, previewDir, componentPaths);
    }

    // File exists: fast AST check
    const missingPaths: string[] = [];
    for (const compPath of componentPaths) {
      const importPath = await this.computeImportPath(compPath, previewDir);
      const hasIt = await this._hasImport(previewPath, importPath);
      if (!hasIt) missingPaths.push(compPath);
    }

    if (missingPaths.length === 0) {
      // Fast path: all requested components already registered.
      // Check if provider wrapping is outdated — regenerate if providers were added/changed
      // since the file was last written (e.g. detectPreviewProviders resolved after initial gen).
      const needsProviderUpdate =
        this.providerWrap?.imports.length && !this.providerWrap.imports.every((imp) => existingContent.includes(imp));
      const hasCurrentGeneratorMarker = existingContent
        .split('\n')
        .some((line) => line.trim() === `// ${PREVIEW_GENERATOR_SCHEMA_MARKER}`);
      const needsGeneratorUpdate = !hasCurrentGeneratorMarker;
      // Validate the existing file for stale entries: non-PascalCase names, Next.js App Router
      // reserved files (layout.tsx exports metadata — breaks Client Component chain), or
      // @hyperide-managed files (extension's own generated route files).
      const existingEntries = parseExistingPreview(existingContent);
      const discoveredPaths = await this._scanAllComponents();
      const canonicalPaths = this.buildCanonicalPathMap(discoveredPaths);
      // HYP-546 — an entry-root provider shell (the createRoot bootstrap target) that
      // slipped into a previously-generated preview must be purged on the fast path
      // too; otherwise a persisted __canvas_preview__.tsx keeps the provider shell
      // forever (it never re-enters buildEntry while all requested imports resolve).
      // Marking it stale forces _initPreviewFile, whose buildEntry re-applies the
      // two-signal exclusion. Scoped to entries that ARE provider shells (matching
      // buildEntry's gate) so a trivial non-shell entry root never triggers churn.
      const staleShellPaths = await this._collectEntryRootShellPaths(existingEntries, canonicalPaths);
      const isStale = (e: { componentName: string; componentPath: string }) =>
        !/^[A-Z]/.test(e.componentName) ||
        isFrameworkReserved(basename(e.componentPath)) ||
        isPreviewIneligibleByName(basename(e.componentPath)) ||
        staleShellPaths.has(this.canonicalizeComponentPath(e.componentPath, canonicalPaths)) ||
        this.hasPathCaseMismatch(e.componentPath, canonicalPaths);
      const needsSampleUpdate = await this.hasSampleExportMismatch(componentPaths, existingEntries, canonicalPaths);
      if (!existingEntries.some(isStale) && !needsProviderUpdate && !needsGeneratorUpdate && !needsSampleUpdate) {
        return existingContent;
      }

      // Stale entries found — regenerate excluding reserved files and ui-primitive paths.
      // Keep UI primitives that have a renderable sample (authored SampleDefault or
      // a synthesized compound scaffold).
      const cleanPaths = existingEntries
        .filter((e) => !isStale(e) && (!isUiPrimitive(e.componentPath) || entryHasRenderableSample(e)))
        .map((e) => this.canonicalizeComponentPath(e.componentPath, canonicalPaths));
      return this._initPreviewFile(
        previewPath,
        previewDir,
        [...new Set([...cleanPaths, ...componentPaths])],
        discoveredPaths,
      );
    }

    // Full regen when new components are added — ensures componentRegistry and sampleRenderMap
    // are updated alongside imports. Preserve existing components by parsing the registry via AST,
    // excluding reserved filenames that must not be in the Client Component bundle.
    const existingEntries = parseExistingPreview(existingContent);
    const discoveredPaths = await this._scanAllComponents();
    const canonicalPaths = this.buildCanonicalPathMap(discoveredPaths);
    const existingPaths = existingEntries
      .filter(
        (e) =>
          !isFrameworkReserved(basename(e.componentPath)) &&
          !isPreviewIneligibleByName(basename(e.componentPath)) &&
          (!isUiPrimitive(e.componentPath) || entryHasRenderableSample(e)),
      )
      .map((e) => this.canonicalizeComponentPath(e.componentPath, canonicalPaths));
    const allPaths = [...new Set([...existingPaths, ...componentPaths])];
    return this._initPreviewFile(previewPath, previewDir, allPaths, discoveredPaths);
  }

  private async hasSampleExportMismatch(
    componentPaths: string[],
    existingEntries: PreviewComponentEntry[],
    canonicalPaths: Map<string, string>,
  ): Promise<boolean> {
    const entryByPath = new Map(
      existingEntries.map((entry) => [this.canonicalizeComponentPath(entry.componentPath, canonicalPaths), entry]),
    );

    for (const componentPath of componentPaths) {
      const canonicalPath = this.canonicalizeComponentPath(componentPath, canonicalPaths);
      const entry = entryByPath.get(canonicalPath);
      if (!entry) continue;

      let sourceCode: string;
      try {
        sourceCode = await this.io.readFile(join(this.projectRoot, canonicalPath));
      } catch {
        continue;
      }

      const currentSamples = scanSampleExports(sourceCode);
      if (currentSamples.length !== entry.sampleExports.length) return true;
      if (currentSamples.some((sample) => !entry.sampleExports.includes(sample))) return true;
    }

    return false;
  }

  /**
   * Force-regenerate the preview file, re-reading the given component from disk.
   * Unlike ensureComponent, this bypasses the fast path — use after a component's
   * source is mutated in-place (e.g. SampleDefault was added by the extension).
   * Preserves all other registered components.
   */
  async forceRefreshComponent(componentPath: string): Promise<string> {
    await this._awaitProviders();
    const previewPath = await this.getPreviewFilePath();
    const previewDir = dirname(previewPath);

    const discoveredPaths = await this._scanAllComponents();
    const canonicalPaths = this.buildCanonicalPathMap(discoveredPaths);

    let allPaths: string[] = [componentPath];
    try {
      const existingContent = await this.io.readFile(previewPath);
      const existingEntries = parseExistingPreview(existingContent);
      const filteredPaths = existingEntries
        .filter(
          (e) =>
            !isFrameworkReserved(basename(e.componentPath)) && !isPreviewIneligibleByName(basename(e.componentPath)),
        )
        .map((e) => this.canonicalizeComponentPath(e.componentPath, canonicalPaths));
      allPaths = [...new Set([...filteredPaths, componentPath])];
    } catch {
      // No existing preview file — init with just this component
    }

    return this._initPreviewFile(previewPath, previewDir, allPaths, discoveredPaths);
  }

  /** Init: scan all TSX/TS files and generate a complete preview file. */
  private async _initPreviewFile(
    previewPath: string,
    previewDir: string,
    requestedPaths: string[],
    knownDiscoveredPaths?: string[],
  ): Promise<string> {
    const discoveredPaths = knownDiscoveredPaths ?? (await this._scanAllComponents());
    const canonicalPaths = this.buildCanonicalPathMap(discoveredPaths);
    const canonicalRequestedPaths = requestedPaths.map((path) => this.canonicalizeComponentPath(path, canonicalPaths));

    // Build entries for explicitly requested paths first
    const requestedEntries: PreviewComponentEntry[] = [];
    for (const compPath of canonicalRequestedPaths) {
      const entry = await this.buildEntry(compPath, previewDir, {
        allowRouterShell: isExplicitWebAppShell(compPath),
      });
      if (entry) requestedEntries.push(entry);
    }

    // Supplement with all other components discovered in project (init-time full scan).
    // Always runs so that stale-entry cleanup can salvage real components even when
    // all explicitly requested paths are non-component files (e.g. only main.tsx passed).
    const requestedPathSet = new Set(canonicalRequestedPaths);
    const extraEntries: PreviewComponentEntry[] = [];
    for (const compPath of discoveredPaths) {
      if (requestedPathSet.has(compPath)) continue;
      const entry = await this.buildEntry(compPath, previewDir);
      if (entry) extraEntries.push(entry);
    }

    const allEntries = [...requestedEntries, ...extraEntries];

    // If no valid entries from any source (e.g. only non-component files requested and project
    // scan also found nothing), fall back to existing content rather than regenerating.
    // Only throw when no existing file exists — there is genuinely nothing to return.
    if (allEntries.length === 0) {
      try {
        return await this.io.readFile(previewPath);
      } catch {
        throw new PreviewGenerationError('No valid components to include in preview');
      }
    }

    const content = generatePreviewContent(allEntries, {
      isNextPagesRouter: this.isNextPagesRouter,
      providerWrap: this.providerWrap,
      ssrMock: this.ssrMock,
    });

    const valid = await isValidTypeScript(content);
    if (!valid) {
      throw new PreviewGenerationError('Generated preview code failed TypeScript validation');
    }

    // Skip write if content is identical — avoids unnecessary Vite HMR that can
    // cause full-reload or React Fast Refresh remount, resetting iframe state.
    try {
      const existing = await this.io.readFile(previewPath);
      if (existing === content) return content;
    } catch {
      // File doesn't exist yet — proceed with write
    }

    await this.io.writeFile(previewPath, content);
    // Ensure __canvas_preview__.tsx is git-excluded regardless of framework type.
    // Called here (after write) so it runs for vite-spa-jsx-router / webpack / bun
    // which never go through ensurePreviewFiles(). Idempotent — no-op if already done.
    await this.ensureGitExclude();
    return content;
  }

  /**
   * Scan all TSX component files in the project via io.listFiles (if available).
   * Falls back to empty array if listFiles is not supported.
   *
   * Scans multiple candidate roots (src, app, client) so projects that place
   * components outside src/ (e.g. Bulka uses client/) are fully discovered.
   * PascalCase filename filter is intentionally removed — buildEntry does
   * content-based component detection so lowercase files like shadcn's sheet.tsx
   * (which exports PascalCase Sheet) are handled correctly there.
   */
  private async _scanAllComponents(): Promise<string[]> {
    if (!this.io.listFiles) return [];

    const roots = await this._detectScanRoots();
    const seen = new Set<string>();
    const allFiles: string[] = [];

    for (const root of roots) {
      const dir = join(this.projectRoot, root);
      try {
        const files = await this.io.listFiles(dir, ['.tsx', '.ts']);
        for (const f of files) {
          if (!seen.has(f)) {
            seen.add(f);
            allFiles.push(f);
          }
        }
      } catch {
        // Directory doesn't exist — skip
      }
    }

    return allFiles
      .filter((f) => {
        const name = basename(f);
        return (
          !name.startsWith('__') &&
          !name.startsWith('index.') &&
          (f.endsWith('.tsx') || f.endsWith('.ts')) &&
          !isPreviewIneligibleByName(name)
        );
      })
      .map((abs) => relative(this.projectRoot, abs));
  }

  /**
   * Detect which source roots to scan. Reads index.html to find the Vite entry
   * point (same heuristic as detectFrontendRoot in extension.ts), then also
   * includes static candidate roots so nothing is missed.
   */
  private async _detectScanRoots(): Promise<string[]> {
    const candidates = new Set(['src', 'app', 'client']);

    try {
      const html = await this.io.readFile(join(this.projectRoot, 'index.html'));
      const match = html.match(/<script[^>]+type=["']module["'][^>]+src=["']\/([^/"']+)\/main\.[jt]sx?["']/);
      if (match?.[1]) {
        // Put detected root first so it's scanned before generic candidates
        const detected = match[1];
        const ordered = [detected, ...Array.from(candidates).filter((r) => r !== detected)];
        return ordered;
      }
    } catch {
      // No index.html or unreadable — fall through to default candidates
    }

    return Array.from(candidates);
  }

  private buildCanonicalPathMap(paths: string[]): Map<string, string> {
    const canonicalPaths = new Map<string, string>();
    for (const path of paths) {
      canonicalPaths.set(pathCaseKey(path), path);
    }
    return canonicalPaths;
  }

  private canonicalizeComponentPath(componentPath: string, canonicalPaths: Map<string, string>): string {
    return canonicalPaths.get(pathCaseKey(componentPath)) ?? componentPath;
  }

  private hasPathCaseMismatch(componentPath: string, canonicalPaths: Map<string, string>): boolean {
    const canonical = canonicalPaths.get(pathCaseKey(componentPath));
    return canonical !== undefined && canonical !== componentPath;
  }

  /**
   * Check if a file already imports from the given path.
   * Normalizes relative paths to absolute for comparison.
   * Public for testing.
   */
  async _hasImport(previewFilePath: string, importPath: string): Promise<boolean> {
    const source = await this.io.readFile(previewFilePath);
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
    const previewDir = dirname(previewFilePath);
    const normalizedTarget = this._normalizeImportPath(previewDir, importPath);

    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration') continue;
      const normalized = this._normalizeImportPath(previewDir, node.source.value);
      if (normalized === normalizedTarget) return true;
    }
    return false;
  }

  private _normalizeImportPath(fromDir: string, importPath: string): string {
    if (importPath.startsWith('.')) {
      return resolve(fromDir, importPath).replace(/\.(tsx?|jsx?)$/, '');
    }
    return importPath;
  }

  /**
   * Full regeneration from scratch — ignores existing file.
   * Reads all component sources, builds entries, generates.
   */
  async rebuild(componentPaths: string[]): Promise<string> {
    await this._awaitProviders();
    const previewPath = await this.getPreviewFilePath();
    const previewDir = dirname(previewPath);

    const entries: PreviewComponentEntry[] = [];
    for (const compPath of componentPaths) {
      const entry = await this.buildEntry(compPath, previewDir, {
        allowRouterShell: isExplicitWebAppShell(compPath),
      });
      if (entry) entries.push(entry);
    }

    if (entries.length === 0) {
      throw new PreviewGenerationError('No valid components to include in preview');
    }

    const content = generatePreviewContent(entries, {
      isNextPagesRouter: this.isNextPagesRouter,
      providerWrap: this.providerWrap,
      ssrMock: this.ssrMock,
    });

    const valid = await isValidTypeScript(content);
    if (!valid) {
      throw new PreviewGenerationError('Generated preview code failed TypeScript validation');
    }

    await this.io.writeFile(previewPath, content);
    return content;
  }

  /** Build a PreviewComponentEntry by reading the component source */
  private async buildEntry(
    componentPath: string,
    previewDir: string,
    options: BuildEntryOptions = {},
  ): Promise<PreviewComponentEntry | null> {
    // Guard against path traversal — componentPath must stay within projectRoot
    if (componentPath.includes('..')) {
      console.warn(`[PreviewFileManager] Skipping suspicious path: ${componentPath}`);
      return null;
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

    const absolutePath = join(this.projectRoot, componentPath);

    let sourceCode: string;
    try {
      sourceCode = await this.io.readFile(absolutePath);
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

    // Skip the SPA entry-root provider shell (HYP-546). A Vite/CRA `App.tsx` that
    // `main.tsx` mounts via `createRoot(...).render(<App/>)` and that wraps the app
    // in context providers (AuthProvider, QueryClientProvider, …) is the application
    // shell, not a reusable previewable component. Rendering it standalone in the
    // preview registry fires its providers' consumer hooks (useAuth, useBootstrap, …)
    // OUTSIDE the surrounding providers main.tsx mounts → "useAuth must be used inside
    // <AuthProvider>" → blank preview. The two-signal gate (entry-root AND provider
    // shell) keeps a trivial mounted root that imports no providers selectable, and
    // honors the same `allowRouterShell` escape hatch as the router-shell skip.
    // Guarded parse: a mid-edit unparseable file must NOT crash here — let the
    // dedicated parse-error try/catch below skip it. Treat a parse failure as
    // "not a provider shell".
    let isProviderShell = false;
    try {
      isProviderShell = detectProviderShell(sourceCode);
    } catch {
      isProviderShell = false;
    }
    if (!options.allowRouterShell && isProviderShell) {
      const entryRootPaths = await this._getEntryRootComponentPaths();
      if (entryRootPaths.has(componentPath.replace(/\.[jt]sx?$/, ''))) {
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
      if (this.ssrMock?.framework === 'remix') {
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
    const importPath = await this.computeImportPath(componentPath, previewDir);

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

  /** Compute relative import path from preview file to component */
  private async computeImportPath(componentPath: string, previewDir: string): Promise<string> {
    // Check monorepo package import
    const packageImport = await this.getPackageImportPath(componentPath);
    if (packageImport) return packageImport;

    // Regular relative path
    // componentPath is validated in buildEntry (no '..' segments)
    const absoluteComponent = join(this.projectRoot, componentPath);
    const relativePath = relative(previewDir, absoluteComponent).replace(/\.\w+$/, '');

    // Ensure it starts with ./
    if (!relativePath.startsWith('.')) {
      return `./${relativePath}`;
    }
    return relativePath;
  }

  /**
   * Get package import path for components in workspace packages (monorepo).
   * Reads package.json to get the real package name (supports scoped packages like @acme/ui).
   * Falls back to directory name if package.json is unreadable.
   */
  private async getPackageImportPath(componentPath: string): Promise<string | null> {
    const match = componentPath.match(/packages\/([^/]+)\/(.*)/);
    if (!match) return null;

    const [, packageDir, relativePath] = match;

    // Guard against path traversal — packageDir must be a plain directory name
    if (packageDir === '..' || packageDir === '.' || packageDir.includes('\\')) return null;

    const cleanPath = relativePath.replace(/^src\//, '').replace(/\.\w+$/, '');

    // Try to read package.json for real package name (supports @scoped/packages)
    const pkgJsonPath = join(this.projectRoot, 'packages', packageDir, 'package.json');
    try {
      const pkgContent = await this.io.readFile(pkgJsonPath);
      const pkg = JSON.parse(pkgContent) as { name?: string };
      if (pkg.name) {
        return `${pkg.name}/${cleanPath}`;
      }
    } catch {
      // package.json unreadable — fall back to directory name
    }

    return `${packageDir}/${cleanPath}`;
  }

  /**
   * Ensure framework-specific route file(s) exist for App Shell mode.
   * Idempotent — skips files that already contain @hyperide-managed.
   * Does not overwrite user files (P3-3).
   * Returns 'ok' | 'ok-files-written' | 'unsupported' | 'needs-patch'.
   * 'ok-files-written' means new/updated files were written (HMR will fire).
   */
  async ensurePreviewFiles(): Promise<'ok' | 'ok-files-written' | 'unsupported' | 'needs-patch'> {
    const detection = await detectFramework(this.projectRoot, this.io);
    const { framework } = detection;

    if (framework === 'unknown') return 'unsupported';

    if (framework === 'webpack' || framework === 'vite-spa-jsx-router' || framework === 'bun') {
      // No file-based routing convention — router is defined in JSX code.
      // PreviewModeManager.onComponentSelected patches the entry/router file directly.
      return 'needs-patch';
    }

    const previewPath = await this.getPreviewFilePath();
    const paths = getRouteFilePaths(detection, this.projectRoot);

    if (!paths.routeFile) return 'ok';

    // Compute import path from route file to preview file
    const routeDir = dirname(paths.routeFile);
    let importPath = relative(routeDir, previewPath).replace(/\.\w+$/, '');
    if (!importPath.startsWith('.')) importPath = `./${importPath}`;

    let wrote = await this._writeIfSafe(paths.routeFile, generateRouteFileContent(framework, importPath));

    if (paths.layoutFile) {
      wrote = (await this._writeIfSafe(paths.layoutFile, generateBlankLayoutContent())) || wrote;
    }

    await this.ensureGitExclude();

    return wrote ? 'ok-files-written' : 'ok';
  }

  /**
   * Walk up from startDir to find the root that contains a real .git directory.
   * Handles monorepos where projectRoot is a subdirectory (e.g. targets/conloca-app
   * inside conloca-private). Returns null if no git root found.
   */
  private async findGitRoot(startDir: string): Promise<string | null> {
    let current = startDir;
    while (true) {
      try {
        await this.io.access(join(current, '.git'));
        return current;
      } catch {
        const parent = dirname(current);
        if (parent === current) return null; // reached filesystem root
        current = parent;
      }
    }
  }

  /**
   * Add HyperIDE-generated files to .git/info/exclude (local, not committed).
   * Prevents __canvas_preview__.tsx, *.samples.tsx, .hyperide/ and route files
   * from appearing in `git status`. Walks up to find the real git root so
   * monorepo sub-packages are handled correctly.
   * No-op if entries are already present or if no .git root is found.
   */
  async ensureGitExclude(): Promise<void> {
    const gitRoot = await this.findGitRoot(this.projectRoot);
    if (!gitRoot) return;

    const excludePath = join(gitRoot, '.git/info/exclude');
    const entries = [
      '# HyperIDE — generated preview files',
      '__canvas_preview__.tsx',
      '__canvas_preview_standalone__.tsx',
      '__canvas_samples__.tsx',
      '*.samples.tsx',
      '.hyperide/',
      '**/test-preview/',
      '**/test-preview.tsx',
      '**/test-preview.astro',
    ];

    let existing = '';
    try {
      existing = await this.io.readFile(excludePath);
    } catch {
      // .git/info/exclude may not exist yet — we'll create it
    }

    const toAdd = entries.filter((line) => !existing.includes(line));
    if (toAdd.length === 0) return;

    const separator = existing && !existing.endsWith('\n') ? '\n' : '';
    try {
      await this.io.writeFile(excludePath, `${existing}${separator}${toAdd.join('\n')}\n`);
    } catch {
      // .git is a file in linked worktrees — silently skip
    }
  }

  /**
   * Generate __canvas_preview_standalone__.tsx for Isolated mode (Tier 1).
   * Reads the existing __canvas_preview__.tsx and appends a createRoot bootstrap
   * that wraps CanvasPreview in the user's <PreviewWrapper> from .hyperide/preview.tsx.
   * No-op if __canvas_preview__.tsx does not exist yet.
   */
  async ensureStandaloneEntry(): Promise<void> {
    const previewPath = await this.getPreviewFilePath();
    const previewDir = dirname(previewPath);
    const standaloneEntryPath = join(previewDir, '__canvas_preview_standalone__.tsx');

    let baseContent: string;
    try {
      baseContent = await this.io.readFile(previewPath);
    } catch {
      return; // __canvas_preview__.tsx not generated yet
    }

    // Relative path from src/__canvas_preview_standalone__.tsx to .hyperide/preview
    const wrapperImportPath = join(relative(previewDir, this.projectRoot), '.hyperide/preview').replace(/\\/g, '/');

    // Detect the app's root element ID from index.html. Many projects use 'app-root',
    // 'main', or similar instead of the React default 'root'. Fall back to 'root' if
    // index.html is absent or doesn't contain a recognizable mount point.
    let rootElementId = 'root';
    try {
      const indexHtml = await this.io.readFile(join(this.projectRoot, 'index.html'));
      const divMatch = indexHtml.match(/<div\s+id="([^"]+)"/);
      if (divMatch?.[1]) rootElementId = divMatch[1];
    } catch {
      // index.html not present — keep 'root'
    }

    const bootstrap = [
      '',
      '// @hyperide-managed',
      "import { createRoot } from 'react-dom/client';",
      `import { PreviewWrapper } from '${wrapperImportPath}';`,
      '',
      `const _rootEl = document.getElementById('${rootElementId}');`,
      'if (_rootEl) {',
      '  // Reuse root across HMR to avoid calling createRoot on the same container twice.',
      '  // Cast to any so TypeScript in Webpack/Parcel projects (no Vite types) does not error.',
      '  const _hot = (import.meta as any).hot as { data: Record<string, unknown>; accept: () => void } | undefined;',
      '  const _existingRoot = _hot?.data?.root as ReturnType<typeof createRoot> | undefined;',
      '  const _root = _existingRoot ?? createRoot(_rootEl);',
      '  if (_hot) {',
      '    _hot.data.root = _root;',
      '    _hot.accept();',
      '  }',
      '  _root.render(',
      '    <PreviewWrapper>',
      '      <CanvasPreview />',
      '    </PreviewWrapper>',
      '  );',
      '}',
      '',
    ].join('\n');

    const newContent = `${baseContent.trimEnd()}\n${bootstrap}`;

    // Skip write if content is identical — prevents unnecessary HMR full-reload
    // (this file has side effects: createRoot().render(), so Vite always does a
    // full page reload when it changes, killing iframe state).
    try {
      const existing = await this.io.readFile(standaloneEntryPath);
      if (existing === newContent) return;
    } catch {
      // File doesn't exist yet — proceed with write
    }

    await this.io.mkdir?.(previewDir);
    await this.io.writeFile(standaloneEntryPath, newContent);
    // Ensure __canvas_preview_standalone__.tsx is git-excluded for all frameworks.
    await this.ensureGitExclude();
  }

  /**
   * Generate route + isolated layout for Next.js Isolated mode (Tier 3).
   * Same route file as App Shell, but layout.tsx imports PreviewWrapper from .hyperide/preview.tsx.
   * Called by PreviewModeManager.onWrapperCreated() when framework is Next.js.
   * @param detection - pass when caller already has the detection result to avoid a second detectFramework call
   */
  async ensureIsolatedNextJsLayout(detection?: DetectionResult): Promise<void> {
    const detection_ = detection ?? (await detectFramework(this.projectRoot, this.io));
    const previewPath = await this.getPreviewFilePath();
    const paths = getRouteFilePaths(detection_, this.projectRoot);

    if (!paths.routeFile) return;

    const routeDir = dirname(paths.routeFile);
    let previewImportPath = relative(routeDir, previewPath).replace(/\.\w+$/, '');
    if (!previewImportPath.startsWith('.')) previewImportPath = `./${previewImportPath}`;

    await this._writeIfSafe(paths.routeFile, generateRouteFileContent(detection_.framework, previewImportPath));

    if (paths.layoutFile) {
      // Compute path from layout dir to .hyperide/preview
      const layoutDir = dirname(paths.layoutFile);
      let wrapperImportPath = join(relative(layoutDir, this.projectRoot), '.hyperide/preview').replace(/\\/g, '/');
      if (!wrapperImportPath.startsWith('.')) wrapperImportPath = `./${wrapperImportPath}`;

      await this._writeIfSafe(paths.layoutFile, generateIsolatedLayoutContent(wrapperImportPath));
    }

    await this.ensureGitExclude();
  }

  /**
   * Remove all @hyperide-managed route files created by ensurePreviewFiles.
   * Called during App Shell → Isolated mode switch.
   * Does NOT remove __canvas_preview__.tsx — only route files.
   */
  async cleanupPreviewFiles(): Promise<void> {
    const detection = await detectFramework(this.projectRoot, this.io);
    const paths = getRouteFilePaths(detection, this.projectRoot);

    for (const filePath of [paths.routeFile, paths.layoutFile].filter(Boolean) as string[]) {
      try {
        const content = await this.io.readFile(filePath);
        if (content.includes('@hyperide-managed')) {
          await this.io.deleteFile?.(filePath);
        }
      } catch {
        // File doesn't exist — nothing to clean up
      }
    }
  }

  /**
   * Write file only if it doesn't exist or already contains @hyperide-managed.
   * Prevents overwriting user files.
   * Returns true if the file was written (new or updated), false if skipped.
   */
  private async _writeIfSafe(filePath: string, content: string): Promise<boolean> {
    let existing: string | undefined;
    try {
      existing = await this.io.readFile(filePath);
    } catch {
      // File doesn't exist — safe to write
    }
    if (existing !== undefined) {
      if (!existing.includes('@hyperide-managed')) {
        console.warn(`[PreviewFileManager] Skipping ${filePath} — exists without @hyperide-managed marker`);
        return false;
      }
      if (existing === content) return false;
    }
    await this.io.mkdir?.(dirname(filePath));
    await this.io.writeFile(filePath, content);
    return true;
  }

  /**
   * Inject <Route path="/test-preview" element={<CanvasPreview />} /> into <Routes> JSX.
   * Uses recast for AST editing (preserves formatting). Tags with @hyperide-managed.
   * Only for Vite SPA JSX router (App Shell mode, no wrapper).
   */
  async patchRouterConfig(routerFilePath: string, onBeforeWrite?: () => void): Promise<boolean> {
    const source = await this.io.readFile(routerFilePath);
    const ast = recast.parse(source, { parser: RECAST_PARSER });

    const isRouteWithPath = (child: namedTypes.Node, routePath: string): boolean => {
      if (!namedTypes.JSXElement.check(child)) return false;
      return (
        child.openingElement.name.type === 'JSXIdentifier' &&
        child.openingElement.name.name === 'Route' &&
        (child.openingElement.attributes ?? []).some(
          (attr) =>
            attr.type === 'JSXAttribute' &&
            attr.name.type === 'JSXIdentifier' &&
            attr.name.name === 'path' &&
            attr.value?.type === 'StringLiteral' &&
            attr.value.value === routePath,
        )
      );
    };

    let patched = false;
    recast.visit(ast, {
      visitJSXElement(path) {
        const el = path.node;
        if (el.openingElement.name.type === 'JSXIdentifier' && el.openingElement.name.name === 'Routes') {
          if (!el.children) el.children = [];
          const existingPreviewRouteIndex = el.children.findIndex((child) => isRouteWithPath(child, '/test-preview'));
          const existingCatchAllIndex = el.children.findIndex((child) => isRouteWithPath(child, '*'));

          if (
            existingPreviewRouteIndex >= 0 &&
            (existingCatchAllIndex === -1 || existingPreviewRouteIndex < existingCatchAllIndex)
          ) {
            return false;
          }

          const newRoute = b.jsxElement(
            b.jsxOpeningElement(
              b.jsxIdentifier('Route'),
              [
                b.jsxAttribute(b.jsxIdentifier('path'), b.stringLiteral('/test-preview')),
                b.jsxAttribute(
                  b.jsxIdentifier('element'),
                  b.jsxExpressionContainer(
                    b.jsxElement(b.jsxOpeningElement(b.jsxIdentifier('CanvasPreview'), [], true), null, []),
                  ),
                ),
              ],
              true,
            ),
            null,
            [],
          );
          if (existingPreviewRouteIndex >= 0) {
            el.children = el.children.filter((_, index) => index !== existingPreviewRouteIndex);
          }
          const routeNodes = [b.jsxText('\n        '), newRoute, b.jsxText('\n      ')];
          const catchAllIndex = el.children.findIndex((child) => isRouteWithPath(child, '*'));
          if (catchAllIndex >= 0) {
            el.children.splice(catchAllIndex, 0, ...routeNodes);
          } else {
            el.children.push(...routeNodes);
          }
          patched = true;
          return false;
        }
        this.traverse(path);
      },
    });

    if (!patched) {
      console.warn('[PreviewFileManager] Could not find <Routes> in', routerFilePath);
      return false;
    }

    // Add CanvasPreview import at top — path relative to router file directory
    const previewPath = await this.getPreviewFilePath();
    const routerDir = dirname(routerFilePath);
    let importPath = relative(routerDir, previewPath).replace(/\.\w+$/, '');
    if (!importPath.startsWith('.')) importPath = `./${importPath}`;

    const previewImport = `import CanvasPreview from '${importPath}'; // @hyperide-managed\n`;
    const output = recast.print(ast).code;
    const alreadyImportsPreview = await this._hasImport(routerFilePath, importPath);
    onBeforeWrite?.();
    await this.io.writeFile(routerFilePath, alreadyImportsPreview ? output : previewImport + output);
    return true;
  }

  /**
   * Remove the injected <Route> and CanvasPreview import using line filtering + AST.
   * Identifies managed elements by the /test-preview path attribute and @hyperide-managed lines.
   */
  async revertRouterPatch(filePath: string): Promise<void> {
    const source = await this.io.readFile(filePath);
    if (!source.includes('@hyperide-managed')) return;

    // Remove @hyperide-managed lines (import and inline comment lines)
    const filteredSource = source
      .split('\n')
      .filter((line) => !line.includes('@hyperide-managed'))
      .join('\n');

    const ast = recast.parse(filteredSource, { parser: RECAST_PARSER });

    // Remove /test-preview Route elements from <Routes> children
    recast.visit(ast, {
      visitJSXElement(path) {
        const el = path.node;
        if (el.openingElement.name.type === 'JSXIdentifier' && el.openingElement.name.name === 'Routes') {
          el.children = (el.children ?? []).filter((child) => {
            if (!namedTypes.JSXElement.check(child)) return true;
            if (child.openingElement.name.type !== 'JSXIdentifier' || child.openingElement.name.name !== 'Route')
              return true;
            return !(child.openingElement.attributes ?? []).some(
              (attr) =>
                attr.type === 'JSXAttribute' &&
                attr.name.type === 'JSXIdentifier' &&
                attr.name.name === 'path' &&
                attr.value?.type === 'StringLiteral' &&
                attr.value.value === '/test-preview',
            );
          });
          return false;
        }
        this.traverse(path);
      },
    });

    await this.io.writeFile(filePath, recast.print(ast).code);
  }

  /**
   * Patch webpack/CRA entry file to conditionally load the preview module via AST.
   * Finds the createRoot(...).render(...) ExpressionStatement and wraps it in:
   *   if (?component param) { import(importTarget) }
   *   else { <original createRoot call> }
   * Tagged with a leading comment for AST-safe revert.
   *
   * @param entryFilePath - absolute path to the entry file
   * @param importTarget - module to import when in preview mode.
   *   App Shell mode: './__canvas_preview__' (component registry, no createRoot)
   *   Isolated mode: './__canvas_preview_standalone__' (has createRoot + PreviewWrapper)
   */
  async patchEntryFile(
    entryFilePath: string,
    importTarget = './__canvas_preview__',
    onBeforeWrite?: () => void,
  ): Promise<boolean> {
    const source = await this.io.readFile(entryFilePath);
    if (source.includes('@hyperide-managed')) return false;

    const ast = recast.parse(source, { parser: RECAST_PARSER });
    let patched = false;

    recast.visit(ast, {
      visitExpressionStatement(path) {
        const expr = path.node.expression;
        const isCreateRoot =
          expr.type === 'CallExpression' &&
          expr.callee.type === 'MemberExpression' &&
          expr.callee.property.type === 'Identifier' &&
          expr.callee.property.name === 'render';

        if (!isCreateRoot || patched) {
          this.traverse(path);
          return;
        }

        // Check both ?component= and /test-preview path to avoid hijacking app URLs
        // that legitimately use ?component= as their own query param.
        const condition = b.logicalExpression(
          '&&',
          b.callExpression(
            b.memberExpression(
              b.newExpression(b.identifier('URLSearchParams'), [
                b.memberExpression(b.identifier('location'), b.identifier('search')),
              ]),
              b.identifier('get'),
            ),
            [b.stringLiteral('component')],
          ),
          b.callExpression(
            b.memberExpression(
              b.memberExpression(b.identifier('location'), b.identifier('pathname')),
              b.identifier('includes'),
            ),
            [b.stringLiteral('test-preview')],
          ),
        );

        // Standalone entries render themselves on import (module has top-level createRoot call).
        // App shell __canvas_preview__ only exports a component — must render it explicitly.
        const isStandalone = importTarget.includes('standalone');
        let previewConsequent: ReturnType<typeof b.blockStatement>;
        if (isStandalone) {
          previewConsequent = b.blockStatement([
            b.expressionStatement(b.callExpression(b.import(), [b.stringLiteral(importTarget)])),
          ]);
        } else {
          // Clone the createRoot(el) call so we can reuse it inside the .then() callback.
          // expr.type === 'CallExpression' && callee.type === 'MemberExpression' already checked
          // in isCreateRoot guard above; cast to access .callee.object safely.
          const callExpr = expr as namedTypes.CallExpression & { callee: namedTypes.MemberExpression };
          const createRootExpr = JSON.parse(
            JSON.stringify(callExpr.callee.object, (key, value) => {
              // Strip position metadata that creates circular references (loc -> tokens -> loc)
              if (key === 'tokens' || key === 'comments') return undefined;
              return value;
            }),
          );
          // JSX is only valid in .tsx/.jsx files. For plain .ts/.js entry files, use
          // React.createElement — these projects must have React in scope anyway.
          const allowJsx = entryFilePath.endsWith('.tsx') || entryFilePath.endsWith('.jsx');
          const renderArg = allowJsx
            ? b.jsxElement(b.jsxOpeningElement(b.jsxIdentifier('CanvasPreviewComp'), [], true), null, [])
            : b.callExpression(b.memberExpression(b.identifier('React'), b.identifier('createElement')), [
                b.identifier('CanvasPreviewComp'),
                b.nullLiteral(),
              ]);
          const thenCallback = b.arrowFunctionExpression(
            [b.identifier('m')],
            b.blockStatement([
              b.variableDeclaration('var', [
                b.variableDeclarator(
                  b.identifier('CanvasPreviewComp'),
                  b.memberExpression(b.identifier('m'), b.identifier('default')),
                ),
              ]),
              b.ifStatement(
                b.identifier('CanvasPreviewComp'),
                b.expressionStatement(
                  b.callExpression(b.memberExpression(createRootExpr, b.identifier('render')), [renderArg]),
                ),
              ),
            ]),
          );
          // .catch() with empty handler suppresses the unhandled rejection warning in Vite
          // when __canvas_preview__ temporarily fails to load (e.g. during regeneration).
          const importThenCatch = b.callExpression(
            b.memberExpression(
              b.callExpression(
                b.memberExpression(b.callExpression(b.import(), [b.stringLiteral(importTarget)]), b.identifier('then')),
                [thenCallback],
              ),
              b.identifier('catch'),
            ),
            [b.arrowFunctionExpression([], b.blockStatement([]))],
          );
          previewConsequent = b.blockStatement([b.expressionStatement(importThenCatch)]);
        }

        const ifStmt = b.ifStatement(condition, previewConsequent, b.blockStatement([path.node]));

        (ifStmt as { comments?: unknown[] }).comments = [
          { type: 'CommentLine', value: ' @hyperide-managed', leading: true, trailing: false },
        ];

        path.replace(ifStmt);
        patched = true;
        return false;
      },
    });

    if (!patched) {
      // Fallback for non-standard entries (ViteReactSSG, custom bootstraps): append conditional
      // import at end of file. The AST-based path only handles createRoot().render() calls.
      const condition = `typeof location !== "undefined" && new URLSearchParams(location.search).get("component") && location.pathname.includes("test-preview")`;
      const isStandalone = importTarget.includes('standalone');
      let importBody: string;
      if (isStandalone) {
        // Standalone module has its own createRoot() call — just importing it is enough.
        // Replace #root node first to sever any React root the original bootstrap created,
        // preventing createRoot() conflicts when the app framework already mounted to #root.
        importBody = `(function(){var o=document.getElementById("root");if(o&&o.parentNode){var f=o.cloneNode(false);o.parentNode.replaceChild(f,o);}})();import("${importTarget}")`;
      } else {
        // App Shell: __canvas_preview__ only exports a component — must render it explicitly.
        // Replace #root node first to sever any React root the original bootstrap created.
        // React and react-dom/client resolve from Vite's module cache (already loaded by the app).
        importBody = `import("${importTarget}").then(function(m){var C=m.default;if(C){Promise.all([import("react"),import("react-dom/client")]).then(function(mods){var orig=document.getElementById("root");var el;if(orig&&orig.parentNode){var fr=orig.cloneNode(false);orig.parentNode.replaceChild(fr,orig);el=fr;}else{el=document.body;}mods[1].createRoot(el).render(mods[0].createElement(C));});}})`;
      }
      const appendedSource = `${source}\n// @hyperide-managed\nif (${condition}) { ${importBody}; }\n`;
      onBeforeWrite?.();
      await this.io.writeFile(entryFilePath, appendedSource);
      return true;
    }

    onBeforeWrite?.();
    await this.io.writeFile(entryFilePath, recast.print(ast).code);
    return true;
  }

  /**
   * Revert entry file patch: find the @hyperide-managed IfStatement and replace it
   * with the original else-branch content. AST-based — safe for any formatting.
   */
  async revertEntryFile(filePath: string): Promise<void> {
    const source = await this.io.readFile(filePath);
    if (!source.includes('@hyperide-managed')) return;

    const ast = recast.parse(source, { parser: RECAST_PARSER });

    recast.visit(ast, {
      visitIfStatement(path) {
        const node = path.node;
        const isManaged = node.comments?.some((c: { value?: string }) => c.value?.includes('@hyperide-managed'));
        if (!isManaged) {
          this.traverse(path);
          return;
        }
        const elseBody = node.alternate?.type === 'BlockStatement' ? node.alternate.body : [];
        path.replace(...elseBody);
        return false;
      },
    });

    const reverted = recast.print(ast).code;
    // If @hyperide-managed is still present (appended form without else-branch), truncate it
    if (reverted.includes('@hyperide-managed')) {
      const idx = reverted.lastIndexOf('\n// @hyperide-managed');
      await this.io.writeFile(filePath, idx >= 0 ? reverted.slice(0, idx) : reverted);
      return;
    }
    await this.io.writeFile(filePath, reverted);
  }
}
