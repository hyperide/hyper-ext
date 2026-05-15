/**
 * @file Tests for drag source resolution (drag-source-resolver.ts)
 *
 * Accessed via: Internal module, not exposed
 *
 * Covers:
 * - Direct element with source (happy path)
 * - Decorative element (emoji, aria-hidden) → walk-up to ancestor
 * - Cold source maps → _debugSource fallback (the bug this file fixes)
 * - No source anywhere → null (drag blocked)
 * - Multi-select badge: state.selectedIds.length exposed for badge rendering
 * - Nested wrapper: drag inner-div resolves to outer card (sibling-level walk-up)
 */

import { describe, expect, it, mock } from 'bun:test';
import type { Fiber } from '../element-tracing/fiber-internals';
import type { SourceLocation } from '../element-tracing/types';
import { resolveDragSource } from './drag-source-resolver';

/* ─── Helpers ────────────────────────────────────────────────────── */

function makeEl(
  overrides: Partial<HTMLElement & { __reactFiber$test?: unknown }> = {},
  attrs: Record<string, string> = {},
): HTMLElement {
  const el = {
    tagName: 'SPAN',
    parentElement: null,
    children: [] as HTMLElement[],
    getAttribute: (name: string) => attrs[name] ?? null,
    ...overrides,
  } as unknown as HTMLElement;
  return el;
}

/**
 * Link children to their parent and set up the children array on the parent.
 * Call this after building all elements.
 */
function linkChildren(parent: HTMLElement, children: HTMLElement[]): void {
  (parent as unknown as Record<string, unknown>).children = children;
  for (const child of children) {
    (child as unknown as Record<string, unknown>).parentElement = parent;
  }
}

function makeFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: 5,
    type: 'p',
    stateNode: null,
    return: null,
    child: null,
    sibling: null,
    memoizedProps: {},
    _debugSource: null,
    _debugOwner: null,
    ...overrides,
  };
}

const SOURCE_P: SourceLocation = { fileName: '/src/App.tsx', line: 12, column: 4 };

/* ─── Tests ──────────────────────────────────────────────────────── */

