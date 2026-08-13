/**
 * AST mutation utilities
 * Provides helpers for modifying JSX elements and attributes
 */

import { parse as babelParse } from '@babel/parser';
import * as t from '@babel/types';

/**
 * Get attribute value from JSX element
 * @param element - JSX element
 * @param attributeName - Name of attribute to get
 * @returns Attribute value or null if not found
 */
export function getAttribute(element: t.JSXElement, attributeName: string): t.JSXAttribute['value'] | null {
  const openingElement = element.openingElement;

  const attr = openingElement.attributes.find(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === attributeName,
  );

  if (attr && t.isJSXAttribute(attr)) {
    return attr.value;
  }

  return null;
}

/**
 * Get string value from attribute
 * @param element - JSX element
 * @param attributeName - Name of attribute
 * @returns String value or null
 */
export function getAttributeString(element: t.JSXElement, attributeName: string): string | null {
  const value = getAttribute(element, attributeName);

  if (t.isStringLiteral(value)) {
    return value.value;
  }

  return null;
}

/**
 * Extract static string parts from a className attribute.
 * Handles StringLiteral, TemplateLiteral quasis, and string args in cn()/clsx() calls.
 * Returns all static class fragments joined by spaces, or null if no className attribute.
 */
export function getAttributeStaticClassName(element: t.JSXElement): string | null {
  const value = getAttribute(element, 'className');
  if (!value) return null;

  if (t.isStringLiteral(value)) {
    return value.value;
  }

  if (t.isJSXExpressionContainer(value)) {
    const expr = value.expression;
    if (t.isJSXEmptyExpression(expr)) return null;
    return collectStaticStrings(expr);
  }

  return null;
}

/** A static class fragment with its provenance: whether it is unconditionally present. */
export interface ClassNameSegment {
  /** The class string fragment (may itself contain multiple space-separated classes). */
  value: string;
  /**
   * True when the fragment is unconditionally present — a direct string-literal argument
   * to cn()/clsx() or a top-level template quasi. False when it lives inside a conditional
   * branch (logical-`&&` right side, or a ternary consequent/alternate).
   */
  certain: boolean;
}

/**
 * Extract static class fragments from a className attribute WITH provenance.
 * Mirrors {@link getAttributeStaticClassName}'s traversal, but records which fragments are
 * statically certain (top-level string literals / template quasis) vs conditional
 * (inside `&&` or ternary branches). Returns null if there is no className attribute.
 */
export function getAttributeClassSegments(element: t.JSXElement): ClassNameSegment[] | null {
  const value = getAttribute(element, 'className');
  if (!value) return null;

  if (t.isStringLiteral(value)) {
    return [{ value: value.value, certain: true }];
  }

  if (t.isJSXExpressionContainer(value)) {
    const expr = value.expression;
    if (t.isJSXEmptyExpression(expr)) return null;
    const segments: ClassNameSegment[] = [];
    collectClassSegments(expr, true, segments);
    return segments;
  }

  return null;
}

