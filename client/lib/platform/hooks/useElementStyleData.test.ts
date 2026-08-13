import { describe, expect, test } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { SelectedElementRuntimeStyle } from '@lib/types';
import { parseHexWithAlpha } from '@shared/utils/color';
import type { CanvasAdapter } from '../types';
import { classNameToStyles, mergeRuntimeStyle, useElementStyleData } from './useElementStyleData';

describe('mergeRuntimeStyle', () => {
  const elementId = 'client/components/FAQ.tsx:42:10';

  test('bg-primary/15 class + computed rgba populates backgroundColor with alpha', () => {
    // tw-to-css cannot resolve CSS-variable tokens like bg-primary/15 → backgroundColor is undefined
    const base = classNameToStyles('bg-primary/15');
    expect(base.backgroundColor).toBeUndefined();

    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(184, 103, 46, 0.15)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    expect(merged.backgroundColor).toBeDefined();
    // Should be hex with alpha channel so Inspector can parse opacity
    const { color, opacity } = parseHexWithAlpha(merged.backgroundColor as string);
    expect(color).toBe('#b8672e');
    // 0.15 * 255 = 38.25 → 38 / 255 * 100 = 14.9 → round → 15
    expect(opacity).toBe('15');
  });

  test('does not overwrite Tailwind-parsed backgroundColor', () => {
    const base = classNameToStyles('bg-red-500');
    expect(base.backgroundColor).toBeDefined();
    const original = base.backgroundColor;

    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(184, 103, 46, 0.15)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    // Must not overwrite — Tailwind parse takes precedence
    expect(merged.backgroundColor).toBe(original);
  });

  test('stale runtime style from different .map() itemIndex is ignored', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      itemIndex: 0,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(255, 0, 0, 1)' },
    };

    // Snapshot was captured for item 0, but we are now looking at item 1
    const merged = mergeRuntimeStyle(base, runtime, elementId, 1);
    // itemIndex mismatch — merge must be skipped
    expect(merged.backgroundColor).toBeUndefined();
  });

  test('runtime style with matching itemIndex is applied', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      itemIndex: 1,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(184, 103, 46, 0.15)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId, 1);
    expect(merged.backgroundColor).toBeDefined();
  });

  test('runtime style captured for a .map() item is not applied to a selection without itemIndex (HYP-637)', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      itemIndex: 0,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(255, 0, 0, 1)' },
    };

    // Snapshot belongs to .map() item 0; the current selection carries no item index,
    // so the snapshot cannot be assumed to describe it.
    const merged = mergeRuntimeStyle(base, runtime, elementId);
    expect(merged.backgroundColor).toBeUndefined();
  });

  test('runtime style without itemIndex is not applied to a .map() item selection (HYP-637)', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(255, 0, 0, 1)' },
    };

    // Snapshot has no item index but the selection is item 1 of a .map() — mismatch.
    const merged = mergeRuntimeStyle(base, runtime, elementId, 1);
    expect(merged.backgroundColor).toBeUndefined();
  });

  test('stale runtime style (different elementId) is ignored', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/Other.tsx',
      elementId: 'client/components/Other.tsx:10:5',
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(255, 0, 0, 1)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    // Different elementId — merge must be skipped
    expect(merged.backgroundColor).toBeUndefined();
  });

  test('null runtime style returns base unchanged', () => {
    const base = classNameToStyles('text-red-500');
    const merged = mergeRuntimeStyle(base, null, elementId);
    expect(merged).toBe(base);
  });

  test('fully transparent computed background is not applied', () => {
    const base = classNameToStyles('bg-primary/15');
    const runtime: SelectedElementRuntimeStyle = {
      componentPath: 'client/components/FAQ.tsx',
      elementId,
      seq: 1,
      computedStyle: { backgroundColor: 'rgba(0, 0, 0, 0)' },
    };

    const merged = mergeRuntimeStyle(base, runtime, elementId);
    // rgba(0,0,0,0) is browser-default transparent — must not populate backgroundColor
    expect(merged.backgroundColor).toBeUndefined();
  });
});

