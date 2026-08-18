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
 * is currently exercised only by its own tests, kept for the HYP-1235 unification with the ext's
 * older `style-forwarding-check.ts` copy (see that file's header). styled-components is still a
 * narrow, separately-testable recognizer matching a KNOWN library contract — not a general
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

  const styledOutcome = outcomeForStyledFactory(located);
  if (styledOutcome) return buildResults(styledOutcome, styledOutcome);
  if (!located.fnNode) return buildResults(LOW_UNKNOWN, LOW_UNKNOWN);

  const classNameOutcome = resolveChannel(located.fnNode, located, 'className', input);
  const styleOutcome = resolveChannel(located.fnNode, located, 'style', input);
  return buildResults(classNameOutcome, styleOutcome);
}

/** Null when `located` isn't a styled-components factory (fall through to the render-body trace). */
function outcomeForStyledFactory(located: LocatedComponent): ChannelOutcome | null {
  if (!located.styledComponentsFactory) return null;
  // `styled.tag(...)` / `styled('div')` always inject onto a real DOM node — trust unconditionally.
  // `styled(UppercaseComponent)` only holds that guarantee if the wrapped component itself
  // forwards; the one-level recursive check the plan calls for is HYP-1234 (not built here —
  // scope cut to avoid an untested recursive path), so this stays conservative (low, never a
  // blind high) until then.
  return located.styledWrapsComponentTag ? LOW_UNKNOWN : HIGH_POSITIVE;
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

function isCustomComponentTag(tagName: string): boolean {
  return /^[A-Z]/.test(tagName);
}

/** Leftmost JSX identifier of a tag name (`<Foo.Bar>` → `Foo`) — the base component identity. */
function leftmostJsxTagName(name: t.JSXOpeningElement['name']): string | null {
  let current = name;
  while (current.type === 'JSXMemberExpression') current = current.object;
  return current.type === 'JSXIdentifier' ? current.name : null;
}
