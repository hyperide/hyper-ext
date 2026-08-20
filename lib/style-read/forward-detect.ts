/**
 * @file A1 — the forward-detector (HYP-1229; canonical spec home: docs/specs/2026-06-12-styles-
 * system-master-spec.md §9.2a; revised design: docs/plans/2026-08-14-hyp-1229-a1-forward-
 * detector-revised-plan.md).
 *
 * Answers, per element and per channel (`className` / `style`): does this element actually
 * forward the channel a write would use, or would the write land in a prop the component drops?
 * Consumed by `ElementStyleFacts.forwardDetection` (StyleReadService's read path — see
 * StyleReadService.ts's `buildElementFacts`), which projects it into
 * `componentPropSurface.acceptsClassName/.acceptsStyle` for today's already-wired L0-L3 ladder.
 *
 * ALGORITHM ORDER — deliberately NOT the literal §9.2a prose (type/LSP-first). Four review
 * findings on the first draft forced this order (revised plan §0):
 *   1. AST render-body trace (`forward-detect-trace.ts`'s `traceChannelForward`) is PRIMARY and
 *      unconditional — cheap (1-2 Babel-parsed files), and correctly resolves a discriminated-
 *      union `{...rest}` component (finding #1) without ever touching the type checker: JS
 *      destructuring semantics settle it, TS union typing is irrelevant. Since the trace walks
 *      EVERY top-level return and every ternary/`||`/`??` arm as its own mutually-exclusive
 *      alternative (see that file's header — `&&`'s left side is a guard, not an alternative), it
 *      also fully resolves the asChild/Slot dual-return shape (finding #2, below) on its own,
 *      with real per-channel attribute verification.
 *   2. Type/LSP corroboration (`forward-detect-type.ts`) runs ONLY when the trace is `low` AND
 *      the channel's own bound identifier is referenced SOMEWHERE in the render body (never for
 *      a render body that provably never touches it at all — review finding, PR #719 P2), and
 *      may only ever UPGRADE to `high` positive — never produce a negative, never downgrade.
 *
 * ROOT-vs-DESCENDANT (finding #4): a component whose render body attaches the channel to a
 * NESTED element rather than the actual returned root (`<div><span className={className}/></div>`)
 * is a pre-write EXCLUSION (`forwards-non-root-only`), not a positive — a blind write would land
 * on the wrong DOM node.
 *
 * asChild/Slot (finding #2, the shadcn/Radix flagship case): `detectAsChildSlotPattern`
 * (`forward-detect-recognizers.ts`) recognizes the idiom's shape but is deliberately NOT wired
 * as a verification bypass here — recognizing the shape alone is not evidence of forwarding (a
 * `<Comp/>` Slot-ternary tag with zero attributes recognizes the shape and forwards nothing;
 * review finding, PR #719 P2). Both idiom shapes (the ternary tag AND the dual early-return) are
 * fully covered by the general trace above with real attribute verification, so the recognizer
 * is currently exercised only by its own tests. HYP-1235 rewired the ext's write-path pre-check
 * (`style-forwarding-check.ts`) onto `detectForwarding` (this file); that file's own header
 * explains how it collapses these per-channel results into its pre-plan admit/exclude gate, and
 * states the deliberate risk-acceptance for the open false-exclusion P2s below now that they can
 * produce a write refusal, not just a stale read-path fact.
 * `lib/style-write/component-forwarding.ts` (consumed by the shared executor's HYP-995
 * channel-precise refusal, `style-write-executor.ts`) still runs its OWN older, coarser PER-PROP
 * check — unifying that per-prop analysis onto `detectForwarding`'s richer trace is a tracked
 * follow-up, not done here. Its LOCATION-resolution fallback for local monorepo workspace packages
 * is NOT a gap anymore — HYP-1235 moved it to the shared, security-hardened
 * `lib/ast/workspace-package-entry.ts`, which both `component-forwarding.ts` and this file's own
 * `forward-detect-locate.ts` now call. styled-components is still a narrow, separately-testable
 * recognizer matching a KNOWN library contract — not a general
 * `cloneElement`/HOC tracer. General `cloneElement` outside the Slot idiom, class components,
 * context-based compound components (`<Select.Trigger/>`), and prop-getter hooks (React Aria /
 * Downshift — spreading an OPAQUE hook return, not the component's own destructured binding) are
 * documented non-goals: they fall to `low` confidence, NEVER a false high-confidence exclusion.
 */
