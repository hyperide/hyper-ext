/**
 * Component Service - scans and parses React components locally
 *
 * Provides component discovery and parsing without server dependency.
 * Uses VS Code file system API and Babel for parsing.
 */

import * as vscode from 'vscode';
import * as path from 'node:path';
import { parseCode } from '@lib/ast/parser';
import * as t from '@babel/types';
import _traverse, { type NodePath } from '@babel/traverse';
import { getUuidFromElement } from '@lib/ast/traverser';
import type { ComponentInfo, ComponentTree, PropInfo, TreeNode } from '@lib/types';
import { ComponentScanner } from '../../../../lib/component-scanner/scanner';
import { getDirectoryTree } from '../../../../lib/component-scanner/directory-tree';
import { analyzeWithAI, resolveAnalyzerConfig } from '../../../../lib/component-scanner/ai-analyzer';
import { FileProjectStructureStore } from './FileStructureStore';
import type { ComponentsData, TestGroup, TestInfo } from '../../../../lib/component-scanner/types';
import * as fs from 'node:fs/promises';

// Re-export shared types for convenience
export type { ComponentInfo, ComponentTree, PropInfo };

export type SetupReason = 'no-ai-config' | 'no-paths' | 'empty-scan';

export interface ScanResult {
  data: ComponentsData;
  needsSetup?: boolean;
  setupReason?: SetupReason;
}

// @ts-ignore - babel/traverse has ESM/CJS issues
const traverse = _traverse.default || _traverse;

// ============================================
// ComponentService Class
// ============================================

export class ComponentService {
  private _workspaceRoot: string;
  private _cache: Map<string, ComponentInfo> = new Map();

  constructor(workspaceRoot: string) {
    this._workspaceRoot = workspaceRoot;
  }

  /**
   * Scan workspace for React components
   */
  async scanComponents(): Promise<ComponentTree> {
    const tree: ComponentTree = {
      atoms: [],
      composites: [],
      pages: [],
    };

    // Find all component files
    const componentGlob = '{src,app}/**/*.{tsx,jsx}';
    const files = await vscode.workspace.findFiles(
      componentGlob,
      '**/node_modules/**',
    );

    for (const file of files) {
      try {
        const componentInfo = await this._parseComponentFile(file);
        if (componentInfo) {
          // Categorize by directory or naming convention
          if (file.fsPath.includes('/pages/') || file.fsPath.includes('/app/')) {
            tree.pages.push(componentInfo);
          } else if (
            file.fsPath.includes('/components/') &&
            !file.fsPath.includes('/components/ui/')
          ) {
            tree.composites.push(componentInfo);
          } else {
            tree.atoms.push(componentInfo);
          }

          // Cache for quick lookup
          this._cache.set(componentInfo.path, componentInfo);
        }
      } catch (error) {
        console.error(
          `[ComponentService] Error parsing ${file.fsPath}:`,
          error,
        );
      }
    }

    return tree;
  }

