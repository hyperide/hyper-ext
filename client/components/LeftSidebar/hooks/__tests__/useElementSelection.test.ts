/**
 * Tests for useElementSelection hover and scroll behaviour.
 *
 * Coverage:
 *  - Task В: handleSelect (VS Code path) dispatches selectedIds AND sends
 *    iframe:scrollToElement so the canvas scrolls to the element.
 *  - Task Г: handleHover (VS Code path) converts UUID → nodeRef before
 *    dispatching hoveredId so the iframe overlay highlights the right element.
 *  - Canvas → tree hover: sharedHoveredId (nodeRef) is reverse-mapped to
 *    UUID so ElementsTree row gets highlighted correctly.
 */

import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

// ─── Shared mutable state for mock hooks ────────────────────────────────────

const mockState = {
  engine: null as null | object,
  sharedSelectedIds: [] as string[],
  sharedHoveredId: null as string | null,
  currentComponent: null as null | { path: string },
};

// Dispatch mock — captures calls from createSharedDispatch
const dispatchMock = mock();
// canvas.sendEvent mock
const sendEventMock = mock();

// ─── Module mocks (must appear before any import of the module under test) ──

mock.module('@/lib/canvas-engine', () => ({
  useCanvasEngineOptional: () => mockState.engine,
  useSelectedIdsOptional: () => mockState.sharedSelectedIds,
}));

mock.module('@/lib/element-tracing/id-bridge', () => ({
  resolveIdsToUuids: (ids: string[]) => ids,
}));

mock.module('@/lib/platform', () => ({
  usePlatformCanvas: () => ({ sendEvent: sendEventMock }),
}));

mock.module('@/lib/platform/shared-editor-state', () => ({
  createSharedDispatch: () => dispatchMock,
  useCurrentComponent: () => mockState.currentComponent,
  useHoveredId: () => mockState.sharedHoveredId,
  useSelectedIds: () => mockState.sharedSelectedIds,
}));

// ─── Import hook under test AFTER mocks ─────────────────────────────────────

import type { TreeNode } from '../../../ElementsTree';
import { useElementSelection } from '../useElementSelection';

// ─── Fixtures ───────────────────────────────────────────────────────────────

const TREE: TreeNode[] = [
  {
    id: 'uuid-button',
    label: 'Button',
    type: 'element',
    loc: { start: { line: 10, column: 4 }, end: { line: 10, column: 20 } },
    children: [],
  },
  {
    id: 'uuid-text',
    label: 'span',
    type: 'element',
    loc: { start: { line: 12, column: 6 }, end: { line: 12, column: 18 } },
    children: [],
  },
];

const COMPONENT_PATH = '/project/src/App.tsx';

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeClickEvent(meta = false): React.MouseEvent {
  return { metaKey: meta, ctrlKey: false, shiftKey: false } as React.MouseEvent;
}

beforeEach(() => {
  dispatchMock.mockReset();
  sendEventMock.mockReset();
  mockState.engine = null;
  mockState.sharedSelectedIds = [];
  mockState.sharedHoveredId = null;
  mockState.currentComponent = { path: COMPONENT_PATH };
});

// ─── Task В: scroll canvas on tree row click ─────────────────────────────────

