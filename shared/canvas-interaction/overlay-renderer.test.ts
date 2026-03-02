import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { Window } from 'happy-dom';

// Set up global DOM APIs from happy-dom
const win = new Window({ url: 'http://localhost' });
globalThis.document = win.document as unknown as Document;
globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
globalThis.HTMLDivElement = win.HTMLDivElement as unknown as typeof HTMLDivElement;
globalThis.MouseEvent = win.MouseEvent as unknown as typeof MouseEvent;

import { clearOverlays, renderOverlayRects, renderPlaceholderOverlays } from './overlay-renderer';
import type { OverlayRect, PlaceholderRect } from './types';

/**
 * Tests for overlay-renderer — low-level DOM functions that create/update/remove
 * overlay divs in a container element.
 *
 * Uses happy-dom for real DOM operations.
 */

/** Get element from map or fail the test */
function getEl(map: Map<string, HTMLDivElement>, key: string): HTMLDivElement {
  const el = map.get(key);
  expect(el).toBeDefined();
  return el as HTMLDivElement;
}

describe('renderOverlayRects', () => {
  let container: HTMLDivElement;
  let elements: Map<string, HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    elements = new Map();
  });

  it('creates overlay divs for each rect', () => {
    const rects: OverlayRect[] = [
      { key: 'hover-a', left: 10, top: 20, width: 100, height: 50, type: 'hover' },
      { key: 'select-b', left: 30, top: 40, width: 200, height: 80, type: 'selection' },
    ];

    renderOverlayRects(container, rects, elements);

    expect(elements.size).toBe(2);
    expect(container.children.length).toBe(2);

    const hoverEl = getEl(elements, 'hover-a');
    expect(hoverEl.style.left).toBe('10px');
    expect(hoverEl.style.top).toBe('20px');
    expect(hoverEl.style.width).toBe('100px');
    expect(hoverEl.style.height).toBe('50px');
    expect(hoverEl.style.position).toBe('absolute');
    expect(hoverEl.style.pointerEvents).toBe('none');
    expect(hoverEl.getAttribute('data-selection-overlay')).toBe('true');
  });

  it('applies different border styles for hover vs selection', () => {
    renderOverlayRects(
      container,
      [
        { key: 'h1', left: 0, top: 0, width: 10, height: 10, type: 'hover' },
        { key: 's1', left: 0, top: 0, width: 10, height: 10, type: 'selection' },
      ],
      elements,
    );

    const hover = getEl(elements, 'h1');
    const selection = getEl(elements, 's1');
    expect(hover.style.border).toContain('rgba(59, 130, 246, 0.5)');
    expect(selection.style.border).toContain('rgb(59, 130, 246)');
  });

  it('reuses existing overlay elements on update', () => {
    renderOverlayRects(container, [{ key: 'a', left: 0, top: 0, width: 10, height: 10, type: 'hover' }], elements);

    const firstEl = getEl(elements, 'a');

    renderOverlayRects(container, [{ key: 'a', left: 50, top: 60, width: 200, height: 100, type: 'hover' }], elements);

    expect(elements.get('a')).toBe(firstEl);
    expect(firstEl.style.left).toBe('50px');
    expect(firstEl.style.top).toBe('60px');
  });

  it('removes overlays no longer present in rects', () => {
    renderOverlayRects(
      container,
      [
        { key: 'a', left: 0, top: 0, width: 10, height: 10, type: 'hover' },
        { key: 'b', left: 0, top: 0, width: 10, height: 10, type: 'selection' },
      ],
      elements,
    );

    expect(elements.size).toBe(2);

    renderOverlayRects(container, [{ key: 'a', left: 0, top: 0, width: 10, height: 10, type: 'hover' }], elements);

    expect(elements.size).toBe(1);
    expect(elements.has('b')).toBe(false);
  });

  it('clears all overlays when rects is empty', () => {
    renderOverlayRects(container, [{ key: 'a', left: 0, top: 0, width: 10, height: 10, type: 'hover' }], elements);

    renderOverlayRects(container, [], elements);

    expect(elements.size).toBe(0);
  });
});

