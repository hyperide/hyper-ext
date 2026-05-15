/**
 * @file Selection-rect freeze for the i18n write window (Path B of the
 * "selection survives i18n write" plan).
 *
 * Accessed via: iframe-interaction.ts (VS Code extension overlay loop).
 * Assumptions: caller computes overlayRects, then asks this helper whether
 * to retain the previous selection rect because the live resolver did not
 * find a DOM match for `currentSelectionId` during a write window.
 *
 * Why a separate module: the logic was inline in `sendOverlayRects` and
 * stateful via two file-level `let`s. Pulling it into a pure-ish helper
 * around an explicit cache object makes it testable without standing up
 * the whole iframe IIFE harness.
 */

import type { OverlayRect } from './types';

export interface SelectionFreezeCache {
  /** Selection ID whose rects are currently cached, or null when none. */
  frozenId: string | null;
  /** Last live selection rects produced for `frozenId`. */
  frozenRects: OverlayRect[];
}

export function createSelectionFreezeCache(): SelectionFreezeCache {
  return { frozenId: null, frozenRects: [] };
}

/**
 * Reset the cache. Called when the write window closes so a stale rect can't
 * outlive the write — the next live miss outside a write window must drop
 * the outline cleanly.
 */
export function clearSelectionFreezeCache(cache: SelectionFreezeCache): void {
  cache.frozenId = null;
  cache.frozenRects = [];
}

export interface ApplySelectionFreezeArgs {
  /** Mutated in place: frozen rects are appended when a restore fires. */
  overlayRects: OverlayRect[];
  /** `state.selectedIds[0] ?? null` — the id whose outline we care about. */
  currentSelectionId: string | null;
  /** True between hypercanvas:writeI18nResource phase=start and phase=done. */
  writeInProgress: boolean;
  /** Cache mutated to remember the latest live rects (per current id). */
  cache: SelectionFreezeCache;
}

/**
 * Either updates the cache (when live selection rects are present) or
 * restores cached rects into `overlayRects` (when none are live AND the
 * write window is open).
 *
 * Intentionally does not freeze hover/placeholder rects — only the
 * selection outline.
 *
 * Path A renames the canonical selection id mid-write (the bridge returns
 * `newElementId` after the JSX rewrite, sidebar dispatches it, and the
 * iframe's `state.selectedIds[0]` flips from OLD to NEW *before* HMR
 * repaints). A strict `currentSelectionId === cache.frozenId` check would
 * defeat the freeze in exactly that window. Instead, when restoring during
 * a write window we absorb the id remap into the cache (`cache.frozenId =
 * currentSelectionId`) and paint the cached rect at the new id. A user
 * click during the ~80ms AST-write window is rare enough that briefly
 * showing the cached rect after a deselect/reselect is an acceptable
 * trade-off — the next live frame refreshes the cache to the user's new
 * selection.
 *
 * Returns the (possibly mutated) overlayRects array for chaining and so
 * tests can assert directly on the return value.
 */
export function applySelectionFreeze(args: ApplySelectionFreezeArgs): OverlayRect[] {
  const { overlayRects, currentSelectionId, writeInProgress, cache } = args;

  const liveSelectionRects = overlayRects.filter((r) => r.type === 'selection');

  if (liveSelectionRects.length > 0) {
    cache.frozenId = currentSelectionId;
    cache.frozenRects = liveSelectionRects;
    return overlayRects;
  }

  if (writeInProgress && currentSelectionId !== null && cache.frozenRects.length > 0) {
    // Absorb a Path A id remap (or any id change inside the write
    // window) so subsequent frames stay attached to the new selection
    // until live observation refreshes the cache.
    cache.frozenId = currentSelectionId;
    overlayRects.push(...cache.frozenRects);
  }

  return overlayRects;
}
