/**
 * @file Selection overlay invariant tests — HYP-684
 *
 * Two invariant classes are tested here:
 *
 * 1. PIPELINE INVARIANT: given N selectedIds that each resolve to DOM elements,
 *    computeOverlayRects → renderOverlayRects produces exactly N overlay divs
 *    with non-zero width+height. This is currently PASSING for resolvable ids.
 *    The point is to encode the invariant so a regression breaks loudly.
 *
 * 2. MISS INVARIANT (contrapositive): when a selected id resolves to 0 elements,
 *    the `tracingDebugOnce` 'no elements for selected id' path fires — that path
 *    is now ASSERTABLE rather than just a console.debug side-effect.
 *
 * Both invariants use assertSelectionOverlayInvariant / checkSelectionOverlayInvariant
 * from assert-selection-overlays.ts, the shared helper callable from e2e proof code too.
 */

import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import { computeOverlayRects } from './overlay-rects';
import { renderOverlayRects } from './overlay-renderer';
import {
  assertOverlayMissesDetected,
  assertSelectionOverlayInvariant,
  checkSelectionOverlayInvariant,
} from './assert-selection-overlays';
import * as tracingDebugModule from './tracing-debug';
import type { OverlayElementResolver } from './types';

// ---------------------------------------------------------------------------
// Test utilities
// ---------------------------------------------------------------------------

