import { describe, expect, it } from 'bun:test';
import { buildElementSelector, findDirectChildIds, findParentWithUniqId, findSiblingId } from './keyboard-handler';

// Minimal DOM node mocks — no jsdom needed for these pure traversals

interface MockElement {
  dataset: Record<string, string | undefined>;
  parentElement: MockElement | null;
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  querySelectorAll?: (selector: string) => MockElement[];
}

function createElement(uniqId?: string, parent?: MockElement | null, children?: MockElement[]): MockElement {
  const el: MockElement = {
    dataset: uniqId ? { uniqId } : {},
    parentElement: parent ?? null,
  };
  el.querySelectorAll = (selector: string) => {
    if (selector === ':scope > [data-uniq-id]') {
      return (children ?? []).filter((c) => c.dataset.uniqId !== undefined);
    }
    return [];
  };
  return el;
}

describe('buildElementSelector', () => {
  it('builds selector with data-uniq-id only', () => {
    expect(buildElementSelector('abc123')).toBe('[data-uniq-id="abc123"]');
  });

  it('builds selector with data-uniq-id + data-instance-id', () => {
    expect(buildElementSelector('abc', 'inst-1')).toBe('[data-canvas-instance-id="inst-1"] [data-uniq-id="abc"]');
  });

  it('does not include instance prefix when instanceId is null', () => {
    expect(buildElementSelector('abc', null)).toBe('[data-uniq-id="abc"]');
  });
});

describe('findParentWithUniqId', () => {
  it('finds nearest parent with data-uniq-id', () => {
    const grandparent = createElement('gp-id');
    const parent = createElement('parent-id', grandparent);
    const child = createElement(undefined, parent);

    const result = findParentWithUniqId(child as unknown as Element);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('parent-id');
  });

  it('returns null when no parent has attribute', () => {
    const parent = createElement(undefined, null);
    const child = createElement(undefined, parent);

    const result = findParentWithUniqId(child as unknown as Element);
    expect(result).toBeNull();
  });

  it('skips elements without the attribute', () => {
    const root = createElement('root-id');
    const middle = createElement(undefined, root);
    const child = createElement(undefined, middle);

    const result = findParentWithUniqId(child as unknown as Element);
    expect(result).not.toBeNull();
    expect(result?.id).toBe('root-id');
  });
});

describe('findDirectChildIds', () => {
  it('collects direct children with data-uniq-id', () => {
    const c1 = createElement('c1');
    const c2 = createElement('c2');
    const parent = createElement('parent', null, [c1, c2]);

    const ids = findDirectChildIds(parent as unknown as Element);
    expect(ids).toEqual(['c1', 'c2']);
  });

  it('returns empty array when no children have id', () => {
    const c1 = createElement(undefined);
    const parent = createElement('parent', null, [c1]);

    const ids = findDirectChildIds(parent as unknown as Element);
    expect(ids).toEqual([]);
  });

  it('only includes direct children (not nested)', () => {
    // querySelectorAll(':scope > ...') already handles this
    createElement('nested'); // exists but not a direct child
    const c1 = createElement('c1');
    const parent = createElement('parent', null, [c1]);

    const ids = findDirectChildIds(parent as unknown as Element);
    expect(ids).toEqual(['c1']);
  });
});

describe('findSiblingId', () => {
  it('finds next sibling', () => {
    const c1 = createElement('c1');
    const c2 = createElement('c2');
    const c3 = createElement('c3');
    const parent = createElement('parent', null, [c1, c2, c3]);
    c1.parentElement = parent;
    c2.parentElement = parent;
    c3.parentElement = parent;

    const result = findSiblingId(c1 as unknown as Element, 'next');
    expect(result).toBe('c2');
  });

  it('finds previous sibling', () => {
    const c1 = createElement('c1');
    const c2 = createElement('c2');
    const parent = createElement('parent', null, [c1, c2]);
    c1.parentElement = parent;
    c2.parentElement = parent;

    const result = findSiblingId(c2 as unknown as Element, 'prev');
    expect(result).toBe('c1');
  });

  it('wraps around: last → first', () => {
    const c1 = createElement('c1');
    const c2 = createElement('c2');
    const parent = createElement('parent', null, [c1, c2]);
    c1.parentElement = parent;
    c2.parentElement = parent;

    const result = findSiblingId(c2 as unknown as Element, 'next');
    expect(result).toBe('c1');
  });

  it('wraps around: first → last', () => {
    const c1 = createElement('c1');
    const c2 = createElement('c2');
    const parent = createElement('parent', null, [c1, c2]);
    c1.parentElement = parent;
    c2.parentElement = parent;

    const result = findSiblingId(c1 as unknown as Element, 'prev');
    expect(result).toBe('c2');
  });

  it('returns null when no parent with uniq-id', () => {
    const child = createElement('child', null);

    const result = findSiblingId(child as unknown as Element, 'next');
    expect(result).toBeNull();
  });
});
