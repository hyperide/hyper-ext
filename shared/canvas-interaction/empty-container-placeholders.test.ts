import { describe, expect, it } from 'bun:test';
import type { ComponentTreeNode, SourceLocation } from '../element-tracing/types';
import { getEmptyContainerRectsFromFiber, isContainerEmpty } from './empty-container-placeholders';

/**
 * Tests for isContainerEmpty() and getEmptyContainerRectsFromFiber() —
 * fiber-based empty container detection for overlay placeholders.
 */

// -- Minimal DOM mocks --

class MockTextNode {
  nodeType = 3;
  textContent: string;
  constructor(text: string) {
    this.textContent = text;
  }
}

type MockChild = MockElement | MockTextNode;

class MockElement {
  nodeType = 1;
  _tag: string;
  _attrs: Record<string, string>;
  _children: MockChild[] = [];
  _classes = new Set<string>();
  _rect: { left: number; top: number; width: number; height: number };

  constructor(tag: string, attrs: Record<string, string> = {}, rect = { left: 0, top: 0, width: 100, height: 50 }) {
    this._tag = tag;
    this._attrs = { ...attrs };
    this._rect = rect;
  }

  get classList() {
    return {
      add: (c: string) => this._classes.add(c),
      remove: (c: string) => this._classes.delete(c),
    };
  }

  get childNodes(): MockChild[] {
    return this._children;
  }

  get firstElementChild(): MockElement | null {
    return (this._children.find((c) => c instanceof MockElement) as MockElement) ?? null;
  }

  getAttribute(name: string): string | null {
    return this._attrs[name] ?? null;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }
}

function mkEl(
  tag: string,
  attrs: Record<string, string> = {},
  children: MockChild[] = [],
  rect?: { left: number; top: number; width: number; height: number },
): MockElement {
  const el = new MockElement(tag, attrs, rect);
  el._children = children;
  return el;
}

function createDoc(bodyChildren: MockChild[] = []) {
  const body = mkEl('body', {}, bodyChildren);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
  return { body } as any as Document;
}

