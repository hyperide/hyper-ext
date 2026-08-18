/**
 * @file A1 forward-detector — step 1, the AST render-body trace (HYP-1229).
 *
 * The primary, unconditional signal (see forward-detect.ts's header for the full algorithm
 * order). Given a component's function node, answers whether ONE channel (`className`/`style`)
 * provably reaches the component's own returned JSX root, reaches only a nested descendant (a
 * pre-write exclusion — the write would land on the wrong DOM node), is structurally impossible
 * to reach (destructured out and never used, or simply absent from the props shape at all), or is
 * genuinely untraceable (an opaque hook return, `cloneElement`, a non-JSX root) — which must stay
 * `low`, never a false negative.
 *
 * MUTUALLY-EXCLUSIVE ALTERNATIVES (review finding, HYP-1229 PR #719): a render body can return
 * through several DIFFERENT top-level `return` statements (`if (x) return <A/>; return <B/>;`)
 * and/or a ternary/`||`/`??` root (`cond ? <A/> : <B/>`) — only ONE of those ever executes for a
 * given render. Each is its own "alternative"; every alternative must independently carry the
 * channel before this returns a confident HIGH positive, and every alternative must independently
 * be a proven non-forward before this returns a confident HIGH negative. A MIX (some alternatives
 * carry, some don't, or one is opaque) can only ever be `low` — per spec §9.2a: "a trace lost in
 * a conditional... is low", never a false positive OR a false exclusion for the branch that
 * didn't render. This is distinct from a Fragment's DIRECT children, which are CO-RENDERED (all
 * render simultaneously) — any one of them carrying the channel is a real, always-present write
 * target, so a Fragment is graded as a single alternative containing every direct child.
 *
 * A Fragment CAN also contain conditionally-rendered content of its own (an expression container
 * like `{flag && <div/>}` or `{items.map(...)}`) mixed in among its unconditional children — see
 * `fragmentChildElements`'s doc comment for why that content is NEVER folded into the co-rendered
 * candidate list (review rounds 3 and 4: an earlier attempt did exactly that and re-introduced the
 * same mutually-exclusive-arms-treated-as-co-rendered bug this whole model exists to close).
 *
 * A `low` outcome that already has AST PROOF that at least one alternative does NOT forward
 * (`ChannelOutcome.provenPartialExclusion`) must never be upgraded by type corroboration in
 * `forward-detect.ts` — see that flag's own doc comment (review round 3, P1: the mixed-branch fix
 * above was otherwise silently undone one step later by the type step).
 *
 * Each alternative carries its OWN `const`-binding snapshot for `deepReferencesIdentifier`'s
 * intermediate-assignment resolution — see `walkStatementsForReturns`'s doc comment (review round
 * 5, k3 P1) for why a single, function-wide bindings map is unsound.
 */
import * as t from '@babel/types';

export type Channel = 'className' | 'style';

export interface ChannelOutcome {
  forwards: boolean;
  confidence: 'high' | 'low';
  excludedReason?: 'no-host-forward' | 'forwards-non-root-only';
  /**
   * Only meaningful when `confidence` is `'low'`. True when this verdict already has AST PROOF
   * that at least one mutually-exclusive alternative does NOT forward the channel (a proven
   * exclusion sits alongside a carrying or unresolved alternative). A type declaration is
   * evidence the prop EXISTS, never evidence a SPECIFIC branch attaches it — it must never
   * override concrete AST proof that some branch doesn't. Review finding, PR #719 review round 3
   * P1: without this flag, `forward-detect.ts`'s type-corroboration step upgraded exactly the
   * mixed-branch case the alternatives fix above was built to keep at `low` (the identifier is
   * referenced in the CARRYING branch and the type DOES declare it, so the naive
   * "referenced anywhere" gate alone still passed).
   */
  provenPartialExclusion?: boolean;
}

const HIGH_POSITIVE: ChannelOutcome = { forwards: true, confidence: 'high' };
const LOW_UNKNOWN: ChannelOutcome = { forwards: true, confidence: 'low' };
const LOW_PROVEN_PARTIAL_EXCLUSION: ChannelOutcome = {
  forwards: true,
  confidence: 'low',
  provenPartialExclusion: true,
};

function highNegative(reason: NonNullable<ChannelOutcome['excludedReason']>): ChannelOutcome {
  return { forwards: false, confidence: 'high', excludedReason: reason };
}

/** How a component's first param exposes (or doesn't) one channel — see `analyzeDestructure`. */
export interface DestructureInfo {
  /** `{ className }` or `{ className: alias }` — the channel is a NAMED local binding. */
  explicit: boolean;
  localName: string | null;
  /** `...rest` present (any name). Whether it CARRIES the channel depends on `explicit` — see 1c. */
  hasRest: boolean;
  restLocalName: string | null;
  /** The param is a plain identifier (`function Comp(props)`), not destructured at all. */
  wholeProps: boolean;
  wholePropsLocalName: string | null;
}

const EMPTY_DESTRUCTURE: DestructureInfo = {
  explicit: false,
  localName: null,
  hasRest: false,
  restLocalName: null,
  wholeProps: false,
  wholePropsLocalName: null,
};

