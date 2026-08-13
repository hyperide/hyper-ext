/**
 * Pure AST-based component source parser.
 * No VS Code dependency — safe to import in tests without mocking.
 */

import * as path from 'node:path';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { parseCode } from '@lib/ast/parser';
import type { ComponentInfo, PropInfo } from '@lib/types';

const traverse = (_traverse as { default?: typeof _traverse }).default ?? _traverse;

export const ALWAYS_OPTIONAL_PROP_NAMES = new Set(['className', 'children', 'ref', 'key', 'asChild']);

/**
 * Convert a TypeScript AST type node to a human-readable type string.
 * Pure / no VS Code dependency — safe to import in tests.
 *
 * Handles qualified names (e.g. React.ReactNode → 'React.ReactNode') so that
 * downstream consumers (sample-values acceptsTextPlaceholder) can recognise them.
 */
export function getTypeString(node: t.TSType): string {
  if (t.isTSStringKeyword(node)) return 'string';
  if (t.isTSNumberKeyword(node)) return 'number';
  if (t.isTSBooleanKeyword(node)) return 'boolean';
  if (t.isTSAnyKeyword(node)) return 'any';
  if (t.isTSVoidKeyword(node)) return 'void';
  if (t.isTSNullKeyword(node)) return 'null';
  if (t.isTSUndefinedKeyword(node)) return 'undefined';
  // String-literal union member (e.g. 'primary' in `'primary' | 'ghost'`). Without this,
  // each literal falls through to `unknown`, collapsing the union to `unknown | unknown`
  // and starving the sample-value enum resolver (HYP-454). Quote the literal so the
  // sampler's quoted-member regex fires deterministically. Numeric/boolean literal unions
  // (`1 | 2`, `true | false`) are intentionally NOT serialized here: the sampler treats
  // bare union members as STRINGS, so emitting `1`/`true` would sample a string `'1'` and
  // break `size === 1` comparisons. They keep their pre-existing `unknown` behavior until a
  // typed numeric/boolean-enum sampler exists — out of scope for this string-enum fix.
  if (t.isTSLiteralType(node) && t.isStringLiteral(node.literal)) {
    return `'${node.literal.value}'`;
  }
  if (t.isTSUnionType(node)) {
    return node.types.map((u) => getTypeString(u)).join(' | ');
  }
  if (t.isTSArrayType(node)) {
    return `${getTypeString(node.elementType)}[]`;
  }
  if (t.isTSTypeReference(node)) {
    if (t.isIdentifier(node.typeName)) return node.typeName.name;
    if (t.isTSQualifiedName(node.typeName)) {
      const left = node.typeName.left;
      const right = node.typeName.right;
      if (t.isIdentifier(left) && t.isIdentifier(right)) {
        return `${left.name}.${right.name}`;
      }
    }
  }
  if (t.isTSFunctionType(node)) return 'Function';
  if (t.isTSTypeLiteral(node)) {
    // Produce readable inline object type: { user: string; count: number }
    const parts: string[] = [];
    for (const member of node.members) {
      if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
        const opt = member.optional ? '?' : '';
        const memberType =
          member.typeAnnotation && t.isTSTypeAnnotation(member.typeAnnotation)
            ? getTypeString(member.typeAnnotation.typeAnnotation)
            : 'unknown';
        parts.push(`${member.key.name}${opt}: ${memberType}`);
      }
    }
    return parts.length > 0 ? `{ ${parts.join('; ')} }` : 'object';
  }
  return 'unknown';
}

export function isForwardRefCall(init: t.Expression | null | undefined): init is t.CallExpression {
  if (!t.isCallExpression(init)) return false;
  const callee = init.callee;
  if (
    t.isMemberExpression(callee) &&
    t.isIdentifier(callee.object) &&
    callee.object.name === 'React' &&
    t.isIdentifier(callee.property) &&
    callee.property.name === 'forwardRef'
  )
    return true;
  if (t.isIdentifier(callee) && callee.name === 'forwardRef') return true;
  return false;
}

/**
 * Extract prop types from an inline object type annotation on a destructuring pattern.
 * Only processes TSTypeLiteral (e.g. `{ variant }: { variant: 'primary' | 'ghost' }`).
 * TSTypeReference (`{ variant }: ButtonProps`) is intentionally left out — the
 * interface/import-resolution path in ComponentService owns those.
 * Returns a map from prop name to type string, or null when no inline type is present.
 */
function extractInlineTypeAnnotations(
  pattern: t.ObjectPattern,
  getTypeString: (node: t.TSType) => string,
): Map<string, string> | null {
  const annotation = pattern.typeAnnotation;
  if (!annotation || !t.isTSTypeAnnotation(annotation)) return null;
  const typeNode = annotation.typeAnnotation;
  if (!t.isTSTypeLiteral(typeNode)) return null;

  const map = new Map<string, string>();
  for (const member of typeNode.members) {
    if (
      t.isTSPropertySignature(member) &&
      t.isIdentifier(member.key) &&
      member.typeAnnotation &&
      t.isTSTypeAnnotation(member.typeAnnotation)
    ) {
      map.set(member.key.name, getTypeString(member.typeAnnotation.typeAnnotation));
    }
  }
  return map.size > 0 ? map : null;
}

