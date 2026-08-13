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

type ProgramNode = ReturnType<typeof parseSource>['program']['body'][number];
type FunctionLikeNode = Extract<ProgramNode, { type: 'FunctionDeclaration' }>;
type ParamNode = FunctionLikeNode['params'][number];
type AssignmentPatternNode = Extract<ParamNode, { type: 'AssignmentPattern' }>;
type PatternNode = ParamNode | AssignmentPatternNode['left'];

/**
 * Extract the prop names a component statically destructures from its first
 * parameter.
 *
 * A prop a component DESTRUCTURES is one it consumes by name — it won't forward
 * that key via `{...rest}` onto a host DOM node. An UNDECLARED key can only leak
 * (spread into `{...rest}` → junk DOM attribute). Callers use this to filter the
 * generic preview fallback-props blob down to keys the component actually reads.
 *
 * Semantics (the floor is "never under-provision"):
 * - Returns the destructured key names when the first param is a statically
 *   visible ObjectPattern (rest element is ignored).
 * - Returns `[]` only for a genuine empty / rest-only destructure — the
 *   component wants nothing from the blob.
 * - Returns `null` ("unknown — do NOT filter, spread the full blob") when props
 *   are not a statically-visible object-destructure: member-access
 *   (`function C(props) { props.store }`), HOC / forwardRef / memo-wrapped, no
 *   params, or the component can't be resolved.
 */
export function extractDeclaredPropNames(
  sourceCode: string,
  componentName: string,
  exportStyle?: ExportStyle,
): string[] | null {
  const ast = parseSource(sourceCode);
  // HYP-465 — the scanned function MUST be the one the generated preview import
  // binds to (and thus the one that actually renders), not merely the export
  // whose name matches `componentName`. For `default-anonymous`, the import
  // binds to the DEFAULT export (`import Alias from '…'`), which may diverge
  // from the same-named named export: e.g.
  //   export function Card({ title, value, label }) { … }   // named
  //   export default function (props) { return <div {...props} /> }  // rendered
  // `extractComponentName` → "Card", but the rendered component is the anonymous
  // default that spreads `props` onto a host <div>. Scanning Card here would
  // whitelist [title,value,label] and let those keys leak onto that <div>.
  // Resolve via the default export so scanned == rendered.
  const fn =
    exportStyle === 'default-anonymous'
      ? findDefaultExportFunction(ast.program.body)
      : findComponentFunction(ast.program.body, componentName);
  if (!fn) return null;
  return propNamesFromFirstParam(fn.params[0]);
}

/**
 * Resolve `componentName` to its function/arrow node. Returns null when the
 * binding is anything other than a plain function or arrow (e.g. an HOC call
 * like `forwardRef(...)` / `memo(...)` / `styled(...)`), matching the
 * "never under-provision" floor.
 */
function findComponentFunction(body: ProgramNode[], componentName: string): { params: ParamNode[] } | null {
  for (const node of body) {
    // export default function Name() {}
    if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'FunctionDeclaration') {
      const decl = node.declaration;
      if (!decl.id || decl.id.name === componentName) return { params: decl.params };
    }

    // export function Name() {}  /  function Name() {}
    if (node.type === 'FunctionDeclaration' && node.id?.name === componentName) {
      return { params: node.params };
    }
    if (
      node.type === 'ExportNamedDeclaration' &&
      node.declaration?.type === 'FunctionDeclaration' &&
      node.declaration.id?.name === componentName
    ) {
      return { params: node.declaration.params };
    }

    // const Name = (...) => {}  /  const Name = function () {}  (with or without export)
    const varDecl =
      node.type === 'VariableDeclaration'
        ? node
        : node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration'
          ? node.declaration
          : null;
    if (varDecl) {
      for (const d of varDecl.declarations) {
        if (d.id.type !== 'Identifier' || d.id.name !== componentName) continue;
        const init = d.init;
        if (init?.type === 'ArrowFunctionExpression' || init?.type === 'FunctionExpression') {
          return { params: init.params };
        }
        // CallExpression init (forwardRef/memo/styled/any HOC), Identifier
        // re-assignment, or anything else → not a statically-visible
        // destructure. Stop: never under-provision.
        return null;
      }
    }
  }
  return null;
}

/**
 * Resolve the function the DEFAULT export binds to — the export the generated
 * preview import (`import Alias from '…'`) actually renders for
 * `default-anonymous` files (HYP-465). Returns null (→ full blob, never
 * under-provision) when the default is not a statically-visible function with a
 * destructure-able first param:
 *
 * - `export default function (…) {}` / `export default function Name(…) {}`
 *   → that function's params.
 * - `export default Identifier` → resolve `Identifier` to its local
 *   function/arrow declaration (the named function re-exported as default), then
 *   use ITS params.
 * - `export default memo(X)` / `forwardRef(…)` / any CallExpression / anything
 *   else → null (HOC-wrapped; no statically-visible destructure).
 */
