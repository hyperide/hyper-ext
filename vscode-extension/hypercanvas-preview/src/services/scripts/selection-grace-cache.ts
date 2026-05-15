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
  /**
   * Snapshot of `selectedItemIndices[elementId]` at capture time. Persisted across
   * full-reload so the post-hydrate paint can target the specific `.map()` instance
   * that was selected — without it, `computeOverlayRects` would render selection
   * rects for EVERY instance at that source until the parent rebroadcasts state.
   * `null` means the element is not a `.map()` item; field omitted preserves that.
   */
  itemIndex?: number | null;
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
   * Per-id `.map()` item index at capture time. Stored on each snapshot so that a
   * subsequent full-reload can restore which specific instance was selected. Pass
   * the same Map/Record the overlay code reads from `OverlayState.selectedItemIndices`.
   */
  selectedItemIndices?: Map<string, number | null> | Record<string, number | null>;
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
 * Drop every cached rect whose elementId references the given file path.
 *
 * Element IDs follow the format `<fileName>:<line>:<column>`. After an AST
 * mutation in `<fileName>` (drag-end → move, insert, delete) the line/column
 * positions of *other* elements in the same file may shift, so the cached
 * rect's geometry no longer corresponds to the JSX node it was captured for.
 * Replaying that cached rect during the post-mutation HMR window is exactly
 * what users see as the "stale rect lingers at old position" lag — fixed by
 * invalidating the matching entries before the next paint runs.
 *
 * Conservative match: drops every entry whose ID starts with `<filePath>:`.
 * The colon delimiter prevents accidentally dropping IDs in sibling files
 * that share a common prefix (e.g. `src/Foo.tsx` vs `src/FooBar.tsx`).
 *
 * Cross-file moves should call this for both the source and target paths.
 */
export function invalidateSelectionGraceCacheForFile(state: SelectionGraceCacheState, filePath: string): void {
  if (!filePath) return;
  const prefix = `${filePath}:`;
  for (const id of Array.from(state.rectsByElementId.keys())) {
    if (id.startsWith(prefix)) {
      state.rectsByElementId.delete(id);
      state.deadlineByElementId.delete(id);
    }
  }
  // Some entries may carry only a deadline (legacy paths), drop those too.
  for (const id of Array.from(state.deadlineByElementId.keys())) {
    if (id.startsWith(prefix)) {
      state.deadlineByElementId.delete(id);
    }
  }
}

/**
 * Wire-format payload used to persist the cache across a full iframe document reload
 * (Task 2 of selection-flicker-some-elements). Stored by iframe-interaction.ts in
 * sessionStorage so that a Vite full-reload — which destroys the in-memory cache —
 * does not drop the selection rect.
 *
 * Shape is intentionally minimal: only the data needed to replay a rect. Schema
 * version (`v`) lets us reject older payloads if the format ever drifts.
 */
export interface PersistedSelectionGraceCache {
  v: 1;
  rects: CachedSelectionRect[];
  /** Date.now() when the snapshot was written — used for staleness rejection. */
  ts: number;
}

/**
 * Build a JSON-serialisable snapshot of the current cache. Caller stringifies and
 * writes to sessionStorage (or any other persistence layer).
 */
export function serializeSelectionGraceCache(
  state: SelectionGraceCacheState,
  wallClockNow: number,
): PersistedSelectionGraceCache {
  return {
    v: 1,
    rects: Array.from(state.rectsByElementId.values()),
    ts: wallClockNow,
  };
}

export interface HydrateSelectionGraceCacheOptions {
  state: SelectionGraceCacheState;
  /** Parsed sessionStorage payload — may be anything; validated here. */
  serialized: unknown;
  /** performance.now() of the new session. Deadlines are reset to now + gracePeriodMs. */
  now: number;
  /** Date.now() of the new session — used for staleness rejection. */
  wallClockNow: number;
  /** TTL applied to each rehydrated entry. */
  gracePeriodMs: number;
  /** Snapshots older than this are dropped. */
  maxAgeMs: number;
}

export interface HydrateSelectionGraceCacheResult {
  hydratedIds: string[];
  /**
   * Per-id `.map()` item indices restored from the persisted snapshot. Only contains
   * entries whose original capture had a non-null item index — used by callers as a
   * stand-in for `state.selectedItemIndices` until the parent rebroadcasts the
   * post-reload selection state.
   */
  hydratedItemIndices: Record<string, number | null>;
}