/** Recursively collect class fragments with provenance, threading `certain` through branches. */
function collectClassSegments(expr: t.Expression | t.TSType, certain: boolean, out: ClassNameSegment[]): void {
  if (t.isStringLiteral(expr)) {
    if (expr.value) out.push({ value: expr.value, certain });
    return;
  }

  // `px-4 ${cond ? 'a' : 'b'} py-2` → whitespace-bounded quasi tokens are unconditional
  // (inherit caller's `certain`), interpolated expressions are conditional.
  // A quasi token that is GLUED to an adjacent interpolation (no whitespace between the token
  // and `${...}` on that side) is only a PARTIAL class fragment — e.g. `text-${color}-500` yields
  // `text-` and `-500`, which are not real classes. Such partial tokens are downgraded to
  // conditional so readers don't surface them as exact.
  if (t.isTemplateLiteral(expr)) {
    expr.quasis.forEach((q, i) => {
      const text = q.value.cooked ?? q.value.raw;
      const tokens = text.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) return;

      // An interpolation precedes this quasi iff it is not the first; one follows iff it is
      // not the tail quasi. The leading token is partial when there is a preceding
      // interpolation AND the quasi text does not start with whitespace; the trailing token
      // is partial when there is a following interpolation AND the text does not end with
      // whitespace.
      const gluedToLeftInterp = i > 0 && !/^\s/.test(text);
      const gluedToRightInterp = i < expr.quasis.length - 1 && !/\s$/.test(text);

      tokens.forEach((token, tokenIndex) => {
        const isFirst = tokenIndex === 0;
        const isLast = tokenIndex === tokens.length - 1;
        const partial = (isFirst && gluedToLeftInterp) || (isLast && gluedToRightInterp);
        out.push({ value: token, certain: certain && !partial });
      });
    });
    for (const sub of expr.expressions) {
      if (t.isExpression(sub)) collectClassSegments(sub, false, out);
    }
    return;
  }

  // cn("base", cond && "extra", ...) — each argument keeps the current `certain` level;
  // conditional logic inside an argument downgrades it.
  if (t.isCallExpression(expr)) {
    for (const arg of expr.arguments) {
      if (t.isStringLiteral(arg) || t.isTemplateLiteral(arg)) {
        collectClassSegments(arg, certain, out);
      } else if (t.isExpression(arg)) {
        collectClassSegments(arg, certain, out);
      }
    }
    return;
  }

  // condition ? "a" : "b" → both branches are conditional
  if (t.isConditionalExpression(expr)) {
    if (t.isExpression(expr.consequent)) collectClassSegments(expr.consequent, false, out);
    if (t.isExpression(expr.alternate)) collectClassSegments(expr.alternate, false, out);
    return;
  }

  // expr && "classes" → the right side is conditional
  if (t.isLogicalExpression(expr)) {
    collectClassSegments(expr.right, false, out);
    return;
  }
}

/** Recursively collect static string fragments from an expression. */
function collectStaticStrings(expr: t.Expression | t.TSType): string | null {
  // "px-4 py-2"
  if (t.isStringLiteral(expr)) {
    return expr.value;
  }

  // `px-4 ${dynamic} py-2` → extract quasis
  if (t.isTemplateLiteral(expr)) {
    const parts = expr.quasis.map((q) => q.value.cooked ?? q.value.raw).filter(Boolean);
    return parts.join(' ').replace(/\s+/g, ' ').trim() || null;
  }

  // cn("base", conditional && "extra", ...) or clsx("base", ...)
  if (t.isCallExpression(expr)) {
    const parts: string[] = [];
    for (const arg of expr.arguments) {
      if (t.isStringLiteral(arg)) {
        parts.push(arg.value);
      } else if (t.isTemplateLiteral(arg)) {
        const sub = collectStaticStrings(arg);
        if (sub) parts.push(sub);
      }
    }
    return parts.length > 0 ? parts.join(' ').trim() : null;
  }

  // condition ? "a" : "b" → collect from both branches
  if (t.isConditionalExpression(expr)) {
    const parts: string[] = [];
    const cons = t.isExpression(expr.consequent) ? collectStaticStrings(expr.consequent) : null;
    const alt = t.isExpression(expr.alternate) ? collectStaticStrings(expr.alternate) : null;
    if (cons) parts.push(cons);
    if (alt) parts.push(alt);
    return parts.length > 0 ? parts.join(' ').trim() : null;
  }

  // logical: expr && "classes" → collect from right side
  if (t.isLogicalExpression(expr)) {
    const right = collectStaticStrings(expr.right);
    const left = collectStaticStrings(expr.left);
    const parts: string[] = [];
    if (left) parts.push(left);
    if (right) parts.push(right);
    return parts.length > 0 ? parts.join(' ').trim() : null;
  }

  return null;
}

/**
 * Set attribute value on JSX element
 * If attribute exists, it will be updated; otherwise, it will be added
 * @param element - JSX element
 * @param attributeName - Name of attribute to set
 * @param value - Value to set (or null to remove attribute)
 */