// ============================================================================
// useElementStyleData — VS Code mode: stale parsedStyles on selection change
// ============================================================================

/** Minimal canvas mock that routes styles:response to registered handlers. */
function makeCanvas() {
  const responseHandlers = new Set<(msg: unknown) => void>();
  const sent: Array<{ type: string; requestId?: string }> = [];

  const canvas: CanvasAdapter = {
    onEvent(type: string, handler: (msg: unknown) => void) {
      if (type === 'styles:response') {
        responseHandlers.add(handler);
        return () => {
          responseHandlers.delete(handler);
        };
      }
      return () => {};
    },
    sendEvent(msg: unknown) {
      sent.push(msg as { type: string; requestId?: string });
    },
  } as unknown as CanvasAdapter;

  /** Emit styles:response using the requestId from the most-recent styles:readClassName call. */
  const emitResponse = (overrides: Record<string, unknown> = {}) => {
    const req = [...sent].reverse().find((m) => m.type === 'styles:readClassName');
    const payload = {
      requestId: req?.requestId,
      success: true,
      className: 'bg-red-500',
      tagType: 'div',
      textContent: '',
      ...overrides,
    };
    for (const h of responseHandlers) h(payload);
  };

  return { canvas, sent, emitResponse };
}

describe('useElementStyleData — stale data on selection change (VS Code mode)', () => {
  test('clears parsedStyles immediately when elementId changes (element click)', async () => {
    const { canvas, emitResponse } = makeCanvas();
    const { result, rerender } = renderHook(
      (props: { elementId: string; componentPath: string }) => useElementStyleData({ ...props, canvas }),
      { initialProps: { elementId: 'src/A.tsx:5:3', componentPath: 'src/A.tsx' } },
    );

    // First element: respond so parsedStyles is populated
    act(() => emitResponse());
    await waitFor(() => expect(result.current.parsedStyles).not.toBeNull());

    // Click a different element in the same component
    rerender({ elementId: 'src/A.tsx:10:5', componentPath: 'src/A.tsx' });

    // Before the new RPC response, parsedStyles must be null — no stale data shown
    expect(result.current.parsedStyles).toBeNull();
  });

  test('clears parsedStyles immediately on component switch even when selectedIds is stale', async () => {
    const { canvas, emitResponse } = makeCanvas();
    const { result, rerender } = renderHook(
      (props: { elementId: string; componentPath: string }) => useElementStyleData({ ...props, canvas }),
      { initialProps: { elementId: 'src/OldComp.tsx:5:3', componentPath: 'src/OldComp.tsx' } },
    );

    // Populate parsedStyles for OldComp element
    act(() => emitResponse());
    await waitFor(() => expect(result.current.parsedStyles).not.toBeNull());

    // Component switch: componentPath changes but elementId stays stale
    // (mirrors the real bug: selectedIds not cleared on setComponent → component:open)
    rerender({ elementId: 'src/OldComp.tsx:5:3', componentPath: 'src/TweetComposer.tsx' });

    // parsedStyles must be null before TweetComposer's response — no OldComp data shown
    expect(result.current.parsedStyles).toBeNull();
  });

  test('does NOT clear parsedStyles on same-element re-read (refreshKey/locale bump)', async () => {
    const { canvas, emitResponse } = makeCanvas();
    const { result, rerender } = renderHook(
      (props: { elementId: string; componentPath: string; refreshKey: number }) =>
        useElementStyleData({ ...props, canvas }),
      { initialProps: { elementId: 'src/A.tsx:5:3', componentPath: 'src/A.tsx', refreshKey: 0 } },
    );

    act(() => emitResponse());
    await waitFor(() => expect(result.current.parsedStyles).not.toBeNull());

    // Bump refreshKey — same element, same component (locale change or style write re-read)
    rerender({ elementId: 'src/A.tsx:5:3', componentPath: 'src/A.tsx', refreshKey: 1 });

    // parsedStyles must stay — avoid flicker during re-read of the same element
    expect(result.current.parsedStyles).not.toBeNull();
  });
});