function findDefaultExportFunction(body: ProgramNode[]): { params: ParamNode[] } | null {
  for (const node of body) {
    if (node.type !== 'ExportDefaultDeclaration') continue;
    const decl = node.declaration;

    // export default function (…) {}  /  export default function Name(…) {}
    if (decl.type === 'FunctionDeclaration') {
      return { params: decl.params };
    }

    // export default Name; — resolve the referenced local function/arrow.
    if (decl.type === 'Identifier') {
      return findComponentFunction(body, decl.name);
    }

    // export default memo(X) / forwardRef(…) / styled(…) / arrow / anything else
    // → not a statically-visible destructure.
    return null;
  }
  return null;
}

/**
 * Collect destructured key names from a first parameter.
 * - ObjectPattern → ObjectProperty Identifier key names (RestElement skipped) → [] when rest/empty only.
 * - Identifier param (member-access props) → null.
 * - undefined (no params) → null.
 */
function propNamesFromFirstParam(param: ParamNode | undefined): string[] | null {
  if (!param) return null;

  // `({ ... }: Props)` — Babel wraps the pattern in the param directly; a type
  // annotation lives on the pattern, not a separate wrapper.
  const pattern = unwrapPattern(param);
  if (pattern?.type !== 'ObjectPattern') return null;

  const names: string[] = [];
  for (const prop of pattern.properties) {
    if (prop.type === 'ObjectProperty' && prop.key.type === 'Identifier') {
      names.push(prop.key.name);
    }
    // RestElement (`...rest`) is intentionally ignored — it forwards leftover
    // keys, but we only want the names the component reads explicitly.
  }
  return names;
}

/** Strip an `AssignmentPattern` default wrapper (`{ ... } = {}`) to reach the pattern. */
function unwrapPattern(param: ParamNode): PatternNode {
  if (param.type === 'AssignmentPattern') return param.left;
  return param;
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
// Single-signal app shells: importing any of these IS the app-shell signal on its own — they are
// top-level routing containers/navigators that only an app root mounts.
const ROUTER_SHELL_IMPORTS: ReadonlySet<string> = new Set([
  'BrowserRouter',
  'HashRouter',
  'NavigationContainer',
  'StaticRouter',
]);

// Data-router roots need TWO signals in the SAME file: the BROWSER config BUILDER
// (createBrowserRouter) AND a rendered `<RouterProvider>`. This is the react-router v6.4+ shape
// `const router = createBrowserRouter([...]); <RouterProvider router={router}/>`. Requiring both
// avoids two false positives an import-name-only check would hit:
//   - a config-only `router.tsx` that just `export const router = createBrowserRouter([...])` with
//     NO component to render (builder present, RouterProvider absent) — not a previewable root;
//   - a leaf whose SampleDefault wraps itself in `createMemoryRouter` + `<RouterProvider>`
//     (RouterProvider present, browser BUILDER absent — createMemoryRouter is deliberately excluded,
//     as MemoryRouter is above) — rendering it raw would drop the sample's router context.
//
// `createHashRouter` (and `HashRouter`) are deliberately NOT data-router-navigable: a hash router
// reads `location.hash`, but the app-preview driver navigates via `pushState`/`location.pathname`
// only, so the address bar could not drive a hash router. Marking them candidates would offer
// "preview as app" and then fail to navigate. Hash-route navigation is a deferred follow-up.
const DATA_ROUTER_BUILDERS: ReadonlySet<string> = new Set(['createBrowserRouter']);
const ROUTER_PROVIDER_IMPORT = 'RouterProvider';

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
  // The data-router signal needs BOTH a browser/hash builder and a RouterProvider in this file.
  let hasDataRouterBuilder = false;
  let hasRouterProvider = false;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.importKind === 'type') continue;
    const source = node.source.value as string;
    if (!ROUTER_SHELL_SOURCES.has(source) && !REACT_NAVIGATION_SOURCES.has(source)) continue;
    for (const spec of node.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.importKind === 'type') continue;
      const name = spec.imported.type === 'Identifier' ? spec.imported.name : null;
      if (!name) continue;
      if (ROUTER_SHELL_IMPORTS.has(name)) return true;
      if (REACT_NAVIGATION_SOURCES.has(source) && /^create[A-Z].*Navigator$/.test(name)) return true;
      if (DATA_ROUTER_BUILDERS.has(name)) hasDataRouterBuilder = true;
      if (name === ROUTER_PROVIDER_IMPORT) hasRouterProvider = true;
    }
  }
  // Data-router app root: builder + provider together (config-only files and MemoryRouter samples
  // each carry only one of the two, so neither is misclassified).
  if (hasDataRouterBuilder && hasRouterProvider) return true;
  return false;
}

