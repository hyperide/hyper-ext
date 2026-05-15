import { describe, expect, it, mock } from 'bun:test';
import type { NodeMapEntry } from '../element-tracing/types';
import {
  createDesignKeydownHandler,
  findDirectChildNodeRefs,
  findParentNodeRef,
  findSiblingNodeRef,
  type NodeMapLookup,
} from './keyboard-handler';

// ============================================================================
// NodeMap-based navigation tests
// ============================================================================

function makeEntry(overrides: Partial<NodeMapEntry> & { nodeRef: string }): NodeMapEntry {
  return {
    tag: 'div',
    loc: { fileName: 'App.tsx', line: 1, column: 0 },
    endLoc: { fileName: 'App.tsx', line: 1, column: 10 },
    parentRef: null,
    children: [],
    isComponent: false,
    fingerprint: 'abc',
    ...overrides,
  };
}

function createLookup(entries: NodeMapEntry[]): NodeMapLookup {
  const map = new Map(entries.map((e) => [e.nodeRef, e]));
  return {
    getEntry: (ref) => map.get(ref) ?? null,
    findDOMElement: () => null,
  };
}

describe('findParentNodeRef', () => {
  it('returns parentRef from node map entry', () => {
    const lookup = createLookup([
      makeEntry({ nodeRef: 'App.tsx:0', children: ['App.tsx:1'] }),
      makeEntry({ nodeRef: 'App.tsx:1', parentRef: 'App.tsx:0' }),
    ]);

    expect(findParentNodeRef('App.tsx:1', lookup)).toBe('App.tsx:0');
  });

  it('returns null when entry has no parent', () => {
    const lookup = createLookup([makeEntry({ nodeRef: 'App.tsx:0' })]);

    expect(findParentNodeRef('App.tsx:0', lookup)).toBeNull();
  });

  it('returns null when nodeRef not found in map', () => {
    const lookup = createLookup([]);

    expect(findParentNodeRef('nonexistent', lookup)).toBeNull();
  });
});

describe('findDirectChildNodeRefs', () => {
  it('returns children from node map entry', () => {
    const lookup = createLookup([makeEntry({ nodeRef: 'App.tsx:0', children: ['App.tsx:1', 'App.tsx:2'] })]);

    expect(findDirectChildNodeRefs('App.tsx:0', lookup)).toEqual(['App.tsx:1', 'App.tsx:2']);
  });

  it('returns empty array when entry has no children', () => {
    const lookup = createLookup([makeEntry({ nodeRef: 'App.tsx:0' })]);

    expect(findDirectChildNodeRefs('App.tsx:0', lookup)).toEqual([]);
  });

  it('returns empty array when nodeRef not found', () => {
    const lookup = createLookup([]);

    expect(findDirectChildNodeRefs('nonexistent', lookup)).toEqual([]);
  });
});

describe('findSiblingNodeRef', () => {
  const lookup = createLookup([
    makeEntry({ nodeRef: 'App.tsx:0', children: ['App.tsx:1', 'App.tsx:2', 'App.tsx:3'] }),
    makeEntry({ nodeRef: 'App.tsx:1', parentRef: 'App.tsx:0' }),
    makeEntry({ nodeRef: 'App.tsx:2', parentRef: 'App.tsx:0' }),
    makeEntry({ nodeRef: 'App.tsx:3', parentRef: 'App.tsx:0' }),
  ]);

  it('finds next sibling', () => {
    expect(findSiblingNodeRef('App.tsx:1', 'next', lookup)).toBe('App.tsx:2');
  });

  it('finds previous sibling', () => {
    expect(findSiblingNodeRef('App.tsx:3', 'prev', lookup)).toBe('App.tsx:2');
  });

  it('wraps around: last to first', () => {
    expect(findSiblingNodeRef('App.tsx:3', 'next', lookup)).toBe('App.tsx:1');
  });

  it('wraps around: first to last', () => {
    expect(findSiblingNodeRef('App.tsx:1', 'prev', lookup)).toBe('App.tsx:3');
  });

  it('returns null when entry has no parent', () => {
    expect(findSiblingNodeRef('App.tsx:0', 'next', lookup)).toBeNull();
  });

  it('returns null when nodeRef not found', () => {
    expect(findSiblingNodeRef('nonexistent', 'next', lookup)).toBeNull();
  });

  it('returns null when nodeRef not in parent children list', () => {
    const brokenLookup = createLookup([
      makeEntry({ nodeRef: 'App.tsx:0', children: ['App.tsx:2'] }),
      makeEntry({ nodeRef: 'App.tsx:1', parentRef: 'App.tsx:0' }),
    ]);

    expect(findSiblingNodeRef('App.tsx:1', 'next', brokenLookup)).toBeNull();
  });
});

