/**
 * Tests for duplicate data-uniq-id detection in parseJSXElement
 */

import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import { type ParseContext, parseJSXElement } from './component-parser';

// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

function createTestAST(code: string) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
}

function findRootJSXElement(ast: ReturnType<typeof createTestAST>): import('@babel/types').JSXElement {
  let rootElement: import('@babel/types').JSXElement | null = null;

  traverse(ast, {
    JSXElement(path: { node: import('@babel/types').JSXElement; skip: () => void }) {
      if (!rootElement) {
        rootElement = path.node;
        path.skip();
      }
    },
  });

  if (!rootElement) throw new Error('No JSXElement found in code');
  return rootElement;
}

/** Parse a component and return its tree with dedup enabled */
function parseComponentWithDedup(code: string) {
  const ast = createTestAST(code);
  const ctx: ParseContext = { fileAST: ast, seenIds: new Set<string>() };
  const rootElement = findRootJSXElement(ast);
  return parseJSXElement(rootElement, undefined, undefined, undefined, ctx);
}

function collectIds(node: ReturnType<typeof parseJSXElement>): string[] {
  if (!node) return [];
  const ids: string[] = [node.id];
  for (const child of node.children) {
    ids.push(...collectIds(child));
  }
  return ids;
}

describe('duplicate data-uniq-id detection', () => {
  it('should keep first occurrence and regenerate duplicate', () => {
    const code = `
      <div data-uniq-id="aaa">
        <span data-uniq-id="bbb">One</span>
        <span data-uniq-id="bbb">Two</span>
      </div>
    `;

    const tree = parseComponentWithDedup(code);
    const ids = collectIds(tree);

    // First "bbb" should be kept
    expect(ids[1]).toBe('bbb');
    // Second "bbb" should be regenerated to something different
    expect(ids[2]).not.toBe('bbb');
    // All IDs should be unique
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should handle triple duplicates', () => {
    const code = `
      <div data-uniq-id="root">
        <span data-uniq-id="dup">A</span>
        <span data-uniq-id="dup">B</span>
        <span data-uniq-id="dup">C</span>
      </div>
    `;

    const tree = parseComponentWithDedup(code);
    const ids = collectIds(tree);

    // First keeps the original
    expect(ids[1]).toBe('dup');
    // Second and third are regenerated
    expect(ids[2]).not.toBe('dup');
    expect(ids[3]).not.toBe('dup');
    // All three regenerated IDs are different from each other
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should not affect elements with unique IDs', () => {
    const code = `
      <div data-uniq-id="aaa">
        <span data-uniq-id="bbb">One</span>
        <span data-uniq-id="ccc">Two</span>
      </div>
    `;

    const tree = parseComponentWithDedup(code);
    const ids = collectIds(tree);

    expect(ids).toEqual(['aaa', 'bbb', 'ccc']);
  });

  it('should track IDs across nested and sibling elements', () => {
    const code = `
      <div data-uniq-id="aaa">
        <div data-uniq-id="bbb">
          <span data-uniq-id="aaa">Deep duplicate of parent</span>
        </div>
      </div>
    `;

    const tree = parseComponentWithDedup(code);
    const ids = collectIds(tree);

    // Parent keeps "aaa"
    expect(ids[0]).toBe('aaa');
    // Nested child with same "aaa" gets regenerated
    expect(ids[2]).not.toBe('aaa');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should preserve original IDs for elements inside .map()', () => {
    const code = `
      <div data-uniq-id="root">
        {items.map((item) => (
          <span data-uniq-id="map-child" key={item}>{item}</span>
        ))}
      </div>
    `;

    const tree = parseComponentWithDedup(code);
    const ids = collectIds(tree);

    // root + map-child — all unique, map-child keeps original
    expect(ids[0]).toBe('root');
    expect(ids[1]).toBe('map-child');
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('should preserve original IDs for ternary children', () => {
    const code = `
      <div data-uniq-id="root">
        {flag ? <span data-uniq-id="yes">Yes</span> : <span data-uniq-id="no">No</span>}
      </div>
    `;

    const tree = parseComponentWithDedup(code);
    const ids = collectIds(tree);

    expect(ids).toEqual(['root', 'yes', 'no']);
  });

  it('should work without seenIds (backward compatibility)', () => {
    const code = `
      <div data-uniq-id="aaa">
        <span data-uniq-id="aaa">Duplicate</span>
      </div>
    `;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast }; // No seenIds
    const rootElement = findRootJSXElement(ast);

    // Should not throw — dedup is silently skipped
    const tree = parseJSXElement(rootElement, undefined, undefined, undefined, ctx);
    const ids = collectIds(tree);

    // Both keep "aaa" since dedup is not active
    expect(ids[0]).toBe('aaa');
    expect(ids[1]).toBe('aaa');
  });
});
