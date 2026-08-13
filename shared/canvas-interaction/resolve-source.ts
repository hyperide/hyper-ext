/**
 * @file Shared source resolution logic for element click/hover.
 *
 * Accessed via: SaaS ElementTracer + Extension iframe-interaction.ts
 * Assumptions: fiber _debugSource available (React dev mode with Babel plugin).
 *
 * Handles the "call site vs component internal" problem:
 * - Elements from the rendered component file → use direct fiber source
 * - Elements from imported components (Button.tsx internals) → walk up fiber
 *   to find the CALL SITE (where <Button> is used in the parent component)
 */

import {
  debugSourceToLocation,
  type Fiber,
  getItemIndexFromFiber,
  isRenderedFilePath,
  parseDebugStack,
  recoverNonSyntheticSourceLocation,
} from '../element-tracing/fiber-internals';
import { isSyntheticPreviewPath } from '../element-tracing/synthetic-preview';
import type { SourceLocation } from '../element-tracing/types';

export interface ResolvedCallSiteTarget {
  source: SourceLocation;
  itemIndex: number;
}

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
 * Walks up the fiber tree to find the call site when the element is inside
 * an imported component (different file than the rendered component).
 *
 * @param directSource - Source from the element's own fiber (_debugSource)
 * @param fiber - The element's React fiber
 * @param renderedFile - Currently rendered component path (e.g. "src/App.tsx")
 * @returns The resolved source (direct or call site)
 */
export function resolveCallSiteSource(
  directSource: SourceLocation,
  fiber: Fiber | null,
  renderedFile: string | null,
): SourceLocation {
  return resolveCallSiteTarget(directSource, fiber, renderedFile, 0).source;
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
  // `recovered !== null` result is BY CONSTRUCTION already in the rendered file — the
  // `isFromRenderedFile` early-return two lines below always fires first in that case,
  // in both the pre- and post-this-change code. The gate below only ever changes
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

  // If no rendered file info, can't determine — use direct source
  if (!renderedFile || !fiber) return { source: directSource, itemIndex: directItemIndex };

  // Check if direct source is from the rendered component file
  const isFromRenderedFile = isRenderedFilePath(directSource.fileName, renderedFile);

  if (isFromRenderedFile) return { source: directSource, itemIndex: getAncestorItemIndex(fiber, directItemIndex) };

  // Source is from an imported component (e.g. Button.tsx internal <button>).
  // Walk up fiber to find the CALL SITE — first source from a DIFFERENT file.
  // Skipped when directSource started synthetic (see comment above).
  if (!directSourceWasSynthetic) {
    let current = fiber.return;
    for (let i = 0; i < 30 && current; i++) {
      // React 18 sets `_debugSource`; React 19 sets `_debugStack` instead (never both) —
      // an ancestor carrying only `_debugStack` was previously invisible here, so for a
      // React 19 app the call site was never found and the element's own (wrong-file)
      // source was committed, silently mismatching the AST-computed nodeRef (HYP-897:
      // Explorer-tree selection on an imported component never showed a selection
      // overlay, e.g. conloca-app's <HostRoutePage> — a real recurring product bug).
      const callerSource = current._debugSource
        ? debugSourceToLocation(current._debugSource)
        : current._debugStack
          ? parseDebugStack(current._debugStack)
          : null;
      if (callerSource && callerSource.fileName !== directSource.fileName) {
        // The synthetic preview entry (__canvas_preview__.tsx) imports and renders
        // the user component, so it is the first cross-file ancestor — but it is
        // never a valid go-to-code target. When the call site is the synthetic
        // wrapper, there is no real call site between the element and the wrapper,
        // so the element's own (direct) source is the correct target. (HYP-429)
        if (isSyntheticPreviewPath(callerSource.fileName)) break;
        return { source: callerSource, itemIndex: getItemIndexFromFiber(current) };
      }
      current = current.return;
    }
  }

  // No cross-file match — use direct source as fallback
  return { source: directSource, itemIndex: directItemIndex };
}
