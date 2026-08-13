/**
 * @file AST walker for inline i18next resources declared in init()/addResourceBundle()/createI18n().
 *
 * Accessed via: I18nextResourcesAdapter. Pure AST; read-only (mutating an inline
 *   ObjectExpression two levels deep is a separate write path — deferred).
 * Assumptions: resources are static object literals. Spread/computed/dynamic values are
 *   skipped (the deliberate read-only fall-through), never guessed. No semantics.
 *
 * Produces a normalized `{ [locale]: { [namespace]: nestedObject } }` map. The default
 * i18next namespace is 'translation'; createI18n({messages}) is treated as `{ [locale]: obj }`
 * with the whole locale object under the default namespace.
 */

import { parse as babelParse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';

// @ts-expect-error - babel/traverse ESM/CJS interop
const traverse = _traverse.default || _traverse;

const DEFAULT_NS = 'translation';

/** locale -> namespace -> nested dictionary object. */
export type I18nextResources = Record<string, Record<string, unknown>>;

function parseModule(content: string): t.File | null {
  try {
    return babelParse(content, { sourceType: 'module', plugins: ['typescript', 'jsx'] }) as t.File;
  } catch {
    return null;
  }
}

function unwrap(node: t.Expression | t.PrivateName | null | undefined): t.Expression | null {
  if (!node || t.isPrivateName(node)) return null;
  if (t.isTSAsExpression(node) || t.isTSSatisfiesExpression(node) || t.isTypeCastExpression(node)) {
    return unwrap(node.expression);
  }
  return node;
}

function propName(prop: t.ObjectProperty): string | null {
  if (prop.computed) return null;
  if (t.isIdentifier(prop.key)) return prop.key.name;
  if (t.isStringLiteral(prop.key)) return prop.key.value;
  if (t.isNumericLiteral(prop.key)) return String(prop.key.value);
  return null;
}

/** Plain JS value extraction for a static object literal (strings + nested objects only). */
function extractObjectLiteral(node: t.ObjectExpression): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const prop of node.properties) {
    if (!t.isObjectProperty(prop)) continue;
    const key = propName(prop);
    if (!key) continue;
    const value = unwrap(prop.value as t.Expression);
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

function findProp(obj: t.ObjectExpression, name: string): t.Expression | null {
  for (const prop of obj.properties) {
    if (t.isObjectProperty(prop) && propName(prop) === name) {
      return unwrap(prop.value as t.Expression);
    }
  }
  return null;
}

function mergeInto(target: I18nextResources, locale: string, ns: string, data: Record<string, unknown>): void {
  const localeBucket = (target[locale] ??= {});
  localeBucket[ns] = { ...(localeBucket[ns] as Record<string, unknown> | undefined), ...data };
}

/**
 * Walk a `{ [locale]: { [ns]: {...} } }` resources object into the normalized map.
 * i18next's canonical shape is two-level (locale -> ns -> keys).
 */
function ingestResources(target: I18nextResources, resources: t.ObjectExpression): void {
  const top = extractObjectLiteral(resources);
  for (const [locale, nsMap] of Object.entries(top)) {
    if (typeof nsMap !== 'object' || nsMap === null) continue;
    for (const [ns, data] of Object.entries(nsMap as Record<string, unknown>)) {
      if (typeof data === 'object' && data !== null) {
        mergeInto(target, locale, ns, data as Record<string, unknown>);
      }
    }
  }
}

/**
 * Walk a `createI18n({ messages: { [locale]: {...} } })` map: the locale object IS the
 * dictionary, placed under the default namespace (vue-i18n / next-intl style flat-by-locale).
 */
function ingestMessages(target: I18nextResources, messages: t.ObjectExpression): void {
  const top = extractObjectLiteral(messages);
  for (const [locale, data] of Object.entries(top)) {
    if (typeof data === 'object' && data !== null) {
      mergeInto(target, locale, DEFAULT_NS, data as Record<string, unknown>);
    }
  }
}

const INIT_CALLEES = new Set(['init']);
const BUNDLE_CALLEES = new Set(['addResourceBundle']);
const FACTORY_CALLEES = new Set(['createI18n', 'createInstance']);

function calleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string | null {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') return callee.property.name;
  return null;
}

/**
 * Parse all inline i18next resources found in a module. Returns null when none are present
 * (so the adapter's detect() can say "not me").
 */
export function parseI18nextResources(content: string): I18nextResources | null {
  const ast = parseModule(content);
  if (!ast) return null;
  const result: I18nextResources = {};
  let found = false;

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      const name = calleeName(path.node.callee);
      if (!name) return;
      const args = path.node.arguments;

      // i18n.init({ resources: {...} }) / createI18n({ resources }) / createI18n({ messages })
      if (INIT_CALLEES.has(name) || FACTORY_CALLEES.has(name)) {
        const first = args[0];
        if (first && t.isObjectExpression(first)) {
          const resources = findProp(first, 'resources');
          if (resources && t.isObjectExpression(resources)) {
            ingestResources(result, resources);
            found = true;
          }
          const messages = findProp(first, 'messages');
          if (messages && t.isObjectExpression(messages)) {
            ingestMessages(result, messages);
            found = true;
          }
        }
        return;
      }

      // i18n.addResourceBundle(locale, ns, { ...keys })
      if (BUNDLE_CALLEES.has(name)) {
        const [localeArg, nsArg, dataArg] = args;
        if (
          localeArg &&
          t.isStringLiteral(localeArg) &&
          nsArg &&
          t.isStringLiteral(nsArg) &&
          dataArg &&
          t.isObjectExpression(dataArg)
        ) {
          mergeInto(result, localeArg.value, nsArg.value, extractObjectLiteral(dataArg));
          found = true;
        }
      }
    },
  });

  return found ? result : null;
}
