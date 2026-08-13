import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { checkSelectionOverlayInvariant } from './assert-selection-overlays';
import {
  applyOverlayErrorState,
  clearOverlays,
  renderOverlayRects,
  renderPlaceholderOverlays,
} from './overlay-renderer';
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
    expect(container.children.length).toBe(0);
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
    const icon = el.firstElementChild as HTMLElement;
    expect(icon.style.cursor).not.toBe('pointer');
  });

  it('renders interactive icon with onClick handler', () => {
    const onClick = mock((_id: string) => {});

    renderPlaceholderOverlays(
      container,
      [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }],
      elements,
      onClick,
    );

    const el = getEl(elements, 'placeholder-e1-0');
    const icon = el.firstElementChild as HTMLElement;
    expect(icon.style.pointerEvents).toBe('auto');
    expect(icon.style.cursor).toBe('pointer');

    icon.click();
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

    (elements.get('placeholder-first-0')?.firstElementChild as HTMLElement)?.click();
    expect(clicks).toEqual(['first']);

    renderPlaceholderOverlays(
      container,
      [{ elementId: 'second', left: 0, top: 0, width: 50, height: 50 }],
      elements,
      onClick,
    );

    (elements.get('placeholder-second-0')?.firstElementChild as HTMLElement)?.click();
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

    const icon = getEl(elements, 'placeholder-e1-0').firstElementChild as HTMLElement;
    expect(icon.onclick).toBeTruthy();

    renderPlaceholderOverlays(container, [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }], elements);

    expect(icon.onclick).toBeNull();
  });

  it('contains tooltip element', () => {
    renderPlaceholderOverlays(container, [{ elementId: 'e1', left: 0, top: 0, width: 50, height: 50 }], elements);

    const el = getEl(elements, 'placeholder-e1-0');
    const tooltip = el.children[1] as HTMLElement;
    expect(tooltip).toBeTruthy();
    expect(tooltip.textContent).toBe('Insert element');
    expect(tooltip.style.opacity).toBe('0');
  });
});

/** Collect all direct children with data-resize-handle attribute. */
function getResizeHandles(overlay: HTMLDivElement): Array<{ axis: string; el: HTMLElement }> {
  return Array.from(overlay.children)
    .map((el) => {
      const axis = (el as HTMLElement).getAttribute('data-resize-handle');
      return axis ? { axis, el: el as HTMLElement } : null;
    })
    .filter(Boolean) as Array<{ axis: string; el: HTMLElement }>;
}

