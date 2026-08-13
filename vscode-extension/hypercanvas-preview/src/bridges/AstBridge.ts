/**
 * AST Bridge - handles AST-related messages from webview
 *
 * Routes ast:* messages to AstService and sends responses back.
 */

import * as fsSync from 'node:fs';
import path from 'node:path';
import { discoverLayout } from '@shared/i18n-text/resolve-i18n-resource';
import { writeI18nResource } from '@shared/i18n-text/write-i18n-resource';
import type * as vscode from 'vscode';
import type {
  AstOperationResult,
  DuplicateElementResult,
  InsertElementResult,
  WrapElementResult,
} from '../services/AstService';
import { AstService } from '../services/AstService';
import type { NodeRef } from '@shared/element-tracing/types';
import { UndoRedoService } from '../services/UndoRedoService';
import type { AstMessage, AstResponse } from '../types';
import { VSCodeFileIO } from '../vscode-file-io';
import { toRepoRelativeElementId, toRepoRelativePath } from './monorepo-path-translate';

// File sink only when explicitly requested or in CI — never in normal production use
const _BRIDGE_DEBUG_LOG: string | null =
  process.env.HYPERIDE_AST_DEBUG_LOG ?? (process.env.CI === 'true' ? '/artifacts/ast-debug.log' : null);
