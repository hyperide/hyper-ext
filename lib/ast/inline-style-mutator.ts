/**
 * AST utilities for writing React inline style fallbacks.
 *
 * Used when className is a CSS Modules expression. In that case appending
 * Tailwind classes to className is not a valid generic CSS write path.
 */

import * as t from '@babel/types';
import { containsCssModuleClassReference, getCssModuleImportLocalNames } from './css-module-references';
import { getAttribute, setAttribute } from './mutator';

const LENGTH_STYLE_KEYS = new Set([
  'width',
  'height',
  'minWidth',
  'minHeight',
  'maxWidth',
  'maxHeight',
  'top',
  'right',
  'bottom',
  'left',
  'inset',
  'insetBlock',
  'insetBlockEnd',
  'insetBlockStart',
  'insetInline',
  'insetInlineEnd',
  'insetInlineStart',
  'margin',
  'marginTop',
  'marginRight',
  'marginBottom',
  'marginLeft',
  'marginBlock',
  'marginBlockEnd',
  'marginBlockStart',
  'marginInline',
  'marginInlineEnd',
  'marginInlineStart',
  'padding',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'paddingBlock',
  'paddingBlockEnd',
  'paddingBlockStart',
  'paddingInline',
  'paddingInlineEnd',
  'paddingInlineStart',
  'gap',
  'rowGap',
  'columnGap',
  'fontSize',
  'letterSpacing',
  'wordSpacing',
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderRadius',
  'borderTopLeftRadius',
  'borderTopRightRadius',
  'borderBottomRightRadius',
  'borderBottomLeftRadius',
  'outlineWidth',
  'outlineOffset',
  'flexBasis',
]);

export { getCssModuleImportLocalNames };

/**
 * True for className expressions that reference a CSS Modules import, e.g.
 * className={styles.app} or className={clsx(styles.app, active && styles.on)}.
 */
export function isCssModuleClassNameExpression(element: t.JSXElement, cssModuleLocals: Set<string>): boolean {
  if (cssModuleLocals.size === 0) return false;

  const attr = getAttribute(element, 'className');
  if (!attr || !t.isJSXExpressionContainer(attr)) return false;
  if (t.isJSXEmptyExpression(attr.expression)) return false;

  return containsCssModuleClassReference(attr.expression, cssModuleLocals);
}

/**
 * Merge style updates into the JSX style attribute.
 * Unitless length values are normalized to px for React inline styles.
 */
export function applyInlineStyleUpdate(element: t.JSXElement, styles: Record<string, string>): string[] {
  const updates = new Map<string, t.Expression>();

  for (const [rawKey, rawValue] of Object.entries(styles)) {
    const key = toReactStyleKey(rawKey);
    const value = normalizeInlineStyleValue(key, rawValue);
    if (value === null) continue;

    updates.set(key, t.stringLiteral(value));
  }

  if (updates.size === 0) return [];

  const styleAttr = getAttribute(element, 'style');
  const styleObject = createMergedStyleObject(styleAttr, updates);
  setAttribute(element, 'style', t.jsxExpressionContainer(styleObject));

  return [...updates.keys()];
}

function createMergedStyleObject(
  styleAttr: t.JSXAttribute['value'] | null,
  updates: Map<string, t.Expression>,
): t.ObjectExpression {
  const updateProperties = [...updates.entries()].map(([key, value]) => createStyleProperty(key, value));

  if (!styleAttr || t.isStringLiteral(styleAttr)) {
    return t.objectExpression(updateProperties);
  }

  if (!t.isJSXExpressionContainer(styleAttr) || t.isJSXEmptyExpression(styleAttr.expression)) {
    return t.objectExpression(updateProperties);
  }

  const expression = styleAttr.expression;

  if (t.isObjectExpression(expression)) {
    const preservedProperties = expression.properties.filter((property) => {
      if (!t.isObjectProperty(property)) return true;

      const propertyName = getObjectPropertyName(property);
      return !propertyName || !updates.has(propertyName);
    });

    return t.objectExpression([...preservedProperties, ...updateProperties]);
  }

  if (t.isExpression(expression)) {
    return t.objectExpression([t.spreadElement(t.cloneNode(expression)), ...updateProperties]);
  }

  return t.objectExpression(updateProperties);
}

function createStyleProperty(key: string, value: t.Expression): t.ObjectProperty {
  return t.objectProperty(createStylePropertyKey(key), value);
}

function createStylePropertyKey(key: string): t.Identifier | t.StringLiteral {
  if (/^[A-Za-z_$][\w$]*$/.test(key) && !key.startsWith('--')) {
    return t.identifier(key);
  }
  return t.stringLiteral(key);
}

function getObjectPropertyName(property: t.ObjectProperty): string | null {
  const { key } = property;

  if (t.isIdentifier(key) && !property.computed) return key.name;
  if (t.isStringLiteral(key)) return key.value;
  if (t.isNumericLiteral(key)) return String(key.value);

  return null;
}

function toReactStyleKey(key: string): string {
  if (key.startsWith('--')) return key;

  return key.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
}

function normalizeInlineStyleValue(key: string, value: string): string | null {
  const trimmed = String(value).trim();
  if (!trimmed) return null;

  if (isLengthStyleKey(key) && isUnitlessNumber(trimmed) && Number(trimmed) !== 0) {
    return `${trimmed}px`;
  }

  return trimmed;
}

function isLengthStyleKey(key: string): boolean {
  return LENGTH_STYLE_KEYS.has(key);
}

function isUnitlessNumber(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value);
}
