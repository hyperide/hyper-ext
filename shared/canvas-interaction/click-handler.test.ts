/**
 * @file Tests for canvas click/hover handler with fiber-based element tracing
 *
 * Accessed via: Internal module, not exposed
 */

import { describe, expect, it, mock } from 'bun:test';
import type { NodeMapEntry, SourceLocation } from '../element-tracing/types';
import { attachClickHandler, OPAQUE_ELEMENT_CONTAINERS, resolveOpaqueTarget } from './click-handler';
import type { ClickHandlerCallbacks, LocalResolveResult, TracingResolver } from './types';

/* ─── Helpers ──────────────────────────────────────────────────────── */

const SOURCE_BUTTON: SourceLocation = { fileName: '/src/App.tsx', line: 10, column: 5 };
const SOURCE_DIV: SourceLocation = { fileName: '/src/App.tsx', line: 20, column: 2 };

const MOCK_ENTRY: NodeMapEntry = {
  nodeRef: '/src/App.tsx:3',
  tag: 'button',
  loc: SOURCE_BUTTON,
  endLoc: { fileName: '/src/App.tsx', line: 10, column: 30 },
  parentRef: null,
  children: [],
  isComponent: false,
  fingerprint: 'abc123',
};

function createMockResolveResult(overrides: Partial<LocalResolveResult> = {}): LocalResolveResult {
  return {
    nodeRef: '/src/App.tsx:3',
    entry: MOCK_ENTRY,
    source: SOURCE_BUTTON,
    itemIndex: 0,
    ...overrides,
  };
}

function createMockResolver(overrides: Partial<TracingResolver> = {}): TracingResolver {
  return {
    getSourceLocation: mock(() => null),
    getItemIndex: mock(() => 0),
    resolveClickLocal: mock(() => null),
    findDOMElement: mock(() => null),
    ...overrides,
  };
}

function createMockCallbacks(overrides: Partial<ClickHandlerCallbacks> = {}): ClickHandlerCallbacks {
  return {
    onElementClick: mock(() => {}),
    onElementHover: mock(() => {}),
    onEmptyClick: mock(() => {}),
    getMode: () => 'design',
    ...overrides,
  };
}

interface MockDocument extends Document {
  __fire: (type: string, event: Partial<MouseEvent>) => MockEvent;
}

interface MockEvent extends MouseEvent {
  preventDefault: ReturnType<typeof mock>;
  stopPropagation: ReturnType<typeof mock>;
}

/** Create a minimal DOM-like document that supports addEventListener/removeEventListener. */
function createMockDocument(): MockDocument {
  const listeners = new Map<string, Set<EventListenerOrEventListenerObject>>();

  return {
    addEventListener: mock((type: string, handler: EventListenerOrEventListenerObject) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(handler);
    }),
    removeEventListener: mock((type: string, handler: EventListenerOrEventListenerObject) => {
      listeners.get(type)?.delete(handler);
    }),
    __fire(type: string, event: Partial<MouseEvent>): MockEvent {
      const fakeEvent = {
        button: 0,
        preventDefault: mock(() => {}),
        stopPropagation: mock(() => {}),
        ...event,
      } as unknown as MockEvent;
      for (const handler of listeners.get(type) ?? []) {
        if (typeof handler === 'function') handler(fakeEvent);
      }
      return fakeEvent;
    },
  } as unknown as MockDocument;
}

function createMockElement(tag = 'BUTTON'): HTMLElement {
  return {
    tagName: tag,
    isContentEditable: false,
    parentElement: null,
    closest: mock(() => null),
  } as unknown as HTMLElement;
}

/** Build a mock element with an explicit parent for opaque-container traversal tests. */
function mockEl(tag: string, parent: HTMLElement | null = null): HTMLElement {
  return { tagName: tag, parentElement: parent } as unknown as HTMLElement;
}

/* ─── Tests ────────────────────────────────────────────────────────── */

