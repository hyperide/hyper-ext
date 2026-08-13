/**
 * @file CSS Modules import and className reference extraction helpers
 *
 * Accessed via: StyleReadService and style-write context builders for className={styles.x}
 * Assumptions: CSS Modules are imported through default or namespace imports from
 *   files ending in .module.css/.module.scss/.module.sass/.module.less/.module.styl.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import path from 'node:path';
import * as t from '@babel/types';
import type { CssModuleClassReference, CssSyntaxId } from '@lib/style-read/types';
import { getAttribute } from './mutator';

const CSS_MODULE_EXT_RE = /\.module\.(css|scss|sass|less|styl)(?:\?.*)?$/;

export interface CssModuleImportBinding {
  importLocalName: string;
  importSource: string;
  cssFilePath: string;
  cssSyntax: CssSyntaxId;
}

/**
 * Return local binding names imported from CSS Modules files.
 */
export function getCssModuleImportLocalNames(ast: t.File): Set<string> {
  return new Set(getCssModuleImportBindings(ast, '').keys());
}

export function getCssModuleImportBindings(ast: t.File, importerFilePath: string): Map<string, CssModuleImportBinding> {
  const bindings = new Map<string, CssModuleImportBinding>();

  for (const node of ast.program.body) {
    if (!t.isImportDeclaration(node)) continue;
    const importSource = node.source.value;
    if (!isCssModuleImportSource(importSource)) continue;

    for (const specifier of node.specifiers) {
      if (!t.isImportDefaultSpecifier(specifier) && !t.isImportNamespaceSpecifier(specifier)) continue;

      bindings.set(specifier.local.name, {
        importLocalName: specifier.local.name,
        importSource,
        cssFilePath: resolveCssImportPath(importerFilePath, importSource),
        cssSyntax: cssSyntaxFromImportSource(importSource),
      });
    }
  }

  return bindings;
}

export function getCssModuleClassReferences(
  element: t.JSXElement,
  bindings: Map<string, CssModuleImportBinding>,
): CssModuleClassReference[] {
  if (bindings.size === 0) return [];

  const attr = getAttribute(element, 'className');
  if (!attr || !t.isJSXExpressionContainer(attr) || t.isJSXEmptyExpression(attr.expression)) {
    return [];
  }

  const references: CssModuleClassReference[] = [];
  collectReferences(attr.expression, bindings, references);
  return dedupeReferences(references);
}

export function containsCssModuleClassReference(node: unknown, cssModuleLocals: Set<string>): boolean {
  if (cssModuleLocals.size === 0) return false;

  if (!node || typeof node !== 'object') return false;

  const maybeNode = node as t.Node;
  if (
    (t.isMemberExpression(maybeNode) || isOptionalMemberExpression(maybeNode)) &&
    getCssModuleClassKey(maybeNode) &&
    isCssModuleMember(maybeNode, cssModuleLocals)
  ) {
    return true;
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (shouldSkipTraversalKey(key)) continue;

    if (Array.isArray(value)) {
      if (value.some((item) => containsCssModuleClassReference(item, cssModuleLocals))) {
        return true;
      }
      continue;
    }

    if (value && typeof value === 'object' && containsCssModuleClassReference(value, cssModuleLocals)) {
      return true;
    }
  }

  return false;
}

function collectReferences(
  node: unknown,
  bindings: Map<string, CssModuleImportBinding>,
  references: CssModuleClassReference[],
): void {
  if (!node || typeof node !== 'object') return;

  const maybeNode = node as t.Node;
  if (t.isMemberExpression(maybeNode) || isOptionalMemberExpression(maybeNode)) {
    const rootName = getMemberRootIdentifierName(maybeNode);
    const binding = rootName ? bindings.get(rootName) : undefined;
    const classKey = getCssModuleClassKey(maybeNode);

    if (binding && classKey) {
      references.push({
        ...binding,
        classKey,
        selector: `.${classKey}`,
        expressionPath: expressionPathForMember(maybeNode, binding.importLocalName, classKey),
      });
    }
  }

  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (shouldSkipTraversalKey(key)) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        collectReferences(item, bindings, references);
      }
      continue;
    }

    if (value && typeof value === 'object') {
      collectReferences(value, bindings, references);
    }
  }
}

function dedupeReferences(references: CssModuleClassReference[]): CssModuleClassReference[] {
  const seen = new Set<string>();
  const result: CssModuleClassReference[] = [];

  for (const reference of references) {
    const key = `${reference.importLocalName}:${reference.cssFilePath}:${reference.classKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(reference);
  }

  return result;
}

function isCssModuleImportSource(importSource: string): boolean {
  return CSS_MODULE_EXT_RE.test(importSource);
}

function resolveCssImportPath(importerFilePath: string, importSource: string): string {
  if (!importSource.startsWith('.')) return importSource;
  if (!importerFilePath) return importSource;

  return path.resolve(path.dirname(importerFilePath), importSource);
}

function cssSyntaxFromImportSource(importSource: string): CssSyntaxId {
  const match = /\.module\.(css|scss|sass|less|styl)(?:\?.*)?$/.exec(importSource);
  const extension = match?.[1];
  if (extension === 'styl') return 'stylus';
  if (extension === 'scss' || extension === 'sass' || extension === 'less') return extension;
  return 'css';
}

function getCssModuleClassKey(node: t.MemberExpression | t.OptionalMemberExpression): string | null {
  const { property, computed } = node;

  if (!computed && t.isIdentifier(property)) return property.name;
  if (computed && t.isStringLiteral(property)) return property.value;

  return null;
}

function expressionPathForMember(
  node: t.MemberExpression | t.OptionalMemberExpression,
  importLocalName: string,
  classKey: string,
): string {
  if (node.computed) {
    return `${importLocalName}['${classKey}']`;
  }

  return `${importLocalName}.${classKey}`;
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

function shouldSkipTraversalKey(key: string): boolean {
  return (
    key === 'loc' ||
    key === 'start' ||
    key === 'end' ||
    key === 'leadingComments' ||
    key === 'innerComments' ||
    key === 'trailingComments'
  );
}
