/**
 * @file Deterministic __canvas_preview__.tsx generation and preview file management.
 *
 * Accessed via: VS Code extension preview panel — component selected in explorer;
 *               SaaS canvas — component selected, triggers ensurePreviewFiles
 * Assumptions: FileIO abstraction ensures portability between Node.js and VS Code extension;
 *              _writeIfSafe never overwrites user files (P3-3 invariant)
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { basename, dirname, join, relative, resolve } from 'node:path';
import { parse } from '@babel/parser';
import { builders as b, type namedTypes } from 'ast-types';
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
import { generatePreviewContent, type PreviewComponentEntry, type ProviderWrapConfig } from './generator';
import { detectExportStyle, type ExportStyle, extractComponentName, scanSampleExports } from './scanner';

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

export interface PreviewFileManagerConfig {
  projectRoot: string;
  io: FileIO;
  isNextPagesRouter?: boolean;
  /** Wrap preview components with project-specific providers (theme, safe area, etc.) */
  providerWrap?: ProviderWrapConfig;
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
        const value = getIdentName(prop.value);
        if (key && value) {
          sampleAliasToPath.set(value, key);
          if (!pathToName.has(key)) {
            pathToName.set(key, stripExtension(basename(key)));
          }
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

/** Attribute shape of a recast JSX element (used in revertRouterPatch) */
type RouteAttr = { name?: { name?: string }; value?: { value?: string } };

/** Recast JSX element shape for <Route> nodes (used in revertRouterPatch) */
type RouteEl = { openingElement: { name: { name?: string }; attributes: RouteAttr[] } };

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
  private _providerWrapPromise: Promise<void> | null = null;

  constructor(config: PreviewFileManagerConfig) {
    this.projectRoot = config.projectRoot;
    this.io = config.io;
    this.isNextPagesRouter = config.isNextPagesRouter ?? false;
    this.providerWrap = config.providerWrap;
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

  /** Block until provider detection completes (no-op if none pending). */
  private async _awaitProviders(): Promise<void> {
    if (this._providerWrapPromise) await this._providerWrapPromise;
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

    // Default to src/
    return join(this.projectRoot, 'src/__canvas_preview__.tsx'); // nosemgrep: path-join-resolve-traversal
  }

  /**
   * Ensure given component paths are registered in the preview file.
   * - File missing (init): scan ALL project components and generate once with all imports.
   * - File exists, fast path: AST check. All present → no write. Any missing → minimal AST insert.
   * Returns the final file content.
   */
  async ensureComponent(componentPaths: string[]): Promise<string> {
    await this._awaitProviders();
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
      // Validate the existing file for stale entries: non-PascalCase names, Next.js App Router
      // reserved files (layout.tsx exports metadata — breaks Client Component chain), or
      // @hyperide-managed files (extension's own generated route files).
      const existingEntries = parseExistingPreview(existingContent);
      const isStale = (e: { componentName: string; componentPath: string }) =>
        !/^[A-Z]/.test(e.componentName) || NEXTJS_APP_ROUTER_RESERVED.has(basename(e.componentPath));
      if (!existingEntries.some(isStale)) return existingContent;

      // Stale entries found — regenerate excluding reserved files
      const cleanPaths = existingEntries.filter((e) => !isStale(e)).map((e) => e.componentPath);
      return this._initPreviewFile(previewPath, previewDir, [...new Set([...cleanPaths, ...componentPaths])]);
    }

    // Full regen when new components are added — ensures componentRegistry and sampleRenderMap
    // are updated alongside imports. Preserve existing components by parsing the registry via AST,
    // excluding reserved filenames that must not be in the Client Component bundle.
    const existingEntries = parseExistingPreview(existingContent);
    const existingPaths = existingEntries
      .filter((e) => !NEXTJS_APP_ROUTER_RESERVED.has(basename(e.componentPath)))
      .map((e) => e.componentPath);
    const allPaths = [...new Set([...existingPaths, ...componentPaths])];
    return this._initPreviewFile(previewPath, previewDir, allPaths);
  }

  /** Init: scan all TSX/TS files and generate a complete preview file. */
  private async _initPreviewFile(previewPath: string, previewDir: string, requestedPaths: string[]): Promise<string> {
    // Build entries for explicitly requested paths first
    const requestedEntries: PreviewComponentEntry[] = [];
    for (const compPath of requestedPaths) {
      const entry = await this.buildEntry(compPath, previewDir);
      if (entry) requestedEntries.push(entry);
    }

    // Supplement with all other components discovered in project (init-time full scan).
    // Always runs so that stale-entry cleanup can salvage real components even when
    // all explicitly requested paths are non-component files (e.g. only main.tsx passed).
    const discoveredPaths = await this._scanAllComponents();
    const requestedPathSet = new Set(requestedPaths);
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
    return content;
  }

  /**
   * Scan all TSX component files in the project via io.listFiles (if available).
   * Falls back to empty array if listFiles is not supported.
   */
  private async _scanAllComponents(): Promise<string[]> {
    if (!this.io.listFiles) return [];

    const srcDir = join(this.projectRoot, 'src');
    let allFiles: string[] = [];
    try {
      allFiles = await this.io.listFiles(srcDir, ['.tsx', '.ts']);
    } catch {
      return [];
    }

    // Exclude non-component files (__canvas_preview__, index, etc.)
    return allFiles
      .filter((f) => {
        const name = basename(f);
        return (
          !name.startsWith('__') &&
          !name.startsWith('index.') &&
          (f.endsWith('.tsx') || f.endsWith('.ts')) &&
          /^[A-Z]/.test(name) // PascalCase = component
        );
      })
      .map((abs) => relative(this.projectRoot, abs));
  }

  /**
   * Check if a file already imports from the given path.
   * Normalizes relative paths to absolute for comparison.
   * Public for testing.
   */
  async _hasImport(previewFilePath: string, importPath: string): Promise<boolean> {
    const source = await this.io.readFile(previewFilePath);
    const ast = parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] });
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
      const entry = await this.buildEntry(compPath, previewDir);
      if (entry) entries.push(entry);
    }

    if (entries.length === 0) {
      throw new PreviewGenerationError('No valid components to include in preview');
    }

    const content = generatePreviewContent(entries, {
      isNextPagesRouter: this.isNextPagesRouter,
      providerWrap: this.providerWrap,
    });

    const valid = await isValidTypeScript(content);
    if (!valid) {
      throw new PreviewGenerationError('Generated preview code failed TypeScript validation');
    }

    await this.io.writeFile(previewPath, content);
    return content;
  }

  /** Build a PreviewComponentEntry by reading the component source */
  private async buildEntry(componentPath: string, previewDir: string): Promise<PreviewComponentEntry | null> {
    // Guard against path traversal — componentPath must stay within projectRoot
    if (componentPath.includes('..')) {
      console.warn(`[PreviewFileManager] Skipping suspicious path: ${componentPath}`);
      return null;
    }

    // Exclude Next.js App Router special files — they export metadata / use special props
    // that conflict with being imported as Client Components inside __canvas_preview__.tsx.
    const fileName = basename(componentPath);
    if (NEXTJS_APP_ROUTER_RESERVED.has(fileName)) {
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
    let componentName: string;
    let sampleExports: string[];
    let exportStyle: ExportStyle;
    try {
      componentName = extractComponentName(sourceCode, fileName);
      sampleExports = scanSampleExports(sourceCode);
      exportStyle = detectExportStyle(sourceCode, componentName);
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

    return {
      componentPath,
      componentName,
      exportStyle,
      sampleExports,
      importPath,
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
   * Returns 'ok' | 'unsupported' | 'needs-patch'.
   */
  async ensurePreviewFiles(): Promise<'ok' | 'unsupported' | 'needs-patch'> {
    const detection = await detectFramework(this.projectRoot, this.io);
    const { framework } = detection;

    if (framework === 'unknown') return 'unsupported';

    if (framework === 'webpack' || framework === 'vite-spa-jsx-router') {
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

    await this._writeIfSafe(paths.routeFile, generateRouteFileContent(framework, importPath));

    if (paths.layoutFile) {
      await this._writeIfSafe(paths.layoutFile, generateBlankLayoutContent());
    }

    await this.ensureGitExclude();

    return 'ok';
  }

  /**
   * Add HyperIDE-generated files to .git/info/exclude (local, not committed).
   * Prevents __canvas_preview__.tsx and route files from appearing in `git status`.
   * No-op if entries are already present or if .git directory doesn't exist.
   */
  async ensureGitExclude(): Promise<void> {
    const excludePath = join(this.projectRoot, '.git/info/exclude');
    const entries = [
      '# HyperIDE — generated preview files',
      'src/__canvas_preview__.tsx',
      'src/__canvas_preview_standalone__.tsx',
      '**/test-preview/',
      '**/test-preview.tsx',
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
      // Not a git repo, or .git is a file (worktrees) — silently skip
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

    const bootstrap = [
      '',
      '// @hyperide-managed',
      "import { createRoot } from 'react-dom/client';",
      `import { PreviewWrapper } from '${wrapperImportPath}';`,
      '',
      "const root = document.getElementById('root');",
      'if (root) {',
      '  createRoot(root).render(',
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
   */
  private async _writeIfSafe(filePath: string, content: string): Promise<void> {
    try {
      const existing = await this.io.readFile(filePath);
      if (!existing.includes('@hyperide-managed')) {
        console.warn(`[PreviewFileManager] Skipping ${filePath} — exists without @hyperide-managed marker`);
        return;
      }
      // Already managed — skip (idempotent)
      return;
    } catch {
      // File doesn't exist — safe to write
    }
    await this.io.mkdir?.(dirname(filePath));
    await this.io.writeFile(filePath, content);
  }

  /**
   * Inject <Route path="/test-preview" element={<CanvasPreview />} /> into <Routes> JSX.
   * Uses recast for AST editing (preserves formatting). Tags with @hyperide-managed.
   * Only for Vite SPA JSX router (App Shell mode, no wrapper).
   */
  async patchRouterConfig(routerFilePath: string): Promise<void> {
    const source = await this.io.readFile(routerFilePath);

    // Idempotency check — already patched
    if (source.includes('@hyperide-managed')) return;

    const ast = recast.parse(source, { parser: RECAST_PARSER });

    let patched = false;
    recast.visit(ast, {
      visitJSXElement(path) {
        const el = path.node;
        if (el.openingElement.name.type === 'JSXIdentifier' && el.openingElement.name.name === 'Routes') {
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
          (newRoute as { comments?: unknown[] }).comments = [
            { type: 'CommentLine', value: ' @hyperide-managed', leading: false, trailing: true },
          ];
          if (!el.children) el.children = [];
          el.children.push(b.jsxText('\n        '), newRoute, b.jsxText('\n      '));
          patched = true;
          return false;
        }
        this.traverse(path);
      },
    });

    if (!patched) {
      console.warn('[PreviewFileManager] Could not find <Routes> in', routerFilePath);
      return;
    }

    // Add CanvasPreview import at top — path relative to router file directory
    const previewPath = await this.getPreviewFilePath();
    const routerDir = dirname(routerFilePath);
    let importPath = relative(routerDir, previewPath).replace(/\.\w+$/, '');
    if (!importPath.startsWith('.')) importPath = `./${importPath}`;

    const previewImport = `import CanvasPreview from '${importPath}'; // @hyperide-managed\n`;
    const output = recast.print(ast).code;
    await this.io.writeFile(routerFilePath, previewImport + output);
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
            if (child.type !== 'JSXElement') return true;
            // Remove Route elements with path="/test-preview"
            const childEl = child as RouteEl;
            if (childEl.openingElement.name.name !== 'Route') return true;
            return !childEl.openingElement.attributes.some(
              (attr) => attr.name?.name === 'path' && attr.value?.value === '/test-preview',
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
  async patchEntryFile(entryFilePath: string, importTarget = './__canvas_preview__'): Promise<void> {
    const source = await this.io.readFile(entryFilePath);
    if (source.includes('@hyperide-managed')) return;

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
          const createRootExpr = JSON.parse(JSON.stringify(callExpr.callee.object));
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
      console.warn('[PreviewFileManager] Could not find createRoot().render() in entry file', entryFilePath);
      return;
    }

    await this.io.writeFile(entryFilePath, recast.print(ast).code);
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

    await this.io.writeFile(filePath, recast.print(ast).code);
  }
}
