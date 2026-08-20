/**
 * @file D3 stylability ladder — resolves a write rung per element, per property
 *
 * STATUS (read this): STAGED for the `ast:updateStylesBatch` host handler — NOT yet consulted on the
 *   live write path. The live batch route (updateComponentStylesBatch) picks the write owner per
 *   element via the executor's existing AST-driven `getElementCssSystems` resolution, not this ladder;
 *   per-rung channel dispatch (L1 'styles' vs L0/L2 'props') is the host-handler v1 contract (HYP-664)
 *   and lands with it (HYP-535 transport gate). Pure resolver kept here so the handler layers onto it
 *   without re-deriving the L0/L1/L2/L3 rules — deferred-by-design, NOT dead code; do NOT delete.
 * Assumptions: surfaceDecision is produced host-side (decideSurface) and serialized on
 *   StyleReadResult; propSurfaceFacts come from the same read. Pure — no hooks, no IO.
 * Architecture: docs/specs/2026-06-11-270-d3-stylability-ladder.md §3
 *
 * The ladder, per element per property:
 *   L0 DS-NATIVE PROP — adapter-declared prop mapper → write via the props channel.
 *   L1 STYLE CHANNEL  — generic className/style/css/sx channel → write via the styles channel.
 *   L2 PARTIAL PROP   — styleLikeProps ∪ semanticProps covers THIS property → write it as a prop.
 *   L3 ESCALATE       — no surface for this property → excluded in v1 (escalation deferred).
 * L0/L1/L2 are non-destructive. Only L3 can mutate the tree, and L3 is opt-in + deferred.
 */

import type { ComponentPropSurfaceFacts, InspectorSurfaceDecision } from '@lib/style-read/types';

type StyleSurfaceRung = 'L0' | 'L1' | 'L2' | 'L3';

/** Which write path a resolved rung dispatches through inside the batch handler. */
export type StyleWriteChannel = 'styles' | 'props';

export interface StyleSurfaceResolution {
  rung: StyleSurfaceRung;
  /** Defined for L0/L1/L2; undefined for L3 (no write target). */
  channel?: StyleWriteChannel;
}

function partialPropCovers(facts: ComponentPropSurfaceFacts, property: string): boolean {
  return facts.styleLikeProps.includes(property) || facts.semanticProps.includes(property);
}

function acceptsAnyStyleChannel(facts: ComponentPropSurfaceFacts): boolean {
  return facts.acceptsClassName || facts.acceptsStyle || facts.acceptsCssProp || facts.acceptsSxProp;
}

/**
 * HYP-1294 — whether NO known style-write channel exists on this element's exposed prop surface
 * at all: no generic channel (className/style/css/sx via {@link acceptsAnyStyleChannel}) AND no
 * partial per-property cover (styleLikeProps/semanticProps). Equivalent to `resolveStyleSurface`
 * resolving to L3 for every property, MINUS the L0 rung (adapter-declared props), which needs a
 * host-computed `InspectorSurfaceDecision` this predicate deliberately doesn't require — a
 * browser-mode consumer has no such value today (the cross-realm gap tracked in HYP-664). A
 * `true` result here is therefore a conservative, host-agnostic "nothing known can reach this
 * element's DOM node with a style write" signal, safe to surface PROACTIVELY, before any write is
 * even attempted (the SaaS inspector's first live consumer of `componentPropSurface` — HYP-1294;
 * before this, the field was fetched/exposed on `ElementStyleData` but read by nothing shipped).
 * KNOWN LIMITATION (review finding, HYP-1294): an empty `styleLikeProps`/`semanticProps` is
 * treated identically whether or not `recursivePropsSchemaAvailable` is `true` — i.e. this
 * predicate cannot distinguish "the partial-prop surface was analyzed and is genuinely empty"
 * from "it was never analyzed at all". Every producer of `ComponentPropSurfaceFacts` today
 * (`projectForwardDetectionToPropSurface`) hardcodes `recursivePropsSchemaAvailable: false` and
 * both prop-cover arrays empty — there is no live case where gating on that field would change
 * today's verdict — so this is not gated on it now; a future prop-mapper source that actually
 * populates `recursivePropsSchemaAvailable: true` with a genuinely-empty cover should revisit
 * whether `false` there ought to soften this predicate's confidence.
 */
export function hasNoStyleWriteSurface(facts: ComponentPropSurfaceFacts): boolean {
  return !acceptsAnyStyleChannel(facts) && facts.styleLikeProps.length === 0 && facts.semanticProps.length === 0;
}

/**
 * Resolve the write rung for one element + one property.
 *
 * DS-native writes are adapter-declared ONLY (no "this prop looks like a style" inference,
 * D3 §3 / codex #8): L0 requires the explicit `adapter-known-prop-mapper` reason.
 */
export function resolveStyleSurface(
  surfaceDecision: InspectorSurfaceDecision,
  propSurfaceFacts: ComponentPropSurfaceFacts,
  property: string,
): StyleSurfaceResolution {
  // L0 — DS-native prop, adapter-declared. Preferred over a generic style channel.
  if (surfaceDecision.reasons.includes('adapter-known-prop-mapper')) {
    return { rung: 'L0', channel: 'props' };
  }

  // L1 — generic style channel (className / style= / css / sx).
  if (acceptsAnyStyleChannel(propSurfaceFacts)) {
    return { rung: 'L1', channel: 'styles' };
  }

  // L2 — a partial style/semantic prop covers THIS property.
  if (partialPropCovers(propSurfaceFacts, property)) {
    return { rung: 'L2', channel: 'props' };
  }

  // L3 — no surface for this property. Excluded + reported in v1 (escalation deferred).
  return { rung: 'L3' };
}
