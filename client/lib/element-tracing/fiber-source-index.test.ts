/**
 * @file Tests for FiberSourceIndex — lazy reverse index for O(1) source→DOM lookups
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { resolveCallSiteSource } from '../../../shared/canvas-interaction/resolve-source';
import { FiberSourceIndex, hookIntoReactCommits } from './fiber-source-index';
import type { DebugSource, Fiber } from './fiber-utils';

function mockFiber(overrides: Partial<Fiber> = {}): Fiber {
  return {
    tag: 5,
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

/**
 * Creates a mock HTMLElement that passes `document.contains()` check.
 * We use a minimal object with a flag that the mock `contains` reads.
 */
function mockElement(connected = true): HTMLElement {
  const el = { __connected: connected } as unknown as HTMLElement;
  return el;
}

/**
 * Build a simple fiber tree for testing:
 *
 *   HostRoot (tag 3)
 *     └─ App (tag 0, source: App.tsx:1:5)
 *          ├─ div (tag 5, stateNode: el1, source: App.tsx:3:5)
 *          └─ span (tag 5, stateNode: el2, source: App.tsx:4:9)
 */
function buildSimpleTree() {
  const el1 = mockElement();
  const el2 = mockElement();

  const spanFiber = mockFiber({
    tag: 5,
    type: 'span',
    stateNode: el2,
    _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 4, columnNumber: 10 },
  });

  const divFiber = mockFiber({
    tag: 5,
    type: 'div',
    stateNode: el1,
    _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 3, columnNumber: 6 },
    sibling: spanFiber,
  });

  const appFiber = mockFiber({
    tag: 0,
    type: function App() {},
    _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 1, columnNumber: 5 },
    child: divFiber,
  });

  divFiber.return = appFiber;
  spanFiber.return = appFiber;

  const hostRoot = mockFiber({
    tag: 3,
    child: appFiber,
  });
  appFiber.return = hostRoot;

  return { hostRoot, appFiber, divFiber, spanFiber, el1, el2 };
}

/**
 * Build a tree with multiple elements sharing the same source (.map() scenario):
 *
 *   HostRoot (tag 3)
 *     └─ List (tag 0)
 *          ├─ li (tag 5, stateNode: liEl1, source: List.tsx:10:8)
 *          ├─ li (tag 5, stateNode: liEl2, source: List.tsx:10:8)
 *          └─ li (tag 5, stateNode: liEl3, source: List.tsx:10:8)
 */
function buildListTree() {
  const liEl1 = mockElement();
  const liEl2 = mockElement();
  const liEl3 = mockElement();

  const sameSource: DebugSource = { fileName: '/app/src/List.tsx', lineNumber: 10, columnNumber: 8 };

  const li3 = mockFiber({ tag: 5, type: 'li', stateNode: liEl3, _debugSource: sameSource });
  const li2 = mockFiber({ tag: 5, type: 'li', stateNode: liEl2, _debugSource: sameSource, sibling: li3 });
  const li1 = mockFiber({ tag: 5, type: 'li', stateNode: liEl1, _debugSource: sameSource, sibling: li2 });

  const listFiber = mockFiber({
    tag: 0,
    type: function List() {},
    child: li1,
  });
  li1.return = listFiber;
  li2.return = listFiber;
  li3.return = listFiber;

  const hostRoot = mockFiber({ tag: 3, child: listFiber });
  listFiber.return = hostRoot;

  return { hostRoot, liEl1, liEl2, liEl3 };
}

/**
 * Build a tree where an imported child component resolves to a call site in the rendered file:
 *
 *   HostRoot
 *     └─ TrendingSidebar (source: TrendingSidebar.tsx:20)
 *          ├─ UserSuggestion instance 1 (source: TrendingSidebar.tsx:59)
 *          │    └─ div (source: UserSuggestion.tsx:7)
 *          │         └─ span (source: UserSuggestion.tsx:10)
 *          └─ UserSuggestion instance 2 (source: TrendingSidebar.tsx:59)
 *               └─ div (source: UserSuggestion.tsx:7)
 *                    └─ span (source: UserSuggestion.tsx:10)
 */