export function analyzeDestructure(params: t.Node[], channel: Channel): DestructureInfo {
  const first = params[0];
  if (!first) return EMPTY_DESTRUCTURE;
  const pattern = t.isAssignmentPattern(first) ? first.left : first;

  if (t.isIdentifier(pattern)) {
    return { ...EMPTY_DESTRUCTURE, wholeProps: true, wholePropsLocalName: pattern.name };
  }
  if (!t.isObjectPattern(pattern)) return EMPTY_DESTRUCTURE;

  const info: DestructureInfo = { ...EMPTY_DESTRUCTURE };
  for (const prop of pattern.properties) {
    if (t.isRestElement(prop)) {
      info.hasRest = true;
      if (t.isIdentifier(prop.argument)) info.restLocalName = prop.argument.name;
      continue;
    }
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && prop.key.name === channel) {
      info.explicit = true;
      const value = t.isAssignmentPattern(prop.value) ? prop.value.left : prop.value;
      info.localName = t.isIdentifier(value) ? value.name : null;
    }
  }
  return info;
}

/** The channel's own bound local identifier — the explicit name, the rest name, or the
 *  whole-props name, whichever destructure shape actually exposes this channel. */
function boundLocalName(destructure: DestructureInfo): string | null {
  if (destructure.explicit) return destructure.localName;
  if (destructure.hasRest) return destructure.restLocalName;
  if (destructure.wholeProps) return destructure.wholePropsLocalName;
  return null;
}

/**
 * Step 1 — trace `channel` from the component's props destructure to its returned JSX root(s).
 * See the file header for the mutually-exclusive-alternatives model and the four outcomes.
 */
export function traceChannelForward(fn: t.Function, destructure: DestructureInfo, channel: Channel): ChannelOutcome {
  // Structurally unreachable: not named, no rest to carry it, no whole-props escape hatch —
  // this component can never read the channel at all (a `{ title }`-only destructure).
  if (!destructure.explicit && !destructure.hasRest && !destructure.wholeProps) {
    return highNegative('no-host-forward');
  }

  const { jsxReturns, hasOpaqueReturn } = collectJsxReturnArgs(fn);
  if (jsxReturns.length === 0) return LOW_UNKNOWN; // no JSX-like return anywhere (bare identifier / cloneElement / other non-JSX root)

  const entries = jsxReturns.flatMap((r) =>
    flattenExclusiveAlternatives(r.arg).map((alt) => ({ alt, bindings: r.bindings })),
  );
  const outcome = combineAlternatives(entries, destructure, channel);

  // A top-level return that isn't JSX-like at all (an opaque helper call, a runtime-computed
  // `cloneElement`) is itself an untraceable alternative sibling to the JSX ones we DID trace —
  // never let the traceable branches alone manufacture a confident verdict when a sibling branch
  // is invisible to us. If the traceable branches were themselves a confident NEGATIVE, that's
  // still real proof at least one branch doesn't forward — carry it forward as a proven partial
  // exclusion rather than a plain unknown (never eligible for a type-corroboration upgrade).
  if (hasOpaqueReturn && outcome.confidence === 'high') {
    return outcome.forwards === false ? LOW_PROVEN_PARTIAL_EXCLUSION : LOW_UNKNOWN;
  }
  return outcome;
}

// --- mutually-exclusive alternative combination -------------------------------------------

type AltVerdict =
  | { kind: 'carries' }
  | { kind: 'excluded'; reason: NonNullable<ChannelOutcome['excludedReason']> }
  | { kind: 'unknown' };

/**
 * One mutually-exclusive alternative: a set of CO-RENDERED candidate roots (a lone element, or a
 * Fragment's unconditional direct children — see the file header), plus `permissive`.
 * `permissive` is true when this group's Fragment ALSO contained conditionally-rendered or
 * otherwise-unresolvable content (`fragmentChildElements`) that was deliberately NOT folded into
 * `roots` — it gates the EXCLUSION paths in `classifyAlternative` down to `unknown` (the
 * unresolved content might still carry on renders this static check can't rule out), but never
 * gates the `carries` path: `roots` only ever contains GUARANTEED (unconditionally co-rendered)
 * elements, so a carry found there is real regardless of `permissive`.
 * `null` marks an alternative we can't see into at all (a bare identifier, an opaque call).
 */
interface CoRenderedGroup {
  roots: t.JSXElement[];
  permissive: boolean;
}
type Alternative = CoRenderedGroup | null;

/** One alternative paired with the `const`-binding snapshot visible along the specific
 *  control-flow path that produced it — see `walkStatementsForReturns`'s doc comment. */
interface AlternativeEntry {
  alt: Alternative;
  bindings: Map<string, t.Expression>;
}

/** Whether a descendant walk (`descendantCarriesChannel`) found a definite carrying descendant,
 *  and/or passed through content it couldn't resolve either way (an expression container it
 *  can't enumerate — same conservative treatment as `fragmentChildElements`, applied at any
 *  nesting depth: review finding, PR #719 review round 4, P2 second half). */
interface DescendantScan {
  carries: boolean;
  unresolved: boolean;
}
const NO_DESCENDANT_MATCH: DescendantScan = { carries: false, unresolved: false };

function classifyAlternative(
  alt: Alternative,
  destructure: DestructureInfo,
  channel: Channel,
  bindings: Map<string, t.Expression>,
): AltVerdict {
  if (alt === null) return { kind: 'unknown' };
  const { roots, permissive } = alt;
  if (roots.some((root) => rootAttributesCarryChannel(root, destructure, channel, bindings)))
    return { kind: 'carries' };

  const descendant = roots.reduce<DescendantScan>((acc, root) => {
    const d = descendantCarriesChannel(root, destructure, channel, bindings);
    return { carries: acc.carries || d.carries, unresolved: acc.unresolved || d.unresolved };
  }, NO_DESCENDANT_MATCH);
  if (descendant.carries) return { kind: 'excluded', reason: 'forwards-non-root-only' };
  if (permissive || descendant.unresolved) return { kind: 'unknown' };
  // Reachable per the destructure, but never actually attached anywhere in this alternative.
  // Only a concrete, NAMED local binding earns a negative here (we can prove it's unused); a
  // rest/whole-props value not found spread anywhere may still flow through an opaque helper
  // (a prop-getter hook, a HOC) this tracer can't see — stays unknown, never a false exclusion.
  return destructure.explicit ? { kind: 'excluded', reason: 'no-host-forward' } : { kind: 'unknown' };
}

