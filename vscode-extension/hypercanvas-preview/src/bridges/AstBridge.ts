/**
 * AST Bridge - handles AST-related messages from webview
 *
 * Routes ast:* messages to AstService and sends responses back.
 */

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

export class AstBridge {
  private _astService: AstService;
  private _undoRedoService: UndoRedoService;
  private _workspaceRoot: string;
  private _webview: vscode.Webview | null = null;

  constructor(workspaceRoot: string) {
    this._workspaceRoot = workspaceRoot;
    this._astService = new AstService(workspaceRoot, new VSCodeFileIO());
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
    console.log('[AstBridge] Received message:', message.type);

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
    const result = await operation();
    if (result.success) {
      this._undoRedoService.recordEdit(this._resolvePath(filePath));
    }
    return result;
  }

  // === Public mutation methods (with undo tracking, for PreviewPanel direct calls) ===

  async deleteElements(filePath: string, elementIds: string[]): Promise<AstOperationResult> {
    const result = await this._astService.deleteElements(filePath, elementIds);
    if (result.success) {
      // deleteElements writes once per element — record matching undo entries
      const count = (result.data as { deletedCount?: number })?.deletedCount ?? 1;
      const resolved = this._resolvePath(filePath);
      for (let i = 0; i < count; i++) {
        this._undoRedoService.recordEdit(resolved);
      }
    }
    return result;
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
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateStyles(message.filePath, message.elementId, message.styles, message.state),
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
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateProps(message.filePath, message.elementId, message.props),
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
    const result = await this._astService.deleteElements(message.filePath, message.elementIds);
    if (result.success) {
      // deleteElements writes once per element — record matching undo entries
      const count = (result.data as { deletedCount?: number })?.deletedCount ?? 1;
      const resolved = this._resolvePath(message.filePath);
      for (let i = 0; i < count; i++) {
        this._undoRedoService.recordEdit(resolved);
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
