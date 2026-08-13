import { describe, expect, it } from 'bun:test';
import { computeOverlayRects, detectTailwindExplicitSize } from './overlay-rects';
import type { OverlayElementResolver } from './types';

/**
 * Tests for computeOverlayRects — universal overlay rect computation
 * shared between SaaS and VS Code extension.
 */

function mockElement(rect: { left: number; top: number; width: number; height: number }, className = ''): HTMLElement {
  return {
    getBoundingClientRect: () => rect,
    childNodes: [],
    className,
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
      elementId: 'ref-1',
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

  it('sets resizable on selection rect for element with w-12 h-12 className', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'w-12 h-12');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: true });
  });

  it('sets resizable for full fixture class shrink-0 w-12 h-12 rounded-xl', () => {
    const el = mockElement(
      { left: 0, top: 0, width: 48, height: 48 },
      'shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-primary/20 text-primary',
    );
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: true });
  });

  it('sets resizable for arbitrary value classes w-[48px] h-[3rem]', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'w-[48px] h-[3rem]');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: true });
  });

  it('sets resizable.hasSizeClass for element with size-12 shorthand', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'size-12');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: true, hasSizeClass: true });
  });

  it('does not set resizable.hasSizeClass for separate w-12 h-12', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'w-12 h-12');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: true });
    expect(result.overlayRects[0].resizable?.hasSizeClass).toBeUndefined();
  });

  it('sets resizable.hasSizeClass for size-[48px] arbitrary shorthand', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'size-[48px]');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable?.hasSizeClass).toBe(true);
  });

  it('sets resizable.hasSizeClass for size-px shorthand', () => {
    const el = mockElement({ left: 0, top: 0, width: 1, height: 1 }, 'size-px');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable?.hasSizeClass).toBe(true);
  });

  it('does not set resizable.hasSizeClass for size-1/2 with explicit w-12', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'size-1/2 w-12');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable?.hasSizeClass).toBeUndefined();
  });

  it('does not set resizable for class list without explicit size', () => {
    const el = mockElement({ left: 0, top: 0, width: 100, height: 50 }, 'flex items-center');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toBeUndefined();
  });

  it('sets resizable for SVG element with SVGAnimatedString className', () => {
    const svgEl = {
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 48, height: 48 }),
      childNodes: [],
      // SVGElement.className is SVGAnimatedString in the browser, not a plain string
      className: { baseVal: 'w-12 h-12', animVal: 'w-12 h-12' },
    } as unknown as HTMLElement;
    const resolver = createResolver(new Map([['svg-ref', [svgEl]]]));

    const result = computeOverlayRects({ selectedIds: ['svg-ref'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: true });
  });

  it('does not set resizable on hover rect even for element with explicit size', () => {
    const el = mockElement({ left: 0, top: 0, width: 48, height: 48 }, 'w-12 h-12');
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const result = computeOverlayRects({ selectedIds: [], hoveredId: 'ref-1' }, resolver);

    expect(result.overlayRects[0].type).toBe('hover');
    expect(result.overlayRects[0].resizable).toBeUndefined();
  });
});

describe('detectTailwindExplicitSize', () => {
  it('detects w-12 h-12 as explicit width and height', () => {
    expect(detectTailwindExplicitSize('w-12 h-12')).toEqual({ width: true, height: true });
  });

  it('detects full fixture class shrink-0 w-12 h-12 rounded-xl', () => {
    expect(
      detectTailwindExplicitSize(
        'shrink-0 w-12 h-12 rounded-xl flex items-center justify-center bg-primary/20 text-primary',
      ),
    ).toEqual({ width: true, height: true });
  });

  it('detects arbitrary value classes w-[48px] h-[3rem]', () => {
    expect(detectTailwindExplicitSize('w-[48px] h-[3rem]')).toEqual({ width: true, height: true });
  });

  it('returns false for both axes when class list has no explicit size', () => {
    expect(detectTailwindExplicitSize('flex items-center')).toEqual({ width: false, height: false });
  });

  it('returns false for keyword size classes like w-full w-auto', () => {
    expect(detectTailwindExplicitSize('w-full h-auto')).toEqual({ width: false, height: false });
  });

  it('detects only width when only w-* is present', () => {
    expect(detectTailwindExplicitSize('w-24 flex')).toEqual({ width: true, height: false });
  });

  it('detects only height when only h-* is present', () => {
    expect(detectTailwindExplicitSize('h-8 text-sm')).toEqual({ width: false, height: true });
  });

  it('detects w-px and h-px as explicit sizes', () => {
    expect(detectTailwindExplicitSize('w-px h-px')).toEqual({ width: true, height: true });
  });

  it('detects responsive-prefixed size classes like md:w-12', () => {
    expect(detectTailwindExplicitSize('md:w-12 lg:h-8')).toEqual({ width: true, height: true });
  });

  it('detects stacked variant classes like hover:md:w-12 dark:hover:md:h-8', () => {
    expect(detectTailwindExplicitSize('hover:md:w-12 dark:hover:md:h-8')).toEqual({ width: true, height: true });
  });

  it('detects w-[length:50px] with CSS type-hint arbitrary value', () => {
    expect(detectTailwindExplicitSize('w-[length:50px] h-[percentage:50%]')).toEqual({ width: true, height: true });
  });

  it('detects stacked variant with CSS type-hint: md:w-[length:50px]', () => {
    expect(detectTailwindExplicitSize('md:w-[length:50px] hover:h-[percentage:50%]')).toEqual({
      width: true,
      height: true,
    });
  });

  it('returns false/false for undefined', () => {
    expect(detectTailwindExplicitSize(undefined)).toEqual({ width: false, height: false });
  });

  it('returns false/false for empty string', () => {
    expect(detectTailwindExplicitSize('')).toEqual({ width: false, height: false });
  });

  it('detects size-12 (Tailwind 3.4+ shorthand) as both width and height', () => {
    expect(detectTailwindExplicitSize('size-12')).toEqual({ width: true, height: true });
  });

  it('detects size-[48px] arbitrary size shorthand as both axes', () => {
    expect(detectTailwindExplicitSize('size-[48px] flex')).toEqual({ width: true, height: true });
  });

  it('detects responsive size-* variant like md:size-8', () => {
    expect(detectTailwindExplicitSize('md:size-8')).toEqual({ width: true, height: true });
  });

  it('returns false/false for size-full (keyword)', () => {
    expect(detectTailwindExplicitSize('size-full')).toEqual({ width: false, height: false });
  });
});
