/**
 * @file Shared AST helpers for patching a user's `vite.config.{ts,js,mjs}`.
 *
 * Accessed via:
 *   - scripts/patch-vite-config.ts — SaaS container startup (raw node:fs, bundled into
 *     dist/patch-vite-config.cjs by .github/workflows/build-images.yml).
 *   - lib/preview-generator/vite-config-react-dedupe.ts — VS Code extension preview path
 *     (via the FileIO abstraction).
 *
 * Both callers parse the config with recast + @babel/parser, extract the config object,
 * mutate it with these helpers, and re-print. Only the I/O transport differs (sync fs vs
 * async FileIO), so the pure AST transforms live here as the single source of truth.
 *
 * Invariant: every mutator is IDEMPOTENT and UNION-MERGES into existing arrays/objects —
 * it never clobbers a user's existing `resolve.dedupe` / `optimizeDeps.include` entries.
 *
 * Past bug (HYP — Remix dual-React hydration crash): on cold Vite dev-server start, the browser
 * loads the client entry and Vite discovers `@remix-run/node` LATE in the client module graph
 * ("new dependencies found: @remix-run/node" → "optimized dependencies changed. reloading"). That
 * forces a full iframe reload; during the reload the iframe mixes chunks from TWO optimize
 * generations, so @remix-run/react's React !== react-dom's React → null dispatcher → "Invalid hook
 * call / more than one copy of React".
 *
 * The fix (Approach A) is to COMPLETE the first optimize pass so Vite never discovers a dep late:
 * pre-declare the full Remix SSR/loader client-graph set in `optimizeDeps.include` —
 * @remix-run/node (THE late-discovered trigger) plus @remix-run/react, @remix-run/server-runtime,
 * react-router, react-router-dom. With these included up front there is no "new dependencies
 * found", no "reloading", and every React-identity dep shares ONE optimize ?v= hash (proven via a
 * live `remix vite:dev` A/B with DEBUG=vite:deps). No late discovery → no reload → no cross-gen
 * mix. `resolve.dedupe` stays as cheap defense-in-depth (it pins one React identity if a reload
 * ever does happen), but the include completion is the real fix — dedupe alone was insufficient
 * because its earlier include list MISSED @remix-run/node (commits 33c2e870 + fa5274b0).
 */

import type * as t from '@babel/types';
import type * as BabelTypesModule from '@babel/types';

/**
 * The React identities that MUST resolve to a single copy to survive a dep re-optimization reload.
 * dedupe is the load-bearing fix for the dual-React crash.
 *
 * The jsx-runtime subpaths are listed here UNCONDITIONALLY even though the matching
 * optimizeDeps.include entries are version-gated (REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS). This
 * asymmetry is INTENTIONAL, not an oversight: `resolve.dedupe` only deduplicates a package IF it is
 * encountered during resolution — an unmatched/unresolvable dedupe entry is a harmless no-op. By
 * contrast an unresolvable `optimizeDeps.include` entry makes Vite's optimizer throw (it eagerly
 * resolves every include). So dedupe stays unconditional (cheap, tolerant) while include is gated.
 * Do NOT "align" them by gating dedupe — that buys nothing and only adds work.
 */
export const REACT_DEDUPE_ENTRIES = ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime'] as const;

/**
 * The React/Remix client set to pre-bundle so the FIRST optimize pass is complete and Vite never
 * discovers a dep late (the late discovery is what triggers the reload — see the file header).
 *
 * Split into THREE tiers because adding an UNRESOLVABLE entry to `optimizeDeps.include` breaks
 * Vite's dep optimizer (it tries to resolve the entry and fails):
 *   1. ALWAYS-SAFE — the bare `react` / `react-dom` packages. Guaranteed present in any
 *      react+react-dom project (the gate this whole patch runs behind), so safe unconditionally.
 *   2. GATED SUBPATHS — `react-dom/client` / `react/jsx-runtime` / `react/jsx-dev-runtime`. These
 *      are VERSION-DEPENDENT: `react/jsx-runtime` + `react/jsx-dev-runtime` were added with React
 *      17's new JSX transform; `react-dom/client` with React 18's createRoot. A React 16/17 project
 *      does NOT have them, so including them unconditionally would write an unresolvable entry and
 *      break that project's Vite optimize. Gated on the subpath's PHYSICAL resolvability so they're
 *      added only when present, robust for any React version.
 *   3. GATED BARE — bare third-party packages (Remix/router). Only added for packages the project
 *      actually depends on.
 * The caller passes predicates for tiers 2 and 3 (subpath resolvability / node_modules presence).
 */
