import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import type * as t from '@babel/types';
import { buildNodeMap } from './node-map-builder';

function parseJSX(code: string): t.File {
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
}

describe('buildNodeMap', () => {
  it('should build entries for simple JSX', () => {
    const ast = parseJSX(`const App = () => <div><span>hello</span></div>;`);
    const entries = buildNodeMap(ast, 'src/App.tsx');
    expect(entries.length).toBe(2);
    expect(entries[0].tag).toBe('div');
    expect(entries[0].loc.fileName).toBe('src/App.tsx');
    expect(entries[0].loc.line).toBeGreaterThan(0);
    expect(entries[0].isComponent).toBe(false);
    expect(entries[0].children.length).toBe(1);
    expect(entries[0].parentRef).toBeNull();
    expect(entries[1].tag).toBe('span');
    expect(entries[1].parentRef).toBe(entries[0].nodeRef);
    expect(entries[1].children.length).toBe(0);
  });

  it('should detect component elements (uppercase tag)', () => {
    const ast = parseJSX(`const Page = () => <div><Card title="x" /><Button /></div>;`);
    const entries = buildNodeMap(ast, 'src/Page.tsx');
    const card = entries.find((e) => e.tag === 'Card');
    const button = entries.find((e) => e.tag === 'Button');
    expect(card).toBeDefined();
    expect(card?.isComponent).toBe(true);
    expect(card?.componentName).toBe('Card');
    expect(button).toBeDefined();
    expect(button?.isComponent).toBe(true);
  });

  it('should handle nested components', () => {
    const ast = parseJSX(`
      const App = () => (
        <Layout>
          <Header />
          <main>
            <Card />
          </main>
        </Layout>
      );
    `);
    const entries = buildNodeMap(ast, 'src/App.tsx');
    const layout = entries.find((e) => e.tag === 'Layout');
    const main = entries.find((e) => e.tag === 'main');
    expect(layout).toBeDefined();
    expect(layout?.children.length).toBe(2);
    expect(main).toBeDefined();
    expect(main?.parentRef).toBe(layout?.nodeRef);
    expect(main?.children.length).toBe(1);
  });

  it('should generate stable nodeRef format', () => {
    const ast = parseJSX(`const A = () => <div><span /></div>;`);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    for (const entry of entries) {
      expect(entry.nodeRef).toMatch(/^src\/A\.tsx:\d+$/);
    }
  });

  it('should set endLoc correctly', () => {
    const ast = parseJSX(`const A = () => <div>text</div>;`);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    expect(entries[0].endLoc.line).toBeGreaterThanOrEqual(entries[0].loc.line);
  });

  it('should handle JSX member expressions (Dialog.Portal)', () => {
    const ast = parseJSX(`const A = () => <Dialog.Portal><div /></Dialog.Portal>;`);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    expect(entries[0].tag).toBe('Dialog.Portal');
    expect(entries[0].isComponent).toBe(true);
    expect(entries[0].componentName).toBe('Dialog.Portal');
  });

  it('should handle fragments', () => {
    const ast = parseJSX(`const A = () => <><div /><span /></>;`);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    const fragment = entries.find((e) => e.tag === 'Fragment');
    expect(fragment).toBeDefined();
    expect(fragment?.children.length).toBe(2);
  });

  it('should handle empty file (no JSX)', () => {
    const ast = parseJSX(`const x = 42;`);
    const entries = buildNodeMap(ast, 'src/utils.ts');
    expect(entries.length).toBe(0);
  });

  it('should handle conditional JSX (ternary)', () => {
    const ast = parseJSX(`const A = () => condition ? <div /> : <span />;`);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    expect(entries.find((e) => e.tag === 'div')).toBeDefined();
    expect(entries.find((e) => e.tag === 'span')).toBeDefined();
  });

  it('should handle .map() JSX', () => {
    const ast = parseJSX(`
      const A = () => (
        <ul>
          {items.map(item => <li key={item.id}>{item.name}</li>)}
        </ul>
      );
    `);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    const ul = entries.find((e) => e.tag === 'ul');
    const li = entries.find((e) => e.tag === 'li');
    expect(ul).toBeDefined();
    expect(li).toBeDefined();
  });

  it('should set fingerprint field on all entries', () => {
    const ast = parseJSX(`const App = () => <div className="x"><span id="y">hello</span></div>;`);
    const entries = buildNodeMap(ast, 'src/App.tsx');
    for (const e of entries) {
      expect(e.fingerprint).toBeDefined();
      expect(typeof e.fingerprint).toBe('string');
      expect(e.fingerprint.length).toBeGreaterThanOrEqual(4);
    }
  });

  it('should produce different fingerprints for elements with different attributes', () => {
    const ast = parseJSX(`
      const A = () => (
        <div>
          <span className="a" id="x" />
          <span title="b" />
        </div>
      );
    `);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    const spans = entries.filter((e) => e.tag === 'span');
    expect(spans.length).toBe(2);
    expect(spans[0].fingerprint).not.toBe(spans[1].fingerprint);
  });

  it('should produce same fingerprint for elements with same attribute names regardless of values', () => {
    const ast = parseJSX(`
      const A = () => (
        <div>
          <span className="a" />
          <span className="b" />
        </div>
      );
    `);
    const entries = buildNodeMap(ast, 'src/A.tsx');
    const spans = entries.filter((e) => e.tag === 'span');
    expect(spans.length).toBe(2);
    // Same attribute names, same children count (0), same subtree height (0) → same fingerprint
    expect(spans[0].fingerprint).toBe(spans[1].fingerprint);
  });
});
