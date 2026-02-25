/**
 * AST Bridge - handles AST-related messages from webview
 *
 * Routes ast:* messages to AstService and sends responses back.
 */

import * as vscode from 'vscode';
import { AstService } from '../services/AstService';
import { VSCodeFileIO } from '../vscode-file-io';
import type { AstMessage, AstResponse } from '../types';

export class AstBridge {
  private _astService: AstService;
  private _webview: vscode.Webview | null = null;

  constructor(workspaceRoot: string) {
    this._astService = new AstService(workspaceRoot, new VSCodeFileIO());
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

  /**
   * Handle updateStyles message
   */
  private async _handleUpdateStyles(
    message: Extract<AstMessage, { type: 'ast:updateStyles' }>,
  ): Promise<AstResponse> {
    const result = await this._astService.updateStyles(
      message.filePath,
      message.elementId,
      message.styles,
      message.state,
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
  private async _handleUpdateProps(
    message: Extract<AstMessage, { type: 'ast:updateProps' }>,
  ): Promise<AstResponse> {
    const result = await this._astService.updateProps(
      message.filePath,
      message.elementId,
      message.props,
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
  private async _handleUpdateText(
    message: Extract<AstMessage, { type: 'ast:updateText' }>,
  ): Promise<AstResponse> {
    const result = await this._astService.updateText(
      message.filePath,
      message.elementId,
      message.text,
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
    const result = await this._astService.insertElement(
      message.filePath,
      message.parentId,
      message.componentType,
      message.props,
      message.index,
      message.targetId,
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success
        ? { newId: result.newId, index: result.index }
        : undefined,
      error: result.error,
    };
  }

  /**
   * Handle deleteElements message
   */
  private async _handleDeleteElements(
    message: Extract<AstMessage, { type: 'ast:deleteElements' }>,
  ): Promise<AstResponse> {
    const result = await this._astService.deleteElements(
      message.filePath,
      message.elementIds,
    );

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
    const result = await this._astService.duplicateElement(
      message.filePath,
      message.elementId,
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
  private async _handleWrapElement(
    message: Extract<AstMessage, { type: 'ast:wrapElement' }>,
  ): Promise<AstResponse> {
    const result = await this._astService.wrapElement(
      message.filePath,
      message.elementId,
      message.wrapperType,
      message.wrapperProps,
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