describe('attachClickHandler', () => {
  describe('click handling in design mode', () => {
    it('should call onElementClick with nodeRef when resolver resolves locally', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => createMockResolveResult()),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target });

      expect(callbacks.onElementClick).toHaveBeenCalledTimes(1);
      expect(callbacks.onElementClick).toHaveBeenCalledWith(
        '/src/App.tsx:3',
        target,
        expect.any(Object),
        0,
        SOURCE_BUTTON,
      );
    });

    it('should call onElementClick with null nodeRef when resolver has source but no cache hit', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => null),
        getSourceLocation: mock(() => SOURCE_BUTTON),
        getItemIndex: mock(() => 2),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target });

      expect(callbacks.onElementClick).toHaveBeenCalledTimes(1);
      expect(callbacks.onElementClick).toHaveBeenCalledWith(null, target, expect.any(Object), 2, SOURCE_BUTTON);
    });

    it('should call onEmptyClick when resolver finds no source', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target });

      expect(callbacks.onElementClick).not.toHaveBeenCalled();
      expect(callbacks.onEmptyClick).toHaveBeenCalledTimes(1);
    });

    it('should preventDefault and stopPropagation in design mode', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('click', { target });

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });
  });

  describe('click handling in interact mode', () => {
    it('should not call onElementClick in interact mode', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks({ getMode: () => 'interact' });
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => createMockResolveResult()),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target });

      expect(callbacks.onElementClick).not.toHaveBeenCalled();
      expect(callbacks.onEmptyClick).not.toHaveBeenCalled();
    });

    it('should not preventDefault in interact mode', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks({ getMode: () => 'interact' });
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('click', { target });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('shouldIntercept', () => {
    it('should skip default handling when shouldIntercept returns true', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks({
        shouldIntercept: () => true,
      });
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => createMockResolveResult()),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target });

      expect(callbacks.onElementClick).not.toHaveBeenCalled();
    });
  });

  describe('hover handling', () => {
    it('should call onElementHover with resolved data on mouseover', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => createMockResolveResult()),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseover', { target });

      expect(callbacks.onElementHover).toHaveBeenCalledTimes(1);
      expect(callbacks.onElementHover).toHaveBeenCalledWith('/src/App.tsx:3', target, 0, SOURCE_BUTTON);
    });

    it('should not call onElementHover when resolver finds nothing on mouseover', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseover', { target });

      expect(callbacks.onElementHover).not.toHaveBeenCalled();
    });

    it('should clear hover when mouseout to non-traceable element', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const relatedTarget = createMockElement('DIV');
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        getSourceLocation: mock(() => null),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseout', { target, relatedTarget });

      expect(callbacks.onElementHover).toHaveBeenCalledWith(null, null, null, null);
    });

    it('should not clear hover when mouseout to another traceable element', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const relatedTarget = createMockElement('DIV');
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        getSourceLocation: mock(() => SOURCE_DIV),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseout', { target, relatedTarget });

      expect(callbacks.onElementHover).not.toHaveBeenCalled();
    });

    it('should clear hover when mouseout with null relatedTarget (left document)', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseout', { target, relatedTarget: null });

      expect(callbacks.onElementHover).toHaveBeenCalledWith(null, null, null, null);
    });

    it('should not fire hover events in interact mode', () => {
      const doc = createMockDocument();
      const target = createMockElement();
      const callbacks = createMockCallbacks({ getMode: () => 'interact' });
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => createMockResolveResult()),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseover', { target });

      expect(callbacks.onElementHover).not.toHaveBeenCalled();
    });
  });

  describe('pointerdown handling', () => {
    it('should prevent pointerdown in design mode', () => {
      const doc = createMockDocument();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('pointerdown', { button: 0 });

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
      expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    });

    it('should not prevent pointerdown in interact mode', () => {
      const doc = createMockDocument();
      const callbacks = createMockCallbacks({ getMode: () => 'interact' });
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('pointerdown', { button: 0 });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });

    it('should ignore non-left-button pointerdown', () => {
      const doc = createMockDocument();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('pointerdown', { button: 2 });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('opaque container handling (SVG)', () => {
    it('resolves SVG path click to SVG element', () => {
      const doc = createMockDocument();
      // Browser SVG elements have lowercase tagName (SVG namespace, XML rules)
      const svgEl = { tagName: 'svg', parentElement: null, isContentEditable: false } as unknown as HTMLElement;
      const pathEl = { tagName: 'path', parentElement: svgEl, isContentEditable: false } as unknown as HTMLElement;
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        resolveClickLocal: mock((target: HTMLElement) => (target === svgEl ? createMockResolveResult() : null)),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target: pathEl });

      expect(resolver.resolveClickLocal).toHaveBeenCalledWith(svgEl);
      expect(callbacks.onElementClick).toHaveBeenCalledTimes(1);
    });

    it('resolves SVG child hover to SVG element', () => {
      const doc = createMockDocument();
      const svgEl = { tagName: 'svg', parentElement: null, isContentEditable: false } as unknown as HTMLElement;
      const circleEl = { tagName: 'circle', parentElement: svgEl, isContentEditable: false } as unknown as HTMLElement;
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        resolveClickLocal: mock((target: HTMLElement) => (target === svgEl ? createMockResolveResult() : null)),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('mouseover', { target: circleEl });

      expect(resolver.resolveClickLocal).toHaveBeenCalledWith(svgEl);
      expect(callbacks.onElementHover).toHaveBeenCalledTimes(1);
    });

    it('clicking SVG root element directly still works', () => {
      const doc = createMockDocument();
      const svgEl = { tagName: 'svg', parentElement: null, isContentEditable: false } as unknown as HTMLElement;
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver({
        resolveClickLocal: mock(() => createMockResolveResult()),
      });

      attachClickHandler(doc, callbacks, resolver);
      doc.__fire('click', { target: svgEl });

      expect(resolver.resolveClickLocal).toHaveBeenCalledWith(svgEl);
      expect(callbacks.onElementClick).toHaveBeenCalledTimes(1);
    });
  });

  describe('mousedown handling', () => {
    it('should preventDefault on interactive elements in design mode', () => {
      const doc = createMockDocument();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();
      const input = createMockElement('INPUT');

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('mousedown', { target: input });

      expect(event.preventDefault).toHaveBeenCalledTimes(1);
    });

    it('should not preventDefault on non-interactive elements in design mode', () => {
      const doc = createMockDocument();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();
      const div = createMockElement('DIV');

      attachClickHandler(doc, callbacks, resolver);
      const event = doc.__fire('mousedown', { target: div });

      expect(event.preventDefault).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should remove all listeners on dispose', () => {
      const doc = createMockDocument();
      const callbacks = createMockCallbacks();
      const resolver = createMockResolver();

      const dispose = attachClickHandler(doc, callbacks, resolver);

      expect(doc.addEventListener).toHaveBeenCalledTimes(6);

      dispose();

      expect(doc.removeEventListener).toHaveBeenCalledTimes(6);
    });
  });
});

