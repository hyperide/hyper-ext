/**
 * AST Bridge - handles AST-related messages from webview
 *
 * Routes ast:* messages to AstService and sends responses back.
 */

import * as fsSync from 'node:fs';
import path from 'node:path';
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
  console.log(msg);
  if (_BRIDGE_DEBUG_LOG) {
    try {
      fsSync.appendFileSync(_BRIDGE_DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
    } catch {}
  }
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
      let contentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
      } catch {
        return this._astService.deleteElements(filePath, elementIds);
      }
      const result = await this._astService.deleteElements(filePath, elementIds);
      if (result.success) {
        let contentAfter: string;
        try {
          contentAfter = await this._fileIO.readFile(absolutePath);
        } catch {
          contentAfter = contentBefore;
        }
        if (contentBefore !== contentAfter) {
          // Single undo entry for the entire delete operation (regardless of element count).
          // Content snapshots capture the full before/after — no need for per-element entries.
          this._undoRedoService.recordEdit(absolutePath, contentBefore, contentAfter);
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
    const absolutePath = this._resolvePath(message.filePath);
    let contentBefore: string | undefined;
    try {
      contentBefore = await this._fileIO.readFile(absolutePath);
    } catch {
      // ignore — no undo tracking for missing files
    }

    const result = await this._astService.deleteElements(message.filePath, message.elementIds);

    if (result.success && contentBefore !== undefined) {
      let contentAfter: string;
      try {
        contentAfter = await this._fileIO.readFile(absolutePath);
      } catch {
        contentAfter = contentBefore;
      }
      if (contentBefore !== contentAfter) {
        this._undoRedoService.recordEdit(absolutePath, contentBefore, contentAfter);
      }
    }

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