function _dbgBridge(msg: string) {
  if (!_BRIDGE_DEBUG_LOG) return;
  console.log(msg);
  try {
    fsSync.appendFileSync(_BRIDGE_DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

export class AstBridge {
  private _astService: AstService;
  private _fileIO: VSCodeFileIO;
  private _undoRedoService: UndoRedoService;
  private _workspaceRoot: string;
  private _webview: vscode.Webview | null = null;
  /**
   * Sub-project path prefix for a monorepo opened at the repo ROOT (e.g.
   * `targets/conloca-app/`). Empty for single-package projects. Set by
   * PreviewPanel on (re)select; applied to every iframe-supplied `filePath` /
   * `elementId` so the repo-rooted AstService resolves the correct source file
   * even when two sub-projects share a path suffix (HYP-430).
   */
  private _subProjectPrefix = '';

  /**
   * @param astService Optional pre-built AstService. Production passes nothing
   *   and gets the real repo-rooted service. Tests inject a fake here instead of
   *   `mock.module('../services/AstService')`, whose process-global, irreversible
   *   module mock leaked into AstService's own tests under a non-isolated run
   *   (HYP-579). The default preserves the original construction exactly.
   */
  constructor(workspaceRoot: string, astService?: AstService) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = new VSCodeFileIO();
    this._astService = astService ?? new AstService(workspaceRoot, this._fileIO);
    this._undoRedoService = new UndoRedoService(workspaceRoot);
  }

  get astService(): AstService {
    return this._astService;
  }

  /**
   * Set the webview for sending responses
   */
  setWebview(webview: vscode.Webview): void {
    this._webview = webview;
  }

  /**
   * Handle AST message from webview.
   * If targetWebview is provided, responses go to that webview
   * instead of the default one (fixes cross-panel response routing).
   */
  /**
   * Pin the monorepo sub-project prefix (e.g. `targets/conloca-app/`). Empty
   * string for single-package projects (the default). PreviewPanel calls this
   * whenever the active component changes so subsequent iframe-driven AST ops
   * re-root their paths correctly (HYP-430).
   */
  setSubProjectPrefix(prefix: string): void {
    this._subProjectPrefix = prefix;
  }

  /**
   * Widen the undo/redo workspace boundary to also accept paths under `root`
   * (or narrow back to just the opened folder with null). Set from
   * ComponentsData.monorepoRoot whenever the Explorer's ancestor-fallback scan
   * surfaces sibling sub-projects living outside the opened leaf folder — those
   * sibling paths resolve outside `_workspaceRoot` by design, and without this
   * the undo/redo snapshot for editing them was silently rejected (HYP-909
   * follow-up).
   */
  setAdditionalWorkspaceRoot(root: string | null): void {
    this._undoRedoService.setAdditionalWorkspaceRoot(root);
  }

  async handleMessage(message: AstMessage, targetWebview?: vscode.Webview, verifyElementId?: string): Promise<void> {
    // Path re-rooting for monorepo sub-projects happens upstream in
    // PanelRouter.routeMessage (the single ingress for ast:/editor:/styles:),
    // so `message` already carries repo-relative paths here. The public
    // direct-call methods below DO translate, because PreviewPanel invokes them
    // directly, bypassing PanelRouter (HYP-435).
    _dbgBridge(`[AstBridge.handleMessage] type=${message.type}`);

    let response: AstResponse;

    try {
      switch (message.type) {
        case 'ast:updateStyles':
          response = await this._handleUpdateStyles(message, verifyElementId);
          break;

        case 'ast:updateProps':
          response = await this._handleUpdateProps(message);
          break;

        case 'ast:insertElement':
          response = await this._handleInsertElement(message);
          break;

        case 'ast:deleteElements':
          response = await this._handleDeleteElements(message);
          break;

        case 'ast:duplicateElement':
          response = await this._handleDuplicateElement(message);
          break;

        case 'ast:updateText':
          response = await this._handleUpdateText(message);
          break;

        case 'ast:wrapElement':
          response = await this._handleWrapElement(message);
          break;

        case 'ast:moveElement':
          response = await this._handleMoveElement(message);
          break;

        case 'ast:swapElements':
          response = await this._handleSwapElements(message);
          break;

        case 'ast:writeI18nResource':
          response = await this._handleWriteI18nResource(message);
          break;

        default:
          response = {
            type: 'ast:response',
            requestId: (message as { requestId: string }).requestId,
            success: false,
            error: `Unknown AST message type: ${(message as { type: string }).type}`,
          };
      }
    } catch (error) {
      console.error('[AstBridge] Error handling message:', error);
      response = {
        type: 'ast:response',
        requestId: (message as { requestId: string }).requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    this._sendResponse(response, targetWebview);
  }

  // === Undo tracking helpers ===

  private _resolvePath(filePath: string): string {
    return path.isAbsolute(filePath) ? filePath : path.resolve(this._workspaceRoot, filePath);
  }

  private async _withUndoTracking<T extends AstOperationResult>(
    filePath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const absolutePath = this._resolvePath(filePath);
    // Clear redo stack before ANY write — even when readFile fails.
    // If beginTracking() were called only after a successful readFile(), a
    // readFile() error (e.g. VS Code in-flight document update) would skip it,
    // leaving the redo stack non-empty. CMD_REDO would then replay a stale
    // entry from before the new edit. beginTracking() must always run first.
    this._undoRedoService.beginTracking();
    try {
      let contentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
      } catch {
        // File doesn't exist yet — run operation without undo tracking.
        // Redo was already cleared by beginTracking() above.
        console.warn(`[AstBridge] _withUndoTracking: cannot read file for undo tracking: ${absolutePath}`);
        return await operation();
      }
      const result = await operation();
      if (result.success) {
        // HYP-987 P1 (codex) — the op took a warn-and-roll-back path and does NOT own the final
        // content (a concurrent edit may have landed in the verify window and been preserved by
        // the CAS rollback). Recording an undo entry here would let Undo erase that concurrent
        // edit. Skip tracking entirely for this op.
        if (result.skipUndoTracking) return result;
        // For cross-file writes (e.g. twitter: requested App.tsx but wrote to Feed.tsx),
        // the operation returns resolvedPath pointing to the actual mutated file.
        const actualPath = result.resolvedPath ?? absolutePath;
        const needsSnapshot = actualPath !== absolutePath;

        // For cross-file writes the operation captures contentBeforeWrite before the mutation.
        // For same-file writes contentBefore (read above) is authoritative.
        const contentBeforeActual = needsSnapshot ? result.contentBeforeWrite : contentBefore;
        if (contentBeforeActual === undefined) {
          // contentBeforeWrite read failed in AstService — skip undo snapshot rather
          // than recording an empty string which would erase the file on undo.
          console.warn(
            `[AstBridge] _withUndoTracking: contentBeforeWrite unavailable for cross-file write to ${path.basename(actualPath)}, skipping undo snapshot`,
          );
          return result;
        }

        let contentAfter: string;
        try {
          // Use readFileFromDisk to bypass document cache — doc.save() may not have synced yet
          contentAfter = await this._fileIO.readFileFromDisk(actualPath);
        } catch {
          try {
            contentAfter = await this._fileIO.readFile(actualPath);
          } catch {
            contentAfter = contentBeforeActual;
          }
        }
        if (contentBeforeActual !== contentAfter) {
          this._undoRedoService.recordEdit(actualPath, contentBeforeActual, contentAfter);
        } else {
          console.warn(
            `[AstBridge] _withUndoTracking: content unchanged after operation — NO undo entry recorded for ${path.basename(actualPath)}`,
          );
        }
      }
      return result;
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  // === Public mutation methods (with undo tracking, for PreviewPanel direct calls) ===

  async deleteElements(rawFilePath: string, rawElementIds: string[]): Promise<AstOperationResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementIds = rawElementIds.map((id) => toRepoRelativeElementId(id, this._subProjectPrefix));
    const absolutePath = this._resolvePath(filePath);
    // Clear redo stack before ANY write — even when readFile fails (same invariant as _withUndoTracking).
    this._undoRedoService.beginTracking();
    try {
      // contentBefore: dirty buffer (preserves unsaved edits for undo snapshot).
      // diskContentBefore: disk-only read used for change-detection to avoid treating
      // a dirty buffer as a "modification" when the delete touched a different file.
      let contentBefore: string;
      let diskContentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
        diskContentBefore = await this._fileIO.readFileFromDisk(absolutePath);
      } catch {
        return this._astService.deleteElements(filePath, elementIds);
      }
      const result = await this._astService.deleteElements(filePath, elementIds);
      if (result.success) {
        // Collect all file modifications into a single atomic undo entry so that
        // one Cmd+Z restores every file that was changed by this delete operation.
        const batchEdits: Array<{ filePath: string; contentBefore: string; contentAfter: string }> = [];

        let mainAfter: string;
        try {
          mainAfter = await this._fileIO.readFileFromDisk(absolutePath);
        } catch {
          try {
            mainAfter = await this._fileIO.readFile(absolutePath);
          } catch {
            mainAfter = contentBefore;
          }
        }
        // Compare disk-to-disk to detect actual modification by the delete operation.
        // Using contentBefore (dirty buffer) vs mainAfter (disk) would produce false
        // positives when the file has unsaved edits but was not touched by this delete.
        if (diskContentBefore !== mainAfter) {
          batchEdits.push({ filePath: absolutePath, contentBefore, contentAfter: mainAfter });
        }

        for (const { resolvedPath: xPath, contentBefore: xBefore } of result.allCrossFileSnapshots ?? []) {
          let xAfter: string;
          try {
            // Disk-first to match the main-file path and avoid stale dirty-buffer reads
            // when the applyEdit sync in writeFile fails or lags behind the disk write.
            xAfter = await this._fileIO.readFileFromDisk(xPath);
          } catch {
            try {
              xAfter = await this._fileIO.readFile(xPath);
            } catch {
              xAfter = xBefore;
            }
          }
          if (xBefore !== xAfter) {
            batchEdits.push({ filePath: xPath, contentBefore: xBefore, contentAfter: xAfter });
          }
        }

        if (batchEdits.length > 0) {
          this._undoRedoService.recordBatchEdit(batchEdits);
        }
      }
      return result;
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  async duplicateElement(rawFilePath: string, rawElementId: string): Promise<DuplicateElementResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    return this._withUndoTracking(filePath, () => this._astService.duplicateElement(filePath, elementId));
  }

  async wrapElement(rawFilePath: string, rawElementId: string, wrapperType: string): Promise<WrapElementResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    return this._withUndoTracking(filePath, () => this._astService.wrapElement(filePath, elementId, wrapperType));
  }

  async pasteElement(rawFilePath: string, rawTargetId: string | null, tsxCode: string): Promise<InsertElementResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const targetId = rawTargetId === null ? null : toRepoRelativeElementId(rawTargetId, this._subProjectPrefix);
    return this._withUndoTracking(filePath, () => this._astService.pasteElement(filePath, targetId, tsxCode));
  }

  async undo(panel: vscode.WebviewPanel): Promise<boolean> {
    return this._undoRedoService.undo(panel);
  }

  async redo(panel: vscode.WebviewPanel): Promise<boolean> {
    return this._undoRedoService.redo(panel);
  }

  // === Read-only query methods (with sub-project prefix translation) ===

  /**
   * Resolve the full JSX range for `rawElementId` so the editor can select the
   * element's source (not just a caret). Wraps AstService.getElementRange() with
   * the same sub-project prefix translation the mutation methods apply, so Go-to-Code
   * resolves correctly for monorepo previews (HYP-771).
   *
   * Callers that bypass PanelRouter.routeMessage (PreviewPanel.goToCodeSelected,
   * preview-panel-context-menu, and PanelRouter._goToDefinitionViaLsp) must go through
   * this method instead of `astBridge.astService.getElementRange()` directly, which
   * skips translation and produces wrong paths under a non-empty sub-project prefix.
   */
  async getElementRange(rawFilePath: string, rawElementId: string): ReturnType<AstService['getElementRange']> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    return this._astService.getElementRange(filePath, elementId);
  }

  /**
   * Resolve the start cursor position for `rawElementId`. Wraps
   * AstService.getElementLocation() with sub-project prefix translation,
   * matching the same re-rooting that every mutation method applies (HYP-771).
   */
  async getElementLocation(
    rawFilePath: string,
    rawElementId: string,
    rawNodeRef?: NodeRef,
  ): ReturnType<AstService['getElementLocation']> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    const nodeRef = rawNodeRef ? (toRepoRelativeElementId(rawNodeRef, this._subProjectPrefix) as NodeRef) : undefined;
    return this._astService.getElementLocation(filePath, elementId, nodeRef);
  }

  // === Message handlers (routed from webview via handleMessage) ===

  /**
   * Handle updateStyles message
   */
  private async _handleUpdateStyles(
    message: Extract<AstMessage, { type: 'ast:updateStyles' }>,
    verifyElementId?: string,
  ): Promise<AstResponse> {
    _dbgBridge(
      `[AstBridge._handleUpdateStyles] filePath=${message.filePath} elementId=${message.elementId} styles=${JSON.stringify(message.styles)}`,
    );
    // elementId from the client is in nodeRef format ("fileName:line:col") — pass as nodeRef for element resolution
    const nodeRef = message.elementId?.includes(':') ? message.elementId : undefined;
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateStyles(
        message.filePath,
        message.elementId,
        message.styles,
        message.state,
        nodeRef,
        message.selectedSourceTabId,
        message.domClasses,
        message.probeDriving,
        // HYP-987 P1 #3 — the iframe-relative id for the write-verify RPC, threaded per call
        // (not baked into a shared-mutable provider) so overlapping edits can't race.
        verifyElementId,
      ),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      // HYP-901: spread `warning` only when present so a clean write's response shape
      // (`{ className }`) is unchanged — never `{ className, warning: undefined }`.
      success: result.success,
      data: result.success
        ? { className: result.className, ...(result.warning ? { warning: result.warning } : {}) }
        : undefined,
      error: result.error,
    };
  }

  /**
   * Handle updateProps message
   */
  private async _handleUpdateProps(message: Extract<AstMessage, { type: 'ast:updateProps' }>): Promise<AstResponse> {
    _dbgBridge(
      `[AstBridge._handleUpdateProps] filePath=${message.filePath} elementId=${message.elementId} props=${JSON.stringify(message.props)}`,
    );
    const nodeRef = message.elementId?.includes(':') ? message.elementId : undefined;
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateProps(message.filePath, message.elementId, message.props, nodeRef),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Handle updateText message
   */
  private async _handleUpdateText(message: Extract<AstMessage, { type: 'ast:updateText' }>): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateText(message.filePath, message.elementId, message.text),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Handle insertElement message
   */
  private async _handleInsertElement(
    message: Extract<AstMessage, { type: 'ast:insertElement' }>,
  ): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.insertElement(
        message.filePath,
        message.parentId,
        message.componentType,
        message.props,
        message.index,
        message.targetId,
        message.componentFilePath,
      ),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { newId: result.newId, index: result.index } : undefined,
      error: result.error,
    };
  }

  /**
   * Handle deleteElements message
   */
  private async _handleDeleteElements(
    message: Extract<AstMessage, { type: 'ast:deleteElements' }>,
  ): Promise<AstResponse> {
    const result = await this.deleteElements(message.filePath, message.elementIds);
    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  /**
   * Handle duplicateElement message
   */
  private async _handleDuplicateElement(
    message: Extract<AstMessage, { type: 'ast:duplicateElement' }>,
  ): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.duplicateElement(message.filePath, message.elementId),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { newId: result.newId } : undefined,
      error: result.error,
    };
  }

  /**
   * Handle wrapElement message
   */
  private async _handleWrapElement(message: Extract<AstMessage, { type: 'ast:wrapElement' }>): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.wrapElement(message.filePath, message.elementId, message.wrapperType, message.wrapperProps),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { wrapperId: result.wrapperId } : undefined,
      error: result.error,
    };
  }

  /**
   * Handle moveElement message — moves any JSX element to any place.
   * Source and target need NOT share a direct JSX parent: same-parent,
   * cross-parent, cross-component, and cross-file moves are all supported.
   * Cross-file moves return `allCrossFileSnapshots`
   * covering BOTH the source and target file pre-write contents, so undo
   * needs the same batch-edit treatment as `deleteElements`.
   *
   * Internal failures (file I/O, parse errors, unresolvable nodeRefs) throw
   * out of `AstService.moveElement` per its contract — caught here and
   * surfaced as `success: false` to the iframe via the standard ast:response
   * envelope. From the iframe's standpoint moveElement otherwise always
   * succeeds.
   */
  private async _handleMoveElement(message: Extract<AstMessage, { type: 'ast:moveElement' }>): Promise<AstResponse> {
    const absolutePath = this._resolvePath(message.filePath);
    this._undoRedoService.beginTracking();
    try {
      // Snapshot the source file BEFORE the move so single-file moves can
      // record the standard contentBefore→contentAfter edit. For cross-file
      // moves the source-file snapshot also lives in `allCrossFileSnapshots`
      // (captured by AstService at write time) so we don't double-count below.
      let contentBefore: string;
      let diskContentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
        diskContentBefore = await this._fileIO.readFileFromDisk(absolutePath);
      } catch {
        // File doesn't exist locally — run the operation untracked.
        const r = await this._astService.moveElement(
          message.filePath,
          message.sourceId,
          message.targetId,
          message.position,
        );
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: r.success,
          data: r.adjustments ? { adjustments: r.adjustments } : undefined,
        };
      }

      let result: Awaited<ReturnType<AstService['moveElement']>>;
      try {
        result = await this._astService.moveElement(
          message.filePath,
          message.sourceId,
          message.targetId,
          message.position,
        );
      } catch (error) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'moveElement failed',
        };
      }

      // Cross-file moves carry their own per-file snapshots. Record those
      // (source AND target). Same-file moves carry no snapshots, so fall back
      // to the disk-vs-disk comparison on `absolutePath`.
      const batchEdits: Array<{ filePath: string; contentBefore: string; contentAfter: string }> = [];
      const snapshots = result.allCrossFileSnapshots;
      if (snapshots && snapshots.length > 0) {
        for (const { resolvedPath: xPath, contentBefore: xBefore } of snapshots) {
          let xAfter: string;
          try {
            xAfter = await this._fileIO.readFileFromDisk(xPath);
          } catch {
            try {
              xAfter = await this._fileIO.readFile(xPath);
            } catch {
              xAfter = xBefore;
            }
          }
          if (xBefore !== xAfter) {
            batchEdits.push({ filePath: xPath, contentBefore: xBefore, contentAfter: xAfter });
          }
        }
      } else {
        // Same-file move — diff `absolutePath` (or `result.resolvedPath` if it
        // diverged, mirroring `_withUndoTracking`).
        const actualPath = result.resolvedPath ?? absolutePath;
        let mainAfter: string;
        try {
          mainAfter = await this._fileIO.readFileFromDisk(actualPath);
        } catch {
          try {
            mainAfter = await this._fileIO.readFile(actualPath);
          } catch {
            mainAfter = contentBefore;
          }
        }
        // Use disk-vs-disk on the original absolutePath only when the operation
        // resolved to that same file. Cross-file resolution (different file)
        // would have produced an `allCrossFileSnapshots` entry above already.
        const sameFile = actualPath === absolutePath;
        const beforeForDiff = sameFile ? diskContentBefore : (result.contentBeforeWrite ?? contentBefore);
        const beforeForUndo = sameFile ? contentBefore : (result.contentBeforeWrite ?? contentBefore);
        if (beforeForDiff !== mainAfter) {
          batchEdits.push({ filePath: actualPath, contentBefore: beforeForUndo, contentAfter: mainAfter });
        }
      }

      if (batchEdits.length > 0) {
        this._undoRedoService.recordBatchEdit(batchEdits);
      }

      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: true,
        data: result.adjustments ? { adjustments: result.adjustments } : undefined,
      };
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  /**
   * Handle swapElements message (spec Task 8 container swap). Same-file only,
   * so undo tracking is a single-file diff — simpler than `_handleMoveElement`,
   * which also handles the cross-file branch. Internal failures throw out of
   * `AstService.swapElements` and surface as `success: false` to the iframe.
   */
  private async _handleSwapElements(message: Extract<AstMessage, { type: 'ast:swapElements' }>): Promise<AstResponse> {
    const absolutePath = this._resolvePath(message.filePath);
    this._undoRedoService.beginTracking();
    try {
      let contentBefore: string;
      let diskContentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
        diskContentBefore = await this._fileIO.readFileFromDisk(absolutePath);
      } catch {
        // File not present locally — run untracked.
        const r = await this._astService.swapElements(message.filePath, message.aId, message.bId);
        return { type: 'ast:response', requestId: message.requestId, success: r.success };
      }

      let result: Awaited<ReturnType<AstService['swapElements']>>;
      try {
        result = await this._astService.swapElements(message.filePath, message.aId, message.bId);
      } catch (error) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'swapElements failed',
        };
      }

      const actualPath = result.resolvedPath ?? absolutePath;
      const sameFile = actualPath === absolutePath;
      let after: string;
      try {
        after = await this._fileIO.readFileFromDisk(actualPath);
      } catch {
        try {
          after = await this._fileIO.readFile(actualPath);
        } catch {
          after = contentBefore;
        }
      }
      const beforeForDiff = sameFile ? diskContentBefore : (result.contentBeforeWrite ?? contentBefore);
      const beforeForUndo = sameFile ? contentBefore : (result.contentBeforeWrite ?? contentBefore);
      if (beforeForDiff !== after) {
        this._undoRedoService.recordBatchEdit([
          { filePath: actualPath, contentBefore: beforeForUndo, contentAfter: after },
        ]);
      }

      return { type: 'ast:response', requestId: message.requestId, success: true };
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  /**
   * Handle writeI18nResource message.
   * Writes a translated value for the given key in the active locale dictionary.
   * If the key itself changes (previousKey provided), also updates the JSX child expression.
   */
  private async _handleWriteI18nResource(
    message: Extract<AstMessage, { type: 'ast:writeI18nResource' }>,
  ): Promise<AstResponse> {
    // Library whitelist mirrors the SaaS HTTP route. The webview message channel
    // does not enforce the I18nLibrary union at runtime, so a spoofed message
    // could pass any string here — guard before forwarding to writeI18nResource.
    const VALID_LIBRARIES = new Set<string>([
      'react-i18next',
      'i18next',
      'next-intl',
      'react-intl',
      'lingui',
      'custom',
    ]);
    if (!VALID_LIBRARIES.has(message.library)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid library' };
    }
    if (typeof message.newText !== 'string' || message.newText.length > 10_000) {
      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: false,
        error: 'newText exceeds maximum length of 10000 characters',
      };
    }
    // Reject path traversal via locale/namespace — same guard as the SaaS HTTP route.
    // Key validation prevents JSX injection when key is interpolated into {t("...")} expressions.
    const SAFE_SEGMENT = /^[\w-]{1,64}$/;
    if (!SAFE_SEGMENT.test(message.activeLocale)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid activeLocale' };
    }
    if (message.namespace !== undefined && !SAFE_SEGMENT.test(message.namespace)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid namespace' };
    }
    // Reject control chars (would break JSON parsing) and JSX-structural chars
    // ({, }, <, >). Curly braces in particular corrupt the source: the JSX-rewrite
    // path below builds `{t("KEY")}` and routes through parseMixedContent's
    // regex `/\{([^}]+)\}/g`, which is naïve about string literals — a `}` inside
    // the key prematurely closes the expression and the rest leaks into JSXText.
    const keyLen = message.key.length;
    if (keyLen === 0 || keyLen > 256 || /[\n\r\0{}<>]/.test(message.key)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid key' };
    }

    const localeLayout = await discoverLayout(
      this._workspaceRoot,
      message.namespace,
      message.activeLocale,
      this._fileIO,
    ).catch(() => null);
    const localeFilePath = localeLayout?.getLocaleFilePath(message.activeLocale) ?? null;

    // When skipResourceWrite is set, skip the locale dictionary write — only update JSX below.
    // Used when the user switches to an existing key from the dropdown: we don't want to
    // overwrite the existing translation under the new key.
    let writeResult: AstOperationResult & { filePath: string | null };
    if (message.skipResourceWrite) {
      writeResult = { success: true, filePath: null };
    } else {
      const doWrite = async (): Promise<AstOperationResult & { filePath: string | null }> => {
        const r = await writeI18nResource({
          projectRoot: this._workspaceRoot,
          library: message.library,
          key: message.key,
          namespace: message.namespace,
          activeLocale: message.activeLocale,
          newText: message.newText,
          fileIO: this._fileIO,
        });
        return { success: r.success, error: r.error, filePath: r.filePath };
      };
      writeResult = localeFilePath ? await this._withUndoTracking(localeFilePath, doWrite) : await doWrite();
    }

    if (!writeResult.success) {
      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: false,
        error: writeResult.error,
      };
    }

    // Always attempt to update the key literal in JSX when a previousKey is provided,
    // even if previousKey === message.key. The client can hold stale state (HMR clears
    // selectedIds briefly; ?? prev.i18nText preserves the pre-write key), so the file
    // may have a different key than what the client reports. updateI18nKey's fallback
    // handles this: when previousKey is not found, it replaces the first StringLiteral.
    const { filePath: i18nFilePath, elementId: i18nElementId } = message;
    const previousKey = message.previousKey;
    let newElementId: string | undefined;
    _dbgBridge(
      `[writeI18nResource] key=${message.key} previousKey=${previousKey} filePath=${i18nFilePath} elementId=${i18nElementId} skipResourceWrite=${message.skipResourceWrite}`,
    );
    if (i18nFilePath && i18nElementId && previousKey) {
      try {
        const preContent = await this._fileIO.readFile(i18nFilePath);
        const lines = preContent.split('\n');
        const snippet = lines
          .slice(109, 145)
          .map((l, i) => `L${i + 110}:${l}`)
          .join(' | ')
          .substring(0, 2000);
        _dbgBridge(`[pre-updateI18nKey] lines 110-145: ${snippet}`);
      } catch {}
      const updateResult = await this._withUndoTracking(i18nFilePath, () =>
        this._astService.updateI18nKey(i18nFilePath, i18nElementId, previousKey, message.key),
      );
      _dbgBridge(
        `[updateI18nKey] result=${JSON.stringify({ success: updateResult.success, error: (updateResult as { error?: string }).error })}`,
      );
      if (!updateResult.success) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: updateResult.error,
        };
      }
      // JSX element opening tag position is invariant under key-only rewrites.
      // Return i18nElementId as canonical post-write ID for Path A selection re-attach.
      newElementId = i18nElementId;
    }

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: true,
      data: { filePath: writeResult.filePath, newElementId },
    };
  }

  /**
   * Send response back to webview.
   * Uses targetWebview if provided, otherwise falls back to default webview.
   */
  private _sendResponse(response: AstResponse, targetWebview?: vscode.Webview): void {
    const webview = targetWebview ?? this._webview;
    if (!webview) {
      console.warn('[AstBridge] No webview set, cannot send response');
      return;
    }

    console.log('[AstBridge] Sending response:', response.type, response.success);
    webview.postMessage(response);
  }
}
