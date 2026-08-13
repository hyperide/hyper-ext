/**
 * @file AST helpers for parsing existing __canvas_preview__.tsx
 *
 * Accessed via: preview-file-manager.ts parseExistingPreview
 */

import { parse } from '@babel/parser';
import type { Expression, Node, ObjectExpression, ObjectProperty, PatternLike, VariableDeclarator } from '@babel/types';

/** Yield VariableDeclarators from top-level statements (exported or not) */
export function* iterateVarDeclarators(
  body: ReturnType<typeof parse>['program']['body'],
): Generator<VariableDeclarator> {
  for (const node of body) {
    const varDecl =
      node.type === 'VariableDeclaration'
        ? node
        : node.type === 'ExportNamedDeclaration' && node.declaration?.type === 'VariableDeclaration'
          ? node.declaration
          : null;
    if (varDecl) yield* varDecl.declarations;
  }
}

/** Yield ObjectProperty nodes from an ObjectExpression, skipping spread elements */
export function* iterateObjectProperties(obj: ObjectExpression): Generator<ObjectProperty> {
  for (const prop of obj.properties) {
    if (prop.type === 'ObjectProperty') yield prop;
  }
}

/** Unwrap TSAsExpression / TSSatisfiesExpression / LogicalExpression to ObjectExpression */
export function unwrapToObject(node: Expression | PatternLike | null | undefined): ObjectExpression | null {
  if (!node) return null;
  if (node.type === 'ObjectExpression') return node;
  if (node.type === 'TSAsExpression' || node.type === 'TSSatisfiesExpression') {
    return unwrapToObject(node.expression);
  }
  if (node.type === 'LogicalExpression') {
    return unwrapToObject(node.right);
  }
  return null;
}

export function getStringValue(node: Node | null | undefined): string | null {
  return node?.type === 'StringLiteral' ? node.value : null;
}

export function getIdentName(node: Node | null | undefined): string | null {
  if (!node) return null;
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'CallExpression') {
    const firstArg = node.arguments[0];
    return firstArg?.type === 'Identifier' ? firstArg.name : null;
  }
  return null;
}

export function stripExtension(name: string): string {
  return name.replace(/\.\w+$/, '');
}

export function pathCaseKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase();
}

/** Recast parser using @babel/parser for TSX/TS support. */
export const RECAST_PARSER = {
  parse: (source: string) =>
    parse(source, {
      sourceType: 'module',
      plugins: ['typescript', 'jsx'],
      tokens: true,
    }),
};
