/**
 * Regression test for drag-start iframe hit-testing fix.
 *
 * Before fix: iframe.style.pointerEvents was set to 'none' only after the 5 px
 * mousemove threshold inside handleDragMove. If the cursor crossed the iframe
 * boundary before that, the iframe absorbed mousemove events and the drag never
 * actually started.
 *
 * After fix: handleDragStart immediately sets pointer-events to 'none' so the
 * parent window continues receiving mousemove/mouseup regardless of where the
 * cursor ends up during the gesture.
 */
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';
import type { RefObject } from 'react';

// ── Mock iframe document ─────────────────────────────────────────────────────

const instanceEl = (() => {
  const el = document.createElement('div') as HTMLDivElement & {
    getBoundingClientRect(): DOMRect;
  };
  el.setAttribute('data-canvas-instance-id', 'instance-1');
  el.style.left = '50px';
  el.style.top = '80px';
  el.getBoundingClientRect = () =>
    ({
      left: 50,
      top: 80,
      right: 250,
      bottom: 380,
      width: 200,
      height: 300,
      x: 50,
      y: 80,
    }) as DOMRect;
  return el;
})();

const mockIframeDoc = {
  querySelector: (sel: string) => (sel.includes('instance-1') ? instanceEl : null),
  querySelectorAll: (_sel: string) => [instanceEl] as unknown as NodeListOf<Element>,
};

const mockIframe = {
  style: { pointerEvents: 'auto' as string },
  contentDocument: mockIframeDoc,
};

mock.module('@/lib/dom-utils', () => ({ getPreviewIframe: () => mockIframe }));
mock.module('@/utils/authFetch', () => ({
  authFetch: () => Promise.resolve({ ok: true, json: async () => ({ commentsUpdated: 0 }) }),
}));

// ── Import after mocks ───────────────────────────────────────────────────────

import { useInstanceOverlays } from '../useInstanceOverlays';

// ── Shared props ─────────────────────────────────────────────────────────────

const VIEWPORT = { zoom: 1, panX: 0, panY: 0 };

// ── Tests ────────────────────────────────────────────────────────────────────

describe('useInstanceOverlays — drag-start iframe hit-testing', () => {
  let container: HTMLDivElement;
  let containerRef: RefObject<HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    // { current: HTMLDivElement } satisfies RefObject<HTMLDivElement> structurally
    containerRef = { current: container } as RefObject<HTMLDivElement>;
    mockIframe.style.pointerEvents = 'auto'; // reset between tests
  });

  afterEach(() => {
    if (container.parentNode) {
      container.parentNode.removeChild(container);
    }
  });

  it('sets iframe pointer-events to none immediately on mousedown (board mode)', async () => {
    const { unmount } = renderHook(() =>
      useInstanceOverlays({
        boardModeActive: true,
        activeInstanceId: null,
        selectedInstancesInBoard: [],
        mode: 'design',
        overlayContainerRef: containerRef,
        iframeLoadedCounter: 0,
        projectId: 'proj-1',
        componentPath: 'src/App.tsx',
        onDoubleClick: () => {},
        viewport: VIEWPORT,
      }),
    );

    // Flush one RAF iteration so overlay DOM elements are created
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const frame = container.querySelector('[data-instance-frame="instance-1"]');
    if (!frame) throw new Error('frame overlay not found — hook did not create it');

    // Board mode: RAF sets pointer-events to none when no drag is active
    expect(mockIframe.style.pointerEvents).toBe('none');

    // Reset to 'auto' so we can observe the immediate change from handleDragStart
    mockIframe.style.pointerEvents = 'auto';

    // Fire mousedown — this triggers handleDragStart
    frame.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));

    // REGRESSION CHECK: pointer-events must be 'none' immediately after mousedown,
    // before any mousemove event fires. Previously this only happened after 5 px.
    expect(mockIframe.style.pointerEvents).toBe('none');

    unmount();
  });

  it('fires onInstanceDragging and onInstanceDragEnd on a complete drag gesture', async () => {
    const onInstanceDragging = mock(() => {});
    const onInstanceDragEnd = mock(() => {});

    // Use multiples of GRID_SIZE (16) for predictable snap: 4*16=64
    instanceEl.style.left = '64px';
    instanceEl.style.top = '64px';

    const { unmount } = renderHook(() =>
      useInstanceOverlays({
        boardModeActive: true,
        activeInstanceId: null,
        selectedInstancesInBoard: [],
        mode: 'design',
        overlayContainerRef: containerRef,
        iframeLoadedCounter: 0,
        projectId: 'proj-1',
        componentPath: 'src/App.tsx',
        onDoubleClick: () => {},
        onInstanceDragging,
        onInstanceDragEnd,
        viewport: VIEWPORT,
      }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const frame = container.querySelector('[data-instance-frame="instance-1"]');
    if (!frame) throw new Error('frame overlay not found');

    // Start drag
    frame.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));

    // Move 32px — above 5px threshold. newX=round((64+32)/16)*16=96, newY=96, delta=32 both axes.
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 132, clientY: 132, bubbles: true }));

    expect(onInstanceDragging).toHaveBeenCalledWith('instance-1', 32, 32);

    // End drag
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(onInstanceDragEnd).toHaveBeenCalledWith('instance-1', 32, 32);

    instanceEl.style.left = '50px';
    instanceEl.style.top = '80px';
    unmount();
  });

  it('does not set pointer-events:none for right-click (non-left button)', async () => {
    const { unmount } = renderHook(() =>
      useInstanceOverlays({
        boardModeActive: true,
        activeInstanceId: null,
        selectedInstancesInBoard: [],
        mode: 'design',
        overlayContainerRef: containerRef,
        iframeLoadedCounter: 0,
        projectId: 'proj-1',
        componentPath: 'src/App.tsx',
        onDoubleClick: () => {},
        viewport: VIEWPORT,
      }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const frame = container.querySelector('[data-instance-frame="instance-1"]');
    if (!frame) throw new Error('frame overlay not found');
    mockIframe.style.pointerEvents = 'auto';

    // Right-click — handleDragStart returns early for button !== 0
    frame.dispatchEvent(new MouseEvent('mousedown', { button: 2, clientX: 100, clientY: 100, bubbles: true }));

    // pointer-events should remain unchanged — no drag initiated
    expect(mockIframe.style.pointerEvents).toBe('auto');

    unmount();
  });

  it('does not set pointer-events:none in readonly mode', async () => {
    const { unmount } = renderHook(() =>
      useInstanceOverlays({
        boardModeActive: true,
        activeInstanceId: null,
        selectedInstancesInBoard: [],
        mode: 'design',
        overlayContainerRef: containerRef,
        iframeLoadedCounter: 0,
        projectId: 'proj-1',
        componentPath: 'src/App.tsx',
        onDoubleClick: () => {},
        viewport: VIEWPORT,
        isReadonly: true,
      }),
    );

    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

    const frame = container.querySelector('[data-instance-frame="instance-1"]');
    if (!frame) throw new Error('frame overlay not found');
    mockIframe.style.pointerEvents = 'auto';

    frame.dispatchEvent(new MouseEvent('mousedown', { button: 0, clientX: 100, clientY: 100, bubbles: true }));

    // Readonly mode — handleDragStart returns early, no pointer-events change
    expect(mockIframe.style.pointerEvents).toBe('auto');

    unmount();
  });
});