export function setAttribute(element: t.JSXElement, attributeName: string, value: t.JSXAttribute['value']): void {
  const openingElement = element.openingElement;

  // Find existing attribute
  const existingIndex = openingElement.attributes.findIndex(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === attributeName,
  );

  if (value === null) {
    // Remove attribute if value is null
    if (existingIndex !== -1) {
      openingElement.attributes.splice(existingIndex, 1);
    }
  } else if (existingIndex !== -1) {
    // Update existing attribute
    const existingAttr = openingElement.attributes[existingIndex];
    if (t.isJSXAttribute(existingAttr)) {
      existingAttr.value = value;
    }
  } else {
    // Add new attribute
    const newAttr = t.jsxAttribute(t.jsxIdentifier(attributeName), value);
    openingElement.attributes.push(newAttr);
  }
}

/**
 * Remove attribute from JSX element
 * @param element - JSX element
 * @param attributeName - Name of attribute to remove
 */
export function removeAttribute(element: t.JSXElement, attributeName: string): void {
  setAttribute(element, attributeName, null);
}

/**
 * Convert JavaScript value to JSX attribute value
 * Handles strings, numbers, booleans, arrays, and objects
 * @param value - JavaScript value to convert
 * @returns JSX attribute value
 */
export function valueToJSXAttribute(value: unknown): t.JSXAttribute['value'] {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return t.stringLiteral(value);
  }

  if (typeof value === 'number') {
    return t.jsxExpressionContainer(t.numericLiteral(value));
  }

  if (typeof value === 'boolean') {
    if (value === true) {
      // For true values, just the attribute name is enough (returns null for value)
      return null;
    }
    return t.jsxExpressionContainer(t.booleanLiteral(value));
  }

  if (Array.isArray(value)) {
    const arrayElements = value.map((item) => {
      if (typeof item === 'string') {
        return t.stringLiteral(item);
      }
      if (typeof item === 'number') {
        return t.numericLiteral(item);
      }
      if (typeof item === 'boolean') {
        return t.booleanLiteral(item);
      }
      // For complex items, use JSON representation
      return t.stringLiteral(JSON.stringify(item));
    });

    return t.jsxExpressionContainer(t.arrayExpression(arrayElements));
  }

  if (typeof value === 'object') {
    // For objects, use JSON representation
    const jsonString = JSON.stringify(value);
    try {
      // Try to parse as JavaScript expression for cleaner output
      const ast = babelParse(jsonString, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      if (ast.program.body.length > 0) {
        const firstStatement = ast.program.body[0];
        if (t.isExpressionStatement(firstStatement)) {
          return t.jsxExpressionContainer(firstStatement.expression);
        }
      }
    } catch {
      // Fallback to string
    }
    return t.jsxExpressionContainer(t.stringLiteral(jsonString));
  }

  // Fallback to string
  return t.stringLiteral(String(value));
}

/**
 * Clone a JSX element (deep copy)
 * @param element - Element to clone
 * @returns Cloned element
 */
export function cloneElement(element: t.JSXElement): t.JSXElement {
  return t.cloneNode(element, true);
}

/**
 * Get element tag name
 */
function getTagName(element: t.JSXElement): string {
  const name = element.openingElement.name;
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }
  if (t.isJSXMemberExpression(name)) {
    // Handle e.g. Card.Header
    const parts: string[] = [];
    let current: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(current)) {
      parts.unshift(current.property.name);
      current = current.object as t.JSXMemberExpression | t.JSXIdentifier;
    }
    if (t.isJSXIdentifier(current)) {
      parts.unshift(current.name);
    }
    return parts.join('.');
  }
  return 'unknown';
}

/**
 * Make element not self-closing (add closing tag)
 */