  /**
   * Scan workspace for grouped components using ComponentScanner.
   * Returns directory-based groups (atoms, composites, pages) with filename-based names.
   */
  async scanComponentGroups(): Promise<ScanResult> {
    const store = new FileProjectStructureStore();
    const scanner = new ComponentScanner(store, async (root) => {
      const tree = await getDirectoryTree(root);

      const config = vscode.workspace.getConfiguration('hypercanvas.ai');
      const apiKey = config.get<string>('apiKey');
      const model = config.get<string>('model');
      const provider = config.get<string>('provider', 'claude');
      const backend = config.get<string>('backend');

      if (apiKey && model) {
        const resolved = resolveAnalyzerConfig({
          provider: provider!,
          apiKey,
          model,
          baseURL: config.get<string>('baseURL'),
          backend: backend || undefined,
        });

        if (resolved) {
          try {
            console.log(
              `[ComponentService] AI analysis: provider=${provider}, model=${model}, sdk=${resolved.provider}`,
            );
            const result = await analyzeWithAI(root, tree, resolved.apiKey, {
              model: resolved.model,
              baseURL: resolved.baseURL,
              provider: resolved.provider,
            });
            const n =
              (result.atomComponentsPaths?.length ?? 0) +
              (result.compositeComponentsPaths?.length ?? 0) +
              (result.pagesPaths?.length ?? 0);
            console.log(`[ComponentService] AI found ${n} component paths`);
            return result;
          } catch (error) {
            console.error('[ComponentService] AI analysis failed:', error);
          }
        } else {
          console.warn(`[ComponentService] Could not resolve provider "${provider}" config`);
        }
      }

      // No AI config or AI failed — return empty structure, onboarding will handle it
      return {
        atomComponentsPaths: [],
        compositeComponentsPaths: [],
        pagesPaths: [],
        textComponentPath: null,
        linkComponentPath: null,
        buttonComponentPath: null,
        imageComponentPath: null,
        containerComponentPath: null,
      };
    });
    const data = await scanner.getComponentsData(this._workspaceRoot);

    const isEmpty =
      data.atomGroups.length === 0 &&
      data.compositeGroups.length === 0 &&
      data.pageGroups.length === 0;

    if (!isEmpty) {
      return { data };
    }

    // Check if AI is configured
    const aiConfig = vscode.workspace.getConfiguration('hypercanvas.ai');
    const hasApiKey = !!aiConfig.get<string>('apiKey');

    if (!hasApiKey) {
      return { data, needsSetup: true, setupReason: 'no-ai-config' };
    }

    // AI config present but scan empty — paths are wrong or project has no components
    return { data, needsSetup: true, setupReason: 'empty-scan' };
  }

  /**
   * Scan for test files related to a component.
   * Ported from server/routes/getComponentTests.ts
   */
  async scanComponentTests(componentPath: string): Promise<TestGroup[]> {
    const absolutePath = path.isAbsolute(componentPath)
      ? componentPath
      : path.join(this._workspaceRoot, componentPath);

    const componentName = path.basename(absolutePath, path.extname(absolutePath));
    const componentDir = path.dirname(absolutePath);
    const groups: TestGroup[] = [];

    const toRelativePath = (p: string) => path.relative(this._workspaceRoot, p);

    // Variants file
    const ext = path.extname(absolutePath);
    const variantsPath = absolutePath.replace(ext, `.variants${ext}`);
    if (await fileExists(variantsPath)) {
      const content = await fs.readFile(variantsPath, 'utf-8');
      groups.push({
        type: 'variants',
        path: variantsPath,
        relativePath: toRelativePath(variantsPath),
        tests: extractVariantNames(content),
      });
    }

    // Unit test file
    const unitTestPaths = [
      path.join(componentDir, `${componentName}.test.ts`),
      path.join(componentDir, `${componentName}.test.tsx`),
      path.join(componentDir, `${componentName}.unit.test.ts`),
      path.join(componentDir, `${componentName}.unit.test.tsx`),
      path.join(componentDir, '__tests__', `${componentName}.test.ts`),
      path.join(componentDir, '__tests__', `${componentName}.test.tsx`),
    ];

    for (const unitPath of unitTestPaths) {
      if (await fileExists(unitPath)) {
        const content = await fs.readFile(unitPath, 'utf-8');
        groups.push({
          type: 'unit',
          path: unitPath,
          relativePath: toRelativePath(unitPath),
          tests: extractTestNames(content),
        });
        break;
      }
    }

    // E2E test file
    const e2eTestPaths = [
      path.join(this._workspaceRoot, 'tests', 'e2e', 'ui', `${componentName}.e2e.test.ts`),
      path.join(this._workspaceRoot, 'tests', 'e2e', `${componentName}.e2e.test.ts`),
      path.join(componentDir, 'tests', 'e2e', 'ui', `${componentName}.e2e.test.ts`),
      path.join(componentDir, 'tests', 'e2e', `${componentName}.e2e.test.ts`),
    ];

    for (const e2ePath of e2eTestPaths) {
      if (await fileExists(e2ePath)) {
        const content = await fs.readFile(e2ePath, 'utf-8');
        groups.push({
          type: 'e2e',
          path: e2ePath,
          relativePath: toRelativePath(e2ePath),
          tests: extractTestNames(content),
        });
        break;
      }
    }

    return groups;
  }

