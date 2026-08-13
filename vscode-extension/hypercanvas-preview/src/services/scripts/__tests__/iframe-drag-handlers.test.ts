/**
 * @file Tests for the drag pointerdown entry guard (iframe-drag-handlers.ts)
 *
 * Accessed via: iframe-interaction.ts pointerdown capture listener → _dragPointerDown.
 *
 * Runs under the root `bun test` preload (happy-dom + mock-vscode), which provides
 * real `document`, `HTMLElement`, `Text`, and `Node` globals.
 *
 * Covers e2e defect #13: a pointerdown over visible text reports `e.target` as a
 * Text node (nodeType 3), which has no `getAttribute`. Before the entry guard,
 * `_dragPointerDown` passed that Text node straight into `resolveDragSource`, which
 * crashed with "target.getAttribute is not a function" — ~333 cascade failures in
 * the inspector/canvas/drag suite. `_normalizeEventTarget` coerces a non-Element
 * target up to its owning element (so a press on a button's text label resolves the
 * button) while passing real Elements — including SVG — through unchanged. Both
 * `_dragPointerDown` and `_dragPointerMove` route their target through it.
 */
import { afterEach, describe, expect, mock, test } from 'bun:test';

import {
  _dragCleanup,
  _dragPointerDown,
  _dragPointerMove,
  _normalizeEventTarget,
  type DragHandlerContext,
} from '../iframe-drag-handlers';
import type { SourceLocation } from '@shared/element-tracing/types';

const BUTTON_SRC: SourceLocation = { fileName: '/src/App.tsx', line: 7, column: 2 };

/** Build a minimal context whose resolver reports a source for the given element(s). */
function makeContext(
  sources: HTMLElement | Map<HTMLElement, SourceLocation>,
  src: SourceLocation = BUTTON_SRC,
): DragHandlerContext {
  const sourceMap = sources instanceof Map ? sources : new Map<HTMLElement, SourceLocation>([[sources, src]]);
  return {
    state: { engineMode: 'design', selectedIds: [] },
    iframeResolver: {
      getSourceLocation: mock((el: HTMLElement) => sourceMap.get(el) ?? null),
    } as unknown as DragHandlerContext['iframeResolver'],
    renderedComponentPath: '/src/App.tsx',
    selectionGraceCache: { invalidateForFile: mock(() => {}) },
    findElementsByRef: mock(() => []),
  };
}

/** A PointerEvent-like object sufficient for the drag handlers' reads. */
function makePointerEvent(target: EventTarget | null, clientX = 10, clientY = 10): PointerEvent {
  return {
    target,
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    preventDefault: mock(() => {}),
  } as unknown as PointerEvent;
}

afterEach(() => {
  // _dragPointerDown sets module-global drag state; reset so tests stay isolated.
  _dragCleanup();
});

describe('_dragPointerDown entry guard (e2e defect #13)', () => {
  test('does not throw when e.target is a Text node and resolves the owning element', () => {
    const button = document.createElement('button');
    const label = document.createTextNode('Click me');
    button.appendChild(label);
    document.body.appendChild(button);

    const ctx = makeContext(button, BUTTON_SRC);
    const event = makePointerEvent(label);

    expect(() => _dragPointerDown(ctx, event)).not.toThrow();
    // The press on the button's text label resolved the button: drag is armed and
    // preventDefault fired (only reached after a successful resolveDragSource).
    expect(event.preventDefault).toHaveBeenCalled();

    button.remove();
  });

  test('bails without throwing when target is a detached Text node with no parent', () => {
    const orphanText = document.createTextNode('orphan');
    const ctx = makeContext(document.createElement('div'), BUTTON_SRC);
    const event = makePointerEvent(orphanText);

    expect(() => _dragPointerDown(ctx, event)).not.toThrow();
    // No owning element → guard bails before resolveDragSource and before preventDefault.
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  test('still resolves a direct element target (no regression on the happy path)', () => {
    const button = document.createElement('button');
    button.textContent = 'Direct';
    document.body.appendChild(button);

    const ctx = makeContext(button, BUTTON_SRC);
    const event = makePointerEvent(button);

    expect(() => _dragPointerDown(ctx, event)).not.toThrow();
    expect(event.preventDefault).toHaveBeenCalled();

    button.remove();
  });

  // SVG regression guard: the normalization must NOT treat SVG elements as
  // non-Element nodes to coerce up — they are valid draggable targets.
  test('resolves a direct <svg> press as the svg itself, not its parent', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    document.body.appendChild(svg);

    const ctx = makeContext(svg as unknown as HTMLElement, BUTTON_SRC);
    const event = makePointerEvent(svg);

    expect(() => _dragPointerDown(ctx, event)).not.toThrow();
    // svg has its own source → it is the drag target; preventDefault confirms resolve.
    expect(event.preventDefault).toHaveBeenCalled();

    svg.remove();
  });

  test('resolves a nested <path> press as the path itself (does not bail on SVGSVGElement parent)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(pathEl);
    document.body.appendChild(svg);

    // Source maps know the <path> directly — it must resolve as itself.
    const ctx = makeContext(pathEl as unknown as HTMLElement, BUTTON_SRC);
    const event = makePointerEvent(pathEl);

    expect(() => _dragPointerDown(ctx, event)).not.toThrow();
    expect(event.preventDefault).toHaveBeenCalled();

    svg.remove();
  });
});