// ============================================================================
// createDesignKeydownHandler — Shift+Enter and Enter integration
// ============================================================================

function makeKeyEvent(key: string, opts: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
}

describe('createDesignKeydownHandler — Shift+Enter (select parent)', () => {
  const parentRef = 'App.tsx:1:0';
  const childRef = 'App.tsx:5:4';

  const lookup = createLookup([
    makeEntry({ nodeRef: parentRef, loc: { fileName: 'App.tsx', line: 1, column: 0 }, children: [childRef] }),
    makeEntry({ nodeRef: childRef, loc: { fileName: 'App.tsx', line: 5, column: 4 }, parentRef }),
  ]);

  it('calls onSelectElement with parentRef when Shift+Enter pressed on child', async () => {
    const onSelectElement = mock(() => {});
    const onClearSelection = mock(() => {});

    const { handler, dispose } = createDesignKeydownHandler({
      getState: () => ({ selectedIds: [childRef] }),
      getDocument: () => document,
      callbacks: {
        onSelectElement,
        onSelectMultiple: mock(() => {}),
        onClearSelection,
        onDeleteElements: mock(() => {}),
      },
      isDesignMode: () => true,
      nodeMapLookup: lookup,
    });

    const consumed = handler(makeKeyEvent('Enter', { shiftKey: true }));
    expect(consumed).toBe(true);

    // wait for 150ms debounce
    await new Promise((r) => setTimeout(r, 200));

    expect(onSelectElement).toHaveBeenCalledWith(parentRef, undefined);
    expect(onClearSelection).not.toHaveBeenCalled();
    dispose();
  });

  it('passes child itemIndex to onSelectElement when selectedItemIndices is in state', async () => {
    const onSelectElement = mock(() => {});
    const onClearSelection = mock(() => {});

    const { handler, dispose } = createDesignKeydownHandler({
      getState: () => ({ selectedIds: [childRef], selectedItemIndices: { [childRef]: 3 } }),
      getDocument: () => document,
      callbacks: {
        onSelectElement,
        onSelectMultiple: mock(() => {}),
        onClearSelection,
        onDeleteElements: mock(() => {}),
      },
      isDesignMode: () => true,
      nodeMapLookup: lookup,
    });

    handler(makeKeyEvent('Enter', { shiftKey: true }));
    await new Promise((r) => setTimeout(r, 200));

    // Parent must receive same row index (3) as the child — pins the rect to the correct instance
    expect(onSelectElement).toHaveBeenCalledWith(parentRef, 3);
    dispose();
  });

  it('calls onClearSelection when Shift+Enter pressed on element with no parent', async () => {
    const onSelectElement = mock(() => {});
    const onClearSelection = mock(() => {});

    const { handler, dispose } = createDesignKeydownHandler({
      getState: () => ({ selectedIds: [parentRef] }),
      getDocument: () => document,
      callbacks: {
        onSelectElement,
        onSelectMultiple: mock(() => {}),
        onClearSelection,
        onDeleteElements: mock(() => {}),
      },
      isDesignMode: () => true,
      nodeMapLookup: lookup,
    });

    handler(makeKeyEvent('Enter', { shiftKey: true }));
    await new Promise((r) => setTimeout(r, 200));

    expect(onSelectElement).not.toHaveBeenCalled();
    expect(onClearSelection).toHaveBeenCalled();
    dispose();
  });
});

describe('createDesignKeydownHandler — Enter (select children)', () => {
  const parentRef = 'App.tsx:1:0';
  const child1Ref = 'App.tsx:5:4';
  const child2Ref = 'App.tsx:6:4';

  const lookup = createLookup([
    makeEntry({ nodeRef: parentRef, children: [child1Ref, child2Ref] }),
    makeEntry({ nodeRef: child1Ref, parentRef }),
    makeEntry({ nodeRef: child2Ref, parentRef }),
  ]);

  it('calls onSelectMultiple with children when Enter pressed', async () => {
    const onSelectMultiple = mock(() => {});

    const { handler, dispose } = createDesignKeydownHandler({
      getState: () => ({ selectedIds: [parentRef] }),
      getDocument: () => document,
      callbacks: {
        onSelectElement: mock(() => {}),
        onSelectMultiple,
        onClearSelection: mock(() => {}),
        onDeleteElements: mock(() => {}),
      },
      isDesignMode: () => true,
      nodeMapLookup: lookup,
    });

    handler(makeKeyEvent('Enter', { shiftKey: false }));
    await new Promise((r) => setTimeout(r, 200));

    expect(onSelectMultiple).toHaveBeenCalledWith([child1Ref, child2Ref]);
    dispose();
  });
});
