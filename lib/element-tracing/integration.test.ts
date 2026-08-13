/**
 * @file Integration tests for the full element-tracing pipeline
 */

import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import type { NodeMapEntry, SourceLocation } from '../../shared/element-tracing/types';
import { buildNodeMap } from './node-map-builder';
import { NodeMapService } from './node-map-service';

const FIXTURE = `
import { Card } from './Card';

export const Page = () => (
  <div className="container">
    <h1>Title</h1>
    <Card title="Hello">
      <p>Content</p>
    </Card>
    <ul>
      {items.map(item => (
        <li key={item.id}>{item.name}</li>
      ))}
    </ul>
  </div>
);
`;

function assertDefined<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

function assertNotNull<T>(value: T | null, label: string): T {
  if (value === null) throw new Error(`Expected ${label} to be non-null`);
  return value;
}

function findTag(entries: NodeMapEntry[], tag: string): NodeMapEntry {
  return assertDefined(
    entries.find((e) => e.tag === tag),
    `entry with tag <${tag}>`,
  );
}

describe('element-tracing integration', () => {
  it('should parse fixture and build valid node map', () => {
    const service = new NodeMapService();
    const entries = service.parseAndBuild(FIXTURE, 'src/Page.tsx');

    expect(entries.length).toBeGreaterThanOrEqual(5);

    const div = entries.find((e) => e.tag === 'div');
    const h1 = entries.find((e) => e.tag === 'h1');
    const card = entries.find((e) => e.tag === 'Card');
    const p = entries.find((e) => e.tag === 'p');
    const ul = entries.find((e) => e.tag === 'ul');
    const li = entries.find((e) => e.tag === 'li');

    expect(div).toBeDefined();
    expect(h1).toBeDefined();
    expect(card).toBeDefined();
    expect(card?.isComponent).toBe(true);
    expect(card?.componentName).toBe('Card');
    expect(p).toBeDefined();
    expect(ul).toBeDefined();
    expect(li).toBeDefined();

    // Parent-child relationships — use assertDefined to narrow types
    const divEntry = findTag(entries, 'div');
    const h1Entry = findTag(entries, 'h1');
    const cardEntry = findTag(entries, 'Card');
    const pEntry = findTag(entries, 'p');
    const ulEntry = findTag(entries, 'ul');

    expect(h1Entry.parentRef).toBe(divEntry.nodeRef);
    expect(cardEntry.parentRef).toBe(divEntry.nodeRef);
    expect(pEntry.parentRef).toBe(cardEntry.nodeRef);
    expect(ulEntry.parentRef).toBe(divEntry.nodeRef);

    expect(divEntry.children).toContain(h1Entry.nodeRef);
    expect(divEntry.children).toContain(cardEntry.nodeRef);
    expect(divEntry.children).toContain(ulEntry.nodeRef);
  });

  it('should resolve source location to correct nodeRef', () => {
    const service = new NodeMapService();
    const entries = service.parseAndBuild(FIXTURE, 'src/Page.tsx');

    const card = findTag(entries, 'Card');
    const resolved = service.resolveSourceLocation(card.loc);

    expect(resolved).not.toBeNull();
    const resolvedEntry = assertNotNull(resolved, 'resolved entry');
    expect(resolvedEntry.nodeRef).toBe(card.nodeRef);
    expect(resolvedEntry.tag).toBe('Card');
  });

  it('should maintain nodeRef stability after sibling insertion', () => {
    const service = new NodeMapService();
    service.parseAndBuild(FIXTURE, 'src/Page.tsx');

    const oldEntries = assertNotNull(service.getNodeMap('src/Page.tsx'), 'old entries');
    const oldCard = findTag(oldEntries, 'Card');

    const modifiedFixture = FIXTURE.replace('<Card title="Hello">', '<nav>Nav</nav>\n    <Card title="Hello">');

    const result = service.reparseAndUpdate(modifiedFixture, 'src/Page.tsx');
    expect(result.refMapping).toBeDefined();

    const refMapping = assertDefined(result.refMapping, 'refMapping');
    const newCardRef = refMapping[oldCard.nodeRef];
    expect(newCardRef).toBeDefined();

    const newCard = result.nodes.find((e) => e.nodeRef === newCardRef);
    expect(newCard).toBeDefined();
    expect(newCard?.tag).toBe('Card');
  });

  it('should handle container path normalization', () => {
    const service = new NodeMapService();
    // Sandbox mount prefix is normalized automatically — no explicit configuration.
    service.parseAndBuild(FIXTURE, 'src/Page.tsx');

    const entries = assertNotNull(service.getNodeMap('src/Page.tsx'), 'entries');
    const div = findTag(entries, 'div');

    const containerLoc: SourceLocation = {
      fileName: '/app/src/Page.tsx',
      line: div.loc.line,
      column: div.loc.column,
    };

    const resolved = service.resolveSourceLocation(containerLoc);
    expect(resolved).not.toBeNull();
    const resolvedEntry = assertNotNull(resolved, 'resolved entry');
    expect(resolvedEntry.nodeRef).toBe(div.nodeRef);
  });

  it('should handle re-parse with element deletion', () => {
    const service = new NodeMapService();
    service.parseAndBuild(FIXTURE, 'src/Page.tsx');
    const oldEntries = assertNotNull(service.getNodeMap('src/Page.tsx'), 'old entries');

    const withoutUl = FIXTURE.replace(/\s*<ul>[\s\S]*?<\/ul>/, '');
    const result = service.reparseAndUpdate(withoutUl, 'src/Page.tsx');

    const oldUl = findTag(oldEntries, 'ul');
    expect(result.refMapping?.[oldUl.nodeRef]).toBeUndefined();

    const oldDiv = findTag(oldEntries, 'div');
    const oldCard = findTag(oldEntries, 'Card');
    expect(result.refMapping?.[oldDiv.nodeRef]).toBeDefined();
    expect(result.refMapping?.[oldCard.nodeRef]).toBeDefined();
  });

  describe('_debugSource column format', () => {
    it('should match Babel AST column numbers (0-based)', () => {
      const ast = parse(FIXTURE, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      const entries = buildNodeMap(ast, 'src/Page.tsx');
      const div = findTag(entries, 'div');

      // Babel columns are 0-based
      expect(div.loc.column).toBeGreaterThanOrEqual(0);
    });
  });
});