import type * as t from '@babel/types';
import type { FileIO } from '../ast/file-io';
import { corroborateChannelViaType } from './forward-detect-type';
import { type LocatedComponent, locateComponentDeclaration } from './forward-detect-locate';
import {
  type Channel,
  type ChannelOutcome,
  analyzeDestructure,
  channelBindingReferencedAnywhere,
  traceChannelForward,
} from './forward-detect-trace';
import type { ComponentPropSurfaceFacts } from './types';

/** @public — see the file header; the spec §9.2a canonical interface, unchanged verbatim. */
export interface ForwardDetectorResult {
  forwardsClassName: boolean;
  forwardsStyle: boolean;
  hostProp: string | null;
  confidence: 'high' | 'low';
  excludedReason?: 'no-host-forward' | 'forwards-non-root-only';
}

/**
 * TRAP for a future reader/consumer (e.g. the A2 planner): `confidence`/`excludedReason` are
 * PER-CHANNEL (independently traced), but `buildResults` mirrors the SAME `forwardsClassName`
 * AND `forwardsStyle` booleans into BOTH `.className` and `.style` — i.e. `.className` carries
 * className's own confidence but ALSO the separately-traced style verdict in `forwardsStyle`
 * (and vice versa for `.style`). Always read `.className.forwardsClassName` /
 * `.style.forwardsStyle` — the field matching the object you're already indexed into — never
 * the cross field (`.className.forwardsStyle` is NOT "style confidence at className's channel",
 * it's style's OWN independently-traced verdict, just paired with className's confidence).
 */
export interface ForwardDetectionResults {
  className: ForwardDetectorResult;
  style: ForwardDetectorResult;
}

export interface ForwardDetectionInput {
  /** Parsed AST of the file containing the JSX usage. */
  ast: t.File;
  /** Absolute path of the file containing the JSX usage. */
  filePath: string;
  /** The JSX element a style write is being considered against. */
  element: t.JSXElement;
  fileIO: FileIO;
  /** tsconfig path-alias map for `filePath`'s project (empty map = relative-only resolution). */
  aliasMap: Record<string, string>;
  /**
   * Test seam / perf opt-out: skip step 2 (type corroboration) entirely. Real callers should
   * leave this unset — step 2 only ever fires when step 1 is `low`, which self-limits the
   * `ts.createProgram` cost. Tests whose fixtures live only in an in-memory `FileIO` (not real
   * disk) should set this — that call can only ever return `unknown` anyway (see
   * forward-detect-type.ts's realm-scoping note), so skipping avoids the cold-start cost.
   */
  skipTypeCorroboration?: boolean;
}

const HIGH_POSITIVE: ChannelOutcome = { forwards: true, confidence: 'high' };
const LOW_UNKNOWN: ChannelOutcome = { forwards: true, confidence: 'low' };

export async function detectForwarding(input: ForwardDetectionInput): Promise<ForwardDetectionResults> {
  const tagName = leftmostJsxTagName(input.element.openingElement.name);
  if (!tagName || !isCustomComponentTag(tagName)) {
    return buildResults(HIGH_POSITIVE, HIGH_POSITIVE);
  }

  const located = await locateComponentDeclaration(input, tagName);
  if (!located) return buildResults(LOW_UNKNOWN, LOW_UNKNOWN);

  const styledOutcome = await outcomeForStyledFactory(located, input);
  if (styledOutcome) return buildResults(styledOutcome.className, styledOutcome.style);
  if (!located.fnNode) return buildResults(LOW_UNKNOWN, LOW_UNKNOWN);

  const classNameOutcome = resolveChannel(located.fnNode, located, 'className', input);
  const styleOutcome = resolveChannel(located.fnNode, located, 'style', input);
  return buildResults(classNameOutcome, styleOutcome);
}