// pushState-navigable web routers ONLY — the SUBSET of router shells the app-preview address bar
// can actually drive. The driver navigates via `pushState`/`location.pathname` + `popstate`, so:
//   - `BrowserRouter` and `createBrowserRouter`+`RouterProvider` (data router) ARE drivable;
//   - `HashRouter` reads `location.hash` (driver never touches it) → would offer "preview as app"
//     then fail to navigate;
//   - `StaticRouter` is non-navigable (SSR), `NavigationContainer`/React Navigation is native.
// Used to GATE app-mode candidacy (isAppEntryCandidate). NOTE: this is intentionally narrower than
// `detectRouterShell`, which stays broad for its OTHER job — excluding ALL router shells from the
// component registry to avoid TDZ/native-module failures.
const PUSHSTATE_ROUTER_SHELL_IMPORTS: ReadonlySet<string> = new Set(['BrowserRouter']);

export function detectPushStateRouterShell(sourceCode: string): boolean {
  const ast = parseSource(sourceCode);
  let hasDataRouterBuilder = false;
  let hasRouterProvider = false;
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.importKind === 'type') continue;
    const source = node.source.value as string;
    // Web react-router sources only — React Navigation (native) is never pushState-navigable here.
    if (!ROUTER_SHELL_SOURCES.has(source)) continue;
    for (const spec of node.specifiers) {
      if (spec.type !== 'ImportSpecifier') continue;
      if (spec.importKind === 'type') continue;
      const name = spec.imported.type === 'Identifier' ? spec.imported.name : null;
      if (!name) continue;
      if (PUSHSTATE_ROUTER_SHELL_IMPORTS.has(name)) return true;
      if (DATA_ROUTER_BUILDERS.has(name)) hasDataRouterBuilder = true;
      if (name === ROUTER_PROVIDER_IMPORT) hasRouterProvider = true;
    }
  }
  return hasDataRouterBuilder && hasRouterProvider;
}

/**
 * Detect whether a file is a PROVIDER application shell — it statically imports
 * one or more React context providers (a value/namespace import whose local name
 * ends in `Provider`) and composes them. This complements `detectRouterShell`:
 * a SPA `App.tsx` that wraps the app in `AuthProvider` / `QueryClientProvider` /
 * `FeatureFlagsProvider` is a shell, not a previewable component — rendering it
 * standalone fires the providers' consumer hooks (useAuth, useBootstrap, …)
 * OUTSIDE the surrounding bootstrap providers that `main.tsx` mounts, throwing
 * "useAuth must be used inside <AuthProvider>" and blanking the preview (HYP-546).
 *
 * Deliberately broad and used ONLY as the AND-narrowing companion to
 * `extractMountedRootImportSources` (the entry's createRoot target): a false
 * positive here can never wrongly exclude a non-entry-root component, only fail
 * to exclude one — the entry-root gate is the hard constraint. Type-only imports
 * are ignored so `import type { FooProvider }` does not trip it.
 */
export function detectProviderShell(sourceCode: string): boolean {
  const ast = parseSource(sourceCode);
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.importKind === 'type') continue;
    for (const spec of node.specifiers) {
      // Named import: `import { AuthProvider } from '…'` — match the imported name.
      if (spec.type === 'ImportSpecifier') {
        if (spec.importKind === 'type') continue;
        const name = spec.imported.type === 'Identifier' ? spec.imported.name : spec.local.name;
        if (name.endsWith('Provider')) return true;
        continue;
      }
      // Default / namespace import: `import Foo from '…'` / `import * as Foo` —
      // match the local binding name (e.g. a default-exported `AuthProvider`).
      if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
        if (spec.local.name.endsWith('Provider')) return true;
      }
    }
  }
  return false;
}

/**
 * Extract the set of RELATIVE import sources for components rendered inside any
 * `createRoot(...).render(<tree/>)` (or legacy `ReactDOM.render(<tree/>)`) call —
 * i.e. the entry file's mounted application shell and the local components it
 * composes around it (App + co-located providers).
 *
 * Used to identify the entry-root component so it can be excluded from the
 * previewable-component registry (HYP-546). Returns import-source strings exactly
 * as written (e.g. `./app/App`, `./App.tsx`); the caller resolves them to project
 * paths relative to the entry file's directory.
 *
 * Robustness notes:
 * - Recurses the FULL render JSX tree, so `<StrictMode><Providers><App/></…>` finds
 *   `App` even though the top element is `StrictMode`.
 * - Only collects components imported via a relative path (`./` or `../`). Bare
 *   module imports (StrictMode, QueryClientProvider from a package) drop out, and
 *   the `@hyperide-managed` preview branch — which renders a `CanvasPreviewComp`
 *   bound to a DYNAMIC `import('./__canvas_preview__')`, never a static import —
 *   contributes nothing, so a main.tsx already patched on disk is handled.
 */
