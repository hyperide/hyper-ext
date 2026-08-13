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
import { ensureGitExclude, ensureStandaloneEntry } from './preview-file-ops';
import { buildEntry, computeImportPath } from './preview-build-entry';
import { detectProviderShell, extractMountedRootImportSources, scanSampleExports } from './scanner';
import { isExplicitWebAppShell, isFrameworkReserved, isPreviewIneligibleByName } from './preview-constants';
import { RECAST_PARSER } from './preview-ast-helpers';
import {
  buildCanonicalPathMap,
  canonicalizeComponentPath,
  hasPathCaseMismatch,
  normalizeImportPath,
} from './preview-path-utils';
import { isValidTypeScript, PreviewGenerationError } from './preview-validation';
import { parseExistingPreview } from './preview-validation';

export { PreviewGenerationError } from './preview-validation';
export { isValidTypeScript } from './preview-validation';
export { parseExistingPreview } from './preview-validation';

export interface PreviewFileManagerConfig {
  projectRoot: string;
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
  io: FileIO;
  isNextPagesRouter?: boolean;
  providerWrap?: ProviderWrapConfig;
  ssrMock?: SSRMockConfig;
}
export class PreviewFileManager {
  private projectRoot: string;
  private workspaceRoot: string;
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
    // Defaults to projectRoot: single-package projects have no separate workspace
    // root, so any `..` path is an escape and the buildEntry guard rejects it.
    this.workspaceRoot = config.workspaceRoot ?? config.projectRoot;
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
      const canonical = canonicalizeComponentPath(entry.componentPath, canonicalPaths);
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
      const importPath = await computeImportPath(this.projectRoot, this.io, compPath, previewDir);
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
      const canonicalPaths = buildCanonicalPathMap(discoveredPaths);
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
        staleShellPaths.has(canonicalizeComponentPath(e.componentPath, canonicalPaths)) ||
        hasPathCaseMismatch(e.componentPath, canonicalPaths);
      const needsSampleUpdate = await this.hasSampleExportMismatch(componentPaths, existingEntries, canonicalPaths);
      if (!existingEntries.some(isStale) && !needsProviderUpdate && !needsGeneratorUpdate && !needsSampleUpdate) {
        return existingContent;
      }

