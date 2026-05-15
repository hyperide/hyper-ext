/**
 * @file Index-aware DOM walk-up for keyboard-driven parent navigation.
 *
 * Accessed via: vscode-extension iframe-interaction.ts (Shift+Enter handler).
 *   SaaS canvas (`client/`) does NOT currently consume this — its keyboard
 *   navigation goes through `useElementSelection` → `resolveIdsToUuids` and
 *   never hits a DOM walk-up, so the divergence cannot manifest there. If a
 *   future SaaS feature introduces a DOM walk-up, route it through this
 *   function (AGENTS.md: "Parent walk-up MUST be index-aware").
 *
 * Assumptions:
 * - `getSourceKey` returns the per-element mappedSource (no dedup awareness).
 * - `findElementsByRef` is FiberSourceIndex's lookup which DOES dedup —
 *   `shouldSkipNestedMappedSource` keeps only the OUTERMOST host fiber per
 *   mappedSource, so an intermediate host's per-element key may resolve to a
 *   different DOM element (the deduped outer host) or to nothing (if that
 *   outer host has been unmounted by HMR mid-walk).
 * - DOM `parentElement` chain cannot cycle (real DOM invariant); the walk
 *   has no max-depth guard. Custom non-DOM trees passed here will hang.
 *
 * Background — Shift+Enter selection-rect regression:
 *   Plan: docs/plans/2026-05-08-shift-enter-rect-ralphex-plan.md
 *   Diagnosis: docs/notes/2026-05-08-shift-enter-divergence.md
 *     (architecture map, key-derivation symmetry, dedup asymmetry,
 *     React 19 _debugStack note)
 *
 * Two consumers of `parentRef` after Shift+Enter:
 *   1. Inspector right-pane decodes the element type from the `file:line:col`
 *      ref string alone — works regardless of whether the rect path can find
 *      the DOM element.
 *   2. Selection-rect overlay calls `findElementsByRef(parentRef)` to position
 *      the rect; if no DOM element is found OR if the found element is a
 *      different ancestor than what the inspector was told about, the rect
 *      either vanishes or anchors to the wrong element.
 *
 * The naive walk-up (return any DOM ancestor with a non-null `getSourceKey`)
 * lets these two consumers diverge: inspector receives a key for an
 * intermediate host, but `findElementsByRef` for that key returns either the
 * deduped OUTER host (rect on a different element) or `[]` (rect vanishes).
 *
 * This walk-up is index-aware: only return an ancestor whose key resolves
 * back to itself in the index. The two paths agree by construction.
 */

export interface FindTraceableParentDeps {
  /**
   * Per-element source key derivation. Returns null if the element has no
   * traceable fiber source.
   */
  getSourceKey: (el: HTMLElement) => string | null;
  /**
   * Lookup all DOM elements registered under `ref`. MUST return the full set
   * (e.g. `findElementsByRef(ref, null)` in iframe-interaction.ts) — slicing
   * by itemIndex would hide the ancestor we are testing for membership.
   */
  findElementsByRef: (ref: string) => HTMLElement[];
  /**
   * Stop walking when this element is reached (typically `document.body`).
   */
  stopAt: HTMLElement;
}

/**
 * Optional trace step. `kind` describes why the step was skipped or accepted:
 * - `no-ref`: ancestor's getSourceKey returned null
 * - `not-indexed`: getSourceKey returned a ref but findElementsByRef did
 *   NOT include this ancestor (deduped or stale index entry)
 * - `match`: getSourceKey returned a ref AND findElementsByRef includes this
 *   ancestor — walk terminates here.
 */
export interface TraceableParentStep {
  tag: string;
  ref: string | null;
  kind: 'no-ref' | 'not-indexed' | 'match';
}

export interface TraceableParentResult {
  element: HTMLElement;
  ref: string;
}

/**
 * Walk DOM ancestors of `el` until we find one whose source key resolves back
 * to itself in the FiberSourceIndex. Returns null if no such ancestor exists.
 */
export function findTraceableParent(
  el: HTMLElement,
  deps: FindTraceableParentDeps,
  trace?: TraceableParentStep[],
): TraceableParentResult | null {
  let current = el.parentElement;
  while (current && current !== deps.stopAt) {
    const ref = deps.getSourceKey(current);
    if (ref === null) {
      if (trace) trace.push({ tag: current.tagName.toLowerCase(), ref: null, kind: 'no-ref' });
      current = current.parentElement;
      continue;
    }

    const indexed = deps.findElementsByRef(ref);
    if (indexed.includes(current)) {
      if (trace) trace.push({ tag: current.tagName.toLowerCase(), ref, kind: 'match' });
      return { element: current, ref };
    }

    if (trace) trace.push({ tag: current.tagName.toLowerCase(), ref, kind: 'not-indexed' });
    current = current.parentElement;
  }
  return null;
}
