/**
 * Import management utilities for JSX/TSX files
 *
 * Pure AST + path math operations. No filesystem access —
 * caller resolves absolute paths before calling.
 */

import * as nodePath from 'node:path';
import * as t from '@babel/types';

/**
 * Check if a name is already imported in the AST (named or default import).
 */
export function isImported(ast: t.File, name: string): boolean {
  return ast.program.body.some(
    (node) =>
      t.isImportDeclaration(node) &&
      node.specifiers.some(
        (spec) =>
          (t.isImportSpecifier(spec) && t.isIdentifier(spec.imported) && spec.imported.name === name) ||
          (t.isImportDefaultSpecifier(spec) && spec.local.name === name),
      ),
  );
}

/**
 * Calculate relative import path between two absolute file paths.
 * Strips extensions (.tsx, .ts, .jsx, .js) and ensures ./ prefix.
 */
export function resolveImportPath(targetFilePath: string, componentFilePath: string): string {
  const targetDir = nodePath.dirname(targetFilePath);
  let relativePath = nodePath.relative(targetDir, componentFilePath);

  // Remove file extension
  relativePath = relativePath.replace(/\.(tsx?|jsx?)$/, '');

  // Ensure starts with ./ or ../
  if (!relativePath.startsWith('.')) {
    relativePath = `./${relativePath}`;
  }

  // Normalize to forward slashes (Windows compat)
  return relativePath.replace(/\\/g, '/');
}

/**
 * Infer the import directory from existing PascalCase named imports.
 * Looks at existing `import { PascalName } from './some/path'` and extracts the directory.
 *
 * Fallback: '../components' — a blind guess. Prefer passing componentFilePath
 * to ensureImport() so resolveImportPath() calculates the real path.
 */
export function inferImportDir(ast: t.File): string {
  for (const node of ast.program.body) {
    if (
      t.isImportDeclaration(node) &&
      node.specifiers.some(
        (spec) => t.isImportSpecifier(spec) && t.isIdentifier(spec.imported) && /^[A-Z]/.test(spec.imported.name),
      ) &&
      t.isStringLiteral(node.source)
    ) {
      const lastSlash = node.source.value.lastIndexOf('/');
      if (lastSlash > 0) {
        return node.source.value.substring(0, lastSlash);
      }
    }
  }

  return '../components';
}

/**
 * Ensure a named import for componentName exists in the AST.
 *
 * If componentFilePath is provided, calculates the relative import path.
 * If workspaceRoot is provided, resolves relative componentFilePath to absolute.
 * Otherwise, infers from existing imports.
 *
 * Inserts after the last existing import declaration.
 */
export function ensureImport(
  ast: t.File,
  opts: {
    componentName: string;
    targetFilePath: string;
    componentFilePath?: string;
    workspaceRoot?: string;
  },
): void {
  const { componentName, targetFilePath, componentFilePath, workspaceRoot } = opts;

  if (isImported(ast, componentName)) return;

  // Calculate import path
  let importPath: string;

  if (componentFilePath) {
    // Resolve to absolute if relative
    const absoluteComponentPath = nodePath.isAbsolute(componentFilePath)
      ? componentFilePath
      : nodePath.join(workspaceRoot || '', componentFilePath);

    importPath = resolveImportPath(targetFilePath, absoluteComponentPath);
  } else {
    // Fallback: infer from existing component imports (may guess wrong)
    const inferredDir = inferImportDir(ast);
    importPath = `${inferredDir}/${componentName}`;
    console.warn(`[ensureImport] No componentFilePath for "${componentName}", inferred: "${importPath}"`);
  }

  // Find last import index
  let lastImportIndex = -1;
  for (let i = 0; i < ast.program.body.length; i++) {
    if (t.isImportDeclaration(ast.program.body[i])) {
      lastImportIndex = i;
    }
  }

  // Create and insert import declaration
  const importDeclaration = t.importDeclaration(
    [t.importSpecifier(t.identifier(componentName), t.identifier(componentName))],
    t.stringLiteral(importPath),
  );

  ast.program.body.splice(lastImportIndex + 1, 0, importDeclaration);
}
