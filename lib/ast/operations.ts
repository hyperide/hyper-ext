/**
 * High-level AST mutation operations
 *
 * Pure AST operations — take parsed AST, mutate in place, return result.
 * Extracted from AstService for reuse across server and extension.
 */

import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import type { FindElementResult } from '../types';
import { calculateRealIndex } from './element-builder';
import { cloneElement, makeNotSelfClosing, valueToJSXAttribute } from './mutator';
import { parseCode } from './parser';

// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

/**
 * Insert a JSX element into an AST at the given parent or at root return.
 * Accepts a pre-resolved parent element (from findElementByPosition or resolveElement).
 */
export function insertElementIntoAST(
  ast: t.File,
  opts: {
    parent: FindElementResult | null;
    newElement: t.JSXElement;
    logicalIndex?: number;
  },
): { inserted: boolean; actualIndex?: number } {
  const { parent, newElement, logicalIndex } = opts;
  let inserted = false;
  let actualIndex: number | undefined;

  if (!parent) {
    // Insert at root level - find return statement
    traverse(ast, {
      ReturnStatement(path: NodePath<t.ReturnStatement>) {
        if (t.isJSXElement(path.node.argument)) {
          const returnElement = path.node.argument;
          makeNotSelfClosing(returnElement);

          const jsxElementCount = returnElement.children.filter((c) => t.isJSXElement(c)).length;

          if (logicalIndex !== undefined && logicalIndex >= 0 && logicalIndex <= jsxElementCount) {
            const realIndex = calculateRealIndex(returnElement.children, logicalIndex);
            returnElement.children.splice(realIndex, 0, newElement);
            actualIndex = logicalIndex;
          } else {
            actualIndex = jsxElementCount;
            returnElement.children.push(newElement);
          }

          inserted = true;
          path.stop();
        }
      },
    });
  } else {
    makeNotSelfClosing(parent.element);

    const jsxElementCount = parent.element.children.filter((c) => t.isJSXElement(c)).length;

    if (logicalIndex !== undefined && logicalIndex >= 0 && logicalIndex <= jsxElementCount) {
      const realIndex = calculateRealIndex(parent.element.children, logicalIndex);
      parent.element.children.splice(realIndex, 0, newElement);
      actualIndex = logicalIndex;
    } else {
      actualIndex = jsxElementCount;
      parent.element.children.push(newElement);
    }

    inserted = true;
  }

  return { inserted, actualIndex };
}

/**
 * Duplicate a JSX element. Inserts the clone after the original.
 * Accepts a pre-resolved element (from findElementByPosition or resolveElement).
 */
export function duplicateElementInAST(result: FindElementResult): { inserted: boolean } {
  const clonedElement = cloneElement(result.element);

  // Insert after original - handle JSXElement parent
  const parent = result.path.parent;
  let inserted = false;

  if (t.isJSXElement(parent)) {
    const children = parent.children;
    const index = children.indexOf(result.path.node);
    if (index !== -1) {
      children.splice(index + 1, 0, clonedElement);
      inserted = true;
    }
  }

  return { inserted };
}

/**
 * Wrap a JSX element in a new container element.
 * The original element becomes a child of the new wrapper.
 * Accepts a pre-resolved element (from findElementByPosition or resolveElement).
 */
export function wrapElementInAST(
  result: FindElementResult,
  wrapperType: string,
  wrapperProps?: Record<string, unknown>,
): { wrapped: boolean } {
  const wrapperAttrs: t.JSXAttribute[] = [];

  if (wrapperProps) {
    for (const [key, value] of Object.entries(wrapperProps)) {
      const attrValue = valueToJSXAttribute(value);
      if (attrValue !== null) {
        wrapperAttrs.push(t.jsxAttribute(t.jsxIdentifier(key), attrValue));
      }
    }
  }

  const wrapper = t.jsxElement(
    t.jsxOpeningElement(t.jsxIdentifier(wrapperType), wrapperAttrs),
    t.jsxClosingElement(t.jsxIdentifier(wrapperType)),
    [result.path.node],
    false,
  );

  result.path.replaceWith(wrapper);
  return { wrapped: true };
}

/**
 * Parse a TSX code string into JSX elements.
 */
export function parseTSXElements(tsxCode: string): {
  elements: t.JSXElement[];
} {
  if (!tsxCode.trim()) {
    return { elements: [] };
  }

  // Wrap in fragment; try {code} first (for expressions), fall back to plain wrap
  let parsedAst: t.File;
  try {
    parsedAst = parseCode(`<>{${tsxCode}}</>`);
  } catch {
    parsedAst = parseCode(`<>${tsxCode}</>`);
  }

  const newElements: t.JSXElement[] = [];
  traverse(parsedAst, {
    JSXFragment(path: NodePath<t.JSXFragment>) {
      for (const child of path.node.children) {
        if (t.isJSXElement(child)) {
          newElements.push(child);
        } else if (t.isJSXExpressionContainer(child) && t.isJSXElement(child.expression)) {
          newElements.push(child.expression);
        }
      }
      path.stop();
    },
  });

  return { elements: newElements };
}

/**
 * Extract source code of a JSX element from the original source string.
 * Uses element location info to substring the source.
 */
export function extractElementSource(sourceCode: string, element: t.JSXElement): string | null {
  if (!element.loc) return null;

  const { start, end } = element.loc;
  const lines = sourceCode.split('\n');

  const startOffset = lines.slice(0, start.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + start.column;
  const endOffset = lines.slice(0, end.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + end.column;

  return sourceCode.substring(startOffset, endOffset);
}
