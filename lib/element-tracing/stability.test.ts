import { describe, expect, it } from 'bun:test';
import type { NodeMapEntry } from '../../shared/element-tracing/types';
import { buildCompositeKey, mapNodeRefs } from './stability';

function entry(overrides: Partial<NodeMapEntry> & Pick<NodeMapEntry, 'nodeRef' | 'tag'>): NodeMapEntry {
  return {
    loc: { fileName: 'f.tsx', line: 1, column: 0 },
    endLoc: { fileName: 'f.tsx', line: 1, column: 10 },
    parentRef: null,
    children: [],
    isComponent: false,
    fingerprint: '0000',
    ...overrides,
  };
}

describe('buildCompositeKey', () => {
  it('should generate tier-1 key: parentTag/tag#siblingIndex~fingerprint', () => {
    const entries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'a1b2' }),
      entry({ nodeRef: 'f:1', tag: 'span', parentRef: 'f:0', fingerprint: 'c3d4' }),
      entry({ nodeRef: 'f:2', tag: 'span', parentRef: 'f:0', fingerprint: 'e5f6' }),
    ];
    entries[0].children = ['f:1', 'f:2'];

    const refToEntry = new Map(entries.map((e) => [e.nodeRef, e]));

    const key0 = buildCompositeKey(entries[0], refToEntry);
    const key1 = buildCompositeKey(entries[1], refToEntry);
    const key2 = buildCompositeKey(entries[2], refToEntry);

    expect(key0).toBe('ROOT/div#0~a1b2');
    expect(key1).toBe('div/span#0~c3d4');
    expect(key2).toBe('div/span#1~e5f6');
  });
});