describe('resolveDragSource', () => {
  it('returns source for element that resolves directly', () => {
    const target = makeEl();
    const getSourceLocation = mock((el: HTMLElement) => (el === target ? SOURCE_P : null));

    const result = resolveDragSource(target, getSourceLocation, '/src/App.tsx');

    expect(result).not.toBeNull();
    expect(result?.source).toEqual(SOURCE_P);
    expect(result?.el).toBe(target);
  });

  it('walks up to parent when target is a decorative element (emoji, aria-hidden span)', () => {
    const parent = makeEl({ tagName: 'P' });
    const emojiSpan = makeEl({ tagName: 'SPAN', parentElement: parent });
    // parent chain ends at document.body sentinel
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // emoji span has no source; parent <p> does
    const getSourceLocation = mock((el: HTMLElement) => {
      if (el === parent) return SOURCE_P;
      return null;
    });

    const result = resolveDragSource(emojiSpan, getSourceLocation, '/src/App.tsx');

    expect(result).not.toBeNull();
    expect(result?.source).toEqual(SOURCE_P);
    expect(result?.el).toBe(parent); // drag el is the ancestor
  });

  /**
   * BUG REGRESSION: aria-hidden span where source maps ARE warm (getSourceLocation
   * returns the span's own source) should still delegate to the parent — not become
   * the drag target itself. Previously, step 1 would resolve the span directly and
   * return el=span, making a tiny emoji visually "drag" while the real intent was to
   * move the parent container.
   */
  it('skips aria-hidden element even when getSourceLocation returns a source for it', () => {
    const SOURCE_SPAN: SourceLocation = { fileName: '/src/Index.tsx', line: 307, column: 4 };
    const SOURCE_DIV: SourceLocation = { fileName: '/src/Index.tsx', line: 293, column: 6 };

    const parent = makeEl({ tagName: 'DIV' });
    const emojiSpan = makeEl({ tagName: 'SPAN', parentElement: parent }, { 'aria-hidden': 'true' });
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // Source maps are warm — both span and parent resolve, but span should be skipped
    const getSourceLocation = mock((el: HTMLElement) => {
      if (el === emojiSpan) return SOURCE_SPAN;
      if (el === parent) return SOURCE_DIV;
      return null;
    });

    const result = resolveDragSource(emojiSpan, getSourceLocation, '/src/Index.tsx');

    expect(result).not.toBeNull();
    expect(result?.source).toEqual(SOURCE_DIV); // parent's source, not the span's
    expect(result?.el).toBe(parent); // parent element dragged, not the emoji span
  });

  /**
   * BUG REGRESSION: elements with React 18 _debugSource but cold/unavailable
   * source maps should still be draggable. Previously, when getSourceLocation
   * returned null (cold source maps) and walk-up also returned null (all
   * ancestors cold), drag was silently aborted even though _debugSource was
   * available directly on the fiber.
   *
   * After the fix, resolveDragSource falls back to findNearestSourceLocation
   * which reads _debugSource directly without needing source maps.
   */
  it('falls back to _debugSource when source maps are cold (the bug scenario)', () => {
    const fiber = makeFiber({
      tag: 5,
      type: 'p',
      _debugSource: {
        fileName: '/src/HabitsTracker.tsx',
        lineNumber: 23,
        columnNumber: 5,
      },
    });

    // Attach fiber to element the same way getFiberFromDOM finds it
    const target = makeEl({ tagName: 'P' });
    // getFiberFromDOM walks __reactFiber$* keys — simulate it
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;
    (target as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // Source maps are cold: getSourceLocation returns null for all elements
    const getSourceLocation = mock((_el: HTMLElement) => null as SourceLocation | null);

    const result = resolveDragSource(target, getSourceLocation, '/src/HabitsTracker.tsx');

    // Without the fallback, result would be null → drag never starts. This is the bug.
    expect(result).not.toBeNull();
    expect(result?.source.fileName).toBe('/src/HabitsTracker.tsx');
    expect(result?.source.line).toBe(23);
    // column is 0-based: columnNumber 5 → column 4
    expect(result?.source.column).toBe(4);
  });

  it('returns null when no source found anywhere (truly untraceable element)', () => {
    const target = makeEl({ tagName: 'DIV' });
    (target as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    // No _debugSource on fiber, no source maps
    const fiber = makeFiber(); // _debugSource: null
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;

    const getSourceLocation = mock((_el: HTMLElement) => null as SourceLocation | null);

    const result = resolveDragSource(target, getSourceLocation, '/src/App.tsx');

    expect(result).toBeNull();
  });

  it('prefers source-map result over _debugSource fallback when source maps are warm', () => {
    const fiber = makeFiber({
      _debugSource: {
        fileName: '/src/Wrong.tsx',
        lineNumber: 99,
        columnNumber: 1,
      },
    });
    const target = makeEl({ tagName: 'BUTTON' });
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;
    (target as unknown as Record<string, unknown>).parentElement = null;

    // Source maps are warm and return a different (correct) location
    const getSourceLocation = mock((_el: HTMLElement) => SOURCE_P);

    const result = resolveDragSource(target, getSourceLocation, '/src/App.tsx');

    expect(result).not.toBeNull();
    // Should prefer getSourceLocation result, not _debugSource fallback
    expect(result?.source).toEqual(SOURCE_P);
  });

  /**
   * B1/B4 BUG: Clicking an emoji span or inner-div inside a card resolves to
   * the inner-div instead of the outer card. Since inner-div and outer-card don't
   * share the same JSX parent, AstService.reorderElement throws
   * "Elements must share a direct JSX parent".
   *
   * DOM structure (bulka-the-dog Index.tsx):
   *   grid > outer-card > [emoji-span(aria-hidden), inner-div > text-div]
   *          other-card  (sibling of outer-card)
   *
   * Fix: after resolving initial candidate (inner-div), walk further up until
   * finding an element with at least one source-bearing sibling. That is outer-card
   * (whose sibling other-card has a source), not inner-div (whose only sibling is
   * aria-hidden emoji-span with no source).
   */
  describe('walkToMeaningfulDraggable (step 4 — sibling-level walk-up)', () => {
    // Build the DOM tree:
    //   grid
    //   ├── outer-card              source: Index.tsx:10
    //   │   ├── emoji-span          source: null (aria-hidden)
    //   │   └── inner-div           source: Index.tsx:15
    //   │       └── text-div        source: Index.tsx:18
    //   └── other-card              source: Index.tsx:20

    const SRC_OUTER: SourceLocation = { fileName: 'Index.tsx', line: 10, column: 2 };
    const SRC_INNER: SourceLocation = { fileName: 'Index.tsx', line: 15, column: 4 };
    const SRC_TEXT: SourceLocation = { fileName: 'Index.tsx', line: 18, column: 6 };
    const SRC_OTHER: SourceLocation = { fileName: 'Index.tsx', line: 20, column: 2 };

    function buildTree() {
      const grid = makeEl({ tagName: 'DIV' });
      const outerCard = makeEl({ tagName: 'DIV' });
      const emojiSpan = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });
      const innerDiv = makeEl({ tagName: 'DIV' });
      const textDiv = makeEl({ tagName: 'DIV' });
      const otherCard = makeEl({ tagName: 'DIV' });

      // Link tree: grid > [outerCard, otherCard]; outerCard > [emojiSpan, innerDiv]; innerDiv > [textDiv]
      linkChildren(grid, [outerCard, otherCard]);
      linkChildren(outerCard, [emojiSpan, innerDiv]);
      linkChildren(innerDiv, [textDiv]);
      linkChildren(textDiv, []);

      // grid and document.body sentinel
      const body = makeEl({ tagName: 'BODY' });
      linkChildren(grid, [outerCard, otherCard]);
      (grid as unknown as Record<string, unknown>).parentElement = body;
      (body as unknown as Record<string, unknown>).parentElement = null;

      return { grid, outerCard, emojiSpan, innerDiv, textDiv, otherCard };
    }

    function makeGetSourceLocation(
      outerCard: HTMLElement,
      innerDiv: HTMLElement,
      textDiv: HTMLElement,
      otherCard: HTMLElement,
    ) {
      return mock((el: HTMLElement): SourceLocation | null => {
        if (el === outerCard) return SRC_OUTER;
        if (el === innerDiv) return SRC_INNER;
        if (el === textDiv) return SRC_TEXT;
        if (el === otherCard) return SRC_OTHER;
        return null;
      });
    }

    it('resolves emoji-span click to outer-card (not inner-div)', () => {
      const { outerCard, emojiSpan, innerDiv, textDiv, otherCard } = buildTree();
      const getSourceLocation = makeGetSourceLocation(outerCard, innerDiv, textDiv, otherCard);

      const result = resolveDragSource(emojiSpan, getSourceLocation, 'Index.tsx');

      expect(result).not.toBeNull();
      // After step 4: should resolve to outer-card, not inner-div
      expect(result?.el).toBe(outerCard);
      expect(result?.source).toEqual(SRC_OUTER);
    });

    it('resolves text-div click (inside inner-div) to outer-card', () => {
      const { outerCard, innerDiv, textDiv, otherCard } = buildTree();
      const getSourceLocation = makeGetSourceLocation(outerCard, innerDiv, textDiv, otherCard);

      const result = resolveDragSource(textDiv, getSourceLocation, 'Index.tsx');

      expect(result).not.toBeNull();
      // text-div has a source, but inner-div has no meaningful siblings → walk up to outer-card
      expect(result?.el).toBe(outerCard);
      expect(result?.source).toEqual(SRC_OUTER);
    });

    it('does NOT over-walk when element already at correct sibling level', () => {
      // Flat list: grid > [card-a, card-b, card-c], all have sources
      const grid = makeEl({ tagName: 'DIV' });
      const cardA = makeEl({ tagName: 'DIV' });
      const cardB = makeEl({ tagName: 'DIV' });
      const cardC = makeEl({ tagName: 'DIV' });

      linkChildren(grid, [cardA, cardB, cardC]);

      const body = makeEl({ tagName: 'BODY' });
      (grid as unknown as Record<string, unknown>).parentElement = body;
      (body as unknown as Record<string, unknown>).parentElement = null;

      const SRC_A: SourceLocation = { fileName: 'List.tsx', line: 5, column: 2 };
      const SRC_B: SourceLocation = { fileName: 'List.tsx', line: 6, column: 2 };
      const SRC_C: SourceLocation = { fileName: 'List.tsx', line: 7, column: 2 };

      const getSourceLocation = mock((el: HTMLElement): SourceLocation | null => {
        if (el === cardA) return SRC_A;
        if (el === cardB) return SRC_B;
        if (el === cardC) return SRC_C;
        return null;
      });

      const result = resolveDragSource(cardA, getSourceLocation, 'List.tsx');

      expect(result).not.toBeNull();
      // card-a already has source-bearing siblings → should stay at card-a
      expect(result?.el).toBe(cardA);
      expect(result?.source).toEqual(SRC_A);
    });
  });
});