  /**
   * Get component info by path
   */
  async getComponent(componentPath: string): Promise<ComponentInfo | null> {
    // Check cache first
    if (this._cache.has(componentPath)) {
      return this._cache.get(componentPath)!;
    }

    // Parse file
    const absolutePath = path.join(this._workspaceRoot, componentPath);
    const uri = vscode.Uri.file(absolutePath);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const sourceCode = new TextDecoder().decode(content);
      return this._parseComponent(componentPath, sourceCode);
    } catch (error) {
      console.error(`[ComponentService] Error reading ${componentPath}:`, error);
      return null;
    }
  }

  /**
   * Get component definitions (props types)
   */
  async getComponentDefinitions(
    componentPath: string,
  ): Promise<PropInfo[] | null> {
    const component = await this.getComponent(componentPath);
    return component?.props ?? null;
  }

  /**
   * Parse component JSX structure into TreeNode[] for the Elements Tree.
   * Finds the exported component's return statement and walks JSX recursively.
   */
  async parseStructure(componentPath: string): Promise<TreeNode[]> {
    const absolutePath = path.join(this._workspaceRoot, componentPath);
    const uri = vscode.Uri.file(absolutePath);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const sourceCode = new TextDecoder().decode(content);
      const ast = parseCode(sourceCode);

      // Find the exported component's return JSX
      const returnJSX = this._findComponentReturnJSX(ast);
      if (!returnJSX) return [];

      return this._buildTreeFromJSX(returnJSX);
    } catch (error) {
      console.error(`[ComponentService] Error parsing structure for ${componentPath}:`, error);
      return [];
    }
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this._cache.clear();
  }

  // ============================================
  // Private Methods
  // ============================================

  /**
   * Parse component file
   */
  private async _parseComponentFile(
    uri: vscode.Uri,
  ): Promise<ComponentInfo | null> {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const sourceCode = new TextDecoder().decode(content);

      // Get relative path
      const relativePath = path.relative(this._workspaceRoot, uri.fsPath);

      return this._parseComponent(relativePath, sourceCode);
    } catch (error) {
      console.error(
        `[ComponentService] Error parsing file ${uri.fsPath}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Parse component source code
   */
  private _parseComponent(
    componentPath: string,
    sourceCode: string,
  ): ComponentInfo | null {
    try {
      const ast = parseCode(sourceCode);

      let componentName: string | null = null;
      let hasDefaultExport = false;
      let hasSampleRender = false;
      const props: PropInfo[] = [];

      // Look for component declarations and exports
      traverse(ast, {
        // Default export
        ExportDefaultDeclaration(nodePath: NodePath<t.ExportDefaultDeclaration>) {
          hasDefaultExport = true;

          const declaration = nodePath.node.declaration;
          if (t.isIdentifier(declaration)) {
            componentName = declaration.name;
          } else if (t.isFunctionDeclaration(declaration) && declaration.id) {
            componentName = declaration.id.name;
          }
        },

        // Named exports
        ExportNamedDeclaration(nodePath: NodePath<t.ExportNamedDeclaration>) {
          const declaration = nodePath.node.declaration;

          // Check for sampleRender export
          if (t.isFunctionDeclaration(declaration) && declaration.id) {
            if (declaration.id.name === 'sampleRender') {
              hasSampleRender = true;
            }
          }

          if (t.isVariableDeclaration(declaration)) {
            for (const decl of declaration.declarations) {
              if (t.isIdentifier(decl.id)) {
                if (decl.id.name === 'sampleRender') {
                  hasSampleRender = true;
                }
              }
            }
          }
        },

        // Function declarations (for component name)
        FunctionDeclaration(nodePath: NodePath<t.FunctionDeclaration>) {
          if (nodePath.node.id && /^[A-Z]/.test(nodePath.node.id.name)) {
            if (!componentName) {
              componentName = nodePath.node.id.name;
            }

            // Extract props from first parameter
            const firstParam = nodePath.node.params[0];
            if (t.isObjectPattern(firstParam)) {
              for (const prop of firstParam.properties) {
                if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                  props.push({
                    name: prop.key.name,
                    type: 'unknown',
                    required: true,
                  });
                }
              }
            }
          }
        },

        // Variable declarations (sampleRender and arrow function components)
        VariableDeclarator(nodePath: NodePath<t.VariableDeclarator>) {
          const id = nodePath.node.id;
          const init = nodePath.node.init;

          if (t.isIdentifier(id)) {
            // Check for sampleRender
            if (id.name === 'sampleRender') {
              hasSampleRender = true;
            }

            // Check for arrow function components (PascalCase)
            if (/^[A-Z]/.test(id.name) && t.isArrowFunctionExpression(init)) {
              if (!componentName) {
                componentName = id.name;
              }

              // Extract props from first parameter
              const firstParam = init.params[0];
              if (t.isObjectPattern(firstParam)) {
                for (const prop of firstParam.properties) {
                  if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                    props.push({
                      name: prop.key.name,
                      type: 'unknown',
                      required: true,
                    });
                  }
                }
              }
            }
          }
        },

        // TypeScript interface/type for Props
        TSInterfaceDeclaration: (nodePath: NodePath<t.TSInterfaceDeclaration>) => {
          const name = nodePath.node.id.name;
          if (name.endsWith('Props')) {
            for (const member of nodePath.node.body.body) {
              if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
                const propName = member.key.name;
                const typeAnnotation = member.typeAnnotation;
                let propType = 'unknown';

                if (
                  typeAnnotation &&
                  t.isTSTypeAnnotation(typeAnnotation)
                ) {
                  propType = this._getTypeString(typeAnnotation.typeAnnotation);
                }

                // Check if already exists
                const existing = props.find((p) => p.name === propName);
                if (existing) {
                  existing.type = propType;
                  existing.required = !member.optional;
                } else {
                  props.push({
                    name: propName,
                    type: propType,
                    required: !member.optional,
                  });
                }
              }
            }
          }
        },

        // TypeScript type alias for Props
        TSTypeAliasDeclaration: (nodePath: NodePath<t.TSTypeAliasDeclaration>) => {
          const name = nodePath.node.id.name;
          if (name.endsWith('Props') && t.isTSTypeLiteral(nodePath.node.typeAnnotation)) {
            for (const member of nodePath.node.typeAnnotation.members) {
              if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
                const propName = member.key.name;
                const typeAnnotation = member.typeAnnotation;
                let propType = 'unknown';

                if (
                  typeAnnotation &&
                  t.isTSTypeAnnotation(typeAnnotation)
                ) {
                  propType = this._getTypeString(typeAnnotation.typeAnnotation);
                }

                // Check if already exists
                const existing = props.find((p) => p.name === propName);
                if (existing) {
                  existing.type = propType;
                  existing.required = !member.optional;
                } else {
                  props.push({
                    name: propName,
                    type: propType,
                    required: !member.optional,
                  });
                }
              }
            }
          }
        },
      });

      // Skip if no component found
      if (!componentName) {
        // Try to get name from filename
        const basename = path.basename(componentPath, path.extname(componentPath));
        if (/^[A-Z]/.test(basename)) {
          componentName = basename;
        } else {
          return null;
        }
      }

      // Determine component type
      let type: 'atom' | 'composite' | 'page' = 'atom';
      if (componentPath.includes('/pages/') || componentPath.includes('/app/')) {
        type = 'page';
      } else if (componentPath.includes('/components/') && !componentPath.includes('/ui/')) {
        type = 'composite';
      }

      return {
        name: componentName,
        path: componentPath,
        type,
        hasDefaultExport,
        hasSampleRender,
        props,
      };
    } catch (error) {
      console.error(
        `[ComponentService] Error parsing component ${componentPath}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Find the JSX returned by the main exported component function.
   * Skips nested function declarations (event handlers, helpers).
   */
  private _findComponentReturnJSX(ast: t.File): t.JSXElement | t.JSXFragment | null {
    let result: t.JSXElement | t.JSXFragment | null = null;
    let exportedName: string | null = null;

    // First pass: find exported component name
    traverse(ast, {
      ExportDefaultDeclaration(nodePath: NodePath<t.ExportDefaultDeclaration>) {
        const decl = nodePath.node.declaration;
        if (t.isIdentifier(decl)) {
          exportedName = decl.name;
        } else if (t.isFunctionDeclaration(decl) && decl.id) {
          exportedName = decl.id.name;
        } else if (t.isFunctionDeclaration(decl)) {
          // Anonymous default export function — extract return directly
          const returnJSX = _extractReturnJSX(decl.body);
          if (returnJSX) result = returnJSX;
        }
      },
    });

    if (result) return result;

    // Second pass: find the function body and extract return JSX
    traverse(ast, {
      FunctionDeclaration(nodePath: NodePath<t.FunctionDeclaration>) {
        if (result) return;
        if (nodePath.node.id && nodePath.node.id.name === exportedName) {
          const returnJSX = _extractReturnJSX(nodePath.node.body);
          if (returnJSX) result = returnJSX;
        }
      },
      VariableDeclarator(nodePath: NodePath<t.VariableDeclarator>) {
        if (result) return;
        if (t.isIdentifier(nodePath.node.id) && nodePath.node.id.name === exportedName) {
          const init = nodePath.node.init;
          if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
            if (t.isBlockStatement(init.body)) {
              const returnJSX = _extractReturnJSX(init.body);
              if (returnJSX) result = returnJSX;
            } else if (t.isJSXElement(init.body) || t.isJSXFragment(init.body)) {
              result = init.body;
            }
          }
        }
      },
    });

    // Fallback: if no export default found, look for first PascalCase function
    if (!result && !exportedName) {
      traverse(ast, {
        FunctionDeclaration(nodePath: NodePath<t.FunctionDeclaration>) {
          if (result) return;
          if (nodePath.node.id && /^[A-Z]/.test(nodePath.node.id.name)) {
            const returnJSX = _extractReturnJSX(nodePath.node.body);
            if (returnJSX) result = returnJSX;
          }
        },
        VariableDeclarator(nodePath: NodePath<t.VariableDeclarator>) {
          if (result) return;
          if (t.isIdentifier(nodePath.node.id) && /^[A-Z]/.test(nodePath.node.id.name)) {
            const init = nodePath.node.init;
            if (t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)) {
              if (t.isBlockStatement(init.body)) {
                const returnJSX = _extractReturnJSX(init.body);
                if (returnJSX) result = returnJSX;
              } else if (t.isJSXElement(init.body) || t.isJSXFragment(init.body)) {
                result = init.body;
              }
            }
          }
        },
      });
    }

    return result;
  }

  /**
   * Recursively build TreeNode[] from a JSX element or fragment.
   */
  private _buildTreeFromJSX(node: t.JSXElement | t.JSXFragment): TreeNode[] {
    if (t.isJSXFragment(node)) {
      // Fragment: flatten children
      return this._processJSXChildren(node.children);
    }

    const treeNode = this._jsxElementToTreeNode(node);
    return treeNode ? [treeNode] : [];
  }

  /**
   * Convert a single JSX element to a TreeNode.
   */
  private _jsxElementToTreeNode(element: t.JSXElement): TreeNode | null {
    const tagName = _getTagName(element);
    if (!tagName) return null;

    const uuid = getUuidFromElement(element);
    const id = uuid || `_${tagName}_${element.loc?.start.line ?? 0}`;

    // Determine type
    let type: TreeNode['type'] = 'element';
    const lowerTag = tagName.toLowerCase();
    if (lowerTag === 'div' || lowerTag === 'section' || lowerTag === 'main' ||
        lowerTag === 'header' || lowerTag === 'footer' || lowerTag === 'nav' ||
        lowerTag === 'article' || lowerTag === 'aside' || lowerTag === 'form') {
      type = 'frame';
    } else if (/^[A-Z]/.test(tagName)) {
      type = 'component';
    }

    // Collect text content from direct text children
    const textParts: string[] = [];
    const jsxChildren: TreeNode[] = [];

    for (const child of element.children) {
      if (t.isJSXText(child)) {
        const trimmed = child.value.trim();
        if (trimmed) textParts.push(trimmed);
      } else if (t.isJSXElement(child)) {
        const childNode = this._jsxElementToTreeNode(child);
        if (childNode) jsxChildren.push(childNode);
      } else if (t.isJSXFragment(child)) {
        jsxChildren.push(...this._processJSXChildren(child.children));
      } else if (t.isJSXExpressionContainer(child)) {
        jsxChildren.push(...this._processExpression(child.expression));
      }
    }

    const label = textParts.length > 0
      ? `${tagName} "${textParts.join(' ').slice(0, 30)}"`
      : tagName;

    const treeNode: TreeNode = { id, type, label };
    if (jsxChildren.length > 0) {
      treeNode.children = jsxChildren;
    }

    return treeNode;
  }

  /**
   * Process JSX children array into TreeNode[].
   */
  private _processJSXChildren(children: t.Node[]): TreeNode[] {
    const nodes: TreeNode[] = [];

    for (const child of children) {
      if (t.isJSXElement(child)) {
        const node = this._jsxElementToTreeNode(child);
        if (node) nodes.push(node);
      } else if (t.isJSXFragment(child)) {
        nodes.push(...this._processJSXChildren(child.children));
      } else if (t.isJSXExpressionContainer(child)) {
        nodes.push(...this._processExpression(child.expression));
      }
    }

    return nodes;
  }

  /**
   * Process JSX expression containers — handles .map(), ternaries, && chains.
   */
  private _processExpression(expr: t.Expression | t.JSXEmptyExpression): TreeNode[] {
    if (t.isJSXEmptyExpression(expr)) return [];

    // .map() call — recurse into callback body
    if (t.isCallExpression(expr) && t.isMemberExpression(expr.callee)) {
      const prop = expr.callee.property;
      if (t.isIdentifier(prop) && prop.name === 'map') {
        const callback = expr.arguments[0];
        if (t.isArrowFunctionExpression(callback) || t.isFunctionExpression(callback)) {
          const mapChildren = this._extractJSXFromFunctionBody(callback);
          if (mapChildren.length > 0) {
            // Wrap in a virtual ".map()" node
            const calleeObj = expr.callee.object;
            const arrayName = t.isIdentifier(calleeObj) ? calleeObj.name : 'items';
            return [{
              id: `_map_${expr.loc?.start.line ?? 0}`,
              type: 'map',
              label: `${arrayName}.map()`,
              children: mapChildren,
            }];
          }
        }
      }
    }

    // Conditional: condition && <JSX>
    if (t.isLogicalExpression(expr) && expr.operator === '&&') {
      return this._extractJSXFromExpression(expr.right);
    }

    // Ternary: condition ? <A> : <B>
    if (t.isConditionalExpression(expr)) {
      return [
        ...this._extractJSXFromExpression(expr.consequent),
        ...this._extractJSXFromExpression(expr.alternate),
      ];
    }

    // Direct JSX in expression
    return this._extractJSXFromExpression(expr);
  }

  /**
   * Extract JSX from an arrow/function body.
   */
  private _extractJSXFromFunctionBody(
    fn: t.ArrowFunctionExpression | t.FunctionExpression,
  ): TreeNode[] {
    if (t.isJSXElement(fn.body) || t.isJSXFragment(fn.body)) {
      return this._buildTreeFromJSX(fn.body);
    }

    if (t.isBlockStatement(fn.body)) {
      for (const stmt of fn.body.body) {
        if (t.isReturnStatement(stmt) && stmt.argument) {
          if (t.isJSXElement(stmt.argument)) {
            return this._buildTreeFromJSX(stmt.argument);
          }
          if (t.isJSXFragment(stmt.argument)) {
            return this._buildTreeFromJSX(stmt.argument);
          }
          // Parenthesized expression
          if (t.isParenthesizedExpression(stmt.argument)) {
            const inner = stmt.argument.expression;
            if (t.isJSXElement(inner) || t.isJSXFragment(inner)) {
              return this._buildTreeFromJSX(inner);
            }
          }
        }
      }
    }

    return [];
  }

  /**
   * Extract TreeNode[] from a single expression (might be JSX).
   */
  private _extractJSXFromExpression(expr: t.Expression): TreeNode[] {
    if (t.isJSXElement(expr)) {
      const node = this._jsxElementToTreeNode(expr);
      return node ? [node] : [];
    }
    if (t.isJSXFragment(expr)) {
      return this._processJSXChildren(expr.children);
    }
    if (t.isParenthesizedExpression(expr)) {
      return this._extractJSXFromExpression(expr.expression);
    }
    return [];
  }

  /**
   * Get type string from TypeScript AST node
   */
  private _getTypeString(node: t.TSType): string {
    if (t.isTSStringKeyword(node)) return 'string';
    if (t.isTSNumberKeyword(node)) return 'number';
    if (t.isTSBooleanKeyword(node)) return 'boolean';
    if (t.isTSAnyKeyword(node)) return 'any';
    if (t.isTSVoidKeyword(node)) return 'void';
    if (t.isTSNullKeyword(node)) return 'null';
    if (t.isTSUndefinedKeyword(node)) return 'undefined';
    if (t.isTSUnionType(node)) {
      return node.types.map((t) => this._getTypeString(t)).join(' | ');
    }
    if (t.isTSArrayType(node)) {
      return `${this._getTypeString(node.elementType)}[]`;
    }
    if (t.isTSTypeReference(node) && t.isIdentifier(node.typeName)) {
      return node.typeName.name;
    }
    if (t.isTSFunctionType(node)) {
      return 'Function';
    }

    return 'unknown';
  }
}

