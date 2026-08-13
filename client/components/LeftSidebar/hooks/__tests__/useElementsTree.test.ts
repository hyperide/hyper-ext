/**
 * @file useElementsTree dependency-tracking tests
 *
 * Accessed via: LeftSidebar.tsx and RightSidebar.tsx (both call `useElementsTree()`).
 *
 * Assumptions:
 *   - SaaS path: `updateCounter` from the store-subscription hook is the
 *     reactivity trigger. Its value is not read in the memo body, but its
 *     change signal MUST recompute the memo so `buildTreeFromEngine` can read
 *     the freshly-mutated `store.getState()` and `engine.getRoot().metadata`.
 *   - VS Code path: `stateResult` from `useSharedEditorState((s) => s.astStructure)`
 *     is the direct source — identity changes drive the recompute.
 *
 * Past bug avoided: removing `updateCounter` from deps would leave the tree
 * stale after any engine-state mutation (selection, instance add/remove, etc.)
 * because neither `engine` nor `store` identity changes on internal mutation.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

// ─── Shared mutable state for mock hooks ────────────────────────────────────

type FakeRoot = {
  id: string;
  metadata: {
    sampleStructure?: Array<{ id: string; type: 'element'; label: string }>;
    astStructure?: Array<{ id: string; type: 'element'; label: string }>;
  };
};

type Subscriber = () => void;

type FakeInstance = {
  id: string;
  type: string;
  parentId?: string | null;
  children: string[];
  metadata?: Record<string, unknown>;
};

const fakeStore = (() => {
  let updateCounter = 0;
  let instances = new Map<string, FakeInstance>();
  const subs = new Set<Subscriber>();
  return {
    subscribe(cb: Subscriber) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    getState() {
      return { instances, _updateCounter: updateCounter };
    },
    setInstances(next: Map<string, FakeInstance>) {
      instances = next;
    },
    bump() {
      updateCounter += 1;
      for (const cb of subs) cb();
    },
    reset() {
      updateCounter = 0;
      instances = new Map();
      subs.clear();
    },
  };
})();

const fakeRoot: FakeRoot = { id: 'root', metadata: { sampleStructure: [] } };
const fakeEngine = {
  getRoot: () => fakeRoot,
  getInstance: () => null,
  registry: { get: () => null },
};

const mockState = {
  engine: null as null | typeof fakeEngine,
  store: null as null | typeof fakeStore,
  astStructure: null as null | Array<{ id: string; type: 'element'; label: string }>,
};

// ─── Module mocks (must appear before any import of the module under test) ──

mock.module('@/lib/canvas-engine', () => ({
  useCanvasEngineOptional: () => mockState.engine,
  useCanvasEngineContextOptional: () => (mockState.store ? { store: mockState.store } : null),
}));

mock.module('@/lib/platform/shared-editor-state', () => ({
  useSharedEditorState: () => mockState.astStructure,
}));

mock.module('@lib/services/tree-adapter', () => ({
  convertComponentNodeToTreeNode: (n: { id: string; type: string; label: string }) => ({
    id: n.id,
    type: n.type,
    label: n.label,
    children: [],
  }),
}));

// ─── Import hook under test AFTER mocks ─────────────────────────────────────

const { useElementsTree } = await import('../useElementsTree');

beforeEach(() => {
  mockState.engine = null;
  mockState.store = null;
  mockState.astStructure = null;
  fakeStore.reset();
  fakeRoot.metadata = { sampleStructure: [] };
});

afterEach(() => {
  fakeStore.reset();
});

// ─── VS Code path: stateResult identity changes drive recompute ─────────────

describe('useElementsTree — VS Code path', () => {
  it('returns EMPTY_TREE when no engine and no astStructure', () => {
    const { result } = renderHook(() => useElementsTree());
    expect(result.current).toEqual([]);
  });

  it('returns astStructure from useSharedEditorState when no engine', () => {
    mockState.astStructure = [{ id: 'a', type: 'element', label: 'div' }];
    const { result } = renderHook(() => useElementsTree());
    expect(result.current).toEqual([{ id: 'a', type: 'element', label: 'div' }]);
  });
});

// ─── SaaS path: store updateCounter drives recompute ────────────────────────

describe('useElementsTree — SaaS path reactivity', () => {
  it('re-runs memo after store updateCounter increments (fresh metadata visible)', () => {
    mockState.engine = fakeEngine;
    mockState.store = fakeStore;
    fakeRoot.metadata = { sampleStructure: [{ id: 'x1', type: 'element', label: 'Old' }] };

    const { result } = renderHook(() => useElementsTree());
    expect(result.current).toEqual([{ id: 'x1', type: 'element', label: 'Old', children: [] }]);

    // Mutate metadata in place — engine/store identity unchanged. Without
    // `updateCounter` in the memo deps, the hook would keep returning the
    // cached "Old" tree.
    act(() => {
      fakeRoot.metadata = { sampleStructure: [{ id: 'x2', type: 'element', label: 'New' }] };
      fakeStore.bump();
    });

    expect(result.current).toEqual([{ id: 'x2', type: 'element', label: 'New', children: [] }]);
  });
});

// ─── SaaS path: orphaned (unresolvable) child must not leak a debug token ────

describe('useElementsTree — SaaS orphaned-child label', () => {
  it('labels an unresolvable child with the generic "Element", never the raw "Unknown" sentinel', () => {
    // A parent instance lists a child id that engine.getInstance() cannot resolve
    // (a transient state desync, e.g. mid-mutation). The fallback node must read as
    // a clean generic — matching its TreeNode type 'element' — instead of leaking the
    // uninformative "Unknown" token into the explorer tree (audit of the #559 class).
    mockState.engine = fakeEngine; // getInstance: () => null  → child is unresolvable
    mockState.store = fakeStore;
    fakeRoot.metadata = {}; // no sample/astStructure → falls through to the instances path
    fakeStore.setInstances(
      new Map([['root', { id: 'root', type: 'root', parentId: null, children: ['orphan-1'] }]]),
    );

    const { result } = renderHook(() => useElementsTree());

    // children: [] required — shape must be consistent with resolved nodes so consumers
    // can iterate node.children without optional chaining (review finding, claude-opus-4-8).
    expect(result.current).toEqual([{ id: 'orphan-1', type: 'element', label: 'Element', children: [] }]);
  });
});