describe('_dragPointerMove drop-target normalization (review finding #2)', () => {
  test('resolves the drop element when moving over a Text node inside it (no raw e.target regression)', () => {
    // Source element (the dragged one) and a separate drop element with text.
    const source = document.createElement('div');
    source.textContent = 'source';
    const drop = document.createElement('div');
    const dropLabel = document.createTextNode('drop here');
    drop.appendChild(dropLabel);
    document.body.append(source, drop);

    const SRC: SourceLocation = { fileName: '/src/App.tsx', line: 5, column: 2 };
    const DROP: SourceLocation = { fileName: '/src/App.tsx', line: 9, column: 2 };
    const ctx = makeContext(
      new Map<HTMLElement, SourceLocation>([
        [source, SRC],
        [drop, DROP],
      ]),
    );

    const posted: unknown[] = [];
    const realPostMessage = window.parent.postMessage;
    (window.parent as unknown as { postMessage: (m: unknown) => void }).postMessage = (m: unknown) => {
      posted.push(m);
    };

    try {
      // Arm the drag on the source, then cross the threshold to enter 'dragging'.
      _dragPointerDown(ctx, makePointerEvent(source, 10, 10));
      _dragPointerMove(ctx, makePointerEvent(source, 40, 40)); // > DRAG_THRESHOLD_PX → dragging

      // Move with e.target = the Text node inside the drop element. Normalization
      // must coerce it to `drop` so the drop resolves and a postMessage fires.
      expect(() => _dragPointerMove(ctx, makePointerEvent(dropLabel, 200, 200))).not.toThrow();

      const moveMsg = posted.find(
        (m): m is { type: string; targetId: string } =>
          typeof m === 'object' &&
          m !== null &&
          'type' in m &&
          (m as { type?: string }).type === 'hypercanvas:moveElement',
      );
      expect(moveMsg).toBeDefined();
      // Drop resolved to the drop element's source, not bailed on the Text node.
      expect(moveMsg?.targetId).toBe('/src/App.tsx:9:2');
    } finally {
      (window.parent as unknown as { postMessage: typeof realPostMessage }).postMessage = realPostMessage;
      source.remove();
      drop.remove();
    }
  });
});

describe('_normalizeEventTarget (shared by pointerdown + pointermove)', () => {
  test('passes a real HTMLElement through unchanged', () => {
    const el = document.createElement('div');
    expect(_normalizeEventTarget(el)).toBe(el);
  });

  test('passes a real SVG element through unchanged (not coerced to parent)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.appendChild(pathEl);
    expect(_normalizeEventTarget(svg)).toBe(svg as unknown as HTMLElement);
    expect(_normalizeEventTarget(pathEl)).toBe(pathEl as unknown as HTMLElement);
  });

  test('coerces a Text node up to its owning element (button label → button)', () => {
    const button = document.createElement('button');
    const label = document.createTextNode('Click me');
    button.appendChild(label);
    expect(_normalizeEventTarget(label)).toBe(button);
  });

  test('returns null for a detached Text node with no parent', () => {
    expect(_normalizeEventTarget(document.createTextNode('orphan'))).toBeNull();
  });

  test('returns null for a null target', () => {
    expect(_normalizeEventTarget(null)).toBeNull();
  });

  // pointermove over visible text: e.target is a Text node. Reusing this helper in
  // _dragPointerMove means the drop indicator resolves the owning element instead of
  // failing on a null resolveDragSource result (review finding #2).
  test('pointermove-over-text path: a styled text node coerces to its container', () => {
    const card = document.createElement('div');
    const inner = document.createElement('span');
    const text = document.createTextNode('drop here');
    inner.appendChild(text);
    card.appendChild(inner);
    expect(_normalizeEventTarget(text)).toBe(inner);
  });
});
