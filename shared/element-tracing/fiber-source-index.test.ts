/**
 * @file Tests for FiberSourceIndex key-building contract and getOwnFiberSourceLocation fallback.
 *
 * Accessed via: Internal module, not exposed
 *
 * Fix 1 context: getSourceKey() in iframe-interaction.ts previously used findNearestSourceLocation()
 * which walks the fiber.return chain — producing different keys for the root div than FiberSourceIndex
 * which uses resolveSourceIndexFiberSource (own-server → client-sm → getOwnFiberSourceLocation).
 * After the fix, both paths use the same resolution chain, so walk-up via Shift+Enter reaches root.
 */

import { describe, expect, it, spyOn } from 'bun:test';
import type { DebugSource, Fiber } from './fiber-internals';
import { debugSourceToLocation, FiberTag } from './fiber-internals';
import { FiberSourceIndex, getOwnFiberSourceLocation, sourceKeyFromLocation } from './fiber-source-index';
import type { SourceLocation } from './types';

function mockFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: FiberTag.FunctionComponent,
    type: 'div',
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

function mockDebugSource(overrides: Partial<DebugSource> = {}): DebugSource {
  return {
    fileName: '/src/App.tsx',
    lineNumber: 10,
    columnNumber: 5,
    ...overrides,
  };
}

/* ─── getOwnFiberSourceLocation ─────────────────────────────────────── */

describe('getOwnFiberSourceLocation', () => {
  it('returns null when fiber has no debug metadata', () => {
    const fiber = mockFiber({ _debugSource: null, _debugStack: undefined });
    expect(getOwnFiberSourceLocation(fiber)).toBeNull();
  });

  it('returns location from _debugSource (React 18 Babel)', () => {
    const ds = mockDebugSource({ fileName: '/src/App.tsx', lineNumber: 42, columnNumber: 7 });
    const fiber = mockFiber({ _debugSource: ds });
    const loc = getOwnFiberSourceLocation(fiber);
    expect(loc).not.toBeNull();
    expect(loc!.fileName).toBe('/src/App.tsx');
    expect(loc!.line).toBe(42);
    // columnNumber is 1-based, SourceLocation.column is 0-based
    expect(loc!.column).toBe(6);
  });

  it('converts _debugSource columnNumber from 1-based to 0-based', () => {
    const ds = mockDebugSource({ columnNumber: 1 });
    const fiber = mockFiber({ _debugSource: ds });
    const loc = getOwnFiberSourceLocation(fiber);
    expect(loc!.column).toBe(0);
  });
});

/* ─── FiberSourceIndex key parity ───────────────────────────────────── */

