/**
 * Interactive Element Detector
 *
 * Identifies JSX elements that should receive data-test-id attributes
 * based on element type, attributes, and event handlers
 */

import * as t from '@babel/types';

import type { InteractiveElement, InteractiveElementType } from '../types';
import { generateSemanticTestId } from '../utils/naming';

/**
 * Radix/shadcn trigger patterns (components ending with these)
 */
const TRIGGER_SUFFIXES = ['Trigger', 'Close', 'Cancel', 'Confirm', 'Toggle', 'Dismiss'];

/**
 * Interactive ARIA roles
 */
const INTERACTIVE_ROLES = new Set([
  'button',
  'checkbox',
  'combobox',
  'gridcell',
  'link',
  'listbox',
  'menu',
  'menubar',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'option',
  'progressbar',
  'radio',
  'scrollbar',
  'searchbox',
  'slider',
  'spinbutton',
  'switch',
  'tab',
  'tabpanel',
  'textbox',
  'treeitem',
]);

/**
 * Event handlers that indicate interactivity
 */
const INTERACTIVE_HANDLERS = new Set([
  'onClick',
  'onDoubleClick',
  'onChange',
  'onInput',
  'onSubmit',
  'onFocus',
  'onBlur',
  'onKeyDown',
  'onKeyUp',
  'onKeyPress',
  'onMouseDown',
  'onMouseUp',
  'onPointerDown',
  'onPointerUp',
  'onTouchStart',
  'onTouchEnd',
  'onDragStart',
  'onDrop',
]);

/**
 * Extract string value from JSX attribute
 */
function getAttributeStringValue(value: t.JSXAttribute['value']): string | null {
  if (!value) return null;

  if (t.isStringLiteral(value)) {
    return value.value;
  }

  if (t.isJSXExpressionContainer(value)) {
    const expr = value.expression;
    if (t.isStringLiteral(expr)) {
      return expr.value;
    }
    if (t.isTemplateLiteral(expr) && expr.expressions.length === 0) {
      return expr.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
    }
  }

  return null;
}

/**
 * Get element tag name (lowercase for native, original case for components)
 */
function getTagName(element: t.JSXElement): string {
  const name = element.openingElement.name;

  if (t.isJSXIdentifier(name)) {
    return name.name;
  }

  if (t.isJSXMemberExpression(name)) {
    // Handle Namespace.Component pattern
    const parts: string[] = [];
    let current: t.JSXMemberExpression | t.JSXIdentifier = name;

    while (t.isJSXMemberExpression(current)) {
      parts.unshift(current.property.name);
      current = current.object;
    }

    if (t.isJSXIdentifier(current)) {
      parts.unshift(current.name);
    }

    return parts.join('.');
  }

  return '';
}

/**
 * Get attribute by name from JSX element
 */
function getAttribute(element: t.JSXElement, attributeName: string): t.JSXAttribute | null {
  for (const attr of element.openingElement.attributes) {
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === attributeName) {
      return attr;
    }
  }
  return null;
}

/**
 * Get handler name from attribute (e.g., onClick={handleSubmit} -> 'handleSubmit')
 */
function getHandlerName(element: t.JSXElement, handlerNames: string[]): string | null {
  for (const name of handlerNames) {
    const attr = getAttribute(element, name);
    if (attr?.value && t.isJSXExpressionContainer(attr.value)) {
      const expr = attr.value.expression;
      if (t.isIdentifier(expr)) {
        return expr.name;
      }
      if (t.isMemberExpression(expr) && t.isIdentifier(expr.property)) {
        return expr.property.name;
      }
    }
  }
  return null;
}

/**
 * Extract text content from JSX children
 */
function extractChildrenText(element: t.JSXElement): string {
  const textParts: string[] = [];

  for (const child of element.children) {
    if (t.isJSXText(child)) {
      const trimmed = child.value.trim();
      if (trimmed) {
        textParts.push(trimmed);
      }
    } else if (t.isJSXExpressionContainer(child)) {
      if (t.isStringLiteral(child.expression)) {
        textParts.push(child.expression.value);
      }
    }
  }

  return textParts.join(' ');
}

/**
 * Determine interactive element type based on tag and attributes
 */