function combineAlternatives(
  entries: AlternativeEntry[],
  destructure: DestructureInfo,
  channel: Channel,
): ChannelOutcome {
  if (entries.length === 0) return LOW_UNKNOWN;
  const verdicts = entries.map((e) => classifyAlternative(e.alt, destructure, channel, e.bindings));

  if (verdicts.every((v) => v.kind === 'carries')) return HIGH_POSITIVE;
  if (verdicts.every((v) => v.kind === 'excluded')) {
    // `forwards-non-root-only` (a definite wrong-node write) wins over `no-host-forward` (never
    // attached anywhere) when alternatives disagree on WHY — it's the more specific, actionable
    // diagnosis of the two, and every excluded alternative here is confirmed-excluded either way.
    const reason = verdicts.some((v) => v.kind === 'excluded' && v.reason === 'forwards-non-root-only')
      ? 'forwards-non-root-only'
      : 'no-host-forward';
    return highNegative(reason);
  }
  // Mixed across mutually-exclusive alternatives (some carry, some don't — only one executes at
  // runtime) or at least one alternative is unprovable. Per spec §9.2a: never a confident
  // positive or a confident exclusion for the branch we can't rule either way. When at least one
  // alternative is a PROVEN exclusion, mark it — that's real AST proof a type declaration must
  // never override (see `ChannelOutcome.provenPartialExclusion`).
  const hasProvenExclusion = verdicts.some((v) => v.kind === 'excluded');
  return hasProvenExclusion ? LOW_PROVEN_PARTIAL_EXCLUSION : LOW_UNKNOWN;
}

// --- return-root extraction ---------------------------------------------------------------

/** A single top-level `return`'s argument, paired with the `const`-binding snapshot visible along
 *  the specific control-flow path that reached it — see `walkStatementsForReturns`. */
interface ScopedReturn {
  arg: t.Expression | null;
  bindings: Map<string, t.Expression>;
}

interface JsxReturnCollection {
  jsxReturns: { arg: t.Expression; bindings: Map<string, t.Expression> }[];
  /** True when at least one non-null top-level return is NOT JSX-like (an opaque sibling branch). */
  hasOpaqueReturn: boolean;
}

function collectJsxReturnArgs(fn: t.Function): JsxReturnCollection {
  const all = collectTopLevelReturns(fn);
  const nonNullish = all.filter(
    (r): r is { arg: t.Expression; bindings: Map<string, t.Expression> } => !!r.arg && !rendersNoElement(r.arg),
  );
  const jsxReturns = nonNullish.filter((r) => isJsxLikeExpression(r.arg));
  return { jsxReturns, hasOpaqueReturn: jsxReturns.length !== nonNullish.length };
}

function collectTopLevelReturns(fn: t.Function): ScopedReturn[] {
  const body = fn.body;
  if (!t.isBlockStatement(body)) return [{ arg: body, bindings: new Map() }]; // arrow function expression body
  const out: ScopedReturn[] = [];
  walkStatementsForReturns(body.body, new Map(), out);
  return out;
}

/**
 * A synthetic, never-evaluated placeholder pushed in place of a `return` hidden inside a
 * `switch`/`try`/loop body — see `walkStatementsForReturns`'s doc comment. Deliberately a plain
 * `Identifier` (not `null`/a literal): `rendersNoElement` and `isJsxLikeExpression` both correctly
 * say "no" to it, so it counts as an OPAQUE alternative (`hasOpaqueReturn`) exactly like a real
 * opaque return would — downgrading a would-be confident verdict to `low`/`LOW_PROVEN_PARTIAL_
 * EXCLUSION` rather than silently ignoring the hidden branch.
 */
const HIDDEN_CONTROL_FLOW_RETURN: t.Identifier = t.identifier('__hyp1229_hidden_control_flow_return__');

/**
 * Shallow statement walk — collects every top-level `return` reachable through if/block nesting
 * (never descending into a nested function's own body, a different component's scope entirely),
 * each paired with an INDEPENDENT SNAPSHOT of the `const` bindings visible along that specific
 * control-flow path (`scope`, threaded through and cloned — lazily per block, only on the first
 * `const` write, so sibling blocks never see each other's declarations, matching real JS block
 * scoping — and cloned AGAIN right before each push, so a later `const` in the same block can
 * never retroactively mutate a snapshot an earlier return already captured).
 *
 * Review finding, PR #719 review round 5, k3 P1: an earlier version built ONE global,
 * function-wide bindings map (visited in source order, last-writer-wins). A `const` name legally
 * reused across sibling `if`/`else` branches — a common pattern (`if (x) { const cls = ...; }
 * const cls = ...;`) — collided in that global map, producing a confident FALSE verdict in
 * EITHER direction depending purely on declaration order (a genuinely forwarding branch could
 * resolve to the OTHER branch's non-forwarding value, or vice versa). Scoping the bindings map
 * per return-path closes this at the source: each branch's `const cls` only ever resolves within
 * that branch's own returns.
 *
 * A `return` inside a `switch`/`try`/loop body is never traced for its VALUE — those shapes need
 * real control-flow analysis this shallow walk doesn't do — but its mere PRESENCE is detected
 * (`containsReturn`) and recorded as a `HIDDEN_CONTROL_FLOW_RETURN` opaque alternative (review
 * finding, PR #719 review round 6, Fable P2: a return invisible to BOTH the alternatives model
 * AND `hasOpaqueReturn` could produce a false CONFIDENT positive if every VISIBLE branch carries
 * while the hidden one doesn't — this closes that with the same "opaque sibling" downgrade an
 * ordinary non-JSX return already gets, cheaper than actually tracing the hidden branch's value).
 */
