/**
 * HYP-290g — Data-source category classifier.
 *
 * Accessed via: the DOM-mode operation layer (HYP-290d/e/f) calls this with the
 * `mapExpression` from `engine.getSelectedMapContext()` plus the enclosing
 * component's source, to decide which DOM-mode handler can target a single
 * `.map()` iteration.
 *
 * Assumptions (architectural invariants):
 *  - `mapExpression` is the raw source text of the `.map()` receiver, captured by
 *    the component parser as `generate(node.callee.object).code`
 *    (`component-parser.ts:607`). For `items.map(...)` it is `"items"`; for
 *    `data.users.map(...)` it is `"data.users"`; for a `.filter().map()` chain it
 *    is the chained call string `"items.filter(...)"`.
 *  - Binding resolution is the CALLER's source: this module re-parses `source` and
 *    resolves the receiver's root identifier against the file's scope. It does NOT
 *    read files or mutate anything — classification only.
 *  - Ambiguous / unresolvable / chained → category 4 (`generator`), the safe AI
 *    fallback. Never guess a destructive AST path. This is load-bearing for the
 *    itemIndex↔array-index correctness risk (spec A6): anything that can break the
 *    rendered-sibling-index → source-array-index correspondence must defer to AI.
 *
 * NOTE — deliberate divergence from the spec's HYP-290g acceptance text: the spec
 * says `.filter().map()` returns `hook-derived`. We return `generator` instead.
 * Both categories 2 and 4 route to the same AI path (HYP-290f), so there is zero
 * behavioral difference, but `generator` is the honest label for a chained call
 * and matches the binding-resolution contract in the parent task. Do not "fix"
 * this back to `hook-derived`.
 */

