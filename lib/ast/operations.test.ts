/**
 * Tests for AST operations - high-level AST mutations
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import {
  duplicateElementInAST,
  extractElementSource,
  findParentElementId,
  getDirectChildIds,
  injectUniqueIdsIntoAST,
  insertElementIntoAST,
  parseTSXElements,
  wrapElementInAST,
} from './operations';
import { parseCode, printAST } from './parser';
import { findElementByUuid } from './traverser';

describe('insertElementIntoAST', () => {
  it('should insert element into parent by uuid', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="a">A</span>
  </div>
);`;
    const ast = parseCode(code);
    const newElement = t.jsxElement(
      t.jsxOpeningElement(
        t.jsxIdentifier('p'),
        [t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral('new-el'))],
        true,
      ),
      null,
      [],
      true,
    );

    const result = insertElementIntoAST(ast, {
      parentId: 'root',
      newElement,
    });

    expect(result.inserted).toBe(true);
    // The new element should be findable
    expect(findElementByUuid(ast, 'new-el')).not.toBeNull();
  });

  it('should insert at root level when parentId is null', () => {
    const code = `
const App = () => {
  return (
    <div data-uniq-id="root">
      <span data-uniq-id="a">A</span>
    </div>
  );
};`;
    const ast = parseCode(code);
    const newElement = t.jsxElement(
      t.jsxOpeningElement(
        t.jsxIdentifier('footer'),
        [t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral('footer-1'))],
        true,
      ),
      null,
      [],
      true,
    );

    const result = insertElementIntoAST(ast, {
      parentId: null,
      newElement,
    });

    expect(result.inserted).toBe(true);
    expect(findElementByUuid(ast, 'footer-1')).not.toBeNull();
  });

  it('should insert at specific logical index', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="a">A</span>
    <span data-uniq-id="b">B</span>
  </div>
);`;
    const ast = parseCode(code);
    const newElement = t.jsxElement(
      t.jsxOpeningElement(
        t.jsxIdentifier('p'),
        [t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral('mid'))],
        true,
      ),
      null,
      [],
      true,
    );

    const result = insertElementIntoAST(ast, {
      parentId: 'root',
      newElement,
      logicalIndex: 1,
    });

    expect(result.inserted).toBe(true);
    expect(result.actualIndex).toBe(1);
  });

  it('should return inserted=false when parent not found', () => {
    const code = '<div data-uniq-id="root" />';
    const ast = parseCode(code);
    const newElement = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('p'), [], true), null, [], true);

    const result = insertElementIntoAST(ast, {
      parentId: 'nonexistent',
      newElement,
    });

    expect(result.inserted).toBe(false);
  });
});

describe('duplicateElementInAST', () => {
  it('should duplicate element and return new id', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="child">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const result = duplicateElementInAST(ast, 'child');

    expect(result.newId).toBeTruthy();
    expect(result.inserted).toBe(true);
    // New element should be findable
    expect(result.newId).not.toBeNull();
    expect(findElementByUuid(ast, result.newId as string)).not.toBeNull();
    // Original should still exist
    expect(findElementByUuid(ast, 'child')).not.toBeNull();
  });

  it('should return inserted=false for elements inside arrow function body (.map())', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    {items.map(item => (
      <span data-uniq-id="item-1" key={item.id}>{item.name}</span>
    ))}
  </div>
);`;
    const ast = parseCode(code);

    // Arrow function body is not a JSXElement parent — duplication not supported
    const result = duplicateElementInAST(ast, 'item-1');

    expect(result.inserted).toBe(false);
  });

  it('should return inserted=false when element not found', () => {
    const code = '<div data-uniq-id="root" />';
    const ast = parseCode(code);

    const result = duplicateElementInAST(ast, 'nonexistent');

    expect(result.inserted).toBe(false);
  });

  it('should update child UUIDs in the duplicate', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <div data-uniq-id="parent">
      <span data-uniq-id="nested-child">Text</span>
    </div>
  </div>
);`;
    const ast = parseCode(code);

    const result = duplicateElementInAST(ast, 'parent');

    expect(result.inserted).toBe(true);
    // The nested child in the duplicate should have a new UUID
    expect(result.newId).not.toBeNull();
    const duplicate = findElementByUuid(ast, result.newId as string);
    expect(duplicate).not.toBeNull();
    // The original nested-child should still exist
    expect(findElementByUuid(ast, 'nested-child')).not.toBeNull();
  });
});

describe('wrapElementInAST', () => {
  it('should wrap element with a new parent', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="target">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const result = wrapElementInAST(ast, 'target', 'section');

    expect(result.wrapped).toBe(true);
    expect(result.wrapperId).toBeTruthy();
    // Wrapper should be findable
    expect(result.wrapperId).not.toBeNull();
    expect(findElementByUuid(ast, result.wrapperId as string)).not.toBeNull();
    // Original should still exist inside
    expect(findElementByUuid(ast, 'target')).not.toBeNull();
  });

  it('should add wrapper props', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="target">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const result = wrapElementInAST(ast, 'target', 'div', { className: 'wrapper' });

    expect(result.wrapped).toBe(true);
    const output = printAST(ast);
    expect(output).toContain('className="wrapper"');
  });

  it('should return wrapped=false when element not found', () => {
    const code = '<div data-uniq-id="root" />';
    const ast = parseCode(code);

    const result = wrapElementInAST(ast, 'nonexistent', 'div');

    expect(result.wrapped).toBe(false);
  });
});

describe('injectUniqueIdsIntoAST', () => {
  it('should add UUIDs to elements without them', () => {
    const code = `
const App = () => (
  <div>
    <span>Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const count = injectUniqueIdsIntoAST(ast);

    expect(count).toBe(2); // div + span
  });

  it('should skip elements that already have UUIDs', () => {
    const code = `
const App = () => (
  <div data-uniq-id="existing">
    <span>Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const count = injectUniqueIdsIntoAST(ast);

    expect(count).toBe(1); // only span
  });

  it('should replace duplicate UUIDs', () => {
    const code = `
const App = () => (
  <div data-uniq-id="dup">
    <span data-uniq-id="dup">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const count = injectUniqueIdsIntoAST(ast);

    expect(count).toBe(1); // second 'dup' replaced
  });

  it('should return 0 when all elements have unique IDs', () => {
    const code = `
const App = () => (
  <div data-uniq-id="a">
    <span data-uniq-id="b">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const count = injectUniqueIdsIntoAST(ast);

    expect(count).toBe(0);
  });
});

describe('parseTSXElements', () => {
  it('should parse JSX elements from TSX code string', () => {
    const result = parseTSXElements('<div data-uniq-id="x">Hello</div>');

    expect(result.elements.length).toBe(1);
    expect(result.firstId).toBeTruthy();
  });

  it('should parse multiple elements', () => {
    const result = parseTSXElements('<span>A</span><p>B</p>');

    expect(result.elements.length).toBe(2);
    expect(result.firstId).toBeTruthy();
  });

  it('should generate new UUIDs for all elements', () => {
    const result = parseTSXElements('<div data-uniq-id="old-id">Hello</div>');

    // The element should have a new UUID, not the old one
    expect(result.firstId).toBeTruthy();
    expect(result.firstId).not.toBe('old-id');
  });

  it('should return null firstId for empty code', () => {
    const result = parseTSXElements('');

    expect(result.elements.length).toBe(0);
    expect(result.firstId).toBeNull();
  });
});

describe('extractElementSource', () => {
  it('should extract source code of an element', () => {
    const code = `const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="target">Hello World</span>
  </div>
);`;
    const ast = parseCode(code);
    const result = findElementByUuid(ast, 'target');
    expect(result).not.toBeNull();

    const source = extractElementSource(code, result?.element);

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

describe('findParentElementId', () => {
  it('should find parent element UUID', () => {
    const code = `
const App = () => (
  <div data-uniq-id="parent">
    <span data-uniq-id="child">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const parentId = findParentElementId(ast, 'child');

    expect(parentId).toBe('parent');
  });

  it('should return null for root element', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="child">Hello</span>
  </div>
);`;
    const ast = parseCode(code);

    const parentId = findParentElementId(ast, 'root');

    expect(parentId).toBeNull();
  });

  it('should return null for nonexistent element', () => {
    const code = '<div data-uniq-id="root" />';
    const ast = parseCode(code);

    const parentId = findParentElementId(ast, 'nonexistent');

    expect(parentId).toBeNull();
  });

  it('should skip intermediate elements without UUID', () => {
    const code = `
const App = () => (
  <div data-uniq-id="grandparent">
    <section>
      <span data-uniq-id="child">Hello</span>
    </section>
  </div>
);`;
    const ast = parseCode(code);

    const parentId = findParentElementId(ast, 'child');

    // Should skip <section> which has no UUID and find grandparent
    expect(parentId).toBe('grandparent');
  });
});

describe('getDirectChildIds', () => {
  it('should return UUIDs of direct children', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span data-uniq-id="a">A</span>
    <p data-uniq-id="b">B</p>
  </div>
);`;
    const ast = parseCode(code);
    const result = findElementByUuid(ast, 'root');
    expect(result).not.toBeNull();

    const childIds = getDirectChildIds(result?.element);

    expect(childIds).toEqual(['a', 'b']);
  });

  it('should return empty array for leaf element', () => {
    const code = '<span data-uniq-id="leaf">Text</span>';
    const ast = parseCode(code);
    const result = findElementByUuid(ast, 'leaf');
    expect(result).not.toBeNull();

    const childIds = getDirectChildIds(result?.element);

    expect(childIds).toEqual([]);
  });

  it('should skip children without UUIDs', () => {
    const code = `
const App = () => (
  <div data-uniq-id="root">
    <span>no id</span>
    <p data-uniq-id="with-id">has id</p>
  </div>
);`;
    const ast = parseCode(code);
    const result = findElementByUuid(ast, 'root');
    expect(result).not.toBeNull();

    const childIds = getDirectChildIds(result?.element);

    expect(childIds).toEqual(['with-id']);
  });
});
