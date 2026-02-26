/**
 * AST Service - handles all AST manipulation operations
 *
 * Provides methods for updating styles, props, inserting/deleting elements,
 * duplicating, and wrapping elements.
 *
 * Uses shared lib/ast/ utilities with VSCodeFileIO for file operations.
 */

import _traverse, { type NodePath } from '@babel/traverse';
import * as t from '@babel/types';
import { detectClassNameType, modifyDynamicClassName } from '@lib/ast/dynamic-classname-mutator';
import type { FileIO } from '@lib/ast/file-io';
import {
  cloneElement,
  getAttributeString,
  makeNotSelfClosing,
  setAttribute,
  updateElementChildren,
  valueToJSXAttribute,
} from '@lib/ast/mutator';
import { createFileParser, parseCode } from '@lib/ast/parser';
import { findElementByUuid, getUuidFromElement } from '@lib/ast/traverser';
import { ensureUuid, generateUuid, updateAllChildUuids } from '@lib/ast/uuid';
import { generateTailwindClasses } from '@lib/tailwind/generator';
import { removeConflictingClasses } from '@lib/tailwind/parser';
import type { ClassNameLocation } from '@lib/types';

// Normalize ESM/CJS interop: babel/traverse may export default or be the function directly.
// biome-ignore lint/suspicious/noExplicitAny: required for ESM/CJS module interop
const traverse = ((_traverse as any)?.default ?? _traverse) as typeof _traverse;

// ============================================
// Response Types
// ============================================

export interface AstOperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
}

export interface UpdateStylesResult extends AstOperationResult {
  className?: string;
}

export interface InsertElementResult extends AstOperationResult {
  newId?: string;
  index?: number;
}

export interface DuplicateElementResult extends AstOperationResult {
  newId?: string;
}

export interface WrapElementResult extends AstOperationResult {
  wrapperId?: string;
}

// ============================================
// AstService Class
// ============================================

export class AstService {
  private _workspaceRoot: string;
  private _fileParser: ReturnType<typeof createFileParser>;

  constructor(workspaceRoot: string, fileIO: FileIO) {
    this._workspaceRoot = workspaceRoot;
    this._fileParser = createFileParser(fileIO);
  }

