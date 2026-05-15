import { describe, expect, test } from 'bun:test';

import type { OverlayRect } from '@shared/canvas-interaction/types';
import {
  applySelectionGraceCache,
  hydrateSelectionGraceCache,
  makeSelectionGraceCacheState,
  serializeSelectionGraceCache,
} from '../selection-grace-cache';

const ID_A = 'src/Foo.tsx:10:5';
const ID_B = 'src/Bar.tsx:20:7';

function selectionRect(id: string, overrides: Partial<OverlayRect> = {}): OverlayRect {
  return {
    key: `select-${id}-0`,
    elementId: id,
    left: 100,
    top: 50,
    width: 80,
    height: 24,
    type: 'selection',
    ...overrides,
  };
}

describe('applySelectionGraceCache', () => {
  test('snapshots fresh selection rects and passes them through', () => {
    const cache = makeSelectionGraceCacheState();
    const rect = selectionRect(ID_A);

    const result = applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [rect],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    expect(result.inGracePeriod).toBe(false);
    expect(result.rects).toEqual([rect]);
    expect(cache.rectsByElementId.get(ID_A)).toMatchObject({
      key: 'select-src/Foo.tsx:10:5-0',
      left: 100,
      top: 50,
    });
    expect(cache.deadlineByElementId.get(ID_A)).toBe(1800);
  });

  test('replays cached rect when DOM lookup misses inside grace period', () => {
    const cache = makeSelectionGraceCacheState();
    // Frame 1: successful paint snapshots the rect.
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    // Frame 2: lookup misses (HMR window), no fresh rect produced.
    const result = applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [],
      cache,
      now: 1300,
      gracePeriodMs: 800,
    });

    expect(result.inGracePeriod).toBe(true);
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]).toMatchObject({ elementId: ID_A, type: 'selection', width: 80 });
  });

  test('stops replaying once grace deadline passes', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    // Past deadline (1000 + 800 = 1800).
    const result = applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [],
      cache,
      now: 2000,
      gracePeriodMs: 800,
    });

    expect(result.inGracePeriod).toBe(false);
    expect(result.rects).toHaveLength(0);
    expect(cache.rectsByElementId.has(ID_A)).toBe(false);
    expect(cache.deadlineByElementId.has(ID_A)).toBe(false);
  });

  test('does NOT replay cached rect for a deselected element', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    // User deselects mid-grace-period.
    const result = applySelectionGraceCache({
      selectedIds: [],
      computedRects: [],
      cache,
      now: 1100,
      gracePeriodMs: 800,
    });

    expect(result.inGracePeriod).toBe(false);
    expect(result.rects).toHaveLength(0);
    expect(cache.rectsByElementId.has(ID_A)).toBe(false);
    expect(cache.deadlineByElementId.has(ID_A)).toBe(false);
  });

  test('refreshes deadline on each successful paint', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A, { left: 200 })],
      cache,
      now: 1500,
      gracePeriodMs: 800,
    });

    expect(cache.deadlineByElementId.get(ID_A)).toBe(2300);
    expect(cache.rectsByElementId.get(ID_A)?.left).toBe(200);
  });

  test('skips zero-area selection rects (treats as miss)', () => {
    const cache = makeSelectionGraceCacheState();
    const result = applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A, { width: 0, height: 0 })],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    expect(cache.rectsByElementId.has(ID_A)).toBe(false);
    expect(result.inGracePeriod).toBe(false);
    // Zero-area rect still flows through to caller — the renderer does the visibility check.
    expect(result.rects).toHaveLength(1);
  });

  test('handles multiple selections independently', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A, ID_B],
      computedRects: [selectionRect(ID_A), selectionRect(ID_B, { left: 300 })],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    // Only ID_A misses on the next frame.
    const result = applySelectionGraceCache({
      selectedIds: [ID_A, ID_B],
      computedRects: [selectionRect(ID_B, { left: 305 })],
      cache,
      now: 1100,
      gracePeriodMs: 800,
    });

    expect(result.inGracePeriod).toBe(true);
    // Should contain the fresh ID_B rect plus the cached ID_A snapshot.
    const ids = result.rects.map((r) => r.elementId);
    expect(ids).toContain(ID_A);
    expect(ids).toContain(ID_B);
    const aRect = result.rects.find((r) => r.elementId === ID_A);
    const bRect = result.rects.find((r) => r.elementId === ID_B);
    expect(aRect?.left).toBe(100); // cached
    expect(bRect?.left).toBe(305); // fresh
  });

  test('preserves resizable metadata in cached snapshot', () => {
    const cache = makeSelectionGraceCacheState();
    const resizable = { width: true, height: false, hasSizeClass: true };
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A, { resizable })],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    const result = applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [],
      cache,
      now: 1100,
      gracePeriodMs: 800,
    });

    expect(result.rects[0]?.resizable).toEqual(resizable);
  });

  test('onPrune fires with reason "expired" when grace deadline elapses', () => {
    const cache = makeSelectionGraceCacheState();
    const pruned: Array<{ id: string; reason: 'deselected' | 'expired' }> = [];

    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
      onPrune: (id, reason) => pruned.push({ id, reason }),
    });

    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [],
      cache,
      now: 2000, // past 1000 + 800
      gracePeriodMs: 800,
      onPrune: (id, reason) => pruned.push({ id, reason }),
    });

    expect(pruned).toEqual([{ id: ID_A, reason: 'expired' }]);
  });

  test('onPrune fires with reason "deselected" when caller drops the ID', () => {
    const cache = makeSelectionGraceCacheState();
    const pruned: Array<{ id: string; reason: 'deselected' | 'expired' }> = [];

    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
      onPrune: (id, reason) => pruned.push({ id, reason }),
    });

    applySelectionGraceCache({
      selectedIds: [],
      computedRects: [],
      cache,
      now: 1100,
      gracePeriodMs: 800,
      onPrune: (id, reason) => pruned.push({ id, reason }),
    });

    expect(pruned).toEqual([{ id: ID_A, reason: 'deselected' }]);
  });

  test('snapshots itemIndex when caller passes selectedItemIndices (Record)', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
      selectedItemIndices: { [ID_A]: 3 },
    });

    expect(cache.rectsByElementId.get(ID_A)?.itemIndex).toBe(3);
  });

  test('snapshots itemIndex when caller passes selectedItemIndices (Map)', () => {
    const cache = makeSelectionGraceCacheState();
    const indices = new Map<string, number | null>([[ID_A, 7]]);
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
      selectedItemIndices: indices,
    });

    expect(cache.rectsByElementId.get(ID_A)?.itemIndex).toBe(7);
  });

  test('itemIndex omitted when caller did not provide selectedItemIndices', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });
    expect(cache.rectsByElementId.get(ID_A)).toBeDefined();
    expect(cache.rectsByElementId.get(ID_A)?.itemIndex).toBeUndefined();
  });

  test('itemIndex preserves null (non-.map() element)', () => {
    const cache = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
      selectedItemIndices: { [ID_A]: null },
    });
    expect(cache.rectsByElementId.get(ID_A)?.itemIndex).toBeNull();
  });

  test('non-selection rects are passed through unchanged and not cached (control)', () => {
    const cache = makeSelectionGraceCacheState();
    const hover: OverlayRect = {
      key: `hover-${ID_B}`,
      left: 0,
      top: 0,
      width: 50,
      height: 50,
      type: 'hover',
    };

    const result = applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [hover, selectionRect(ID_A)],
      cache,
      now: 1000,
      gracePeriodMs: 800,
    });

    expect(result.rects).toContain(hover);
    expect(cache.rectsByElementId.has(ID_B)).toBe(false);
  });
});

