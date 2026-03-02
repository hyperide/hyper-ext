/**
 * JSX element construction utilities
 *
 * Pure functions for building JSX elements from component descriptions.
 * Extracted from AstService to be reusable across server and extension.
 */

import * as t from '@babel/types';
import { makeNotSelfClosing, valueToJSXAttribute } from './mutator';
import { generateUuid } from './uuid';

/**
 * Build a JSX element from a component description.
 * Separates `children` from other props, creates attributes,
 * and generates a UUID if not provided.
 */
export function buildJSXElement(opts: { componentType: string; props: Record<string, unknown>; uuid?: string }): {
  element: t.JSXElement;
  uuid: string;
} {
  const { componentType, props, uuid: providedUuid } = opts;
  const uuid = providedUuid || generateUuid();

  // Start with data-uniq-id attribute
  const attributes: t.JSXAttribute[] = [t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral(uuid))];

  // Separate children from other props
  const { children, ...otherProps } = props as { children?: unknown };

  // Add other props as attributes
  for (const [key, value] of Object.entries(otherProps)) {
    const attrValue = valueToJSXAttribute(value);
    if (attrValue !== null) {
      attributes.push(t.jsxAttribute(t.jsxIdentifier(key), attrValue));
    }
  }

  // Create children content
  const childrenContent: (t.JSXText | t.JSXExpressionContainer)[] = [];
  if (typeof children === 'string') {
    childrenContent.push(t.jsxText(children));
  }

  // Create element
  const isSelfClosing = childrenContent.length === 0;
  const element = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier(componentType), attributes, isSelfClosing),
    isSelfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(componentType)),
    childrenContent,
    isSelfClosing,
  );

  return { element, uuid };
}

/**
 * Calculate real index in children array, skipping non-JSXElement nodes (like JSXText whitespace).
 * logicalIndex counts only JSXElement children.
 */
export function calculateRealIndex(
  children: (t.JSXElement | t.JSXText | t.JSXExpressionContainer | t.JSXFragment | t.JSXSpreadChild)[],
  logicalIndex: number,
): number {
  let jsxElementCount = 0;

  for (let i = 0; i < children.length; i++) {
    if (t.isJSXElement(children[i])) {
      if (jsxElementCount === logicalIndex) {
        return i;
      }
      jsxElementCount++;
    }
  }

  return children.length;
}

/**
 * Insert a child JSX element into a parent at a logical index.
 * Makes the parent non-self-closing if needed.
 * Returns the actual logical index where the child was inserted.
 */
export function insertChildAtIndex(parent: t.JSXElement, child: t.JSXElement, logicalIndex?: number): number {
  makeNotSelfClosing(parent);

  const jsxElementCount = parent.children.filter((c) => t.isJSXElement(c)).length;

  if (logicalIndex !== undefined && logicalIndex >= 0 && logicalIndex <= jsxElementCount) {
    const realIndex = calculateRealIndex(parent.children, logicalIndex);
    parent.children.splice(realIndex, 0, child);
    return logicalIndex;
  }

  parent.children.push(child);
  return jsxElementCount;
}