function buildCallSiteTree() {
  const divEl1 = mockElement();
  const spanEl1 = mockElement();
  const divEl2 = mockElement();
  const spanEl2 = mockElement();

  const callSiteSource: DebugSource = {
    fileName: '/app/src/components/TrendingSidebar.tsx',
    lineNumber: 59,
    columnNumber: 13,
  };

  const span2 = mockFiber({
    tag: 5,
    type: 'span',
    stateNode: spanEl2,
    _debugSource: { fileName: '/app/src/components/UserSuggestion.tsx', lineNumber: 10, columnNumber: 7 },
  });
  const div2 = mockFiber({
    tag: 5,
    type: 'div',
    stateNode: divEl2,
    _debugSource: { fileName: '/app/src/components/UserSuggestion.tsx', lineNumber: 7, columnNumber: 5 },
    child: span2,
  });
  span2.return = div2;
  const userSuggestion2 = mockFiber({
    tag: 0,
    type: function UserSuggestion() {},
    _debugSource: callSiteSource,
    child: div2,
  });
  div2.return = userSuggestion2;

  const span1 = mockFiber({
    tag: 5,
    type: 'span',
    stateNode: spanEl1,
    _debugSource: { fileName: '/app/src/components/UserSuggestion.tsx', lineNumber: 10, columnNumber: 7 },
  });
  const div1 = mockFiber({
    tag: 5,
    type: 'div',
    stateNode: divEl1,
    _debugSource: { fileName: '/app/src/components/UserSuggestion.tsx', lineNumber: 7, columnNumber: 5 },
    child: span1,
  });
  span1.return = div1;
  const userSuggestion1 = mockFiber({
    tag: 0,
    type: function UserSuggestion() {},
    _debugSource: callSiteSource,
    child: div1,
    sibling: userSuggestion2,
  });
  div1.return = userSuggestion1;

  const trendingSidebar = mockFiber({
    tag: 0,
    type: function TrendingSidebar() {},
    _debugSource: { fileName: '/app/src/components/TrendingSidebar.tsx', lineNumber: 20, columnNumber: 3 },
    child: userSuggestion1,
  });
  userSuggestion1.return = trendingSidebar;
  userSuggestion2.return = trendingSidebar;

  const hostRoot = mockFiber({ tag: 3, child: trendingSidebar });
  trendingSidebar.return = hostRoot;

  return { hostRoot, divEl1, divEl2 };
}

