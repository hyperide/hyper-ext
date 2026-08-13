/**
 * @file Shared source resolution logic for element click/hover.
 *
 * Accessed via: SaaS ElementTracer + Extension iframe-interaction.ts
 * Assumptions: fiber _debugSource available (React dev mode with Babel plugin).
 *
 * Handles the "own source vs dependency call site" problem:
 * - Elements whose own source is EDITABLE (any first-party project file) → use the
 *   element's own direct fiber source, regardless of how deep it sits below the
 *   previewed file. This is DEPTH-INDEPENDENT: previewing App.tsx and previewing
 *   Feed.tsx resolve Feed's <h1> to the same Feed.tsx location (HYP-1006).
 * - Elements whose own source is NOT editable (node_modules primitive internals like
 *   the <button> inside a design-system <Button>) → walk up the fiber to the nearest
 *   EDITABLE call site (where <Button> is used in first-party code). Collapse is a
 *   degradation for un-editable internals, not a statement about component boundaries.
 * See shared/element-tracing/editable-source.ts for the editability predicate + rationale.
 */

import { isEditableSourcePath } from '../element-tracing/editable-source';
import {
  debugSourceToLocation,
  type Fiber,
  getItemIndexFromFiber,
  parseDebugStack,
  recoverNonSyntheticSourceLocation,
} from '../element-tracing/fiber-internals';
import { isSyntheticPreviewPath } from '../element-tracing/synthetic-preview';
import type { SourceLocation } from '../element-tracing/types';

export interface ResolvedCallSiteTarget {
  source: SourceLocation;
  itemIndex: number;
}

// Deliberately does NOT take the source-map `resolveLocation` mapper. For the own-source
// (editable-leaf) path the item index is counted from the fiber ancestry, and React-19
// repeated instances share the SAME compiled `_debugStack` position among siblings, so raw
// `parseDebugStack` counting is already correct — the mapper adds nothing here. Threading the
// extension's stateful mapper in would also fire its cold-call-site + warm side-effects during
// pure index counting, which `resolveClickLocal` then reads as `coldCallSite` and drops the
// index to 0 with no retry (a repeated-instance regression). Keep this walk mapper-free.
function getAncestorItemIndex(fiber: Fiber, directItemIndex: number): number {
  let current: Fiber | null = fiber;
  for (let i = 0; i < 30 && current; i++) {
    const itemIndex = getItemIndexFromFiber(current);
    if (directItemIndex === 0 && itemIndex > 0) return itemIndex;
    current = current.return;
  }
  return directItemIndex;
}

/**
 * Resolve the effective source location for a clicked/hovered element.
 * Returns the element's own source when that source is editable (first-party);
 * otherwise walks up the fiber tree to the nearest editable call site (the element
 * is inside a non-editable dependency primitive).
 *
 * @param directSource - Source from the element's own fiber (_debugSource)
 * @param fiber - The element's React fiber
 * @param renderedFile - Currently rendered component path (e.g. "src/App.tsx"); used
 *   ONLY for synthetic-preview recovery, NOT for the editable/own-source decision.
 * @returns The resolved source (own source, or the nearest editable call site)
 */
export function resolveCallSiteSource(
  directSource: SourceLocation,
  fiber: Fiber | null,
  renderedFile: string | null,
  resolveLocation?: (fiber: Fiber) => SourceLocation | null,
): SourceLocation {
  return resolveCallSiteTarget(directSource, fiber, renderedFile, 0, resolveLocation).source;
}

/**
 * Resolve the effective source and item index for a clicked/hovered element.
 *
 * For imported component internals rendered from a repeated call site, the
 * direct DOM fiber often has itemIndex 0 because it is a singleton inside each
 * component instance. Once source resolution walks up to the call-site fiber,
 * itemIndex must be counted at that same call-site level.
 */
