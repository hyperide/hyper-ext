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
 * write window is open AND the cached id matches the current selection).
 *
 * Intentionally does not freeze hover/placeholder rects — only the
 * selection outline. A selection change mid-write never restores a stale
 * rect over the new target because the cached id is gated on equality
 * with `currentSelectionId`.
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

  if (
    writeInProgress &&
    currentSelectionId !== null &&
    currentSelectionId === cache.frozenId &&
    cache.frozenRects.length > 0
  ) {
    overlayRects.push(...cache.frozenRects);
  }

  return overlayRects;
}
