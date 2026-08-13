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

  /* ─── HYP-691: composite-instance multi-select needs itemIndex ────────── */

  describe('composite-instance multi-select (HYP-691)', () => {
    /**
     * Resolver mimicking a composite component instance: the nodeRef ONLY
     * resolves to a DOM element when a valid itemIndex is supplied.
     * findElements(id, null) returns [] (the silent-death path that produced
     * "3 selected, 0 frames").
     */
    function createItemIndexRequiringResolver(elements: Map<string, HTMLElement[]>): OverlayElementResolver {
      return {
        findElements(nodeRef: string, itemIndex: number | null): HTMLElement[] {
          if (itemIndex === null) return [];
          const els = elements.get(nodeRef) ?? [];
          return els[itemIndex] ? [els[itemIndex]] : [];
        },
        findEmptyContainers() {
          return [];
        },
      };
    }

    it('draws 3 frames for 3 distinct selected ids each carrying its itemIndex', () => {
      const elA = mockElement({ left: 0, top: 0, width: 50, height: 50 });
      const elB = mockElement({ left: 60, top: 0, width: 50, height: 50 });
      const elC = mockElement({ left: 120, top: 0, width: 50, height: 50 });
      const resolver = createItemIndexRequiringResolver(
        new Map([
          ['ref-a', [elA]],
          ['ref-b', [elB]],
          ['ref-c', [elC]],
        ]),
      );

      const result = computeOverlayRects(
        {
          selectedIds: ['ref-a', 'ref-b', 'ref-c'],
          hoveredId: null,
          selectedItemIndices: new Map([
            ['ref-a', 0],
            ['ref-b', 0],
            ['ref-c', 0],
          ]),
        },
        resolver,
      );

      const selectionRects = result.overlayRects.filter((r) => r.type === 'selection');
      expect(selectionRects).toHaveLength(3);
      expect(selectionRects.every((r) => r.width > 0 && r.height > 0)).toBe(true);
      expect(new Set(selectionRects.map((r) => r.elementId))).toEqual(new Set(['ref-a', 'ref-b', 'ref-c']));
    });

    it('contrapositive: dropping the itemIndex (null) yields 0 frames — the original bug', () => {
      const elA = mockElement({ left: 0, top: 0, width: 50, height: 50 });
      const elB = mockElement({ left: 60, top: 0, width: 50, height: 50 });
      const elC = mockElement({ left: 120, top: 0, width: 50, height: 50 });
      const resolver = createItemIndexRequiringResolver(
        new Map([
          ['ref-a', [elA]],
          ['ref-b', [elB]],
          ['ref-c', [elC]],
        ]),
      );

      // No selectedItemIndices -> every id resolves with itemIndex=null -> []
      const result = computeOverlayRects(
        {
          selectedIds: ['ref-a', 'ref-b', 'ref-c'],
          hoveredId: null,
        },
        resolver,
      );

      expect(result.overlayRects.filter((r) => r.type === 'selection')).toHaveLength(0);
    });
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

  it('detects w-[length:50px] but not h-[percentage:50%] (percentage is not pixel-resizable)', () => {
    expect(detectTailwindExplicitSize('w-[length:50px] h-[percentage:50%]')).toEqual({ width: true, height: false });
  });

  it('detects stacked variant md:w-[length:50px] but not hover:h-[percentage:50%]', () => {
    expect(detectTailwindExplicitSize('md:w-[length:50px] hover:h-[percentage:50%]')).toEqual({
      width: true,
      height: false,
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

  // Constraint classes (min-w / max-w / basis / min-h / max-h) only cap or seed the box;
  // the width/height itself stays `auto`, so they are NOT pixel-resizable. This supersedes
  // #296 (which mistakenly equated a constraint with an explicit size — see the Tweet.tsx
  // Action bar bug). The per-form non-resizable assertions live in the
  // "special / non-pixel dimensions" describe block below; here we cover only the
  // combination / variant forms not duplicated there.
  it('does not detect the combination min-w-0 max-h-48 (constraints only)', () => {
    expect(detectTailwindExplicitSize('min-w-0 max-h-48')).toEqual({ width: false, height: false });
  });

  it('does not detect responsive-prefixed constraints md:min-w-4 lg:max-h-8', () => {
    expect(detectTailwindExplicitSize('md:min-w-4 lg:max-h-8')).toEqual({ width: false, height: false });
  });
});

/**
 * A pixel resize handle should only appear when the element's authored dimension is an
 * explicit, fixed, pixel-resizable length. A handle that writes `width: <N>px` is
 * meaningless on a box whose width is `auto` / intrinsic / percentage — the element does
 * not track the cursor (see the Tweet.tsx Action bar bug below). So:
 *   - constraint classes (min-w / max-w / basis / min-h / max-h) only cap or seed the box;
 *     they never SET the width/height, which stays `auto` → no handle.
 *   - non-pixel arbitrary values (w-[50%], w-[auto], w-[min-content], …) resolve to a
 *     container-relative / intrinsic size, not a draggable pixel value → no handle.
 */
describe('detectTailwindExplicitSize — special / non-pixel dimensions get no resize handle', () => {
  // Regression: react-vite-tw4-twitter Tweet.tsx Action bar
  //   <div className="flex items-center justify-between mt-3 max-w-[425px] -ml-2">
  // computes to width:auto (no explicit width) — a width handle there does nothing.
  it('does not mark a max-w-[425px]-only element width-resizable (Tweet Action bar bug)', () => {
    expect(detectTailwindExplicitSize('flex items-center justify-between mt-3 max-w-[425px] -ml-2')).toEqual({
      width: false,
      height: false,
    });
  });

  it('does not mark constraint-only width classes resizable (min-w / max-w / basis)', () => {
    expect(detectTailwindExplicitSize('min-w-0')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('max-w-96')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('max-w-[800px]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('basis-4')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('basis-[200px]')).toEqual({ width: false, height: false });
  });

  it('does not mark constraint-only height classes resizable (min-h / max-h)', () => {
    expect(detectTailwindExplicitSize('min-h-0')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('max-h-48')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('max-h-[500px]')).toEqual({ width: false, height: false });
  });

  it('still marks an explicit width resizable even alongside a max-w constraint', () => {
    expect(detectTailwindExplicitSize('w-[300px] max-w-[425px]')).toEqual({ width: true, height: false });
    expect(detectTailwindExplicitSize('w-48 max-w-96 h-12')).toEqual({ width: true, height: true });
  });

  it('does not mark percentage arbitrary values resizable (w-[50%], h-[percentage:50%])', () => {
    expect(detectTailwindExplicitSize('w-[50%]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[length:50px] h-[percentage:50%]')).toEqual({ width: true, height: false });
  });

  it('does not mark intrinsic-keyword arbitrary values resizable (auto, min/max/fit-content)', () => {
    expect(detectTailwindExplicitSize('w-[auto]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[min-content]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[max-content]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('h-[fit-content]')).toEqual({ width: false, height: false });
  });

  it('still marks absolute-length arbitrary values resizable (px / rem / em)', () => {
    expect(detectTailwindExplicitSize('w-[425px]')).toEqual({ width: true, height: false });
    expect(detectTailwindExplicitSize('w-[10rem] h-[3em]')).toEqual({ width: true, height: true });
  });

  it('marks the full set of absolute / font-relative units resizable (pt/pc/in/cm/mm/q/ex/ch)', () => {
    expect(detectTailwindExplicitSize('w-[72pt]')).toEqual({ width: true, height: false });
    expect(detectTailwindExplicitSize('w-[1in] h-[2cm]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[10mm] h-[6pc]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[4q] h-[3ex]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[2ch]')).toEqual({ width: true, height: false });
    expect(detectTailwindExplicitSize('w-[1.5rem] h-[.5em]')).toEqual({ width: true, height: true });
  });

  it('marks root-relative + extra font-relative units resizable (lh/rlh/cap/rcap/ic/ric/rex/rch)', () => {
    expect(detectTailwindExplicitSize('w-[2lh] h-[1rlh]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[1cap] h-[3ic]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[2rex] h-[2rch]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[1rcap] h-[2ric]')).toEqual({ width: true, height: true });
  });

  // Unitless `0` is a valid CSS length (`width: 0`) — keep parity with the numeric class `w-0`.
  // Other unitless magnitudes (`w-[5]`) are invalid CSS and must NOT be resizable.
  it('marks unitless zero resizable (w-[0]) but not other unitless magnitudes (w-[5])', () => {
    expect(detectTailwindExplicitSize('w-[0]')).toEqual({ width: true, height: false });
    expect(detectTailwindExplicitSize('w-[0] h-[0]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[5]')).toEqual({ width: false, height: false });
  });

  // The `length:` type hint is stripped, then the value runs through the same allow-list:
  // a fixed-length hint stays resizable; a viewport / percentage hint does not.
  it('validates the length: type-hint value against the allow-list (px/rem yes, vw/% no)', () => {
    expect(detectTailwindExplicitSize('w-[length:10px]')).toEqual({ width: true, height: false });
    expect(detectTailwindExplicitSize('w-[length:2rem] h-[length:3em]')).toEqual({ width: true, height: true });
    expect(detectTailwindExplicitSize('w-[length:50vw]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[percentage:50%]')).toEqual({ width: false, height: false });
  });

  // Viewport-relative units track the viewport, not a fixed px length — a px-committing handle
  // is meaningless on them (same bug class as the Tweet Action bar). Allow-list excludes them.
  it('does not mark viewport-unit arbitrary values resizable (vw / vh / vmin / vmax)', () => {
    expect(detectTailwindExplicitSize('w-[100vw]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('h-[100vh]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[50vmin] h-[50vmax]')).toEqual({ width: false, height: false });
  });

  // Runtime / derived expressions resolve at render time, not to a fixed length.
  it('does not mark runtime / derived arbitrary values resizable (calc / var / clamp)', () => {
    expect(detectTailwindExplicitSize('w-[calc(100%_-_2rem)]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[var(--sidebar-width)]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('h-[var(--radix-select-trigger-height)]')).toEqual({
      width: false,
      height: false,
    });
    expect(detectTailwindExplicitSize('w-[clamp(10rem,50%,40rem)]')).toEqual({ width: false, height: false });
  });

  // fr / stretch / container-query units are flex/intrinsic/container-driven, not fixed lengths.
  it('does not mark fr / stretch / container-query arbitrary values resizable', () => {
    expect(detectTailwindExplicitSize('w-[1fr]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[stretch]')).toEqual({ width: false, height: false });
    expect(detectTailwindExplicitSize('w-[50cqw] h-[50cqh]')).toEqual({ width: false, height: false });
  });
});

describe('computeOverlayRects — resizable gating on special dimensions', () => {
  it('does not set resizable on a max-w-[425px]-only selection (Tweet Action bar)', () => {
    const el = mockElement(
      { left: 0, top: 0, width: 425, height: 32 },
      'flex items-center justify-between max-w-[425px]',
    );
    const resolver = createResolver(new Map([['action-bar', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['action-bar'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].type).toBe('selection');
    expect(result.overlayRects[0].resizable).toBeUndefined();
  });

  it('still sets resizable when an explicit width sits next to a max-w constraint', () => {
    const el = mockElement({ left: 0, top: 0, width: 300, height: 32 }, 'w-[300px] max-w-[425px]');
    const resolver = createResolver(new Map([['fixed', [el]]]));

    const result = computeOverlayRects({ selectedIds: ['fixed'], hoveredId: null }, resolver);

    expect(result.overlayRects[0].resizable).toEqual({ width: true, height: false });
  });
});