describe('clearOverlays', () => {
  it('removes all elements and clears the map', () => {
    const container = document.createElement('div');
    const elements = new Map<string, HTMLDivElement>();

    renderOverlayRects(
      container,
      [
        { key: 'a', left: 0, top: 0, width: 10, height: 10, type: 'hover' },
        { key: 'b', left: 0, top: 0, width: 10, height: 10, type: 'selection' },
      ],
      elements,
    );

    expect(container.children.length).toBe(2);

    clearOverlays(elements);

    expect(elements.size).toBe(0);
  });
});

describe('renderPlaceholderOverlays', () => {
  let container: HTMLDivElement;
  let elements: Map<string, HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    elements = new Map();
  });

  it('creates placeholder divs with correct position', () => {
    const rects: PlaceholderRect[] = [{ elementId: 'e1', left: 10, top: 20, width: 200, height: 100 }];

    renderPlaceholderOverlays(container, rects, elements);

    expect(elements.size).toBe(1);
    const el = getEl(elements, 'placeholder-e1-0');
    expect(el.getAttribute('data-placeholder-overlay')).toBe('true');
    expect(el.style.left).toBe('10px');
    expect(el.style.top).toBe('20px');
    expect(el.style.width).toBe('200px');
    expect(el.style.height).toBe('100px');
    expect(el.style.position).toBe('absolute');
  });

  it('renders non-interactive when onClick is omitted', () => {
    renderPlaceholderOverlays(container, [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }], elements);

    const el = getEl(elements, 'placeholder-e1-0');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.style.cursor).not.toBe('pointer');
  });

  it('renders interactive with onClick handler', () => {
    const onClick = mock((_id: string) => {});

    renderPlaceholderOverlays(
      container,
      [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }],
      elements,
      onClick,
    );

    const el = getEl(elements, 'placeholder-e1-0');
    expect(el.style.pointerEvents).toBe('auto');
    expect(el.style.cursor).toBe('pointer');

    el.click();
    expect(onClick).toHaveBeenCalledWith('e1');
  });

  it('updates onClick handler when elementId changes', () => {
    const clicks: string[] = [];
    const onClick = (id: string) => clicks.push(id);

    renderPlaceholderOverlays(
      container,
      [{ elementId: 'first', left: 0, top: 0, width: 50, height: 50 }],
      elements,
      onClick,
    );

    elements.get('placeholder-first-0')?.click();
    expect(clicks).toEqual(['first']);

    renderPlaceholderOverlays(
      container,
      [{ elementId: 'second', left: 0, top: 0, width: 50, height: 50 }],
      elements,
      onClick,
    );

    elements.get('placeholder-second-0')?.click();
    expect(clicks).toEqual(['first', 'second']);
  });

  it('removes unused placeholders', () => {
    renderPlaceholderOverlays(
      container,
      [
        { elementId: 'e1', left: 0, top: 0, width: 50, height: 50 },
        { elementId: 'e2', left: 0, top: 60, width: 50, height: 50 },
      ],
      elements,
    );

    expect(elements.size).toBe(2);

    renderPlaceholderOverlays(container, [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }], elements);

    expect(elements.size).toBe(1);
    expect(elements.has('placeholder-e2-1')).toBe(false);
  });

  it('contains SVG icon inside placeholder', () => {
    renderPlaceholderOverlays(container, [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }], elements);

    const el = getEl(elements, 'placeholder-e1-0');
    const inner = el.firstElementChild as HTMLElement;
    expect(inner).toBeTruthy();
    expect(inner.innerHTML).toContain('<svg');
  });

  it('clears onclick when onClick is omitted on re-render', () => {
    const onClick = mock((_id: string) => {});

    renderPlaceholderOverlays(
      container,
      [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }],
      elements,
      onClick,
    );

    expect(getEl(elements, 'placeholder-e1-0').onclick).toBeTruthy();

    renderPlaceholderOverlays(container, [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }], elements);

    expect(getEl(elements, 'placeholder-e1-0').onclick).toBeNull();
  });
});
