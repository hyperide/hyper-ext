import { describe, expect, it } from 'bun:test';
import type { NodeMapEntry } from '../element-tracing/types';
import { findDirectChildNodeRefs, findParentNodeRef, findSiblingNodeRef, type NodeMapLookup } from './keyboard-handler';

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