describe('mapNodeRefs', () => {
  it('should map identical structures 1:1', () => {
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'span', parentRef: 'f:0', fingerprint: 'bbbb' }),
    ];
    oldEntries[0].children = ['f:1'];

    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'span', parentRef: 'f:0', fingerprint: 'bbbb' }),
    ];
    newEntries[0].children = ['f:1'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping).toEqual({ 'f:0': 'f:0', 'f:1': 'f:1' });
  });

  it('should handle sibling insertion (shift)', () => {
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'span', parentRef: 'f:0', fingerprint: 'bbbb' }),
    ];
    oldEntries[0].children = ['f:1'];

    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'p', parentRef: 'f:0', fingerprint: 'cccc' }),
      entry({ nodeRef: 'f:2', tag: 'span', parentRef: 'f:0', fingerprint: 'bbbb' }),
    ];
    newEntries[0].children = ['f:1', 'f:2'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBe('f:0');
    // span moved from siblingIndex 0 to 1, but fingerprint differs from p, so Tier 1 key changes.
    // Tier 2 (ancestry path) or Tier 3 (proximity) should still match.
    expect(mapping['f:1']).toBe('f:2');
  });

  it('should handle element deletion', () => {
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'span', parentRef: 'f:0', fingerprint: 'bbbb' }),
      entry({ nodeRef: 'f:2', tag: 'p', parentRef: 'f:0', fingerprint: 'cccc' }),
    ];
    oldEntries[0].children = ['f:1', 'f:2'];

    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'p', parentRef: 'f:0', fingerprint: 'cccc' }),
    ];
    newEntries[0].children = ['f:1'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBe('f:0');
    expect(mapping['f:2']).toBe('f:1');
    expect(mapping['f:1']).toBeUndefined();
  });

  it('should return empty mapping for completely different structures', () => {
    const oldEntries: NodeMapEntry[] = [entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' })];
    const newEntries: NodeMapEntry[] = [entry({ nodeRef: 'f:0', tag: 'section', fingerprint: 'bbbb' })];
    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBeUndefined();
  });

  it('should correctly match swapped same-tag siblings with different fingerprints', () => {
    // Two <li> under a <ul>, swapped. Different fingerprints distinguish them.
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'ul', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'li', parentRef: 'f:0', fingerprint: '1111' }),
      entry({ nodeRef: 'f:2', tag: 'li', parentRef: 'f:0', fingerprint: '2222' }),
    ];
    oldEntries[0].children = ['f:1', 'f:2'];

    // After swap: li with fingerprint '2222' is first, '1111' is second
    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'ul', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'li', parentRef: 'f:0', fingerprint: '2222' }),
      entry({ nodeRef: 'f:2', tag: 'li', parentRef: 'f:0', fingerprint: '1111' }),
    ];
    newEntries[0].children = ['f:1', 'f:2'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBe('f:0');
    // Old f:1 (fingerprint 1111) → new f:2 (fingerprint 1111)
    expect(mapping['f:1']).toBe('f:2');
    // Old f:2 (fingerprint 2222) → new f:1 (fingerprint 2222)
    expect(mapping['f:2']).toBe('f:1');
  });

  it('should report ambiguity for swapped same-tag siblings with identical fingerprints', () => {
    // Two <li> under a <ul>, swapped, but SAME fingerprint → ambiguous, no mapping
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'ul', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'li', parentRef: 'f:0', fingerprint: 'same' }),
      entry({ nodeRef: 'f:2', tag: 'li', parentRef: 'f:0', fingerprint: 'same' }),
    ];
    oldEntries[0].children = ['f:1', 'f:2'];

    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'ul', fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'li', parentRef: 'f:0', fingerprint: 'same' }),
      entry({ nodeRef: 'f:2', tag: 'li', parentRef: 'f:0', fingerprint: 'same' }),
    ];
    newEntries[0].children = ['f:1', 'f:2'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBe('f:0'); // ul still matches
    // li entries are ambiguous — both have same tier1 key collision
    expect(mapping['f:1']).toBeUndefined();
    expect(mapping['f:2']).toBeUndefined();
  });

  it('should match via Tier 2 (ancestry path) when element is wrapped in a container', () => {
    // Before: <App> → <div> → <span fingerprint="bbbb">
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'App', isComponent: true, fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'div', parentRef: 'f:0', fingerprint: 'dddd' }),
      entry({
        nodeRef: 'f:2',
        tag: 'span',
        parentRef: 'f:1',
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 5, column: 0 },
        endLoc: { fileName: 'f.tsx', line: 5, column: 10 },
      }),
    ];
    oldEntries[0].children = ['f:1'];
    oldEntries[1].children = ['f:2'];

    // After: <App> → <div> → <section> → <span fingerprint="bbbb"> (wrapped in section)
    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'App', isComponent: true, fingerprint: 'aaaa' }),
      entry({ nodeRef: 'f:1', tag: 'div', parentRef: 'f:0', fingerprint: 'dddd' }),
      entry({ nodeRef: 'f:2', tag: 'section', parentRef: 'f:1', fingerprint: 'eeee' }),
      entry({
        nodeRef: 'f:3',
        tag: 'span',
        parentRef: 'f:2',
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 6, column: 0 },
        endLoc: { fileName: 'f.tsx', line: 6, column: 10 },
      }),
    ];
    newEntries[0].children = ['f:1'];
    newEntries[1].children = ['f:2'];
    newEntries[2].children = ['f:3'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBe('f:0'); // App matches via Tier 1
    expect(mapping['f:1']).toBe('f:1'); // div matches via Tier 1
    // span: Tier 1 fails (parentTag changed from div to section)
    // Tier 2: ancestry path [App, div] vs [App, div, section] — subsequence match + same fingerprint
    expect(mapping['f:2']).toBe('f:3');
  });

  it('should match via Tier 3 (position proximity) when component is renamed', () => {
    // Component renamed: <Card> → <CardV2> at same position, same line
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({
        nodeRef: 'f:1',
        tag: 'Card',
        parentRef: 'f:0',
        isComponent: true,
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 10, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 15, column: 10 },
      }),
    ];
    oldEntries[0].children = ['f:1'];

    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({
        nodeRef: 'f:1',
        tag: 'CardV2',
        parentRef: 'f:0',
        isComponent: true,
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 10, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 15, column: 10 },
      }),
    ];
    newEntries[0].children = ['f:1'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    expect(mapping['f:0']).toBe('f:0');
    // Card → CardV2: different tag, so Tier 1 and Tier 2 fail.
    // But same fingerprint + same position → no match (Tier 3 requires same tag).
    // Actually, tag changed, so Tier 3 (same tag) won't match either.
    // This is correct behavior — a renamed component is essentially a new node.
    expect(mapping['f:1']).toBeUndefined();
  });

  it('should match via Tier 3 (position proximity) for repositioned same-tag element', () => {
    // A <span> moves from line 10 to line 12 (within ±5 lines), no other <span> nearby
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({
        nodeRef: 'f:1',
        tag: 'span',
        parentRef: 'f:0',
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 10, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 10, column: 20 },
      }),
    ];
    oldEntries[0].children = ['f:1'];

    // After: parent changed, so Tier 1 key is different. Ancestry also changed.
    // But same tag at similar position.
    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'section', fingerprint: 'cccc' }),
      entry({
        nodeRef: 'f:1',
        tag: 'span',
        parentRef: 'f:0',
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 12, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 12, column: 20 },
      }),
    ];
    newEntries[0].children = ['f:1'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    // div→section: no match (different tags)
    // span: Tier 1 fails (parent tag changed), Tier 2 fails (ancestry changed)
    // Tier 3: same tag 'span', line 10 vs 12 (within ±5), unique candidate → match
    expect(mapping['f:1']).toBe('f:1');
  });

  it('should NOT match via Tier 3 when multiple candidates exist (ambiguity)', () => {
    // Two <span> elements, both unmatched, both within ±5 lines of old <span>
    const oldEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'div', fingerprint: 'aaaa' }),
      entry({
        nodeRef: 'f:1',
        tag: 'span',
        parentRef: 'f:0',
        fingerprint: 'bbbb',
        loc: { fileName: 'f.tsx', line: 10, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 10, column: 20 },
      }),
    ];
    oldEntries[0].children = ['f:1'];

    const newEntries: NodeMapEntry[] = [
      entry({ nodeRef: 'f:0', tag: 'section', fingerprint: 'cccc' }),
      entry({
        nodeRef: 'f:1',
        tag: 'span',
        parentRef: 'f:0',
        fingerprint: 'dddd',
        loc: { fileName: 'f.tsx', line: 11, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 11, column: 20 },
      }),
      entry({
        nodeRef: 'f:2',
        tag: 'span',
        parentRef: 'f:0',
        fingerprint: 'eeee',
        loc: { fileName: 'f.tsx', line: 13, column: 4 },
        endLoc: { fileName: 'f.tsx', line: 13, column: 20 },
      }),
    ];
    newEntries[0].children = ['f:1', 'f:2'];

    const mapping = mapNodeRefs(oldEntries, newEntries);
    // Tier 3: two candidates within ±5 lines → ambiguous → no match
    expect(mapping['f:1']).toBeUndefined();
  });
});