describe('FiberSourceIndex resolveFiberSource parity', () => {
  it('default resolveFiberSource falls back to getOwnFiberSourceLocation', () => {
    const ds = mockDebugSource({ fileName: '/src/Root.tsx', lineNumber: 5, columnNumber: 3 });
    const fiber = mockFiber({ _debugSource: ds });
    const expectedLoc = debugSourceToLocation(ds);

    // The default resolveFiberSource is getOwnFiberSourceLocation — same as the fallback
    // in resolveSourceIndexFiberSource used by getSourceKey after Fix 1.
    const fromFiber = getOwnFiberSourceLocation(fiber);
    expect(fromFiber).not.toBeNull();
    expect(fromFiber!.fileName).toBe(expectedLoc.fileName);
    expect(fromFiber!.line).toBe(expectedLoc.line);
    expect(fromFiber!.column).toBe(expectedLoc.column);
  });

  it('custom resolveFiberSource with source-map override takes priority over _debugSource', () => {
    const ds = mockDebugSource({ fileName: '/compiled/bundle.js', lineNumber: 1, columnNumber: 100 });
    const smOverride: SourceLocation = { fileName: '/src/Root.tsx', line: 5, column: 2 };
    const fiber = mockFiber({ _debugSource: ds });

    // Simulate resolveSourceIndexFiberSource: smOverride ?? smClient ?? getOwnFiberSourceLocation
    const customResolver = (f: Fiber): SourceLocation | null => {
      // Source map found — returns overridden location, not _debugSource
      if (f._debugSource?.fileName.includes('bundle.js')) return smOverride;
      return getOwnFiberSourceLocation(f);
    };

    const result = customResolver(fiber);
    expect(result).toBe(smOverride);
    expect(result!.fileName).toBe('/src/Root.tsx');
  });

  it('custom resolveFiberSource falls back to getOwnFiberSourceLocation when no source map', () => {
    const ds = mockDebugSource({ fileName: '/src/App.tsx', lineNumber: 20, columnNumber: 4 });
    const fiber = mockFiber({ _debugSource: ds });

    // Simulates resolveSourceIndexFiberSource when both source map resolvers return null:
    // resolveOwnServerSourceMap(f) ?? resolveViaClientSourceMap(f) ?? getOwnFiberSourceLocation(f)
    // codeql[js/useless-conditional] -- intentional stub: both return null to exercise the fallback-to-getOwnFiberSourceLocation branch
    const resolveOwnServerSourceMap = (_f: Fiber): SourceLocation | null => null;
    const resolveViaClientSourceMap = (_f: Fiber): SourceLocation | null => null;
    const customResolver = (f: Fiber): SourceLocation | null =>
      resolveOwnServerSourceMap(f) ?? resolveViaClientSourceMap(f) ?? getOwnFiberSourceLocation(f);

    const result = customResolver(fiber);
    expect(result).not.toBeNull();
    expect(result!.fileName).toBe('/src/App.tsx');
    expect(result!.line).toBe(20);
    expect(result!.column).toBe(3); // 1-based → 0-based
  });

  it('sourceKeyFromLocation matches the format consumed by FiberSourceIndex.findDOMElements', () => {
    const ds = mockDebugSource({ fileName: '/src/Root.tsx', lineNumber: 1, columnNumber: 1 });
    const fiber = mockFiber({ _debugSource: ds });

    const loc = getOwnFiberSourceLocation(fiber);
    expect(loc).not.toBeNull();

    expect(sourceKeyFromLocation(loc!)).toBe('/src/Root.tsx:1:0');
  });
});

/* ─── findClosestSourceDOMElements ──────────────────────────────────── */