/** Per-channel pair, mirroring `ForwardDetectionResults`'s shape but before the public projection. */
interface StyledFactoryOutcome {
  className: ChannelOutcome;
  style: ChannelOutcome;
}

/**
 * Null when `located` isn't a styled-components factory (fall through to the render-body trace).
 *
 * HYP-1234: `styled(UppercaseComponent)` only carries the "always injects onto a real DOM node"
 * guarantee if the wrapped component itself forwards — locate and trace it, bounded to exactly
 * ONE level. If the wrapped component is itself another styled-components factory
 * (`styled(styled(X))`), this deliberately does NOT recurse a second time: `resolveChannel` below
 * requires an `fnNode`, which a nested styled factory never has (see `LocatedComponent.fnNode`'s
 * doc comment), so that case falls through to LOW_UNKNOWN for free without an explicit depth
 * check. className and style are traced INDEPENDENTLY, exactly like the non-styled path below —
 * do NOT collapse them to one shared verdict the way the trivial `styled.tag(...)` case does: a
 * `resolveChannel` trace can produce a high-confidence NEGATIVE (`no-host-forward`,
 * `forwards-non-root-only`), and mirroring a negative traced for one channel onto the other
 * channel (which was never actually traced) would manufacture exactly the false high-confidence
 * exclusion the file header's "documented non-goals" paragraph forbids — and since HYP-1235 wired
 * this detector into the ext write-path's pre-write admit/exclude gate, a false exclusion here is
 * a real write refusal, not just a stale read-path fact.
 */
async function outcomeForStyledFactory(
  located: LocatedComponent,
  input: ForwardDetectionInput,
): Promise<StyledFactoryOutcome | null> {
  if (!located.styledComponentsFactory) return null;
  // `styled.tag(...)` / `styled('div')` always inject onto a real DOM node — trust unconditionally.
  if (!located.styledWrapsComponentTag) return { className: HIGH_POSITIVE, style: HIGH_POSITIVE };

  // Scope cut (review finding, HYP-1234 PR): `input.aliasMap` is the OUTER call site's project
  // aliasMap, reused as-is even though `located.declarationFilePath` may sit in a different
  // package (e.g. a workspace package) with its own tsconfig aliases. Fails open — a wrap target
  // reachable only via that package's own alias resolves to LOW_UNKNOWN, never a false positive
  // — matching the single-project scope the outer locate already has.
  const inner = await locateComponentDeclaration(
    { ast: located.fileAst, filePath: located.declarationFilePath, fileIO: input.fileIO, aliasMap: input.aliasMap },
    located.styledWrapsComponentTag,
  );
  if (!inner) return { className: LOW_UNKNOWN, style: LOW_UNKNOWN };
  // `styled(Base)` where `Base` is ITSELF `styled.tag(...)`/`styled('div')` (never
  // `styled(AnotherWrapped)`, which stays bounded to one level per the file header) — `inner` is
  // already fully classified above without a second recursive hop, so reuse that trusted verdict
  // instead of falling through to the generic `!inner.fnNode` bail (review finding: this is a
  // real, free positive, not an unbounded recursion — a nested `styled(Component)` wrap still has
  // no `fnNode` and correctly stays LOW_UNKNOWN below).
  if (inner.styledComponentsFactory) {
    return inner.styledWrapsComponentTag
      ? { className: LOW_UNKNOWN, style: LOW_UNKNOWN }
      : { className: HIGH_POSITIVE, style: HIGH_POSITIVE };
  }
  if (!inner.fnNode) return { className: LOW_UNKNOWN, style: LOW_UNKNOWN };
  return {
    className: resolveChannel(inner.fnNode, inner, 'className', input),
    style: resolveChannel(inner.fnNode, inner, 'style', input),
  };
}

