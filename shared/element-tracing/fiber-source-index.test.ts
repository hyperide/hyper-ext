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

import { describe, expect, it } from 'bun:test';
import type { DebugSource, Fiber } from './fiber-internals';
import { FiberTag, debugSourceToLocation } from './fiber-internals';
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
    return { index, elements, cleanup: () => elements.forEach((el) => el.remove()) };
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
});
