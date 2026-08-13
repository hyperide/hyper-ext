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
 * - Nested wrapper: aria-hidden child walks up to nearest source ancestor; non-decorative inner elements stay at their level
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

  /**
   * STEP-ORDER REGRESSION: verifies that fiber _debugSource wins over the ancestor
   * walk-up when source maps on the target are cold but the parent has warm source maps.
   *
   * With the OLD order (walk-up before fiber): the parent's source would be returned,
   * causing the wrong element to be dragged (e.g. dragging an <img> moves its card).
   * With the CORRECT order (fiber before walk-up): target resolves via _debugSource.
   *
   * The existing "cold source maps" test above does NOT catch a regression here because
   * it sets parentElement to BODY, so the walk-up terminates immediately regardless of
   * step order. This test uses a parent that actually has a source.
   */
  it('resolves via fiber _debugSource even when parent has warm source maps (step-order matters)', () => {
    const fiber = makeFiber({
      tag: 5,
      type: 'img',
      _debugSource: {
        fileName: '/src/Gallery.tsx',
        lineNumber: 42,
        columnNumber: 4,
      },
    });

    const parent = makeEl({ tagName: 'DIV' });
    const target = makeEl({ tagName: 'IMG' });
    (target as unknown as Record<string, unknown>).__reactFiber$xyz = fiber;
    (target as unknown as Record<string, unknown>).parentElement = parent;
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    const SRC_PARENT: SourceLocation = { fileName: '/src/Gallery.tsx', line: 30, column: 2 };
    // target: cold source maps; parent: warm source maps
    const getSourceLocation = mock((el: HTMLElement): SourceLocation | null => (el === parent ? SRC_PARENT : null));

    const result = resolveDragSource(target, getSourceLocation, '/src/Gallery.tsx');

    // Must resolve via fiber (step 2), NOT via parent walk-up (step 3).
    // If steps were swapped, result would be { el: parent, source: SRC_PARENT }.
    expect(result).not.toBeNull();
    expect(result?.el).toBe(target);
    expect(result?.source.line).toBe(42);
    // columnNumber 4 → column 3 (0-based offset, same transform as existing tests)
    expect(result?.source.column).toBe(3);
  });

  /**
   * Step 2 path: decorative element whose parent has a React fiber with _debugSource.
   * Source maps are cold (getSourceLocation returns null). The code should find
   * the parent's fiber via Step 2 and return el=parent, not fall through to Step 3.
   */
  it('uses parent fiber _debugSource for decorative element when source maps are cold', () => {
    const parentFiber = makeFiber({
      tag: 5,
      type: 'div',
      _debugSource: {
        fileName: '/src/Card.tsx',
        lineNumber: 55,
        columnNumber: 3,
      },
    });

    const parent = makeEl({ tagName: 'DIV' });
    (parent as unknown as Record<string, unknown>).__reactFiber$xyz = parentFiber;
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };

    const emojiSpan = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });
    (emojiSpan as unknown as Record<string, unknown>).parentElement = parent;

    // Source maps are cold — all getSourceLocation calls return null
    const getSourceLocation = mock((_el: HTMLElement) => null as SourceLocation | null);

    const result = resolveDragSource(emojiSpan, getSourceLocation, '/src/Card.tsx');

    // Must resolve via parent's fiber (step 2), not via step 3 walk-up (same outcome but different path).
    expect(result).not.toBeNull();
    expect(result?.el).toBe(parent);
    expect(result?.source.fileName).toBe('/src/Card.tsx');
    expect(result?.source.line).toBe(55);
    // columnNumber 3 → column 2 (0-based)
    expect(result?.source.column).toBe(2);
  });

  /**
   * ROOT-CAUSE REGRESSION (HYP-49 / DR-NN-1 / DR-16): React 19 + Vite dev.
   *
   * A decorative span's parent host div carries NO `_debugSource` (React 19);
   * its source lives in `_debugStack`, whose top user frame points into the
   * VITE-TRANSFORMED module — a line number far past the real file's EOF
   * (observed live: `TestElements.tsx:443:31` for a ~300-line file). The raw
   * fiber read (`findNearestSourceLocation`) returns that un-sourcemapped
   * position, so AstService.moveElement can't find a node there → "source not
   * found" → ZERO file write → the drag silently fails.
   *
   * The fix routes decorative resolution through the SOURCE-MAP-AWARE
   * `getSourceLocation(parent)` FIRST (Step 2a), which translates the transformed
   * position back to the real source line — exactly the path that already makes
   * non-decorative drags work.
   *
   * This test exercises the REAL `findNearestSourceLocation` (not a mock) on a
   * fiber whose `_debugStack` resolves to a wrong/transformed line, while the
   * sourcemap-aware resolver returns the correct line. Pre-fix: result is the
   * raw transformed line (443). Post-fix: result is the real source line (179).
   */
  /**
   * Models the real React 19 + Vite extension resolver, where:
   *  - getSourceLocation returns the RAW transformed-module line (443) when the
   *    client source map is COLD (its `findNearestSourceLocation` fallback), and
   *    the real source line (179) only once the map is WARM.
   *  - getMappedSourceLocation (the provenance-safe resolver) returns the real line
   *    ONLY on a map hit, and null while cold — never the raw 443.
   */
  const REAL_SOURCE: SourceLocation = { fileName: 'src/components/TestElements.tsx', line: 179, column: 8 };
  const RAW_TRANSFORMED: SourceLocation = { fileName: 'src/components/TestElements.tsx', line: 443, column: 31 };

  function makeDecorativeSpanInDiv() {
    const parent = makeEl({ tagName: 'DIV' });
    (parent as unknown as Record<string, unknown>).parentElement = {
      tagName: 'BODY',
      parentElement: null,
    };
    const emojiSpan = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });
    (emojiSpan as unknown as Record<string, unknown>).parentElement = parent;
    return { parent, emojiSpan };
  }

  it('decorative element resolves via the provenance-safe mapped source (warm map) (HYP-49)', () => {
    const { parent, emojiSpan } = makeDecorativeSpanInDiv();

    // WARM: getSourceLocation already returns the real line; the mapped resolver does too.
    const getSourceLocation = mock((el: HTMLElement): SourceLocation | null => (el === parent ? REAL_SOURCE : null));
    const getMappedSourceLocation = mock((el: HTMLElement): SourceLocation | null =>
      el === parent ? REAL_SOURCE : null,
    );

    const result = resolveDragSource(
      emojiSpan,
      getSourceLocation,
      'src/components/TestElements.tsx',
      getMappedSourceLocation,
    );

    expect(result).not.toBeNull();
    expect(result?.el).toBe(parent);
    expect(result?.source.line).toBe(179);
    // The provenance-safe resolver is the one consulted for the decorative parent.
    expect(getMappedSourceLocation).toHaveBeenCalledWith(parent);
  });

  /**
   * COLD-CACHE REGRESSION (review finding): when the client source map is cold,
   * getSourceLocation falls back to the RAW transformed line (443) — useless for AST
   * lookup. The decorative path must NOT commit it. getMappedSourceLocation returns
   * null (no map hit, no React-18 _debugSource), so the resolver must FAIL SAFE
   * (return null = no garbage write), never resolve to 443.
   */
  it('decorative element fails safe (null) on a cold source map instead of committing the raw transformed line', () => {
    const { parent, emojiSpan } = makeDecorativeSpanInDiv();

    // Attach a React-19 fiber to the parent whose ONLY source is a _debugStack with the
    // raw Vite-transformed line (443). This is what `findNearestSourceLocation` (the raw
    // Step 2b path) would return if it ran — exactly the garbage the guard must prevent.
    const transformedStack = new Error();
    transformedStack.stack = [
      'Error',
      '    at node_modules/.vite/deps/react_jsx-dev-runtime.js?v=abc:192:83',
      '    at http://localhost:5173/src/components/TestElements.tsx:444:32', // 1-based → 443 line via parseDebugStack col, real raw frame
      '    at node_modules/.vite/deps/react-dom_client.js?v=abc:12867:12',
    ].join('\n');
    const parentFiber = makeFiber({ tag: 5, type: 'div', _debugSource: null, _debugStack: transformedStack });
    (parent as unknown as Record<string, unknown>).__reactFiber$xyz = parentFiber;

    // COLD: getSourceLocation returns the RAW transformed line (the bug source);
    // the provenance-safe resolver returns null (no map hit, React 19 _debugStack only).
    const getSourceLocation = mock((el: HTMLElement): SourceLocation | null =>
      el === parent ? RAW_TRANSFORMED : null,
    );
    const getMappedSourceLocation = mock((_el: HTMLElement): SourceLocation | null => null);

    const result = resolveDragSource(
      emojiSpan,
      getSourceLocation,
      'src/components/TestElements.tsx',
      getMappedSourceLocation,
    );

    // Fail safe — must NOT return the raw transformed line. Without the skip-raw guard,
    // Step 2b's findNearestSourceLocation would resolve the parent fiber's _debugStack to
    // line 444 (the transformed frame) and `result` would be non-null with that garbage.
    expect(result).toBeNull();
    // And it must have consulted the provenance-safe resolver for the decorative parent.
    expect(getMappedSourceLocation).toHaveBeenCalledWith(parent);
  });

  /**
   * React 18 projects: getMappedSourceLocation returns the real `_debugSource` line
   * even with cold/absent source maps, so decorative drags keep working there.
   */
  it('decorative element resolves via mapped resolver for React 18 _debugSource (cold map)', () => {
    const { parent, emojiSpan } = makeDecorativeSpanInDiv();

    const getSourceLocation = mock((_el: HTMLElement): SourceLocation | null => null);
    // React 18: mapped resolver returns the real _debugSource-derived line.
    const getMappedSourceLocation = mock((el: HTMLElement): SourceLocation | null =>
      el === parent ? REAL_SOURCE : null,
    );

    const result = resolveDragSource(
      emojiSpan,
      getSourceLocation,
      'src/components/TestElements.tsx',
      getMappedSourceLocation,
    );

    expect(result).not.toBeNull();
    expect(result?.el).toBe(parent);
    expect(result?.source.line).toBe(179);
  });

  /**
   * Backward compatibility: a caller that does NOT supply getMappedSourceLocation
   * keeps the legacy behavior (decorative resolves via getSourceLocation + raw fiber).
   */
  it('decorative element falls back to legacy getSourceLocation when no mapped resolver is given', () => {
    const { parent, emojiSpan } = makeDecorativeSpanInDiv();
    const getSourceLocation = mock((el: HTMLElement): SourceLocation | null => (el === parent ? REAL_SOURCE : null));

    // No 4th arg → legacy path.
    const result = resolveDragSource(emojiSpan, getSourceLocation, 'src/components/TestElements.tsx');

    expect(result).not.toBeNull();
    expect(result?.el).toBe(parent);
    expect(result?.source.line).toBe(179);
  });

  /**
   * Decorative element with null parentElement: Step 2 must be skipped entirely.
   * Without the fix, the code would pass the decorative element itself to
   * getFiberFromDOM, violating the invariant that decorative elements are never
   * the drag target.
   */
  it('returns null for decorative element with null parentElement and no ancestor sources', () => {
    const emojiSpan = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });
    // No parentElement — isolated or at DOM root
    (emojiSpan as unknown as Record<string, unknown>).parentElement = null;
    // The decorative span itself has a fiber, but must not be used as drag target
    const spanFiber = makeFiber({
      _debugSource: { fileName: '/src/Bad.tsx', lineNumber: 1, columnNumber: 1 },
    });
    (emojiSpan as unknown as Record<string, unknown>).__reactFiber$xyz = spanFiber;

    const getSourceLocation = mock((_el: HTMLElement) => null as SourceLocation | null);

    const result = resolveDragSource(emojiSpan, getSourceLocation, '/src/Bad.tsx');

    // No parent → no ancestor walk possible → null
    expect(result).toBeNull();
  });

  /**
   * CRASH REGRESSION (e2e defect #13): a pointerdown over visible text reports
   * e.target as a Text node (nodeType 3) which has no getAttribute. Before the
   * defense-in-depth guard, resolveDragSource crashed with
   * "target.getAttribute is not a function" — ~333 cascade failures in the
   * inspector/canvas/drag suite. The resolver must treat any non-Element target
   * as untraceable (return null) instead of throwing.
   */
  it('returns null without throwing for a Text-node-like target (no getAttribute)', () => {
    const textNodeLike = { nodeType: 3, textContent: 'hello' } as unknown as HTMLElement;
    const getSourceLocation = mock((_el: HTMLElement) => SOURCE_P);

    let result: ReturnType<typeof resolveDragSource> | undefined;
    expect(() => {
      result = resolveDragSource(textNodeLike, getSourceLocation, '/src/App.tsx');
    }).not.toThrow();
    expect(result).toBeNull();
    // Must short-circuit before ever consulting the resolver.
    expect(getSourceLocation).not.toHaveBeenCalled();
  });

  it('returns null without throwing for a real document.createTextNode target', () => {
    const textNode = document.createTextNode('button label') as unknown as HTMLElement;
    const getSourceLocation = mock((_el: HTMLElement) => SOURCE_P);

    let result: ReturnType<typeof resolveDragSource> | undefined;
    expect(() => {
      result = resolveDragSource(textNode, getSourceLocation, '/src/App.tsx');
    }).not.toThrow();
    expect(result).toBeNull();
  });

  /**
   * The non-Element guard must NOT swallow real SVG targets — `<svg>`/`<path>`
   * have getAttribute and are valid draggable elements. They must resolve as
   * themselves, not be rejected as "non-Element".
   */
  it('resolves a real SVG element as itself (getAttribute guard does not reject SVG)', () => {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as unknown as HTMLElement;
    const SOURCE_SVG: SourceLocation = { fileName: '/src/Icon.tsx', line: 3, column: 2 };
    const getSourceLocation = mock((el: HTMLElement) => (el === svg ? SOURCE_SVG : null));

    const result = resolveDragSource(svg, getSourceLocation, '/src/Icon.tsx');

    expect(result).not.toBeNull();
    expect(result?.el).toBe(svg);
    expect(result?.source).toEqual(SOURCE_SVG);
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
   * B1/B4 BUG: Clicking an emoji span (aria-hidden) inside a card was resolving
   * to the span itself (when source maps were warm) instead of the parent card.
   *
   * DOM structure (bulka-the-dog Index.tsx):
   *   grid > outer-card > [emoji-span(aria-hidden), inner-div > text-div]
   *          other-card  (sibling of outer-card)
   *
   * Fix: aria-hidden elements are unconditionally skipped in step 1; step 2's
   * plain ancestor walk then finds the nearest ancestor with a source (outer-card).
   * Non-decorative elements that have their own source are NOT walked up — the user
   * dragging an inner-div expects that div to move, not its outer card.
   */
  describe('decorative-only walk-up (no over-walking)', () => {
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

    /**
     * DR-16 REGRESSION: aria-hidden target inside another aria-hidden parent.
     *
     * DOM structure:
     *   grandparent (source: real)
     *   └── aria-hidden-parent (aria-hidden="true", has source in map)
     *       └── aria-hidden-child (aria-hidden="true", is drag target)
     *
     * The resolver must walk PAST both aria-hidden elements and return grandparent.
     * Before the fix, Step 2a resolved to aria-hidden-parent (it has a source in the
     * map) and returned it as the drag source — a garbage nodeRef because the element
     * is decorative and its source position has no meaningful drag semantics.
     * Step 3 had the same flaw: the first ancestor with a source was aria-hidden-parent.
     */
    it('walks past an aria-hidden parent to reach the first non-aria-hidden ancestor (DR-16)', () => {
      const grandparent = makeEl({ tagName: 'DIV' });
      const ariaHiddenParent = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });
      const ariaHiddenChild = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });

      (ariaHiddenParent as unknown as Record<string, unknown>).parentElement = grandparent;
      (ariaHiddenChild as unknown as Record<string, unknown>).parentElement = ariaHiddenParent;

      const body = makeEl({ tagName: 'BODY' });
      (grandparent as unknown as Record<string, unknown>).parentElement = body;
      (body as unknown as Record<string, unknown>).parentElement = null;

      const SRC_GRANDPARENT: SourceLocation = { fileName: 'Card.tsx', line: 5, column: 2 };
      const SRC_ARIA_PARENT: SourceLocation = { fileName: 'Card.tsx', line: 8, column: 4 };

      // Both grandparent and ariaHiddenParent have sources, but the walk must skip
      // ariaHiddenParent and land on grandparent.
      const getSourceLocation = mock((el: HTMLElement): SourceLocation | null => {
        if (el === grandparent) return SRC_GRANDPARENT;
        if (el === ariaHiddenParent) return SRC_ARIA_PARENT;
        return null;
      });
      const getMappedSourceLocation = mock((el: HTMLElement): SourceLocation | null => {
        if (el === grandparent) return SRC_GRANDPARENT;
        if (el === ariaHiddenParent) return SRC_ARIA_PARENT;
        return null;
      });

      // Without getMappedSourceLocation (legacy path): Step 3 also must skip aria-hidden ancestors.
      const resultLegacy = resolveDragSource(ariaHiddenChild, getSourceLocation, 'Card.tsx');
      expect(resultLegacy?.el).toBe(grandparent);
      expect(resultLegacy?.source).toEqual(SRC_GRANDPARENT);

      // With getMappedSourceLocation: Step 2a must skip ariaHiddenParent, Step 3 must skip it too.
      const resultMapped = resolveDragSource(ariaHiddenChild, getSourceLocation, 'Card.tsx', getMappedSourceLocation);
      expect(resultMapped?.el).toBe(grandparent);
      expect(resultMapped?.source).toEqual(SRC_GRANDPARENT);
    });

    /**
     * DR-16 — STEP 3 PATH: forces the ancestor walk (Step 3) to skip an aria-hidden element.
     *
     * DOM structure:
     *   root (source: via getMapped)
     *   └── grandparent (no getMapped source, not aria-hidden)
     *       └── aria-hidden-parent (aria-hidden="true")
     *           └── aria-hidden-child (drag target, aria-hidden="true")
     *
     * With getMappedSourceLocation: Step 2a walks to grandparent, but getMapped returns null
     * there → Step 2a fails. Step 2b is skipped (getMapped !== undefined). Step 3 runs:
     * must skip ariaHiddenParent (aria-hidden), then skip grandparent (no source via getMapped),
     * then find root. This directly tests the Step 3 aria-hidden skip logic.
     */
    it('Step-3 ancestor walk skips aria-hidden intermediate and finds source above it (DR-16)', () => {
      const root = makeEl({ tagName: 'DIV' });
      const grandparent = makeEl({ tagName: 'DIV' });
      const ariaHiddenParent = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });
      const ariaHiddenChild = makeEl({ tagName: 'SPAN' }, { 'aria-hidden': 'true' });

      (grandparent as unknown as Record<string, unknown>).parentElement = root;
      (ariaHiddenParent as unknown as Record<string, unknown>).parentElement = grandparent;
      (ariaHiddenChild as unknown as Record<string, unknown>).parentElement = ariaHiddenParent;

      const body = makeEl({ tagName: 'BODY' });
      (root as unknown as Record<string, unknown>).parentElement = body;
      (body as unknown as Record<string, unknown>).parentElement = null;

      const SRC_ROOT: SourceLocation = { fileName: 'Card.tsx', line: 2, column: 0 };

      // getMappedSourceLocation: only root has a source (grandparent is cold)
      const getMappedSourceLocation = mock((el: HTMLElement): SourceLocation | null => (el === root ? SRC_ROOT : null));
      // getSourceLocation: also only root has a source in this scenario
      const getSourceLocation = mock((el: HTMLElement): SourceLocation | null => (el === root ? SRC_ROOT : null));

      const result = resolveDragSource(ariaHiddenChild, getSourceLocation, 'Card.tsx', getMappedSourceLocation);

      // Step 3 must have: skipped ariaHiddenParent (aria-hidden), continued past grandparent
      // (no source), and found root.
      expect(result?.el).toBe(root);
      expect(result?.source).toEqual(SRC_ROOT);
    });

    it('resolves emoji-span (aria-hidden, no own source) to nearest source ancestor', () => {
      const { outerCard, emojiSpan, innerDiv, textDiv, otherCard } = buildTree();
      const getSourceLocation = makeGetSourceLocation(outerCard, innerDiv, textDiv, otherCard);

      const result = resolveDragSource(emojiSpan, getSourceLocation, 'Index.tsx');

      expect(result).not.toBeNull();
      // Decorative span → walk up to its parent (outerCard is the nearest ancestor with a source).
      // We do NOT over-walk to a "more meaningful draggable" — that decision belongs upstream.
      expect(result?.el).toBe(outerCard);
      expect(result?.source).toEqual(SRC_OUTER);
    });

    it('resolves text-div click (own source) to text-div itself — no over-walk', () => {
      const { outerCard, innerDiv, textDiv, otherCard } = buildTree();
      const getSourceLocation = makeGetSourceLocation(outerCard, innerDiv, textDiv, otherCard);

      const result = resolveDragSource(textDiv, getSourceLocation, 'Index.tsx');

      expect(result).not.toBeNull();
      // text-div has a source — drag at text-div level. The user explicitly wants
      // the element they grabbed to move, not its outer card.
      expect(result?.el).toBe(textDiv);
      expect(result?.source).toEqual(SRC_TEXT);
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
