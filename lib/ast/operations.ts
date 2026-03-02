/**
 * High-level AST mutation operations
 *
 * Pure AST operations — take parsed AST, mutate in place, return result.
 * Extracted from AstService for reuse across server and extension.
 */

import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { calculateRealIndex } from './element-builder';
import { cloneElement, makeNotSelfClosing, setAttribute, valueToJSXAttribute } from './mutator';
import { parseCode } from './parser';
import { findElementByUuid, getUuidFromElement } from './traverser';
import { ensureUuid, generateUuid, updateAllChildUuids } from './uuid';

// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

/**
 * Insert a JSX element into an AST by parent UUID or at root return.
 */
export function insertElementIntoAST(
  ast: t.File,
  opts: {
    parentId: string | null;
    newElement: t.JSXElement;
    logicalIndex?: number;
  },
): { inserted: boolean; actualIndex?: number } {
  const { parentId, newElement, logicalIndex } = opts;
  let inserted = false;
  let actualIndex: number | undefined;

  if (!parentId) {
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
    const result = findElementByUuid(ast, parentId);
    if (result) {
      makeNotSelfClosing(result.element);

      const jsxElementCount = result.element.children.filter((c) => t.isJSXElement(c)).length;

      if (logicalIndex !== undefined && logicalIndex >= 0 && logicalIndex <= jsxElementCount) {
        const realIndex = calculateRealIndex(result.element.children, logicalIndex);
        result.element.children.splice(realIndex, 0, newElement);
        actualIndex = logicalIndex;
      } else {
        actualIndex = jsxElementCount;
        result.element.children.push(newElement);
      }

      inserted = true;
    }
  }

  return { inserted, actualIndex };
}

/**
 * Duplicate a JSX element by UUID. Inserts the clone after the original.
 * Generates new UUIDs for the clone and all its children.
 * Handles both JSXElement parents and Array-like parents (e.g. .map() expressions).
 */
export function duplicateElementInAST(ast: t.File, elementId: string): { newId: string | null; inserted: boolean } {
  const result = findElementByUuid(ast, elementId);
  if (!result) {
    return { newId: null, inserted: false };
  }

  // Clone the element
  const clonedElement = cloneElement(result.element);

  // Generate new UUID for the clone
  const newId = generateUuid();
  setAttribute(clonedElement, 'data-uniq-id', t.stringLiteral(newId));

  // Recursively update all child UUIDs
  updateAllChildUuids(clonedElement);

  // Insert after original - handle both JSXElement and Array parents
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

  return { newId, inserted };
}

/**
 * Wrap a JSX element in a new container element.
 * The original element becomes a child of the new wrapper.
 */
export function wrapElementInAST(
  ast: t.File,
  elementId: string,
  wrapperType: string,
  wrapperProps?: Record<string, unknown>,
): { wrapperId: string | null; wrapped: boolean } {
  const wrapperId = generateUuid();
  let wrapped = false;

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      if (wrapped) return;

      const uuid = getUuidFromElement(path.node);
      if (uuid !== elementId) return;

      // Create wrapper attributes
      const wrapperAttrs: t.JSXAttribute[] = [
        t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral(wrapperId)),
      ];

      if (wrapperProps) {
        for (const [key, value] of Object.entries(wrapperProps)) {
          const attrValue = valueToJSXAttribute(value);
          if (attrValue !== null) {
            wrapperAttrs.push(t.jsxAttribute(t.jsxIdentifier(key), attrValue));
          }
        }
      }

      // Create wrapper element containing the original
      const wrapper = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier(wrapperType), wrapperAttrs),
        t.jsxClosingElement(t.jsxIdentifier(wrapperType)),
        [path.node],
        false,
      );

      path.replaceWith(wrapper);
      wrapped = true;
      path.stop();
    },
  });

  return { wrapperId: wrapped ? wrapperId : null, wrapped };
}

/**
 * Inject data-uniq-id attributes into all JSX elements that don't have one.
 * Replaces duplicate IDs. Returns the count of added/fixed IDs.
 */
export function injectUniqueIdsIntoAST(ast: t.File): number {
  let addedCount = 0;
  const seenIds = new Set<string>();

  traverse(ast, {
    JSXElement(path: NodePath<t.JSXElement>) {
      const existingId = getUuidFromElement(path.node);

      if (!existingId) {
        const newId = ensureUuid(path.node);
        seenIds.add(newId);
        addedCount++;
      } else if (seenIds.has(existingId)) {
        // Duplicate — regenerate
        ensureUuid(path.node);
        addedCount++;
      } else {
        seenIds.add(existingId);
      }
    },
  });

  return addedCount;
}

/**
 * Parse a TSX code string into JSX elements.
 * Generates new UUIDs for all parsed elements and their children.
 */
export function parseTSXElements(tsxCode: string): {
  elements: t.JSXElement[];
  firstId: string | null;
} {
  if (!tsxCode.trim()) {
    return { elements: [], firstId: null };
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

  // Generate new UUIDs for all elements
  let firstNewId: string | null = null;
  for (const el of newElements) {
    const newId = generateUuid();
    if (!firstNewId) firstNewId = newId;
    setAttribute(el, 'data-uniq-id', t.stringLiteral(newId));
    updateAllChildUuids(el);
  }

  return { elements: newElements, firstId: firstNewId };
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

/**
 * Find the parent element UUID by walking up the AST path.
 * Skips elements without data-uniq-id.
 */
export function findParentElementId(ast: t.File, elementId: string): string | null {
  const result = findElementByUuid(ast, elementId);
  if (!result) return null;

  let currentPath: NodePath | null = result.path.parentPath;
  while (currentPath) {
    if (currentPath.isJSXElement()) {
      const parentUuid = getUuidFromElement(currentPath.node);
      if (parentUuid) {
        return parentUuid;
      }
    }
    currentPath = currentPath.parentPath;
  }

  return null;
}

/**
 * Get UUIDs of direct JSX element children.
 */
export function getDirectChildIds(element: t.JSXElement): string[] {
  const childIds: string[] = [];
  for (const child of element.children) {
    if (t.isJSXElement(child)) {
      const uuid = getUuidFromElement(child);
      if (uuid) {
        childIds.push(uuid);
      }
    }
  }
  return childIds;
}