function resolveChannel(
  fnNode: t.Function,
  located: LocatedComponent,
  channel: Channel,
  input: ForwardDetectionInput,
): ChannelOutcome {
  const destructure = analyzeDestructure(fnNode.params, channel);
  const traced = traceChannelForward(fnNode, destructure, channel);
  if (traced.confidence === 'high' || input.skipTypeCorroboration) return traced;
  // A `low` verdict that already has AST PROOF at least one mutually-exclusive branch does NOT
  // forward (review round 3, P1) must never be upgraded — a type declaration is evidence the prop
  // EXISTS, never evidence a SPECIFIC branch attaches it, so it can't refute concrete proof that
  // one already doesn't. Without this, the whole mixed-branch fix in forward-detect-trace.ts was
  // silently undone one step later: the identifier IS referenced (in the carrying branch) and the
  // type DOES declare it, so the plain "referenced anywhere" gate below alone still passed.
  if (traced.provenPartialExclusion) return traced;
  // Never let a type declaration alone manufacture a positive when the render body provably
  // never touches the channel's bound identifier anywhere (review finding, PR #719 P2,
  // forward-detect-type.ts) — only corroborate a `low` verdict that already has SOME textual
  // evidence the identifier flows somewhere this tracer just couldn't follow.
  if (!channelBindingReferencedAnywhere(fnNode, destructure)) return traced;
  return maybeCorroborateWithType(traced, located, channel);
}

/** Step 2 — corroboration only: may upgrade `low` to `high` positive, never downgrades/excludes. */
function maybeCorroborateWithType(
  outcome: ChannelOutcome,
  located: LocatedComponent,
  channel: Channel,
): ChannelOutcome {
  const verdict = corroborateChannelViaType(located.declarationFilePath, located.componentName, channel);
  return verdict === 'declared' ? HIGH_POSITIVE : outcome;
}

function buildResults(classNameOutcome: ChannelOutcome, styleOutcome: ChannelOutcome): ForwardDetectionResults {
  const shared = { forwardsClassName: classNameOutcome.forwards, forwardsStyle: styleOutcome.forwards, hostProp: null };
  return {
    className: { ...shared, confidence: classNameOutcome.confidence, excludedReason: classNameOutcome.excludedReason },
    style: { ...shared, confidence: styleOutcome.confidence, excludedReason: styleOutcome.excludedReason },
  };
}

/**
 * Projects the richer `ForwardDetectionResults` down to the plain-boolean shape the already-wired
 * L0-L3 stylability ladder reads (`lib/style-write/stylability-ladder.ts`) — `true` unless A1 found
 * a HIGH-CONFIDENCE negative for that channel (per HYP-1229 plan §2/§6: low confidence never blocks,
 * it's admitted as `probable` and left for a future B1 runtime verify to arbitrate).
 *
 * Shared (HYP-1280 parity) — both StyleReadService.ts (VS Code extension) and the SaaS server-side
 * read route project the SAME detection output the SAME way, so `componentPropSurface` never drifts
 * per platform. The non-forwarding fields (`acceptsCssProp`/`acceptsSxProp`/`recursivePropsSchemaAvailable`/
 * `styleLikeProps`/`semanticProps`) are outside A1's scope (className/style only) and always default —
 * a real value there requires an adapter-specific prop-mapper facts source neither caller has yet.
 */
export function projectForwardDetectionToPropSurface(detection: ForwardDetectionResults): ComponentPropSurfaceFacts {
  const classNameExcluded = detection.className.confidence === 'high' && !detection.className.forwardsClassName;
  const styleExcluded = detection.style.confidence === 'high' && !detection.style.forwardsStyle;
  return {
    acceptsClassName: !classNameExcluded,
    acceptsStyle: !styleExcluded,
    acceptsCssProp: false,
    acceptsSxProp: false,
    recursivePropsSchemaAvailable: false,
    styleLikeProps: [],
    semanticProps: [],
  };
}

function isCustomComponentTag(tagName: string): boolean {
  return /^[A-Z]/.test(tagName);
}

/** Leftmost JSX identifier of a tag name (`<Foo.Bar>` → `Foo`) — the base component identity. */
function leftmostJsxTagName(name: t.JSXOpeningElement['name']): string | null {
  let current = name;
  while (current.type === 'JSXMemberExpression') current = current.object;
  return current.type === 'JSXIdentifier' ? current.name : null;
}
