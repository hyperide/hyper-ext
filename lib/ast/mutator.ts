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
export function getTagName(element: t.JSXElement): string {
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
 * Check if element is self-closing
 */
export function isSelfClosing(element: t.JSXElement): boolean {
  return element.openingElement.selfClosing;
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
 * Add child to element
 */
export function addChild(
  element: t.JSXElement,
  child: t.JSXElement | t.JSXText | t.JSXExpressionContainer,
  index?: number,
): void {
  makeNotSelfClosing(element);

  if (index !== undefined && index >= 0 && index < element.children.length) {
    element.children.splice(index, 0, child);
  } else {
    element.children.push(child);
  }
}

/**
 * Parse mixed content like "{hour.toString()}:00" into JSX children nodes.
 * Returns an array of t.JSXText and t.JSXExpressionContainer nodes.
 */
export function parseMixedContent(text: string): (t.JSXText | t.JSXExpressionContainer)[] {
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

/**
 * Remove child from element
 */
export function removeChild(element: t.JSXElement, index: number): void {
  if (index >= 0 && index < element.children.length) {
    element.children.splice(index, 1);
  }
}
