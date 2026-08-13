/**
 * @file Preview validation utilities
 *
 * Accessed via: PreviewFileManager.ensureComponent (isValidTypeScript check)
 *   PreviewFileManager constructor (parseExistingPreview for salvage)
 */

import { parse } from '@babel/parser';
import type { PreviewComponentEntry } from './generator';
import {
  getIdentName,
  getStringValue,
  iterateObjectProperties,
  iterateVarDeclarators,
  stripExtension,
  unwrapToObject,
} from './preview-ast-helpers';

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
 * Extract the component paths in a generated preview's `appEntrySet` (the set of paths
 * previewed AS AN APP). Returns the literal keys exactly as written (with extension). An
 * empty set — or a file with no appEntrySet (an older generator) — yields an empty set.
 * Used to detect an app-mode toggle on the `ensureComponent` fast path.
 */
export function parseAppEntrySet(content: string): Set<string> {
  const result = new Set<string>();
  let ast: ReturnType<typeof parse>;
  try {
    ast = parse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'], errorRecovery: true });
  } catch {
    return result;
  }
  for (const decl of iterateVarDeclarators(ast.program.body)) {
    if (decl.id.type !== 'Identifier' || decl.id.name !== 'appEntrySet') continue;
    // `new Set<string>([ '<path>', ... ])` — read the array argument's string-literal elements.
    const init = decl.init;
    if (!init || init.type !== 'NewExpression') continue;
    const arg = init.arguments[0];
    if (!arg || arg.type !== 'ArrayExpression') continue;
    for (const el of arg.elements) {
      const value = el ? getStringValue(el) : null;
      if (value) result.add(value);
    }
  }
  return result;
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
          sampleAliasToPath.set(value, key);
          if (!pathToName.has(key)) {
            pathToName.set(key, stripExtension(key.split('/').pop() ?? key));
          }
        } else if (!pathToName.has(key)) {
          pathToName.set(key, stripExtension(key.split('/').pop() ?? key));
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

  for (const [, compPath] of sampleAliasToPath) {
    const existing = pathToSamples.get(compPath);
    if (!existing || existing.length === 0) {
      pathToSamples.set(compPath, ['SampleDefault']);
    }
  }

  if (pathToName.size === 0) return [];

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

  const entries: PreviewComponentEntry[] = [];

  for (const [compPath, compName] of pathToName) {
    let importPath = aliasToImportPath.get(compName) ?? '';

    if (!importPath) {
      const compBase = stripExtension(compPath.split('/').pop() ?? compPath);
      for (const [, ip] of aliasToImportPath) {
        if (ip === compBase || ip.endsWith(`/${compBase}`)) {
          importPath = ip;
          break;
        }
      }
    }

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
