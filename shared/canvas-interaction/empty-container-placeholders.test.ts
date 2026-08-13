import { describe, expect, it } from 'bun:test';
import { getEmptyContainerRects } from './empty-container-placeholders';

/**
 * Tests for getEmptyContainerRects() — pure query function that finds
 * empty [data-uniq-id] containers and returns their bounding rects.
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

  getAttribute(name: string): string | null {
    return this._attrs[name] ?? null;
  }

  getBoundingClientRect() {
    return { ...this._rect };
  }

  querySelectorAll(selector: string): MockElement[] {
    const results: MockElement[] = [];
    const walk = (node: MockElement) => {
      for (const c of node._children) {
        if (!(c instanceof MockElement)) continue;
        if (selector === '[data-uniq-id]' && 'data-uniq-id' in c._attrs) {
          results.push(c);
        }
        walk(c);
      }
    };
    walk(this);
    return results;
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
  // biome-ignore lint/suspicious/noExplicitAny: test mock
  return { body } as any as Document;
}

describe('getEmptyContainerRects', () => {
  it('returns rect for empty div[data-uniq-id]', () => {
    const container = mkEl('div', { 'data-uniq-id': 'abc123' }, [], {
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(1);
    expect(rects[0]).toEqual({
      elementId: 'abc123',
      left: 10,
      top: 20,
      width: 200,
      height: 100,
    });
  });

  it('does not return rect for container with element children', () => {
    const child = mkEl('span');
    const container = mkEl('div', { 'data-uniq-id': 'abc123' }, [child]);
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(0);
  });

  it('treats whitespace-only text nodes as empty', () => {
    const ws = new MockTextNode('   \n  ');
    const container = mkEl('div', { 'data-uniq-id': 'abc123' }, [ws], {
      left: 5,
      top: 5,
      width: 50,
      height: 30,
    });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(1);
    expect(rects[0].elementId).toBe('abc123');
  });

  it('does not treat non-empty text as empty', () => {
    const text = new MockTextNode('Hello');
    const container = mkEl('div', { 'data-uniq-id': 'abc123' }, [text]);
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(0);
  });

  it('returns [] when doc.body is null', () => {
    // biome-ignore lint/suspicious/noExplicitAny: test mock
    const doc = { body: null } as any as Document;

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(0);
  });

  it('returns rects for multiple empty containers', () => {
    const c1 = mkEl('div', { 'data-uniq-id': 'id-1' }, [], { left: 0, top: 0, width: 100, height: 50 });
    const c2 = mkEl('div', { 'data-uniq-id': 'id-2' }, [], { left: 0, top: 60, width: 100, height: 50 });
    const nonEmpty = mkEl('div', { 'data-uniq-id': 'id-3' }, [mkEl('p')]);
    const doc = createDoc([c1, c2, nonEmpty]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(2);
    expect(rects.map((r) => r.elementId)).toEqual(['id-1', 'id-2']);
  });

  it('skips containers without data-uniq-id value', () => {
    const container = mkEl('div', { 'data-uniq-id': '' });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(0);
  });

  it('returns rect for empty non-div elements (section, main, etc.)', () => {
    const section = mkEl('section', { 'data-uniq-id': 'sec1' }, [], {
      left: 0,
      top: 0,
      width: 300,
      height: 150,
    });
    const doc = createDoc([section]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(1);
    expect(rects[0].elementId).toBe('sec1');
  });

  it('enforces minimum height on collapsed containers (height 0) and centers vertically', () => {
    const container = mkEl('div', { 'data-uniq-id': 'c1' }, [], {
      left: 0,
      top: 100,
      width: 200,
      height: 0,
    });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects).toHaveLength(1);
    expect(rects[0].height).toBe(28);
    expect(rects[0].top).toBe(86); // 100 - 28/2 = centered around original top
    expect(rects[0].width).toBe(200);
  });

  it('enforces minimum height on tiny containers and centers vertically', () => {
    const container = mkEl('div', { 'data-uniq-id': 'c1' }, [], {
      left: 0,
      top: 50,
      width: 150,
      height: 10,
    });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects[0].height).toBe(28);
    expect(rects[0].top).toBe(41); // 50 - (28-10)/2 = centered around original center
  });

  it('preserves height and top when container is taller than minimum', () => {
    const container = mkEl('div', { 'data-uniq-id': 'c1' }, [], {
      left: 0,
      top: 20,
      width: 100,
      height: 40,
    });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects[0].height).toBe(40);
    expect(rects[0].top).toBe(20);
  });

  it('does not enforce minimum width on zero-width containers', () => {
    const container = mkEl('div', { 'data-uniq-id': 'c1' }, [], {
      left: 0,
      top: 0,
      width: 0,
      height: 50,
    });
    const doc = createDoc([container]);

    const rects = getEmptyContainerRects(doc);

    expect(rects[0].width).toBe(0);
  });
});