export function makeNotSelfClosing(element: t.JSXElement): void {
  if (!element.openingElement.selfClosing) return;

  element.openingElement.selfClosing = false;
  const tagName = getTagName(element);

  if (tagName.includes('.')) {
    // Handle member expression like Card.Header
    const parts = tagName.split('.');
    let memberExpr: t.JSXMemberExpression | t.JSXIdentifier = t.jsxIdentifier(parts[0]);
    for (let i = 1; i < parts.length; i++) {
      memberExpr = t.jsxMemberExpression(
        memberExpr as t.JSXMemberExpression | t.JSXIdentifier,
        t.jsxIdentifier(parts[i]),
      );
    }
    element.closingElement = t.jsxClosingElement(memberExpr);
  } else {
    element.closingElement = t.jsxClosingElement(t.jsxIdentifier(tagName));
  }
}

/**
 * Parse mixed content like "{hour.toString()}:00" into JSX children nodes.
 * Returns an array of t.JSXText and t.JSXExpressionContainer nodes.
 */
function parseMixedContent(text: string): (t.JSXText | t.JSXExpressionContainer)[] {
  const children: (t.JSXText | t.JSXExpressionContainer)[] = [];

  const expressionRegex = /\{([^}]+)\}/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = expressionRegex.exec(text);

  while (match !== null) {
    const beforeText = text.slice(lastIndex, match.index);

    if (beforeText) {
      children.push(t.jsxText(beforeText));
    }

    const expressionCode = match[1];
    try {
      const ast = babelParse(expressionCode, {
        sourceType: 'module',
        plugins: ['typescript', 'jsx'],
      });

      if (ast.program.body.length > 0) {
        const firstStatement = ast.program.body[0];
        if (t.isExpressionStatement(firstStatement)) {
          children.push(t.jsxExpressionContainer(firstStatement.expression));
        } else {
          children.push(t.jsxExpressionContainer(t.identifier(expressionCode)));
        }
      }
    } catch {
      children.push(t.jsxExpressionContainer(t.identifier(expressionCode)));
    }

    lastIndex = match.index + match[0].length;
    match = expressionRegex.exec(text);
  }

  const remainingText = text.slice(lastIndex);
  if (remainingText) {
    children.push(t.jsxText(remainingText));
  }

  return children;
}

/**
 * Replace the children of a JSX element with parsed text/expression content.
 * Handles plain text, expressions like {variable}, and mixed content like "{count} items".
 * Throws if the element has JSX element children (only text/expressions are editable).
 */
export function updateElementChildren(element: t.JSXElement, text: string): void {
  const children = element.children || [];

  // Determine current children type
  let currentChildrenType: 'text' | 'expression' | 'expression-complex' | 'jsx' | undefined;

  for (const child of children) {
    if (t.isJSXElement(child)) {
      currentChildrenType = 'jsx';
      break;
    }
  }

  if (!currentChildrenType) {
    if (children.length === 1) {
      const onlyChild = children[0];
      if (t.isJSXText(onlyChild) && onlyChild.value.trim()) {
        currentChildrenType = 'text';
      } else if (t.isJSXExpressionContainer(onlyChild) && t.isIdentifier(onlyChild.expression)) {
        currentChildrenType = 'expression';
      } else if (t.isJSXExpressionContainer(onlyChild)) {
        currentChildrenType = 'expression-complex';
      }
    } else if (children.length > 1) {
      currentChildrenType = 'expression-complex';
    }
  }

  if (currentChildrenType === 'jsx') {
    throw new Error('Cannot edit JSX children - only plain text and expressions are editable');
  }

  let newChildren: (t.JSXText | t.JSXExpressionContainer)[];

  if (text.trim() === '') {
    newChildren = [];
  } else if (currentChildrenType === 'text') {
    newChildren = [t.jsxText(text)];
  } else if (currentChildrenType === 'expression') {
    if (!text.includes('{') && !text.includes('}')) {
      newChildren = [t.jsxExpressionContainer(t.identifier(text.trim()))];
    } else {
      newChildren = parseMixedContent(text);
    }
  } else if (currentChildrenType === 'expression-complex') {
    newChildren = parseMixedContent(text);
  } else {
    if (text.includes('{')) {
      newChildren = parseMixedContent(text);
    } else {
      newChildren = [t.jsxText(text)];
    }
  }

  element.children = newChildren;
}