describe('FiberSourceIndex', () => {
  let index: FiberSourceIndex;
  let mockDoc: Document;

  beforeEach(() => {
    // Mock document.contains — checks the __connected flag on our mock elements
    mockDoc = {
      contains(node: unknown): boolean {
        if (node !== null && typeof node === 'object' && '__connected' in node) {
          return (node as { __connected: boolean }).__connected;
        }
        return false;
      },
    } as unknown as Document;
  });

  describe('findDOMElement', () => {
    it('should return correct element by source location', () => {
      const { hostRoot, el1 } = buildSimpleTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      // divFiber has _debugSource { lineNumber: 3, columnNumber: 6 }
      // columnNumber 6 (1-based) → column 5 (0-based)
      const result = index.findDOMElement({ fileName: '/app/src/App.tsx', line: 3, column: 5 }, 0);
      expect(result).toBe(el1);
    });

    it('should return correct element at itemIndex when multiple elements share same source', () => {
      const { hostRoot, liEl1, liEl2, liEl3 } = buildListTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      // All three li elements share source: List.tsx:10:8 → column 7 (0-based)
      const source = { fileName: '/app/src/List.tsx', line: 10, column: 7 };

      expect(index.findDOMElement(source, 0)).toBe(liEl1);
      expect(index.findDOMElement(source, 1)).toBe(liEl2);
      expect(index.findDOMElement(source, 2)).toBe(liEl3);
    });

    it('should return null for unknown source location', () => {
      const { hostRoot } = buildSimpleTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findDOMElement({ fileName: '/no/such/file.tsx', line: 99, column: 0 }, 0);
      expect(result).toBeNull();
    });

    it('should return null for out-of-range itemIndex', () => {
      const { hostRoot } = buildSimpleTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findDOMElement({ fileName: '/app/src/App.tsx', line: 3, column: 5 }, 99);
      expect(result).toBeNull();
    });

    it('should return null when root fiber provider returns null', () => {
      index = new FiberSourceIndex(() => null, mockDoc);

      const result = index.findDOMElement({ fileName: '/app/src/App.tsx', line: 3, column: 5 }, 0);
      expect(result).toBeNull();
    });

    it('should handle fibers without _debugSource (skip them)', () => {
      const el = mockElement();
      const noSourceFiber = mockFiber({ tag: 5, type: 'div', stateNode: el });
      const hostRoot = mockFiber({ tag: 3, child: noSourceFiber });
      noSourceFiber.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findDOMElement({ fileName: '/app/src/App.tsx', line: 1, column: 0 }, 0);
      expect(result).toBeNull();
    });

    it('should handle _debugSource with missing columnNumber (default to column 0)', () => {
      const el = mockElement();
      const fiber = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: el,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 5 } as DebugSource,
      });
      const hostRoot = mockFiber({ tag: 3, child: fiber });
      fiber.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findDOMElement({ fileName: '/app/src/App.tsx', line: 5, column: 0 }, 0);
      expect(result).toBe(el);
    });
  });

  describe('invalidate', () => {
    it('should force rebuild on next lookup', () => {
      const el1 = mockElement();
      const el2 = mockElement();

      const source: DebugSource = { fileName: '/app/src/App.tsx', lineNumber: 3, columnNumber: 6 };

      const fiber1 = mockFiber({ tag: 5, type: 'div', stateNode: el1, _debugSource: source });
      const hostRoot1 = mockFiber({ tag: 3, child: fiber1 });
      fiber1.return = hostRoot1;

      const fiber2 = mockFiber({ tag: 5, type: 'div', stateNode: el2, _debugSource: source });
      const hostRoot2 = mockFiber({ tag: 3, child: fiber2 });
      fiber2.return = hostRoot2;

      let currentRoot: Fiber | null = hostRoot1;
      index = new FiberSourceIndex(() => currentRoot, mockDoc);

      // First lookup returns el1
      const loc = { fileName: '/app/src/App.tsx', line: 3, column: 5 };
      expect(index.findDOMElement(loc, 0)).toBe(el1);

      // Swap the root and invalidate
      currentRoot = hostRoot2;
      index.invalidate();

      // Now should return el2 from the new tree
      expect(index.findDOMElement(loc, 0)).toBe(el2);
    });

    it('should not rebuild if not invalidated (cached)', () => {
      const el1 = mockElement();
      const el2 = mockElement();

      const source: DebugSource = { fileName: '/app/src/App.tsx', lineNumber: 3, columnNumber: 6 };

      const fiber1 = mockFiber({ tag: 5, type: 'div', stateNode: el1, _debugSource: source });
      const hostRoot1 = mockFiber({ tag: 3, child: fiber1 });
      fiber1.return = hostRoot1;

      const fiber2 = mockFiber({ tag: 5, type: 'div', stateNode: el2, _debugSource: source });
      const hostRoot2 = mockFiber({ tag: 3, child: fiber2 });
      fiber2.return = hostRoot2;

      let currentRoot: Fiber | null = hostRoot1;
      index = new FiberSourceIndex(() => currentRoot, mockDoc);

      const loc = { fileName: '/app/src/App.tsx', line: 3, column: 5 };
      expect(index.findDOMElement(loc, 0)).toBe(el1);

      // Swap root but DON'T invalidate — should still return el1 from cache
      currentRoot = hostRoot2;
      expect(index.findDOMElement(loc, 0)).toBe(el1);
    });
  });

  describe('disconnected elements (Suspense safety)', () => {
    it('should filter out elements not in document', () => {
      const connectedEl = mockElement(true);
      const disconnectedEl = mockElement(false);

      const source: DebugSource = { fileName: '/app/src/List.tsx', lineNumber: 5, columnNumber: 3 };

      const fiber2 = mockFiber({ tag: 5, type: 'li', stateNode: connectedEl, _debugSource: source });
      const fiber1 = mockFiber({
        tag: 5,
        type: 'li',
        stateNode: disconnectedEl,
        _debugSource: source,
        sibling: fiber2,
      });

      const hostRoot = mockFiber({ tag: 3, child: fiber1 });
      fiber1.return = hostRoot;
      fiber2.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      // itemIndex 0 should be the first CONNECTED element (connectedEl)
      const loc = { fileName: '/app/src/List.tsx', line: 5, column: 2 };
      expect(index.findDOMElement(loc, 0)).toBe(connectedEl);
    });

    it('should return null when all elements are disconnected', () => {
      const el1 = mockElement(false);
      const el2 = mockElement(false);

      const source: DebugSource = { fileName: '/app/src/List.tsx', lineNumber: 5, columnNumber: 3 };

      const fiber2 = mockFiber({ tag: 5, type: 'li', stateNode: el2, _debugSource: source });
      const fiber1 = mockFiber({ tag: 5, type: 'li', stateNode: el1, _debugSource: source, sibling: fiber2 });

      const hostRoot = mockFiber({ tag: 3, child: fiber1 });
      fiber1.return = hostRoot;
      fiber2.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const loc = { fileName: '/app/src/List.tsx', line: 5, column: 2 };
      expect(index.findDOMElement(loc, 0)).toBeNull();
    });
  });

  describe('non-host fibers with _debugSource', () => {
    it('should resolve user component fiber to its host child DOM element', () => {
      const el = mockElement();

      const hostChild = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: el,
      });

      const userComponent = mockFiber({
        tag: 0,
        type: function Button() {},
        _debugSource: { fileName: '/app/src/Button.tsx', lineNumber: 7, columnNumber: 3 },
        child: hostChild,
      });
      hostChild.return = userComponent;

      const hostRoot = mockFiber({ tag: 3, child: userComponent });
      userComponent.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const loc = { fileName: '/app/src/Button.tsx', line: 7, column: 2 };
      expect(index.findDOMElement(loc, 0)).toBe(el);
    });

    it('should collapse imported child internals to one host element per call site instance', () => {
      const { hostRoot, divEl1, divEl2 } = buildCallSiteTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc, {
        mapSource: (source, fiber) => resolveCallSiteSource(source, fiber, 'src/components/TrendingSidebar.tsx'),
      });

      const callSite = { fileName: '/app/src/components/TrendingSidebar.tsx', line: 59, column: 12 };

      expect(index.findDOMElement(callSite, 0)).toBe(divEl1);
      expect(index.findDOMElement(callSite, 1)).toBe(divEl2);
    });
  });

  describe('findClosestSourceDOMElements', () => {
    it('should return null when no entry shares fileName', () => {
      const { hostRoot } = buildSimpleTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findClosestSourceDOMElements({
        fileName: '/no/such/file.tsx',
        line: 1,
        column: 0,
      });
      expect(result).toBeNull();
    });

    it('should return null when source has no fileName', () => {
      const { hostRoot } = buildSimpleTree();
      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findClosestSourceDOMElements({
        fileName: '',
        line: 3,
        column: 5,
      });
      expect(result).toBeNull();
    });

    it('should pick the entry with the smallest line distance', () => {
      const elNear = mockElement();
      const elFar = mockElement();

      // Two host elements in the same file: one at line 10, one at line 50.
      const fiberFar = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: elFar,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 50, columnNumber: 1 },
      });
      const fiberNear = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: elNear,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 10, columnNumber: 1 },
        sibling: fiberFar,
      });
      const hostRoot = mockFiber({ tag: 3, child: fiberNear });
      fiberNear.return = hostRoot;
      fiberFar.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      // Requested line 12 — closer to 10 (distance 2) than to 50 (distance 38).
      const result = index.findClosestSourceDOMElements({
        fileName: '/app/src/App.tsx',
        line: 12,
        column: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.elements).toEqual([elNear]);
      expect(result!.matchedSource.line).toBe(10);
    });

    it('should break line-distance ties using column proximity', () => {
      const elColA = mockElement();
      const elColB = mockElement();

      // Two host elements on the same line, different columns.
      const fiberB = mockFiber({
        tag: 5,
        type: 'span',
        stateNode: elColB,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 10, columnNumber: 21 },
      });
      const fiberA = mockFiber({
        tag: 5,
        type: 'span',
        stateNode: elColA,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 10, columnNumber: 6 },
        sibling: fiberB,
      });
      const hostRoot = mockFiber({ tag: 3, child: fiberA });
      fiberA.return = hostRoot;
      fiberB.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      // _debugSource columnNumber → 0-based: A at column 5, B at column 20.
      // Requested column 8 → A wins (distance 3 < 12).
      const result = index.findClosestSourceDOMElements({
        fileName: '/app/src/App.tsx',
        line: 10,
        column: 8,
      });

      expect(result).not.toBeNull();
      expect(result!.elements).toEqual([elColA]);
      expect(result!.matchedSource.column).toBe(5);
    });

    it('should respect maxLineDistance and return null past the bound', () => {
      const el = mockElement();
      const fiber = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: el,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 10, columnNumber: 1 },
      });
      const hostRoot = mockFiber({ tag: 3, child: fiber });
      fiber.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      // Requested line 100 — distance 90, which exceeds the default bound (20).
      const tooFar = index.findClosestSourceDOMElements({
        fileName: '/app/src/App.tsx',
        line: 100,
        column: 0,
      });
      expect(tooFar).toBeNull();

      // Within an explicit larger bound, the lookup succeeds.
      const withLargerBound = index.findClosestSourceDOMElements(
        { fileName: '/app/src/App.tsx', line: 100, column: 0 },
        { maxLineDistance: 200 },
      );
      expect(withLargerBound).not.toBeNull();
      expect(withLargerBound!.elements).toEqual([el]);
    });

    it('should skip entries whose elements are all disconnected', () => {
      const liveEl = mockElement(true);
      const deadEl = mockElement(false);

      // Closer entry has only a disconnected element; should be skipped in favor
      // of the live one further away.
      const fiberLive = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: liveEl,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 30, columnNumber: 1 },
      });
      const fiberDead = mockFiber({
        tag: 5,
        type: 'div',
        stateNode: deadEl,
        _debugSource: { fileName: '/app/src/App.tsx', lineNumber: 12, columnNumber: 1 },
        sibling: fiberLive,
      });
      const hostRoot = mockFiber({ tag: 3, child: fiberDead });
      fiberDead.return = hostRoot;
      fiberLive.return = hostRoot;

      index = new FiberSourceIndex(() => hostRoot, mockDoc);

      const result = index.findClosestSourceDOMElements({
        fileName: '/app/src/App.tsx',
        line: 14,
        column: 0,
      });

      expect(result).not.toBeNull();
      expect(result!.elements).toEqual([liveEl]);
      expect(result!.matchedSource.line).toBe(30);
    });
  });
});