/**
 * Restore a previously serialised cache into `state`. Each entry gets a fresh
 * deadline of `now + gracePeriodMs` because performance.now() resets across
 * document reloads. Returns the list of hydrated element IDs so the caller can
 * keep painting them until the parent webview confirms the new `selectedIds`.
 */
export function hydrateSelectionGraceCache(opts: HydrateSelectionGraceCacheOptions): HydrateSelectionGraceCacheResult {
  const { state, serialized, now, wallClockNow, gracePeriodMs, maxAgeMs } = opts;
  const empty: HydrateSelectionGraceCacheResult = { hydratedIds: [], hydratedItemIndices: {} };
  if (!serialized || typeof serialized !== 'object') return empty;
  const s = serialized as Partial<PersistedSelectionGraceCache>;
  if (s.v !== 1 || !Array.isArray(s.rects) || typeof s.ts !== 'number') {
    return empty;
  }
  const age = wallClockNow - s.ts;
  if (age < 0 || age > maxAgeMs) return empty;
  const hydratedIds: string[] = [];
  const hydratedItemIndices: Record<string, number | null> = {};
  for (const r of s.rects) {
    if (!r || typeof r !== 'object') continue;
    if (typeof r.elementId !== 'string' || r.elementId.length === 0) continue;
    // Use Number.isFinite to reject NaN / ±Infinity — typeof passes them and a
    // hydrated NaN-positioned rect renders as an invisible overlay that the retry
    // loop then re-persists for the entire grace window.
    if (!Number.isFinite(r.left) || !Number.isFinite(r.top)) continue;
    if (!Number.isFinite(r.width) || !Number.isFinite(r.height)) continue;
    if (typeof r.key !== 'string' || r.key.length === 0) continue;
    if (r.type !== 'selection') continue;
    // itemIndex is optional. Reject malformed values silently — a rect without a
    // valid index will fall through to the all-instances render path, which is
    // strictly no worse than the pre-fix behaviour.
    let itemIndex: number | null | undefined;
    if (Object.hasOwn(r, 'itemIndex')) {
      const raw = (r as { itemIndex?: unknown }).itemIndex;
      if (raw === null) {
        itemIndex = null;
      } else if (typeof raw === 'number' && Number.isFinite(raw) && Number.isInteger(raw) && raw >= 0) {
        itemIndex = raw;
      } else {
        itemIndex = undefined;
      }
    }
    const cleanRect: CachedSelectionRect = {
      key: r.key,
      elementId: r.elementId,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      type: 'selection',
      ...(r.resizable && { resizable: r.resizable }),
      ...(itemIndex !== undefined && { itemIndex }),
    };
    state.rectsByElementId.set(r.elementId, cleanRect);
    state.deadlineByElementId.set(r.elementId, now + gracePeriodMs);
    hydratedIds.push(r.elementId);
    if (itemIndex !== undefined) {
      hydratedItemIndices[r.elementId] = itemIndex;
    }
  }
  return { hydratedIds, hydratedItemIndices };
}

/**
 * Refresh the cache against this frame's computed rects, then replay any cached
 * snapshots whose IDs are still selected but produced no fresh rect — until the
 * grace deadline expires.
 */
function readItemIndex(
  src: Map<string, number | null> | Record<string, number | null> | undefined,
  id: string,
): number | null | undefined {
  if (!src) return undefined;
  if (src instanceof Map) return src.has(id) ? (src.get(id) ?? null) : undefined;
  return Object.hasOwn(src, id) ? (src[id] ?? null) : undefined;
}

export function applySelectionGraceCache(opts: ApplyGraceCacheOptions): ApplyGraceCacheResult {
  const { selectedIds, computedRects, cache, now, gracePeriodMs, onPrune, selectedItemIndices } = opts;

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
    const itemIndex = readItemIndex(selectedItemIndices, r.elementId);
    const snapshot: CachedSelectionRect = {
      key: r.key,
      elementId: r.elementId,
      left: r.left,
      top: r.top,
      width: r.width,
      height: r.height,
      type: 'selection',
      ...(r.resizable && { resizable: r.resizable }),
      ...(itemIndex !== undefined && { itemIndex }),
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
