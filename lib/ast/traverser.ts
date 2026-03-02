/**
 * AST traversal utilities
 * Provides helpers for finding and navigating JSX elements
 */

import _generate from '@babel/generator';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { FindElementResult } from '../types';

const generate = _generate.default || _generate;

// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

/**
 * Extract string value from JSX attribute value
 * Handles: StringLiteral, JSXExpressionContainer with StringLiteral,
 * and JSXExpressionContainer with static TemplateLiteral (no expressions)
 * @param value - JSX attribute value node
 * @returns String value or null if not a static string
 */
function getStaticStringFromAttrValue(value: t.JSXAttribute['value']): string | null {
  if (!value) return null;

  // Case 1: data-uniq-id="value"
  if (t.isStringLiteral(value)) {
    return value.value;
  }

  // Case 2 & 3: data-uniq-id={"value"} or data-uniq-id={`value`}
  if (t.isJSXExpressionContainer(value)) {
    const expr = value.expression;

    // data-uniq-id={"value"}
    if (t.isStringLiteral(expr)) {
      return expr.value;
    }

    // data-uniq-id={`value`} - only static templates (no ${} expressions)
    if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) {
      // Join all quasis (template parts)
      return expr.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
    }
  }

  return null;
}

/**
 * Find JSX element by data-uniq-id attribute
 * @param ast - AST to search in
 * @param uuid - UUID to find
 * @returns Element and its path, or null if not found
 */
export function findElementByUuid(ast: t.File, uuid: string): FindElementResult | null {
  let result: FindElementResult | null = null;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      if (result) return; // Already found

      const openingElement = path.node.openingElement;

      // Find data-uniq-id attribute
      const dataUniqIdAttr = openingElement.attributes.find(
        (attr: t.JSXAttribute | t.JSXSpreadAttribute) =>
          t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
      );

      if (dataUniqIdAttr && t.isJSXAttribute(dataUniqIdAttr)) {
        const elementUuid = getStaticStringFromAttrValue(dataUniqIdAttr.value);

        if (elementUuid === uuid) {
          result = {
            element: path.node,
            path,
          };
          path.stop();
        }
      }
    },
  });

  return result;
}

/**
 * Get UUID from JSX element's data-uniq-id attribute
 * @param element - JSX element to extract UUID from
 * @returns UUID string or null if not found
 */
export function getUuidFromElement(element: t.JSXElement): string | null {
  const openingElement = element.openingElement;

  const dataUniqIdAttr = openingElement.attributes.find(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
  );

  if (dataUniqIdAttr && t.isJSXAttribute(dataUniqIdAttr)) {
    return getStaticStringFromAttrValue(dataUniqIdAttr.value);
  }

  return null;
}

/**
 * Find all JSX elements in AST
 * @param ast - AST to search in
 * @returns Array of all JSX elements with their paths
 */
export function findAllJSXElements(ast: t.File): Array<{ element: t.JSXElement; path: NodePath<t.JSXElement> }> {
  const elements: Array<{ element: t.JSXElement; path: NodePath<t.JSXElement> }> = [];

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      elements.push({
        element: path.node,
        path,
      });
    },
  });

  return elements;
}

/**
 * Traverse only JSX elements with custom visitor
 * @param ast - AST to traverse
 * @param visitor - Visitor function called for each JSX element
 */
export function traverseJSXElements(
  ast: t.File,
  visitor: (element: t.JSXElement, path: NodePath<t.JSXElement>) => undefined | boolean,
): void {
  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const shouldStop = visitor(path.node, path);
      if (shouldStop === true) {
        path.stop();
      }
    },
  });
}

/**
 * Find element by source location (line, column)
 * Used for "Go to Visual" feature
 */
export function findElementAtPosition(ast: t.File, line: number, column: number): FindElementResult | null {
  let bestMatch: {
    element: t.JSXElement;
    path: NodePath<t.JSXElement>;
    size: number;
  } | null = null;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const loc = path.node.loc;
      if (!loc) return;

      // Check if position is within this element
      const isWithin =
        (line > loc.start.line || (line === loc.start.line && column >= loc.start.column)) &&
        (line < loc.end.line || (line === loc.end.line && column <= loc.end.column));

      if (isWithin) {
        // Calculate element size (smaller is more specific)
        const size = (loc.end.line - loc.start.line) * 1000 + (loc.end.column - loc.start.column);

        // Keep the smallest (most specific) element
        if (!bestMatch || size < bestMatch.size) {
          bestMatch = { element: path.node, path, size };
        }
      }
    },
  });

  if (bestMatch) {
    const { element, path } = bestMatch;
    return { element, path };
  }

  return null;
}

/**
 * Get element location for "Go to Code" feature
 */
