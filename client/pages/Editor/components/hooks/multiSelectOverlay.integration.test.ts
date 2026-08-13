/**
 * HYP-691 SaaS-realm integration proof: Cmd/Ctrl+click multi-select draws one
 * [data-selection-overlay] DOM node per distinct selected element.
 *
 * This wires the REAL pieces of the SaaS pipeline (no mocks of the unit under test):
 *   1. The real CanvasEngine (SelectionManager) performs additive selection the
 *      same way useElementInteraction's Cmd/Ctrl+click branch does:
 *        - select first id
 *        - engine.addToSelectionWithItemIndex(id, itemIndex) for the others
 *   2. The engine's getSelection() (selectedIds + selectedItemIndices) is fed to
 *      the shared computeOverlayRects + renderOverlayRects — the exact code path
 *      the SaaS overlay RAF loop (createOverlayRenderer.tick) uses to create the
 *      [data-selection-overlay] divs.
 *   3. A resolver that REQUIRES the itemIndex (composite-instance: findElements(id,
 *      null) -> []) models the "3 selected, 0 frames" failure.
 *
 * The contrapositive uses the OLD addToSelection (no itemIndex) and asserts 0 frames
 * — i.e. it reproduces the bug, proving the assertion is load-bearing.
 *
 * Runs under happy-dom (test/setup.ts), so document.querySelectorAll works.
 */

import { describe, expect, it } from 'bun:test';
import { computeOverlayRects } from '@shared/canvas-interaction/overlay-rects';
import { renderOverlayRects } from '@shared/canvas-interaction/overlay-renderer';
import type { OverlayElementResolver } from '@shared/canvas-interaction/types';
import { CanvasEngine } from '@/lib/canvas-engine';

const REF_A = 'src/components/Feed.tsx:13:8';
const REF_B = 'src/components/TrendingSidebar.tsx:26:8';
const REF_C = 'src/components/Composer.tsx:9:4';

/** Build a DOM element with a real bounding box (happy-dom returns 0s otherwise). */
function makeEl(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON() {},
    }) as DOMRect;
  return el;
}

/**
 * Composite-instance resolver: a nodeRef resolves ONLY when a valid itemIndex is
 * supplied. findElements(id, null) returns [] — the silent-death path.
 */
function itemIndexRequiringResolver(map: Map<string, HTMLElement>): OverlayElementResolver {
  return {
    findElements(nodeRef: string, itemIndex: number | null): HTMLElement[] {
      if (itemIndex === null) return [];
      const el = map.get(nodeRef);
      return el ? [el] : [];
    },
    findEmptyContainers() {
      return [];
    },
  };
}

function renderFramesFromEngine(engine: CanvasEngine, resolver: OverlayElementResolver): HTMLElement {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const sel = engine.getSelection();
  const { overlayRects } = computeOverlayRects(
    {
      selectedIds: sel.selectedIds,
      hoveredId: sel.hoveredId,
      hoveredItemIndex: sel.hoveredItemIndex,
      selectedItemIndices: sel.selectedItemIndices,
      engineMode: 'design',
    },
    resolver,
  );
  renderOverlayRects(container, overlayRects, new Map(), { enableResizeHandles: false });
  return container;
}

describe('HYP-691 SaaS multi-select overlay (integration)', () => {
  it('Cmd+click selecting 3 distinct composite instances draws 3 [data-selection-overlay] frames', () => {
    const engine = new CanvasEngine({ debug: false });

    // Mirror useElementInteraction: single-click seeds, Cmd+click adds (with itemIndex).
    engine.selectWithItemIndex(REF_A, 0);
    engine.addToSelectionWithItemIndex(REF_B, 0);
    engine.addToSelectionWithItemIndex(REF_C, 0);

    expect(engine.getSelection().selectedIds).toEqual([REF_A, REF_B, REF_C]);

    const resolver = itemIndexRequiringResolver(
      new Map([
        [REF_A, makeEl({ left: 0, top: 0, width: 120, height: 40 })],
        [REF_B, makeEl({ left: 0, top: 60, width: 120, height: 40 })],
        [REF_C, makeEl({ left: 0, top: 120, width: 120, height: 40 })],
      ]),
    );

    const container = renderFramesFromEngine(engine, resolver);

    const frames = container.querySelectorAll('[data-selection-overlay]');
    expect(frames.length).toBe(3);
    for (const f of frames) {
      const el = f as HTMLElement;
      expect(parseFloat(el.style.width)).toBeGreaterThan(0);
      expect(parseFloat(el.style.height)).toBeGreaterThan(0);
    }
    container.remove();
  });

  it('contrapositive: the OLD addToSelection (no itemIndex) draws 0 frames — the original bug', () => {
    const engine = new CanvasEngine({ debug: false });

    // Pre-fix behavior: additive select dropped the itemIndex.
    engine.selectWithItemIndex(REF_A, 0);
    engine.addToSelection(REF_B);
    engine.addToSelection(REF_C);

    const sel = engine.getSelection();
    // REF_B / REF_C have NO itemIndex recorded — they resolve to [] in the composite resolver.
    expect(sel.selectedItemIndices.has(REF_B)).toBe(false);
    expect(sel.selectedItemIndices.has(REF_C)).toBe(false);

    const resolver = itemIndexRequiringResolver(
      new Map([
        [REF_A, makeEl({ left: 0, top: 0, width: 120, height: 40 })],
        [REF_B, makeEl({ left: 0, top: 60, width: 120, height: 40 })],
        [REF_C, makeEl({ left: 0, top: 120, width: 120, height: 40 })],
      ]),
    );

    const container = renderFramesFromEngine(engine, resolver);

    // REF_A still resolves (single-click kept its itemIndex); B and C silently die.
    expect(container.querySelectorAll('[data-selection-overlay]').length).toBe(1);
    container.remove();
  });
});
