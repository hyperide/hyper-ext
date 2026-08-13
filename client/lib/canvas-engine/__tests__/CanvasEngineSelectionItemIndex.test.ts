/**
 * CanvasEngine additive-selection itemIndex tests (HYP-691).
 *
 * Regression: multi-select (Cmd/Ctrl+click) dropped the itemIndex on the additive
 * path, so a composite-component instance failed to resolve in the overlay
 * (findElements(id, null)) and no selection frame was drawn ("3 selected, 0 frames").
 *
 * These cover the data-model half: addToSelectionWithItemIndex must persist the
 * itemIndex, and removeFromSelection must drop the removed id's entry (no stale
 * itemIndex left behind).
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { CanvasEngine } from '../core/CanvasEngine';

const REF_A = '/src/App.tsx:10:5';
const REF_B = '/src/App.tsx:20:2';
const REF_C = '/src/App.tsx:30:7';

describe('CanvasEngine additive selection itemIndex (HYP-691)', () => {
  let engine: CanvasEngine;

  beforeEach(() => {
    engine = new CanvasEngine({ debug: false });
  });

  it('addToSelectionWithItemIndex stores the itemIndex for the added id', () => {
    engine.addToSelectionWithItemIndex(REF_A, 0);
    engine.addToSelectionWithItemIndex(REF_B, 1);
    engine.addToSelectionWithItemIndex(REF_C, 2);

    const sel = engine.getSelection();
    expect(sel.selectedIds).toEqual([REF_A, REF_B, REF_C]);
    expect(sel.selectedItemIndices.get(REF_A)).toBe(0);
    expect(sel.selectedItemIndices.get(REF_B)).toBe(1);
    expect(sel.selectedItemIndices.get(REF_C)).toBe(2);
  });

  it('addToSelectionWithItemIndex with null itemIndex adds id but records no index', () => {
    engine.addToSelectionWithItemIndex(REF_A, null);

    const sel = engine.getSelection();
    expect(sel.selectedIds).toEqual([REF_A]);
    expect(sel.selectedItemIndices.has(REF_A)).toBe(false);
  });

  it('addToSelectionWithItemIndex does not duplicate an already-selected id', () => {
    engine.addToSelectionWithItemIndex(REF_A, 0);
    engine.addToSelectionWithItemIndex(REF_A, 0);

    expect(engine.getSelection().selectedIds).toEqual([REF_A]);
  });

  it('removeFromSelection drops the removed id selectedItemIndices entry', () => {
    engine.addToSelectionWithItemIndex(REF_A, 0);
    engine.addToSelectionWithItemIndex(REF_B, 1);

    engine.removeFromSelection(REF_A);

    const sel = engine.getSelection();
    expect(sel.selectedIds).toEqual([REF_B]);
    expect(sel.selectedItemIndices.has(REF_A)).toBe(false);
    expect(sel.selectedItemIndices.get(REF_B)).toBe(1);
  });
});