      // Stale entries found — regenerate excluding reserved files and ui-primitive paths.
      // Keep UI primitives that have a renderable sample (authored SampleDefault or
      // a synthesized compound scaffold).
      const cleanPaths = existingEntries
        .filter((e) => !isStale(e) && (!isUiPrimitive(e.componentPath) || entryHasRenderableSample(e)))
        .map((e) => canonicalizeComponentPath(e.componentPath, canonicalPaths));
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
    const canonicalPaths = buildCanonicalPathMap(discoveredPaths);
    const existingPaths = existingEntries
      .filter(
        (e) =>
          !isFrameworkReserved(basename(e.componentPath)) &&
          !isPreviewIneligibleByName(basename(e.componentPath)) &&
          (!isUiPrimitive(e.componentPath) || entryHasRenderableSample(e)),
      )
      .map((e) => canonicalizeComponentPath(e.componentPath, canonicalPaths));
    const allPaths = [...new Set([...existingPaths, ...componentPaths])];
    return this._initPreviewFile(previewPath, previewDir, allPaths, discoveredPaths);
  }

  private async hasSampleExportMismatch(
    componentPaths: string[],
    existingEntries: PreviewComponentEntry[],
    canonicalPaths: Map<string, string>,
  ): Promise<boolean> {
    const entryByPath = new Map(
      existingEntries.map((entry) => [canonicalizeComponentPath(entry.componentPath, canonicalPaths), entry]),
    );
    for (const componentPath of componentPaths) {
      const canonicalPath = canonicalizeComponentPath(componentPath, canonicalPaths);
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
    const canonicalPaths = buildCanonicalPathMap(discoveredPaths);

    let allPaths: string[] = [componentPath];
    try {
      const existingContent = await this.io.readFile(previewPath);
      const existingEntries = parseExistingPreview(existingContent);
      const filteredPaths = existingEntries
        .filter(
          (e) =>
            !isFrameworkReserved(basename(e.componentPath)) && !isPreviewIneligibleByName(basename(e.componentPath)),
        )
        .map((e) => canonicalizeComponentPath(e.componentPath, canonicalPaths));
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
    const canonicalPaths = buildCanonicalPathMap(discoveredPaths);
    const canonicalRequestedPaths = requestedPaths.map((path) => canonicalizeComponentPath(path, canonicalPaths));

    // HYP-546 — resolved once (memoized) and passed to every buildEntry so it can
    // exclude SPA entry-root provider shells from the preview registry.
    const entryRootPaths = await this._getEntryRootComponentPaths();

    // Build entries for explicitly requested paths first
    const requestedEntries: PreviewComponentEntry[] = [];
    for (const compPath of canonicalRequestedPaths) {
      const entry = await buildEntry(this.projectRoot, this.io, this.ssrMock?.framework, compPath, previewDir, {
        allowRouterShell: isExplicitWebAppShell(compPath),
        entryRootPaths,
        workspaceRoot: this.workspaceRoot,
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
      const entry = await buildEntry(this.projectRoot, this.io, this.ssrMock?.framework, compPath, previewDir, {
        entryRootPaths,
        workspaceRoot: this.workspaceRoot,
      });
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

  /**
   * Check if a file already imports from the given path.
   * Normalizes relative paths to absolute for comparison.
   * Public for testing.
   */
  async _hasImport(previewFilePath: string, importPath: string): Promise<boolean> {
    const source = await this.io.readFile(previewFilePath);
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
    const previewDir = dirname(previewFilePath);
    const normalizedTarget = normalizeImportPath(previewDir, importPath);

    for (const node of ast.program.body) {
      if (node.type !== 'ImportDeclaration') continue;
      const sourceValue = node.source.value;
      if (typeof sourceValue !== 'string') continue;
      const normalizedSource = normalizeImportPath(previewDir, sourceValue);
      if (normalizedSource === normalizedTarget) {
        return true;
      }
    }
    return false;
  }

  /**
   * Check if a file already imports from the given path.
   * Normalizes relative paths to absolute for comparison.
   * Public for testing.
   */
  /**
   * Full regeneration from scratch — ignores existing file.
   * Reads all component sources, builds entries, generates.
   */
  async rebuild(componentPaths: string[]): Promise<string> {
    await this._awaitProviders();
    const previewPath = await this.getPreviewFilePath();
    const previewDir = dirname(previewPath);

    // HYP-546 — passed so buildEntry excludes SPA entry-root provider shells.
    const entryRootPaths = await this._getEntryRootComponentPaths();
    const entries: PreviewComponentEntry[] = [];
    for (const compPath of componentPaths) {
      const entry = await buildEntry(this.projectRoot, this.io, this.ssrMock?.framework, compPath, previewDir, {
        allowRouterShell: isExplicitWebAppShell(compPath),
        entryRootPaths,
        workspaceRoot: this.workspaceRoot,
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
    return ensureGitExclude(this.io, this.projectRoot, (dir) => this.findGitRoot(dir));
  }

  /**
   * Generate __canvas_preview_standalone__.tsx for Isolated mode (Tier 1).
   * Reads the existing __canvas_preview__.tsx and appends a createRoot bootstrap
   * that wraps CanvasPreview in the user's <PreviewWrapper> from .hyperide/preview.tsx.
   * No-op if __canvas_preview__.tsx does not exist yet.
   */
  async ensureStandaloneEntry(): Promise<void> {
    const previewPath = await this.getPreviewFilePath();
    return ensureStandaloneEntry(this.io, this.projectRoot, previewPath, () => this.ensureGitExclude());
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
