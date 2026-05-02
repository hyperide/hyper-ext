/**
 * Component Service - scans and parses React components locally
 *
 * Provides component discovery and parsing without server dependency.
 * Uses VS Code file system API and Babel for parsing.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { parseCode } from '@lib/ast/parser';
import { type ComponentNode, type ParseContext, parseJSXElement } from '@lib/services/component-parser';
import { convertComponentNodesToTreeNodes } from '@lib/services/tree-adapter';
import type { ComponentInfo, ComponentTree, PropInfo, TreeNode } from '@lib/types';
import * as vscode from 'vscode';
import { analyzeWithAI, resolveAnalyzerConfig } from '../../../../lib/component-scanner/ai-analyzer';
import { getDirectoryTree } from '../../../../lib/component-scanner/directory-tree';
import { ComponentScanner } from '../../../../lib/component-scanner/scanner';
import type { ComponentsData, TestGroup, TestInfo } from '../../../../lib/component-scanner/types';
import { FileProjectStructureStore } from './FileStructureStore';

// Re-export shared types for convenience
export type { ComponentInfo, ComponentTree, PropInfo };

export type SetupReason = 'no-ai-config' | 'no-paths' | 'empty-scan';

export interface ScanResult {
  data: ComponentsData;
  needsSetup?: boolean;
  setupReason?: SetupReason;
}

const traverse = (_traverse as { default?: typeof _traverse }).default ?? _traverse;

// ============================================
// ComponentService Class
// ============================================

export class ComponentService {
  private _workspaceRoot: string;
  private _getApiKey: () => Promise<string | undefined>;
  private _cache: Map<string, ComponentInfo> = new Map();
  private _structureStore = new FileProjectStructureStore();

  constructor(workspaceRoot: string, getApiKey: () => Promise<string | undefined>) {
    this._workspaceRoot = workspaceRoot;
    this._getApiKey = getApiKey;
  }

  /** Flush deferred .hyperide writes to disk. Returns true if anything was written. */
  flushStructureStore(): Promise<boolean> {
    return this._structureStore.flush();
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
    const files = await vscode.workspace.findFiles(componentGlob, '**/node_modules/**');

    for (const file of files) {
      try {
        const componentInfo = await this._parseComponentFile(file);
        if (componentInfo) {
          // Categorize by directory or naming convention
          if (file.fsPath.includes('/pages/') || file.fsPath.includes('/app/')) {
            tree.pages.push(componentInfo);
          } else if (file.fsPath.includes('/components/') && !file.fsPath.includes('/components/ui/')) {
            tree.composites.push(componentInfo);
          } else {
            tree.atoms.push(componentInfo);
          }

          // Cache for quick lookup
          this._cache.set(componentInfo.path, componentInfo);
        }
      } catch (error) {
        console.error(
          // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
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
   *
   * Strategy:
   * 1. Check cached structure in store
   * 2. Try AI analysis if configured
   * 3. Fall back to heuristic detection (always works for standard React projects)
   *
   * AI is only needed for ambiguous/non-standard project layouts.
   */
  async scanComponentGroups(): Promise<ScanResult> {
    const scanner = new ComponentScanner(this._structureStore, async (root) => {
      const config = vscode.workspace.getConfiguration('hypercanvas.ai');
      const apiKey = await this._getApiKey();
      const model = config.get<string>('model');
      const provider = config.get<string>('provider', 'glm');
      const backend = config.get<string>('backend');

      if (apiKey && model) {
        const resolved = resolveAnalyzerConfig({
          provider: provider as string,
          apiKey,
          model,
          baseURL: config.get<string>('baseURL'),
          backend: backend || undefined,
        });

        if (resolved) {
          try {
            const tree = await getDirectoryTree(root);
            // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
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
            console.log(`[ComponentService] AI found ${n} component paths`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
            if (n > 0) return result;
            console.warn('[ComponentService] AI returned empty paths, falling back to heuristic detection');
          } catch (error) {
            console.error('[ComponentService] AI analysis failed, falling back to heuristic detection:', error);
          }
        } else {
          console.warn(`[ComponentService] Could not resolve provider "${provider}" config, using heuristic detection`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        }
      } else {
        console.log('[ComponentService] No AI config, using heuristic detection');
      }

      // AI not available or failed — heuristic detection handles it
      // (returning empty triggers detectProjectStructure in scanner.analyze)
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

    const isEmpty = data.atomGroups.length === 0 && data.compositeGroups.length === 0 && data.pageGroups.length === 0;

    if (!isEmpty) {
      return { data };
    }

    // Heuristic detection already ran inside scanner.analyze — if still empty,
    // project genuinely has no detectable components
    return { data, needsSetup: true, setupReason: 'empty-scan' };
  }

  /**
   * Scan for test files related to a component.
   * Ported from server/routes/getComponentTests.ts
   */
  async scanComponentTests(componentPath: string): Promise<TestGroup[]> {
    const absolutePath = path.isAbsolute(componentPath) ? componentPath : path.join(this._workspaceRoot, componentPath);

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
      return this._cache.get(componentPath) ?? null;
    }

    // Parse file
    const absolutePath = path.join(this._workspaceRoot, componentPath);
    const uri = vscode.Uri.file(absolutePath);

    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const sourceCode = new TextDecoder().decode(content);
      return this._parseComponent(componentPath, sourceCode);
    } catch (error) {
      console.error(`[ComponentService] Error reading ${componentPath}:`, error); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      return null;
    }
  }

  /**
   * Get component definitions (props types)
   */
  async getComponentDefinitions(componentPath: string): Promise<PropInfo[] | null> {
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

      const parseContext: ParseContext = { fileAST: ast };
      const componentNodes = this._parseRootJSX(returnJSX, parseContext);
      return convertComponentNodesToTreeNodes(componentNodes);
    } catch (error) {
      console.error(`[ComponentService] Error parsing structure for ${componentPath}:`, error); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      return [];
    }
  }

  private _parseRootJSX(root: t.JSXElement | t.JSXFragment, parseContext: ParseContext): ComponentNode[] {
    if (t.isJSXElement(root)) {
      const node = parseJSXElement(root, undefined, undefined, undefined, parseContext);
      return node ? [node] : [];
    }
    // Fragment: parse each child element
    return root.children
      .filter((c): c is t.JSXElement => t.isJSXElement(c))
      .map((c) => parseJSXElement(c, undefined, undefined, undefined, parseContext))
      .filter((n): n is ComponentNode => n !== null);
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
  private async _parseComponentFile(uri: vscode.Uri): Promise<ComponentInfo | null> {
    try {
      const content = await vscode.workspace.fs.readFile(uri);
      const sourceCode = new TextDecoder().decode(content);

      // Get relative path
      const relativePath = path.relative(this._workspaceRoot, uri.fsPath);

      return this._parseComponent(relativePath, sourceCode);
    } catch (error) {
      console.error(
        // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        `[ComponentService] Error parsing file ${uri.fsPath}:`,
        error,
      );
      return null;
    }
  }

  /**
   * Parse component source code
   */
  private _parseComponent(componentPath: string, sourceCode: string): ComponentInfo | null {
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
                let objectFields: PropInfo[] | undefined;

                if (typeAnnotation && t.isTSTypeAnnotation(typeAnnotation)) {
                  propType = this._getTypeString(typeAnnotation.typeAnnotation);
                  objectFields = this._extractObjectFields(typeAnnotation.typeAnnotation);
                }

                // Check if already exists
                const existing = props.find((p) => p.name === propName);
                if (existing) {
                  existing.type = propType;
                  existing.required = !member.optional;
                  existing.objectFields = objectFields;
                } else {
                  props.push({
                    name: propName,
                    type: propType,
                    required: !member.optional,
                    objectFields,
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
                let objectFields: PropInfo[] | undefined;

                if (typeAnnotation && t.isTSTypeAnnotation(typeAnnotation)) {
                  propType = this._getTypeString(typeAnnotation.typeAnnotation);
                  objectFields = this._extractObjectFields(typeAnnotation.typeAnnotation);
                }

                // Check if already exists
                const existing = props.find((p) => p.name === propName);
                if (existing) {
                  existing.type = propType;
                  existing.required = !member.optional;
                  existing.objectFields = objectFields;
                } else {
                  props.push({
                    name: propName,
                    type: propType,
                    required: !member.optional,
                    objectFields,
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
        // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
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
    if (t.isTSTypeLiteral(node)) {
      // Produce readable inline object type: { user: string; count: number }
      const parts: string[] = [];
      for (const member of node.members) {
        if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
          const opt = member.optional ? '?' : '';
          const memberType =
            member.typeAnnotation && t.isTSTypeAnnotation(member.typeAnnotation)
              ? this._getTypeString(member.typeAnnotation.typeAnnotation)
              : 'unknown';
          parts.push(`${member.key.name}${opt}: ${memberType}`);
        }
      }
      return parts.length > 0 ? `{ ${parts.join('; ')} }` : 'object';
    }

    return 'unknown';
  }

  /**
   * Extract nested object fields from a TSTypeLiteral node.
   * Returns PropInfo[] for inline object types, undefined otherwise.
   */
  private _extractObjectFields(node: t.TSType, depth = 0): PropInfo[] | undefined {
    if (depth > 5) return undefined;
    if (!t.isTSTypeLiteral(node)) return undefined;

    const fields: PropInfo[] = [];
    for (const member of node.members) {
      if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
        const typeAnnotation = member.typeAnnotation;
        let fieldType = 'unknown';
        let objectFields: PropInfo[] | undefined;

        if (typeAnnotation && t.isTSTypeAnnotation(typeAnnotation)) {
          fieldType = this._getTypeString(typeAnnotation.typeAnnotation);
          objectFields = this._extractObjectFields(typeAnnotation.typeAnnotation, depth + 1);
        }

        fields.push({
          name: member.key.name,
          type: fieldType,
          required: !member.optional,
          objectFields,
        });
      }
    }

    return fields.length > 0 ? fields : undefined;
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
