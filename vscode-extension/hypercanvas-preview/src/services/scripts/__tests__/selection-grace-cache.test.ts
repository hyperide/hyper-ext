import { describe, expect, test } from 'bun:test';

import type { OverlayRect } from '@shared/canvas-interaction/types';
import { applySelectionGraceCache, makeSelectionGraceCacheState } from '../selection-grace-cache';

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

  test('non-selection rects are passed through unchanged and not cached', () => {
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
