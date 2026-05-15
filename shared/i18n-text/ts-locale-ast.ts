/**
 * @file AST helpers for static TypeScript/JavaScript locale object files.
 *
 * Accessed via: i18n text inspector resource resolution and write path
 * Assumptions: locale modules expose a static object literal; dynamic imports,
 * computed keys, spreads, and function-built dictionaries are treated read-only.
 */

import _generate from '@babel/generator';
import { parse as babelParse } from '@babel/parser';
import type { NodePath } from '@babel/traverse';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

const generate = (_generate as { default?: typeof _generate }).default ?? _generate;
// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

const DICTIONARY_NAMES = new Set(['translations', 'messages']);
const FORBIDDEN_KEY_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

export interface TsLocaleObject {
  kind: 'merged' | 'single';
  data: Record<string, unknown>;
  locales: string[];
}

export interface TsDomTextHit {
  key: string;
  locale: string;
  resolvedText: string;
  filePath: string;
  matchType: 'value' | 'key';
}

function parseModule(content: string): t.File | null {
  try {
    return babelParse(content, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as t.File;
  } catch {
    return null;
  }
}

function unwrapExpression(node: t.Expression | t.PrivateName | null | undefined): t.Expression | null {
  if (!node || t.isPrivateName(node)) return null;
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTypeCastExpression(node)) {
    return unwrapExpression(node.expression);
  }
  return node;
}

function getPropertyName(prop: t.ObjectProperty): string | null {
  if (prop.computed) return null;
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  if (t.isNumericLiteral(prop.key)) return String(prop.key.value);
  return null;
}

function getObjectProperty(object: t.ObjectExpression, key: string): t.ObjectProperty | null {
  for (const prop of object.properties) {
    if (!t.isObjectProperty(prop)) continue;
    if (getPropertyName(prop) === key) return prop;
  }
  return null;
}

function objectFromExpression(node: t.Expression | null | undefined): t.ObjectExpression | null {
  const expr = unwrapExpression(node);
  return expr && t.isObjectExpression(expr) ? expr : null;
}

function extractObjectLiteral(node: t.ObjectExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of node.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const key = getPropertyName(prop);
    if (!key) continue;
    const value = unwrapExpression(prop.value as t.Expression);
    if (t.isObjectExpression(value)) {
      result[key] = extractObjectLiteral(value);
    } else if (t.isStringLiteral(value)) {
      result[key] = value.value;
    } else if (t.isTemplateLiteral(value) && value.expressions.length === 0) {
      result[key] = value.quasis.map((q) => q.value.cooked ?? q.value.raw).join('');
    }
  }
  return result;
}

function findDictionaryObject(ast: t.File): t.ObjectExpression | null {
  let found: t.ObjectExpression | null = null;

  traverse(ast, {
    VariableDeclarator(path: NodePath<t.VariableDeclarator>) {
      if (found) return;
      const { id, init } = path.node;
      if (!t.isIdentifier(id) || !DICTIONARY_NAMES.has(id.name)) return;
      found = objectFromExpression(init);
    },
    ExportDefaultDeclaration(path: NodePath<t.ExportDefaultDeclaration>) {
      if (found) return;
      const declaration = path.node.declaration;
      if (!t.isExpression(declaration)) return;
      found = objectFromExpression(declaration);
    },
    AssignmentExpression(path: NodePath<t.AssignmentExpression>) {
      if (found) return;
      const { left, right } = path.node;
      if (
        t.isMemberExpression(left) &&
        t.isIdentifier(left.object, { name: 'module' }) &&
        t.isIdentifier(left.property, { name: 'exports' })
      ) {
        found = objectFromExpression(right);
      }
    },
  });

  return found;
}

function classifyObject(root: t.ObjectExpression, activeLocale?: string): TsLocaleObject {
  const rootData = extractObjectLiteral(root);
  const locales = Object.entries(rootData)
    .filter(([, value]) => typeof value === 'object' && value !== null)
    .map(([key]) => key);

  if (activeLocale && Object.hasOwn(rootData, activeLocale) && typeof rootData[activeLocale] === 'object') {
    return { kind: 'merged', data: rootData, locales };
  }

  if (locales.length >= 2) {
    return { kind: 'merged', data: rootData, locales };
  }

  return { kind: 'single', data: rootData, locales: activeLocale ? [activeLocale] : [] };
}

