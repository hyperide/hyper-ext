import * as t from '@babel/types';

export function replaceStringLiteralValue(node: t.Node, previousValue: string, nextValue: string): boolean {
  let changed = false;

  const visit = (current: t.Node | null | undefined): void => {
    if (!current) return;
    if (t.isStringLiteral(current) && current.value === previousValue) {
      current.value = nextValue;
      changed = true;
      return;
    }
    if (t.isTemplateLiteral(current) && current.expressions.length === 0) {
      const raw = current.quasis.map((quasi) => quasi.value.cooked ?? quasi.value.raw).join('');
      if (raw === previousValue) {
        current.quasis = [t.templateElement({ raw: nextValue, cooked: nextValue }, true)];
        changed = true;
      }
      return;
    }

    for (const value of Object.values(current)) {
      if (!value) continue;
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && 'type' in item) visit(item as t.Node);
        }
      } else if (typeof value === 'object' && 'type' in value) {
        visit(value as t.Node);
      }
    }
  };

  visit(node);
  return changed;
}

export function isJsxSourceFile(filePath: string): boolean {
  return /\.(tsx|jsx|ts|js)$/.test(filePath);
}

export function jsxContains(haystack: t.JSXElement, needle: t.JSXElement): boolean {
  for (const child of haystack.children) {
    if (child === needle) return true;
    if (t.isJSXElement(child) || t.isJSXFragment(child)) {
      if (jsxContains(child as t.JSXElement, needle)) return true;
    } else if (t.isJSXExpressionContainer(child)) {
      // Walk inside `{…}` expressions in case the source contains the target
      // through a conditional / fragment inside an expression slot.
      const found = findJsxInExpression(child.expression, needle);
      if (found) return true;
    }
  }
  return false;
}

function findJsxInExpression(expr: t.Expression | t.JSXEmptyExpression, needle: t.JSXElement): boolean {
  if (t.isJSXElement(expr)) {
    if (expr === needle) return true;
    return jsxContains(expr, needle);
  }
  if (t.isJSXFragment(expr)) {
    for (const child of expr.children) {
      if (child === needle) return true;
      if (t.isJSXElement(child) && jsxContains(child, needle)) return true;
    }
  }
  if (t.isLogicalExpression(expr) || t.isBinaryExpression(expr)) {
    return findJsxInExpression(expr.left as t.Expression, needle) || findJsxInExpression(expr.right, needle);
  }
  if (t.isConditionalExpression(expr)) {
    return (
      findJsxInExpression(expr.test, needle) ||
      findJsxInExpression(expr.consequent, needle) ||
      findJsxInExpression(expr.alternate, needle)
    );
  }
  return false;
}

export function liftToCommonJsxParent(
  sourcePath: import('@babel/traverse').NodePath<t.JSXElement>,
  targetPath: import('@babel/traverse').NodePath<t.JSXElement>,
): {
  sourceLifted: t.JSXElement;
  targetLifted: t.JSXElement;
  commonParent: t.JSXElement | t.JSXFragment;
} | null {
  type AnyPath = import('@babel/traverse').NodePath;
  const buildChain = (start: AnyPath): t.Node[] => {
    const chain: t.Node[] = [];
    let p: AnyPath | null = start;
    while (p) {
      chain.push(p.node);
      p = p.parentPath ?? null;
    }
    return chain;
  };
  const sourceChain = buildChain(sourcePath as AnyPath);
  const targetChain = buildChain(targetPath as AnyPath);

  const sourceSet = new Set(sourceChain);
  let commonIdxInTarget = -1;
  for (let i = 0; i < targetChain.length; i++) {
    if (sourceSet.has(targetChain[i])) {
      commonIdxInTarget = i;
      break;
    }
  }
  if (commonIdxInTarget === -1) return null;

  const commonNode = targetChain[commonIdxInTarget];
  const sourceNode = sourceChain[0];
  const targetNode = targetChain[0];

  if (commonNode === sourceNode) return null;

  if (commonNode === targetNode) {
    const targetParent = targetChain[1];
    if (!targetParent || (!t.isJSXElement(targetParent) && !t.isJSXFragment(targetParent))) {
      return null;
    }
    if (!t.isJSXElement(sourceNode) || !t.isJSXElement(targetNode)) return null;
    return {
      sourceLifted: sourceNode,
      targetLifted: targetNode,
      commonParent: targetParent as t.JSXElement | t.JSXFragment,
    };
  }

  if (!t.isJSXElement(commonNode) && !t.isJSXFragment(commonNode)) return null;
  const commonIdxInSource = sourceChain.indexOf(commonNode);
  if (commonIdxInSource < 1 || commonIdxInTarget < 1) return null;

  const sourceLifted = sourceChain[commonIdxInSource - 1];
  const targetLifted = targetChain[commonIdxInTarget - 1];
  if (!t.isJSXElement(sourceLifted) || !t.isJSXElement(targetLifted)) return null;

  return {
    sourceLifted,
    targetLifted,
    commonParent: commonNode,
  };
}

export function describeJsxName(el: t.JSXElement): string {
  const name = el.openingElement.name;
  if (t.isJSXIdentifier(name)) return name.name;
  if (t.isJSXMemberExpression(name)) {
    const parts: string[] = [];
    let obj: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(obj)) {
      parts.unshift(obj.property.name);
      obj = obj.object;
    }
    parts.unshift(obj.name);
    return parts.join('.');
  }
  return 'unknown';
}
