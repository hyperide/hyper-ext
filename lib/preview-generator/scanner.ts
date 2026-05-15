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
    if (node.type !== 'ExportNamedDeclaration') continue;

    if (!node.declaration) {
      // Barrel re-exports: export { SampleFoo } or export { SampleFoo } from './samples'
      // Skip type-only export statements: export type { SampleFoo }
      if (node.exportKind === 'type') continue;
      for (const spec of node.specifiers) {
        if (spec.type === 'ExportSpecifier' && spec.exported.type === 'Identifier') {
          // Skip inline type specifiers: export { type SampleFoo }
          if (spec.exportKind === 'type') continue;
          if (SAMPLE_RE.test(spec.exported.name)) results.push(spec.exported.name);
        }
      }
      continue;
    }

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

/** Scan source code for exported renderable component names. */
export function scanRenderableExportNames(sourceCode: string): string[] {
  const ast = parseSource(sourceCode);
  const results: string[] = [];

  const push = (name: string) => {
    if (!/^[A-Z]/.test(name) || name.startsWith('Sample')) return;
    if (!results.includes(name)) results.push(name);
  };

  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    if (node.exportKind === 'type') continue;

    if (!node.source) {
      for (const spec of node.specifiers) {
        if (spec.type !== 'ExportSpecifier') continue;
        if (spec.exportKind === 'type') continue;
        if (spec.exported.type === 'Identifier') push(spec.exported.name);
      }
    }

    if (!node.declaration) continue;
    const decl = node.declaration;

    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id) {
      push(decl.id.name);
      continue;
    }

    if (decl.type !== 'VariableDeclaration') continue;
    for (const candidate of decl.declarations) {
      if (candidate.id.type === 'Identifier' && isRenderableVariable(candidate)) {
        push(candidate.id.name);
      }
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
    if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
      if (decl.id?.name === componentName) return 'default-named';
      if (!decl.id) return 'default-anonymous';
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
    if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
      return decl.id?.name ?? fileName.replace(/\.[^.]+$/, '');
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
      if (spec.type !== 'ExportSpecifier') continue;
      if (node.exportKind === 'type' || spec.exportKind === 'type') continue;
      if (spec.exported.type === 'Identifier') {
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
      for (const candidate of decl.declarations) {
        if (candidate.id.type === 'Identifier' && isRenderableVariable(candidate)) {
          name = candidate.id.name;
          break;
        }
      }
    }

    if (name && /^[A-Z]/.test(name) && !name.startsWith('Sample')) {
      return name;
    }
  }

  // 4. Filename fallback — strip all extensions so App.web.tsx → App, not App.web
  return fileName.replace(/(\.[^.]+)+$/, '');
}

type VariableDeclarationNode = ReturnType<typeof parseSource>['program']['body'][number];
type VariableDeclaratorNode = Extract<
  Extract<VariableDeclarationNode, { type: 'ExportNamedDeclaration' }>['declaration'],
  { type: 'VariableDeclaration' }
>['declarations'][number];

function isRenderableVariable(declaration: VariableDeclaratorNode): boolean {
  const init = declaration.init;
  if (!init) return false;
  if (init.type === 'ArrowFunctionExpression' || init.type === 'FunctionExpression') return true;
  if (init.type === 'Identifier' || init.type === 'MemberExpression') return true;
  if (init.type === 'TaggedTemplateExpression') return true;
  if (init.type !== 'CallExpression') return false;
  return !isCreateContextCall(init);
}

