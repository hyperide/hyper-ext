/**
 * @file Tests for canvas multi-selection toggle helpers
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it } from 'bun:test';
import { toggleItemIndex, toggleNodeRefInSelection } from './selection-utils';

/* ─── toggleNodeRefInSelection ─────────────────────────────────────── */

describe('toggleNodeRefInSelection', () => {
  it('plain click on empty selection → selects one element', () => {
    expect(toggleNodeRefInSelection([], '/src/App.tsx:10:5')).toEqual(['/src/App.tsx:10:5']);
  });

  it('plain click on occupied selection → still single element (replace)', () => {
    // Note: single-element replace is done by the caller passing [] then this helper.
    // Here we verify: adding a new ref to empty list.
    expect(toggleNodeRefInSelection([], '/src/App.tsx:20:2')).toEqual(['/src/App.tsx:20:2']);
  });

  it('Cmd+Click on unselected element → adds to selection', () => {
    const current = ['/src/App.tsx:10:5'];
    const result = toggleNodeRefInSelection(current, '/src/App.tsx:20:2');
    expect(result).toEqual(['/src/App.tsx:10:5', '/src/App.tsx:20:2']);
  });

  it('Cmd+Click on already-selected element → removes from selection', () => {
    const current = ['/src/App.tsx:10:5', '/src/App.tsx:20:2'];
    const result = toggleNodeRefInSelection(current, '/src/App.tsx:10:5');
    expect(result).toEqual(['/src/App.tsx:20:2']);
  });

  it('Cmd+Click removes last element → selection becomes empty', () => {
    const current = ['/src/App.tsx:10:5'];
    const result = toggleNodeRefInSelection(current, '/src/App.tsx:10:5');
    expect(result).toEqual([]);
  });

  it('null nodeRef → returns empty array regardless of current selection', () => {
    expect(toggleNodeRefInSelection(['/src/App.tsx:10:5'], null)).toEqual([]);
    expect(toggleNodeRefInSelection([], null)).toEqual([]);
  });

  it('does not mutate the input array', () => {
    const current = ['/src/App.tsx:10:5'];
    toggleNodeRefInSelection(current, '/src/App.tsx:20:2');
    expect(current).toEqual(['/src/App.tsx:10:5']);
  });
});

/* ─── toggleItemIndex ──────────────────────────────────────────────── */

describe('toggleItemIndex', () => {
  const REF_A = '/src/App.tsx:10:5';
  const REF_B = '/src/App.tsx:20:2';

  it('adding a ref with itemIndex → records itemIndex in map', () => {
    const result = toggleItemIndex({}, REF_A, [REF_A], 3);
    expect(result).toEqual({ [REF_A]: 3 });
  });

  it('adding a ref without itemIndex (null) → no entry added', () => {
    const result = toggleItemIndex({}, REF_A, [REF_A], null);
    expect(result).toEqual({});
  });

  it('removing a ref → drops its entry from map', () => {
    const indices = { [REF_A]: 1, [REF_B]: 2 };
    // nextSelectedIds no longer contains REF_A
    const result = toggleItemIndex(indices, REF_A, [REF_B], 1);
    expect(result).toEqual({ [REF_B]: 2 });
  });

  it('null nodeRef → returns empty map', () => {
    const result = toggleItemIndex({ [REF_A]: 1 }, null, [], null);
    expect(result).toEqual({});
  });

  it('does not mutate the input map', () => {
    const indices = { [REF_A]: 1 };
    toggleItemIndex(indices, REF_B, [REF_A, REF_B], 5);
    expect(indices).toEqual({ [REF_A]: 1 });
  });
});