export const REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS = ['react', 'react-dom'] as const;

/**
 * Version-dependent React subpaths, gated on physical resolvability (NOT added unconditionally).
 * `react/jsx-runtime` + `react/jsx-dev-runtime` exist only in React 17+ (the new JSX transform);
 * `react-dom/client` only in React 18+ (createRoot). A React 16/17 project lacks them, and an
 * unresolvable optimizeDeps.include entry breaks Vite's optimizer — so the caller probes each one's
 * physical artifact (see {@link reactSubpathArtifactRelPath}) and includes only those that resolve.
 */
export const REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS = [
  'react-dom/client',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
] as const;

/**
 * The node_modules-relative artifact a React subpath physically resolves to, used by both callers'
 * presence gate. React ships these subpaths as real files (`react/jsx-runtime.js`,
 * `react-dom/client.js`, …) in every version that HAS them; a React 16/17 project simply lacks the
 * file, which is exactly the signal to skip the include entry. Appending `.js` to the subpath is the
 * deterministic map (`react/jsx-runtime` → `react/jsx-runtime.js`); the caller joins this onto
 * `<projectRoot>/node_modules`. Single source of truth so both the VS Code (async FileIO) and the
 * SaaS (sync fs) gate probe the SAME relative path.
 */
export function reactSubpathArtifactRelPath(subpath: string): string {
  return `${subpath}.js`;
}

/**
 * Bare third-party packages added to optimizeDeps.include ONLY when installed (see above).
 *
 * `@remix-run/node` is THE late-discovered dep that triggers the cold-start "new dependencies
 * found" → "reloading" → dual-React crash: Vite optimizes the client entry first and only meets
 * @remix-run/node (via the loader/server-runtime client graph) on the browser request, AFTER the
 * first optimize generation has been served. Pre-declaring it (plus @remix-run/server-runtime and
 * the react-router pair, the rest of the Remix SSR client graph) completes the first optimize so
 * there is no late discovery and no reload. The gate is node_modules presence (these include
 * react-router / @remix-run/server-runtime which are TRANSITIVE in the Remix templates — present in
 * node_modules but NOT in package.json), because an unresolvable include entry breaks the optimizer.
 */
const REACT_OPTIMIZE_DEPS_INCLUDE_GATED = [
  '@remix-run/react',
  '@remix-run/node',
  '@remix-run/server-runtime',
  'react-router',
  'react-router-dom',
] as const;

/**
 * The gated package names a caller must probe against the project (via its `isInstalled` gate) to
 * decide which entries to add. Exposed so the gate SOURCE (node_modules presence — checked via the
 * async FileIO in the VS Code patcher and via fs.existsSync in the SaaS script) lives in the caller
 * while the package LIST stays a single source of truth here.
 */
export const REACT_OPTIMIZE_DEPS_INCLUDE_GATED_CANDIDATES = REACT_OPTIMIZE_DEPS_INCLUDE_GATED;

/**
 * The full include set (always-safe + gated subpaths + gated bare). Exposed for tests that
 * pre-install everything; production code uses {@link applyReactDedupe}'s gate predicates, not this
 * constant directly.
 */
export const REACT_OPTIMIZE_DEPS_INCLUDE = [
  ...REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS,
  ...REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS,
  ...REACT_OPTIMIZE_DEPS_INCLUDE_GATED,
] as const;

type BabelTypes = typeof BabelTypesModule;

/** Predicate: is `pkg` a dependency of the project being patched? */
export type IsInstalled = (pkg: string) => boolean;