function walkStatementsForReturns(stmts: t.Statement[], scope: Map<string, t.Expression>, out: ScopedReturn[]): void {
  let local = scope;
  for (const stmt of stmts) {
    if (t.isReturnStatement(stmt)) {
      out.push({ arg: stmt.argument ?? null, bindings: new Map(local) });
    } else if (t.isVariableDeclaration(stmt) && stmt.kind === 'const') {
      if (local === scope) local = new Map(scope); // clone lazily — only once per block, on first write
      for (const decl of stmt.declarations) {
        if (t.isIdentifier(decl.id) && decl.init) local.set(decl.id.name, decl.init);
      }
    } else if (t.isIfStatement(stmt)) {
      walkStatementsForReturns(blockOrSingle(stmt.consequent), local, out);
      if (stmt.alternate) walkStatementsForReturns(blockOrSingle(stmt.alternate), local, out);
    } else if (t.isBlockStatement(stmt)) {
      walkStatementsForReturns(stmt.body, local, out);
    } else if (isOpaqueControlFlowStatement(stmt) && containsReturn(stmt)) {
      out.push({ arg: HIDDEN_CONTROL_FLOW_RETURN, bindings: new Map(local) });
    }
  }
}

function blockOrSingle(stmt: t.Statement): t.Statement[] {
  return t.isBlockStatement(stmt) ? stmt.body : [stmt];
}

/** `switch`/`try`/loop bodies — statement kinds `walkStatementsForReturns` doesn't trace the
 *  VALUE of a `return` through (see that function's doc comment), but still checks for the mere
 *  presence of one via `containsReturn`. */
function isOpaqueControlFlowStatement(stmt: t.Statement): boolean {
  return (
    t.isSwitchStatement(stmt) ||
    t.isTryStatement(stmt) ||
    t.isForStatement(stmt) ||
    t.isForInStatement(stmt) ||
    t.isForOfStatement(stmt) ||
    t.isWhileStatement(stmt) ||
    t.isDoWhileStatement(stmt)
  );
}

/** Does `node` contain a `return` statement ANYWHERE within it, never crossing into a nested
 *  function's own body/params (a different scope entirely — matches every other function-boundary
 *  discipline in this file, e.g. `deepReferencesIdentifier`, `paramsShadow`)? A generic
 *  `VISITOR_KEYS` walk, same technique as `subtreeReferencesIdentifier` below. */
function containsReturn(node: t.Node): boolean {
  if (t.isReturnStatement(node)) return true;
  if (FUNCTION_LIKE_TYPES.has(node.type)) return false;
  const keys = (t.VISITOR_KEYS as Record<string, string[] | undefined>)[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && containsReturn(child as t.Node)) return true;
      }
    } else if (value && typeof value === 'object') {
      if (containsReturn(value as t.Node)) return true;
    }
  }
  return false;
}

/** React renders NOTHING for `null`/`undefined`/booleans, and nothing ELEMENT-shaped for a bare
 *  number/string literal (a text node, never a valid attribute-write target either way) — so none
 *  of these need to be treated as an opaque/untraceable alternative; they're just an empty slot.
 *  Review finding, PR #719 review round 3, P3: originally only null/undefined were recognized,
 *  so `cond ? <div className={x}/> : false` (and `: 0`, `: ''`) wrongly downgraded to `low`. */
function rendersNoElement(e: t.Expression): boolean {
  return (
    t.isNullLiteral(e) ||
    (t.isIdentifier(e) && e.name === 'undefined') ||
    t.isBooleanLiteral(e) ||
    t.isNumericLiteral(e) ||
    t.isStringLiteral(e)
  );
}

function isJsxLikeExpression(e: t.Expression): boolean {
  return t.isJSXElement(e) || t.isJSXFragment(e) || t.isConditionalExpression(e) || t.isLogicalExpression(e);
}

/**
 * Could this expression-container CHILD expression possibly produce a JSX element at runtime —
 * as opposed to a bare identifier/member-read/template-literal that's virtually always primitive
 * TEXT content (`{title}`, `{props.title}`, `` {`x-${n}`} ``)? Used to decide whether an
 * expression-container child (inside a Fragment return or as a descendant) needs the conservative
 * "unresolved, never confidently exclude" treatment, or whether it's safe to conclude it carries
 * nothing (review finding, PR #719 review round 4: the FIRST version of this check flagged EVERY
 * non-literal expression as unresolved, which wrongly downgraded plain text-content children like
 * `{x}` from a confident negative to `unknown`). A call expression (`.map(...)`, a render-prop
 * call) or an array literal (`[<A/>, <B/>]`) can produce JSX we have no way to enumerate here, so
 * both count as "might" alongside the already-JSX-like shapes.
 */
function mightRenderJsx(e: t.Expression): boolean {
  return isJsxLikeExpression(e) || t.isCallExpression(e) || t.isOptionalCallExpression(e) || t.isArrayExpression(e);
}

