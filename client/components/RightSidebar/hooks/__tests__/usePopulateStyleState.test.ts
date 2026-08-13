/**
 * @file usePopulateStyleState — stale-data guard tests
 *
 * Accessed via: Inspector panel (RightSidebar) when the user selects an element.
 * Assumptions: parsedStyles reflects the selected element after useElementStyleData
 *   delivers its result, but in the same render cycle where selectedId changes,
 *   parsedStyles still holds the previous element's data.
 * Past bugs: switching elements briefly (or permanently in slow-RPC scenarios) showed
 *   the OLD element's style values because the populate effect ran with the stale
 *   parsedStyles before useElementStyleData's setData could apply.
 */

import { describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type { ParsedStyles } from '@/lib/canvas-engine/adapters/types';
import { usePopulateStyleState } from '../usePopulateStyleState';

// Minimal setter bag — only the ones we assert on (setWidth, setHeight, setBackgroundColor).
// The rest are no-ops so the hook doesn't throw.
function makeDeps(overrides: {
  selectedId: string | null;
  parsedStyles: Partial<ParsedStyles> | null;
  setWidth?: ReturnType<typeof mock>;
  setHeight?: ReturnType<typeof mock>;
  setBackgroundColor?: ReturnType<typeof mock>;
}) {
  const noop = mock(() => {});
  return {
    selectedId: overrides.selectedId,
    parsedStyles: overrides.parsedStyles,
    effectiveParsed: overrides.parsedStyles ?? {},
    dataTextContent: null,
    childrenType: undefined,
    engine: null,
    setSelectedPosition: noop,
    setPosTop: noop,
    setPosRight: noop,
    setPosBottom: noop,
    setPosLeft: noop,
    setWidth: overrides.setWidth ?? noop,
    setHeight: overrides.setHeight ?? noop,
    setMarginTop: noop,
    setMarginRight: noop,
    setMarginBottom: noop,
    setMarginLeft: noop,
    setPaddingTop: noop,
    setPaddingRight: noop,
    setPaddingBottom: noop,
    setPaddingLeft: noop,
    setGap: noop,
    setJustifyContent: noop,
    setAlignItems: noop,
    setColumnGap: noop,
    setRowGap: noop,
    setGridJustifyItems: noop,
    setGridAlignItems: noop,
    setGridCols: noop,
    setGridRows: noop,
    setBackgroundColor: overrides.setBackgroundColor ?? noop,
    setFillOpacity: noop,
    setOpacity: noop,
    setBackgroundImage: noop,
    setTextColor: noop,
    setTextOpacity: noop,
    setFontSize: noop,
    setBorderRadius: noop,
    setClipContent: noop,
    setSelectedLayout: noop,
    setStrokes: noop,
    setEffects: noop,
    setTextContent: noop,
    setIsTextFromProps: noop,
    isEditingTextRef: { current: false },
  } as const;
}

const STYLES_A: Partial<ParsedStyles> = { width: '100px', height: '50px', backgroundColor: '#ff0000' };
const STYLES_B: Partial<ParsedStyles> = { width: '200px', height: '80px', backgroundColor: '#0000ff' };

describe('usePopulateStyleState — stale-data guard', () => {
  it('clears fields when selectedId changes even if parsedStyles still has stale data', () => {
    // Simulate the real React render sequence:
    //   Render 1: selectedId = 'B', parsedStyles = STYLES_A (stale from element A)
    // useElementStyleData fires setData in its effect, but that setState doesn't
    // apply until Render 2. So usePopulateStyleState sees stale parsedStyles here.

    const setWidth = mock(() => {});
    const setHeight = mock(() => {});

    const { rerender } = renderHook((props) => usePopulateStyleState(props), {
      initialProps: makeDeps({
        selectedId: 'element-A',
        parsedStyles: STYLES_A,
        setWidth,
        setHeight,
      }),
    });

    // Initial render: element A is selected, its styles are loaded — should populate.
    expect(setWidth).toHaveBeenLastCalledWith('100px');

    setWidth.mockClear();
    setHeight.mockClear();

    // Selection changes to B; parsedStyles is still A's data (stale — the
    // useElementStyleData update hasn't applied yet for this render cycle).
    act(() => {
      rerender(
        makeDeps({
          selectedId: 'element-B',
          parsedStyles: STYLES_A, // deliberately stale
          setWidth,
          setHeight,
        }),
      );
    });

    // Must clear, NOT populate with A's '100px'.
    expect(setWidth).toHaveBeenLastCalledWith('');
    expect(setHeight).toHaveBeenLastCalledWith('');
  });

  it('populates fields when parsedStyles updates for the same selected element', () => {
    // After selection change, useElementStyleData delivers parsedStyles for the NEW element.
    // selectedId hasn't changed again — the hook must populate (not clear) this time.

    const setWidth = mock(() => {});
    const setHeight = mock(() => {});

    const { rerender } = renderHook((props) => usePopulateStyleState(props), {
      initialProps: makeDeps({
        selectedId: 'element-B',
        parsedStyles: null, // loading state: no data yet
        setWidth,
        setHeight,
      }),
    });

    setWidth.mockClear();
    setHeight.mockClear();

    // parsedStyles for element-B arrives (same selectedId, new parsedStyles).
    act(() => {
      rerender(
        makeDeps({
          selectedId: 'element-B',
          parsedStyles: STYLES_B,
          setWidth,
          setHeight,
        }),
      );
    });

    // Must populate with B's values.
    expect(setWidth).toHaveBeenLastCalledWith('200px');
    expect(setHeight).toHaveBeenLastCalledWith('80px');
  });

  it('style refresh on same element still repopulates (guards against over-firing clear)', () => {
    // A style write bumps refreshKey → useElementStyleData re-reads the same element
    // and delivers a new parsedStyles object. selectedId is unchanged. Must populate.

    const setBackgroundColor = mock(() => {});

    const { rerender } = renderHook((props) => usePopulateStyleState(props), {
      initialProps: makeDeps({
        selectedId: 'element-A',
        parsedStyles: STYLES_A,
        setBackgroundColor,
      }),
    });

    expect(setBackgroundColor).toHaveBeenLastCalledWith('#ff0000');
    setBackgroundColor.mockClear();

    // Same element, updated parsedStyles (post-write re-read).
    const updatedStyles: Partial<ParsedStyles> = { ...STYLES_A, backgroundColor: '#00ff00' };
    act(() => {
      rerender(
        makeDeps({
          selectedId: 'element-A',
          parsedStyles: updatedStyles,
          setBackgroundColor,
        }),
      );
    });

    expect(setBackgroundColor).toHaveBeenLastCalledWith('#00ff00');
  });
});