import { parse as babelParse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

// @ts-expect-error - babel/traverse has ESM/CJS interop issues (mirrors component-parser.ts)
const traverse = (_traverse.default ?? _traverse) as typeof _traverse;

/**
 * Source location of an AST node, mirroring `ComponentNode['loc']`.
 * Not exported by name (knip would flag it until a 290e consumer lands); it is
 * reachable structurally through {@link MapDataSourceClassification}.
 */
interface SourceLoc {
  start: { line: number; column: number };
  end: { line: number; column: number };
}

/**
 * Reasons a receiver is routed to the generator (AI) path.
 * Not exported by name (knip would flag it until a 290f consumer lands); it is
 * reachable structurally through {@link MapDataSourceClassification}.
 */
type GeneratorReason =
  | 'chained-call' // receiver is a CallExpression (.filter/.slice/gen()) — breaks itemIndex (A6)
  | 'unresolved' // root identifier has no resolvable local binding (imported / unknown)
  | 'non-array-init' // local binding exists but its init is neither an array literal nor a hook
  | 'nested-param' // receiver is a param of a nested helper/callback, not the component's own prop
  | 'mutable-array-binding' // let/var array literal — may be reassigned before render, not the rendered array
  | 'ambiguous'; // could not pin the receiver expression to a single binding

/**
 * Discriminated classification result for a `.map()` data source.
 *
 * - `props-from-sample` — the array comes from a component prop (filled by the
 *   Sample file in canvas mode). Routed to HYP-290d.
 * - `hook-derived` — bound to a `useX()` hook call (`useState`, `useMap`, ...).
 *   Routed to the AI path (HYP-290f).
 * - `literal-array` — bound to an in-component `const x = [...]` array literal.
 *   Routed to HYP-290e; `declarationLoc` points at the array literal to splice.
 * - `generator` — chained call / generator / unresolvable. Safe AI fallback.
 */
export type MapDataSourceClassification =
  | { category: 'props-from-sample'; rootName: string }
  | { category: 'hook-derived'; rootName: string; hookName: string }
  | { category: 'literal-array'; rootName: string; declarationLoc: SourceLoc | null }
  | { category: 'generator'; reason: GeneratorReason };

const HOOK_NAME_RE = /^use[A-Z0-9]/;

function generatorResult(reason: GeneratorReason): MapDataSourceClassification {
  return { category: 'generator', reason };
}

/** Parse the receiver string on its own to read its top-level shape. */
function parseReceiver(mapExpression: string): t.Expression | null {
  const trimmed = mapExpression.trim();
  if (!trimmed) return null;
  try {
    const file = babelParse(`(${trimmed})`, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
    const stmt = file.program.body[0];
    if (t.isExpressionStatement(stmt)) return stmt.expression;
    return null;
  } catch {
    return null;
  }
}

/** The leftmost identifier of an Identifier / (Optional)MemberExpression chain, or null. */
function rootIdentifier(expr: t.Expression): string | null {
  let current: t.Node = expr;
  while (t.isMemberExpression(current) || t.isOptionalMemberExpression(current)) {
    current = current.object;
  }
  if (t.isIdentifier(current)) return current.name;
  if (t.isThisExpression(current)) return null;
  return null;
}

function isHookCall(init: t.Node | null | undefined): string | null {
  if (!init || !t.isCallExpression(init)) return null;
  const callee = init.callee;
  if (t.isIdentifier(callee) && HOOK_NAME_RE.test(callee.name)) return callee.name;
  // member-call hooks like React.useState
  if (t.isMemberExpression(callee) && t.isIdentifier(callee.property) && HOOK_NAME_RE.test(callee.property.name)) {
    return callee.property.name;
  }
  return null;
}

function toSourceLoc(node: t.Node): SourceLoc | null {
  if (!node.loc) return null;
  return {
    start: { line: node.loc.start.line, column: node.loc.start.column },
    end: { line: node.loc.end.line, column: node.loc.end.column },
  };
}

/** Classify a single resolved binding into one of the four categories. */
function classifyResolvedBinding(
  binding: { kind: string; path: NodePath },
  rootName: string,
  isMember: boolean,
): MapDataSourceClassification {
  // Function parameter (or destructured-from-parameter) → props — but ONLY when it
  // is the COMPONENT's own parameter. A param of a nested helper/callback inside the
  // component (e.g. `function render(items){ return items.map(...) }`) is also
  // kind==='param' yet is NOT a Sample-supplied prop; routing it to the Sample
  // rewrite path would be wrong. Defer those to the AI/generator path.
  if (binding.kind === 'param') {
    const fn = binding.path.getFunctionParent();
    if (fn && !fn.getFunctionParent()) {
      return { category: 'props-from-sample', rootName };
    }
    return generatorResult('nested-param');
  }

  const declPath = binding.path;

  // useState-style: const [items] = useState(...) — array-pattern destructure.
  if (declPath.isVariableDeclarator()) {
    const init = declPath.node.init;
    const hookName = isHookCall(init);
    if (hookName) {
      return { category: 'hook-derived', rootName, hookName };
    }
    // const items = [...] literal array. Only category 3 when the receiver is
    // the bare identifier itself; a member access (data.users) over a literal
    // object is not a top-level array splice target — defer to AI.
    if (init && t.isArrayExpression(init) && !isMember) {
      // Require an immutable (const) binding. A `let`/`var` array may be reassigned
      // before render (`let items = []; items = props.items`), so the rendered array
      // is NOT the initializer — splicing the literal would target the wrong source.
      if (binding.kind !== 'const') {
        return generatorResult('mutable-array-binding');
      }
      return { category: 'literal-array', rootName, declarationLoc: toSourceLoc(init) };
    }
    // Bound locally but to something we can't prove is an array or a hook.
    return generatorResult('non-array-init');
  }

  // Imported binding, or any other declaration kind we don't resolve.
  return generatorResult('unresolved');
}

/**
 * Classify the binding kind of a root identifier resolved via babel scope.
 * Returns the full classification for the resolvable cases, or null to let the
 * caller fall back to the safe generator path.
 *
 * Resolution is conservative against shadowing: it collects the distinct
 * bindings of `rootName` across ALL of its referenced use-sites in the file.
 * Only when exactly one distinct binding exists do we classify it; if the name
 * shadows (two+ distinct bindings — e.g. a prop `items` plus a block-scoped
 * `const items = [...]`) we cannot prove which one feeds the selected `.map()`,
 * so we default to category 4 (`ambiguous`). This is the deliberate "ship the
 * clear cases, default the rest to the safe AI path" boundary (spec A6); it can
 * over-defer a genuinely unshadowed map, but never routes a destructive mutation
 * at the wrong array. Do not "tighten" this without a use-site resolver.
 */
function classifyBinding(rootName: string, isMember: boolean, source: string): MapDataSourceClassification | null {
  let ast: t.File;
  try {
    ast = babelParse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    });
  } catch {
    return generatorResult('unresolved');
  }

  // `getBinding` returns a stable object per binding within one traverse, so a
  // Set deduplicates references that resolve to the same declaration.
  const bindings = new Set<{ kind: string; path: NodePath }>();
  traverse(ast, {
    Identifier(path: NodePath<t.Identifier>) {
      if (path.node.name !== rootName) return;
      // Skip declaration sites and property keys — we want use-site references.
      if (!path.isReferencedIdentifier()) return;
      const binding = path.scope.getBinding(rootName);
      if (binding) bindings.add(binding);
    },
  });

  if (bindings.size === 0) return generatorResult('unresolved');
  if (bindings.size > 1) return generatorResult('ambiguous');

  const [binding] = bindings;
  return classifyResolvedBinding(binding, rootName, isMember);
}

/**
 * Classify a `.map()` receiver expression into one of four data-source
 * categories for DOM-mode routing. Pure: no file or network IO, no mutation.
 *
 * @param mapExpression - raw `.map()` receiver source (from getSelectedMapContext)
 * @param source - source of the enclosing component file
 */
export function classifyMapDataSource(mapExpression: string, source: string): MapDataSourceClassification {
  const receiver = parseReceiver(mapExpression);
  if (!receiver) return generatorResult('unresolved');

  // A chained / generator call receiver (items.filter(...), buildList()) breaks
  // the itemIndex ↔ array-index correspondence (spec A6) → AI path, no binding
  // lookup needed.
  if (t.isCallExpression(receiver) || t.isOptionalCallExpression(receiver)) {
    return generatorResult('chained-call');
  }

  const isMember = t.isMemberExpression(receiver) || t.isOptionalMemberExpression(receiver);
  if (!t.isIdentifier(receiver) && !isMember) {
    return generatorResult('ambiguous');
  }

  const rootName = rootIdentifier(receiver);
  if (!rootName) return generatorResult('ambiguous');

  return classifyBinding(rootName, isMember, source) ?? generatorResult('unresolved');
}