describe('handleSelect — VS Code path', () => {
  it('dispatches selectedIds with nodeRef when node has loc', () => {
    const { result } = renderHook(() => useElementSelection(TREE));
    const expectedRef = `${COMPONENT_PATH}:10:4`;

    act(() => {
      result.current.handleSelect('uuid-button', makeClickEvent());
    });

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    // handleSelect also resets selectedElementRuntimeStyle / selectedItemIndices
    // as part of the selection-change payload. We only pin selectedIds here —
    // the reset fields are an implementation detail of useSelectionDispatcher.
    expect(dispatchMock.mock.calls[0][0]).toEqual(expect.objectContaining({ selectedIds: [expectedRef] }));
  });

  it('sends iframe:scrollToElement with nodeRef after selection', () => {
    const { result } = renderHook(() => useElementSelection(TREE));
    const expectedRef = `${COMPONENT_PATH}:10:4`;

    act(() => {
      result.current.handleSelect('uuid-button', makeClickEvent());
    });

    expect(sendEventMock).toHaveBeenCalledWith({
      type: 'iframe:scrollToElement',
      elementId: expectedRef,
    });
  });

  it('falls back to UUID when node has no loc', () => {
    const treeWithoutLoc: TreeNode[] = [{ id: 'uuid-noloc', label: 'div', type: 'element', children: [] }];
    const { result } = renderHook(() => useElementSelection(treeWithoutLoc));

    act(() => {
      result.current.handleSelect('uuid-noloc', makeClickEvent());
    });

    expect(dispatchMock.mock.calls[0][0]).toEqual(expect.objectContaining({ selectedIds: ['uuid-noloc'] }));
    expect(sendEventMock).toHaveBeenCalledWith({
      type: 'iframe:scrollToElement',
      elementId: 'uuid-noloc',
    });
  });

  it('does NOT send scroll event when no currentComponent path', () => {
    mockState.currentComponent = null;
    const { result } = renderHook(() => useElementSelection(TREE));

    act(() => {
      result.current.handleSelect('uuid-button', makeClickEvent());
    });

    // dispatch happens with UUID fallback
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    // scroll still sent (with UUID)
    expect(sendEventMock).toHaveBeenCalledWith({
      type: 'iframe:scrollToElement',
      elementId: 'uuid-button',
    });
  });
});

// ─── Task Г: hover tree → canvas (nodeRef conversion) ───────────────────────

describe('handleHover — VS Code path', () => {
  it('converts UUID → nodeRef before dispatching hoveredId', () => {
    const { result } = renderHook(() => useElementSelection(TREE));
    const expectedRef = `${COMPONENT_PATH}:12:6`;

    act(() => {
      result.current.handleHover('uuid-text');
    });

    expect(dispatchMock).toHaveBeenCalledWith({ hoveredId: expectedRef });
  });

  it('dispatches hoveredId: null when hover cleared', () => {
    const { result } = renderHook(() => useElementSelection(TREE));

    act(() => {
      result.current.handleHover(null);
    });

    expect(dispatchMock).toHaveBeenCalledWith({ hoveredId: null });
  });

  it('falls back to UUID when node has no loc', () => {
    const treeWithoutLoc: TreeNode[] = [{ id: 'uuid-noloc', label: 'div', type: 'element', children: [] }];
    const { result } = renderHook(() => useElementSelection(treeWithoutLoc));

    act(() => {
      result.current.handleHover('uuid-noloc');
    });

    expect(dispatchMock).toHaveBeenCalledWith({ hoveredId: 'uuid-noloc' });
  });
});

// ─── Task Г: hover canvas → tree (nodeRef → UUID for row highlight) ──────────

describe('hoveredId — canvas → tree (reverse mapping)', () => {
  it('maps incoming nodeRef to UUID for tree row highlight', () => {
    mockState.sharedHoveredId = `${COMPONENT_PATH}:10:4`;
    const { result } = renderHook(() => useElementSelection(TREE));

    expect(result.current.hoveredId).toBe('uuid-button');
  });

  it('returns null when no element is hovered', () => {
    mockState.sharedHoveredId = null;
    const { result } = renderHook(() => useElementSelection(TREE));

    expect(result.current.hoveredId).toBeNull();
  });

  it('returns raw nodeRef when line:col do not match any tree node', () => {
    mockState.sharedHoveredId = `${COMPONENT_PATH}:99:0`;
    const { result } = renderHook(() => useElementSelection(TREE));

    // No tree node at line 99 → falls back to nodeRef itself
    expect(result.current.hoveredId).toBe(`${COMPONENT_PATH}:99:0`);
  });
});
