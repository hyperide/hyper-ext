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

const KNOWN_CALL_NAMES = new Set(['t', 'translate', 'msg', 'i18n', 'formatMessage']);

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
      if (!calleeName || !KNOWN_CALL_NAMES.has(calleeName)) {
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
        found = makeDetected(library, firstArg.value, nodeLoc.start);
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
      if (!tagName || !KNOWN_CALL_NAMES.has(tagName)) {
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

      const componentLibrary = JSX_COMPONENT_LIBRARY[componentName] ?? null;
      const resolvedLibrary = library ?? componentLibrary;
      if (!resolvedLibrary) {
        found = { kind: 'unsupported', reason: 'unknown-wrapper' };
        return;
      }

      const idAttr = path.node.openingElement.attributes.find(
        (a): a is t.JSXAttribute =>
          a.type === 'JSXAttribute' && a.name.type === 'JSXIdentifier' && a.name.name === 'id',
      );

      if (!idAttr || !idAttr.value) {
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

function makeDetected(library: I18nLibrary, key: string, start: { line: number; column: number }): I18nBindingDetected {
  return { kind: 'i18n', library, key, sourceLocation: { line: start.line, column: start.column } };
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
  const idProp = obj.properties.find(
    (p): p is t.ObjectProperty =>
      p.type === 'ObjectProperty' &&
      ((p.key.type === 'Identifier' && (p.key as t.Identifier).name === 'id') ||
        (p.key.type === 'StringLiteral' && (p.key as t.StringLiteral).value === 'id')),
  );
  if (!idProp) return null;
  if (idProp.value.type === 'StringLiteral') return idProp.value.value;
  return false;
}