describe('renderOverlayRects — resize handles for explicit Tailwind sizes', () => {
  let container: HTMLDivElement;
  let elements: Map<string, HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    elements = new Map();
  });

  it('renders width and height resize handle dots for w-12 h-12 selection rect', () => {
    // Fixture class: "shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-primary/20 text-primary"
    // w-12 = 48px, h-12 = 48px — both axes have explicit Tailwind size, so both handles must render
    const rect: OverlayRect = {
      key: 'select-w12h12',
      left: 10,
      top: 20,
      width: 48,
      height: 48,
      type: 'selection',
      resizable: { width: true, height: true },
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-w12h12');
    const handles = getResizeHandles(overlay);
    const axes = handles.map((h) => h.axis);

    expect(axes).toContain('width');
    expect(axes).toContain('height');
  });

  it('renders only width handle when only width is explicit', () => {
    const rect: OverlayRect = {
      key: 'select-w-only',
      left: 0,
      top: 0,
      width: 48,
      height: 80,
      type: 'selection',
      resizable: { width: true, height: false },
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-w-only');
    const axes = getResizeHandles(overlay).map((h) => h.axis);

    expect(axes).toContain('width');
    expect(axes).not.toContain('height');
  });

  it('does not render resize handles for hover rects even with resizable metadata', () => {
    const rect: OverlayRect = {
      key: 'hover-w12h12',
      left: 0,
      top: 0,
      width: 48,
      height: 48,
      type: 'hover',
      resizable: { width: true, height: true },
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'hover-w12h12');
    expect(getResizeHandles(overlay)).toHaveLength(0);
  });

  it('does not render resize handles for selection rect without explicit size', () => {
    const rect: OverlayRect = {
      key: 'select-no-size',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      type: 'selection',
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-no-size');
    expect(getResizeHandles(overlay)).toHaveLength(0);
  });

  it('resize handle dots have pointer-events: auto so drag events are received', () => {
    const rect: OverlayRect = {
      key: 'select-ptr-events',
      left: 0,
      top: 0,
      width: 48,
      height: 48,
      type: 'selection',
      resizable: { width: true, height: true },
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-ptr-events');
    for (const { el } of getResizeHandles(overlay)) {
      expect(el.style.pointerEvents).toBe('auto');
    }
  });

  it('width handle has ew-resize cursor and height handle has ns-resize cursor', () => {
    const rect: OverlayRect = {
      key: 'select-cursor',
      left: 0,
      top: 0,
      width: 48,
      height: 48,
      type: 'selection',
      resizable: { width: true, height: true },
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-cursor');
    const handles = getResizeHandles(overlay);
    const widthHandle = handles.find((h) => h.axis === 'width')?.el;
    const heightHandle = handles.find((h) => h.axis === 'height')?.el;

    expect(widthHandle?.style.cursor).toBe('ew-resize');
    expect(heightHandle?.style.cursor).toBe('ns-resize');
  });

  it('stores data-element-id on selection overlay div when rect.elementId is provided', () => {
    const rect: OverlayRect = {
      key: 'select-with-eid',
      elementId: '/abs/path/src/Foo.tsx:10:5',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      type: 'selection',
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-with-eid');
    expect(overlay.dataset.elementId).toBe('/abs/path/src/Foo.tsx:10:5');
  });

  it('does not set data-element-id when rect.elementId is absent', () => {
    const rect: OverlayRect = {
      key: 'select-no-eid',
      left: 0,
      top: 0,
      width: 100,
      height: 50,
      type: 'selection',
    };

    renderOverlayRects(container, [rect], elements);

    const overlay = getEl(elements, 'select-no-eid');
    expect(overlay.dataset.elementId).toBeUndefined();
  });
});

describe('applyOverlayErrorState (HYP-991)', () => {
  let container: HTMLDivElement;
  let elements: Map<string, HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    elements = new Map();
    renderOverlayRects(
      container,
      [{ key: 'sel', left: 0, top: 0, width: 10, height: 10, type: 'selection', elementId: 'src/app/Home.tsx:15:8' }],
      elements,
    );
  });

  it('flags the matching overlay with a red outline + badge', () => {
    applyOverlayErrorState(elements, 'src/app/Home.tsx:15:8');
    const el = getEl(elements, 'sel');
    expect(el.style.outline).toContain('rgb(239, 68, 68)');
    expect(el.querySelector('[data-post-edit-error-badge]')).not.toBeNull();
  });

  it('matches a re-rooted (repo-relative) id against the sub-project-relative overlay id', () => {
    // The mutation id that reaches the bridge is re-rooted; the overlay id is sub-project-relative,
    // so one is a `/`-boundary suffix of the other. This is the live monorepo case (conloca).
    applyOverlayErrorState(elements, 'targets/web/src/app/Home.tsx:15:8');
    const el = getEl(elements, 'sel'); // overlay id: src/app/Home.tsx:15:8
    expect(el.style.outline).toContain('rgb(239, 68, 68)');
    expect(el.querySelector('[data-post-edit-error-badge]')).not.toBeNull();
  });

  it('does NOT cross-match two same-basename ids in different directories (`/`-boundary)', () => {
    applyOverlayErrorState(elements, 'src/other/Home.tsx:15:8');
    const el = getEl(elements, 'sel'); // overlay id: src/app/Home.tsx:15:8
    expect(el.style.outline).toBe('');
    expect(el.querySelector('[data-post-edit-error-badge]')).toBeNull();
  });

  it('clears the outline + badge when passed null', () => {
    applyOverlayErrorState(elements, 'src/app/Home.tsx:15:8');
    applyOverlayErrorState(elements, null);
    const el = getEl(elements, 'sel');
    expect(el.style.outline).toBe('');
    expect(el.querySelector('[data-post-edit-error-badge]')).toBeNull();
  });

  it('does not flag a non-matching element', () => {
    applyOverlayErrorState(elements, 'src/app/Other.tsx:1:1');
    const el = getEl(elements, 'sel');
    expect(el.style.outline).toBe('');
    expect(el.querySelector('[data-post-edit-error-badge]')).toBeNull();
  });
});

describe('post-edit error highlight persists across selection change (HYP-991 P2)', () => {
  // This is the regression the codex P2 flagged: renderOverlayRects rebuilds the overlay map from
  // the current selection/hover rects, so the errored element used to lose its highlight the moment
  // the user selected a different element. The fix emits an independent borderless `error` rect for
  // the errored element (computeOverlayRects) so a DOM node always exists for applyOverlayErrorState
  // to (re-)flag. This test reproduces the full host render path at the DOM level.
  const ERRORED = 'src/app/Card.tsx:10:4';
  const OTHER = 'src/app/Button.tsx:20:6';

  function renderAndReapply(container: HTMLDivElement, elements: Map<string, HTMLDivElement>, rects: OverlayRect[]) {
    renderOverlayRects(container, rects, elements);
    // Mirrors useCanvasInteraction's re-apply after every overlayRects rebuild.
    applyOverlayErrorState(elements, ERRORED);
  }

  it('keeps the red outline + badge on the errored node after selecting a DIFFERENT element, then clears it', () => {
    const container = document.createElement('div');
    const elements = new Map<string, HTMLDivElement>();

    // 1. Errored element is selected → gets a selection rect + the error highlight.
    renderAndReapply(container, elements, [
      { key: `select-${ERRORED}-0`, elementId: ERRORED, left: 0, top: 0, width: 50, height: 50, type: 'selection' },
    ]);
    let erroredEl = getEl(elements, `select-${ERRORED}-0`);
    expect(erroredEl.style.outline).toContain('rgb(239, 68, 68)');
    expect(erroredEl.querySelector('[data-post-edit-error-badge]')).not.toBeNull();

    // 2. User selects a DIFFERENT element. The iframe now sends the other element's selection rect
    //    PLUS the independent error rect for the (now unselected) errored element. The old
    //    select-<errored> overlay is removed; the error-<errored> overlay carries the highlight.
    renderAndReapply(container, elements, [
      { key: `select-${OTHER}-0`, elementId: OTHER, left: 100, top: 0, width: 50, height: 50, type: 'selection' },
      { key: `error-${ERRORED}-0`, elementId: ERRORED, left: 0, top: 0, width: 50, height: 50, type: 'error' },
    ]);
    expect(elements.has(`select-${ERRORED}-0`)).toBe(false); // old selection overlay gone
    erroredEl = getEl(elements, `error-${ERRORED}-0`);
    // Error rect is borderless — no blue selection/hover border to fight the red outline.
    expect(erroredEl.style.border).not.toContain('rgb(59, 130, 246)');
    expect(erroredEl.style.outline).toContain('rgb(239, 68, 68)'); // highlight STILL present
    expect(erroredEl.querySelector('[data-post-edit-error-badge]')).not.toBeNull();
    // The newly selected element is NOT flagged.
    const otherEl = getEl(elements, `select-${OTHER}-0`);
    expect(otherEl.style.outline).toBe('');

    // 3. Diagnostic cleared → error rect drops, highlight gone.
    renderOverlayRects(
      container,
      [{ key: `select-${OTHER}-0`, elementId: OTHER, left: 100, top: 0, width: 50, height: 50, type: 'selection' }],
      elements,
    );
    applyOverlayErrorState(elements, null);
    expect(elements.has(`error-${ERRORED}-0`)).toBe(false);
    const remaining = getEl(elements, `select-${OTHER}-0`);
    expect(remaining.style.outline).toBe('');
    expect(remaining.querySelector('[data-post-edit-error-badge]')).toBeNull();
  });
});

describe('error overlays are not selection overlays (HYP-991 — Codex P2)', () => {
  it('tags error rects with data-error-overlay, NOT data-selection-overlay', () => {
    const container = document.createElement('div');
    const elements = new Map<string, HTMLDivElement>();
    renderOverlayRects(
      container,
      [
        { key: 'select-a', elementId: 'a', left: 0, top: 0, width: 10, height: 10, type: 'selection' },
        { key: 'error-b', elementId: 'b', left: 20, top: 0, width: 10, height: 10, type: 'error' },
      ],
      elements,
    );
    expect(getEl(elements, 'select-a').getAttribute('data-selection-overlay')).toBe('true');
    expect(getEl(elements, 'error-b').getAttribute('data-error-overlay')).toBe('true');
    expect(getEl(elements, 'error-b').getAttribute('data-selection-overlay')).toBeNull();
  });

  it('does not inflate the [data-selection-overlay] count (checkSelectionOverlayInvariant)', () => {
    const container = document.createElement('div');
    const elements = new Map<string, HTMLDivElement>();
    // One selected element + one standing error overlay for a DIFFERENT, unselected element.
    renderOverlayRects(
      container,
      [
        { key: 'select-a', elementId: 'a', left: 0, top: 0, width: 10, height: 10, type: 'selection' },
        { key: 'error-b', elementId: 'b', left: 20, top: 0, width: 10, height: 10, type: 'error' },
      ],
      elements,
    );
    // Only ONE selection overlay is expected; the error overlay must not be counted.
    expect(container.querySelectorAll('[data-selection-overlay="true"]')).toHaveLength(1);
    const result = checkSelectionOverlayInvariant(container, 1);
    expect(result.foundCount).toBe(1);
    expect(result.ok).toBe(true);
  });
});