/**
 * Flattens a returned expression down to its list of mutually-exclusive alternatives — see the
 * file header. A Fragment's DIRECT element (and nested-Fragment) children are unconditionally
 * CO-RENDERED (one alternative, all of them — see `fragmentChildElements`); a ternary's two
 * sides, and `||`/`??`'s two sides, are MUTUALLY EXCLUSIVE (one alternative each, recursively
 * flattened, since either side could itself be a Fragment or a nested conditional). An arm that
 * renders no element (`null`, `undefined`, a boolean, a bare number/string literal, or a
 * genuinely empty/text-only Fragment) renders nothing — skipped, there's no host node for a
 * write to land on either way. Anything else (a bare identifier, `cloneElement(...)`, a
 * runtime-computed tag) is an opaque alternative we can't see into.
 *
 * `&&`'s LEFT side is a truthiness GUARD, not a rendered alternative at all (review finding,
 * PR #719 review round 2 — the first fix draft wrongly treated it as one, regressing the
 * extremely common `flag && <div className={x}/>` idiom to a false `low`): `cond && <div/>`
 * renders `<div/>` when `cond` is truthy and renders the falsy guard value (no host node)
 * otherwise — only the right side is ever a real DOM alternative, so the left is dropped
 * entirely rather than flattened in. `||`/`??` don't have this asymmetry: their left side IS a
 * genuine candidate render value when truthy/non-nullish (`icon || <Default/>`), so both sides
 * are flattened as real alternatives, same as a ternary.
 */
function flattenExclusiveAlternatives(expr: t.Expression): Alternative[] {
  if (rendersNoElement(expr)) return [];
  if (t.isJSXElement(expr)) return [{ roots: [expr], permissive: false }];
  if (t.isJSXFragment(expr)) {
    const { elements, hasUnresolvedContent } = fragmentChildElements(expr);
    // A genuinely empty (or all-text) Fragment renders nothing, exactly like `null`/`false` —
    // skip it, don't treat it as an opaque alternative (review finding, PR #719 review round 5,
    // Opus #1: `cond ? <div className={x}/> : <></>` used to resolve `low` here while the
    // equivalent `: null` / `: false` correctly resolved `high`).
    if (elements.length === 0 && !hasUnresolvedContent) return [];
    return [{ roots: elements, permissive: hasUnresolvedContent }];
  }
  if (t.isConditionalExpression(expr)) {
    return [...flattenExclusiveAlternatives(expr.consequent), ...flattenExclusiveAlternatives(expr.alternate)];
  }
  if (t.isLogicalExpression(expr)) {
    if (expr.operator === '&&') return flattenExclusiveAlternatives(expr.right);
    return [...flattenExclusiveAlternatives(expr.left as t.Expression), ...flattenExclusiveAlternatives(expr.right)];
  }
  return [null];
}

/**
 * A Fragment's direct `JSXElement` (and nested `JSXFragment`) children are unconditionally
 * co-rendered — collected into `elements`. Anything else in an expression-container child (a
 * ternary/`&&`/`||` conditional, a `.map(...)` call, a bare identifier, …) is deliberately NEVER
 * traced or extracted here, even though it MIGHT itself contain a carrying JSX element —
 * `hasUnresolvedContent` just flags that such content exists, for the caller to downgrade a
 * would-be exclusion to `unknown`.
 *
 * An earlier fix attempt (review round 3, P2) DID recursively flatten and fold every element
 * reachable through such a container into this same always-co-rendered `elements` list. That
 * reintroduced exactly the bug this whole mutually-exclusive-alternatives model exists to close
 * (review round 4, Opus P1 / Fable P1 / k3 P2): `<>{cond ? <A className={x}/> : <B/>}</>`'s two
 * ternary arms are MUTUALLY EXCLUSIVE — only one ever renders — but folding both into one flat
 * co-rendered list made `roots.some(carries)` true unconditionally (via `A`), producing a
 * confident HIGH positive even on the render where `B` (which doesn't carry) is the one that
 * actually shows up. A nested `.map(...)` or `<>` has the same hazard for the SAME reason a
 * plain top-level ternary does — mutual exclusivity (or, for `.map`, an unknown/zero-or-more
 * cardinality) cannot be safely flattened into a "some" check. Never re-add this extraction;
 * `permissive` (a "might carry, never confidently doesn't" downgrade) is the only sound way to
 * account for content this function can't fully resolve.
 */
function fragmentChildElements(expr: t.JSXFragment): { elements: t.JSXElement[]; hasUnresolvedContent: boolean } {
  const elements: t.JSXElement[] = [];
  let hasUnresolvedContent = false;
  for (const child of expr.children) {
    if (t.isJSXElement(child)) {
      elements.push(child);
      continue;
    }
    if (t.isJSXFragment(child)) {
      const nested = fragmentChildElements(child);
      elements.push(...nested.elements);
      if (nested.hasUnresolvedContent) hasUnresolvedContent = true;
      continue;
    }
    if (!t.isJSXExpressionContainer(child) || t.isJSXEmptyExpression(child.expression)) continue;
    // `{null}`/`{false}`/a bare identifier or member read (`{title}`, `{props.title}`) rendered
    // as TEXT content — none of these can hide a JSX element, so they're not unresolved (review
    // finding, PR #719 review round 4: an earlier version flagged every non-literal expression
    // here, wrongly downgrading plain text children to `unknown`).
    if (!mightRenderJsx(child.expression)) continue;
    hasUnresolvedContent = true;
  }
  return { elements, hasUnresolvedContent };
}

// --- attribute-forward search ------------------------------------------------------------