export function parseTsLocaleObject(content: string, activeLocale?: string): TsLocaleObject | null {
  const ast = parseModule(content);
  if (!ast) return null;
  const root = findDictionaryObject(ast);
  if (!root) return null;
  return classifyObject(root, activeLocale);
}

export function resolveLocaleKey(data: unknown, key: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  if (Object.hasOwn(obj, key)) {
    const value = obj[key];
    return typeof value === 'string' ? value : null;
  }

  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

function findByValue(obj: unknown, target: string, prefix = ''): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string' && value === target) return path;
    if (typeof value === 'object') {
      const found = findByValue(value, target, path);
      if (found) return found;
    }
  }
  return null;
}

export function findTsDomTextHit(
  parsed: TsLocaleObject,
  domText: string,
  filePath: string,
  activeLocale?: string,
): TsDomTextHit | null {
  if (parsed.kind === 'merged') {
    const locales = activeLocale
      ? [activeLocale, ...parsed.locales.filter((locale) => locale !== activeLocale)]
      : parsed.locales;
    for (const locale of locales) {
      const localeData = parsed.data[locale];
      const keyByValue = findByValue(localeData, domText);
      if (keyByValue) return { key: keyByValue, locale, resolvedText: domText, filePath, matchType: 'value' };
      const valueByKey = resolveLocaleKey(localeData, domText);
      if (valueByKey !== null) return { key: domText, locale, resolvedText: valueByKey, filePath, matchType: 'key' };
    }
    return null;
  }

  const keyByValue = findByValue(parsed.data, domText);
  if (keyByValue) {
    return {
      key: keyByValue,
      locale: activeLocale ?? parsed.locales[0] ?? 'en',
      resolvedText: domText,
      filePath,
      matchType: 'value',
    };
  }
  const valueByKey = resolveLocaleKey(parsed.data, domText);
  if (valueByKey !== null) {
    return {
      key: domText,
      locale: activeLocale ?? parsed.locales[0] ?? 'en',
      resolvedText: valueByKey,
      filePath,
      matchType: 'key',
    };
  }
  return null;
}

function setStringProperty(object: t.ObjectExpression, key: string, value: string): boolean {
  const parts = key.split('.');
  if (parts.some((part) => FORBIDDEN_KEY_PARTS.has(part))) return false;

  const literalProp = getObjectProperty(object, key);
  if (literalProp) {
    literalProp.value = t.stringLiteral(value);
    return true;
  }

  let current = object;
  for (let i = 0; i < parts.length - 1; i++) {
    const prop = getObjectProperty(current, parts[i]);
    if (!prop) {
      const child = t.objectExpression([]);
      current.properties.push(t.objectProperty(t.identifier(parts[i]), child));
      current = child;
      continue;
    }
    const propObject = objectFromExpression(prop.value as t.Expression);
    if (!propObject) return false;
    current = propObject;
  }

  const leaf = parts[parts.length - 1];
  const leafProp = getObjectProperty(current, leaf);
  if (leafProp) {
    leafProp.value = t.stringLiteral(value);
  } else {
    current.properties.push(t.objectProperty(t.identifier(leaf), t.stringLiteral(value)));
  }
  return true;
}

export function writeTsLocaleValue(content: string, activeLocale: string, key: string, value: string): string | null {
  const ast = parseModule(content);
  if (!ast) return null;
  const root = findDictionaryObject(ast);
  if (!root) return null;
  const parsed = classifyObject(root, activeLocale);

  let targetObject = root;
  if (parsed.kind === 'merged') {
    const localeProp = getObjectProperty(root, activeLocale);
    if (!localeProp) return null;
    const localeObject = objectFromExpression(localeProp.value as t.Expression);
    if (!localeObject) return null;
    targetObject = localeObject;
  }

  if (!setStringProperty(targetObject, key, value)) return null;
  // jsescOption.minimal keeps non-ASCII code points verbatim instead of emitting
  // \uXXXX escapes for freshly-built `t.stringLiteral` nodes. Pre-existing literals
  // ride through retainLines untouched, but new ones go through jsesc by default.
  return generate(ast, { retainLines: true, jsescOption: { minimal: true } }).code;
}
