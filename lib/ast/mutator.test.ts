/**
 * Tests for AST mutator utilities
 */

import { describe, expect, it } from 'bun:test';
import * as t from '@babel/types';
import {
  cloneElement,
  getAttribute,
  getAttributeClassSegments,
  getAttributeString,
  removeAttribute,
  setAttribute,
  valueToJSXAttribute,
} from './mutator';
import { parseCode, printAST } from './parser';
import { findAllJSXElements } from './traverser';

describe('getAttribute', () => {
  it('should get string attribute', () => {
    const code = '<div className="test">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const attr = getAttribute(elements[0].element, 'className');

    expect(attr).not.toBeNull();
    expect(t.isStringLiteral(attr)).toBe(true);
    if (t.isStringLiteral(attr)) {
      expect(attr.value).toBe('test');
    }
  });

  it('should return null for non-existent attribute', () => {
    const code = '<div>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const attr = getAttribute(elements[0].element, 'className');

    expect(attr).toBeNull();
  });
});

describe('getAttributeString', () => {
  it('should get string value from attribute', () => {
    const code = '<div data-testid="my-component">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const value = getAttributeString(elements[0].element, 'data-testid');

    expect(value).toBe('my-component');
  });

  it('should return null for non-string attribute', () => {
    const code = '<div count={42}>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const value = getAttributeString(elements[0].element, 'count');

    expect(value).toBeNull();
  });
});

describe('setAttribute', () => {
  it('should add new attribute', () => {
    const code = '<div>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    setAttribute(elements[0].element, 'className', t.stringLiteral('new-class'));

    const output = printAST(ast);
    expect(output).toContain('className');
    expect(output).toContain('new-class');
  });

  it('should update existing attribute', () => {
    const code = '<div className="old">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    setAttribute(elements[0].element, 'className', t.stringLiteral('new'));

    const output = printAST(ast);
    expect(output).toContain('className');
    expect(output).toContain('new');
    expect(output).not.toContain('old');
  });

  it('should remove attribute when value is null', () => {
    const code = '<div className="test">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    setAttribute(elements[0].element, 'className', null);

    const output = printAST(ast);
    expect(output).not.toContain('className');
  });
});

describe('removeAttribute', () => {
  it('should remove existing attribute', () => {
    const code = '<div className="test" id="my-id">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    removeAttribute(elements[0].element, 'className');

    const output = printAST(ast);
    expect(output).not.toContain('className');
    expect(output).toContain('id="my-id"');
  });

  it('should do nothing for non-existent attribute', () => {
    const code = '<div>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    expect(() => {
      removeAttribute(elements[0].element, 'className');
    }).not.toThrow();
  });
});