function rootAttributesCarryChannel(
  root: t.JSXElement,
  destructure: DestructureInfo,
  channel: Channel,
  bindings: Map<string, t.Expression>,
): boolean {
  for (const attr of root.openingElement.attributes) {
    if (t.isJSXSpreadAttribute(attr)) {
      if (spreadCarriesChannel(attr.argument, destructure)) return true;
    } else if (t.isJSXAttribute(attr) && attrNameIs(attr, channel)) {
      if (attributeValueReferencesLocal(attr.value, destructure, bindings)) return true;
    }
  }
  return false;
}

function attrNameIs(attr: t.JSXAttribute, channel: Channel): boolean {
  return t.isJSXIdentifier(attr.name) && attr.name.name === channel;
}

/** `{...rest}` carries the channel only when it wasn't ALSO explicitly destructured out (1c);
 *  `{...props}` (the whole, non-destructured param) always carries it. */
function spreadCarriesChannel(arg: t.Expression, destructure: DestructureInfo): boolean {
  if (!t.isIdentifier(arg)) return false;
  if (destructure.hasRest && !destructure.explicit && arg.name === destructure.restLocalName) return true;
  if (destructure.wholeProps && arg.name === destructure.wholePropsLocalName) return true;
  return false;
}

function attributeValueReferencesLocal(
  value: t.JSXAttribute['value'],
  destructure: DestructureInfo,
  bindings: Map<string, t.Expression>,
): boolean {
  if (!destructure.explicit || !destructure.localName) return false;
  if (!value || !t.isJSXExpressionContainer(value)) return false;
  if (t.isJSXEmptyExpression(value.expression)) return false;
  return deepReferencesIdentifier(value.expression, destructure.localName, bindings, new Set());
}

/**
 * Does this expression subtree reference `name` ANYWHERE — a deep walk covering the common
 * className/style merge shapes (`cn(...)`, `clsx(...)`, `cva()`-style nested object args,
 * template literals, ternaries, and TS's non-null/`as`/`satisfies`/angle-bracket type-assertion
 * wrappers) without needing to pattern-match each one by name. Deliberately never descends into a
 * nested function's own body (would risk crossing a shadowing scope) — a merge helper's arguments
 * are still plain expressions, so this still finds `cn(x, className)`.
 *
 * Also follows a bare identifier through ONE local `const` binding at a time (`bindings`, a
 * per-return-path snapshot built by `walkStatementsForReturns`) — `const merged = cn('base',
 * className); return <div className={merged}/>` reaches `className` through `merged`'s
 * initializer (review finding, HYP-1229 PR #719 P2). `visiting` guards against a
 * self-referential/cyclic binding chain.
 *
 * Checks `bindings` BEFORE matching on spelling, not after (review finding, PR #719 review round
 * 6, Fable P2): a LOCAL declaration can legally reuse the channel's OWN name inside a narrower
 * block (`if (dark) { const className = darkTheme.cls; return <div className={className}/>; }`
 * inside a component that also destructures an outer `className` prop) — that `className`
 * refers to the SHADOWING local, never the prop, even though the spelling matches. Resolving
 * through `bindings` first means a shadowed name is traced through its OWN initializer (finding
 * it does NOT reach `name`) instead of trivially short-circuiting `true` on the coincidental
 * spelling match.
 */
function deepReferencesIdentifier(
  node: t.Node | null | undefined,
  name: string,
  bindings: Map<string, t.Expression>,
  visiting: Set<string>,
): boolean {
  if (!node) return false;
  if (t.isIdentifier(node)) {
    if (visiting.has(node.name)) return false;
    const bound = bindings.get(node.name);
    if (bound) {
      visiting.add(node.name);
      return deepReferencesIdentifier(bound, name, bindings, visiting);
    }
    return node.name === name;
  }
  if (t.isCallExpression(node))
    return node.arguments.some((a) => deepReferencesIdentifier(a as t.Node, name, bindings, visiting));
  if (t.isObjectExpression(node))
    return node.properties.some((p) => deepReferencesIdentifier(p, name, bindings, visiting));
  if (t.isObjectProperty(node)) return deepReferencesIdentifier(node.value as t.Node, name, bindings, visiting);
  if (t.isArrayExpression(node))
    return node.elements.some((el) => deepReferencesIdentifier(el, name, bindings, visiting));
  if (t.isSpreadElement(node)) return deepReferencesIdentifier(node.argument, name, bindings, visiting);
  if (t.isTemplateLiteral(node))
    return node.expressions.some((e) => deepReferencesIdentifier(e as t.Node, name, bindings, visiting));
  if (t.isConditionalExpression(node)) {
    return (
      deepReferencesIdentifier(node.test, name, bindings, visiting) ||
      deepReferencesIdentifier(node.consequent, name, bindings, visiting) ||
      deepReferencesIdentifier(node.alternate, name, bindings, visiting)
    );
  }
  if (t.isLogicalExpression(node) || t.isBinaryExpression(node)) {
    return (
      deepReferencesIdentifier(node.left as t.Node, name, bindings, visiting) ||
      deepReferencesIdentifier(node.right, name, bindings, visiting)
    );
  }
  if (t.isUnaryExpression(node)) return deepReferencesIdentifier(node.argument, name, bindings, visiting);
  if (
    t.isTSNonNullExpression(node) ||
    t.isTSAsExpression(node) ||
    t.isTSSatisfiesExpression(node) ||
    t.isTSTypeAssertion(node)
  ) {
    return deepReferencesIdentifier(node.expression, name, bindings, visiting);
  }
  return false;
}

