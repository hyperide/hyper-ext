/**
 * UUID management utilities for JSX elements
 * Handles generation and recursive updating of data-uniq-id attributes
 */

import { randomUUID } from 'node:crypto';
import * as t from '@babel/types';
import { setAttribute } from './mutator';

/**
 * Generate a new UUID
 * @returns UUID string
 */
export function generateUuid(): string {
  return randomUUID();
}

/**
 * Recursively update all data-uniq-id attributes in element's children
 * Generates new UUIDs for all nested JSX elements
 * @param element - Root element to start from
 */
export function updateAllChildUuids(element: t.JSXElement): void {
  function updateUuidsRecursive(node: t.Node): void {
    if (t.isJSXElement(node)) {
      // Generate new UUID for this element
      const newUuid = generateUuid();
      setAttribute(node, 'data-uniq-id', t.stringLiteral(newUuid));

      // Process all children
      node.children.forEach((child) => {
        if (t.isJSXElement(child)) {
          updateUuidsRecursive(child);
        } else if (t.isJSXExpressionContainer(child)) {
          // Handle expressions that might contain JSX
          if (child.expression && !t.isJSXEmptyExpression(child.expression)) {
            traverseExpression(child.expression);
          }
        }
      });
    }
  }

  function traverseExpression(node: t.Node): void {
    if (t.isJSXElement(node)) {
      updateUuidsRecursive(node);
    } else if (t.isConditionalExpression(node)) {
      // Handle ternary: condition ? <A /> : <B />
      traverseExpression(node.consequent);
      traverseExpression(node.alternate);
    } else if (t.isLogicalExpression(node)) {
      // Handle &&, ||
      traverseExpression(node.left);
      traverseExpression(node.right);
    } else if (t.isCallExpression(node)) {
      // Handle .map() and other calls
      node.arguments.forEach((arg) => {
        if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
          traverseExpression(arg.body);
        }
      });
    } else if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
      traverseExpression(node.body);
    } else if (t.isBlockStatement(node)) {
      node.body.forEach((statement) => {
        if (t.isReturnStatement(statement) && statement.argument) {
          traverseExpression(statement.argument);
        }
      });
    } else if (t.isArrayExpression(node)) {
      node.elements.forEach((element) => {
        if (element) {
          traverseExpression(element);
        }
      });
    }
  }

  // Update children only, not the element itself
  element.children.forEach((child) => {
    if (t.isJSXElement(child)) {
      updateUuidsRecursive(child);
    } else if (t.isJSXExpressionContainer(child)) {
      if (child.expression && !t.isJSXEmptyExpression(child.expression)) {
        traverseExpression(child.expression);
      }
    }
  });
}

/**
 * Add data-uniq-id attribute to element if it doesn't exist
 * @param element - Element to add UUID to
 * @param uuid - Optional UUID to use (generates new one if not provided)
 * @returns The UUID that was set
 */
export function ensureUuid(element: t.JSXElement, uuid?: string): string {
  const finalUuid = uuid || generateUuid();
  setAttribute(element, 'data-uniq-id', t.stringLiteral(finalUuid));
  return finalUuid;
}

/**
 * Check if element has data-uniq-id attribute
 */
export function hasUuid(element: t.JSXElement): boolean {
  return element.openingElement.attributes.some(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
  );
}

/**
 * Remove data-uniq-id attribute from element
 */
export function removeUuid(element: t.JSXElement): void {
  const index = element.openingElement.attributes.findIndex(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
  );

  if (index !== -1) {
    element.openingElement.attributes.splice(index, 1);
  }
}
