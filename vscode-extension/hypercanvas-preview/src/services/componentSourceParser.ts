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

export function extractPropsFromDestructuring(pattern: t.ObjectPattern): PropInfo[] {
  let hasRest = false;
  for (const prop of pattern.properties) {
    if (t.isRestElement(prop)) {
      hasRest = true;
      break;
    }
  }
  const result: PropInfo[] = [];
  for (const prop of pattern.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
      const name = prop.key.name;
      const isOptional = ALWAYS_OPTIONAL_PROP_NAMES.has(name) || /^on[A-Z]/.test(name) || hasRest;
      result.push({ name, type: 'unknown', required: !isOptional });
    }
  }
  return result;
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
