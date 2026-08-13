import { resolve } from 'node:path';
import { pathCaseKey } from './preview-ast-helpers';

export function buildCanonicalPathMap(paths: string[]): Map<string, string> {
  const canonicalPaths = new Map<string, string>();
  for (const path of paths) {
    canonicalPaths.set(pathCaseKey(path), path);
  }
  return canonicalPaths;
}

export function canonicalizeComponentPath(componentPath: string, canonicalPaths: Map<string, string>): string {
  return canonicalPaths.get(pathCaseKey(componentPath)) ?? componentPath;
}

export function hasPathCaseMismatch(componentPath: string, canonicalPaths: Map<string, string>): boolean {
  const canonical = canonicalPaths.get(pathCaseKey(componentPath));
  return canonical !== undefined && canonical !== componentPath;
}

export function normalizeImportPath(fromDir: string, importPath: string): string {
  if (importPath.startsWith('.')) {
    return resolve(fromDir, importPath).replace(/\.(tsx?|jsx?)$/, '');
  }
  return importPath;
}
