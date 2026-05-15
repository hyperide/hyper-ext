/**
 * @file Selection-rect grace cache — keeps the overlay box visible during the brief
 * window between a React commit (e.g. HMR after an i18n key change) and the moment
 * FiberSourceIndex is rebuilt against the new fiber tree.
 *
 * Accessed via: iframe-interaction.ts (IIFE injected into the preview iframe).
 * Assumptions:
 *   - The selection ID is stable across the mutation (the JSX element is the same node;
 *     only its text changed). If the user actually deselects, callers MUST pass the
 *     new selectedIds so stale entries are pruned.
 *   - Caller passes a monotonic clock (performance.now()) for deadline math.
 *
 * Why this lives in a separate file: keeps the pure logic testable without booting
 * the whole iframe IIFE / DOM stack. iframe-interaction.ts is one giant script with
 * top-level side effects, which is a poor fit for unit tests.
 */
import type { OverlayRect } from '@shared/canvas-interaction/types';

/** Snapshot of a selection rect, replayed during the grace period. */
export interface CachedSelectionRect {
  key: string;
  elementId: string;
  left: number;
  top: number;
  width: number;
  height: number;
  type: 'selection';
  resizable?: { width: boolean; height: boolean; hasSizeClass?: boolean };
}

/** Mutable cache state owned by the caller. */
export interface SelectionGraceCacheState {
  rectsByElementId: Map<string, CachedSelectionRect>;
  deadlineByElementId: Map<string, number>;
}

export interface ApplyGraceCacheOptions {
  /** IDs that are currently selected — entries for absent IDs are evicted. */
  selectedIds: string[];
  /** Rects produced this frame by the overlay computation (selection + hover). */
  computedRects: OverlayRect[];
  /** Mutable cache; this function updates it in place. */
  cache: SelectionGraceCacheState;
  /** Wall clock used for deadline math — pass performance.now(). */
  now: number;
  /** How long to keep replaying a cached rect after the last successful paint. */
  gracePeriodMs: number;
  /**
   * Optional diagnostic callback invoked once per element when its cache entry is
   * evicted. Reasons:
   *   - 'deselected': caller no longer reports the ID as selected
   *   - 'expired':    the grace deadline elapsed before a fresh paint arrived
   * Used by iframe-interaction.ts to surface the moment the overlay disappears
   * (Task 1 of selection-flicker-some-elements).
   */
  onPrune?: (elementId: string, reason: 'deselected' | 'expired') => void;
}

export interface ApplyGraceCacheResult {
  /** Rects to send to the parent webview — computedRects plus any replayed snapshots. */
  rects: OverlayRect[];
  /**
   * True when at least one cached rect was replayed because its ID had no fresh
   * selection rect this frame. Caller should schedule a follow-up paint so the
   * rebuilt fiber index is consulted again as soon as possible.
   */
  inGracePeriod: boolean;
}

export function makeSelectionGraceCacheState(): SelectionGraceCacheState {
  return {
    rectsByElementId: new Map(),
    deadlineByElementId: new Map(),
  };
}

/**
 * Refresh the cache against this frame's computed rects, then replay any cached
 * snapshots whose IDs are still selected but produced no fresh rect — until the
 * grace deadline expires.
 */
export function applySelectionGraceCache(opts: ApplyGraceCacheOptions): ApplyGraceCacheResult {
  const { selectedIds, computedRects, cache, now, gracePeriodMs, onPrune } = opts;

  // 1. Drop entries for IDs no longer selected so we never paint a stale rect for a deselected element.
  if (cache.rectsByElementId.size > 0 || cache.deadlineByElementId.size > 0) {
    const active = new Set(selectedIds);
    for (const id of cache.rectsByElementId.keys()) {
      if (!active.has(id)) {
        cache.rectsByElementId.delete(id);
        onPrune?.(id, 'deselected');
      }
    }
    for (const id of cache.deadlineByElementId.keys()) {
      if (!active.has(id)) cache.deadlineByElementId.delete(id);
    }
  }

  // 2. Snapshot every fresh, visible selection rect and reset its deadline.
  const idsWithFreshSelection = new Set<string>();
  for (const r of computedRects) {
    if (r.type !== 'selection' || !r.elementId) continue;
    if (r.width <= 0 || r.height <= 0) continue;
    idsWithFreshSelection.add(r.elementId);
    const snapshot: CachedSelectionRect = {
      key: r.key,
      elementId: r.elementId,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      type: 'selection',
      ...(r.resizable && { resizable: r.resizable }),
    };
    cache.rectsByElementId.set(r.elementId, snapshot);
    cache.deadlineByElementId.set(r.elementId, now + gracePeriodMs);
  }

  // 3. For selectedIds without a fresh rect, replay the cached snapshot if its deadline
  //    is still in the future. Past-deadline entries are pruned.
  const rects: OverlayRect[] = [...computedRects];
  let inGracePeriod = false;
  for (const id of selectedIds) {
    if (idsWithFreshSelection.has(id)) continue;
    const cached = cache.rectsByElementId.get(id);
    const deadline = cache.deadlineByElementId.get(id);
    if (!cached || deadline === undefined) continue;
    if (now > deadline) {
      cache.rectsByElementId.delete(id);
      cache.deadlineByElementId.delete(id);
      onPrune?.(id, 'expired');
      continue;
    }
    rects.push({
      key: cached.key,
      elementId: cached.elementId,
      left: cached.left,
      top: cached.top,
      width: cached.width,
      height: cached.height,
      type: 'selection',
      ...(cached.resizable && { resizable: cached.resizable }),
    });
    inGracePeriod = true;
  }

  return { rects, inGracePeriod };
}