export function hasComponentExport(sourceCode: string, componentName: string): boolean {
  const ast = parseSource(sourceCode);

  for (const node of ast.program.body) {
    if (node.type === 'ExportDefaultDeclaration') {
      const decl = node.declaration;
      if (decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') {
        return !decl.id || decl.id.name === componentName;
      }
      if (decl.type === 'Identifier') return decl.name === componentName;
      if (decl.type === 'CallExpression') {
        return decl.arguments.some((arg) => arg.type === 'Identifier' && arg.name === componentName);
      }
    }

    if (node.type !== 'ExportNamedDeclaration') continue;
    if (node.exportKind === 'type') continue;

    for (const spec of node.specifiers) {
      if (spec.type !== 'ExportSpecifier') continue;
      if (spec.exportKind === 'type') continue;
      if (spec.exported.type === 'Identifier' && spec.exported.name === componentName) return true;
    }

    if (!node.declaration) continue;
    const decl = node.declaration;
    if ((decl.type === 'FunctionDeclaration' || decl.type === 'ClassDeclaration') && decl.id?.name === componentName) {
      return true;
    }
    if (decl.type !== 'VariableDeclaration') continue;
    for (const candidate of decl.declarations) {
      if (
        candidate.id.type === 'Identifier' &&
        candidate.id.name === componentName &&
        isRenderableVariable(candidate)
      ) {
        return true;
      }
    }
  }

  return false;
}

function isCreateContextCall(expression: Extract<VariableDeclaratorNode['init'], { type: 'CallExpression' }>): boolean {
  const callee = expression.callee;
  if (callee.type === 'Identifier') return callee.name === 'createContext';
  if (callee.type !== 'MemberExpression') return false;
  const property = callee.property;
  return property.type === 'Identifier' && property.name === 'createContext';
}

// MemoryRouter is intentionally excluded: it is a testing/in-memory router used
// in SampleDefault wrappers, not a production app-shell router. Including it
// would falsely exclude previewable components that wrap their samples in
// MemoryRouter for isolated rendering.
const ROUTER_SHELL_IMPORTS: ReadonlySet<string> = new Set([
  'BrowserRouter',
  'HashRouter',
  'NavigationContainer',
  'StaticRouter',
]);

const ROUTER_SHELL_SOURCES = new Set(['react-router-dom', 'react-router-dom/server', 'react-router']);

const REACT_NAVIGATION_SOURCES = new Set([
  '@react-navigation/bottom-tabs',
  '@react-navigation/drawer',
  '@react-navigation/material-bottom-tabs',
  '@react-navigation/material-top-tabs',
  '@react-navigation/native',
  '@react-navigation/native-stack',
  '@react-navigation/stack',
]);

/**
 * Detect whether the file is a router application shell — a file that imports
 * a top-level routing container or navigator factory.
 * Such files set up routing context for the whole app and cause TDZ/native
 * module failures in the preview registry when co-imported with the pages they wrap.
 */
export function detectRouterShell(sourceCode: string): boolean {
  const ast = parseSource(sourceCode);
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.importKind === 'type') continue;
    const source = node.source.value as string;
    if (!ROUTER_SHELL_SOURCES.has(source) && !REACT_NAVIGATION_SOURCES.has(source)) continue;
    for (const spec of node.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.importKind === 'type') continue;
      const name = spec.imported.type === 'Identifier' ? spec.imported.name : null;
      if (name && ROUTER_SHELL_IMPORTS.has(name)) return true;
      if (REACT_NAVIGATION_SOURCES.has(source) && name && /^create[A-Z].*Navigator$/.test(name)) return true;
    }
  }
  return false;
}

/** Escape regex metacharacters in a string */
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export type SSRHook = 'useLoaderData' | 'useRouteLoaderData';

const SSR_HOOK_SOURCE = '@remix-run/react';
const SSR_HOOKS: ReadonlySet<string> = new Set<SSRHook>(['useLoaderData', 'useRouteLoaderData']);

/**
 * Detect SSR data hooks imported from Remix in the given source code.
 * Returns the set of hook names found (empty if none).
 * Only inspects import declarations — does not traverse call sites.
 */
export function detectSSRHooks(sourceCode: string): Set<SSRHook> {
  const ast = parseSource(sourceCode);
  const found = new Set<SSRHook>();

  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.source.value !== SSR_HOOK_SOURCE) continue;

    for (const spec of node.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      const name = spec.imported.type === 'Identifier' ? spec.imported.name : null;
      if (name && SSR_HOOKS.has(name)) {
        found.add(name as SSRHook);
      }
    }
  }

  return found;
}
