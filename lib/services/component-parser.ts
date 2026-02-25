/**
 * Component Parser - pure functions for parsing JSX component trees
 *
 * Extracted from server/routes/parseComponent.ts.
 * These are pure AST traversal functions with zero side effects.
 * Used by both server routes and VSCode extension.
 */

import { randomUUID } from 'node:crypto';
import _generate from '@babel/generator';
import _traverse from '@babel/traverse';
import * as t from '@babel/types';

// @ts-expect-error - babel/generator has ESM/CJS issues
const generate = _generate.default || _generate;
// @ts-expect-error - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

// ============================================
// Types
// ============================================

export type CondItemType = 'if-then' | 'if-else' | 'else-if' | 'switch-case';

export interface ComponentNode {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children: ComponentNode[];
  childrenType?: 'text' | 'expression' | 'expression-complex' | 'jsx';
  mapItem?: {
    parentMapId: string;
    depth: number;
    expression: string;
  };
  condItem?: {
    type: CondItemType;
    condId: string;
    branch: 'then' | 'else' | 'case';
    index?: number;
    expression: string;
  };
  functionItem?: {
    functionName: string;
    functionLoc: {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
    callLoc: {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
  };
  expandedFrom?: string;
  loc?: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

export interface MapContext {
  parentMapId: string;
  depth: number;
  expression: string;
}

export interface CondContext {
  condId: string;
  type: CondItemType;
  branch: 'then' | 'else' | 'case';
  index?: number;
  expression: string;
}

export interface FunctionContext {
  functionName: string;
  functionLoc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
  callLoc: {
    start: { line: number; column: number };
    end: { line: number; column: number };
  };
}

/**
 * Context for parsing, containing the full file AST for function lookups
 */
export interface ParseContext {
  fileAST: t.File;
  componentBodyPath?: unknown;
}

// ============================================
// Internal helpers
// ============================================

function generateId(): string {
  return randomUUID();
}

// ============================================
// Public functions
// ============================================

/**
 * Find local function definition by name within component scope
 */
export function findLocalFunctionDefinition(
  parseContext: ParseContext,
  functionName: string,
): {
  node: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  loc: t.SourceLocation;
} | null {
  let foundDef: {
    node: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
    loc: t.SourceLocation;
  } | null = null;

  traverse(parseContext.fileAST, {
    VariableDeclarator(path: { node: t.VariableDeclarator; stop: () => void }) {
      if (
        t.isIdentifier(path.node.id) &&
        path.node.id.name === functionName &&
        (t.isArrowFunctionExpression(path.node.init) || t.isFunctionExpression(path.node.init)) &&
        path.node.loc
      ) {
        foundDef = {
          node: path.node.init,
          loc: path.node.loc,
        };
        path.stop();
      }
    },
    FunctionDeclaration(path: { node: t.FunctionDeclaration; stop: () => void }) {
      if (path.node.id?.name === functionName && path.node.loc) {
        foundDef = {
          node: path.node,
          loc: path.node.loc,
        };
        path.stop();
      }
    },
  });

  return foundDef;
}

/**
 * Find local React component definition by name within file scope.
 * Handles arrow functions, function expressions, function declarations,
 * and HOC wrappers (forwardRef, memo, etc.)
 */
export function findLocalComponentDefinition(
  parseContext: ParseContext,
  componentName: string,
): {
  node: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
  loc: t.SourceLocation;
} | null {
  let foundDef: {
    node: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration;
    loc: t.SourceLocation;
  } | null = null;

  traverse(parseContext.fileAST, {
    VariableDeclarator(path: { node: t.VariableDeclarator; stop: () => void }) {
      if (t.isIdentifier(path.node.id) && path.node.id.name === componentName && path.node.loc) {
        const init = path.node.init;

        // Direct arrow/function expression
        if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
          foundDef = { node: init, loc: path.node.loc };
          path.stop();
          return;
        }

        // HOC wrappers: forwardRef, memo, etc.
        if (t.isCallExpression(init)) {
          const firstArg = init.arguments[0];
          if (t.isArrowFunctionExpression(firstArg) || t.isFunctionExpression(firstArg)) {
            foundDef = { node: firstArg, loc: path.node.loc };
            path.stop();
            return;
          }
          // Nested HOC: memo(forwardRef(...))
          if (t.isCallExpression(firstArg)) {
            const nestedArg = firstArg.arguments[0];
            if (t.isArrowFunctionExpression(nestedArg) || t.isFunctionExpression(nestedArg)) {
              foundDef = { node: nestedArg, loc: path.node.loc };
              path.stop();
              return;
            }
          }
        }
      }
    },
    FunctionDeclaration(path: { node: t.FunctionDeclaration; stop: () => void }) {
      if (path.node.id?.name === componentName && path.node.loc) {
        foundDef = { node: path.node, loc: path.node.loc };
        path.stop();
      }
    },
  });

  return foundDef;
}

/**
 * Parse component body and extract JSX from return statements
 */
export function parseLocalComponentBody(
  componentDef: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  parseContext: ParseContext,
  expandedComponents: Set<string>,
  mapContext?: MapContext,
  condContext?: CondContext,
): ComponentNode[] {
  const result: ComponentNode[] = [];
  const body = componentDef.body;

  // Arrow function with expression body: () => <div>...</div>
  if (t.isArrowFunctionExpression(componentDef) && !t.isBlockStatement(body)) {
    if (t.isJSXElement(body)) {
      const node = parseJSXElement(body, mapContext, condContext, undefined, parseContext, expandedComponents);
      if (node) result.push(node);
    } else if (t.isJSXFragment(body)) {
      for (const child of body.children) {
        if (t.isJSXElement(child)) {
          const node = parseJSXElement(child, mapContext, condContext, undefined, parseContext, expandedComponents);
          if (node) result.push(node);
        }
      }
    }
    return result;
  }

  // Block statement - find return statements
  if (t.isBlockStatement(body)) {
    let nestedFunctionDepth = 0;
    traverse(
      body,
      {
        enter(path: { node: t.Node }) {
          if (
            t.isArrowFunctionExpression(path.node) ||
            t.isFunctionExpression(path.node) ||
            t.isFunctionDeclaration(path.node)
          ) {
            nestedFunctionDepth++;
          }
        },
        exit(path: { node: t.Node }) {
          if (
            t.isArrowFunctionExpression(path.node) ||
            t.isFunctionExpression(path.node) ||
            t.isFunctionDeclaration(path.node)
          ) {
            nestedFunctionDepth--;
          }
        },
        ReturnStatement(path: { node: t.ReturnStatement }) {
          if (nestedFunctionDepth > 0) return;

          if (path.node.argument && t.isJSXElement(path.node.argument)) {
            const node = parseJSXElement(
              path.node.argument,
              mapContext,
              condContext,
              undefined,
              parseContext,
              expandedComponents,
            );
            if (node) result.push(node);
          } else if (path.node.argument && t.isJSXFragment(path.node.argument)) {
            for (const child of path.node.argument.children) {
              if (t.isJSXElement(child)) {
                const node = parseJSXElement(
                  child,
                  mapContext,
                  condContext,
                  undefined,
                  parseContext,
                  expandedComponents,
                );
                if (node) result.push(node);
              }
            }
          }
        },
      },
      { noScope: true } as unknown as t.Node,
    );
  }

  return result;
}

/**
 * Parse function body and extract all JSX elements it may return.
 * Handles direct JSX returns, array.push patterns, and multiple returns.
 */
export function parseLocalFunctionBody(
  functionDef: t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration,
  parseContext: ParseContext,
  mapContext?: MapContext,
  condContext?: CondContext,
  expandedComponents?: Set<string>,
): ComponentNode[] {
  const result: ComponentNode[] = [];
  const body = functionDef.body;

  // Arrow function with expression body (direct return)
  if (t.isArrowFunctionExpression(functionDef) && !t.isBlockStatement(body)) {
    if (t.isJSXElement(body)) {
      const node = parseJSXElement(body, mapContext, condContext, undefined, parseContext, expandedComponents);
      if (node) result.push(node);
    }
    return result;
  }

  // Block statement - analyze patterns
  if (t.isBlockStatement(body)) {
    // Track array variables that receive .push() calls
    const arrayVars = new Set<string>();

    // First pass: find array declarations
    for (const stmt of body.body) {
      if (t.isVariableDeclaration(stmt)) {
        for (const decl of stmt.declarations) {
          if (t.isIdentifier(decl.id) && t.isArrayExpression(decl.init)) {
            arrayVars.add(decl.id.name);
          }
        }
      }
    }

    // Second pass: find .push() calls and return statements
    let nestedFunctionDepth = 0;
    traverse(
      body,
      {
        enter(path: { node: t.Node }) {
          if (
            t.isArrowFunctionExpression(path.node) ||
            t.isFunctionExpression(path.node) ||
            t.isFunctionDeclaration(path.node)
          ) {
            nestedFunctionDepth++;
          }
        },
        exit(path: { node: t.Node }) {
          if (
            t.isArrowFunctionExpression(path.node) ||
            t.isFunctionExpression(path.node) ||
            t.isFunctionDeclaration(path.node)
          ) {
            nestedFunctionDepth--;
          }
        },
        CallExpression(path: { node: t.CallExpression }) {
          // Check for array.push(JSX)
          if (
            t.isMemberExpression(path.node.callee) &&
            t.isIdentifier(path.node.callee.object) &&
            arrayVars.has(path.node.callee.object.name) &&
            t.isIdentifier(path.node.callee.property) &&
            path.node.callee.property.name === 'push'
          ) {
            for (const arg of path.node.arguments) {
              if (t.isJSXElement(arg)) {
                const node = parseJSXElement(arg, mapContext, condContext, undefined, parseContext, expandedComponents);
                if (node) result.push(node);
              }
            }
          }
        },
        ReturnStatement(path: { node: t.ReturnStatement }) {
          if (nestedFunctionDepth > 0) return;

          if (path.node.argument && t.isJSXElement(path.node.argument)) {
            const node = parseJSXElement(
              path.node.argument,
              mapContext,
              condContext,
              undefined,
              parseContext,
              expandedComponents,
            );
            if (node) result.push(node);
          } else if (path.node.argument && t.isJSXFragment(path.node.argument)) {
            for (const child of path.node.argument.children) {
              if (t.isJSXElement(child)) {
                const node = parseJSXElement(
                  child,
                  mapContext,
                  condContext,
                  undefined,
                  parseContext,
                  expandedComponents,
                );
                if (node) result.push(node);
              }
            }
          }
        },
      },
      { noScope: true } as unknown as t.Node,
    );
  }

  return result;
}

/**
 * Parse JSX element to ComponentNode tree.
 * Recursively processes children, handles .map(), ternaries, logical operators,
 * and local function/component expansion.
 */
export function parseJSXElement(
  element: t.JSXElement,
  mapContext?: MapContext,
  condContext?: CondContext,
  functionContext?: FunctionContext,
  parseContext?: ParseContext,
  expandedComponents?: Set<string>,
): ComponentNode | null {
  const opening = element.openingElement;

  // Extract name from JSXIdentifier or JSXMemberExpression
  let name: string | null = null;
  if (t.isJSXIdentifier(opening.name)) {
    name = opening.name.name;
  } else if (t.isJSXMemberExpression(opening.name)) {
    const buildMemberName = (expr: t.JSXMemberExpression | t.JSXIdentifier): string => {
      if (t.isJSXIdentifier(expr)) return expr.name;
      if (t.isJSXMemberExpression(expr)) {
        return `${buildMemberName(expr.object)}.${buildMemberName(expr.property)}`;
      }
      return '';
    };
    name = buildMemberName(opening.name);
  }

  if (!name) return null;

  // Read existing data-uniq-id or generate new one
  let elementId: string;
  const dataUniqIdAttr = opening.attributes.find(
    (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
  );

  if (dataUniqIdAttr && t.isJSXAttribute(dataUniqIdAttr) && t.isStringLiteral(dataUniqIdAttr.value)) {
    elementId = dataUniqIdAttr.value.value;
  } else if (
    dataUniqIdAttr &&
    t.isJSXAttribute(dataUniqIdAttr) &&
    t.isJSXExpressionContainer(dataUniqIdAttr.value) &&
    t.isTemplateLiteral(dataUniqIdAttr.value.expression) &&
    dataUniqIdAttr.value.expression.expressions.length === 0 &&
    dataUniqIdAttr.value.expression.quasis.length === 1
  ) {
    elementId = dataUniqIdAttr.value.expression.quasis[0].value.raw;
  } else {
    elementId = generateId();
  }

  // Parse props
  const props: Record<string, unknown> = {};
  for (const attr of opening.attributes) {
    if (t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name)) {
      const propName = attr.name.name;

      // Skip technical props
      if (propName === 'ref' || propName === 'key' || propName === 'data-uniq-id') {
        continue;
      }

      let propValue: unknown = true;
      let shouldAddProp = false;

      if (attr.value) {
        if (t.isStringLiteral(attr.value)) {
          propValue = attr.value.value;
          shouldAddProp = true;
        } else if (t.isJSXExpressionContainer(attr.value)) {
          const expr = attr.value.expression;
          if (t.isStringLiteral(expr)) {
            propValue = expr.value;
            shouldAddProp = true;
          } else if (t.isNumericLiteral(expr)) {
            propValue = expr.value;
            shouldAddProp = true;
          } else if (t.isBooleanLiteral(expr)) {
            propValue = expr.value;
            shouldAddProp = true;
          } else if (t.isArrayExpression(expr)) {
            propValue = expr.elements.map((el) => (t.isStringLiteral(el) ? el.value : null)).filter(Boolean);
            shouldAddProp = true;
          }
        }
      } else {
        // Boolean prop without value (e.g. disabled)
        shouldAddProp = true;
      }

      if (shouldAddProp) {
        props[propName] = propValue;
      }
    } else if (t.isJSXAttribute(attr)) {
      const attrName = attr.name;
      if (t.isJSXNamespacedName(attrName)) {
        const propName = `${attrName.namespace.name}:${attrName.name.name}`;
        const propValue = attr.value && t.isStringLiteral(attr.value) ? attr.value.value : true;
        props[propName] = propValue;
      } else if (t.isJSXIdentifier(attrName) && attrName.name.includes('-')) {
        const propValue = attr.value && t.isStringLiteral(attr.value) ? attr.value.value : true;
        props[attrName.name] = propValue;
      }
    }
  }

  // Parse children
  const children: ComponentNode[] = [];
  let childrenType: 'text' | 'expression' | 'expression-complex' | 'jsx' | undefined;

  // Helper to recursively find all JSXElements in any node
  const findJSXInNode = (
    node: t.Node,
    currentMapContext?: MapContext,
    currentCondContext?: CondContext,
  ): ComponentNode[] => {
    const found: ComponentNode[] = [];

    if (t.isJSXElement(node)) {
      const parsed = parseJSXElement(
        node,
        currentMapContext,
        currentCondContext,
        functionContext,
        parseContext,
        expandedComponents,
      );
      if (parsed) found.push(parsed);
    } else if (t.isCallExpression(node)) {
      // Check if this is a .map() call
      const isMapCall =
        t.isMemberExpression(node.callee) &&
        t.isIdentifier(node.callee.property) &&
        node.callee.property.name === 'map';

      // Check if this is a local function call
      const isLocalFunctionCall = t.isIdentifier(node.callee) && parseContext;

      if (isLocalFunctionCall && t.isIdentifier(node.callee)) {
        const functionName = node.callee.name;
        const functionDef = findLocalFunctionDefinition(parseContext, functionName);

        if (functionDef && node.loc) {
          const newFunctionContext: FunctionContext = {
            functionName,
            functionLoc: {
              start: { line: functionDef.loc.start.line, column: functionDef.loc.start.column },
              end: { line: functionDef.loc.end.line, column: functionDef.loc.end.column },
            },
            callLoc: {
              start: { line: node.loc.start.line, column: node.loc.start.column },
              end: { line: node.loc.end.line, column: node.loc.end.column },
            },
          };

          const functionChildren = parseLocalFunctionBody(
            functionDef.node,
            parseContext,
            currentMapContext,
            currentCondContext,
            expandedComponents,
          );

          if (functionChildren.length > 0) {
            const functionNode: ComponentNode = {
              id: generateId(),
              type: `fn:${functionName}`,
              props: {},
              children: functionChildren,
              functionItem: newFunctionContext,
            };
            found.push(functionNode);
          }
        }
      } else if (isMapCall) {
        const expression = t.isMemberExpression(node.callee) ? generate(node.callee.object).code : '';

        const newMapContext: MapContext = {
          parentMapId: generateId(),
          depth: currentMapContext ? currentMapContext.depth + 1 : 0,
          expression,
        };

        for (const arg of node.arguments) {
          if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
            const argBody = arg.body;
            const mapBodyCondContext = undefined;
            if (t.isJSXElement(argBody)) {
              found.push(...findJSXInNode(argBody, newMapContext, mapBodyCondContext));
            } else if (t.isBlockStatement(argBody)) {
              for (const stmt of argBody.body) {
                if (t.isReturnStatement(stmt) && stmt.argument) {
                  found.push(...findJSXInNode(stmt.argument, newMapContext, mapBodyCondContext));
                }
              }
            }
          }
        }
      } else {
        // Other call expressions - check arguments for callbacks with JSX
        for (const arg of node.arguments) {
          if (t.isArrowFunctionExpression(arg) || t.isFunctionExpression(arg)) {
            const argBody = arg.body;
            if (t.isJSXElement(argBody)) {
              found.push(...findJSXInNode(argBody, currentMapContext, currentCondContext));
            } else if (t.isBlockStatement(argBody)) {
              for (const stmt of argBody.body) {
                if (t.isReturnStatement(stmt) && stmt.argument) {
                  found.push(...findJSXInNode(stmt.argument, currentMapContext, currentCondContext));
                }
              }
            }
          }
        }
      }
    } else if (t.isConditionalExpression(node)) {
      const condId = generateId();
      const expression = generate(node.test).code;

      const hasAlternate =
        t.isJSXElement(node.alternate) ||
        t.isJSXExpressionContainer(node.alternate) ||
        t.isConditionalExpression(node.alternate) ||
        t.isCallExpression(node.alternate) ||
        t.isLogicalExpression(node.alternate) ||
        t.isJSXFragment(node.alternate);

      const condType: CondItemType = hasAlternate ? 'if-else' : 'if-then';

      const thenContext: CondContext = { condId, type: condType, branch: 'then', expression };
      found.push(...findJSXInNode(node.consequent, currentMapContext, thenContext));

      if (hasAlternate) {
        const elseContext: CondContext = { condId, type: condType, branch: 'else', expression };
        found.push(...findJSXInNode(node.alternate, currentMapContext, elseContext));
      }
    } else if (t.isLogicalExpression(node)) {
      const condId = generateId();
      const expression = generate(node.left).code;

      if (node.operator === '&&') {
        const thenContext: CondContext = { condId, type: 'if-then', branch: 'then', expression };
        found.push(...findJSXInNode(node.right, currentMapContext, thenContext));
      } else if (node.operator === '||') {
        const elseContext: CondContext = { condId, type: 'if-else', branch: 'else', expression };
        found.push(...findJSXInNode(node.right, currentMapContext, elseContext));
      }
    } else if (t.isJSXFragment(node)) {
      for (const child of node.children) {
        found.push(...findJSXInNode(child as t.Node, currentMapContext, currentCondContext));
      }
    }

    return found;
  };

  // First, detect if there are JSX elements among children
  let hasJSXElements = false;
  for (const child of element.children) {
    if (t.isJSXElement(child)) {
      hasJSXElements = true;
      break;
    } else if (t.isJSXExpressionContainer(child)) {
      const jsx = findJSXInNode(child.expression as t.Node, mapContext, condContext);
      if (jsx.length > 0) {
        hasJSXElements = true;
        break;
      }
    }
  }

  // Process children based on what we found
  if (hasJSXElements) {
    childrenType = 'jsx';
    for (const child of element.children) {
      if (t.isJSXElement(child)) {
        const childNode = parseJSXElement(
          child,
          mapContext,
          undefined,
          functionContext,
          parseContext,
          expandedComponents,
        );
        if (childNode) children.push(childNode);
      } else if (t.isJSXExpressionContainer(child)) {
        const jsx = findJSXInNode(child.expression as t.Node, mapContext, undefined);
        children.push(...jsx);
      }
    }
  } else {
    // No JSX elements - only text/expressions
    const childrenCode = element.children
      .map((child) => {
        if (t.isJSXText(child)) return child.value;
        if (t.isJSXExpressionContainer(child)) {
          return `{${generate(child.expression).code}}`;
        }
        return '';
      })
      .join('')
      .trim();

    if (childrenCode) {
      props.children = childrenCode;

      if (element.children.length === 1) {
        const onlyChild = element.children[0];
        if (t.isJSXText(onlyChild)) {
          childrenType = 'text';
        } else if (t.isJSXExpressionContainer(onlyChild)) {
          if (t.isIdentifier(onlyChild.expression)) {
            childrenType = 'expression';
          } else {
            childrenType = 'expression-complex';
          }
        } else {
          childrenType = 'expression-complex';
        }
      } else {
        childrenType = 'expression-complex';
      }
    }
  }

  const node: ComponentNode = {
    id: elementId,
    type: name,
    props,
    children,
    ...(childrenType && { childrenType }),
  };

  // Add location metadata
  if (element.loc) {
    node.loc = {
      start: { line: element.loc.start.line, column: element.loc.start.column },
      end: { line: element.loc.end.line, column: element.loc.end.column },
    };
  }

  // Add mapItem metadata
  if (mapContext) {
    node.mapItem = {
      parentMapId: mapContext.parentMapId,
      depth: mapContext.depth,
      expression: mapContext.expression,
    };
  }

  // Add condItem metadata
  if (condContext) {
    node.condItem = {
      type: condContext.type,
      condId: condContext.condId,
      branch: condContext.branch,
      index: condContext.index,
      expression: condContext.expression,
    };
  }

  // Add functionItem metadata
  if (functionContext) {
    node.functionItem = {
      functionName: functionContext.functionName,
      functionLoc: functionContext.functionLoc,
      callLoc: functionContext.callLoc,
    };
  }

  // Expand local components: if this is a PascalCase component defined in the same file,
  // parse its JSX and add as children
  const isReactComponent = /^[A-Z]/.test(name);
  const isHtmlTag = name.toLowerCase() === name;
  const currentExpandedSet = expandedComponents ?? new Set<string>();

  if (parseContext && isReactComponent && !isHtmlTag && !currentExpandedSet.has(name) && children.length === 0) {
    const componentDef = findLocalComponentDefinition(parseContext, name);
    if (componentDef) {
      const newExpandedSet = new Set(currentExpandedSet);
      newExpandedSet.add(name);

      const expandedChildren = parseLocalComponentBody(
        componentDef.node,
        parseContext,
        newExpandedSet,
        mapContext,
        condContext,
      );

      if (expandedChildren.length > 0) {
        node.children = expandedChildren;
        node.expandedFrom = name;
        node.childrenType = 'jsx';
      }
    }
  }

  return node;
}