function determineInteractiveType(tagName: string, element: t.JSXElement): InteractiveElementType | null {
  const lowerTag = tagName.toLowerCase();

  // Native elements
  if (lowerTag === 'button') return 'button';
  if (lowerTag === 'select') return 'select';
  if (lowerTag === 'textarea') return 'textarea';

  if (lowerTag === 'a') {
    // Only links with href are interactive
    if (getAttribute(element, 'href')) {
      return 'a';
    }
    // Links with onClick are also interactive
    if (getAttribute(element, 'onClick')) {
      return 'button'; // Treat as button semantically
    }
    return null;
  }

  if (lowerTag === 'input') {
    const typeAttr = getAttribute(element, 'type');
    const inputType = typeAttr ? getAttributeStringValue(typeAttr.value) : 'text';

    if (inputType === 'checkbox') return 'checkbox';
    if (inputType === 'radio') return 'radio';
    if (inputType === 'range') return 'slider';
    if (inputType === 'submit' || inputType === 'button') return 'button';
    return 'input';
  }

  // Radix/shadcn trigger patterns
  for (const suffix of TRIGGER_SUFFIXES) {
    if (tagName.endsWith(suffix)) {
      if (tagName.includes('Dialog')) return 'dialog-trigger';
      if (tagName.includes('Dropdown')) return 'dropdown-trigger';
      if (tagName.includes('Popover')) return 'popover-trigger';
      if (tagName.includes('Accordion')) return 'accordion-trigger';
      if (tagName.includes('Tab')) return 'tab-trigger';
      if (tagName.includes('Menu')) return 'menu-trigger';
      if (tagName.includes('Combobox')) return 'combobox-trigger';
      if (tagName.includes('Tooltip')) return 'tooltip-trigger';
      // Generic trigger/close
      if (suffix === 'Close' || suffix === 'Dismiss') return 'button';
      return 'button';
    }
  }

  // Check for role attribute
  const roleAttr = getAttribute(element, 'role');
  if (roleAttr) {
    const role = getAttributeStringValue(roleAttr.value);
    if (role && INTERACTIVE_ROLES.has(role)) {
      if (role === 'button') return 'button';
      if (role === 'checkbox') return 'checkbox';
      if (role === 'radio') return 'radio';
      if (role === 'switch') return 'switch';
      if (role === 'slider') return 'slider';
      if (role === 'tab') return 'tab-trigger';
      if (role === 'link') return 'a';
      if (role === 'textbox' || role === 'searchbox') return 'input';
      if (role === 'combobox') return 'combobox-trigger';
      if (role === 'listbox') return 'select';
      return 'button'; // Fallback for other interactive roles
    }
  }

  // Check for event handlers
  const hasInteractiveHandler = Array.from(INTERACTIVE_HANDLERS).some(
    (handler) => getAttribute(element, handler) !== null,
  );

  if (hasInteractiveHandler) {
    // Elements with onClick are effectively buttons
    if (getAttribute(element, 'onClick')) {
      return 'button';
    }
    if (getAttribute(element, 'onChange')) {
      return 'input';
    }
  }

  return null;
}

/**
 * Detect if a JSX element is interactive and extract its info
 */
export function detectInteractiveElement(
  element: t.JSXElement,
  componentContext: string,
  existingIds: Set<string>,
): InteractiveElement | null {
  const tagName = getTagName(element);
  if (!tagName) return null;

  const interactiveType = determineInteractiveType(tagName, element);
  if (!interactiveType) return null;

  // Extract context for naming
  const ariaLabel = getAttributeStringValue(getAttribute(element, 'aria-label')?.value ?? null);
  const placeholder = getAttributeStringValue(getAttribute(element, 'placeholder')?.value ?? null);
  const name = getAttributeStringValue(getAttribute(element, 'name')?.value ?? null);
  const role = getAttributeStringValue(getAttribute(element, 'role')?.value ?? null);
  const inputType = getAttributeStringValue(getAttribute(element, 'type')?.value ?? null);
  const children = extractChildrenText(element);
  const handler = getHandlerName(element, ['onClick', 'onChange', 'onSubmit']);

  // Check for existing test IDs
  const existingTestId = getAttributeStringValue(getAttribute(element, 'data-test-id')?.value ?? null);
  const existingUniqId = getAttributeStringValue(getAttribute(element, 'data-uniq-id')?.value ?? null);

  const context = {
    ariaLabel: ariaLabel ?? undefined,
    placeholder: placeholder ?? undefined,
    children: children || undefined,
    name: name ?? undefined,
    inputType: inputType ?? undefined,
    role: role ?? undefined,
    handler: handler ?? undefined,
  };

  // Always generate semantic test ID (AI will enhance it later)
  // Don't skip generation even if existingTestId exists - AI should always have a chance to improve
  const suggestedTestId = generateSemanticTestId(context, interactiveType, componentContext, existingIds);

  // Get location info
  const loc = element.loc;

  return {
    type: interactiveType,
    suggestedTestId,
    tagName,
    line: loc?.start.line ?? 0,
    column: loc?.start.column ?? 0,
    context,
    existingTestId: existingTestId ?? undefined,
    existingUniqId: existingUniqId ?? undefined,
  };
}

/**
 * Check if an element is interactive (quick check without full extraction)
 */
export function isInteractiveElement(element: t.JSXElement): boolean {
  const tagName = getTagName(element);
  return determineInteractiveType(tagName, element) !== null;
}

/**
 * Get all interactive elements from a list of JSX elements
 */
export function findInteractiveElements(
  elements: Array<{ element: t.JSXElement; line?: number }>,
  componentContext: string,
): InteractiveElement[] {
  const existingIds = new Set<string>();
  const result: InteractiveElement[] = [];

  for (const { element } of elements) {
    const interactive = detectInteractiveElement(element, componentContext, existingIds);
    if (interactive) {
      existingIds.add(interactive.suggestedTestId);
      result.push(interactive);
    }
  }

  return result;
}