/** Predicate: does a React subpath physically resolve in the project (e.g. `react/jsx-runtime`)? */
export type IsSubpathResolvable = (subpath: string) => boolean;

/**
 * The vite.config filenames to look for, in priority order. Single source of truth shared by the
 * SaaS script and the VS Code patcher so both cover the same extension set (.ts/.js/.mjs/.mts/
 * .cjs/.cts) that framework detection recognizes.
 */
export const VITE_CONFIG_CANDIDATES = [
  'vite.config.ts',
  'vite.config.js',
  'vite.config.mjs',
  'vite.config.mts',
  'vite.config.cjs',
  'vite.config.cts',
] as const;

/**
 * Check if expression is `process.env.SOMETHING || ...`
 */
function isEnvExpression(node: t.Node, envVar: string): boolean {
  if (node.type !== 'LogicalExpression') return false;
  const expr = node as t.LogicalExpression;
  if (expr.operator !== '||') return false;
  if (expr.left.type !== 'MemberExpression') return false;
  const left = expr.left as t.MemberExpression;
  if (left.object.type !== 'MemberExpression') return false;
  const obj = left.object as t.MemberExpression;
  return (
    obj.object.type === 'Identifier' &&
    (obj.object as t.Identifier).name === 'process' &&
    obj.property.type === 'Identifier' &&
    (obj.property as t.Identifier).name === 'env' &&
    left.property.type === 'Identifier' &&
    (left.property as t.Identifier).name === envVar
  );
}

/**
 * Find property in object expression by key name (Identifier or StringLiteral key).
 */
export function findProperty(obj: t.ObjectExpression, name: string): t.ObjectProperty | null {
  for (const prop of obj.properties) {
    if (
      prop.type === 'ObjectProperty' &&
      ((prop.key.type === 'Identifier' && prop.key.name === name) ||
        (prop.key.type === 'StringLiteral' && prop.key.value === name))
    ) {
      return prop;
    }
  }
  return null;
}

/**
 * Set property value, creating if needed. Returns true if a change was made.
 */
export function setProperty(obj: t.ObjectExpression, name: string, value: t.Expression, b: BabelTypes): boolean {
  const existing = findProperty(obj, name);
  if (existing) {
    // Check if already has the value we want
    if (value.type === 'BooleanLiteral' && existing.value.type === 'BooleanLiteral') {
      if ((existing.value as t.BooleanLiteral).value === (value as t.BooleanLiteral).value) {
        return false; // No change needed
      }
    }
    if (value.type === 'LogicalExpression' && existing.value.type === 'LogicalExpression') {
      // Check if it's already the same env expression
      const envVar = ((value.left as t.MemberExpression).property as t.Identifier).name;
      if (isEnvExpression(existing.value, envVar)) {
        return false; // No change needed
      }
    }
    existing.value = value;
    return true;
  }
  obj.properties.push(b.objectProperty(b.identifier(name), value));
  return true;
}

/**
 * Find or create a nested object property, returning its ObjectExpression value.
 * Replaces a non-object value with a fresh object expression.
 */
export function findOrCreateObjectProperty(obj: t.ObjectExpression, name: string, b: BabelTypes): t.ObjectExpression {
  const existing = findProperty(obj, name);
  if (existing && existing.value.type === 'ObjectExpression') {
    return existing.value as t.ObjectExpression;
  }
  if (existing) {
    // Property exists but isn't an object, replace it
    const newObj = b.objectExpression([]);
    existing.value = newObj;
    return newObj;
  }
  // Create new property
  const newObj = b.objectExpression([]);
  obj.properties.push(b.objectProperty(b.identifier(name), newObj));
  return newObj;
}

/**
 * Extract the config object from the various export/assignment patterns Vite/Next configs use:
 * `export default defineConfig({…})`, `export default {…}`, `export default varName`,
 * `module.exports = {…}` / `= varName`. Returns null for function-style configs.
 */
