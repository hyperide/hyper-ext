/**
 * Tests for component-parser: dedup, function/component lookup, JSX parsing
 */

import { describe, expect, it } from 'bun:test';
import type { JSXElement } from '@babel/types';
import { parse } from '@babel/parser';
import _traverse from '@babel/traverse';
import {
  findLocalComponentDefinition,
  findLocalFunctionDefinition,
  type ParseContext,
  parseJSXElement,
} from './component-parser';

const traverse = (_traverse as unknown as { default: typeof _traverse }).default || _traverse;

function createTestAST(code: string) {
  return parse(code, {
    sourceType: 'module',
    plugins: ['typescript', 'jsx'],
  });
}

function findRootJSXElement(ast: ReturnType<typeof createTestAST>): JSXElement {
  let rootElement: JSXElement | null = null;

  traverse(ast, {
    JSXElement(path: { node: JSXElement; skip: () => void }) {
      if (!rootElement) {
        rootElement = path.node;
        path.skip();
      }
    },
  });

  if (!rootElement) throw new Error('No JSXElement found in code');
  return rootElement;
}

/** Parse a component and return its tree */
function parseComponent(code: string) {
  const ast = createTestAST(code);
  const ctx: ParseContext = { fileAST: ast };
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

describe('generated IDs', () => {
  it('should generate unique IDs for all elements', () => {
    const code = `
      <div>
        <span>One</span>
        <span>Two</span>
      </div>
    `;

    const tree = parseComponent(code);
    const ids = collectIds(tree);

    // All IDs should be unique UUIDs
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(ids.length);
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
    const ctx: ParseContext = { fileAST: ast };
    const rootElement = findRootJSXElement(ast);
    return parseJSXElement(rootElement, undefined, undefined, undefined, ctx);
  }

  it('parses simple element with props', () => {
    const tree = parseCode('<div className="red" disabled />');
    expect(tree).not.toBeNull();
    expect(tree?.type).toBe('div');
    expect(tree?.props.className).toBe('red');
    expect(tree?.props.disabled).toBe(true);
  });

  it('parses element with children', () => {
    const tree = parseCode(`
      <div>
        <span>Hello</span>
      </div>
    `);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].type).toBe('span');
  });

  it('handles .map() context (marks as list)', () => {
    const tree = parseCode(`
      <ul>
        {items.map(item => <li key={item}>{item}</li>)}
      </ul>
    `);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].mapItem).toBeDefined();
    expect(tree?.children[0].mapItem?.expression).toBe('items');
  });

  it('handles ternary conditionals', () => {
    const tree = parseCode(`
      <div>
        {isOpen ? <span>Open</span> : <span>Closed</span>}
      </div>
    `);
    expect(tree?.children).toHaveLength(2);
    expect(tree?.children[0].condItem?.branch).toBe('then');
    expect(tree?.children[1].condItem?.branch).toBe('else');
  });

  it('handles logical && expressions', () => {
    const tree = parseCode(`
      <div>
        {isVisible && <span>Visible</span>}
      </div>
    `);
    expect(tree?.children).toHaveLength(1);
    expect(tree?.children[0].condItem?.type).toBe('if-then');
  });

  it('extracts text content from JSXText children', () => {
    const tree = parseCode('<p>Hello world</p>');
    expect(tree?.props.children).toBe('Hello world');
  });

  it('extracts string literal props', () => {
    const tree = parseCode('<input type="text" placeholder="Enter..." />');
    expect(tree?.props.type).toBe('text');
    expect(tree?.props.placeholder).toBe('Enter...');
  });

  it('extracts numeric props', () => {
    const tree = parseCode('<input tabIndex={5} />');
    expect(tree?.props.tabIndex).toBe(5);
  });

  it('extracts boolean literal props', () => {
    const tree = parseCode('<input readOnly={false} />');
    expect(tree?.props.readOnly).toBe(false);
  });

  it('skips technical props (key, ref)', () => {
    const tree = parseCode('<div key="k" ref={myRef} className="c" />');
    expect(tree?.props.key).toBeUndefined();
    expect(tree?.props.ref).toBeUndefined();
    expect(tree?.props.className).toBe('c');
  });

  it('handles JSXMemberExpression (e.g. Dropdown.Item)', () => {
    const tree = parseCode('<Dropdown.Item>Choice</Dropdown.Item>');
    expect(tree?.type).toBe('Dropdown.Item');
  });
});