describe('getAttributeClassSegments', () => {
  it('marks a plain string-literal className as certain', () => {
    const code = '<div className="px-4 flex">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const segments = getAttributeClassSegments(elements[0].element);

    expect(segments).toEqual([{ value: 'px-4 flex', certain: true }]);
  });

  it('splits cn() literal args (certain) from logical-&& branch (conditional)', () => {
    const code = '<div className={cn("px-4 flex", isActive && "bg-red-500")}>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const segments = getAttributeClassSegments(elements[0].element);

    expect(segments).toEqual([
      { value: 'px-4 flex', certain: true },
      { value: 'bg-red-500', certain: false },
    ]);
  });

  it('marks both ternary branches as conditional', () => {
    const code = '<div className={cn("base", isActive ? "on" : "off")}>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const segments = getAttributeClassSegments(elements[0].element);

    expect(segments).toEqual([
      { value: 'base', certain: true },
      { value: 'on', certain: false },
      { value: 'off', certain: false },
    ]);
  });

  it('returns null when there is no className attribute', () => {
    const code = '<div>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    expect(getAttributeClassSegments(elements[0].element)).toBeNull();
  });

  it('downgrades template quasi fragments glued to an interpolation, keeps whitespace-bounded tokens certain', () => {
    // `text-${color}-500 px-4` → `text-` and `-500` are partial tokens split by the
    // interpolation (no whitespace against `${color}`); only `px-4` is a complete token.
    const code = '<div className={`text-${color}-500 px-4`}>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const segments = getAttributeClassSegments(elements[0].element);

    // px-4 is whitespace-bounded → certain. text- / -500 touch the interpolation → not certain.
    const pxFour = segments?.filter((s) => s.certain).flatMap((s) => s.value.split(/\s+/));
    expect(pxFour).toEqual(['px-4']);

    const partials = segments?.filter((s) => !s.certain).flatMap((s) => s.value.split(/\s+/));
    expect(partials).toContain('text-');
    expect(partials).toContain('-500');
  });

  it('keeps a whitespace-bounded quasi token certain even when adjacent to an interpolation', () => {
    // `flex ${cond} px-4` → both `flex` and `px-4` are bounded by whitespace against the
    // interpolation, so they stay certain.
    const code = '<div className={`flex ${cond} px-4`}>Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const segments = getAttributeClassSegments(elements[0].element);
    const certain = segments?.filter((s) => s.certain).flatMap((s) => s.value.split(/\s+/));

    expect(certain).toEqual(['flex', 'px-4']);
  });
});

describe('valueToJSXAttribute', () => {
  it('should convert string to StringLiteral', () => {
    const result = valueToJSXAttribute('test');

    expect(t.isStringLiteral(result)).toBe(true);
    if (t.isStringLiteral(result)) {
      expect(result.value).toBe('test');
    }
  });

  it('should convert number to JSXExpressionContainer with NumericLiteral', () => {
    const result = valueToJSXAttribute(42);

    expect(t.isJSXExpressionContainer(result)).toBe(true);
    if (t.isJSXExpressionContainer(result)) {
      expect(t.isNumericLiteral(result.expression)).toBe(true);
    }
  });

  it('should convert true to null (implicit true)', () => {
    const result = valueToJSXAttribute(true);

    expect(result).toBeNull();
  });

  it('should convert false to BooleanLiteral', () => {
    const result = valueToJSXAttribute(false);

    expect(t.isJSXExpressionContainer(result)).toBe(true);
  });

  it('should convert array to ArrayExpression', () => {
    const result = valueToJSXAttribute(['a', 'b', 'c']);

    expect(t.isJSXExpressionContainer(result)).toBe(true);
    if (t.isJSXExpressionContainer(result)) {
      expect(t.isArrayExpression(result.expression)).toBe(true);
    }
  });

  it('should convert object to expression', () => {
    const result = valueToJSXAttribute({ key: 'value' });

    expect(t.isJSXExpressionContainer(result)).toBe(true);
  });

  it('should return null for null/undefined', () => {
    expect(valueToJSXAttribute(null)).toBeNull();
    expect(valueToJSXAttribute(undefined)).toBeNull();
  });
});

describe('cloneElement', () => {
  it('should create deep copy of element', () => {
    const code = '<div className="original"><span>Child</span></div>';
    const ast = parseCode(code);

    const elements = findAllJSXElements(ast);
    const original = elements[0];
    if (!original) throw new Error('Element not found');

    const cloned = cloneElement(original.element);

    expect(cloned).not.toBe(original.element);
    expect(cloned.type).toBe('JSXElement');
    expect(cloned.openingElement.type).toBe('JSXOpeningElement');
    expect(cloned.children.length).toBe(original.element.children.length);
  });

  it('should preserve attributes in clone', () => {
    const code = '<div className="test" data-id="123">Content</div>';
    const ast = parseCode(code);
    const elements = findAllJSXElements(ast);

    const cloned = cloneElement(elements[0].element);

    const className = getAttributeString(cloned, 'className');
    const dataId = getAttributeString(cloned, 'data-id');

    expect(className).toBe('test');
    expect(dataId).toBe('123');
  });
});
