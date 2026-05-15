/**
 * @file AST-based i18n binding detection.
 *
 * Accepts source text and a source location pointing at a JSX child node,
 * and determines whether it is a recognized i18n call or element.
 */
import { parse } from '@babel/parser';
import _traverse, { type NodePath } from '@babel/traverse';
import type * as t from '@babel/types';
import type { DetectI18nBindingParams, I18nBindingDetected, I18nBindingDetectionResult, I18nLibrary } from './types';

// @ts-expect-error - babel/traverse ESM/CJS interop
const traverse = _traverse.default || _traverse;

// Names accepted for any recognized library (including react-intl's formatMessage).
const KNOWN_CALL_NAMES = new Set(['t', 'translate', 'msg', 'i18n', 'formatMessage']);
// Names accepted for 'custom' library detection: generic wrappers only, not library-specific ones.
const CUSTOM_CALL_NAMES = new Set(['t', 'translate', 'msg', 'i18n']);

const JSX_COMPONENT_LIBRARY: Partial<Record<string, I18nLibrary>> = {
  FormattedMessage: 'react-intl',
  Trans: 'lingui',
};

export function detectI18nBinding(params: DetectI18nBindingParams): I18nBindingDetectionResult {
  const { source, location, library } = params;

  let ast: t.File;
  try {
    ast = parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
    }) as t.File;
  } catch {
    return { kind: 'unsupported', reason: 'unknown-wrapper' };
  }

  const { line, column } = location;
  let found: I18nBindingDetectionResult | null = null;

  traverse(ast, {
    CallExpression(path: NodePath<t.CallExpression>) {
      if (found) return;
      const nodeLoc = path.node.loc;
      if (!nodeLoc || nodeLoc.start.line !== line || nodeLoc.start.column !== column) return;

      if (library === null) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const calleeName = extractCalleeName(path.node.callee);
      const acceptedNames = library === 'custom' ? CUSTOM_CALL_NAMES : KNOWN_CALL_NAMES;
      if (!calleeName || !acceptedNames.has(calleeName)) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const firstArg = path.node.arguments[0];
      if (!firstArg) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      if (firstArg.type === 'ObjectExpression') {
        const key = extractIdFromObject(firstArg);
        if (key === null) {
          found = { kind: 'unsupported', reason: 'non-string-id' };
        } else if (key === false) {
          found = { kind: 'unsupported', reason: 'dynamic-key' };
        } else {
          found = makeDetected(library, key, nodeLoc.start);
        }
        return;
      }

      if (firstArg.type === 'StringLiteral') {
        const secondArg = path.node.arguments[1];
        if (secondArg !== undefined && secondArg.type !== 'ObjectExpression') {
          found = { kind: 'unsupported', reason: 'dynamic-key' };
          return;
        }
        const namespace = secondArg !== undefined ? extractNsFromObject(secondArg as t.ObjectExpression) : undefined;
        if (namespace === null) {
          found = { kind: 'unsupported', reason: 'dynamic-key' };
          return;
        }
        found = makeDetected(library, firstArg.value, nodeLoc.start, namespace);
        return;
      }

      found = { kind: 'unsupported', reason: 'dynamic-key' };
    },

    TaggedTemplateExpression(path: NodePath<t.TaggedTemplateExpression>) {
      if (found) return;
      const nodeLoc = path.node.loc;
      if (!nodeLoc || nodeLoc.start.line !== line || nodeLoc.start.column !== column) return;

      if (library === null) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const tagName = path.node.tag.type === 'Identifier' ? path.node.tag.name : null;
      const acceptedTagNames = library === 'custom' ? CUSTOM_CALL_NAMES : KNOWN_CALL_NAMES;
      if (!tagName || !acceptedTagNames.has(tagName)) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const quasi = path.node.quasi;
      if (quasi.expressions.length === 0 && quasi.quasis.length === 1) {
        const value = quasi.quasis[0]?.value.cooked ?? quasi.quasis[0]?.value.raw;
        if (value != null) {
          found = makeDetected(library, value, nodeLoc.start);
          return;
        }
      }

      found = { kind: 'unsupported', reason: 'dynamic-key' };
    },

    JSXElement(path: NodePath<t.JSXElement>) {
      if (found) return;
      const nodeLoc = path.node.loc;
      if (!nodeLoc || nodeLoc.start.line !== line || nodeLoc.start.column !== column) return;

      const openingName = path.node.openingElement.name;
      const componentName = openingName.type === 'JSXIdentifier' ? openingName.name : null;
      if (!componentName) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      // Library-specific JSX components are not custom wrappers — reject them when library is 'custom'.
      if (library === 'custom' && JSX_COMPONENT_LIBRARY[componentName] !== undefined) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const componentLibrary = JSX_COMPONENT_LIBRARY[componentName] ?? null;
      const resolvedLibrary = componentLibrary;
      if (!resolvedLibrary) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const attrs = path.node.openingElement.attributes;
      let lastIdAttrIndex = -1;
      let idAttr: t.JSXAttribute | null = null;
      for (let i = 0; i < attrs.length; i++) {
        const a = attrs[i];
        if (a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'id') {
          lastIdAttrIndex = i;
          idAttr = a;
        }
      }

      if (!idAttr || !idAttr.value) {
        found = { kind: 'unsupported', reason: 'non-string-id' };
        return;
      }

      // A spread attribute after the last id could override it — treat as non-string-id.
      if (attrs.slice(lastIdAttrIndex + 1).some((a) => a.type === 'JSXSpreadAttribute')) {
        found = { kind: 'unsupported', reason: 'non-string-id' };
        return;
      }

      if (idAttr.value.type === 'StringLiteral') {
        found = makeDetected(resolvedLibrary, idAttr.value.value, nodeLoc.start);
        return;
      }

      found = { kind: 'unsupported', reason: 'non-string-id' };
    },
  });

  return found ?? { kind: 'unsupported', reason: 'unknown-wrapper' };
}

