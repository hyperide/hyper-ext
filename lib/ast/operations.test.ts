/**
 * Tests for AST operations - high-level AST mutations
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import {
  duplicateElementInAST,
  extractElementSource,
  insertElementIntoAST,
  parseTSXElements,
  wrapElementInAST,
} from './operations';
import { parseCode, printAST } from './parser';
import { findAllJSXElements, findElementAtPosition } from './traverser';

describe('insertElementIntoAST', () => {
  it('should insert element into parent', () => {
    const code = `
const App = () => (
  <div>
    <span>A</span>
  </div>
);`;
    const ast = parseCode(code);
    const newElement = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('p'), [], true), null, [], true);

    // Find the root div as parent
    const parent = findElementAtPosition(ast, 3, 3);
    expect(parent).not.toBeNull();

    const result = insertElementIntoAST(ast, {
      parent,
      newElement,
    });

    expect(result.inserted).toBe(true);
  });

  it('should insert at root level when parent is null', () => {
    const code = `
const App = () => {
  return (
    <div>
      <span>A</span>
    </div>
  );
};`;
    const ast = parseCode(code);
    const newElement = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('footer'), [], true), null, [], true);

    const result = insertElementIntoAST(ast, {
      parent: null,
      newElement,
    });

    expect(result.inserted).toBe(true);
  });

  it('should insert at specific logical index', () => {
    const code = `
const App = () => (
  <div>
    <span>A</span>
    <span>B</span>
  </div>
);`;
    const ast = parseCode(code);
    const newElement = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('p'), [], true), null, [], true);

    // Find the root div as parent
    const parent = findElementAtPosition(ast, 3, 3);
    expect(parent).not.toBeNull();

    const result = insertElementIntoAST(ast, {
      parent,
      newElement,
      logicalIndex: 1,
    });

    expect(result.inserted).toBe(true);
    expect(result.actualIndex).toBe(1);
  });

  it('should return inserted=false when parent is not found and no return JSX', () => {
    const code = 'const x = 42;';
    const ast = parseCode(code);
    const newElement = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('p'), [], true), null, [], true);

    const result = insertElementIntoAST(ast, {
      parent: null,
      newElement,
    });

    expect(result.inserted).toBe(false);
  });
});

describe('duplicateElementInAST', () => {
  it('should duplicate element and insert after original', () => {
    const code = `
const App = () => (
  <div>
    <span>Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    // Find the span element
    const spanResult = findElementAtPosition(ast, 4, 5);
    expect(spanResult).not.toBeNull();

    const result = duplicateElementInAST(spanResult as NonNullable<typeof spanResult>);

    expect(result.inserted).toBe(true);

    // Should now have 2 span elements
    const allElements = findAllJSXElements(ast);
    const spans = allElements.filter((e) => {
      const name = e.element.openingElement.name;
      return t.isJSXIdentifier(name) && name.name === 'span';
    });
    expect(spans.length).toBe(2);
  });

  it('should return inserted=false when parent is not JSXElement (e.g. .map())', () => {
    const code = `
const App = () => (
  <div>
    {items.map(item => (
      <span key={item.id}>{item.name}</span>
    ))}
  </div>
);`;
    const ast = parseCode(code);

    // Find the span inside map — its parent is ArrowFunctionExpression, not JSXElement
    const spanResult = findElementAtPosition(ast, 5, 7);
    expect(spanResult).not.toBeNull();

    const result = duplicateElementInAST(spanResult as NonNullable<typeof spanResult>);

    expect(result.inserted).toBe(false);
  });
});

describe('wrapElementInAST', () => {
  it('should wrap element with a new parent', () => {
    const code = `
const App = () => (
  <div>
    <span>Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    // Find the span element
    const spanResult = findElementAtPosition(ast, 4, 5);
    expect(spanResult).not.toBeNull();

    const result = wrapElementInAST(spanResult as NonNullable<typeof spanResult>, 'section');

    expect(result.wrapped).toBe(true);

    const output = printAST(ast);
    expect(output).toContain('<section>');
    expect(output).toContain('<span>');
  });

  it('should add wrapper props', () => {
    const code = `
const App = () => (
  <div>
    <span>Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const spanResult = findElementAtPosition(ast, 4, 5);
    expect(spanResult).not.toBeNull();

    const result = wrapElementInAST(spanResult as NonNullable<typeof spanResult>, 'div', { className: 'wrapper' });

    expect(result.wrapped).toBe(true);
    const output = printAST(ast);
    expect(output).toContain("className='wrapper'");
  });
});

describe('parseTSXElements', () => {
  it('should parse JSX elements from TSX code string', () => {
    const result = parseTSXElements('<div>Hello</div>');

    expect(result.elements.length).toBe(1);
  });

  it('should parse multiple elements', () => {
    const result = parseTSXElements('<span>A</span><p>B</p>');

    expect(result.elements.length).toBe(2);
  });

  it('should return empty array for empty code', () => {
    const result = parseTSXElements('');

    expect(result.elements.length).toBe(0);
  });
});

describe('extractElementSource', () => {
  it('should extract source code of an element', () => {
    const code = `const App = () => (
  <div>
    <span>Hello World</span>
  </div>
);`;
    const ast = parseCode(code);
    const spanResult = findElementAtPosition(ast, 3, 5);
    expect(spanResult).not.toBeNull();

    const source = extractElementSource(code, spanResult?.element);

    expect(source).not.toBeNull();
    expect(source).toContain('<span');
    expect(source).toContain('Hello World');
    expect(source).toContain('</span>');
  });

  it('should return null when element has no location', () => {
    // Create an element without loc
    const element = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('div'), [], true), null, [], true);

    const source = extractElementSource('some code', element);
    expect(source).toBeNull();
  });
});