export function extractPropsFromDestructuring(
  pattern: t.ObjectPattern,
  getTypeString?: (node: t.TSType) => string,
): PropInfo[] {
  let hasRest = false;
  for (const prop of pattern.properties) {
    if (t.isRestElement(prop)) {
      hasRest = true;
      break;
    }
  }

  // Resolve inline type annotations when a serializer is provided.
  const inlineTypes = getTypeString ? extractInlineTypeAnnotations(pattern, getTypeString) : null;

  const result: PropInfo[] = [];
  for (const prop of pattern.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      const name = prop.key.name;
      // A destructuring default (`variant = 'primary'`) makes the prop optional and tells
      // the sampler which value to prefer for an enum/union prop (HYP-454). We only capture
      // string-literal defaults — those are what the enum branch can match against.
      const defaultValue = stringLiteralDefault(prop.value);
      const hasDefault = defaultValue !== undefined;
      const isOptional = ALWAYS_OPTIONAL_PROP_NAMES.has(name) || /^on[A-Z]/.test(name) || hasRest || hasDefault;
      const type = inlineTypes?.get(name) ?? 'unknown';
      result.push({ name, type, required: !isOptional, defaultValue });
    }
  }
  return result;
}

/**
 * Extract a string-literal destructuring default from an ObjectProperty value.
 * `{ variant = 'primary' }` parses the value as an AssignmentPattern whose `.right`
 * is the default. Returns the bare string (no quotes) for StringLiteral defaults;
 * non-literal defaults (expressions, numbers, identifiers) yield undefined.
 */
function stringLiteralDefault(value: t.ObjectProperty['value']): string | undefined {
  if (t.isAssignmentPattern(value) && t.isStringLiteral(value.right)) {
    return value.right.value;
  }
  return undefined;
}

/**
 * Parse component name and props from source code without VS Code or filesystem dependency.
 * Skips TSInterface/TSType annotation resolution (no class instance required).
 * Use for testing or when filesystem access is unavailable.
 */
export function parseComponentSource(componentPath: string, sourceCode: string): ComponentInfo | null {
  try {
    const ast = parseCode(sourceCode);

    let componentName: string | null = null;
    let hasDefaultExport = false;
    let hasSampleRender = false;
    const propsPerName = new Map<string, PropInfo[]>();
    const exportedVarNames: string[] = [];

    const addProps = (name: string, extracted: PropInfo[]) => {
      const entry = propsPerName.get(name) ?? [];
      entry.push(...extracted);
      propsPerName.set(name, entry);
    };

    traverse(ast, {
      ExportDefaultDeclaration(nodePath: NodePath<t.ExportDefaultDeclaration>) {
        hasDefaultExport = true;
        const declaration = nodePath.node.declaration;
        if (t.isIdentifier(declaration)) {
          componentName = declaration.name;
        } else if (t.isFunctionDeclaration(declaration) && declaration.id) {
          componentName = declaration.id.name;
        }
      },
      ExportNamedDeclaration(nodePath: NodePath<t.ExportNamedDeclaration>) {
        const declaration = nodePath.node.declaration;
        if (t.isFunctionDeclaration(declaration) && declaration.id) {
          if (declaration.id.name === 'sampleRender') hasSampleRender = true;
          if (/^[A-Z]/.test(declaration.id.name)) exportedVarNames.push(declaration.id.name);
        }
        if (t.isVariableDeclaration(declaration)) {
          for (const decl of declaration.declarations) {
            if (t.isIdentifier(decl.id)) {
              if (decl.id.name === 'sampleRender') hasSampleRender = true;
              if (/^[A-Z]/.test(decl.id.name)) exportedVarNames.push(decl.id.name);
            }
          }
        }
      },
      FunctionDeclaration(nodePath: NodePath<t.FunctionDeclaration>) {
        if (nodePath.node.id && /^[A-Z]/.test(nodePath.node.id.name)) {
          const name = nodePath.node.id.name;
          if (!componentName) componentName = name;
          const firstParam = nodePath.node.params[0];
          if (t.isObjectPattern(firstParam)) {
            addProps(name, extractPropsFromDestructuring(firstParam));
          }
        }
      },
      VariableDeclarator(nodePath: NodePath<t.VariableDeclarator>) {
        const id = nodePath.node.id;
        const init = nodePath.node.init;
        if (!t.isIdentifier(id)) return;

        if (id.name === 'sampleRender') hasSampleRender = true;

        const isArrowOrFn = t.isArrowFunctionExpression(init) || t.isFunctionExpression(init);
        const isForwardRef = isForwardRefCall(init);

        if (/^[A-Z]/.test(id.name) && (isArrowOrFn || isForwardRef)) {
          if (!componentName) componentName = id.name;

          let renderFn: t.ArrowFunctionExpression | t.FunctionExpression | null = null;
          if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
            renderFn = init;
          } else if (isForwardRef) {
            const firstArg = (init as t.CallExpression).arguments[0];
            if (t.isArrowFunctionExpression(firstArg) || t.isFunctionExpression(firstArg)) {
              renderFn = firstArg;
            }
          }

          if (renderFn) {
            const firstParam = renderFn.params[0];
            if (t.isObjectPattern(firstParam)) {
              addProps(id.name, extractPropsFromDestructuring(firstParam));
            }
          }
        }
      },
    });

    if (!hasDefaultExport && exportedVarNames.length > 0) {
      const fileBasenameLC = path.basename(componentPath, path.extname(componentPath)).toLowerCase();
      const basenameMatch = exportedVarNames.find((n) => n.toLowerCase() === fileBasenameLC);
      componentName = basenameMatch ?? exportedVarNames[0];
    }

    if (!componentName) {
      const fileBasename = path.basename(componentPath, path.extname(componentPath));
      if (/^[A-Z]/.test(fileBasename)) componentName = fileBasename;
      else return null;
    }

    const props = propsPerName.get(componentName) ?? [];

    let type: 'atom' | 'composite' | 'page' = 'atom';
    if (componentPath.includes('/pages/') || componentPath.includes('/app/')) type = 'page';
    else if (componentPath.includes('/components/') && !componentPath.includes('/ui/')) type = 'composite';

    return { name: componentName, path: componentPath, type, hasDefaultExport, hasSampleRender, props };
  } catch {
    return null;
  }
}