export function resolveCallSiteTarget(
  directSource: SourceLocation,
  fiber: Fiber | null,
  renderedFile: string | null,
  directItemIndex: number,
  // Optional source-map mapper (fiber → ORIGINAL SourceLocation | null). Callers with a
  // source-map cache (the extension iframe resolver) pass it so the React-19 `_debugStack`
  // ancestor branch resolves the call site in the SAME original-source coordinates as
  // `directSource`, instead of the RAW COMPILED `parseDebugStack` frame (a position in the
  // Vite/jsxDEV-transformed module that does not exist in the real file — HYP-970). Callers
  // without a mapper (SaaS adapter path, tests) keep the `parseDebugStack` fallback.
  resolveLocation?: (fiber: Fiber) => SourceLocation | null,
): ResolvedCallSiteTarget {
  // The synthetic preview entry (__canvas_preview__.tsx) is NEVER a valid go-to-code
  // target, but a direct source can itself BE synthetic (the call-site walk below only
  // rejects a synthetic ancestor, not a synthetic directSource — HYP-424). Recover the
  // rendered component's source from the fiber tree; if it isn't reachable,
  // recoverNonSyntheticSourceLocation returns null and we keep the synthetic directSource
  // as a retry sentinel (the click path defers it to the source-map warm-retry).
  // Recovery (above) already runs a thorough, React-19-aware ancestor+descendant scan
  // (walkFiberSourceCandidates / findDescendantSource, every _debugStack frame). If the
  // direct source STARTED synthetic and that scan still found nothing, the call-site
  // walk below must NOT retry with a looser "first different file" match — that would
  // commit an unrelated ancestor frame (e.g. the app entry) instead of deferring to the
  // warm-retry sentinel (HYP-424's "does NOT settle for an unrelated ancestor frame",
  // still green after this change).
  //
  // Gating the walk on `directSourceWasSynthetic` (rather than on "recovery found
  // nothing") is safe because recovery success already short-circuits BEFORE the walk
  // is reached: `recoverNonSyntheticSourceLocation`'s own acceptance predicate is
  // `!isSyntheticPreviewPath(loc) && isRenderedFilePath(loc, renderedFile)`, so any
  // `recovered !== null` result is BY CONSTRUCTION already in the rendered file — a
  // first-party editable file — so the `isEditableSourcePath` early-return below always
  // fires first in that case. The gate below only ever changes
  // behavior on the "recovery found nothing, directSource stayed synthetic" path —
  // covered by resolve-source.test.ts's "does NOT settle for an unrelated ancestor
  // frame ... (HYP-424)", which already exercises a `_debugStack`-only ancestor
  // (React 19 shape) and still asserts the synthetic direct source is kept, not
  // "main.tsx" — that test stays green after this diff's `_debugStack` support.
  const directSourceWasSynthetic = isSyntheticPreviewPath(directSource.fileName);
  if (directSourceWasSynthetic) {
    const recovered = recoverNonSyntheticSourceLocation(fiber, renderedFile);
    if (recovered !== null) directSource = recovered;
  }

  // No fiber to walk — use direct source. (renderedFile is only consulted by the
  // synthetic-recovery above; the editable gate below is deliberately DEPTH-INDEPENDENT
  // and does NOT compare against renderedFile — see the editable-source.ts rationale.)
  if (!fiber) return { source: directSource, itemIndex: directItemIndex };

  // The clicked element's OWN source is editable — a first-party project file, not a
  // node_modules dependency internal or synthetic scaffolding. That IS the element the
  // user wants to edit, so resolve to it directly, regardless of how many first-party
  // component layers sit between it and the previewed file. This is what makes a composed
  // root (App.tsx renders <Feed/>; Feed renders <h1> and tweets.map(<Tweet/>)) resolve each
  // clicked element to its own authored location — Feed's <h1> → Feed.tsx, a Tweet's <span>
  // → Tweet.tsx — instead of collapsing every one to the single <Feed/> call site at
  // App.tsx:47 (HYP-1006). It also bypasses the call-site walk entirely, so a cold or
  // unmappable intermediate call-site frame can no longer force an over-climb to the root
  // (the exact mechanism that made ALL six elements collapse to App.tsx:47 in the repro).
  if (isEditableSourcePath(directSource.fileName)) {
    return { source: directSource, itemIndex: getAncestorItemIndex(fiber, directItemIndex) };
  }

  // The clicked element's own source is NOT editable — it is the internal host node of an
  // imported PRIMITIVE (e.g. the <button> inside a node_modules <Button>). Package internals
  // cannot be edited, so walk up to the nearest EDITABLE call site: where <Button> is written
  // in first-party code. Skipped when directSource started synthetic (see comment above).
  if (!directSourceWasSynthetic) {
    let current = fiber.return;
    for (let i = 0; i < 30 && current; i++) {
      // React 18 sets `_debugSource`; React 19 sets `_debugStack` instead (never both) —
      // an ancestor carrying only `_debugStack` was previously invisible here, so for a
      // React 19 app the call site was never found and the element's own (wrong-file)
      // source was committed, silently mismatching the AST-computed nodeRef (HYP-897:
      // Explorer-tree selection on an imported component never showed a selection
      // overlay, e.g. conloca-app's <HostRoutePage> — a real recurring product bug).
      // Resolve THIS ancestor's own call-site source:
      // - React 18 `_debugSource` is already an original-source position — use it directly.
      // - React 19 `_debugStack` carries the COMPILED position in the transformed module
      //   (e.g. Vite/jsxDEV output where line 65 is a `.map()` past the real file's EOF).
      //   Committing that raw `parseDebugStack` line gives a nodeRef AstService can never
      //   resolve — every inspector style write then failed with "Element not found"
      //   (HYP-970). So when a source-map mapper is provided we use ONLY the MAPPED position
      //   (original-source coordinates, matching `directSource`) and SKIP an ancestor the map
      //   cannot resolve — e.g. an imported component fiber whose exact jsxDEV column has no
      //   source-map entry — walking on to the next mappable cross-file ancestor rather than
      //   committing a compiled line. When NO mapper is provided (SaaS adapter path, unit
      //   tests) the raw `parseDebugStack` fallback preserves the pre-existing behavior
      //   (HYP-897 — a dev server whose compiled positions ≈ original).
      let callerSource: SourceLocation | null;
      if (current._debugSource) {
        callerSource = debugSourceToLocation(current._debugSource);
      } else if (current._debugStack) {
        callerSource = resolveLocation ? resolveLocation(current) : parseDebugStack(current._debugStack);
      } else {
        callerSource = null;
      }
      if (callerSource) {
        // The synthetic preview entry (__canvas_preview__.tsx) imports and renders
        // the user component, so it is a cross-file ancestor — but it is never a valid
        // go-to-code target. When the call site is the synthetic wrapper, there is no
        // real call site between the element and the wrapper, so the element's own
        // (direct) source is the correct target. (HYP-429)
        if (isSyntheticPreviewPath(callerSource.fileName)) break;
        // First EDITABLE call site up the tree = where the primitive is used in
        // first-party code (e.g. `<Button/>` in Feed.tsx). A non-editable ancestor —
        // another node_modules frame nested inside the dependency — is skipped so the
        // collapse target is always a file the user can actually open and edit.
        if (isEditableSourcePath(callerSource.fileName)) {
          return { source: callerSource, itemIndex: getItemIndexFromFiber(current, resolveLocation) };
        }
      }
      current = current.return;
    }
  }

  // No editable call site found — use direct source as fallback.
  return { source: directSource, itemIndex: directItemIndex };
}
