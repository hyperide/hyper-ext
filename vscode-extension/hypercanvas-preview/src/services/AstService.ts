/**
 * AST Service - thin adapter over lib/ast/ operations
 *
 * Each method: resolve path → read/parse → lib function → write → return.
 * All AST algorithms live in lib/ast/ for reuse across server and extension.
 *
 * Uses fiber-based nodeRef resolution (via NodeMapService + findElementByPosition).
 */

import * as fsSync from 'node:fs';
import * as t from '@babel/types';
import { buildJSXElement } from '@lib/ast/element-builder';
import type { FileIO } from '@lib/ast/file-io';
import { ensureImport } from '@lib/ast/import-manager';
import { collectJsxExternalRefs, findImportForName, pruneOrphanImports, replicateImport } from '@lib/ast/jsx-deps';
import { cloneElement, setAttribute, updateElementChildren, valueToJSXAttribute } from '@lib/ast/mutator';
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
import { executeStyleWriteRequest } from '@lib/style-write/style-write-executor';
import type { FindElementResult } from '@lib/types';
import type { NodeMapEntry, NodeRef } from '@shared/element-tracing/types';
import { resolveWorkspacePath } from './workspace-path';

// File sink only when explicitly requested via env var — never in normal production use
const DEBUG_LOG: string | null = process.env.HYPERIDE_AST_DEBUG_LOG ?? null;
function dbg(msg: string) {
  if (!DEBUG_LOG) return;
  console.log(msg);
  try {
    fsSync.appendFileSync(DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

// ============================================
// Response Types
// ============================================

export interface AstOperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
  /** Absolute path of the file that was actually mutated (may differ from the requested filePath for cross-file writes) */
  resolvedPath?: string;
  /** Content of resolvedPath read BEFORE the write (for undo tracking in cross-file scenarios) */
  contentBeforeWrite?: string;
  /** All cross-file paths mutated, with pre-write content — for multi-file undo tracking in batch operations */
  allCrossFileSnapshots?: ReadonlyArray<{ readonly resolvedPath: string; readonly contentBefore: string }>;
}

export interface UpdateStylesResult extends AstOperationResult {
  className?: string;
}

// ============================================
// moveElement contract — spec for Task 2+ in
// docs/plans/2026-05-06-move-any-to-any-no-shared-parent.md
// ============================================
//
// Semantics (the "any element to any place" promise):
//
// 1. moveElement(source, target, position) ALWAYS succeeds from the user's
//    standpoint. There is no "must share JSX parent" / "rejected" branch —
//    if the move would otherwise be ambiguous, the implementation does its
//    best (auto-import what it can, inline what it cannot) and returns a
//    list of `adjustments` describing what it had to do.
//
// 2. Cases the implementation MUST handle:
//    a) Same JSX parent — sibling reorder (array splice in shared parent).
//    b) Different JSX parents in the same file — cut-and-splice across
//       subtrees of one module.
//    c) Different files in the same component graph — cut from source file,
//       paste into target file. Auto-add imports that the moved subtree
//       references; auto-remove imports orphaned in the source file.
//    d) Cross-component (e.g. drag from <Sidebar> into <Hero>) — same as
//       (c). If the moved subtree references symbols bound only in the
//       source component scope, surface them as new props on the target
//       (or inline the resolved value when trivially safe).
//    e) Drop into a non-container leaf (e.g. <img>) — insert as a sibling
//       at `position`, never split the leaf.
//
// 3. The `position` parameter is the visual direction the user dragged
//    toward — 'before' means "land just before target in document order",
//    'after' means "land just after target". It is always defined; callers
//    compute it from pointer geometry.
//
// 4. NodeRef inputs are raw — no client-side "lift to common parent"
//    pre-processing. Both `source` and `target` may sit anywhere in the
//    workspace. The shared/canvas-interaction/drop-target-lift module that
//    used to enforce the "siblings only" precondition has been deleted.
//
// MoveResult shape:
//   { success: true }                                 // clean move, no adjustments
//   { success: true; adjustments: string[] }          // best-effort move
//
// Note: there is intentionally no `success: false` variant. Internal
// failures (file I/O, parse errors) propagate as exceptions; the bridge
// layer surfaces them as toasts but the contract from the iframe's
// standpoint is "moveElement always returns success".

export interface MoveResult {
  success: true;
  /** Human-readable list of best-effort adjustments (e.g. "added import: Foo from './Foo'", "inlined prop value `theme.primary`"). Omitted when the move was clean. */
  adjustments?: string[];
  /** Absolute path of the file that received the moved subtree (may differ from the source file for cross-file moves). */
  resolvedPath?: string;
  /** Pre-write content of the target file (for undo tracking). */
  contentBeforeWrite?: string;
  /** Pre-write content of every file mutated (source file + target file for cross-file moves). */
  allCrossFileSnapshots?: ReadonlyArray<{ readonly resolvedPath: string; readonly contentBefore: string }>;
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

function isJsxSourceFile(filePath: string): boolean {
  return /\.(jsx|tsx)$/.test(filePath);
}

/**
 * Test whether `needle` is a descendant of `haystack` in the JSX tree.
 * Used by moveElement to refuse cycles (move a subtree into itself).
 * Walks JSXElement/JSXFragment children recursively; expressions inside
 * `{…}` containers are unwrapped so e.g. `<div>{cond && <Foo />}</div>`
 * is still detected.
 */
function jsxContains(haystack: t.JSXElement, needle: t.JSXElement): boolean {
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

// ============================================
// AstService Class
// ============================================

export class AstService {
  private _workspaceRoot: string;
  private _fileParser: ReturnType<typeof createFileParser>;
  private _nodeMapService = new NodeMapService();
  private _fileIO: FileIO;
  private _initialized = false;

  /** Convert relative nodeRef (src/foo.tsx:10:5) to absolute (/workspace/src/foo.tsx:10:5) */
  private _normalizeNodeRef(nodeRef: string): string {
    const m = nodeRef.match(/^(.+):(\d+):(\d+)$/);
    if (!m) return nodeRef;
    const [, filePath, line, col] = m;
    if (filePath.startsWith('/')) return nodeRef;
    const path = require('node:path');
    return `${path.join(this._workspaceRoot, filePath)}:${line}:${col}`;
  }

  private _resolveNodeMapEntry(nodeRef: NodeRef): NodeMapEntry | null {
    const normalizedRef = this._normalizeNodeRef(nodeRef);
    const sourceRef = normalizedRef.match(/^(.+):(\d+):(\d+)$/);
    if (sourceRef) {
      // Fiber source refs can be relative and can report columns that differ from Babel's node map.
      const entry = this._nodeMapService.resolveSourceLocation({
        fileName: sourceRef[1],
        line: Number.parseInt(sourceRef[2], 10),
        column: Number.parseInt(sourceRef[3], 10),
      });
      if (entry) {
        return entry;
      }
    }

    return this._nodeMapService.resolveNodeRef(normalizedRef) ?? this._nodeMapService.resolveNodeRef(nodeRef);
  }

  private _initPromise: Promise<void>;
  private _initError: unknown = null;

  constructor(workspaceRoot: string, fileIO: FileIO) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = fileIO;
    this._fileParser = createFileParser(fileIO);
    // Eagerly populate NodeMapService so style writes work on first interaction.
    // Store the promise so callers can await it before operations that need
    // the node map — the old fire-and-forget pattern caused HYP-268 where
    // inspector.setOpacity / deleteSelected would fail because the scan
    // hadn't finished yet.
    this._initPromise = this._populateNodeMaps().catch((err) => {
      console.error('[AstService] Initial NodeMapService population failed:', err);
      // Store the error so ensureInitialized() callers know the node map
      // is empty and why, rather than silently proceeding with an empty map.
      this._initError = err;
    });
  }

  /**
   * Wait for the initial NodeMapService population to finish.
   * Callers that need the node map should `await ensureInitialized()`
   * before using resolveElement/updateStyles/deleteElements/etc.
   * The promise resolves immediately after the first call finishes.
   */
  async ensureInitialized(): Promise<void> {
    await this._initPromise;
    if (this._initError) {
      console.warn(
        '[AstService] ensureInitialized: node map scan failed earlier, operations may return "Element not found"',
      );
    }
  }

  /** Scan workspace source files and populate NodeMapService (like server's populateNodeMaps). */
  private async _populateNodeMaps(): Promise<void> {
    if (this._initialized) return;
    if (!this._fileIO.listFiles) return; // FileIO doesn't support directory listing

    const SOURCE_DIRS = ['src', 'app', 'pages', 'components', 'client'];
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

    // Also scan root-level .tsx/.jsx files (e.g. tamagui projects with App.tsx at root).
    // listFiles is recursive, so filter to only files directly in the workspace root.
    try {
      const rootFiles = await this._fileIO.listFiles(this._workspaceRoot, ['.tsx', '.jsx']);
      const rootPrefix = this._workspaceRoot.endsWith('/') ? this._workspaceRoot : `${this._workspaceRoot}/`;
      for (const f of rootFiles) {
        // Only root-level: no additional '/' after workspace root prefix
        const relative = f.slice(rootPrefix.length);
        if (!relative.includes('/') && !allFiles.includes(f)) {
          allFiles.push(f);
        }
      }
    } catch {
      // Workspace root scan failed — non-critical
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
      dbg(`[AstService] NodeMapService populated with ${this._nodeMapService.getTrackedFiles().length} files`);
    }
  }

  /** Expose the NodeMapService for external callers (e.g. SyncPositionService). */
  get nodeMapService(): NodeMapService {
    return this._nodeMapService;
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
  private _resolveElement(ast: t.File, nodeRef: NodeRef | undefined, filePath?: string): FindElementResult | null {
    dbg(`[AstService._resolveElement] nodeRef=${nodeRef} filePath=${filePath}`);
    if (nodeRef) {
      // Try nodeRef lookup first (format: "filePath:index")
      const entry = this._nodeMapService.resolveNodeRef(nodeRef);
      if (entry) {
        // Guard: entry.loc.fileName is the ORIGINAL source file the node belongs to.
        // If it differs from the AST being searched (filePath), the coordinates
        // would be applied to the wrong file — e.g. RecordScreen.tsx:10:5 accidentally
        // hitting <SafeAreaProvider> at the same position in App.tsx.
        // Returning null lets _resolveElementInCorrectFile retry with the right file.
        const entryFile = entry.loc.fileName;
        const entryFileMatchesAst =
          !filePath ||
          !entryFile ||
          entryFile === filePath ||
          filePath.endsWith(`/${entryFile}`) ||
          entryFile.endsWith(`/${filePath}`);
        if (!entryFileMatchesAst) {
          dbg(
            `[AstService._resolveElement] entryFile=${entryFile} != filePath=${filePath}, returning null (cross-file)`,
          );
          return null;
        }
        const posResult = findElementByPosition(ast, entry.loc.line, entry.loc.column);
        dbg(
          `[AstService._resolveElement] nodeMap hit: entryFile=${entryFile} line=${entry.loc.line} col=${entry.loc.column} found=${!!posResult}`,
        );
        return posResult;
      }

      // Fallback: parse as source location "filePath:line:column" (from React fiber _debugSource)
      const m = nodeRef.match(/^(.+):(\d+):(\d+)$/);
      if (m) {
        const line = Number.parseInt(m[2], 10);
        const column = Number.parseInt(m[3], 10);
        const fileName = m[1];

        // Try resolving via source map location.
        // Only use the result when the resolved location belongs to the ast we're searching
        // (i.e. locEntry.loc.fileName matches filePath).  If the nodeRef points to a
        // different file — e.g. "src/screens/RecordScreen.tsx:5:4" while filePath is
        // "App.tsx" — the NodeMapService will still find the entry, but applying those
        // coordinates to the wrong AST would silently mutate the wrong element.
        // Returning null here lets _resolveElementInCorrectFile re-try with the right file.
        const locEntry = this._nodeMapService.resolveSourceLocation({
          fileName,
          line,
          column,
        });
        if (locEntry) {
          const locFile = locEntry.loc.fileName;
          const locMatchesAst =
            !filePath || locFile === filePath || filePath.endsWith(`/${locFile}`) || locFile.endsWith(`/${filePath}`);
          if (locMatchesAst) {
            return findElementByPosition(ast, locEntry.loc.line, locEntry.loc.column);
          }
          // locEntry belongs to a different file — caller should parse that file instead.
          return null;
        }

        // Fallback: if source map resolution failed, try direct AST position lookup.
        // Vite source maps may return positions that match original source (not transformed),
        // especially for React 18 _debugSource which gives original positions directly.
        // Only use when the nodeRef fileName matches the file being edited (same file = safe).
        const fileMatches =
          filePath && (filePath.endsWith(`/${fileName}`) || filePath.endsWith(fileName) || fileName === filePath);
        if (fileMatches) {
          const result = findElementByPosition(ast, line, column);
          if (result) {
            dbg(`[AstService] Direct position fallback succeeded: ${nodeRef} → line ${line}:${column}`);
            return result;
          }
        }
      }
    }
    return null;
  }

  /** Update element styles through the shared style-write planner and executor. */
  async updateStyles(
    filePath: string,
    elementId: string,
    styles: Record<string, string>,
    state?: string,
    nodeRef?: NodeRef,
    selectedSourceTabId?: string,
  ): Promise<UpdateStylesResult> {
    dbg(
      `[AstService.updateStyles] filePath=${filePath} elementId=${elementId} nodeRef=${nodeRef} effectiveNodeRef=${nodeRef ?? elementId} styles=${JSON.stringify(styles)}`,
    );
    await this.ensureInitialized();
    try {
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

      const resolved = await this._resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
      if (!resolved) {
        dbg(`[AstService.updateStyles] element NOT FOUND nodeRef=${nodeRef} elementId=${elementId}`);
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }
      const { result, ast, resolvedPath } = resolved;
      dbg(
        `[AstService.updateStyles] resolved element=${(result.element.openingElement?.name as { name?: string })?.name ?? '?'} resolvedPath=${resolvedPath}`,
      );

      // Read content BEFORE the write so _withUndoTracking can compare before/after for cross-file writes.
      // Must be done after resolvedPath is known but before executeStyleWriteRequest mutates the file.
      let contentBeforeWrite: string | undefined;
      if (resolvedPath !== absolutePath) {
        try {
          contentBeforeWrite = await this._fileIO.readFile(resolvedPath);
        } catch {}
      }

      const writeResult = await executeStyleWriteRequest({
        ast,
        sourceFilePath: resolvedPath,
        element: result.element,
        styles,
        state,
        selectedSourceTabId,
        runtimeThemeContext: {
          ideThemePreference: 'system',
          resolvedColorScheme: 'light',
          source: 'vscode',
        },
        fileIO: this._fileIO,
        projectRoot: this._workspaceRoot,
      });
      if (writeResult.success === false) return { success: false, error: writeResult.error };

      for (const mutatedFile of writeResult.mutatedFiles) {
        if (isJsxSourceFile(mutatedFile)) {
          await this._updateNodeMap(mutatedFile);
        }
      }
      return { success: true, resolvedPath, contentBeforeWrite };
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
    await this.ensureInitialized();
    try {
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

      dbg(
        `[AstService.updateProps] filePath=${filePath} absolutePath=${absolutePath} elementId=${elementId} nodeRef=${nodeRef} effectiveNodeRef=${effectiveNodeRef} props=${JSON.stringify(props)}`,
      );

      const resolved = await this._resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
      if (!resolved) {
        dbg(
          `[AstService.updateProps] _resolveElementInCorrectFile returned null for effectiveNodeRef=${effectiveNodeRef}`,
        );
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }
      const { result, ast, resolvedPath } = resolved;
      dbg(
        `[AstService.updateProps] resolved element=${result.element.openingElement?.name && 'name' in result.element.openingElement.name ? result.element.openingElement.name.name : '?'} resolvedPath=${resolvedPath}`,
      );

      let contentBeforeWrite: string | undefined;
      if (resolvedPath !== absolutePath) {
        try {
          contentBeforeWrite = await this._fileIO.readFile(resolvedPath);
        } catch {}
      }

      for (const [propName, propValue] of Object.entries(props)) {
        setAttribute(result.element, propName, valueToJSXAttribute(propValue));
      }

      await this._fileParser.writeAST(ast, resolvedPath);
      await this._updateNodeMap(resolvedPath);
      return { success: true, resolvedPath, contentBeforeWrite };
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
    await this.ensureInitialized();
    try {
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

      const resolved = await this._resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
      if (!resolved) {
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }
      const { result, ast, resolvedPath } = resolved;

      let contentBeforeWrite: string | undefined;
      if (resolvedPath !== absolutePath) {
        try {
          contentBeforeWrite = await this._fileIO.readFile(resolvedPath);
        } catch {}
      }

      updateElementChildren(result.element, text);

      await this._fileParser.writeAST(ast, resolvedPath);
      await this._updateNodeMap(resolvedPath);
      return { success: true, resolvedPath, contentBeforeWrite };
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
    await this.ensureInitialized();
    try {
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
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
      const parentResult = parentNodeRef ? this._resolveElement(ast, parentNodeRef, absolutePath) : null;

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

  /** Delete elements by nodeRefs. Re-reads AST between deletions (children may disappear). */
  async deleteElements(filePath: string, elementIds: string[]): Promise<AstOperationResult> {
    await this.ensureInitialized();
    try {
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      let deletedCount = 0;

      // For cross-file deletes: capture content before the first write to each non-requested file.
      const contentBeforeByPath = new Map<string, string>();

      for (const id of elementIds) {
        // _resolveElementInCorrectFile re-reads the AST on every call, so child nodes
        // removed by earlier deletions do not corrupt Babel path references.
        const resolved = await this._resolveElementInCorrectFile(absolutePath, id as NodeRef);

        if (!resolved) {
          // nosemgrep: unsafe-formatstring -- safe: only first 8 chars of id are logged
          console.log(
            `[AstService.deleteElements] Element ${id.substring(0, 8)} not found (may have been deleted as child)`,
          );
          continue;
        }

        const { result, ast, resolvedPath } = resolved;

        // Capture contentBefore for any new cross-file path before writing (once per path).
        if (resolvedPath !== absolutePath && !contentBeforeByPath.has(resolvedPath)) {
          try {
            contentBeforeByPath.set(resolvedPath, await this._fileIO.readFile(resolvedPath));
          } catch {
            // Leave unset — AstBridge will skip undo snapshot for this path
          }
        }

        // Remove element and write to the actual resolved file (may differ from
        // absolutePath for cross-file nodeRefs, e.g. Tamagui child components).
        result.path.remove();
        await this._fileParser.writeAST(ast, resolvedPath);
        // Refresh node map immediately so subsequent iterations resolve against
        // up-to-date coordinates (sibling line numbers shift after each deletion).
        await this._updateNodeMap(resolvedPath);
        deletedCount++;
      }

      if (deletedCount === 0) {
        return { success: false, error: 'No elements found with provided IDs' };
      }

      const allCrossFileSnapshots =
        contentBeforeByPath.size > 0
          ? Array.from(contentBeforeByPath.entries()).map(([rp, cb]) => ({ resolvedPath: rp, contentBefore: cb }))
          : undefined;
      return {
        success: true,
        data: { deletedCount },
        allCrossFileSnapshots,
      };
    } catch (error) {
      console.error('[AstService.deleteElements] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /** Duplicate element and insert clone after the original. */
  async duplicateElement(filePath: string, elementId: string, nodeRef?: NodeRef): Promise<DuplicateElementResult> {
    await this.ensureInitialized();
    try {
      const effectiveNodeRef = nodeRef ?? elementId;
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);

      const resolved = await this._resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
      if (!resolved) {
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }
      const { result, ast, resolvedPath: actualPath } = resolved;

      const { inserted } = duplicateElementInAST(result);

      if (!inserted) {
        return { success: false, error: `Could not duplicate element (parent is not a JSX element or fragment)` };
      }

      await this._fileParser.writeAST(ast, actualPath);
      await this._updateNodeMap(actualPath);
      return { success: true };
    } catch (error) {
      console.error('[AstService.duplicateElement] Error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  /**
   * Move a JSX element from any place to any place.
   *
   * Implements the contract documented above (`MoveResult`). Same-file moves
   * (Task 2) and cross-file moves (Task 3) are both wired in here. Each
   * NodeRef is followed to its actual source file via
   * `_resolveElementInCorrectFile`; if source and target sit in different
   * files, the subtree is cut from source's AST, spliced into target's AST,
   * and bookkeeping for imports (replicate into target, prune orphans in
   * source) runs before both files are written.
   *
   * Internal failures (file I/O, parse errors, unresolvable nodeRefs)
   * propagate as exceptions per the spec — there is no `success: false`
   * branch from the user's standpoint. Callers (the bridge layer) translate
   * thrown errors into surface notifications.
   */
  async moveElement(
    filePath: string,
    sourceId: NodeRef | string,
    targetId: NodeRef | string,
    position: 'before' | 'after',
  ): Promise<MoveResult> {
    await this.ensureInitialized();

    const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);

    // Discover which file each endpoint actually lives in. We only use
    // the resolvedPath here — the AST returned is parsed-once-per-call,
    // so we re-parse below to ensure both endpoints share one AST object.
    const sourceLocate = await this._resolveElementInCorrectFile(absolutePath, sourceId as NodeRef);
    if (!sourceLocate) {
      throw new Error(`moveElement: source element not found (nodeRef=${sourceId})`);
    }
    const targetLocate = await this._resolveElementInCorrectFile(absolutePath, targetId as NodeRef);
    if (!targetLocate) {
      throw new Error(`moveElement: target element not found (nodeRef=${targetId})`);
    }

    // Cross-file branch — both endpoints in different files. Cut from source's
    // AST, splice into target's AST, replicate imports the moved subtree
    // depends on, prune any source-file imports orphaned by the cut, write
    // both files. Returned MoveResult has `allCrossFileSnapshots` covering
    // both pre-write contents so undo can restore each file independently.
    if (sourceLocate.resolvedPath !== targetLocate.resolvedPath) {
      return await this._moveAcrossFiles({
        sourceFilePath: sourceLocate.resolvedPath,
        targetFilePath: targetLocate.resolvedPath,
        sourceId: sourceId as NodeRef,
        targetId: targetId as NodeRef,
        position,
      });
    }

    const targetFilePath = sourceLocate.resolvedPath;

    // Re-parse so both endpoints resolve into the SAME AST instance.
    // _resolveElementInCorrectFile parses once per call and the parser
    // caches by (path, content), so this read is cheap.
    const { ast } = await this._fileParser.readAndParseFile(targetFilePath);
    const sourceResult = this._resolveElement(ast, sourceId as NodeRef, targetFilePath);
    if (!sourceResult) {
      throw new Error(`moveElement: source disappeared after re-parse (nodeRef=${sourceId})`);
    }
    const targetResult = this._resolveElement(ast, targetId as NodeRef, targetFilePath);
    if (!targetResult) {
      throw new Error(`moveElement: target disappeared after re-parse (nodeRef=${targetId})`);
    }

    const sourceNode = sourceResult.element;
    const targetNode = targetResult.element;

    if (sourceNode === targetNode) {
      // Dropping a node onto itself is a no-op — succeed without touching the file.
      return { success: true, resolvedPath: targetFilePath };
    }

    // Refuse to move a subtree into one of its own descendants — that
    // would create a cycle and corrupt the AST. Throw rather than
    // best-effort because the user-visible drop indicator should never
    // permit this geometry; if it does, that's a separate bug.
    if (jsxContains(sourceNode, targetNode)) {
      throw new Error('moveElement: cannot move a node into one of its descendants');
    }

    const sourceParent = sourceResult.path.parent;
    const targetParent = targetResult.path.parent;

    if (!t.isJSXElement(sourceParent) && !t.isJSXFragment(sourceParent)) {
      // Source is the root JSX returned from a function. Moving it would
      // require replacing the function's return value — not in Task 2 scope.
      throw new Error(
        `moveElement: source has no JSX parent (parent type=${sourceParent?.type}); root-JSX moves not supported yet`,
      );
    }
    if (!t.isJSXElement(targetParent) && !t.isJSXFragment(targetParent)) {
      throw new Error(
        `moveElement: target has no JSX parent (parent type=${targetParent?.type}); cannot insert before/after the root JSX`,
      );
    }

    // Capture content before write for undo tracking.
    let contentBeforeWrite: string | undefined;
    try {
      contentBeforeWrite = await this._fileIO.readFile(targetFilePath);
    } catch {}

    if (sourceParent === targetParent) {
      // Same-parent: array-level reorder via index splice.
      const siblings = sourceParent.children;
      const srcIdx = siblings.indexOf(sourceNode);
      const tgtIdx = siblings.indexOf(targetNode);
      if (srcIdx === -1 || tgtIdx === -1) {
        throw new Error('moveElement: same-parent index lookup failed');
      }
      siblings.splice(srcIdx, 1);
      const newTgtIdx = siblings.indexOf(targetNode);
      siblings.splice(position === 'before' ? newTgtIdx : newTgtIdx + 1, 0, sourceNode);
    } else {
      // Different-parent: cut from source's siblings, splice at target's siblings.
      // Order matters: removing source first means target's index does not
      // shift (different parent), so we can resolve target's index after the
      // cut without recompute. We still recompute defensively in case Babel
      // reuses children array references.
      const sourceSiblings = sourceParent.children;
      const targetSiblings = targetParent.children;
      const srcIdx = sourceSiblings.indexOf(sourceNode);
      if (srcIdx === -1) {
        throw new Error('moveElement: source not found in its parent children');
      }
      sourceSiblings.splice(srcIdx, 1);
      const tgtIdx = targetSiblings.indexOf(targetNode);
      if (tgtIdx === -1) {
        throw new Error('moveElement: target not found in its parent children after source cut');
      }
      targetSiblings.splice(position === 'before' ? tgtIdx : tgtIdx + 1, 0, sourceNode);
    }

    await this._fileParser.writeAST(ast, targetFilePath);
    await this._updateNodeMap(targetFilePath);

    return {
      success: true,
      resolvedPath: targetFilePath,
      contentBeforeWrite,
    };
  }

  /**
   * Cross-file move (Task 3). Source subtree is removed from `sourceFilePath`,
   * cloned (so recast doesn't carry the original file's location info into
   * the new context), and inserted at `position` relative to target inside
   * `targetFilePath`. Imports referenced by the moved subtree get replicated
   * in target (merging into existing same-source declarations); imports
   * orphaned in source after the cut get pruned.
   *
   * Returns a MoveResult with `adjustments` describing the import bookkeeping
   * and `allCrossFileSnapshots` carrying pre-write content for BOTH files
   * (undo restores them independently).
   */
  private async _moveAcrossFiles(opts: {
    sourceFilePath: string;
    targetFilePath: string;
    sourceId: NodeRef;
    targetId: NodeRef;
    position: 'before' | 'after';
  }): Promise<MoveResult> {
    const { sourceFilePath, targetFilePath, sourceId, targetId, position } = opts;

    // Snapshot both files BEFORE any mutation so undo can restore them.
    let sourceContentBefore: string | undefined;
    let targetContentBefore: string | undefined;
    try {
      sourceContentBefore = await this._fileIO.readFile(sourceFilePath);
    } catch {}
    try {
      targetContentBefore = await this._fileIO.readFile(targetFilePath);
    } catch {}

    // Re-parse so each side resolves into its own AST instance (the parser
    // caches per-(path, content), so this is cheap).
    const { ast: sourceAst } = await this._fileParser.readAndParseFile(sourceFilePath);
    const { ast: targetAst } = await this._fileParser.readAndParseFile(targetFilePath);

    const sourceResult = this._resolveElement(sourceAst, sourceId, sourceFilePath);
    if (!sourceResult) {
      throw new Error(`moveElement: source disappeared in ${sourceFilePath} (nodeRef=${sourceId})`);
    }
    const targetResult = this._resolveElement(targetAst, targetId, targetFilePath);
    if (!targetResult) {
      throw new Error(`moveElement: target disappeared in ${targetFilePath} (nodeRef=${targetId})`);
    }

    const sourceNode = sourceResult.element;
    const targetNode = targetResult.element;

    const sourceParent = sourceResult.path.parent;
    const targetParent = targetResult.path.parent;

    if (!t.isJSXElement(sourceParent) && !t.isJSXFragment(sourceParent)) {
      throw new Error(
        `moveElement: source has no JSX parent (parent type=${sourceParent?.type}); root-JSX moves not supported`,
      );
    }
    if (!t.isJSXElement(targetParent) && !t.isJSXFragment(targetParent)) {
      throw new Error(
        `moveElement: target has no JSX parent (parent type=${targetParent?.type}); cannot insert before/after the root JSX`,
      );
    }

    // 1. Decide which imports the moved subtree needs in the target file.
    //    Over-collect identifiers from the subtree, then intersect with
    //    source's import declarations — anything not imported in source is
    //    out of scope (Task 4 / 5 territory).
    const refs = collectJsxExternalRefs(sourceNode);
    const adjustments: string[] = [];

    // 2. Cut the source node from its parent's children. Do this BEFORE
    //    pruning orphans so the prune scan sees the post-cut AST.
    const sourceSiblings = sourceParent.children;
    const srcIdx = sourceSiblings.indexOf(sourceNode);
    if (srcIdx === -1) {
      throw new Error('moveElement: source not found in its parent children');
    }
    sourceSiblings.splice(srcIdx, 1);

    // 3. Clone the JSX subtree before splicing into the target AST so
    //    recast doesn't try to reuse the source file's original token
    //    spans against target's source map (would produce stale whitespace).
    const movedNode = cloneElement(sourceNode);

    // 4. Replicate each needed import into the target file.
    for (const name of refs) {
      const found = findImportForName(sourceAst, name);
      if (!found) continue; // not imported in source — nothing to replicate
      const added = replicateImport(targetAst, found, sourceFilePath, targetFilePath);
      if (added) {
        const sourceValue = found.declaration.source.value;
        adjustments.push(`added import: ${name} from '${sourceValue}'`);
      }
    }

    // 5. Splice the cloned subtree into target.
    const targetSiblings = targetParent.children;
    const tgtIdx = targetSiblings.indexOf(targetNode);
    if (tgtIdx === -1) {
      throw new Error('moveElement: target not found in its parent children');
    }
    targetSiblings.splice(position === 'before' ? tgtIdx : tgtIdx + 1, 0, movedNode);

    // 6. Prune source imports orphaned by the cut.
    const orphaned = pruneOrphanImports(sourceAst);
    for (const name of orphaned) {
      adjustments.push(`removed orphaned import: ${name}`);
    }

    // 7. Write both files. Order doesn't matter for correctness — both reads
    //    happened up front — but we write source first so an exception
    //    mid-write leaves the user with the cut visible (clearer to debug
    //    than a phantom paste with the original still in place).
    await this._fileParser.writeAST(sourceAst, sourceFilePath);
    await this._fileParser.writeAST(targetAst, targetFilePath);
    await this._updateNodeMap(sourceFilePath);
    await this._updateNodeMap(targetFilePath);

    const snapshots: Array<{ resolvedPath: string; contentBefore: string }> = [];
    if (sourceContentBefore !== undefined) {
      snapshots.push({ resolvedPath: sourceFilePath, contentBefore: sourceContentBefore });
    }
    if (targetContentBefore !== undefined) {
      snapshots.push({ resolvedPath: targetFilePath, contentBefore: targetContentBefore });
    }

    return {
      success: true,
      resolvedPath: targetFilePath,
      contentBeforeWrite: targetContentBefore,
      allCrossFileSnapshots: snapshots,
      ...(adjustments.length > 0 ? { adjustments } : {}),
    };
  }

  /**
   * Extract the absolute file path from a source-location nodeRef ("fileName:line:col").
   * Returns null if the nodeRef isn't a source-location ref or the file can't be resolved.
   */
  private _extractFileFromNodeRef(nodeRef: string): string | null {
    const m = nodeRef.match(/^(.+):(\d+):(\d+)$/);
    if (!m) return null;
    const fileName = m[1];
    return resolveWorkspacePath(this._workspaceRoot, fileName);
  }

  /**
   * Resolve an element and its AST, following the nodeRef to the correct source file when
   * it differs from the hint `filePath` (the currently-displayed component).
   *
   * Tamagui (and similar) projects define components in child files (e.g. RecordScreen.tsx)
   * that are rendered inside a shell like App.tsx.  The nodeRef carries the true source
   * location ("src/screens/RecordScreen.tsx:10:5"), but `filePath` is the shell file.
   * Without cross-file fallback, _resolveElement searches App.tsx's AST for a node that
   * lives in RecordScreen.tsx → not found → write silently fails.
   *
   * Returns `{ result, ast, resolvedPath }` on success, `null` if the element cannot be found.
   */
  private async _resolveElementInCorrectFile(
    absolutePath: string,
    effectiveNodeRef: NodeRef | string,
  ): Promise<{ result: FindElementResult; ast: t.File; resolvedPath: string } | null> {
    dbg(`[AstService._resolveElementInCorrectFile] absolutePath=${absolutePath} effectiveNodeRef=${effectiveNodeRef}`);
    const { ast } = await this._fileParser.readAndParseFile(absolutePath);
    const result = this._resolveElement(ast, effectiveNodeRef as NodeRef, absolutePath);
    if (result) {
      dbg(`[AstService._resolveElementInCorrectFile] resolved in primary file=${absolutePath}`);
      return { result, ast, resolvedPath: absolutePath };
    }

    // Cross-file fallback: primary file miss.  Two ways to get the real source file:
    // 1. Source-location nodeRef ("src/screens/Foo.tsx:10:5") — _extractFileFromNodeRef
    // 2. Hash nodeRef ("abc123") — look up nodeMapEntry and read loc.fileName
    let nodeRefFile = this._extractFileFromNodeRef(effectiveNodeRef);
    if (!nodeRefFile) {
      const entry = this._nodeMapService.resolveNodeRef(effectiveNodeRef as NodeRef);
      if (entry?.loc?.fileName) {
        nodeRefFile = resolveWorkspacePath(this._workspaceRoot, entry.loc.fileName);
        dbg(
          `[AstService._resolveElementInCorrectFile] nodeMap fallback: entry file=${entry.loc.fileName} → ${nodeRefFile}`,
        );
      }
    }
    dbg(`[AstService._resolveElementInCorrectFile] primary miss, nodeRefFile=${nodeRefFile}`);
    if (nodeRefFile && nodeRefFile !== absolutePath) {
      try {
        const { ast: childAst } = await this._fileParser.readAndParseFile(nodeRefFile);
        const childResult = this._resolveElement(childAst, effectiveNodeRef as NodeRef, nodeRefFile);
        if (childResult) {
          dbg(`[AstService._resolveElementInCorrectFile] resolved in child file=${nodeRefFile}`);
          return { result: childResult, ast: childAst, resolvedPath: nodeRefFile };
        }
      } catch (e) {
        dbg(`[AstService._resolveElementInCorrectFile] child file read failed: ${e}`);
        // File unreadable — fall through to null
      }
    }

    dbg(`[AstService._resolveElementInCorrectFile] NOT FOUND, returning null`);
    return null;
  }

  /** Wrap element in a new container element. */
  async wrapElement(
    filePath: string,
    elementId: string,
    wrapperType: string,
    wrapperProps?: Record<string, unknown>,
    nodeRef?: NodeRef,
  ): Promise<WrapElementResult> {
    await this.ensureInitialized();
    try {
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

      const resolved = await this._resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
      if (!resolved) {
        return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
      }
      const { result, ast, resolvedPath } = resolved;

      const { wrapped } = wrapElementInAST(result, wrapperType, wrapperProps);

      if (!wrapped) {
        return { success: false, error: 'Could not wrap element' };
      }

      await this._fileParser.writeAST(ast, resolvedPath);
      await this._updateNodeMap(resolvedPath);
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
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
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
      console.warn('[AstService.findElementAtPosition] parse failed (expected for broken/partial files):', error);
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
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);
      const sourceCode = await this._fileParser.readFileContent(absolutePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const result = this._resolveElement(ast, effectiveNodeRef, absolutePath);
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
        const entry = this._resolveNodeMapEntry(nodeRef);
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
  async getChildElementIds(nodeRef?: NodeRef): Promise<string[]> {
    try {
      if (nodeRef) {
        const entry = this._resolveNodeMapEntry(nodeRef);
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

  /** Find next or previous sibling element nodeRef (for Tab/Shift+Tab navigation). */
  async getSiblingElementId(
    _filePath: string,
    _elementId: string,
    direction: 'next' | 'prev',
    nodeRef?: NodeRef,
  ): Promise<string | null> {
    try {
      if (nodeRef) {
        const entry = this._resolveNodeMapEntry(nodeRef);
        if (entry?.parentRef) {
          const parent = this._nodeMapService.resolveNodeRef(entry.parentRef);
          if (parent) {
            const siblings = parent.children;
            let currentIndex = siblings.indexOf(entry.nodeRef);
            if (currentIndex === -1) {
              const normalizedRef = this._normalizeNodeRef(nodeRef);
              const m = normalizedRef.match(/^(.+):(\d+):(\d+)$/);
              if (m) {
                const [, file, line] = m;
                currentIndex = siblings.findIndex((s) => {
                  const sm = s.match(/^(.+):(\d+):(\d+)$/);
                  return sm && sm[1] === file && sm[2] === line;
                });
              }
            }
            if (currentIndex !== -1) {
              let targetIndex: number;
              if (direction === 'prev') {
                targetIndex = currentIndex === 0 ? siblings.length - 1 : currentIndex - 1;
              } else {
                targetIndex = currentIndex === siblings.length - 1 ? 0 : currentIndex + 1;
              }
              return siblings[targetIndex] ?? null;
            }
          }
        }
      }
      return null;
    } catch (error) {
      console.error('[AstService.getSiblingElementId] Error:', error);
      return null;
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
      const absolutePath = resolveWorkspacePath(this._workspaceRoot, filePath);
      const { ast } = await this._fileParser.readAndParseFile(absolutePath);

      const { elements: newElements } = parseTSXElements(tsxCode);

      if (newElements.length === 0) {
        return { success: false, error: 'No valid JSX elements in clipboard' };
      }

      let inserted = false;

      // Insert after target element via nodeRef
      if (targetNodeRef) {
        const result = this._resolveElement(ast, targetNodeRef, absolutePath);
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
