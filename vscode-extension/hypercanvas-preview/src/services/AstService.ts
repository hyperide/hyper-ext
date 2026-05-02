/**
 * AST Service - thin adapter over lib/ast/ operations
 *
 * Each method: resolve path → read/parse → lib function → write → return.
 * All AST algorithms live in lib/ast/ for reuse across server and extension.
 *
 * Uses fiber-based nodeRef resolution (via NodeMapService + findElementByPosition).
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
  insertElementIntoAST,
  parseTSXElements,
  wrapElementInAST,
} from '@lib/ast/operations';
import { createFileParser } from '@lib/ast/parser';
import { findElementByPosition } from '@lib/ast/position-finder';
import { findElementAtPosition } from '@lib/ast/traverser';
import { NodeMapService } from '@lib/element-tracing/node-map-service';
import { generateTailwindClasses } from '@lib/tailwind/generator';
import { removeConflictingClasses } from '@lib/tailwind/parser';
import type { ClassNameLocation, FindElementResult } from '@lib/types';
import type { NodeRef } from '@shared/element-tracing/types';

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
  private _nodeMapService = new NodeMapService();
  private _fileIO: FileIO;
  private _initialized = false;

  constructor(workspaceRoot: string, fileIO: FileIO) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = fileIO;
    this._fileParser = createFileParser(fileIO);
    // Eagerly populate NodeMapService so style writes work on first interaction
    this._populateNodeMaps().catch(() => {});
  }

  /** Scan workspace source files and populate NodeMapService (like server's populateNodeMaps). */
  private async _populateNodeMaps(): Promise<void> {
    if (this._initialized) return;
    if (!this._fileIO.listFiles) return; // FileIO doesn't support directory listing

    const SOURCE_DIRS = ['src', 'app', 'pages', 'components'];
    const allFiles: string[] = [];

    for (const dir of SOURCE_DIRS) {
      const fullDir = `${this._workspaceRoot}/${dir}`;
      try {
        const files = await this._fileIO.listFiles(fullDir, ['.tsx', '.jsx']);
        allFiles.push(...files);
      } catch {
        // Directory doesn't exist
      }
    }

    for (const filePath of allFiles) {
      try {
        const sourceCode = await this._fileIO.readFile(filePath);
        this._nodeMapService.parseAndBuild(sourceCode, filePath);
      } catch {
        // Skip unreadable files
      }
    }

    this._initialized = true;
    if (allFiles.length > 0) {
      console.log(`[AstService] NodeMapService populated with ${this._nodeMapService.getTrackedFiles().length} files`);
    }
  }

  /** Expose the NodeMapService for external callers (e.g. SyncPositionService). */
  get nodeMapService(): NodeMapService {
    return this._nodeMapService;
  }

  private _resolvePath(filePath: string): string {
    if (filePath.startsWith('/')) {
      return filePath;
    }
    return `${this._workspaceRoot}/${filePath}`;
  }

  /** Parse file and update node map (called after every AST write operation). */
  private async _updateNodeMap(filePath: string): Promise<void> {
    try {
      const sourceCode = await this._fileParser.readFileContent(filePath);
      if (this._nodeMapService.getTrackedFiles().includes(filePath)) {
        this._nodeMapService.reparseAndUpdate(sourceCode, filePath);
      } else {
        this._nodeMapService.parseAndBuild(sourceCode, filePath);
      }
    } catch {
      // File read failure — node map will be stale but functional
    }
  }

  /**
   * Resolve an element by nodeRef via NodeMapService + position lookup.
   * Returns the AST element result or null if not found.
   */
  private _resolveElement(
    ast: t.File,
    nodeRef: NodeRef | undefined,
    _elementId: string | undefined,
  ): FindElementResult | null {
    if (nodeRef) {
      // Try nodeRef lookup first (format: "filePath:index")
      const entry = this._nodeMapService.resolveNodeRef(nodeRef);
      if (entry) {
        return findElementByPosition(ast, entry.loc.line, entry.loc.column);
      }

      // Fallback: parse as source location "filePath:line:column" (from React fiber _debugSource)
      const m = nodeRef.match(/^(.+):(\d+):(\d+)$/);
      if (m) {
        const line = Number.parseInt(m[2], 10);
        const column = Number.parseInt(m[3], 10);
        // Try resolving via source map location
        const locEntry = this._nodeMapService.resolveSourceLocation({
          fileName: m[1],
          line,
          column,
        });
        if (locEntry) {
          return findElementByPosition(ast, locEntry.loc.line, locEntry.loc.column);
        }

        // Fallback: if source map resolution failed, try direct AST position lookup.
        // Vite source maps may return positions that match original source (not transformed),
        // especially for React 18 _debugSource which gives original positions directly.
        // Only use when the nodeRef fileName matches the file being edited (same file = safe).
        const fileName = m[1];
        const trackedFiles = this._nodeMapService.getTrackedFiles();
        const matchingFile = trackedFiles.find((f) => f.endsWith(`/${fileName}`) || f === fileName);
        if (matchingFile) {
          const result = findElementByPosition(ast, line, column);
          if (result) {
            console.log(`[AstService] Direct position fallback succeeded: ${nodeRef} → line ${line}:${column}`);
            return result;
          }
        }
      }
    }
    return null;
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
    nodeRef?: NodeRef,
  ): Promise<UpdateStylesResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, nodeRef, elementId);
      if (!result) {
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
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
        await this._updateNodeMap(absolutePath);
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
      await this._updateNodeMap(absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.updateStyles] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Update element props (arbitrary key-value pairs). */
  async updateProps(
    filePath: string,
    elementId: string,
    props: Record<string, unknown>,
    nodeRef?: NodeRef,
  ): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, nodeRef, elementId);
      if (!result) {
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }

      for (const [propName, propValue] of Object.entries(props)) {
        setAttribute(result.element, propName, valueToJSXAttribute(propValue));
      }

      await this._fileParser.writeAST(ast, absolutePath);
      await this._updateNodeMap(absolutePath);
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
  async updateText(filePath: string, elementId: string, text: string, nodeRef?: NodeRef): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, nodeRef, elementId);
      if (!result) {
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }

      updateElementChildren(result.element, text);

      await this._fileParser.writeAST(ast, absolutePath);
      await this._updateNodeMap(absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.updateText] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Insert a new JSX element into a component file.
   * Builds the element, adds import for PascalCase types, inserts at parent or root.
   * NOTE: ensureImport always generates named imports — components with default
   * exports may need manual import adjustment.
   */
  async insertElement(
    filePath: string,
    parentId: string | null,
    componentType: string,
    props: Record<string, unknown>,
    index?: number,
    _targetId?: string,
    componentFilePath?: string,
    parentNodeRef?: NodeRef,
  ): Promise<InsertElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const { element: newElement } = buildJSXElement({
        componentType,
        props,
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

      // Resolve parent element if parentId/parentNodeRef provided
      const parentResult = parentNodeRef ? this._resolveElement(ast, parentNodeRef, parentId) : null;

      const { inserted, actualIndex } = insertElementIntoAST(ast, {
        parent: parentResult,
        newElement,
        logicalIndex: index,
      });

      if (!inserted) {
        return {
          success: false,
          error: parentId ? `Parent element not found in ${filePath}` : 'Could not find return statement with JSX',
        };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      await this._updateNodeMap(absolutePath);
      return { success: true, index: actualIndex };
    } catch (error) {
      console.error('[AstService.insertElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Delete elements by IDs or nodeRefs. Re-reads AST between deletions (children may disappear). */
  async deleteElements(filePath: string, elementIds: string[], nodeRefs?: NodeRef[]): Promise<AstOperationResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      let deletedCount = 0;

      // Prefer nodeRefs if provided, fall back to elementIds
      const identifiers = nodeRefs ?? elementIds;
      const useNodeRef = Boolean(nodeRefs);

      for (const id of identifiers) {
        const { ast } = await this._fileParser.readAndParseFile(absolutePath);

        const result = useNodeRef ? this._resolveElement(ast, id, undefined) : this._resolveElement(ast, undefined, id);

        if (!result) {
          // nosemgrep: unsafe-formatstring -- safe: only first 8 chars of id are logged
          console.log(
            `[AstService.deleteElements] Element ${id.substring(0, 8)} not found (may have been deleted as child)`,
          );
          continue;
        }

        // Remove element
        result.path.remove();

        // Write back to file
        await this._fileParser.writeAST(ast, absolutePath);
        deletedCount++;
      }

      if (deletedCount > 0) {
        await this._updateNodeMap(absolutePath);
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

  /** Duplicate element and insert clone after the original. */
  async duplicateElement(filePath: string, elementId: string, nodeRef?: NodeRef): Promise<DuplicateElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, nodeRef, elementId);
      if (!result) {
        return { success: false, error: `Element not found in ${filePath}` };
      }

      const { inserted } = duplicateElementInAST(result);

      if (!inserted) {
        return { success: false, error: `Could not duplicate element (parent is not a JSX element)` };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      await this._updateNodeMap(absolutePath);
      return { success: true };
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
    nodeRef?: NodeRef,
  ): Promise<WrapElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, nodeRef, elementId);
      if (!result) {
        return { success: false, error: `Element not found in ${filePath}` };
      }

      const { wrapped } = wrapElementInAST(result, wrapperType, wrapperProps);

      if (!wrapped) {
        return { success: false, error: 'Could not wrap element' };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      await this._updateNodeMap(absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.wrapElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Find element at cursor position (for Go to Visual).
   * Returns tagName and nodeRef when available.
   */
  async findElementAtPosition(
    filePath: string,
    line: number,
    column: number,
  ): Promise<{ tagName: string; nodeRef?: NodeRef } | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);
      const result = findElementAtPosition(ast, line, column);
      if (!result) return null;

      // Get tag name from the found element
      const nameNode = result.element.openingElement.name;
      const tagName = t.isJSXIdentifier(nameNode) ? nameNode.name : 'unknown';

      // Try to find nodeRef via NodeMapService for the same position
      const sourceLocation = { fileName: absolutePath, line, column: column - 1 };
      const entry = this._nodeMapService.resolveSourceLocation(sourceLocation);

      return {
        tagName,
        ...(entry ? { nodeRef: entry.nodeRef } : {}),
      };
    } catch (error) {
      console.error('[AstService.findElementAtPosition] Error:', error);
      return null;
    }
  }

  /**
   * Get element source location (for Go to Code).
   * Uses nodeRef resolution via NodeMapService.
   */
  async getElementLocation(
    _filePath: string,
    _elementId: string,
    nodeRef?: NodeRef,
  ): Promise<{ line: number; column: number } | null> {
    try {
      // Resolve nodeRef directly from NodeMapService (no AST parse needed)
      if (nodeRef) {
        const entry = this._nodeMapService.resolveNodeRef(nodeRef);
        if (entry) {
          return { line: entry.loc.line, column: entry.loc.column };
        }
      }

      return null;
    } catch (error) {
      console.error('[AstService.getElementLocation] Error:', error);
      return null;
    }
  }

  /** Get element's TSX source code (for Copy operation). */
  async getElementCode(filePath: string, elementId: string, nodeRef?: NodeRef): Promise<string | null> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const sourceCode = await this._fileParser.readFileContent(absolutePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, nodeRef, elementId);
      if (!result) return null;

      return extractElementSource(sourceCode, result.element);
    } catch (error) {
      console.error('[AstService.getElementCode] Error:', error);
      return null;
    }
  }

  /** Find parent element nodeRef (for Select Parent). */
  async getParentElementId(_filePath: string, _elementId: string, nodeRef?: NodeRef): Promise<string | null> {
    try {
      if (nodeRef) {
        const entry = this._nodeMapService.resolveNodeRef(nodeRef);
        if (entry?.parentRef) {
          return entry.parentRef;
        }
      }
      return null;
    } catch (error) {
      console.error('[AstService.getParentElementId] Error:', error);
      return null;
    }
  }

  /** Find direct child element nodeRefs (for Select Child). */
  async getChildElementIds(_filePath: string, _elementId: string, nodeRef?: NodeRef): Promise<string[]> {
    try {
      if (nodeRef) {
        const entry = this._nodeMapService.resolveNodeRef(nodeRef);
        if (entry) {
          return [...entry.children];
        }
      }
      return [];
    } catch (error) {
      console.error('[AstService.getChildElementIds] Error:', error);
      return [];
    }
  }

  /**
   * Insert element from TSX code string (for Paste operation).
   * Parses the TSX code and inserts after target element.
   */
  async pasteElement(
    filePath: string,
    _targetId: string | null,
    tsxCode: string,
    targetNodeRef?: NodeRef,
  ): Promise<InsertElementResult> {
    try {
      const absolutePath = this._resolvePath(filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const { elements: newElements } = parseTSXElements(tsxCode);

      if (newElements.length === 0) {
        return { success: false, error: 'No valid JSX elements in clipboard' };
      }

      let inserted = false;

      // Insert after target element via nodeRef
      if (targetNodeRef) {
        const result = this._resolveElement(ast, targetNodeRef, undefined);
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
        const rootResult = insertElementIntoAST(ast, { parent: null, newElement: newElements[0] });
        if (rootResult.inserted) {
          // Insert remaining elements after the first
          for (let i = 1; i < newElements.length; i++) {
            insertElementIntoAST(ast, { parent: null, newElement: newElements[i] });
          }
          inserted = true;
        }
      }

      if (!inserted) {
        return { success: false, error: 'Could not find insertion point' };
      }

      await this._fileParser.writeAST(ast, absolutePath);
      await this._updateNodeMap(absolutePath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.pasteElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
}