export function getElementLocation(element: t.JSXElement): { line: number; column: number } | null {
  const loc = element.loc;
  if (!loc) return null;

  return {
    line: loc.start.line,
    column: loc.start.column,
  };
}

/**
 * Get location of the first meaningful child (text or expression).
 * Used for "Go to code" navigation to text/expression content.
 */
export function getChildrenLocation(element: t.JSXElement): { line: number; column: number } | null {
  for (const child of element.children) {
    if (t.isJSXText(child) && child.value.trim()) {
      if (child.loc) {
        return { line: child.loc.start.line, column: child.loc.start.column };
      }
    } else if (t.isJSXExpressionContainer(child) && !t.isJSXEmptyExpression(child.expression)) {
      if (child.loc) {
        return { line: child.loc.start.line, column: child.loc.start.column };
      }
    }
  }
  return null;
}

export type ChildrenType = 'text' | 'expression' | 'expression-complex' | 'jsx';

export interface ChildrenAnalysis {
  childrenType: ChildrenType | undefined;
  textContent: string;
}

/**
 * Analyze JSX element children to determine type and text content.
 * Uses @babel/generator to extract source text from complex expressions.
 */
export function analyzeJSXChildren(element: t.JSXElement): ChildrenAnalysis {
  const children = element.children;

  if (!children || children.length === 0) {
    return { childrenType: undefined, textContent: '' };
  }

  // Check for JSX element children
  const hasJSXChildren = children.some((child) => t.isJSXElement(child) || t.isJSXFragment(child));
  if (hasJSXChildren) {
    return { childrenType: 'jsx', textContent: '' };
  }

  // Build source text from all children using generate() for expressions
  const parts: string[] = [];
  let hasExpression = false;
  let hasText = false;
  let expressionCount = 0;
  let isSimpleExpression = false;

  for (const child of children) {
    if (t.isJSXText(child)) {
      const trimmed = child.value.trim();
      if (trimmed) {
        parts.push(trimmed);
        hasText = true;
      }
    } else if (t.isJSXExpressionContainer(child)) {
      if (t.isJSXEmptyExpression(child.expression)) {
        continue;
      }
      hasExpression = true;
      expressionCount++;
      const code = generate(child.expression).code;
      // Simple expressions: identifiers and string/template literals
      isSimpleExpression =
        t.isIdentifier(child.expression) ||
        t.isStringLiteral(child.expression) ||
        (t.isTemplateLiteral(child.expression) && child.expression.expressions.length === 0);
      parts.push(`{${code}}`);
    }
  }

  const textContent = parts.join(' ').trim();

  if (!hasExpression && !hasText) {
    return { childrenType: undefined, textContent: '' };
  }

  if (hasText && !hasExpression) {
    return { childrenType: 'text', textContent };
  }

  if (hasExpression && !hasText && expressionCount === 1 && isSimpleExpression) {
    return { childrenType: 'expression', textContent };
  }

  return { childrenType: 'expression-complex', textContent };
}

/**
 * Get tag name string from a JSX element.
 * Handles JSXIdentifier and JSXMemberExpression (e.g. Flex.Item, A.B.C).
 */
export function getJSXTagName(element: t.JSXElement): string {
  return resolveJSXName(element.openingElement.name);
}

/**
 * Find the most specific JSX element with a data-uniq-id at a given source position.
 * Combines findElementAtPosition + getUuidFromElement + getJSXTagName.
 * Fixes the member expression bug from AstService (returns 'Dialog.Portal' instead of 'unknown').
 */
export function findElementWithUuidAtPosition(
  ast: t.File,
  line: number,
  column: number,
): { uuid: string; tagName: string } | null {
  let bestMatch: {
    uuid: string;
    tagName: string;
    size: number;
  } | null = null;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const loc = path.node.loc;
      if (!loc) return;

      const isWithin =
        (line > loc.start.line || (line === loc.start.line && column >= loc.start.column)) &&
        (line < loc.end.line || (line === loc.end.line && column <= loc.end.column));

      if (!isWithin) return;

      const uuid = getUuidFromElement(path.node);
      if (!uuid) return;

      const size = (loc.end.line - loc.start.line) * 1000 + (loc.end.column - loc.start.column);

      if (!bestMatch || size < bestMatch.size) {
        bestMatch = { uuid, tagName: getJSXTagName(path.node), size };
      }
    },
  });

  if (bestMatch) {
    const { uuid, tagName } = bestMatch;
    return { uuid, tagName };
  }

  return null;
}

function resolveJSXName(name: t.JSXIdentifier | t.JSXMemberExpression | t.JSXNamespacedName): string {
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }
  if (t.isJSXMemberExpression(name)) {
    return `${resolveJSXName(name.object)}.${name.property.name}`;
  }
  // JSXNamespacedName (rare: <xml:space>)
  return `${name.namespace.name}:${name.name.name}`;
}