describe('isContainerEmpty', () => {
  it('returns true for element with no children', () => {
    const el = mkEl('div');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    expect(isContainerEmpty(el as any)).toBe(true);
  });

  it('returns false for element with element children', () => {
    const el = mkEl('div', {}, [mkEl('span')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    expect(isContainerEmpty(el as any)).toBe(false);
  });

  it('returns true for element with whitespace-only text', () => {
    const el = mkEl('div', {}, [new MockTextNode('   \n  ')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    expect(isContainerEmpty(el as any)).toBe(true);
  });

  it('returns false for element with non-empty text', () => {
    const el = mkEl('div', {}, [new MockTextNode('Hello')]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock
    expect(isContainerEmpty(el as any)).toBe(false);
  });
});

// ============================================================================
// Fiber-based empty container detection
// ============================================================================

function createTreeNode(overrides: {
  name?: string;
  source?: SourceLocation | null;
  children?: ComponentTreeNode[];
  domElement?: MockElement | null;
  fiberTag?: number;
}): ComponentTreeNode {
  return {
    name: overrides.name ?? 'div',
    source: overrides.source ?? null,
    children: overrides.children ?? [],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test mock — MockElement duck-types HTMLElement
    domElement: (overrides.domElement ?? null) as any,
    fiberTag: overrides.fiberTag,
  };
}

function createMockAdapter(tree: ComponentTreeNode[]) {
  return {
    walkComponentTree: () => tree,
  };
}

function createNodeEntries(
  entries: Array<{ key: string; nodeRef: string; source: SourceLocation }>,
): Map<string, { nodeRef: string; source: SourceLocation }> {
  return new Map(entries.map((e) => [e.key, { nodeRef: e.nodeRef, source: e.source }]));
}

describe('getEmptyContainerRectsFromFiber', () => {
  it('returns rect for empty container found in fiber tree', () => {
    const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 4 };
    const emptyEl = mkEl('div', {}, [], { left: 10, top: 20, width: 200, height: 100 });

    const tree = [createTreeNode({ name: 'div', source, domElement: emptyEl })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([{ key: 'App.tsx:5:4', nodeRef: 'App.tsx:0', source }]);

    const doc = createDoc([emptyEl]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({
      nodeRef: 'App.tsx:0',
      source,
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    });
  });

  it('skips containers with element children', () => {
    const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 4 };
    const child = mkEl('span');
    const container = mkEl('div', {}, [child]);

    const tree = [createTreeNode({ name: 'div', source, domElement: container })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([{ key: 'App.tsx:5:4', nodeRef: 'App.tsx:0', source }]);

    const doc = createDoc([container]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(0);
  });

  it('skips nodes without source location', () => {
    const emptyEl = mkEl('div', {}, [], { left: 0, top: 0, width: 100, height: 50 });

    const tree = [createTreeNode({ name: 'div', source: null, domElement: emptyEl })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([]);

    const doc = createDoc([emptyEl]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(0);
  });

  it('skips nodes without matching entry in nodeEntries', () => {
    const source: SourceLocation = { fileName: 'App.tsx', line: 5, column: 4 };
    const emptyEl = mkEl('div');

    const tree = [createTreeNode({ name: 'div', source, domElement: emptyEl })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([]); // No matching entry

    const doc = createDoc([emptyEl]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(0);
  });

  it('walks nested tree nodes', () => {
    const source1: SourceLocation = { fileName: 'App.tsx', line: 3, column: 2 };
    const source2: SourceLocation = { fileName: 'App.tsx', line: 7, column: 6 };

    const parentEl = mkEl('div', {}, [mkEl('span')]); // Not empty
    const childEl = mkEl('section', {}, [], { left: 5, top: 10, width: 80, height: 40 });

    const tree = [
      createTreeNode({
        name: 'div',
        source: source1,
        domElement: parentEl,
        children: [createTreeNode({ name: 'section', source: source2, domElement: childEl })],
      }),
    ];

    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([
      { key: 'App.tsx:3:2', nodeRef: 'App.tsx:0', source: source1 },
      { key: 'App.tsx:7:6', nodeRef: 'App.tsx:1', source: source2 },
    ]);

    const doc = createDoc([parentEl]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    // Only the nested empty child, not the non-empty parent
    expect(rects).toHaveLength(1);
    expect(rects[0].nodeRef).toBe('App.tsx:1');
  });

  it('enforces minimum height on collapsed containers', () => {
    const source: SourceLocation = { fileName: 'App.tsx', line: 1, column: 0 };
    const emptyEl = mkEl('div', {}, [], { left: 0, top: 100, width: 200, height: 0 });

    const tree = [createTreeNode({ name: 'div', source, domElement: emptyEl })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([{ key: 'App.tsx:1:0', nodeRef: 'App.tsx:0', source }]);

    const doc = createDoc([emptyEl]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(1);
    expect(rects[0].height).toBe(28);
    expect(rects[0].top).toBe(86); // 100 - 28/2
  });

  it('returns empty array when doc.body has no children', () => {
    const adapter = createMockAdapter([]);
    const entries = createNodeEntries([]);

    const doc = createDoc([]);
    // body exists but firstElementChild is null
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(0);
  });

  it('skips nodes without domElement', () => {
    const source: SourceLocation = { fileName: 'App.tsx', line: 1, column: 0 };

    const tree = [createTreeNode({ name: 'MyComponent', source, domElement: null })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([{ key: 'App.tsx:1:0', nodeRef: 'App.tsx:0', source }]);

    const doc = createDoc([mkEl('div')]); // Has firstElementChild to pass guard
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(0);
  });

  it('treats whitespace-only text as empty (through isContainerEmpty)', () => {
    const source: SourceLocation = { fileName: 'App.tsx', line: 1, column: 0 };
    const ws = new MockTextNode('   \n  ');
    const emptyEl = mkEl('div', {}, [ws], { left: 0, top: 0, width: 100, height: 50 });

    const tree = [createTreeNode({ name: 'div', source, domElement: emptyEl })];
    const adapter = createMockAdapter(tree);
    const entries = createNodeEntries([{ key: 'App.tsx:1:0', nodeRef: 'App.tsx:0', source }]);

    const doc = createDoc([emptyEl]);
    const rects = getEmptyContainerRectsFromFiber(doc, adapter, entries);

    expect(rects).toHaveLength(1);
    expect(rects[0].nodeRef).toBe('App.tsx:0');
  });
});