export function extractMountedRootImportSources(entrySource: string): Set<string> {
  const ast = parseSource(entrySource);

  // Map JSX local component name → relative import source.
  const localToRelativeSource = new Map<string, string>();
  for (const node of ast.program.body) {
    if (node.type !== 'ImportDeclaration') continue;
    if (node.importKind === 'type') continue;
    const source = node.source.value as string;
    if (!source.startsWith('./') && !source.startsWith('../')) continue;
    for (const spec of node.specifiers) {
      if (spec.type === 'ImportDefaultSpecifier' || spec.type === 'ImportNamespaceSpecifier') {
        localToRelativeSource.set(spec.local.name, source);
      } else if (spec.type === 'ImportSpecifier') {
        if (spec.importKind === 'type') continue;
        localToRelativeSource.set(spec.local.name, source);
      }
    }
  }

  const sources = new Set<string>();
  if (localToRelativeSource.size === 0) return sources;

  // Walk every node, find createRoot(...).render(arg) / ReactDOM.render(arg, ...)
  // call expressions, and collect the relative-imported JSX element names in arg.
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as { type?: string } & Record<string, unknown>;
    if (node.type === 'CallExpression' && isRenderCall(node)) {
      const args = node.arguments as unknown[];
      if (args.length > 0) collectRelativeJsxComponents(args[0], localToRelativeSource, sources);
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
      visit(node[key]);
    }
  };
  visit(ast.program.body);

  return sources;
}

/** Match `createRoot(el).render(...)`, `root.render(...)`, or `ReactDOM.render(...)`. */
function isRenderCall(node: Record<string, unknown>): boolean {
  const callee = node.callee as { type?: string; property?: { type?: string; name?: string } } | undefined;
  if (!callee || callee.type !== 'MemberExpression') return false;
  return callee.property?.type === 'Identifier' && callee.property.name === 'render';
}

/** Collect local JSX element names present in `arg` that map to a relative import. */
function collectRelativeJsxComponents(
  arg: unknown,
  localToRelativeSource: Map<string, string>,
  out: Set<string>,
): void {
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    const node = value as { type?: string; name?: unknown } & Record<string, unknown>;
    if (node.type === 'JSXOpeningElement') {
      const name = node.name as { type?: string; name?: string } | undefined;
      if (name?.type === 'JSXIdentifier' && name.name) {
        const source = localToRelativeSource.get(name.name);
        if (source) out.add(source);
      }
    }
    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'range') continue;
      visit(node[key]);
    }
  };
  visit(arg);
}

/**
 * Detect compound component siblings exported from the same file.
 *
 * A name qualifies when it:
 * - starts with mainComponentName as a prefix (AlertTitle for Alert, CardHeader for Card)
 * - is not the main component itself
 * - is not a Sample* export
 * - is not type-only
 * - is locally defined (specifiers with `from '…'` are cross-file barrel re-exports and excluded)
 *
 * The prefix requirement prevents false positives on barrel files and files that export
 * multiple independent PascalCase components.
 */
export function detectCompoundExports(sourceCode: string, mainComponentName: string): string[] {
  const ast = parseSource(sourceCode);
  const results: string[] = [];

  const isCompound = (name: string) =>
    name.startsWith(mainComponentName) && name !== mainComponentName && !name.startsWith('Sample');

  for (const node of ast.program.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;

    if (!node.declaration) {
      if (node.exportKind === 'type') continue;
      // Skip cross-file re-exports: `export { Foo } from './foo'` — these are barrel patterns.
      // Local re-exports have no source: `export { Alert, AlertTitle }`.
      if (node.source) continue;
      for (const spec of node.specifiers) {
        if (spec.type !== 'ExportSpecifier') continue;
        if (spec.exportKind === 'type') continue;
        if (spec.exported.type !== 'Identifier') continue;
        if (isCompound(spec.exported.name)) results.push(spec.exported.name);
      }
      continue;
    }

    if (node.exportKind === 'type') continue;
    const decl = node.declaration;
    const names: string[] = [];

    if (decl.type === 'FunctionDeclaration' && decl.id) {
      names.push(decl.id.name);
    } else if (decl.type === 'ClassDeclaration' && decl.id) {
      names.push(decl.id.name);
    } else if (decl.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type === 'Identifier') names.push(d.id.name);
      }
    }

    for (const name of names) {
      if (isCompound(name)) results.push(name);
    }
  }

  return results;
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