function mockElement(rect: { left: number; top: number; width: number; height: number }): HTMLElement {
  return {
    getBoundingClientRect: () => rect,
    childNodes: [],
    className: '',
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

// ---------------------------------------------------------------------------
// 1. PIPELINE INVARIANT — full computeOverlayRects → renderOverlayRects path
// ---------------------------------------------------------------------------

describe('Selection overlay pipeline invariant', () => {
  let container: HTMLDivElement;
  let overlayElements: Map<string, HTMLDivElement>;

  beforeEach(() => {
    container = document.createElement('div');
    overlayElements = new Map();
  });

  it('INV-1: single selected id → exactly 1 non-empty overlay rect', () => {
    const el = mockElement({ left: 10, top: 20, width: 100, height: 50 });
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const { overlayRects } = computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    // Core invariant: count matches, all rects non-empty
    assertSelectionOverlayInvariant(container, 1);

    // Also verify via checkSelectionOverlayInvariant for structured access
    const result = checkSelectionOverlayInvariant(container, 1);
    expect(result.ok).toBe(true);
    expect(result.foundCount).toBe(1);
    expect(result.rects[0].width).toBeGreaterThan(0);
    expect(result.rects[0].height).toBeGreaterThan(0);
  });

  it('INV-2: two selected ids → exactly 2 non-empty overlay rects', () => {
    const el1 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el2 = mockElement({ left: 60, top: 0, width: 80, height: 30 });
    const resolver = createResolver(
      new Map([
        ['ref-1', [el1]],
        ['ref-2', [el2]],
      ]),
    );

    const { overlayRects } = computeOverlayRects({ selectedIds: ['ref-1', 'ref-2'], hoveredId: null }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    assertSelectionOverlayInvariant(container, 2);

    const result = checkSelectionOverlayInvariant(container, 2);
    expect(result.ok).toBe(true);
    expect(result.foundCount).toBe(2);
    for (const rect of result.rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('INV-3: five selected ids (multi-select) → exactly 5 non-empty rects', () => {
    const entries: [string, HTMLElement[]][] = Array.from({ length: 5 }, (_, i) => [
      `ref-${i}`,
      [mockElement({ left: i * 60, top: 0, width: 50, height: 40 })],
    ]);
    const resolver = createResolver(new Map(entries));
    const selectedIds = entries.map(([id]) => id);

    const { overlayRects } = computeOverlayRects({ selectedIds, hoveredId: null }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    assertSelectionOverlayInvariant(container, 5);
  });

  it('INV-4: map-rendered element with itemIndex → 1 non-empty rect (not N)', () => {
    const el0 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el1 = mockElement({ left: 0, top: 60, width: 50, height: 50 });
    const resolver = createResolver(new Map([['ref-map', [el0, el1]]]));

    const { overlayRects } = computeOverlayRects(
      {
        selectedIds: ['ref-map'],
        hoveredId: null,
        selectedItemIndices: new Map([['ref-map', 1]]),
      },
      resolver,
    );
    renderOverlayRects(container, overlayRects, overlayElements);

    assertSelectionOverlayInvariant(container, 1);
  });

  it('INV-5: hover-only state (no selection) → 0 selection-type overlays', () => {
    const el = mockElement({ left: 5, top: 5, width: 80, height: 40 });
    const resolver = createResolver(new Map([['ref-hover', [el]]]));

    const { overlayRects } = computeOverlayRects({ selectedIds: [], hoveredId: 'ref-hover' }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    // hover rect IS rendered as [data-selection-overlay], so count = 1,
    // but we verify it as 1 total overlay (the hover rect) — the invariant
    // check counts ALL [data-selection-overlay] divs. When only hover is active,
    // there are no selection-type rects and the caller expects 0 selection rects.
    // The helper counts ALL overlay divs, so the correct expectation here is 1 total
    // (the hover rect shares the same attribute). This documents the known behaviour:
    // for selection-count assertions, callers must ensure no hover rect is present
    // (move mouse away first), OR pass expected=1 to account for the hover rect.
    //
    // In practice: proof code clears hover before asserting selection count.
    const result = checkSelectionOverlayInvariant(container, 1); // 1 hover rect
    expect(result.foundCount).toBe(1);
  });

  it('INV-6: checkSelectionOverlayInvariant detects count mismatch as non-ok', () => {
    // Render 2 rects but claim we expected 3 — must be detected
    const el1 = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const el2 = mockElement({ left: 60, top: 0, width: 50, height: 50 });
    const resolver = createResolver(
      new Map([
        ['ref-1', [el1]],
        ['ref-2', [el2]],
      ]),
    );

    const { overlayRects } = computeOverlayRects({ selectedIds: ['ref-1', 'ref-2'], hoveredId: null }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    const result = checkSelectionOverlayInvariant(container, 3);
    expect(result.ok).toBe(false);
    expect(result.foundCount).toBe(2);
    expect(result.expectedCount).toBe(3);
    expect(result.failureMessage).toContain('Expected 3 selection overlay(s), found 2');
    expect(result.failureMessage).toContain('[data-selection-overlay] count must equal selectedIds count');
    expect(result.failureMessage).toContain('Inspector text or tree highlights are NOT proof');
  });

  it('INV-7: assertSelectionOverlayInvariant throws on count mismatch', () => {
    const resolver = createResolver(new Map());
    // No elements → no overlays
    const { overlayRects } = computeOverlayRects({ selectedIds: [], hoveredId: null }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    // Claiming 1 selected when 0 drawn → must throw
    expect(() => assertSelectionOverlayInvariant(container, 1)).toThrow('Selection overlay invariant FAILED');
  });

  it('INV-8: checkSelectionOverlayInvariant detects zero-dimension rects', () => {
    // Inject a zero-width overlay directly — simulates an element with width=0
    const zeroEl = document.createElement('div');
    zeroEl.setAttribute('data-selection-overlay', 'true');
    zeroEl.style.left = '10px';
    zeroEl.style.top = '10px';
    zeroEl.style.width = '0px';
    zeroEl.style.height = '50px';
    container.appendChild(zeroEl);

    const result = checkSelectionOverlayInvariant(container, 1);
    expect(result.ok).toBe(false);
    expect(result.zeroDimensionKeys.length).toBeGreaterThan(0);
    expect(result.failureMessage).toContain('zero width or height');
    expect(result.failureMessage).toContain('invisible');
  });

  it('INV-9: assertSelectionOverlayInvariant passes for correctly drawn rects', () => {
    const el = mockElement({ left: 20, top: 30, width: 120, height: 60 });
    const resolver = createResolver(new Map([['ref-a', [el]]]));

    const { overlayRects } = computeOverlayRects({ selectedIds: ['ref-a'], hoveredId: null }, resolver);
    renderOverlayRects(container, overlayRects, overlayElements);

    // Must not throw
    expect(() => assertSelectionOverlayInvariant(container, 1)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. MISS INVARIANT — unresolvable id triggers tracingDebugOnce (assertable)
// ---------------------------------------------------------------------------

describe('Selection overlay miss invariant', () => {
  // The 'no elements for selected id' path in overlay-rects.ts calls tracingDebugOnce.
  // We spy on it to assert it fires, making the silent-death path assertable.

  afterEach(() => {
    // Clear any logged keys left by the spy to avoid bleed between tests
    tracingDebugModule.clearTracingDebugOnce('overlay-rects:missing-id:null');
    tracingDebugModule.clearTracingDebugOnce('overlay-rects:also-missing:null');
    tracingDebugModule.clearTracingDebugOnce('overlay-rects:ref-1:null');
  });

  it('MISS-1: selected id with zero DOM elements triggers tracingDebugOnce miss', () => {
    // A selected id that resolves to no elements is the root cause of
    // "N selected" state with zero canvas frames. Assert it is detected.
    const debugSpy = spyOn(tracingDebugModule, 'tracingDebugOnce').mockImplementation(
      // Must still call the original to ensure keys are tracked correctly
      (...args) => {
        tracingDebugModule.clearTracingDebugOnce(args[0]); // re-arm so re-runs detect it too
      },
    );
    try {
      const resolver = createResolver(new Map()); // nothing resolves
      computeOverlayRects({ selectedIds: ['missing-id'], hoveredId: null }, resolver);

      expect(debugSpy).toHaveBeenCalledWith(
        'overlay-rects:missing-id:null',
        'overlay-rects: no elements for selected id',
        'missing-id',
        'itemIndex',
        null,
      );
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('MISS-2: miss fires for EACH unresolvable id independently', () => {
    const missedIds: string[] = [];
    const debugSpy = spyOn(tracingDebugModule, 'tracingDebugOnce').mockImplementation((key, message, ...args) => {
      if (message === 'overlay-rects: no elements for selected id') {
        missedIds.push(args[0] as string);
      }
      tracingDebugModule.clearTracingDebugOnce(key);
    });
    try {
      const resolver = createResolver(new Map());
      computeOverlayRects({ selectedIds: ['also-missing', 'missing-id'], hoveredId: null }, resolver);

      expect(missedIds).toContain('also-missing');
      expect(missedIds).toContain('missing-id');
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('MISS-3: no miss fires when all ids resolve to elements', () => {
    const el = mockElement({ left: 0, top: 0, width: 50, height: 50 });
    const resolver = createResolver(new Map([['ref-1', [el]]]));

    const missedIds: string[] = [];
    const debugSpy = spyOn(tracingDebugModule, 'tracingDebugOnce').mockImplementation((key, message, ...args) => {
      if (message === 'overlay-rects: no elements for selected id') {
        missedIds.push(args[0] as string);
      }
      tracingDebugModule.clearTracingDebugOnce(key);
    });
    try {
      computeOverlayRects({ selectedIds: ['ref-1'], hoveredId: null }, resolver);
      expect(missedIds).toHaveLength(0);
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('MISS-4: assertOverlayMissesDetected confirms captured miss entries', () => {
    const missLog: Array<{ nodeRef: string; itemIndex: number | null }> = [];
    const debugSpy = spyOn(tracingDebugModule, 'tracingDebugOnce').mockImplementation((key, message, ...args) => {
      if (message === 'overlay-rects: no elements for selected id') {
        missLog.push({
          nodeRef: args[0] as string,
          itemIndex: args[2] !== undefined ? (args[2] as number | null) : null,
        });
      }
      tracingDebugModule.clearTracingDebugOnce(key);
    });
    try {
      const resolver = createResolver(new Map());
      computeOverlayRects({ selectedIds: ['missing-id'], hoveredId: null }, resolver);

      // assertOverlayMissesDetected should pass for the captured entry
      expect(() => assertOverlayMissesDetected(missLog, ['missing-id'])).not.toThrow();
    } finally {
      debugSpy.mockRestore();
    }
  });

  it('MISS-5: assertOverlayMissesDetected throws when expected miss is absent', () => {
    const emptyMissLog: Array<{ nodeRef: string; itemIndex: number | null }> = [];

    expect(() => assertOverlayMissesDetected(emptyMissLog, ['some-id'])).toThrow(
      'Expected overlay miss to be detected for nodeRef "some-id"',
    );
  });

  it('MISS-6: clearTracingDebugOnce re-arms the key so a subsequent miss is detected again', () => {
    const callCount = { n: 0 };
    const debugSpy = spyOn(tracingDebugModule, 'tracingDebugOnce').mockImplementation((_key, message) => {
      if (message === 'overlay-rects: no elements for selected id') callCount.n++;
    });
    try {
      const resolver = createResolver(new Map());

      // First call — miss fires
      computeOverlayRects({ selectedIds: ['missing-id'], hoveredId: null }, resolver);
      // Re-arm so the next call fires again (simulates a new render cycle)
      tracingDebugModule.clearTracingDebugOnce('overlay-rects:missing-id:null');
      // Second call — miss fires again
      computeOverlayRects({ selectedIds: ['missing-id'], hoveredId: null }, resolver);

      expect(callCount.n).toBe(2);
    } finally {
      debugSpy.mockRestore();
    }
  });
});

// ---------------------------------------------------------------------------
// 3. checkSelectionOverlayInvariant stand-alone (no renderOverlayRects needed)
// ---------------------------------------------------------------------------

describe('checkSelectionOverlayInvariant helper', () => {
  it('CI-1: returns ok=true for empty container with expectedCount=0', () => {
    const container = document.createElement('div');
    const result = checkSelectionOverlayInvariant(container, 0);
    expect(result.ok).toBe(true);
    expect(result.foundCount).toBe(0);
    expect(result.rects).toHaveLength(0);
  });

  it('CI-2: returns ok=false with descriptive message when count mismatches', () => {
    const container = document.createElement('div');
    const el = document.createElement('div');
    el.setAttribute('data-selection-overlay', 'true');
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.width = '100px';
    el.style.height = '50px';
    container.appendChild(el);

    const result = checkSelectionOverlayInvariant(container, 2);
    expect(result.ok).toBe(false);
    expect(result.failureMessage).toContain('Expected 2');
    expect(result.failureMessage).toContain('found 1');
    // Key proof-vs-state distinction must be in the message
    expect(result.failureMessage).toContain('Inspector text or tree highlights are NOT proof');
  });

  it('CI-3: returns ok=true for matching count with non-zero rects', () => {
    const container = document.createElement('div');
    for (let i = 0; i < 3; i++) {
      const el = document.createElement('div');
      el.setAttribute('data-selection-overlay', 'true');
      el.style.left = `${i * 60}px`;
      el.style.top = '0px';
      el.style.width = '50px';
      el.style.height = '40px';
      container.appendChild(el);
    }

    const result = checkSelectionOverlayInvariant(container, 3);
    expect(result.ok).toBe(true);
    expect(result.rects).toHaveLength(3);
    for (const rect of result.rects) {
      expect(rect.width).toBeGreaterThan(0);
      expect(rect.height).toBeGreaterThan(0);
    }
  });

  it('CI-4: zero-height rect makes ok=false even when count matches', () => {
    const container = document.createElement('div');
    const el = document.createElement('div');
    el.setAttribute('data-selection-overlay', 'true');
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.width = '100px';
    el.style.height = '0px'; // zero height = invisible
    container.appendChild(el);

    const result = checkSelectionOverlayInvariant(container, 1);
    expect(result.ok).toBe(false);
    expect(result.zeroDimensionKeys.length).toBeGreaterThan(0);
    expect(result.failureMessage).toContain('invisible');
  });
});

// ---------------------------------------------------------------------------
// 3. OVERLAP CHECK (targetRoot) — must NOT silently pass when targets are untagged
// ---------------------------------------------------------------------------

describe('Selection overlay overlap check (targetRoot)', () => {
  /** Build a single overlay div tagged with elementId at the given rect. */
  function overlay(elementId: string, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
    const el = document.createElement('div');
    el.setAttribute('data-selection-overlay', 'true');
    el.dataset.elementId = elementId;
    el.style.left = `${rect.left}px`;
    el.style.top = `${rect.top}px`;
    el.style.width = `${rect.width}px`;
    el.style.height = `${rect.height}px`;
    return el;
  }

  /** Build a target element carrying data-element-id with a fixed bbox. */
  function target(elementId: string, rect: { left: number; top: number; width: number; height: number }): HTMLElement {
    const el = document.createElement('div');
    el.dataset.elementId = elementId;
    el.getBoundingClientRect = () =>
      ({ left: rect.left, top: rect.top, width: rect.width, height: rect.height }) as DOMRect;
    return el;
  }

  it('OVL-1: tagged target that overlaps → ok=true, no unmatched', () => {
    const container = document.createElement('div');
    container.appendChild(overlay('ref-1', { left: 10, top: 10, width: 100, height: 50 }));
    const root = document.createElement('div');
    root.appendChild(target('ref-1', { left: 12, top: 12, width: 90, height: 40 }));

    const result = checkSelectionOverlayInvariant(container, 1, root);
    expect(result.ok).toBe(true);
    expect(result.unmatchedOverlayKeys).toHaveLength(0);
    expect(result.nonOverlappingKeys).toHaveLength(0);
  });

  it('OVL-2: tagged target that does NOT overlap → nonOverlapping reported', () => {
    const container = document.createElement('div');
    container.appendChild(overlay('ref-1', { left: 0, top: 0, width: 20, height: 20 }));
    const root = document.createElement('div');
    root.appendChild(target('ref-1', { left: 500, top: 500, width: 30, height: 30 }));

    const result = checkSelectionOverlayInvariant(container, 1, root);
    expect(result.ok).toBe(false);
    expect(result.nonOverlappingKeys).toContain('ref-1');
  });

  it('OVL-3: untagged target root (rendered iframe body) → unmatched, NOT a silent pass', () => {
    // Regression for the codex P2: target elements without data-element-id (the real iframe
    // scenario) used to make every overlay `continue` and the check silently passed.
    const container = document.createElement('div');
    container.appendChild(overlay('ref-1', { left: 10, top: 10, width: 100, height: 50 }));
    const root = document.createElement('div');
    const plain = document.createElement('div'); // a rendered element WITHOUT data-element-id
    root.appendChild(plain);

    const result = checkSelectionOverlayInvariant(container, 1, root);
    expect(result.ok).toBe(false);
    expect(result.unmatchedOverlayKeys).toContain('ref-1');
    expect(result.failureMessage).toContain('no matching');
  });
});