// ============================================
// Module-level helpers
// ============================================

/**
 * Extract the top-level return JSX from a function body.
 * Only looks at direct return statements (not inside nested functions).
 */
function _extractReturnJSX(body: t.BlockStatement): t.JSXElement | t.JSXFragment | null {
  for (const stmt of body.body) {
    if (t.isReturnStatement(stmt) && stmt.argument) {
      const arg = stmt.argument;
      if (t.isJSXElement(arg) || t.isJSXFragment(arg)) {
        return arg;
      }
      // Parenthesized: return (<div>...</div>)
      if (t.isParenthesizedExpression(arg)) {
        const inner = arg.expression;
        if (t.isJSXElement(inner) || t.isJSXFragment(inner)) {
          return inner;
        }
      }
    }
  }
  return null;
}

/**
 * Get tag name from a JSX element.
 */
function _getTagName(element: t.JSXElement): string | null {
  const name = element.openingElement.name;
  if (t.isJSXIdentifier(name)) {
    return name.name;
  }
  if (t.isJSXMemberExpression(name)) {
    // e.g. Motion.div → "Motion.div"
    const parts: string[] = [];
    let current: t.JSXMemberExpression | t.JSXIdentifier = name;
    while (t.isJSXMemberExpression(current)) {
      parts.unshift(current.property.name);
      current = current.object;
    }
    if (t.isJSXIdentifier(current)) {
      parts.unshift(current.name);
    }
    return parts.join('.');
  }
  return null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Extract test/describe names from a test file */
function extractTestNames(content: string): TestInfo[] {
  const tests: TestInfo[] = [];
  const lines = content.split('\n');
  const patterns = [
    /^\s*(?:test|it)\s*\(\s*['"`](.+?)['"`]/,
    /^\s*(?:test|it)\.(?:only|skip)\s*\(\s*['"`](.+?)['"`]/,
    /^\s*describe\s*\(\s*['"`](.+?)['"`]/,
    /^\s*describe\.(?:only|skip)\s*\(\s*['"`](.+?)['"`]/,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      const match = lines[i].match(pattern);
      if (match) {
        tests.push({ name: match[1], line: i + 1 });
        break;
      }
    }
  }

  return tests;
}

/** Extract variant names from a .variants.tsx file */
function extractVariantNames(content: string): TestInfo[] {
  const variants: TestInfo[] = [];
  const lines = content.split('\n');
  const idPattern = /^\s*id:\s*['"`](.+?)['"`]/;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(idPattern);
    if (match) {
      variants.push({ name: match[1], line: i + 1 });
    }
  }

  return variants;
}