/** Does any DESCENDANT (not the root itself) carry the channel? Recurses through nested JSX and
 *  Fragments; an expression-container child whose expression `mightRenderJsx` is reported
 *  `unresolved` rather than searched into (same conservative, non-extracting treatment as
 *  `fragmentChildElements`, applied at any nesting depth — review finding, PR #719 review round
 *  4, P2 second half: `<div>{items.map((i) => <span className={x}/>)}</div>` used to be silently
 *  invisible to this walk, risking a false confident exclusion from the caller). Plain text
 *  content (`{title}`, `{props.title}`) is NOT flagged unresolved — see `mightRenderJsx`. */
function descendantCarriesChannel(
  root: t.JSXElement,
  destructure: DestructureInfo,
  channel: Channel,
  bindings: Map<string, t.Expression>,
): DescendantScan {
  return root.children.reduce<DescendantScan>((acc, child) => {
    const c = elementOrFragmentCarriesChannel(child, destructure, channel, bindings);
    return { carries: acc.carries || c.carries, unresolved: acc.unresolved || c.unresolved };
  }, NO_DESCENDANT_MATCH);
}

function elementOrFragmentCarriesChannel(
  child: t.JSXElement['children'][number],
  destructure: DestructureInfo,
  channel: Channel,
  bindings: Map<string, t.Expression>,
): DescendantScan {
  if (t.isJSXElement(child)) {
    if (rootAttributesCarryChannel(child, destructure, channel, bindings)) return { carries: true, unresolved: false };
    return descendantCarriesChannel(child, destructure, channel, bindings);
  }
  if (t.isJSXFragment(child)) {
    return child.children.reduce<DescendantScan>((acc, c) => {
      const r = elementOrFragmentCarriesChannel(c, destructure, channel, bindings);
      return { carries: acc.carries || r.carries, unresolved: acc.unresolved || r.unresolved };
    }, NO_DESCENDANT_MATCH);
  }
  if (
    t.isJSXExpressionContainer(child) &&
    !t.isJSXEmptyExpression(child.expression) &&
    mightRenderJsx(child.expression)
  ) {
    return { carries: false, unresolved: true };
  }
  return NO_DESCENDANT_MATCH;
}

// --- "is this channel's binding used ANYWHERE" (for the type-corroboration step) ----------

/**
 * Does the channel's own bound local identifier (the explicit name, the rest name, or the
 * whole-props name — whichever destructure shape exposes it) appear ANYWHERE in the render body
 * as a genuine value reference, not just at a JSX root/descendant attribute? Consumed by
 * `forward-detect.ts`'s type-corroboration step to distinguish two very different `low` outcomes
 * from `traceChannelForward`: "the identifier IS used, just spread into something opaque this
 * tracer can't see through" (a genuine ambiguity worth trusting the type signal for) vs "the
 * render body provably never touches the identifier at all" (`return <div />` with a whole-props
 * param that's never referenced) — a type declaration alone must never manufacture a high
 * positive for the latter; the spec (§9.2a) requires the typed prop to also be forwarded, not
 * merely declared. Review finding, HYP-1229 PR #719 P2 (forward-detect-type.ts).
 *
 * Refinements from later review rounds tighten what counts as "referenced":
 *  - Round 3, P1: a same-named identifier in a non-reference AST position — the property name of
 *    a non-computed member access (`theme.className`, an unrelated object) or a non-shorthand
 *    object-property KEY (`{ className: 'x' }`) — is a coincidental spelling match, not an actual
 *    reference to our binding. Excluded for both destructure shapes.
 *  - Round 3, P1 → round 4, P2 → round 5, P2/P3: for a WHOLE-PROPS/REST binding, a narrow member
 *    read of ANY property (`props.children`, `props.className`, `props['className']`,
 *    `props?.className`) is NOT reliable evidence the channel flows anywhere: reading a property
 *    — however it's spelled, computed or optional-chained — only proves the VALUE was read, not
 *    where it goes next (`const x = props.className; return <div>{x}</div>;` renders it as text —
 *    semantically identical to the explicit-destructure shape `function Comp({ className }) {
 *    return <div>{className}</div>; }`, which the trace correctly grades a confident negative;
 *    the corroboration gate must treat the whole-props version the same way, not flip on
 *    destructure style or member-access syntax). Only WHOLE-OBJECT flow (a spread, a bare call
 *    argument, a JSX attribute value passing the whole object, …) counts.
 */
export function channelBindingReferencedAnywhere(fn: t.Function, destructure: DestructureInfo): boolean {
  const name = boundLocalName(destructure);
  if (!name) return false;
  if (destructure.explicit) return subtreeReferencesIdentifier(fn.body, name);
  return subtreeReferencesAsWholeObjectFlow(fn.body, name);
}

/** True when `parent` makes `id` a non-reference position: the PROPERTY name of a member access
 *  (plain or optional-chained, computed or not), a non-shorthand object-property KEY, or an
 *  object/class method's KEY — all can coincidentally share a name with our binding without
 *  actually referencing it. */
function isNonReferencePosition(id: t.Node, parent: t.Node | undefined): boolean {
  if (!parent) return false;
  if (
    (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) &&
    !parent.computed &&
    parent.property === id
  ) {
    return true;
  }
  if ((t.isObjectProperty(parent) || t.isObjectMethod(parent)) && !parent.computed && parent.key === id) {
    return !(t.isObjectProperty(parent) && parent.shorthand);
  }
  if (t.isClassMethod(parent) && !parent.computed && parent.key === id) return true;
  return false;
}

const FUNCTION_LIKE_TYPES: ReadonlySet<string> = new Set([
  'FunctionDeclaration',
  'FunctionExpression',
  'ArrowFunctionExpression',
  'ObjectMethod',
  'ClassMethod',
  'ClassPrivateMethod',
]);