  /**
   * Resolve file path to absolute path
   */
  private _resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return filePath;
    }
    return `${this._workspaceRoot}/${filePath}`;
  }

  /**
   * Update element styles using shared Tailwind utilities.
   * Handles both static and dynamic className expressions.
   * For dynamic classNames (template literals, cn() calls), uses
   * modifyDynamicClassName with optional AI-found locations.
   */
  async updateStyles(
    filePath: string,
    elementId: string,
    styles: Record<string, string>,
    state?: string,
    locations?: ClassNameLocation[],
  ): Promise<UpdateStylesResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      // Find element by UUID
      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return {
          success: false,
          error: `Element with data-uniq-id="${elementId}" not found`,
        };
      }

      const changedStyleKeys = Object.keys(styles);
      const classNameType = detectClassNameType(result.element);

      if (classNameType === 'string') {
        // Static className — remove conflicts + generate + set
        const existingClassName = getAttributeString(result.element, 'className') || '';
        const { preserved } = removeConflictingClasses(existingClassName, changedStyleKeys, state);
        const newClasses = generateTailwindClasses(styles, state);
        const newClassName = [preserved, newClasses].filter(Boolean).join(' ').trim();
        setAttribute(result.element, 'className', t.stringLiteral(newClassName));

        await this._fileParser.writeAST(ast, absolutePath);
        return { success: true, className: newClassName };
      }

      // Dynamic className — use modifyDynamicClassName
      const sourceCode = await this._fileParser.readFileContent(absolutePath);
      const newClasses = generateTailwindClasses(styles, state);
      modifyDynamicClassName(
        ast,
        sourceCode,
        result.element,
        locations ?? [],
        { newClasses },
        changedStyleKeys,
        'append',
      );

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.updateStyles] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update element props
   */
  async updateProps(filePath: string, elementId: string, props: Record<string, unknown>): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      // Find element by UUID
      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return {
          success: false,
          error: `Element with data-uniq-id="${elementId}" not found`,
        };
      }

      // Update each prop
      for (const [propName, propValue] of Object.entries(props)) {
        const newValue = valueToJSXAttribute(propValue);
        setAttribute(result.element, propName, newValue);
      }

      // Write back to file
      await this._fileParser.writeAST(ast, absolutePath);

      return { success: true };
    } catch (error) {
      console.error('[AstService.updateProps] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Update text/expression children of a JSX element.
   * Uses shared updateElementChildren utility for proper JSX children replacement.
   */
  async updateText(filePath: string, elementId: string, text: string): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return {
          success: false,
          error: `Element with data-uniq-id="${elementId}" not found`,
        };
      }

      updateElementChildren(result.element, text);

      await this._fileParser.writeAST(ast, absolutePath);

      return { success: true };
    } catch (error) {
      console.error('[AstService.updateText] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Insert new element
   */
  async insertElement(
    filePath: string,
    parentId: string | null,
    componentType: string,
    props: Record<string, unknown>,
    index?: number,
    targetId?: string,
  ): Promise<InsertElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      // Generate or use provided ID
      const newId = targetId || generateUuid();

      // Create attributes
      const attributes: t.JSXAttribute[] = [t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral(newId))];

      // Extract children from props
      const { children, ...otherProps } = props as { children?: unknown };

      // Add other props as attributes
      for (const [key, value] of Object.entries(otherProps)) {
        const attrValue = valueToJSXAttribute(value);
        if (attrValue !== null) {
          attributes.push(t.jsxAttribute(t.jsxIdentifier(key), attrValue));
        }
      }

      // Create children content
      const childrenContent: (t.JSXText | t.JSXExpressionContainer)[] = [];
      if (typeof children === 'string') {
        childrenContent.push(t.jsxText(children));
      }

      // Create element
      const isSelfClosing = childrenContent.length === 0;
      const newElement = t.jsxElement(
        t.jsxOpeningElement(t.jsxIdentifier(componentType), attributes, isSelfClosing),
        isSelfClosing ? null : t.jsxClosingElement(t.jsxIdentifier(componentType)),
        childrenContent,
        isSelfClosing,
      );

      let inserted = false;
      let actualIndex: number | undefined;

      if (!parentId) {
        // Insert at root level - find return statement
        traverse(ast, {
          ReturnStatement(path: NodePath<t.ReturnStatement>) {
            if (t.isJSXElement(path.node.argument)) {
              const returnElement = path.node.argument;
              makeNotSelfClosing(returnElement);

              const jsxElementCount = returnElement.children.filter((c) => t.isJSXElement(c)).length;

              if (index !== undefined && index >= 0 && index <= jsxElementCount) {
                const realIndex = AstService._calculateRealIndex(returnElement.children, index);
                returnElement.children.splice(realIndex, 0, newElement);
                actualIndex = index;
              } else {
                actualIndex = jsxElementCount;
                returnElement.children.push(newElement);
              }

              inserted = true;
              path.stop();
            }
          },
        });
      } else {
        // Find parent by UUID
        traverse(ast, {
          JSXElement(path: NodePath<t.JSXElement>) {
            const dataUniqIdAttr = path.node.openingElement.attributes.find(
              (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
            );

            if (
              dataUniqIdAttr &&
              t.isJSXAttribute(dataUniqIdAttr) &&
              t.isStringLiteral(dataUniqIdAttr.value) &&
              dataUniqIdAttr.value.value === parentId
            ) {
              makeNotSelfClosing(path.node);

              const jsxElementCount = path.node.children.filter((c) => t.isJSXElement(c)).length;

              if (index !== undefined && index >= 0 && index <= jsxElementCount) {
                const realIndex = AstService._calculateRealIndex(path.node.children, index);
                path.node.children.splice(realIndex, 0, newElement);
                actualIndex = index;
              } else {
                actualIndex = jsxElementCount;
                path.node.children.push(newElement);
              }

              inserted = true;
              path.stop();
            }
          },
        });
      }

      if (!inserted) {
        return {
          success: false,
          error: parentId
            ? `Parent element with data-uniq-id="${parentId}" not found`
            : 'Could not find return statement with JSX',
        };
      }

      // Write back to file
      await this._fileParser.writeAST(ast, absolutePath);

      return {
        success: true,
        newId,
        index: actualIndex,
      };
    } catch (error) {
      console.error('[AstService.insertElement] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Delete elements by IDs
   */
  async deleteElements(filePath: string, elementIds: string[]): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      let deletedCount = 0;

      for (const elementId of elementIds) {
        const { ast } = await this._fileParser.readAndParseFile(absolutePath);

        const result = findElementByUuid(ast, elementId);
        if (!result) {
          // nosemgrep: unsafe-formatstring -- safe: only first 8 chars of elementId are logged, preventing injected format specifiers
          console.log(
            `[AstService.deleteElements] Element ${elementId.substring(0, 8)} not found (may have been deleted as child)`,
          );
          continue;
        }

        // Remove element
        result.path.remove();

        // Write back to file
        await this._fileParser.writeAST(ast, absolutePath);
        deletedCount++;
      }

      if (deletedCount === 0) {
        return {
          success: false,
          error: 'No elements found with provided IDs',
        };
      }

      return {
        success: true,
        data: { deletedCount },
      };
    } catch (error) {
      console.error('[AstService.deleteElements] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Duplicate element
   */
  async duplicateElement(filePath: string, elementId: string): Promise<DuplicateElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      // Find element by UUID
      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return {
          success: false,
          error: `Element with data-uniq-id="${elementId}" not found`,
        };
      }

      // Clone the element
      const clonedElement = cloneElement(result.element);

      // Generate new UUID for the clone
      const newId = generateUuid();
      setAttribute(clonedElement, 'data-uniq-id', t.stringLiteral(newId));

      // Recursively update all data-uniq-id in children
      updateAllChildUuids(clonedElement);

      // Insert after original
      const parent = result.path.parent;

      if (t.isJSXElement(parent)) {
        const children = parent.children;
        const index = children.indexOf(result.path.node);
        if (index !== -1) {
          children.splice(index + 1, 0, clonedElement);
        }
      }

      // Write back to file
      await this._fileParser.writeAST(ast, absolutePath);

      return {
        success: true,
        newId,
      };
    } catch (error) {
      console.error('[AstService.duplicateElement] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Wrap element in another element
   */
  async wrapElement(
    filePath: string,
    elementId: string,
    wrapperType: string,
    wrapperProps?: Record<string, unknown>,
  ): Promise<WrapElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const wrapperId = generateUuid();
      let wrapped = false;

      traverse(ast, {
        JSXElement(path: NodePath<t.JSXElement>) {
          if (wrapped) return;

          const dataUniqIdAttr = path.node.openingElement.attributes.find(
            (attr) => t.isJSXAttribute(attr) && t.isJSXIdentifier(attr.name) && attr.name.name === 'data-uniq-id',
          );

          if (
            dataUniqIdAttr &&
            t.isJSXAttribute(dataUniqIdAttr) &&
            t.isStringLiteral(dataUniqIdAttr.value) &&
            dataUniqIdAttr.value.value === elementId
          ) {
            // Create wrapper attributes
            const wrapperAttrs: t.JSXAttribute[] = [
              t.jsxAttribute(t.jsxIdentifier('data-uniq-id'), t.stringLiteral(wrapperId)),
            ];

            // Add additional wrapper props
            if (wrapperProps) {
              for (const [key, value] of Object.entries(wrapperProps)) {
                const attrValue = valueToJSXAttribute(value);
                if (attrValue !== null) {
                  wrapperAttrs.push(t.jsxAttribute(t.jsxIdentifier(key), attrValue));
                }
              }
            }

            // Create wrapper element
            const wrapper = t.jsxElement(
              t.jsxOpeningElement(t.jsxIdentifier(wrapperType), wrapperAttrs),
              t.jsxClosingElement(t.jsxIdentifier(wrapperType)),
              [path.node],
              false,
            );

            // Replace original with wrapper
            path.replaceWith(wrapper);

            wrapped = true;
            path.stop();
          }
        },
      });

      if (!wrapped) {
        return {
          success: false,
          error: `Element with data-uniq-id="${elementId}" not found`,
        };
      }

      // Write back to file
      await this._fileParser.writeAST(ast, absolutePath);

      return {
        success: true,
        wrapperId,
      };
    } catch (error) {
      console.error('[AstService.wrapElement] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Find element at cursor position (for Go to Visual)
   */
  async findElementAtPosition(
    filePath: string,
    line: number,
    column: number,
  ): Promise<{ uuid: string; tagName: string } | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      let bestMatch: {
        uuid: string;
        tagName: string;
        size: number;
      } | null = null;

      traverse(ast, {
        JSXElement(path: NodePath<t.JSXElement>) {
          const loc = path.node.loc;
          if (!loc) return;

          // Check if position is within this element
          const isWithin =
            (line > loc.start.line || (line === loc.start.line && column >= loc.start.column)) &&
            (line < loc.end.line || (line === loc.end.line && column <= loc.end.column));

          if (!isWithin) return;

          // Get UUID
          const uuid = getUuidFromElement(path.node);
          if (!uuid) return;

          // Calculate size
          const size = (loc.end.line - loc.start.line) * 1000 + (loc.end.column - loc.start.column);

          // Keep smallest (most specific)
          if (!bestMatch || size < bestMatch.size) {
            const name = path.node.openingElement.name;
            const tagName = t.isJSXIdentifier(name) ? name.name : 'unknown';

            bestMatch = { uuid, tagName, size };
          }
        },
      });

      if (bestMatch) {
        const { uuid, tagName } = bestMatch;
        return { uuid, tagName };
      }

      return null;
    } catch (error) {
      console.error('[AstService.findElementAtPosition] Error:', error);
      return null;
    }
  }

  /**
   * Get element location (for Go to Code)
   */
  async getElementLocation(filePath: string, elementId: string): Promise<{ line: number; column: number } | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result || !result.element.loc) {
        return null;
      }

      return {
        line: result.element.loc.start.line,
        column: result.element.loc.start.column,
      };
    } catch (error) {
      console.error('[AstService.getElementLocation] Error:', error);
      return null;
    }
  }

  /**
   * Inject data-uniq-id attributes into all JSX elements that don't have one.
   * Modifies the source file in place (recast preserves formatting).
   * Must be called before parseStructure so tree nodes get real UUIDs.
   */
  async injectUniqueIds(filePath: string): Promise<{ addedCount: number }> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      let addedCount = 0;
      const seenIds = new Set<string>();

      traverse(ast, {
        JSXElement(path: NodePath<t.JSXElement>) {
          const existingId = getUuidFromElement(path.node);

          if (!existingId) {
            // No data-uniq-id — add new one
            const newId = ensureUuid(path.node);
            seenIds.add(newId);
            addedCount++;
          } else if (seenIds.has(existingId)) {
            // Duplicate — regenerate
            const newId = ensureUuid(path.node);
            seenIds.add(newId);
            addedCount++;
            console.warn(
              `[AstService.injectUniqueIds] Duplicate data-uniq-id "${existingId}", replaced: ${newId.substring(0, 8)}`,
            ); // nosemgrep: unsafe-formatstring
          } else {
            seenIds.add(existingId);
          }
        },
      });

      if (addedCount > 0) {
        await this._fileParser.writeAST(ast, absolutePath);
        console.log(`[AstService.injectUniqueIds] Added/fixed ${addedCount} UUIDs in ${filePath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }

      return { addedCount };
    } catch (error) {
      console.error('[AstService.injectUniqueIds] Error:', error);
      return { addedCount: 0 };
    }
  }

  /**
   * Get element's TSX source code (for Copy operation)
   */
  async getElementCode(filePath: string, elementId: string): Promise<string | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const sourceCode = await this._fileParser.readFileContent(absolutePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result || !result.element.loc) {
        return null;
      }

      const { start, end } = result.element.loc;
      const lines = sourceCode.split('\n');

      // Extract source substring from file using loc positions
      const startOffset = lines.slice(0, start.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + start.column;
      const endOffset = lines.slice(0, end.line - 1).reduce((sum, line) => sum + line.length + 1, 0) + end.column;

      return sourceCode.substring(startOffset, endOffset);
    } catch (error) {
      console.error('[AstService.getElementCode] Error:', error);
      return null;
    }
  }

  /**
   * Find parent element with data-uniq-id (for Select Parent)
   */
  async getParentElementId(filePath: string, elementId: string): Promise<string | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) return null;

      // Walk up the AST path to find parent JSXElement with uuid
      let currentPath: NodePath | null = result.path.parentPath;
      while (currentPath) {
        if (currentPath.isJSXElement()) {
          const parentUuid = getUuidFromElement(currentPath.node);
          if (parentUuid) {
            return parentUuid;
          }
        }
        currentPath = currentPath.parentPath;
      }

      return null;
    } catch (error) {
      console.error('[AstService.getParentElementId] Error:', error);
      return null;
    }
  }

  /**
   * Find direct child elements with data-uniq-id (for Select Child)
   */
  async getChildElementIds(filePath: string, elementId: string): Promise<string[]> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) return [];

      const childIds: string[] = [];
      for (const child of result.element.children) {
        if (t.isJSXElement(child)) {
          const uuid = getUuidFromElement(child);
          if (uuid) {
            childIds.push(uuid);
          }
        }
      }

      return childIds;
    } catch (error) {
      console.error('[AstService.getChildElementIds] Error:', error);
      return [];
    }
  }

  /**
   * Insert element from TSX code string (for Paste operation).
   * Parses the TSX code, generates new UUIDs, and inserts after target element.
   */
  async pasteElement(filePath: string, targetId: string | null, tsxCode: string): Promise<InsertElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      // Parse the TSX code into AST nodes
      const wrappedCode = `<>{${tsxCode}}</>`;
      const parsedAst = parseCode(wrappedCode);

      // Extract JSX elements from the parsed fragment
      const newElements: t.JSXElement[] = [];
      traverse(parsedAst, {
        JSXFragment(path: NodePath<t.JSXFragment>) {
          for (const child of path.node.children) {
            if (t.isJSXElement(child)) {
              newElements.push(child);
            }
          }
          path.stop();
        },
      });

      if (newElements.length === 0) {
        return { success: false, error: 'No valid JSX elements in clipboard' };
      }

      // Generate new UUIDs for all pasted elements
      let firstNewId: string | null = null;
      for (const el of newElements) {
        const newId = generateUuid();
        if (!firstNewId) firstNewId = newId;
        setAttribute(el, 'data-uniq-id', t.stringLiteral(newId));
        updateAllChildUuids(el);
      }

      let inserted = false;

      if (targetId) {
        // Insert after target element
        const result = findElementByUuid(ast, targetId);
        if (result) {
          const parent = result.path.parent;
          if (t.isJSXElement(parent)) {
            const children = parent.children;
            const index = children.indexOf(result.path.node);
            if (index !== -1) {
              children.splice(index + 1, 0, ...newElements);
              inserted = true;
            }
          }
        }
      }

      if (!inserted) {
        // Insert at end of first return JSXElement
        traverse(ast, {
          ReturnStatement(path: NodePath<t.ReturnStatement>) {
            if (t.isJSXElement(path.node.argument)) {
              makeNotSelfClosing(path.node.argument);
              path.node.argument.children.push(...newElements);
              inserted = true;
              path.stop();
            }
          },
        });
      }

      if (!inserted) {
        return { success: false, error: 'Could not find insertion point' };
      }

      await this._fileParser.writeAST(ast, absolutePath);

      return { success: true, newId: firstNewId ?? undefined };
    } catch (error) {
      console.error('[AstService.pasteElement] Error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // ============================================
  // Private Helpers
  // ============================================

  /**
   * Calculate real index in children array
   * (accounting for JSXText nodes)
   */
  private static _calculateRealIndex(
    children: (t.JSXElement | t.JSXText | t.JSXExpressionContainer | t.JSXFragment | t.JSXSpreadChild)[],
    logicalIndex: number,
  ): number {
    let jsxElementCount = 0;

    for (let i = 0; i < children.length; i++) {
      if (t.isJSXElement(children[i])) {
        if (jsxElementCount === logicalIndex) {
          return i;
        }
        jsxElementCount++;
      }
    }

    return children.length;
  }
}
