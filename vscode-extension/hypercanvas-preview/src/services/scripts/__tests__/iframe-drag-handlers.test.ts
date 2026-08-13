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
  _dragPointerUp,
  _normalizeEventTarget,
  type DragHandlerContext,
} from '../iframe-drag-handlers';
import { DRAG_SOURCE_CLASS } from '@shared/canvas-interaction/drag-class-names';
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
      // must coerce it to `drop` so the drop resolves — but the write is DEFERRED to drop:
      // no moveElement may be posted yet (per-move posting raced dozens of file rewrites).
      expect(() => _dragPointerMove(ctx, makePointerEvent(dropLabel, 200, 200))).not.toThrow();

      const findMove = () =>
        posted.find(
          (m): m is { type: string; targetId: string } =>
            typeof m === 'object' &&
            m !== null &&
            'type' in m &&
            (m as { type?: string }).type === 'hypercanvas:moveElement',
        );
      // Nothing written during the move — the write fires only on pointerup.
      expect(findMove()).toBeUndefined();

      // Drop: fires EXACTLY ONE moveElement against the last-hovered, Text-normalized target.
      _dragPointerUp(ctx, makePointerEvent(source, 200, 200));
      const moveMsg = findMove();
      expect(moveMsg).toBeDefined();
      // Drop resolved to the drop element's source, not bailed on the Text node.
      expect(moveMsg?.targetId).toBe('/src/App.tsx:9:2');
    } finally {
      (window.parent as unknown as { postMessage: typeof realPostMessage }).postMessage = realPostMessage;
      source.remove();
      drop.remove();
    }
  });

  // Core #31 fix: during an active drag, setPointerCapture redirects every
  // pointermove to the captured SOURCE element, so e.target is the dragged element,
  // never the element under the cursor. The drop target must come from a hit-test at
  // the cursor coordinates (document.elementFromPoint), not e.target — otherwise
  // targetId === sourceId and moveElement never fires (the headless ZERO-moveElement
  // bug). happy-dom returns null from elementFromPoint (no layout), so we stub it to
  // emulate a real browser's hit-test.
  test('resolves the drop target via elementFromPoint when e.target is the captured source', () => {
    const source = document.createElement('div');
    source.textContent = 'source';
    const drop = document.createElement('div');
    drop.textContent = 'drop';
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
    const realElementFromPoint = document.elementFromPoint;
    // Emulate a real browser hit-test: the cursor is over `drop`.
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () =>
      drop;

    try {
      _dragPointerDown(ctx, makePointerEvent(source, 10, 10));
      _dragPointerMove(ctx, makePointerEvent(source, 40, 40)); // enter dragging

      // Pointer capture makes e.target = source even though the cursor is over drop.
      // The handler must resolve the drop via elementFromPoint, not e.target.
      _dragPointerMove(ctx, makePointerEvent(source, 200, 200));

      const findMove = () =>
        posted.find(
          (m): m is { type: string; targetId: string; sourceId: string } =>
            typeof m === 'object' &&
            m !== null &&
            'type' in m &&
            (m as { type?: string }).type === 'hypercanvas:moveElement',
        );
      // Deferred: hit-test resolved the drop during move, but no write fires until drop.
      expect(findMove()).toBeUndefined();

      _dragPointerUp(ctx, makePointerEvent(source, 200, 200));
      const moveMsg = findMove();
      expect(moveMsg).toBeDefined();
      // The move fired against the hit-tested drop element, NOT the captured source.
      expect(moveMsg?.targetId).toBe('/src/App.tsx:9:2');
      expect(moveMsg?.sourceId).toBe('/src/App.tsx:5:2');
    } finally {
      (window.parent as unknown as { postMessage: typeof realPostMessage }).postMessage = realPostMessage;
      (document as unknown as { elementFromPoint: typeof realElementFromPoint }).elementFromPoint =
        realElementFromPoint;
      source.remove();
      drop.remove();
    }
  });

  // Dropping onto the SOURCE itself (targetId === sourceId) is a no-op: each move
  // recomputes the pending write and the source-hover resolve CLEARS it, so pointerup
  // writes nothing. Guards against a stale pending drop from an earlier valid-target move.
  test('drop over the source itself posts no moveElement (pending cleared)', () => {
    const source = document.createElement('div');
    source.textContent = 'source';
    const drop = document.createElement('div');
    drop.textContent = 'drop';
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
    const realElementFromPoint = document.elementFromPoint;
    // First the cursor hovers `drop` (valid target → pending set), then returns over
    // `source` (targetId === sourceId → pending must be CLEARED).
    let hit: HTMLElement = drop;
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () =>
      hit;

    try {
      _dragPointerDown(ctx, makePointerEvent(source, 10, 10));
      _dragPointerMove(ctx, makePointerEvent(source, 40, 40)); // enter dragging
      _dragPointerMove(ctx, makePointerEvent(source, 200, 200)); // over drop → pending set
      hit = source;
      _dragPointerMove(ctx, makePointerEvent(source, 12, 12)); // back over source → pending cleared

      _dragPointerUp(ctx, makePointerEvent(source, 12, 12));

      const moveMsg = posted.find(
        (m): m is { type: string } =>
          typeof m === 'object' &&
          m !== null &&
          'type' in m &&
          (m as { type?: string }).type === 'hypercanvas:moveElement',
      );
      expect(moveMsg).toBeUndefined();
    } finally {
      (window.parent as unknown as { postMessage: typeof realPostMessage }).postMessage = realPostMessage;
      (document as unknown as { elementFromPoint: typeof realElementFromPoint }).elementFromPoint =
        realElementFromPoint;
      source.remove();
      drop.remove();
    }
  });

  // Dropping onto a DESCENDANT of the source (a DOM child of the dragged subtree) is an
  // invalid self-nesting move: AstService.moveElement would throw jsxContains ("cannot move
  // a node into one of its descendants") and the fire-and-forget bridge swallows it → silent
  // no-write. The descendant guard in _resolveDrop must reject it so the gesture is a clean
  // no-op. Trigger: the source is a CONTAINER and the cursor releases over one of its inner
  // children — elementFromPoint hit-tests that child, whose distinct source ref slips past
  // the targetId === sourceId no-op return, so the guard is what stops the bad write.
  test('drop over a DESCENDANT of the source posts no moveElement', () => {
    const source = document.createElement('div');
    const child = document.createElement('span');
    child.textContent = 'inner';
    source.appendChild(child); // child is a DOM descendant of the dragged source
    const drop = document.createElement('div');
    drop.textContent = 'drop';
    document.body.append(source, drop);

    const SRC: SourceLocation = { fileName: '/src/App.tsx', line: 5, column: 2 };
    const CHILD: SourceLocation = { fileName: '/src/App.tsx', line: 6, column: 4 };
    const DROP: SourceLocation = { fileName: '/src/App.tsx', line: 9, column: 2 };
    // The child has its OWN distinct ref: without the guard, a moveElement with
    // targetId = the child's ref (6:4 ≠ source 5:2) WOULD be emitted.
    const ctx = makeContext(
      new Map<HTMLElement, SourceLocation>([
        [source, SRC],
        [child, CHILD],
        [drop, DROP],
      ]),
    );

    const posted: unknown[] = [];
    const realPostMessage = window.parent.postMessage;
    (window.parent as unknown as { postMessage: (m: unknown) => void }).postMessage = (m: unknown) => {
      posted.push(m);
    };
    const realElementFromPoint = document.elementFromPoint;
    // First the cursor hovers a valid `drop` (pending set), then lands over the inner
    // `child` (a descendant of the dragged source → the guard must CLEAR pending).
    let hit: HTMLElement = drop;
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () =>
      hit;

    try {
      _dragPointerDown(ctx, makePointerEvent(source, 10, 10));
      _dragPointerMove(ctx, makePointerEvent(source, 40, 40)); // enter dragging
      _dragPointerMove(ctx, makePointerEvent(source, 200, 200)); // over drop → pending set
      hit = child;
      _dragPointerMove(ctx, makePointerEvent(source, 12, 12)); // over descendant → pending cleared

      _dragPointerUp(ctx, makePointerEvent(source, 12, 12));

      const moveMsg = posted.find(
        (m): m is { type: string } =>
          typeof m === 'object' &&
          m !== null &&
          'type' in m &&
          (m as { type?: string }).type === 'hypercanvas:moveElement',
      );
      expect(moveMsg).toBeUndefined();
    } finally {
      (window.parent as unknown as { postMessage: typeof realPostMessage }).postMessage = realPostMessage;
      (document as unknown as { elementFromPoint: typeof realElementFromPoint }).elementFromPoint =
        realElementFromPoint;
      source.remove();
      drop.remove();
    }
  });

  // Escape / cancel mid-drag must write NOTHING even with a pending drop queued.
  test('Escape (_dragCleanup) mid-drag fires no write', () => {
    const source = document.createElement('div');
    source.textContent = 'source';
    const drop = document.createElement('div');
    drop.textContent = 'drop';
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
    const realElementFromPoint = document.elementFromPoint;
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () =>
      drop;

    try {
      _dragPointerDown(ctx, makePointerEvent(source, 10, 10));
      _dragPointerMove(ctx, makePointerEvent(source, 40, 40)); // enter dragging
      _dragPointerMove(ctx, makePointerEvent(source, 200, 200)); // over drop → pending set

      // Cancel path (Escape calls _dragCleanup): pending must be dropped, no post.
      _dragCleanup();

      const moveMsg = posted.find(
        (m): m is { type: string } =>
          typeof m === 'object' &&
          m !== null &&
          'type' in m &&
          (m as { type?: string }).type === 'hypercanvas:moveElement',
      );
      expect(moveMsg).toBeUndefined();
    } finally {
      (window.parent as unknown as { postMessage: typeof realPostMessage }).postMessage = realPostMessage;
      (document as unknown as { elementFromPoint: typeof realElementFromPoint }).elementFromPoint =
        realElementFromPoint;
      source.remove();
      drop.remove();
    }
  });

  // DRAG_SOURCE_CLASS pulls in the `pointer-events:none` subtree CSS; it MUST be added
  // when the drag begins and removed once it ends — on BOTH the success path
  // (_dragPointerUp → _dragCleanup) and the cancel path — or the source element would
  // stay non-interactive after a drop. _dragPointerUp routes through _dragCleanup, so
  // the success path is the one most likely to silently regress if that link breaks.
  test('DRAG_SOURCE_CLASS is added on drag start and removed after a successful pointerUp', () => {
    const source = document.createElement('div');
    source.textContent = 'source';
    const drop = document.createElement('div');
    drop.textContent = 'drop';
    document.body.append(source, drop);

    const SRC: SourceLocation = { fileName: '/src/App.tsx', line: 5, column: 2 };
    const DROP: SourceLocation = { fileName: '/src/App.tsx', line: 9, column: 2 };
    const ctx = makeContext(
      new Map<HTMLElement, SourceLocation>([
        [source, SRC],
        [drop, DROP],
      ]),
    );
    const realElementFromPoint = document.elementFromPoint;
    (document as unknown as { elementFromPoint: (x: number, y: number) => Element | null }).elementFromPoint = () =>
      drop;

    try {
      _dragPointerDown(ctx, makePointerEvent(source, 10, 10));
      _dragPointerMove(ctx, makePointerEvent(source, 40, 40)); // enter dragging → class added
      expect(source.classList.contains(DRAG_SOURCE_CLASS)).toBe(true);

      _dragPointerMove(ctx, makePointerEvent(source, 200, 200)); // over drop → valid pending
      _dragPointerUp(ctx, makePointerEvent(source, 200, 200)); // success path → cleanup
      // The transient class must be gone so the dropped element is interactive again.
      expect(source.classList.contains(DRAG_SOURCE_CLASS)).toBe(false);
    } finally {
      (document as unknown as { elementFromPoint: typeof realElementFromPoint }).elementFromPoint =
        realElementFromPoint;
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