describe('serializeSelectionGraceCache + hydrateSelectionGraceCache', () => {
  test('round-trip: persisted snapshot rehydrates with fresh deadlines', () => {
    const source = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A, { resizable: { width: true, height: false } })],
      cache: source,
      now: 5000,
      gracePeriodMs: 800,
    });

    const payload = serializeSelectionGraceCache(source, 1_700_000_000_000);
    expect(payload.v).toBe(1);
    expect(payload.rects).toHaveLength(1);
    expect(payload.rects[0]?.elementId).toBe(ID_A);

    // Round-trip via JSON to mimic sessionStorage's string encoding.
    const wire = JSON.parse(JSON.stringify(payload));

    const target = makeSelectionGraceCacheState();
    const result = hydrateSelectionGraceCache({
      state: target,
      serialized: wire,
      now: 100, // fresh performance.now() — much smaller than the source's 5000
      wallClockNow: 1_700_000_001_500, // 1.5s later
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });

    expect(result.hydratedIds).toEqual([ID_A]);
    expect(target.rectsByElementId.get(ID_A)?.left).toBe(100);
    expect(target.rectsByElementId.get(ID_A)?.resizable).toEqual({ width: true, height: false });
    expect(target.deadlineByElementId.get(ID_A)).toBe(2600); // now + gracePeriodMs
  });

  test('replay works after hydrate: cached rect is returned for the hydrated ID', () => {
    const source = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A, { left: 250 })],
      cache: source,
      now: 1000,
      gracePeriodMs: 800,
    });

    const payload = serializeSelectionGraceCache(source, 2_000_000_000_000);
    const target = makeSelectionGraceCacheState();
    const { hydratedIds } = hydrateSelectionGraceCache({
      state: target,
      serialized: payload,
      now: 0,
      wallClockNow: 2_000_000_000_500,
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });

    // Simulate the post-reload paint: parent has not yet sent stateUpdate, but the
    // caller uses the hydrated IDs as a stand-in. DOM lookup misses → replay.
    const result = applySelectionGraceCache({
      selectedIds: hydratedIds,
      computedRects: [],
      cache: target,
      now: 50, // well before deadline (0 + 2500 = 2500)
      gracePeriodMs: 2500,
    });

    expect(result.inGracePeriod).toBe(true);
    expect(result.rects).toHaveLength(1);
    expect(result.rects[0]?.elementId).toBe(ID_A);
    expect(result.rects[0]?.left).toBe(250);
  });

  test('rejects payload older than maxAgeMs', () => {
    const source = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache: source,
      now: 1000,
      gracePeriodMs: 800,
    });

    const payload = serializeSelectionGraceCache(source, 1_000_000);
    const target = makeSelectionGraceCacheState();
    const { hydratedIds } = hydrateSelectionGraceCache({
      state: target,
      serialized: payload,
      now: 0,
      wallClockNow: 1_000_000 + 30_000, // 30s later, exceeds maxAge
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });

    expect(hydratedIds).toEqual([]);
    expect(target.rectsByElementId.size).toBe(0);
  });

  test('rejects payload with future timestamp (clock skew)', () => {
    const target = makeSelectionGraceCacheState();
    const result = hydrateSelectionGraceCache({
      state: target,
      serialized: { v: 1, rects: [], ts: 5000 },
      now: 0,
      wallClockNow: 1000, // wall clock is BEFORE the persisted ts
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });
    expect(result.hydratedIds).toEqual([]);
  });

  test('rejects malformed payloads (wrong version, missing fields, junk)', () => {
    const target = makeSelectionGraceCacheState();
    const cases: unknown[] = [
      null,
      undefined,
      'not an object',
      42,
      {},
      { v: 2, rects: [], ts: 1000 }, // wrong version
      { v: 1, rects: 'not-an-array', ts: 1000 },
      { v: 1, rects: [], ts: 'not-a-number' },
      { v: 1, ts: 1000 }, // missing rects
    ];
    for (const c of cases) {
      const r = hydrateSelectionGraceCache({
        state: target,
        serialized: c,
        now: 0,
        wallClockNow: 1000,
        gracePeriodMs: 2500,
        maxAgeMs: 10_000,
      });
      expect(r.hydratedIds).toEqual([]);
    }
    expect(target.rectsByElementId.size).toBe(0);
  });

  test('skips individual malformed rect entries but accepts well-formed ones', () => {
    const payload = {
      v: 1,
      ts: 1000,
      rects: [
        { elementId: ID_A, key: 'k', left: 1, top: 2, width: 3, height: 4, type: 'selection' },
        { elementId: '', key: 'k', left: 1, top: 2, width: 3, height: 4, type: 'selection' }, // empty id
        { elementId: ID_B, key: 'k', left: 'bad', top: 2, width: 3, height: 4, type: 'selection' }, // bad left
        null,
        { elementId: ID_B, key: 'k', left: 1, top: 2, width: 3, height: 4, type: 'hover' }, // wrong type
      ],
    };
    const target = makeSelectionGraceCacheState();
    const r = hydrateSelectionGraceCache({
      state: target,
      serialized: payload,
      now: 0,
      wallClockNow: 1000,
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });
    expect(r.hydratedIds).toEqual([ID_A]);
    expect(target.rectsByElementId.size).toBe(1);
  });

  test('round-trip: itemIndex survives serialise → JSON → hydrate', () => {
    const source = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A, ID_B],
      computedRects: [selectionRect(ID_A), selectionRect(ID_B, { left: 200 })],
      cache: source,
      now: 1000,
      gracePeriodMs: 800,
      selectedItemIndices: { [ID_A]: 4, [ID_B]: null },
    });

    const wire = JSON.parse(JSON.stringify(serializeSelectionGraceCache(source, 5_000)));
    const target = makeSelectionGraceCacheState();
    const result = hydrateSelectionGraceCache({
      state: target,
      serialized: wire,
      now: 0,
      wallClockNow: 5_500,
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });

    expect(result.hydratedIds.sort()).toEqual([ID_A, ID_B].sort());
    expect(result.hydratedItemIndices[ID_A]).toBe(4);
    expect(result.hydratedItemIndices[ID_B]).toBeNull();
    expect(target.rectsByElementId.get(ID_A)?.itemIndex).toBe(4);
    expect(target.rectsByElementId.get(ID_B)?.itemIndex).toBeNull();
  });

  test('hydrate omits itemIndex from result for entries that were stored without it', () => {
    const source = makeSelectionGraceCacheState();
    applySelectionGraceCache({
      selectedIds: [ID_A],
      computedRects: [selectionRect(ID_A)],
      cache: source,
      now: 1000,
      gracePeriodMs: 800,
      // no selectedItemIndices
    });
    const wire = JSON.parse(JSON.stringify(serializeSelectionGraceCache(source, 5_000)));
    const target = makeSelectionGraceCacheState();
    const result = hydrateSelectionGraceCache({
      state: target,
      serialized: wire,
      now: 0,
      wallClockNow: 5_500,
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });

    expect(result.hydratedIds).toEqual([ID_A]);
    expect(Object.hasOwn(result.hydratedItemIndices, ID_A)).toBe(false);
  });

  test('hydrate rejects malformed itemIndex but keeps the rest of the rect', () => {
    const target = makeSelectionGraceCacheState();
    const result = hydrateSelectionGraceCache({
      state: target,
      serialized: {
        v: 1,
        ts: 1000,
        rects: [
          {
            elementId: ID_A,
            key: 'k',
            left: 1,
            top: 2,
            width: 3,
            height: 4,
            type: 'selection',
            itemIndex: 'not-a-number',
          },
          {
            elementId: ID_B,
            key: 'k',
            left: 1,
            top: 2,
            width: 3,
            height: 4,
            type: 'selection',
            itemIndex: -5,
          },
        ],
      },
      now: 0,
      wallClockNow: 1000,
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });
    expect(result.hydratedIds.sort()).toEqual([ID_A, ID_B].sort());
    // Both have malformed itemIndex → omitted from cleanRect AND from hydratedItemIndices.
    expect(target.rectsByElementId.get(ID_A)?.itemIndex).toBeUndefined();
    expect(target.rectsByElementId.get(ID_B)?.itemIndex).toBeUndefined();
    expect(Object.hasOwn(result.hydratedItemIndices, ID_A)).toBe(false);
    expect(Object.hasOwn(result.hydratedItemIndices, ID_B)).toBe(false);
  });

  test('rejects rects with NaN/Infinity coordinates or dimensions', () => {
    const target = makeSelectionGraceCacheState();
    const payload = {
      v: 1,
      ts: 1000,
      rects: [
        { elementId: 'nan-left', key: 'k', left: Number.NaN, top: 2, width: 3, height: 4, type: 'selection' },
        {
          elementId: 'inf-top',
          key: 'k',
          left: 1,
          top: Number.POSITIVE_INFINITY,
          width: 3,
          height: 4,
          type: 'selection',
        },
        {
          elementId: 'neg-inf-w',
          key: 'k',
          left: 1,
          top: 2,
          width: Number.NEGATIVE_INFINITY,
          height: 4,
          type: 'selection',
        },
        { elementId: 'nan-h', key: 'k', left: 1, top: 2, width: 3, height: Number.NaN, type: 'selection' },
        { elementId: 'empty-key', key: '', left: 1, top: 2, width: 3, height: 4, type: 'selection' },
        { elementId: ID_A, key: 'k', left: 1, top: 2, width: 3, height: 4, type: 'selection' },
      ],
    };
    const r = hydrateSelectionGraceCache({
      state: target,
      serialized: payload,
      now: 0,
      wallClockNow: 1000,
      gracePeriodMs: 2500,
      maxAgeMs: 10_000,
    });
    expect(r.hydratedIds).toEqual([ID_A]);
    expect(target.rectsByElementId.size).toBe(1);
  });
});
