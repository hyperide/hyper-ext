import { describe, expect, it } from 'bun:test';
import { computeOverlayRects } from './overlay-rects';
import type { OverlayElementResolver } from './types';

/**
 * Tests for computeOverlayRects — universal overlay rect computation
 * shared between SaaS and VS Code extension.
 */

function mockElement(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  return {
    getBoundingClientRect: () => rect,
    childNodes: [],
  } as unknown as HTMLElement;
}

function createResolver(
  elements: Map<string, HTMLElement[]>,
  empties: Array<{ elementId: string; element: HTMLElement }> = [],
): OverlayElementResolver {
  return {
    findElements(nodeRef: string, itemIndex: number | null): HTMLElement[] {
      const els = elements.get(nodeRef) ?? [];
      if (itemIndex !== null) {
        return els[itemIndex] ? [els[itemIndex]] : [];
      }
      return els;
    },
    findEmptyContainers() {
      return empties;
    },
  };
}

describe('computeOverlayRects', () => {
  it('returns empty result when no selection and no hover', () => {
    const resolver = createResolver(new Map());
    const result = computeOverlayRects({ selectedIds: [], hoveredId: null }, resolver);

    expect(result.overlayRects).toHaveLength(0);
    expect(result.placeholderRects).toHaveLength(0);
  });

  it('computes selection rects for selected elements', () => {
    const el = mockElement({ left: 10, top: 20, width: 100, height: 50 });
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects).toHaveLength(1);
    expect(result.overlayRects[0]).toEqual({
      key: 'select-ref-1-0',
      left: 10,
      top: 20,
      width: 100,
      height: 50,
      type: 'selection',
    });
  });

  it('computes hover rect', () => {
    const el = mockElement({ left: 5, top: 15, width: 200, height: 80 });
    const resolver = createResolver(new Map([['ref-h', [el]]]));

    const result = computeOverlayRects({ selectedIds: [], hoveredId: 'ref-h' }, resolver);

    expect(result.overlayRects).toHaveLength(1);
    expect(result.overlayRects[0].type).toBe('hover');
    expect(result.overlayRects[0].key).toBe('hover-ref-h');
  });

  it('skips hover rect when same item is selected', () => {
    const el = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects(
      {
        selectedIds: ['ref-1'],
        hoveredId: 'ref-1',
        hoveredItemIndex: 0,
        selectedItemIndices: new Map([['ref-1', 0]]),
      },
      resolver,
    );

    // Only selection rect, no hover
    expect(result.overlayRects).toHaveLength(1);
    expect(result.overlayRects[0].type).toBe('selection');
  });

  it('shows hover rect when different item is hovered vs selected', () => {
    const el1 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el2 = mockElement({ left: 100, top: 0, width: 50, height: 50 });
    const resolver = createResolver(
      new Map([
        ['ref-1', [el1]],
        ['ref-2', [el2]],
      ]),
    );

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: 'ref-2' }, resolver);

    expect(result.overlayRects).toHaveLength(2);
    expect(result.overlayRects.find((r) => r.type === 'hover')).toBeTruthy();
    expect(result.overlayRects.find((r) => r.type === 'selection')).toBeTruthy();
  });

  it('returns multiple selection rects for multiple selected elements', () => {
    const el1 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el2 = mockElement({ left: 60, top: 0, width: 50, height: 50 });
    const resolver = createResolver(
      new Map([
        ['ref-1', [el1]],
        ['ref-2', [el2]],
      ]),
    );

    const result = computeOverlayRects({ selectedIds: ['ref-1', 'ref-2'], hoveredId: null }, resolver);

    expect(result.overlayRects).toHaveLength(2);
    expect(result.overlayRects.every((r) => r.type === 'selection')).toBe(true);
  });

  it('returns all elements for map-rendered items (itemIndex null)', () => {
    const el1 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el2 = mockElement({ left: 0, top: 60, width: 50, height: 50 });
    const resolver = createResolver(new Map([['ref-map', [el1, el2]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-map'], hoveredId: null }, resolver);

    expect(result.overlayRects).toHaveLength(2);
    expect(result.overlayRects[0].key).toBe('select-ref-map-0');
    expect(result.overlayRects[1].key).toBe('select-ref-map-1');
  });

  it('returns single element for map-rendered items with specific itemIndex', () => {
    const el1 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el2 = mockElement({ left: 0, top: 60, width: 50, height: 50 });
    const resolver = createResolver(new Map([['ref-map', [el1, el2]]]));

    const result = computeOverlayRects(
      {
        selectedIds: ['ref-map'],
        hoveredId: null,
        selectedItemIndices: new Map([['ref-map', 1]]),
      },
      resolver,
    );

    expect(result.overlayRects).toHaveLength(1);
    expect(result.overlayRects[0].key).toBe('select-ref-map-1');
    expect(result.overlayRects[0].top).toBe(60);
  });

  it('computes placeholder rects for empty containers', () => {
    const emptyEl = mockElement({ left: 10, top: 20, width: 200, height: 100 });
    // Need to add childNodes for isContainerEmpty check
    Object.defineProperty(emptyEl, 'childNodes', { value: [] });

    const resolver = createResolver(new Map(), [{ elementId: 'empty-1', element: emptyEl }]);

    const result = computeOverlayRects({ selectedIds: [], hoveredId: null }, resolver);

    expect(result.placeholderRects).toHaveLength(1);
    expect(result.placeholderRects[0]).toEqual({
      elementId: 'empty-1',
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    });
  });

  it('enforces minimum height on collapsed empty containers', () => {
    const emptyEl = mockElement({ left: 0, top: 100, width: 200, height: 0 });
    Object.defineProperty(emptyEl, 'childNodes', { value: [] });

    const resolver = createResolver(new Map(), [{ elementId: 'empty-1', element: emptyEl }]);

    const result = computeOverlayRects({ selectedIds: [], hoveredId: null }, resolver);

    expect(result.placeholderRects[0].height).toBe(28);
    expect(result.placeholderRects[0].top).toBe(86); // 100 - 28/2
  });

  it('skips placeholders in interact mode', () => {
    const emptyEl = mockElement({ left: 0, top: 0, width: 100, height: 50 });
    Object.defineProperty(emptyEl, 'childNodes', { value: [] });

    const resolver = createResolver(new Map(), [{ elementId: 'empty-1', element: emptyEl }]);

    const result = computeOverlayRects({ selectedIds: [], hoveredId: null, engineMode: 'interact' }, resolver);

    expect(result.placeholderRects).toHaveLength(0);
  });

  it('skips non-empty containers from findEmptyContainers', () => {
    const nonEmptyEl = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 50 }),
      childNodes: [{ nodeType: 1 }], // has element child
    } as unknown as HTMLElement;

    const resolver = createResolver(new Map(), [{ elementId: 'not-empty', element: nonEmptyEl }]);

    const result = computeOverlayRects({ selectedIds: [], hoveredId: null }, resolver);

    expect(result.placeholderRects).toHaveLength(0);
  });

  it('supports Record for selectedItemIndices', () => {
    const el = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const resolver = createResolver(new Map([['ref-1', [el, el]]]));

    const result = computeOverlayRects(
      {
        selectedIds: ['ref-1'],
        hoveredId: null,
        selectedItemIndices: { 'ref-1': 1 },
      },
      resolver,
    );

    expect(result.overlayRects).toHaveLength(1);
    expect(result.overlayRects[0].key).toBe('select-ref-1-1');
  });

  it('returns empty arrays when resolver finds nothing', () => {
    const resolver = createResolver(new Map());

    const result = computeOverlayRects({ selectedIds: ['missing-ref'], hoveredId: 'also-missing' }, resolver);

    expect(result.overlayRects).toHaveLength(0);
    expect(result.placeholderRects).toHaveLength(0);
  });
});