// ─── resolveOpaqueTarget ──────────────────────────────────────────────────────

describe('resolveOpaqueTarget', () => {
  // Browser SVG elements have lowercase tagName (SVG namespace, XML rules).
  // HTML elements have uppercase (DIV, BUTTON). resolveOpaqueTarget uses
  // .toUpperCase() internally so both cases are handled correctly.

  it('returns SVG when clicking a <path> inside <svg>', () => {
    const svg = mockEl('svg');
    const path = mockEl('path', svg);
    expect(resolveOpaqueTarget(path)).toBe(svg);
  });

  it('returns SVG when clicking a <circle> inside <svg>', () => {
    const svg = mockEl('svg');
    const circle = mockEl('circle', svg);
    expect(resolveOpaqueTarget(circle)).toBe(svg);
  });

  it('returns SVG when clicking a <g> inside <svg> (nested group)', () => {
    const svg = mockEl('svg');
    const g = mockEl('g', svg);
    const path = mockEl('path', g);
    expect(resolveOpaqueTarget(path)).toBe(svg);
  });

  it('returns SVG itself when the SVG is the target', () => {
    const svg = mockEl('svg');
    expect(resolveOpaqueTarget(svg)).toBe(svg);
  });

  it('returns element unchanged when no opaque ancestor exists', () => {
    const root = mockEl('DIV');
    const span = mockEl('SPAN', root);
    const btn = mockEl('BUTTON', span);
    expect(resolveOpaqueTarget(btn)).toBe(btn);
  });

  it('stops at the first (innermost) opaque ancestor', () => {
    const outer = mockEl('DIV');
    const svg = mockEl('svg', outer);
    const g = mockEl('g', svg);
    const path = mockEl('path', g);
    // Should stop at svg, not continue to outer
    expect(resolveOpaqueTarget(path)).toBe(svg);
  });

  it('OPAQUE_ELEMENT_CONTAINERS includes SVG', () => {
    expect(OPAQUE_ELEMENT_CONTAINERS.has('SVG')).toBe(true);
  });
});
