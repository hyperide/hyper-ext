/**
 * Orchestrator for deterministic __canvas_preview__.tsx generation.
 * Uses FileIO abstraction for Node.js / VS Code portability.
 */

import { basename, dirname, join, relative } from 'node:path';
import { parse } from '@babel/parser';
import type { FileIO } from '../ast/file-io';
import { generatePreviewContent, type PreviewComponentEntry } from './generator';
import { detectExportStyle, type ExportStyle, extractComponentName, scanSampleExports } from './scanner';

export interface PreviewFileManagerConfig {
  projectRoot: string;
  io: FileIO;
  isNextPagesRouter?: boolean;
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
  return node?.type === 'Identifier' ? node.name : null;
}

function stripExtension(name: string): string {
  return name.replace(/\.\w+$/, '');
}

export class PreviewFileManager {
  private projectRoot: string;
  private io: FileIO;
  private isNextPagesRouter: boolean;

  constructor(config: PreviewFileManagerConfig) {
    this.projectRoot = config.projectRoot;
    this.io = config.io;
    this.isNextPagesRouter = config.isNextPagesRouter ?? false;
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
   * Reads existing file, merges new components, regenerates deterministically.
   * Returns the final file content.
   */
  async ensureComponent(componentPaths: string[]): Promise<string> {
    const previewPath = await this.getPreviewFilePath();
    const previewDir = dirname(previewPath);

    // Read existing preview file (if any)
    let existingEntries: PreviewComponentEntry[] = [];
    try {
      const existingContent = await this.io.readFile(previewPath);
      existingEntries = parseExistingPreview(existingContent);

      // Check if all requested components are already registered
      const existingPaths = new Set(existingEntries.map((e) => e.componentPath));
      const allPresent = componentPaths.every((p) => existingPaths.has(p));
      if (allPresent) {
        return existingContent;
      }
    } catch {
      // File doesn't exist yet — that's fine
    }

    // Build entries for new components
    const existingPathSet = new Set(existingEntries.map((e) => e.componentPath));
    const newEntries: PreviewComponentEntry[] = [];

    for (const compPath of componentPaths) {
      if (existingPathSet.has(compPath)) continue;

      const entry = await this.buildEntry(compPath, previewDir);
      if (entry) newEntries.push(entry);
    }

    // Merge existing + new
    const allEntries = [...existingEntries, ...newEntries];

    if (allEntries.length === 0) {
      throw new PreviewGenerationError('No valid components to include in preview');
    }

    // Generate content
    const content = generatePreviewContent(allEntries, {
      isNextPagesRouter: this.isNextPagesRouter,
    });

    // Validate TypeScript
    const valid = await isValidTypeScript(content);
    if (!valid) {
      throw new PreviewGenerationError('Generated preview code failed TypeScript validation');
    }

    // Write file
    await this.io.writeFile(previewPath, content);
    return content;
  }

  /**
   * Full regeneration from scratch — ignores existing file.
   * Reads all component sources, builds entries, generates.
   */
  async rebuild(componentPaths: string[]): Promise<string> {
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

    const absolutePath = join(this.projectRoot, componentPath);

    let sourceCode: string;
    try {
      sourceCode = await this.io.readFile(absolutePath);
    } catch {
      // Component file unreadable — skip silently
      console.warn(`[PreviewFileManager] Could not read component: ${componentPath}`);
      return null;
    }

    const fileName = basename(componentPath);
    let componentName: string;
    let sampleExports: string[];
    let exportStyle: ExportStyle;
    try {
      componentName = extractComponentName(sourceCode, fileName);
      sampleExports = scanSampleExports(sourceCode);
      exportStyle = detectExportStyle(sourceCode, componentName);
    } catch {
      // Source has syntax errors (e.g. mid-edit) — fall back to filename-based entry
      console.warn(`[PreviewFileManager] Could not parse component: ${componentPath}`);
      componentName = fileName.replace(/\.[^.]+$/, '');
      sampleExports = [];
      exportStyle = 'named';
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
}
