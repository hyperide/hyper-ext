/**
 * Tests for element-builder - JSX element construction utilities
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import { buildJSXElement, calculateRealIndex, insertChildAtIndex } from './element-builder';
import { parseCode } from './parser';
import { findAllJSXElements } from './traverser';

describe('buildJSXElement', () => {
  it('should create a self-closing element with no props and no children', () => {
    const { element } = buildJSXElement({ componentType: 'div', props: {} });

    expect(element.type).toBe('JSXElement');
    expect(element.openingElement.selfClosing).toBe(true);
    expect(element.closingElement).toBeNull();
  });

  it('should add string props as attributes', () => {
    const { element } = buildJSXElement({
      componentType: 'div',
      props: { className: 'text-red', id: 'main' },
    });

    const attrs = element.openingElement.attributes;
    expect(attrs.length).toBe(2);
  });

  it('should create element with children text', () => {
    const { element } = buildJSXElement({
      componentType: 'p',
      props: { children: 'Hello World' },
    });

    // Should not be self-closing
    expect(element.openingElement.selfClosing).toBe(false);
    expect(element.closingElement).not.toBeNull();
    expect(element.children.length).toBe(1);
    expect(t.isJSXText(element.children[0])).toBe(true);

    // children should NOT appear as attribute
    const childrenAttr = element.openingElement.attributes.find(
      (a) => t.isJSXAttribute(a) && t.isJSXIdentifier(a.name) && a.name.name === 'children',
    );
    expect(childrenAttr).toBeUndefined();
  });

  it('should use JSXIdentifier for simple tag names', () => {
    const { element } = buildJSXElement({ componentType: 'Button', props: {} });
    expect(t.isJSXIdentifier(element.openingElement.name)).toBe(true);
  });
});

describe('calculateRealIndex', () => {
  it('should return 0 for logicalIndex 0 in empty array', () => {
    expect(calculateRealIndex([], 0)).toBe(0);
  });

  it('should skip JSXText nodes when counting', () => {
    const children: t.JSXElement['children'] = [
      t.jsxText('\n  '),
      t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('a'), [], true), null, [], true),
      t.jsxText('\n  '),
      t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('b'), [], true), null, [], true),
      t.jsxText('\n'),
    ];

    // logicalIndex 0 should point to before the first JSXElement (index 1 in raw array)
    expect(calculateRealIndex(children, 0)).toBe(1);
    // logicalIndex 1 should point to before the second JSXElement (index 3)
    expect(calculateRealIndex(children, 1)).toBe(3);
    // logicalIndex 2 (past end) should return children.length
    expect(calculateRealIndex(children, 2)).toBe(5);
  });

  it('should return children.length when logicalIndex exceeds element count', () => {
    const children: t.JSXElement['children'] = [
      t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('a'), [], true), null, [], true),
    ];

    expect(calculateRealIndex(children, 5)).toBe(1);
  });
});

describe('insertChildAtIndex', () => {
  it('should insert child at specific logical index', () => {
    const code = `
      <div>
        <span>A</span>
        <span>B</span>
      </div>
    `;
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);
    const parent = elements[0]; // the outer div
    expect(parent).not.toBeNull();

    const newChild = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('p'), [], true), null, [], true);

    const actualIndex = insertChildAtIndex(parent.element, newChild, 1);
    expect(actualIndex).toBe(1);

    // Count JSX elements in children
    const jsxChildren = parent.element.children.filter((c) => t.isJSXElement(c));
    expect(jsxChildren.length).toBe(3);
  });

  it('should append to end when no logicalIndex given', () => {
    const code = `
      <div>
        <span>A</span>
      </div>
    `;
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);
    const parent = elements[0];
    expect(parent).not.toBeNull();

    const newChild = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('p'), [], true), null, [], true);

    const actualIndex = insertChildAtIndex(parent.element, newChild);
    expect(actualIndex).toBe(1); // appended after the 1 existing element
  });

  it('should make self-closing parent non-self-closing', () => {
    const code = '<div />';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);
    const parent = elements[0];
    expect(parent).not.toBeNull();

    const newChild = t.jsxElement(t.jsxOpeningElement(t.jsxIdentifier('span'), [], true), null, [], true);

    insertChildAtIndex(parent.element, newChild);

    expect(parent.element.openingElement.selfClosing).toBe(false);
    expect(parent.element.closingElement).not.toBeNull();
  });
});