export function extractConfigObject(ast: t.File): t.ObjectExpression | null {
  // First pass: collect variable declarations that initialise to object literals
  const variables: Map<string, t.ObjectExpression> = new Map();

  for (const node of ast.program.body) {
    if (node.type === 'VariableDeclaration') {
      for (const decl of node.declarations) {
        if (decl.id.type === 'Identifier' && decl.init?.type === 'ObjectExpression') {
          variables.set(decl.id.name, decl.init as t.ObjectExpression);
        }
      }
    }
  }

  // `defineConfig({ ... })` → the object literal argument, else null. Shared by the
  // `export default` and `module.exports =` branches so both pick up the wrapped CJS shape.
  const unwrapDefineConfig = (expr: t.Node): t.ObjectExpression | null => {
    if (
      expr.type === 'CallExpression' &&
      expr.callee.type === 'Identifier' &&
      expr.callee.name === 'defineConfig' &&
      expr.arguments[0]?.type === 'ObjectExpression'
    ) {
      return expr.arguments[0] as t.ObjectExpression;
    }
    return null;
  };

  for (const node of ast.program.body) {
    // export default defineConfig({ ... })
    if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'CallExpression') {
      const unwrapped = unwrapDefineConfig(node.declaration);
      if (unwrapped) return unwrapped;
    }

    // export default { ... }
    if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'ObjectExpression') {
      return node.declaration as t.ObjectExpression;
    }

    // export default varName (reference to variable)
    if (node.type === 'ExportDefaultDeclaration' && node.declaration.type === 'Identifier') {
      const varName = (node.declaration as t.Identifier).name;
      if (variables.has(varName)) {
        return variables.get(varName) ?? null;
      }
    }

    // module.exports = { ... } | = varName
    if (node.type === 'ExpressionStatement' && node.expression.type === 'AssignmentExpression') {
      const assign = node.expression as t.AssignmentExpression;
      if (
        assign.left.type === 'MemberExpression' &&
        (assign.left.object as t.Identifier)?.name === 'module' &&
        (assign.left.property as t.Identifier)?.name === 'exports'
      ) {
        // module.exports = { ... }
        if (assign.right.type === 'ObjectExpression') {
          return assign.right as t.ObjectExpression;
        }
        // module.exports = defineConfig({ ... }) — common CJS Vite shape
        const unwrapped = unwrapDefineConfig(assign.right);
        if (unwrapped) return unwrapped;
        // module.exports = varName (reference to variable)
        if (assign.right.type === 'Identifier') {
          const varName = (assign.right as t.Identifier).name;
          if (variables.has(varName)) {
            return variables.get(varName) ?? null;
          }
        }
      }
    }
  }
  return null;
}

/**
 * Create an AST array expression from a string array.
 */
export function createStringArrayExpression(b: BabelTypes, strings: readonly string[]): t.ArrayExpression {
  return b.arrayExpression(strings.map((s) => b.stringLiteral(s)));
}

/**
 * Check if an array expression already contains a specific string literal.
 */
export function arrayContainsString(arr: t.ArrayExpression, value: string): boolean {
  return arr.elements.some((el) => el?.type === 'StringLiteral' && (el as t.StringLiteral).value === value);
}

/**
 * Union-merge a string array into `obj[name]`: if the property is an existing string-array,
 * append only the missing entries (preserving the user's existing ones); otherwise create the
 * property with the full set. Returns true if any entry was added/created. Idempotent — a
 * second run with the same entries makes no change.
 */
function ensureStringArrayProperty(
  obj: t.ObjectExpression,
  name: string,
  values: readonly string[],
  b: BabelTypes,
): boolean {
  const existing = findProperty(obj, name);

  if (existing && existing.value.type === 'ArrayExpression') {
    const arr = existing.value as t.ArrayExpression;
    let modified = false;
    for (const value of values) {
      if (!arrayContainsString(arr, value)) {
        arr.elements.push(b.stringLiteral(value));
        modified = true;
      }
    }
    return modified;
  }

  // No property, or property exists but is not a string array (e.g. user set it to a
  // function/spread). Don't clobber a non-array value — only create when absent.
  if (existing) return false;

  obj.properties.push(b.objectProperty(b.identifier(name), createStringArrayExpression(b, values)));
  return true;
}

