/**
 * PanelRouter - central message router for all webview panels
 *
 * Handles shared platform messages (ast:*, editor:*, state:*, component:*)
 * that any panel can send. Panel-specific messages (previewLoaded,
 * devserver:*, etc.) stay in their respective panel providers.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { AstBridge } from './bridges/AstBridge';
import { type EditorMessage, handleEditorMessage } from './EditorBridge';
import type { StateHub } from './StateHub';
import { ComponentService } from './services/ComponentService';
import { StyleReadService } from './services/StyleReadService';
import type { AstMessage, SharedEditorState } from './types';
import { VSCodeFileIO } from './vscode-file-io';

interface PanelRouterConfig {
  workspaceRoot: string;
  stateHub: StateHub;
  context: vscode.ExtensionContext;
}

export class PanelRouter {
  private _astBridge: AstBridge;
  private _stateHub: StateHub;
  private _componentService: ComponentService;
  private _styleReadService: StyleReadService;
  private _workspaceRoot: string;
  private _onOpenAIChat?: (prompt: string) => void;

  constructor(config: PanelRouterConfig) {
    this._astBridge = new AstBridge(config.workspaceRoot);
    this._stateHub = config.stateHub;
    this._componentService = new ComponentService(config.workspaceRoot, () =>
      Promise.resolve(config.context.secrets.get('hypercanvas.ai.apiKey')),
    );
    this._styleReadService = new StyleReadService(config.workspaceRoot, new VSCodeFileIO());
    this._workspaceRoot = config.workspaceRoot;
  }

  get astBridge(): AstBridge {
    return this._astBridge;
  }

  get componentService(): ComponentService {
    return this._componentService;
  }

  getComponentGroups() {
    return this._componentService.scanComponentGroups();
  }

  /**
   * Route a message from a panel to the appropriate handler.
   * Returns true if the message was handled.
   */
  async routeMessage(panelId: string, message: unknown, webview: vscode.Webview): Promise<boolean> {
    const msg = message as { type?: string };
    const type = msg.type;
    if (!type) return false;

    // State sync
    if (type === 'state:update') {
      const { patch } = message as { patch: Partial<SharedEditorState> };
      this._stateHub.applyUpdate(panelId, patch);
      return true;
    }

    // Editor operations
    if (type.startsWith('editor:')) {
      await handleEditorMessage(message as EditorMessage, webview);
      return true;
    }

    // AST operations — route response back to the requesting webview
    if (type.startsWith('ast:')) {
      await this._astBridge.handleMessage(message as AstMessage, webview);
      return true;
    }

    // AI chat open request (from any panel)
    if (type === 'ai:openChat') {
      const { prompt } = message as { prompt?: string };
      if (this._onOpenAIChat && prompt) {
        this._onOpenAIChat(prompt);
      }
      return true;
    }

    // Component operations — grouped list (directory-based)
    if (type === 'component:listGroups') {
      const { requestId } = message as { requestId: string };
      try {
        const result = await this._componentService.scanComponentGroups();
        webview.postMessage({
          type: 'component:response',
          requestId,
          success: true,
          data: result.data,
          needsSetup: result.needsSetup,
          setupReason: result.setupReason,
        });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    // Execute VS Code commands from webview
    if (type === 'command:execute') {
      const { command, args } = message as { command: string; args?: string[] };
      try {
        await vscode.commands.executeCommand(command, ...(args ?? []));
      } catch (e) {
        console.error(`[PanelRouter] Failed to execute command ${command}:`, e); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      }
      return true;
    }

    // Component operations — flat list (legacy)
    if (type === 'component:list') {
      const { requestId } = message as { requestId: string };
      try {
        const tree = await this._componentService.scanComponents();
        webview.postMessage({ type: 'component:response', requestId, success: true, data: tree });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    if (type === 'component:tests') {
      const { requestId, componentPath } = message as { requestId: string; componentPath: string };
      try {
        const groups = await this._componentService.scanComponentTests(componentPath);
        webview.postMessage({ type: 'component:response', requestId, success: true, data: groups });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    if (type === 'component:parse') {
      const { requestId, componentPath } = message as { requestId: string; componentPath: string };
      try {
        const info = await this._componentService.getComponent(componentPath);
        webview.postMessage({ type: 'component:response', requestId, success: true, data: info });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    if (type === 'component:parseStructure') {
      const { requestId, componentPath } = message as { requestId: string; componentPath: string };
      try {
        const structure = await this._componentService.parseStructure(componentPath);
        webview.postMessage({ type: 'component:response', requestId, success: true, data: structure });
      } catch (e) {
        webview.postMessage({ type: 'component:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    // File operations (local filesystem)
    if (type === 'file:read') {
      const { requestId, filePath } = message as { requestId: string; filePath: string };
      try {
        const resolved = path.resolve(this._workspaceRoot, filePath);
        const content = await fs.readFile(resolved, 'utf-8');
        webview.postMessage({ type: 'file:response', requestId, success: true, data: content });
      } catch (e) {
        webview.postMessage({ type: 'file:response', requestId, success: false, error: String(e) });
      }
      return true;
    }

    // Style reading operations (right panel inspector)
    if (type === 'styles:readClassName') {
      const { requestId, elementId, componentPath } = message as {
        requestId: string;
        elementId: string;
        componentPath: string;
      };
      try {
        const result = await this._styleReadService.readElementClassName(elementId, componentPath);
        webview.postMessage({
          type: 'styles:response',
          requestId,
          success: true,
          ...result,
        });
      } catch (e) {
        webview.postMessage({
          type: 'styles:response',
          requestId,
          success: false,
          error: String(e),
        });
      }
      return true;
    }

    return false;
  }

  /**
   * Set the webview that should receive AST responses.
   * Called when a panel is created or focused.
   */
  setAstResponseTarget(webview: vscode.Webview): void {
    this._astBridge.setWebview(webview);
  }

  /**
   * Set callback for ai:openChat messages from any panel.
   * Extension host wires this to AIChatPanelProvider.
   */
  setOnOpenAIChat(callback: (prompt: string) => void): void {
    this._onOpenAIChat = callback;
  }

  dispose(): void {
    // Nothing to dispose currently
  }
}
