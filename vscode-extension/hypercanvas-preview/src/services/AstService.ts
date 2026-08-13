/**
 * AST Service - thin adapter over lib/ast/ operations
 *
 * Each method: resolve path → read/parse → lib function → write → return.
 * All AST algorithms live in lib/ast/ for reuse across server and extension.
 */

import * as t from '@babel/types';
import { detectClassNameType, modifyDynamicClassName } from '@lib/ast/dynamic-classname-mutator';
import { buildJSXElement } from '@lib/ast/element-builder';
import type { FileIO } from '@lib/ast/file-io';
import { ensureImport } from '@lib/ast/import-manager';
import { getAttributeString, setAttribute, updateElementChildren, valueToJSXAttribute } from '@lib/ast/mutator';
import {
  duplicateElementInAST,
  extractElementSource,
  findParentElementId,
  getDirectChildIds,
  injectUniqueIdsIntoAST,
  insertElementIntoAST,
  parseTSXElements,
  wrapElementInAST,
} from '@lib/ast/operations';
import { createFileParser } from '@lib/ast/parser';
import { findElementByUuid, findElementWithUuidAtPosition, getElementLocation } from '@lib/ast/traverser';
import { generateTailwindClasses } from '@lib/tailwind/generator';
import { removeConflictingClasses } from '@lib/tailwind/parser';
import type { ClassNameLocation } from '@lib/types';

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

  private _resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return filePath;
    }
    return `${this._workspaceRoot}/${filePath}`;
  }

  /**
   * Update element styles using shared Tailwind utilities.
   * Handles both static and dynamic className expressions.
   * For dynamic classNames (template literals, cn() calls),
   * uses modifyDynamicClassName with optional AI-found locations.
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

      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return { success: false, error: `Element with data-uniq-id="${elementId}" not found` };
      }

      const changedStyleKeys = Object.keys(styles);
      const classNameType = detectClassNameType(result.element);

      if (classNameType === 'string') {
        const existingClassName = getAttributeString(result.element, 'className') || '';
        const { preserved } = removeConflictingClasses(existingClassName, changedStyleKeys, state);
        const newClasses = generateTailwindClasses(styles, state);
        const newClassName = [preserved, newClasses].filter(Boolean).join(' ').trim();
        setAttribute(result.element, 'className', t.stringLiteral(newClassName));

        await this._fileParser.writeAST(ast, absolutePath);
        return { success: true, className: newClassName };
      }

      // Dynamic className
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
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Update element props (arbitrary key-value pairs). */
  async updateProps(filePath: string, elementId: string, props: Record<string, unknown>): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) {
        return { success: false, error: `Element with data-uniq-id="${elementId}" not found` };
      }

      for (const [propName, propValue] of Object.entries(props)) {
        setAttribute(result.element, propName, valueToJSXAttribute(propValue));
      }

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.updateProps] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
        return { success: false, error: `Element with data-uniq-id="${elementId}" not found` };
      }

      updateElementChildren(result.element, text);

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.updateText] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Insert a new JSX element into a component file.
   * Builds the element, adds import for PascalCase types, inserts at parentId or root.
   * NOTE: ensureImport always generates named imports — components with default
   * exports may need manual import adjustment.
   */
  async insertElement(
    filePath: string,
    parentId: string | null,
    componentType: string,
    props: Record<string, unknown>,
    index?: number,
    targetId?: string,
    componentFilePath?: string,
  ): Promise<InsertElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const { element: newElement, uuid: newId } = buildJSXElement({
        componentType,
        props,
        uuid: targetId,
      });

      // Add import for PascalCase component types
      if (/^[A-Z]/.test(componentType)) {
        ensureImport(ast, {
          componentName: componentType,
          targetFilePath: absolutePath,
          componentFilePath,
          workspaceRoot: this._workspaceRoot,
        });
      }

      const { inserted, actualIndex } = insertElementIntoAST(ast, {
        parentId,
        newElement,
        logicalIndex: index,
      });

      if (!inserted) {
        return {
          success: false,
          error: parentId
            ? `Parent element with data-uniq-id="${parentId}" not found`
            : 'Could not find return statement with JSX',
        };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true, newId, index: actualIndex };
    } catch (error) {
      console.error('[AstService.insertElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Delete elements by IDs. Re-reads AST between deletions (children may disappear). */
  async deleteElements(filePath: string, elementIds: string[]): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      let deletedCount = 0;

      for (const elementId of elementIds) {
        const { ast } = await this._fileParser.readAndParseFile(absolutePath);

        const result = findElementByUuid(ast, elementId);
        if (!result) {
          // nosemgrep: unsafe-formatstring -- safe: only first 8 chars of elementId are logged
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
        return { success: false, error: 'No elements found with provided IDs' };
      }

      return { success: true, data: { deletedCount } };
    } catch (error) {
      console.error('[AstService.deleteElements] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Duplicate element and insert clone after the original with new UUIDs. */
  async duplicateElement(filePath: string, elementId: string): Promise<DuplicateElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const { newId, inserted } = duplicateElementInAST(ast, elementId);

      if (!inserted) {
        return { success: false, error: `Element with data-uniq-id="${elementId}" not found` };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true, newId: newId ?? undefined };
    } catch (error) {
      console.error('[AstService.duplicateElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Wrap element in a new container element. */
  async wrapElement(
    filePath: string,
    elementId: string,
    wrapperType: string,
    wrapperProps?: Record<string, unknown>,
  ): Promise<WrapElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const { wrapperId, wrapped } = wrapElementInAST(ast, elementId, wrapperType, wrapperProps);

      if (!wrapped) {
        return { success: false, error: `Element with data-uniq-id="${elementId}" not found` };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true, wrapperId: wrapperId ?? undefined };
    } catch (error) {
      console.error('[AstService.wrapElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Find element at cursor position (for Go to Visual). */
  async findElementAtPosition(
    filePath: string,
    line: number,
    column: number,
  ): Promise<{ uuid: string; tagName: string } | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);
      return findElementWithUuidAtPosition(ast, line, column);
    } catch (error) {
      console.error('[AstService.findElementAtPosition] Error:', error);
      return null;
    }
  }

  /** Get element source location (for Go to Code). */
  async getElementLocation(filePath: string, elementId: string): Promise<{ line: number; column: number } | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) return null;

      return getElementLocation(result.element);
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

      const addedCount = injectUniqueIdsIntoAST(ast);

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

  /** Get element's TSX source code (for Copy operation). */
  async getElementCode(filePath: string, elementId: string): Promise<string | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const sourceCode = await this._fileParser.readFileContent(absolutePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) return null;

      return extractElementSource(sourceCode, result.element);
    } catch (error) {
      console.error('[AstService.getElementCode] Error:', error);
      return null;
    }
  }

  /** Find parent element with data-uniq-id (for Select Parent). */
  async getParentElementId(filePath: string, elementId: string): Promise<string | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);
      return findParentElementId(ast, elementId);
    } catch (error) {
      console.error('[AstService.getParentElementId] Error:', error);
      return null;
    }
  }

  /** Find direct child elements with data-uniq-id (for Select Child). */
  async getChildElementIds(filePath: string, elementId: string): Promise<string[]> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = findElementByUuid(ast, elementId);
      if (!result) return [];

      return getDirectChildIds(result.element);
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

      const { elements: newElements, firstId: firstNewId } = parseTSXElements(tsxCode);

      if (newElements.length === 0) {
        return { success: false, error: 'No valid JSX elements in clipboard' };
      }

      let inserted = false;

      // Insert after target element
      if (targetId) {
        const result = findElementByUuid(ast, targetId);
        if (result) {
          const parent = result.path.parent;
          if (t.isJSXElement(parent)) {
            const children = parent.children;
            const idx = children.indexOf(result.path.node);
            if (idx !== -1) {
              children.splice(idx + 1, 0, ...newElements);
              inserted = true;
            }
          }
        }
      }

      if (!inserted) {
        // Insert at root return
        const rootResult = insertElementIntoAST(ast, { parentId: null, newElement: newElements[0] });
        if (rootResult.inserted) {
          // Insert remaining elements after the first
          for (let i = 1; i < newElements.length; i++) {
            insertElementIntoAST(ast, { parentId: null, newElement: newElements[i] });
          }
          inserted = true;
        }
      }

      if (!inserted) {
        return { success: false, error: 'Could not find insertion point' };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      return { success: true, newId: firstNewId ?? undefined };
    } catch (error) {
      console.error('[AstService.pasteElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
