import { describe, expect, it } from 'bun:test';
import { applySelectionFreeze, clearSelectionFreezeCache, createSelectionFreezeCache } from './selection-freeze';
import type { OverlayRect } from './types';

/**
 * Tests for selection-freeze — Path B of the "selection survives i18n
 * write" plan. Verifies that the overlay returns the last-known selection
 * rect when the live resolver finds no DOM match while a write window is
 * open, and that the freeze never paints stale rects outside that window
 * or after the cached id no longer matches the current selection.
 */

function selectionRect(id: string, left = 0, top = 0): OverlayRect {
  return {
    key: `select-${id}-0`,
    elementId: id,
    left,
    top,
    width: 100,
    height: 50,
    type: 'selection',
  };
}

function hoverRect(id: string): OverlayRect {
  return {
    key: `hover-${id}`,
    left: 0,
    top: 0,
    width: 100,
    height: 50,
    type: 'hover',
  };
}

describe('applySelectionFreeze', () => {
  it('caches live selection rects and returns them unchanged when present', () => {
    const cache = createSelectionFreezeCache();
    const live = [selectionRect('id-1', 10, 20)];

    const out = applySelectionFreeze({
      overlayRects: live,
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    expect(out).toBe(live);
    expect(out).toHaveLength(1);
    expect(cache.frozenId).toBe('id-1');
    expect(cache.frozenRects).toHaveLength(1);
    expect(cache.frozenRects[0].left).toBe(10);
  });

  it('restores cached rects when live selection is empty during a write window', () => {
    const cache = createSelectionFreezeCache();
    // Prime the cache with a live frame.
    applySelectionFreeze({
      overlayRects: [selectionRect('id-1', 10, 20)],
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    // Simulate the HMR re-render gap: live resolver finds nothing, but the
    // sidebar has flipped writeInProgress on for the same selection id.
    const next: OverlayRect[] = [];
    applySelectionFreeze({
      overlayRects: next,
      currentSelectionId: 'id-1',
      writeInProgress: true,
      cache,
    });

    expect(next).toHaveLength(1);
    expect(next[0].type).toBe('selection');
    expect(next[0].elementId).toBe('id-1');
    expect(next[0].left).toBe(10);
  });

  it('does NOT restore cached rects outside a write window', () => {
    const cache = createSelectionFreezeCache();
    applySelectionFreeze({
      overlayRects: [selectionRect('id-1')],
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    const next: OverlayRect[] = [];
    applySelectionFreeze({
      overlayRects: next,
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    expect(next).toHaveLength(0);
  });

  it('absorbs an id remap during a write window (Path A new-id dispatch)', () => {
    const cache = createSelectionFreezeCache();
    applySelectionFreeze({
      overlayRects: [selectionRect('id-old', 10, 20)],
      currentSelectionId: 'id-old',
      writeInProgress: false,
      cache,
    });
    expect(cache.frozenId).toBe('id-old');

    // Sidebar dispatched the post-write canonical id — `state.selectedIds[0]`
    // flipped to id-new while the live resolver still finds nothing
    // (DOM unmounted by HMR, fiber index still rebuilding). The freeze
    // must paint the cached rect at the new id and absorb the remap so
    // the next frame keeps tracking id-new.
    const next: OverlayRect[] = [];
    applySelectionFreeze({
      overlayRects: next,
      currentSelectionId: 'id-new',
      writeInProgress: true,
      cache,
    });

    expect(next).toHaveLength(1);
    expect(next[0].type).toBe('selection');
    expect(next[0].left).toBe(10);
    expect(cache.frozenId).toBe('id-new');
  });

  it('does NOT restore when current selection is null even during a write window', () => {
    const cache = createSelectionFreezeCache();
    applySelectionFreeze({
      overlayRects: [selectionRect('id-1')],
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    const next: OverlayRect[] = [];
    applySelectionFreeze({
      overlayRects: next,
      currentSelectionId: null,
      writeInProgress: true,
      cache,
    });

    expect(next).toHaveLength(0);
  });

  it('updates cache to the new id when live rects shift to a different selection', () => {
    const cache = createSelectionFreezeCache();
    applySelectionFreeze({
      overlayRects: [selectionRect('id-1', 10, 20)],
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });
    expect(cache.frozenId).toBe('id-1');

    applySelectionFreeze({
      overlayRects: [selectionRect('id-2', 100, 200)],
      currentSelectionId: 'id-2',
      writeInProgress: false,
      cache,
    });
    expect(cache.frozenId).toBe('id-2');
    expect(cache.frozenRects[0].left).toBe(100);
  });

  it('does not freeze hover rects — only selection rects update the cache', () => {
    const cache = createSelectionFreezeCache();

    applySelectionFreeze({
      overlayRects: [hoverRect('id-h')],
      currentSelectionId: 'id-h',
      writeInProgress: false,
      cache,
    });

    expect(cache.frozenId).toBeNull();
    expect(cache.frozenRects).toHaveLength(0);
  });

  it('clearSelectionFreezeCache drops the cache so a later miss does not restore', () => {
    const cache = createSelectionFreezeCache();
    applySelectionFreeze({
      overlayRects: [selectionRect('id-1')],
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    clearSelectionFreezeCache(cache);

    const next: OverlayRect[] = [];
    applySelectionFreeze({
      overlayRects: next,
      currentSelectionId: 'id-1',
      writeInProgress: true,
      cache,
    });

    expect(cache.frozenId).toBeNull();
    expect(cache.frozenRects).toHaveLength(0);
    expect(next).toHaveLength(0);
  });

  it('appends frozen rects without losing pre-existing non-selection entries', () => {
    const cache = createSelectionFreezeCache();
    applySelectionFreeze({
      overlayRects: [selectionRect('id-1', 5, 5)],
      currentSelectionId: 'id-1',
      writeInProgress: false,
      cache,
    });

    const next: OverlayRect[] = [hoverRect('id-2')];
    applySelectionFreeze({
      overlayRects: next,
      currentSelectionId: 'id-1',
      writeInProgress: true,
      cache,
    });

    expect(next).toHaveLength(2);
    expect(next[0].type).toBe('hover');
    expect(next[1].type).toBe('selection');
    expect(next[1].elementId).toBe('id-1');
  });
});
