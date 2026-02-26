/**
 * Tests for component-parser: dedup, function/component lookup, JSX parsing
 */

import { describe, expect, it } from 'bun:test';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import {
  findLocalComponentDefinition,
  findLocalFunctionDefinition,
  type ParseContext,
  parseJSXElement,
} from './component-parser';

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

// ============================================
// findLocalFunctionDefinition
// ============================================

describe('findLocalFunctionDefinition', () => {
  it('finds arrow function declaration', () => {
    const code = `const renderItem = (item) => <div>{item}</div>;`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalFunctionDefinition(ctx, 'renderItem');
    expect(result).not.toBeNull();
    expect(result?.loc).toBeDefined();
  });

  it('finds regular function declaration', () => {
    const code = `function renderHeader() { return <h1>Title</h1>; }`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalFunctionDefinition(ctx, 'renderHeader');
    expect(result).not.toBeNull();
  });

  it('returns null when not found', () => {
    const code = `const x = 42;`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    expect(findLocalFunctionDefinition(ctx, 'renderItem')).toBeNull();
  });

  it('finds function expression', () => {
    const code = `const renderFooter = function() { return <footer />; };`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalFunctionDefinition(ctx, 'renderFooter');
    expect(result).not.toBeNull();
  });
});

// ============================================
// findLocalComponentDefinition
// ============================================

describe('findLocalComponentDefinition', () => {
  it('finds component with direct arrow function', () => {
    const code = `const Button = () => <button>Click</button>;`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalComponentDefinition(ctx, 'Button');
    expect(result).not.toBeNull();
  });

  it('finds component wrapped in forwardRef', () => {
    const code = `const Input = forwardRef((props, ref) => <input ref={ref} />);`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalComponentDefinition(ctx, 'Input');
    expect(result).not.toBeNull();
  });

  it('finds component wrapped in memo', () => {
    const code = `const Card = memo(() => <div className="card" />);`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalComponentDefinition(ctx, 'Card');
    expect(result).not.toBeNull();
  });

  it('returns null when not found', () => {
    const code = `const count = 0;`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    expect(findLocalComponentDefinition(ctx, 'MyComponent')).toBeNull();
  });

  it('finds function declaration component', () => {
    const code = `function Header() { return <header>Header</header>; }`;
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast };
    const result = findLocalComponentDefinition(ctx, 'Header');
    expect(result).not.toBeNull();
  });
});

// ============================================
// parseJSXElement — key cases
// ============================================

describe('parseJSXElement (key cases)', () => {
  function parseCode(code: string) {
    const ast = createTestAST(code);
    const ctx: ParseContext = { fileAST: ast, seenIds: new Set<string>() };
    const rootElement = findRootJSXElement(ast);
    return parseJSXElement(rootElement, undefined, undefined, undefined, ctx);
  }

  it('parses simple element with props', () => {
    const tree = parseCode('<div data-uniq-id="x" className="red" disabled />');
    expect(tree).not.toBeNull();
    expect(tree?.type).toBe('div');
    expect(tree?.props.className).toBe('red');
    expect(tree?.props.disabled).toBe(true);
  });

  it('parses element with children', () => {
    const tree = parseCode(`
      <div data-uniq-id="parent">
        <span data-uniq-id="child">Hello</span>
      </div>
    `);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].type).toBe('span');
  });

  it('handles .map() context (marks as list)', () => {
    const tree = parseCode(`
      <ul data-uniq-id="list">
        {items.map(item => <li data-uniq-id="item" key={item}>{item}</li>)}
      </ul>
    `);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].mapItem).toBeDefined();
    expect(tree?.children[0].mapItem?.expression).toBe('items');
  });

  it('handles ternary conditionals', () => {
    const tree = parseCode(`
      <div data-uniq-id="root">
        {isOpen ? <span data-uniq-id="yes">Open</span> : <span data-uniq-id="no">Closed</span>}
      </div>
    `);
    expect(tree?.children).toHaveLength(2);
    expect(tree?.children[0].condItem?.branch).toBe('then');
    expect(tree?.children[1].condItem?.branch).toBe('else');
  });

  it('handles logical && expressions', () => {
    const tree = parseCode(`
      <div data-uniq-id="root">
        {isVisible && <span data-uniq-id="shown">Visible</span>}
      </div>
    `);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].condItem?.type).toBe('if-then');
  });

  it('extracts text content from JSXText children', () => {
    const tree = parseCode('<p data-uniq-id="text">Hello world</p>');
    expect(tree?.props.children).toBe('Hello world');
  });

  it('extracts string literal props', () => {
    const tree = parseCode('<input data-uniq-id="inp" type="text" placeholder="Enter..." />');
    expect(tree?.props.type).toBe('text');
    expect(tree?.props.placeholder).toBe('Enter...');
  });

  it('extracts numeric props', () => {
    const tree = parseCode('<input data-uniq-id="inp" tabIndex={5} />');
    expect(tree?.props.tabIndex).toBe(5);
  });

  it('extracts boolean literal props', () => {
    const tree = parseCode('<input data-uniq-id="inp" readOnly={false} />');
    expect(tree?.props.readOnly).toBe(false);
  });

  it('skips technical props (key, ref, data-uniq-id)', () => {
    const tree = parseCode('<div data-uniq-id="x" key="k" ref={myRef} className="c" />');
    expect(tree?.props.key).toBeUndefined();
    expect(tree?.props.ref).toBeUndefined();
    expect(tree?.props['data-uniq-id']).toBeUndefined();
    expect(tree?.props.className).toBe('c');
  });

  it('handles JSXMemberExpression (e.g. Dropdown.Item)', () => {
    const tree = parseCode('<Dropdown.Item data-uniq-id="x">Choice</Dropdown.Item>');
    expect(tree?.type).toBe('Dropdown.Item');
  });
});