describe('hookIntoReactCommits', () => {
  it('should call invalidate on commit', () => {
    const { hostRoot } = buildSimpleTree();
    const mockDoc = {
      contains: () => true,
    } as unknown as Document;

    const idx = new FiberSourceIndex(() => hostRoot, mockDoc);

    const hook = {
      onCommitFiberRoot: undefined as ((...args: unknown[]) => void) | undefined,
    };
    const mockGlobal = { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook } as unknown as typeof globalThis;

    const cleanup = hookIntoReactCommits(idx, mockGlobal);

    // Build the index first
    idx.findDOMElement({ fileName: '/app/src/App.tsx', line: 3, column: 5 }, 0);

    // Simulate a React commit — should trigger invalidation
    hook.onCommitFiberRoot?.(0, {});

    // The index should be invalidated (null), so next access rebuilds
    // We can't check internal state directly, but we can verify it still works
    const result = idx.findDOMElement({ fileName: '/app/src/App.tsx', line: 3, column: 5 }, 0);
    expect(result).not.toBeNull();

    cleanup();
  });

  it('should chain with existing onCommitFiberRoot', () => {
    const { hostRoot } = buildSimpleTree();
    const mockDoc = {
      contains: () => true,
    } as unknown as Document;

    const idx = new FiberSourceIndex(() => hostRoot, mockDoc);

    let existingCalled = false;
    const existingHandler: (...args: unknown[]) => void = () => {
      existingCalled = true;
    };

    const hook: { onCommitFiberRoot?: (...args: unknown[]) => void } = {
      onCommitFiberRoot: existingHandler,
    };
    const mockGlobal = { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook } as unknown as typeof globalThis;

    const cleanup = hookIntoReactCommits(idx, mockGlobal);

    hook.onCommitFiberRoot?.(0, {});
    expect(existingCalled).toBe(true);

    cleanup();
  });

  it('should restore original handler on cleanup', () => {
    const { hostRoot } = buildSimpleTree();
    const mockDoc = {
      contains: () => true,
    } as unknown as Document;

    const idx = new FiberSourceIndex(() => hostRoot, mockDoc);

    const original = () => {};
    const hook = {
      onCommitFiberRoot: original as ((...args: unknown[]) => void) | undefined,
    };
    const mockGlobal = { __REACT_DEVTOOLS_GLOBAL_HOOK__: hook } as unknown as typeof globalThis;

    const cleanup = hookIntoReactCommits(idx, mockGlobal);
    expect(hook.onCommitFiberRoot).not.toBe(original);

    cleanup();
    expect(hook.onCommitFiberRoot).toBe(original);
  });

  it('should return noop cleanup when no hook exists', () => {
    const { hostRoot } = buildSimpleTree();
    const mockDoc = {
      contains: () => true,
    } as unknown as Document;

    const idx = new FiberSourceIndex(() => hostRoot, mockDoc);
    const mockGlobal = {} as unknown as typeof globalThis;

    const cleanup = hookIntoReactCommits(idx, mockGlobal);
    expect(typeof cleanup).toBe('function');
    cleanup(); // Should not throw
  });
});