/**
 * Like {@link findOrCreateObjectProperty} but NON-DESTRUCTIVE: returns null instead of clobbering
 * when the property exists with a NON-object value (e.g. `resolve: sharedResolve` /
 * `optimizeDeps: makeOptimizeDeps()`). Creating the property when absent, or returning the existing
 * ObjectExpression, is safe; replacing a dynamic value would silently drop the user's config.
 */
function getOrCreateObjectPropertyNonDestructive(
  obj: t.ObjectExpression,
  name: string,
  b: BabelTypes,
): t.ObjectExpression | null {
  const existing = findProperty(obj, name);
  if (existing) {
    return existing.value.type === 'ObjectExpression' ? (existing.value as t.ObjectExpression) : null;
  }
  const newObj = b.objectExpression([]);
  obj.properties.push(b.objectProperty(b.identifier(name), newObj));
  return newObj;
}

/**
 * Add `resolve.dedupe` (the React identities) and extend `optimizeDeps.include` (the React client
 * set) on a config object, union-merging with any existing entries. Returns true if the object was
 * modified. Idempotent: a second call with everything already present writes nothing.
 *
 * `isInstalled` gates the bare third-party include entries (@remix-run/react, react-router*) to
 * packages the project actually depends on; `isSubpathResolvable` gates the version-dependent React
 * subpaths (react-dom/client, react/jsx-runtime, react/jsx-dev-runtime) to those that physically
 * resolve — adding an unresolvable entry to optimizeDeps.include breaks Vite's dep optimizer, and a
 * React 16/17 project lacks those subpaths. When a gate is omitted, its tier is skipped
 * (conservative default). Only the bare react/react-dom entries are unconditional; they are present
 * by definition in any project this runs on (and are the dedupe entries too).
 *
 * NON-DESTRUCTIVE: if `resolve` / `optimizeDeps` exists with a non-object (dynamic) value, that key
 * is left untouched rather than clobbered.
 *
 * The optimizeDeps.include completion is the load-bearing fix for the Remix dual-React hydration
 * crash (it removes the late dep discovery that triggers the reload); dedupe is defense-in-depth —
 * see the file header.
 */
export function applyReactDedupe(
  configObject: t.ObjectExpression,
  b: BabelTypes,
  isInstalled?: IsInstalled,
  isSubpathResolvable?: IsSubpathResolvable,
): boolean {
  let modified = false;

  // resolve.dedupe — defense-in-depth: pin a single React identity if a re-optimize reload ever
  // still happens.
  const resolveObj = getOrCreateObjectPropertyNonDestructive(configObject, 'resolve', b);
  if (resolveObj && ensureStringArrayProperty(resolveObj, 'dedupe', REACT_DEDUPE_ENTRIES, b)) {
    modified = true;
  }

  // optimizeDeps.include — pre-bundle the full Remix client graph so the FIRST optimize pass is
  // complete and Vite never discovers @remix-run/node late (no late discovery → no reload). The
  // version-dependent React subpaths are gated on physical resolvability (a React 16/17 project
  // lacks react-dom/client + the jsx-runtime pair) and the bare third-party entries on installation,
  // so neither a legacy-React app nor a plain React+Vite app gets an unresolvable include entry that
  // would break dep optimization.
  const includeEntries = [
    ...REACT_OPTIMIZE_DEPS_INCLUDE_ALWAYS,
    ...REACT_OPTIMIZE_DEPS_INCLUDE_GATED_SUBPATHS.filter((sub) => isSubpathResolvable?.(sub) ?? false),
    ...REACT_OPTIMIZE_DEPS_INCLUDE_GATED.filter((pkg) => isInstalled?.(pkg) ?? false),
  ];
  const optimizeDepsObj = getOrCreateObjectPropertyNonDestructive(configObject, 'optimizeDeps', b);
  if (optimizeDepsObj && ensureStringArrayProperty(optimizeDepsObj, 'include', includeEntries, b)) {
    modified = true;
  }

  return modified;
}