function makeDetected(
  library: I18nLibrary,
  key: string,
  start: { line: number; column: number },
  namespace?: string,
): I18nBindingDetected {
  return { kind: 'i18n', library, key, namespace, sourceLocation: { line: start.line, column: start.column } };
}

/** Returns namespace string for static ns prop, null for dynamic ns prop, undefined when no ns prop. */
function extractNsFromObject(obj: t.ObjectExpression): string | null | undefined {
  const properties = obj.properties;

  // Find the last static ns property and its index (last-property-wins for duplicates).
  let lastNsIndex = -1;
  let lastNsProp: t.ObjectProperty | null = null;
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    if (
      p.type === 'ObjectProperty' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && (p.key as t.Identifier).name === 'ns') ||
        (p.key.type === 'StringLiteral' && (p.key as t.StringLiteral).value === 'ns'))
    ) {
      lastNsIndex = i;
      lastNsProp = p as t.ObjectProperty;
    }
  }

  if (lastNsProp === null) {
    // No static ns property — a spread or computed key might still supply one, treat as dynamic.
    return properties.some((p) => p.type === 'SpreadElement' || (p.type === 'ObjectProperty' && p.computed))
      ? null
      : undefined;
  }

  // A spread or computed property after the last ns could override it at runtime — treat as dynamic.
  if (
    properties
      .slice(lastNsIndex + 1)
      .some((p) => p.type === 'SpreadElement' || (p.type === 'ObjectProperty' && p.computed))
  )
    return null;

  // The last ns property wins and is not overridden by any later spread.
  if (lastNsProp.value.type !== 'StringLiteral') return null;
  return lastNsProp.value.value;
}

function extractCalleeName(callee: t.Expression | t.V8IntrinsicIdentifier): string | null {
  if (callee.type === 'Identifier') return callee.name;
  if (callee.type === 'MemberExpression' && callee.property.type === 'Identifier') {
    return callee.property.name;
  }
  return null;
}

/** Returns key string on success, false for dynamic key, null for missing/non-string id prop. */
function extractIdFromObject(obj: t.ObjectExpression): string | false | null {
  const properties = obj.properties;

  // Find the last static id property (last-property-wins for duplicates).
  let lastIdIndex = -1;
  let lastIdProp: t.ObjectProperty | null = null;
  for (let i = 0; i < properties.length; i++) {
    const p = properties[i];
    if (
      p.type === 'ObjectProperty' &&
      !p.computed &&
      ((p.key.type === 'Identifier' && (p.key as t.Identifier).name === 'id') ||
        (p.key.type === 'StringLiteral' && (p.key as t.StringLiteral).value === 'id'))
    ) {
      lastIdIndex = i;
      lastIdProp = p as t.ObjectProperty;
    }
  }

  if (lastIdProp === null) return null;

  // A spread or computed property after the last id could override it at runtime — treat as dynamic.
  if (
    properties
      .slice(lastIdIndex + 1)
      .some((p) => p.type === 'SpreadElement' || (p.type === 'ObjectProperty' && p.computed))
  )
    return false;

  if (lastIdProp.value.type !== 'StringLiteral') return false;
  return lastIdProp.value.value;
}