/** Does this function-like node's OWN params bind `name`, shadowing an outer binding of the same
 *  name (`const render = (className: string) => ...` inside a component that also has an outer
 *  `className`)? A cheap, deliberately loose check — any Identifier anywhere in the params
 *  subtree, not just true binding positions — erring toward OVER-detecting a shadow (skipping a
 *  scope we didn't strictly need to) is the safe direction for a corroboration-eligibility gate:
 *  worst case we miss a legitimate deeper reference and stay `low`, never manufacture a false
 *  positive. Review finding, PR #719 review round 4, Opus #1: the corroboration gate used to
 *  descend into nested function bodies with no shadowing awareness at all (unlike
 *  `deepReferencesIdentifier`, which deliberately never crosses into a nested function's scope),
 *  so a same-named inner param coincidentally satisfied the gate for an outer channel the render
 *  body never actually forwards. */
function paramsShadow(params: t.Node[], name: string): boolean {
  return params.some((p) => subtreeReferencesIdentifier(p, name));
}

/** Generic deep walk via Babel's own `VISITOR_KEYS` child-key metadata — avoids hand-listing
 *  every node type's children (unlike `deepReferencesIdentifier`, which purposefully stops at
 *  known merge-expression shapes; this one needs to see everything). Never descends into a
 *  nested function's params/body when that function's own params shadow `name` (see
 *  `paramsShadow`) — matches `deepReferencesIdentifier`'s scope discipline. A closure that
 *  legitimately references the OUTER binding (`items.map((item) => <div
 *  className={className}/>)`, no shadowing) is still found — only the shadowed case is skipped. */
function subtreeReferencesIdentifier(node: t.Node | null | undefined, name: string, parent?: t.Node): boolean {
  if (!node) return false;
  if (t.isIdentifier(node) && node.name === name && !isNonReferencePosition(node, parent)) return true;
  if (FUNCTION_LIKE_TYPES.has(node.type) && 'params' in node && paramsShadow(node.params as t.Node[], name)) {
    return false;
  }
  const keys = (t.VISITOR_KEYS as Record<string, string[] | undefined>)[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && subtreeReferencesIdentifier(child as t.Node, name, node)) return true;
      }
    } else if (value && typeof value === 'object') {
      if (subtreeReferencesIdentifier(value as t.Node, name, node)) return true;
    }
  }
  return false;
}

/** True when `parent` is a `VariableDeclarator` that NARROWS the whole-props/rest object `node`
 *  down to individual properties rather than passing it along whole: a plain alias (`const p =
 *  props`) or a destructure with no rest element (`const { className } = props`) — the SAME
 *  "narrow read, not whole-object flow" concern the member-access exclusion above covers, just
 *  spelled with destructuring/aliasing instead of `.`/`[]` (review finding, PR #719 review round
 *  6, Fable P1: `const { className } = props; return <div>{className}</div>;` and `const p =
 *  props; return <div>{p.className}</div>;` both rendered the value as TEXT — never an attribute
 *  — yet passed the OLD gate, letting the type step upgrade them to a false high positive). A
 *  destructure WITH a rest element (`const { children, ...rest } = props`) still counts as
 *  flow — `rest` itself carries the remaining shape onward, same as an object-literal spread. */
function narrowsWholeObject(parent: t.Node | undefined): boolean {
  if (!parent || !t.isVariableDeclarator(parent)) return false;
  if (t.isIdentifier(parent.id)) return true; // plain alias
  if (t.isObjectPattern(parent.id)) return !parent.id.properties.some((p) => t.isRestElement(p));
  return false;
}

/** Same walk as `subtreeReferencesIdentifier`, but for a whole-props/rest binding: a genuine
 *  reference that's the OBJECT of a member access (plain OR optional-chained, computed OR not —
 *  `props.x`, `props['x']`, `props?.x`, `props?.['x']`) is a NARROW read of one property's value,
 *  never evidence the value flows further — excluded regardless of which property is being read
 *  or how the access is spelled (see `channelBindingReferencedAnywhere`'s doc comment, rounds 4
 *  and 5). Same for a plain alias or a no-rest destructure (`narrowsWholeObject`, round 6, Fable
 *  P1). Every other reference position (a spread argument, a bare call argument, a JSX attribute
 *  value, a rest-carrying destructure, …) counts as a genuine whole-object flow. Same
 *  shadowed-nested-function skip as `subtreeReferencesIdentifier` (round 4, Opus #1). */
function subtreeReferencesAsWholeObjectFlow(node: t.Node | null | undefined, name: string, parent?: t.Node): boolean {
  if (!node) return false;
  if (t.isIdentifier(node) && node.name === name && !isNonReferencePosition(node, parent)) {
    if (parent && (t.isMemberExpression(parent) || t.isOptionalMemberExpression(parent)) && parent.object === node) {
      return false;
    }
    if (parent && t.isVariableDeclarator(parent) && parent.init === node && narrowsWholeObject(parent)) {
      return false;
    }
    return true;
  }
  if (FUNCTION_LIKE_TYPES.has(node.type) && 'params' in node && paramsShadow(node.params as t.Node[], name)) {
    return false;
  }
  const keys = (t.VISITOR_KEYS as Record<string, string[] | undefined>)[node.type] ?? [];
  for (const key of keys) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child === 'object' && subtreeReferencesAsWholeObjectFlow(child as t.Node, name, node))
          return true;
      }
    } else if (value && typeof value === 'object') {
      if (subtreeReferencesAsWholeObjectFlow(value as t.Node, name, node)) return true;
    }
  }
  return false;
}
