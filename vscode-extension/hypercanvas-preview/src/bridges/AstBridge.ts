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
import { UndoRedoService } from '../services/UndoRedoService';
import type { AstMessage, AstResponse } from '../types';
import { VSCodeFileIO } from '../vscode-file-io';

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

  constructor(workspaceRoot: string) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = new VSCodeFileIO();
    this._astService = new AstService(workspaceRoot, this._fileIO);
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
  async handleMessage(message: AstMessage, targetWebview?: vscode.Webview): Promise<void> {
    _dbgBridge(`[AstBridge.handleMessage] type=${message.type}`);

    let response: AstResponse;

    try {
      switch (message.type) {
        case 'ast:updateStyles':
          response = await this._handleUpdateStyles(message);
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

        case 'ast:reorderElement':
          response = await this._handleReorderElement(message);
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

  async deleteElements(filePath: string, elementIds: string[]): Promise<AstOperationResult> {
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

  async duplicateElement(filePath: string, elementId: string): Promise<DuplicateElementResult> {
    return this._withUndoTracking(filePath, () => this._astService.duplicateElement(filePath, elementId));
  }

  async wrapElement(filePath: string, elementId: string, wrapperType: string): Promise<WrapElementResult> {
    return this._withUndoTracking(filePath, () => this._astService.wrapElement(filePath, elementId, wrapperType));
  }

  async pasteElement(filePath: string, targetId: string | null, tsxCode: string): Promise<InsertElementResult> {
    return this._withUndoTracking(filePath, () => this._astService.pasteElement(filePath, targetId, tsxCode));
  }

  async undo(panel: vscode.WebviewPanel): Promise<boolean> {
    return this._undoRedoService.undo(panel);
  }

  async redo(panel: vscode.WebviewPanel): Promise<boolean> {
    return this._undoRedoService.redo(panel);
  }

  // === Message handlers (routed from webview via handleMessage) ===

  /**
   * Handle updateStyles message
   */
  private async _handleUpdateStyles(message: Extract<AstMessage, { type: 'ast:updateStyles' }>): Promise<AstResponse> {
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
      ),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { className: result.className } : undefined,
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
   * Handle reorderElement message — moves a JSX sibling before/after another sibling.
   */
  private async _handleReorderElement(
    message: Extract<AstMessage, { type: 'ast:reorderElement' }>,
  ): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.reorderElement(message.filePath, message.sourceId, message.targetId, message.position),
    );
    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Handle writeI18nResource message.
   * Writes a translated value for the given key in the active locale JSON file.
   * If the key itself changes (previousKey provided), also updates the JSX child expression.
   */
  private async _handleWriteI18nResource(
    message: Extract<AstMessage, { type: 'ast:writeI18nResource' }>,
  ): Promise<AstResponse> {
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
    if (
      keyLen === 0 ||
      keyLen > 256 ||
      /[\n\r\0{}<>]/.test(message.key)
    ) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid key' };
    }

    const localeLayout = await discoverLayout(
      this._workspaceRoot,
      message.namespace,
      message.activeLocale,
      this._fileIO,
    ).catch(() => null);
    const localeFilePath = localeLayout?.getLocaleFilePath(message.activeLocale) ?? null;

    // When skipResourceWrite is set, skip the JSON locale write — only update JSX below.
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

    // When the key itself changes, update the JSX child expression so the AST
    // reflects the new key (e.g. t("old.key") → t("new.key")).
    const { filePath: i18nFilePath, elementId: i18nElementId } = message;
    if (i18nFilePath && i18nElementId && message.previousKey && message.previousKey !== message.key) {
      // JSON.stringify covers backslashes, U+2028/2029, and quote escapes that the
      // earlier `replace(/'/g, "\\'")` missed. Structural chars ({, }, <, >) and
      // control chars are already rejected by the key validator above, so the
      // resulting expression is safe to feed into the regex-based parseMixedContent.
      const newExpression = `{t(${JSON.stringify(message.key)})}`;
      const updateResult = await this._withUndoTracking(i18nFilePath, () =>
        this._astService.updateText(i18nFilePath, i18nElementId, newExpression),
      );
      if (!updateResult.success) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: updateResult.error,
        };
      }
    }

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: true,
      data: { filePath: writeResult.filePath },
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