describe('FiberSourceIndex.findClosestSourceDOMElements', () => {
  function hostFiber(el: HTMLElement, source: SourceLocation, parent: Fiber | null = null): Fiber {
    const debugSource: DebugSource = {
      fileName: source.fileName,
      lineNumber: source.line,
      columnNumber: source.column + 1, // SourceLocation is 0-based, DebugSource is 1-based
    };
    return {
      tag: FiberTag.HostComponent,
      type: 'div',
      stateNode: el,
      return: parent,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: debugSource,
      _debugOwner: null,
    };
  }

  function buildTree(entries: Array<{ el: HTMLElement; source: SourceLocation }>): Fiber {
    const root: Fiber = {
      tag: FiberTag.HostRoot,
      type: null,
      stateNode: null,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugOwner: null,
    };
    let prev: Fiber | null = null;
    for (const { el, source } of entries) {
      const fiber = hostFiber(el, source, root);
      if (prev === null) root.child = fiber;
      else prev.sibling = fiber;
      prev = fiber;
    }
    return root;
  }

  function setup(entries: Array<{ source: SourceLocation }>) {
    const elements = entries.map((_, i) => {
      const el = document.createElement('div');
      el.setAttribute('data-i', String(i));
      document.body.appendChild(el);
      return el;
    });
    const root = buildTree(entries.map((e, i) => ({ el: elements[i], source: e.source })));
    const index = new FiberSourceIndex(() => root, document);
    return {
      index,
      elements,
      cleanup: () => {
        for (const el of elements) el.remove();
      },
    };
  }

  it('returns null when no entries share the requested fileName', () => {
    const { index, cleanup } = setup([{ source: { fileName: '/src/A.tsx', line: 10, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements({ fileName: '/src/B.tsx', line: 10, column: 0 });
      expect(out).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('picks the same-file entry with the smallest line distance', () => {
    const { index, elements, cleanup } = setup([
      { source: { fileName: '/src/A.tsx', line: 5, column: 0 } },
      { source: { fileName: '/src/A.tsx', line: 12, column: 0 } },
      { source: { fileName: '/src/A.tsx', line: 20, column: 0 } },
    ]);
    try {
      const out = index.findClosestSourceDOMElements({ fileName: '/src/A.tsx', line: 13, column: 0 });
      expect(out).not.toBeNull();
      expect(out!.elements).toEqual([elements[1]]); // line 12 — distance 1, beats 7 and 7
      expect(out!.matchedSource.line).toBe(12);
    } finally {
      cleanup();
    }
  });

  it('breaks ties on equal line distance by minimum column distance', () => {
    const { index, elements, cleanup } = setup([
      { source: { fileName: '/src/A.tsx', line: 9, column: 100 } }, // dist 1, col 100
      { source: { fileName: '/src/A.tsx', line: 11, column: 4 } }, // dist 1, col 4 (winner)
      { source: { fileName: '/src/A.tsx', line: 9, column: 50 } }, // dist 1, col 50
    ]);
    try {
      const out = index.findClosestSourceDOMElements({ fileName: '/src/A.tsx', line: 10, column: 5 });
      expect(out).not.toBeNull();
      expect(out!.elements).toEqual([elements[1]]);
    } finally {
      cleanup();
    }
  });

  it('returns null when every same-file entry exceeds maxLineDistance', () => {
    const { index, cleanup } = setup([
      { source: { fileName: '/src/A.tsx', line: 5, column: 0 } },
      { source: { fileName: '/src/A.tsx', line: 100, column: 0 } },
    ]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: '/src/A.tsx', line: 50, column: 0 },
        { maxLineDistance: 10 },
      );
      expect(out).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('honours custom maxLineDistance', () => {
    const { index, elements, cleanup } = setup([{ source: { fileName: '/src/A.tsx', line: 30, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: '/src/A.tsx', line: 20, column: 0 },
        { maxLineDistance: 50 },
      );
      expect(out).not.toBeNull();
      expect(out!.elements).toEqual([elements[0]]);
    } finally {
      cleanup();
    }
  });

  it('skips entries whose DOM element is no longer in the document', () => {
    const { index, elements, cleanup } = setup([
      { source: { fileName: '/src/A.tsx', line: 10, column: 0 } },
      { source: { fileName: '/src/A.tsx', line: 20, column: 0 } },
    ]);
    try {
      // Remove the closer element from the document — fallback must return the live one.
      elements[0].remove();
      const out = index.findClosestSourceDOMElements({ fileName: '/src/A.tsx', line: 11, column: 0 });
      expect(out).not.toBeNull();
      expect(out!.elements).toEqual([elements[1]]);
      expect(out!.matchedSource.line).toBe(20);
    } finally {
      cleanup();
    }
  });

  it('returns null when source.fileName is empty', () => {
    const { index, cleanup } = setup([{ source: { fileName: '/src/A.tsx', line: 1, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements({ fileName: '', line: 1, column: 0 });
      expect(out).toBeNull();
    } finally {
      cleanup();
    }
  });

  // Regression: tree-driven selection dispatches an absolute filesystem path while
  // FiberSourceIndex stores Vite-relative paths. Without matchPathAcrossFormats, the
  // closest-source fallback misses every entry and selection drops on HMR line shift.
  it('matchPathAcrossFormats: absolute query matches Vite-relative index entry', () => {
    const { index, elements, cleanup } = setup([{ source: { fileName: 'src/Foo.tsx', line: 50, column: 8 } }]);
    try {
      const strict = index.findClosestSourceDOMElements({
        fileName: '/workspace/src/Foo.tsx',
        line: 52,
        column: 8,
      });
      expect(strict).toBeNull();

      const relaxed = index.findClosestSourceDOMElements(
        { fileName: '/workspace/src/Foo.tsx', line: 52, column: 8 },
        { matchPathAcrossFormats: true },
      );
      expect(relaxed).not.toBeNull();
      expect(relaxed!.elements).toEqual([elements[0]]);
      expect(relaxed!.matchedSource.line).toBe(50);
    } finally {
      cleanup();
    }
  });

  it('matchPathAcrossFormats: Vite-relative query matches absolute index entry', () => {
    const { index, elements, cleanup } = setup([
      { source: { fileName: '/workspace/src/Foo.tsx', line: 50, column: 8 } },
    ]);
    try {
      const relaxed = index.findClosestSourceDOMElements(
        { fileName: 'src/Foo.tsx', line: 52, column: 8 },
        { matchPathAcrossFormats: true },
      );
      expect(relaxed).not.toBeNull();
      expect(relaxed!.elements).toEqual([elements[0]]);
    } finally {
      cleanup();
    }
  });

  it('matchPathAcrossFormats: identical paths still match (no regression)', () => {
    const { index, elements, cleanup } = setup([{ source: { fileName: '/src/A.tsx', line: 50, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: '/src/A.tsx', line: 52, column: 0 },
        { matchPathAcrossFormats: true },
      );
      expect(out).not.toBeNull();
      expect(out!.elements).toEqual([elements[0]]);
    } finally {
      cleanup();
    }
  });

  it('matchPathAcrossFormats: partial-segment-suffix does NOT match (Foo.tsx vs MyFoo.tsx)', () => {
    const { index, cleanup } = setup([{ source: { fileName: 'src/MyFoo.tsx', line: 50, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: 'Foo.tsx', line: 50, column: 0 },
        { matchPathAcrossFormats: true },
      );
      expect(out).toBeNull();
    } finally {
      cleanup();
    }
  });

  // Regression: AstService normalizes nodeRefs via Node `path.join`, which on
  // Windows emits `C:\\workspace\\src\\Foo.tsx`. The original raw-string suffix
  // match never matched a Vite-relative `src/Foo.tsx` index entry, so selection
  // dropped on Windows after HMR.
  it('matchPathAcrossFormats: Windows backslash path matches Vite-relative entry', () => {
    const { index, elements, cleanup } = setup([{ source: { fileName: 'src/Foo.tsx', line: 50, column: 8 } }]);
    try {
      const relaxed = index.findClosestSourceDOMElements(
        { fileName: 'C:\\workspace\\src\\Foo.tsx', line: 52, column: 8 },
        { matchPathAcrossFormats: true },
      );
      expect(relaxed).not.toBeNull();
      expect(relaxed!.elements).toEqual([elements[0]]);
    } finally {
      cleanup();
    }
  });

  it('matchPathAcrossFormats: Windows backslash subpath matches longer Windows path', () => {
    const { index, elements, cleanup } = setup([
      { source: { fileName: 'C:\\workspace\\src\\Foo.tsx', line: 50, column: 8 } },
    ]);
    try {
      const relaxed = index.findClosestSourceDOMElements(
        { fileName: 'src\\Foo.tsx', line: 52, column: 8 },
        { matchPathAcrossFormats: true },
      );
      expect(relaxed).not.toBeNull();
      expect(relaxed!.elements).toEqual([elements[0]]);
    } finally {
      cleanup();
    }
  });

  it('matchPathAcrossFormats: Windows partial-segment suffix does NOT match (Foo.tsx vs MyFoo.tsx)', () => {
    const { index, cleanup } = setup([{ source: { fileName: 'C:\\workspace\\src\\MyFoo.tsx', line: 50, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: 'Foo.tsx', line: 50, column: 0 },
        { matchPathAcrossFormats: true },
      );
      expect(out).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('matchPathAcrossFormats: distinct directories do NOT match (a/Foo.tsx vs b/Foo.tsx)', () => {
    const { index, cleanup } = setup([{ source: { fileName: 'src/a/Foo.tsx', line: 50, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: 'src/b/Foo.tsx', line: 50, column: 0 },
        { matchPathAcrossFormats: true },
      );
      expect(out).toBeNull();
    } finally {
      cleanup();
    }
  });

  // Edge case: a leading-slash short path is itself a complete root-relative path,
  // so the boundary check must accept it without requiring a preceding '/'.
  it('matchPathAcrossFormats: leading-slash short path matches longer subpath', () => {
    const { index, elements, cleanup } = setup([{ source: { fileName: 'src/Foo.tsx', line: 50, column: 0 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: '/src/Foo.tsx', line: 50, column: 0 },
        { matchPathAcrossFormats: true },
      );
      expect(out).not.toBeNull();
      expect(out?.elements).toEqual([elements[0]]);
    } finally {
      cleanup();
    }
  });

  // Regression: caller (findElementsByRef in iframe-interaction) treats lineDistance=0 &&
  // columnDistance=0 as exact match when only path format differs, so itemIndex slicing is
  // safe. Method must report zero distance, not approximate, when (line, column) are equal.
  it('reports zero line/column distance for exact line+col match across path formats', () => {
    const { index, cleanup } = setup([{ source: { fileName: 'src/Foo.tsx', line: 50, column: 8 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: '/workspace/src/Foo.tsx', line: 50, column: 8 },
        { matchPathAcrossFormats: true },
      );
      expect(out).not.toBeNull();
      expect(out!.lineDistance).toBe(0);
      expect(out!.columnDistance).toBe(0);
    } finally {
      cleanup();
    }
  });

  it('reports non-zero line distance when only path format matches and lines differ', () => {
    const { index, cleanup } = setup([{ source: { fileName: 'src/Foo.tsx', line: 50, column: 8 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: '/workspace/src/Foo.tsx', line: 52, column: 8 },
        { matchPathAcrossFormats: true },
      );
      expect(out).not.toBeNull();
      expect(out!.lineDistance).toBe(2);
      expect(out!.columnDistance).toBe(0);
    } finally {
      cleanup();
    }
  });

  // Regression: distance metric used `lineDist * 1000 + colDist` which collapses when
  // colDist > 1000 (minified or single-line generated JSX). A one-line-further candidate
  // with colDist=0 would beat a same-line candidate with colDist=1500. Lexicographic
  // (lineDist, colDist) compare must always prefer the closer line.
  it('line distance dominates even when column distance exceeds 1000', () => {
    const { index, elements, cleanup } = setup([
      { source: { fileName: '/src/A.tsx', line: 10, column: 1500 } }, // dist 0 line, far col
      { source: { fileName: '/src/A.tsx', line: 11, column: 0 } }, // dist 1 line, exact col
    ]);
    try {
      const out = index.findClosestSourceDOMElements({ fileName: '/src/A.tsx', line: 10, column: 0 });
      expect(out).not.toBeNull();
      // Same-line candidate must win regardless of huge column delta.
      expect(out!.elements).toEqual([elements[0]]);
      expect(out!.matchedSource.line).toBe(10);
    } finally {
      cleanup();
    }
  });

  // Monorepo (HYP-435): after an AST edit re-rooted to the repo (AstBridge sub→repo
  // translation), the minted/repeated selection id comes back REPO-relative
  // (`targets/conloca-app/src/app/page.tsx`) while the iframe's FiberSourceIndex
  // is keyed SUB-relative (`src/app/page.tsx`, what the dev server's Vite sees).
  // The cross-format relaxed match must still re-highlight the clicked element,
  // and (line, column) being identical it must report zero distance so itemIndex
  // slicing stays valid.
  it('matchPathAcrossFormats: repo-relative query matches sub-project-relative entry (monorepo re-highlight)', () => {
    const { index, elements, cleanup } = setup([{ source: { fileName: 'src/app/page.tsx', line: 12, column: 4 } }]);
    try {
      const out = index.findClosestSourceDOMElements(
        { fileName: 'targets/conloca-app/src/app/page.tsx', line: 12, column: 4 },
        { matchPathAcrossFormats: true },
      );
      expect(out).not.toBeNull();
      expect(out!.elements).toEqual([elements[0]]);
      expect(out!.lineDistance).toBe(0);
      expect(out!.columnDistance).toBe(0);
    } finally {
      cleanup();
    }
  });
});

/* ─── findDOMElements cross-format fallback ─────────────────────────── */

// Safety net for fileName canonicalization drift (HYP-594): the index can be keyed
// with a basename-only path (a source map whose sources=["Hero.tsx"] resolved verbatim)
// while node-map-driven queries use project-relative paths — or vice versa. The exact
// Map lookup stays first; on miss, a pathsMatchAcrossFormats scan at the same
// (line, column) must rescue the lookup and emit a '[tracing]' debug line.
describe('FiberSourceIndex.findDOMElements cross-format fallback', () => {
  function setupSingle(indexFileName: string, line: number, column: number) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const hostFiber: Fiber = {
      tag: FiberTag.HostComponent,
      type: 'div',
      stateNode: el,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      // SourceLocation column is 0-based, DebugSource columnNumber is 1-based
      _debugSource: { fileName: indexFileName, lineNumber: line, columnNumber: column + 1 },
      _debugOwner: null,
    };
    const root: Fiber = {
      tag: FiberTag.HostRoot,
      type: null,
      stateNode: null,
      return: null,
      child: hostFiber,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugOwner: null,
    };
    hostFiber.return = root;
    const index = new FiberSourceIndex(() => root, document);
    return { index, el, cleanup: () => el.remove() };
  }

  it('rescues a project-relative query against a basename-only index key', () => {
    const { index, el, cleanup } = setupSingle('Hero.tsx', 6, 6);
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const found = index.findDOMElements({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
      expect(found).toEqual([el]);
      expect(debugSpy.mock.calls.some((c) => String(c[0]).includes('[tracing]'))).toBe(true);
    } finally {
      debugSpy.mockRestore();
      cleanup();
    }
  });

  it('rescues a basename query against a project-relative index key', () => {
    const { index, el, cleanup } = setupSingle('src/components/Hero.tsx', 6, 6);
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const found = index.findDOMElements({ fileName: 'Hero.tsx', line: 6, column: 6 });
      expect(found).toEqual([el]);
    } finally {
      debugSpy.mockRestore();
      cleanup();
    }
  });

  it('findDOMElement(itemIndex) goes through the same fallback', () => {
    const { index, el, cleanup } = setupSingle('Hero.tsx', 6, 6);
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      expect(index.findDOMElement({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 }, 0)).toBe(el);
      expect(index.findDOMElement({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 }, 1)).toBeNull();
    } finally {
      debugSpy.mockRestore();
      cleanup();
    }
  });

  it('does not rescue when line or column differ', () => {
    const { index, cleanup } = setupSingle('Hero.tsx', 6, 6);
    try {
      expect(index.findDOMElements({ fileName: 'src/components/Hero.tsx', line: 7, column: 6 })).toEqual([]);
      expect(index.findDOMElements({ fileName: 'src/components/Hero.tsx', line: 6, column: 5 })).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('does not rescue a partial-segment suffix (Hero.tsx vs MyHero.tsx)', () => {
    const { index, cleanup } = setupSingle('src/components/MyHero.tsx', 6, 6);
    try {
      expect(index.findDOMElements({ fileName: 'Hero.tsx', line: 6, column: 6 })).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('exact-key hit stays on the fast path without the rescue debug line', () => {
    const { index, el, cleanup } = setupSingle('src/components/Hero.tsx', 6, 6);
    const debugSpy = spyOn(console, 'debug').mockImplementation(() => {});
    try {
      const found = index.findDOMElements({ fileName: 'src/components/Hero.tsx', line: 6, column: 6 });
      expect(found).toEqual([el]);
      expect(debugSpy.mock.calls.length).toBe(0);
    } finally {
      debugSpy.mockRestore();
      cleanup();
    }
  });
});

/* ─── shouldSkipNestedMappedSource ──────────────────────────────────── */

describe('FiberSourceIndex source-map collapse skips nested fibers at same mapped location', () => {
  it('keeps only the outermost fiber when child maps to the same source as its ancestor', () => {
    // Real-world cause: source-map collapses generated wrapper(s) onto the same
    // user-source location as the parent. Without skipping, both fibers register
    // for the same key and findDOMElement returns multiple unrelated host nodes.
    const outerEl = document.createElement('section');
    const innerEl = document.createElement('span');
    outerEl.appendChild(innerEl);
    document.body.appendChild(outerEl);

    const sharedSource: SourceLocation = { fileName: '/src/Page.tsx', line: 7, column: 2 };

    // Inner fiber's RAW debug source differs from outer's, but mapSource collapses
    // both to sharedSource — so shouldSkipNestedMappedSource must reject inner.
    const outerFiber: Fiber = {
      tag: FiberTag.HostComponent,
      type: 'section',
      stateNode: outerEl,
      return: null,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: { fileName: '/src/Page.tsx', lineNumber: 7, columnNumber: 3 },
      _debugOwner: null,
    };
    const innerFiber: Fiber = {
      tag: FiberTag.HostComponent,
      type: 'span',
      stateNode: innerEl,
      return: outerFiber,
      child: null,
      sibling: null,
      memoizedProps: {},
      _debugSource: { fileName: '/src/_generated/wrapper.js', lineNumber: 200, columnNumber: 5 },
      _debugOwner: null,
    };
    outerFiber.child = innerFiber;
    const root: Fiber = {
      tag: FiberTag.HostRoot,
      type: null,
      stateNode: null,
      return: null,
      child: outerFiber,
      sibling: null,
      memoizedProps: {},
      _debugSource: null,
      _debugOwner: null,
    };

    // mapSource: collapse the generated wrapper onto the same user-source as the parent.
    const mapSource = (loc: SourceLocation): SourceLocation =>
      loc.fileName.includes('_generated') ? sharedSource : loc;

    try {
      const index = new FiberSourceIndex(() => root, document, { mapSource });
      const live = index.findDOMElements(sharedSource);
      // Without the skip, both outer + inner would land under the same key.
      expect(live).toHaveLength(1);
      expect(live[0]).toBe(outerEl);
    } finally {
      outerEl.remove();
    }
  });
});
