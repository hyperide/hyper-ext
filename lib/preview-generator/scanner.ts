/**
 * AST-based scanner for component source code.
 * Extracts Sample* exports, component names, and export styles.
 * Uses @babel/parser for reliable parsing (immune to comments/strings).
 */

import { parse } from '@babel/parser';

function parseSource(sourceCode: string) {
  return parse(sourceCode, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
    errorRecovery: true,
  });
}

const SAMPLE_RE = /^Sample[A-Z]/;

/** Scan source code for all `export const/function Sample*` exports */
export function scanSampleExports(sourceCode: string): string[] {
  const ast = parseSource(sourceCode);
  const results: string[] = [];

  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration' || !node.declaration) continue;
    const decl = node.declaration;

    if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier' && SAMPLE_RE.test(d.id.name)) {
          results.push(d.id.name);
        }
      }
    } else if (decl.type === 'FunctionDeclaration' && decl.id && SAMPLE_RE.test(decl.id.name)) {
      results.push(decl.id.name);
    }
  }

  return results;
}

export type ExportStyle = 'named' | 'default-named' | 'default-anonymous';

/**
 * Detect how the main component is exported.
 * - `default-named`: `export default function Button()` or `export default class Button`
 * - `default-anonymous`: `export default Button;` or `export default memo(Button)`
 * - `named`: `export function Button()` or `export const Button =`
 */
export function detectExportStyle(sourceCode: string, componentName: string): ExportStyle {
  const ast = parseSource(sourceCode);

  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const decl = node.declaration;

    // export default function Name / export default class Name
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === componentName) {
      return 'default-named';
    }

    // export default Name
    if (decl.type === 'Identifier' && decl.name === componentName) {
      return 'default-anonymous';
    }

    // export default memo(Name) / React.memo(Name) / forwardRef(Name) / styled(Name)
    if (decl.type === 'CallExpression') {
      const hasComponentArg = decl.arguments.some((arg) => arg.type === 'Identifier' && arg.name === componentName);
      if (hasComponentArg) return 'default-anonymous';
    }
  }

  return 'named';
}

/**
 * Extract the main component name from source code.
 *
 * Priority:
 * 1. `export default function Name` / `export default class Name`
 * 2. `export default Name` where Name is PascalCase
 * 2b. `export default memo(Name)` / `React.memo(Name)` / `forwardRef(Name)`
 * 3. First PascalCase named export (skip Sample*), including re-exports
 * 4. Fallback to filename (without extension)
 */
export function extractComponentName(sourceCode: string, fileName: string): string {
  const ast = parseSource(sourceCode);

  // 1–2b. Look at export default declaration
  for (const node of ast.program.body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const decl = node.declaration;

    // export default function Name / export default class Name
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
      return decl.id.name;
    }

    // export default Name
    if (decl.type === 'Identifier') {
      return decl.name;
    }

    // export default memo(Name) / React.memo(Name) / forwardRef(Name)
    if (decl.type === 'CallExpression') {
      const firstArg = decl.arguments[0];
      if (firstArg?.type === 'Identifier' && /^[A-Z]/.test(firstArg.name)) {
        return firstArg.name;
      }
    }
  }

  // 3. First PascalCase named export (skip Sample*), including re-exports
  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;

    // Re-exports: export { default as Button } from './...'
    for (const spec of node.specifiers) {
      if (spec.type === 'ExportSpecifier' && spec.exported.type === 'Identifier') {
        const name = spec.exported.name;
        if (/^[A-Z]/.test(name) && !name.startsWith('Sample')) {
          return name;
        }
      }
    }

    if (!node.declaration) continue;
    const decl = node.declaration;
    let name: string | undefined;

    if (decl.type === 'FunctionDeclaration' && decl.id) {
      name = decl.id.name;
    } else if (decl.type === 'ClassDeclaration' && decl.id) {
      name = decl.id.name;
    } else if (decl.type === 'VariableDeclaration') {
      const first = decl.declarations[0];
      if (first?.id.type === 'Identifier') {
        name = first.id.name;
      }
    }

    if (name && /^[A-Z]/.test(name) && !name.startsWith('Sample')) {
      return name;
    }
  }

  // 4. Filename fallback
  return fileName.replace(/\.[^.]+$/, '');
}

/** Escape regex metacharacters in a string */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
