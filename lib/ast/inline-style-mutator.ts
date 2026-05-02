/**
 * AST utilities for writing React inline style fallbacks.
 *
 * Used when className is a CSS Modules expression. In that case appending
 * Tailwind classes to className is not a valid generic CSS write path.
 */

import * as t from '@babel/types';
import { getAttribute, setAttribute } from './mutator';

const CSS_MODULE_EXT_RE = /\.module\.(css|scss|sass|less|styl)(?:\?.*)?$/;

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

/**
 * Return local binding names imported from CSS Modules files.
 */
export function getCssModuleImportLocalNames(ast: t.File): Set<string> {
  const locals = new Set<string>();

  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    if (!CSS_MODULE_EXT_RE.test(node.source.value)) continue;

    for (const specifier of node.specifiers) {
      if (t.isImportDefaultSpecifier(specifier) || t.isImportNamespaceSpecifier(specifier)) {
        locals.add(specifier.local.name);
      }
    }
  }

  return locals;
}

/**
 * True for className expressions that reference a CSS Modules import, e.g.
 * className={styles.app} or className={clsx(styles.app, active && styles.on)}.
 */
export function isCssModuleClassNameExpression(element: t.JSXElement, cssModuleLocals: Set<string>): boolean {
  if (cssModuleLocals.size === 0) return false;

  const attr = getAttribute(element, 'className');
  if (!attr || !t.isJSXExpressionContainer(attr)) return false;
  if (t.isJSXEmptyExpression(attr.expression)) return false;

  return containsCssModuleMemberExpression(attr.expression, cssModuleLocals);
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

function containsCssModuleMemberExpression(node: unknown, cssModuleLocals: Set<string>): boolean {
  if (!node || typeof node !== 'object') return false;

  const maybeNode = node as t.Node;
  if (
    (t.isMemberExpression(maybeNode) || isOptionalMemberExpression(maybeNode)) &&
    isCssModuleMember(maybeNode, cssModuleLocals)
  ) {
    return true;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (
      key === 'loc' ||
      key === 'start' ||
      key === 'end' ||
      key === 'leadingComments' ||
      key === 'innerComments' ||
      key === 'trailingComments'
    ) {
      continue;
    }

    if (Array.isArray(value)) {
      if (value.some((item) => containsCssModuleMemberExpression(item, cssModuleLocals))) {
        return true;
      }
    } else if (value && typeof value === 'object' && containsCssModuleMemberExpression(value, cssModuleLocals)) {
      return true;
    }
  }

  return false;
}

function isCssModuleMember(
  node: t.MemberExpression | t.OptionalMemberExpression,
  cssModuleLocals: Set<string>,
): boolean {
  const rootName = getMemberRootIdentifierName(node);
  return rootName !== null && cssModuleLocals.has(rootName);
}

function getMemberRootIdentifierName(node: t.Expression | t.Super | t.PrivateName): string | null {
  let current: t.Expression | t.Super | t.PrivateName = node;

  while (t.isMemberExpression(current) || isOptionalMemberExpression(current)) {
    current = current.object;
  }

  if (t.isIdentifier(current)) return current.name;
  return null;
}

function isOptionalMemberExpression(node: t.Node): node is t.OptionalMemberExpression {
  return node.type === 'OptionalMemberExpression';
}
