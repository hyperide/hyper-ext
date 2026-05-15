/**
 * PanelRouter - central message router for all webview panels
 *
 * Handles shared platform messages (ast:*, editor:*, state:*, component:*)
 * that any panel can send. Panel-specific messages (previewLoaded,
 * devserver:*, etc.) stay in their respective panel providers.
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { resolveInSourceMap, type SourceMapV3 } from '@shared/element-tracing/source-map-resolver';
import type { TracingClientMessage } from '@shared/element-tracing/types';
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
  private _context: vscode.ExtensionContext;
  private _currentWebview: vscode.Webview | null = null;
  private _onOpenAIChat?: (prompt: string) => void;
  private _onElementTracingMessage?: (msg: TracingClientMessage) => void;

  constructor(config: PanelRouterConfig) {
    this._astBridge = new AstBridge(config.workspaceRoot);
    this._stateHub = config.stateHub;
    this._context = config.context;
    this._componentService = this._createComponentService(config.workspaceRoot);
    this._styleReadService = this._createStyleReadService(config.workspaceRoot);
    this._workspaceRoot = config.workspaceRoot;
  }

  get astBridge(): AstBridge {
    this._ensureCurrentWorkspace();
    return this._astBridge;
  }

  get componentService(): ComponentService {
    this._ensureCurrentWorkspace();
    return this._componentService;
  }

  get workspaceRoot(): string {
    this._ensureCurrentWorkspace();
    return this._workspaceRoot;
  }

  getComponentGroups() {
    this._ensureCurrentWorkspace();
    return this._componentService.scanComponentGroups();
  }

  /** Flush deferred .hyperide writes to disk. Returns true if anything was written. */
  flushStructureStore(): Promise<boolean> {
    return this._componentService.flushStructureStore();
  }

  /**
   * Route a message from a panel to the appropriate handler.
   * Returns true if the message was handled.
   */
  async routeMessage(message: unknown, webview: vscode.Webview): Promise<boolean> {
    this._ensureCurrentWorkspace();
    const msg = message as { type?: string };
    const type = msg.type;
    if (!type) return false;

    // Element tracing messages — forward to PostMessageTracingTransport
    const TRACING_PREFIX = 'element-tracing:';
    if (type.startsWith(TRACING_PREFIX)) {
      if (this._onElementTracingMessage) {
        const { payload } = message as { payload: TracingClientMessage };
        this._onElementTracingMessage(payload);
      }
      return true;
    }

    // State sync
    if (type === 'state:update') {
      const { patch } = message as { patch: Partial<SharedEditorState> };
      this._stateHub.applyUpdate(patch);
      return true;
    }

    // Canvas scroll — echo back to the sending panel so usePreviewBridge can forward to iframe
    if (type === 'iframe:scrollToElement') {
      webview.postMessage(message);
      return true;
    }

    // Selection-freeze coordination — sender lives in the right sidebar,
    // listener lives in the preview panel's iframe. Broadcast so the message
    // reaches every registered webview; only usePreviewBridge handles it.
    // See docs/plans/2026-05-06-selection-survives-i18n-write.md (Path B).
    if (type === 'iframe:writeI18nResource') {
      this._stateHub.broadcast(message);
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

    // Approach B: server-side (RSC) source map resolution.
    // The iframe IIFE cannot fetch server chunk source maps (file:// paths, not browser-accessible).
    // PanelRouter reads the .map file from the local filesystem and decodes VLQ.
    if (type === 'hypercanvas:resolveServerSourceMap') {
      const { filePath, line, col } = message as { filePath: string; line: number; col: number };
      let result = null;
      try {
        const mapPath = filePath.endsWith('.map') ? filePath : `${filePath}.map`;
        const content = await fs.readFile(mapPath, 'utf-8');
        const sm = JSON.parse(content) as SourceMapV3;
        result = resolveInSourceMap(sm, line, col);
      } catch {
        // File not found or parse error — result stays null
      }
      webview.postMessage({ type: 'serverSourceMapResult', filePath, line, col, result });
      return true;
    }

    // Right panel input focus — update context variable so keybindings don't fire in inputs
    if (type === 'panel:inputFocus') {
      const { active } = message as { active: boolean };
      vscode.commands.executeCommand('setContext', 'hypercanvas.rightPanelInputFocused', active);
      return true;
    }

    // Update hypercanvas.devServer.autoStart setting from webview checkbox
    if (type === 'panel:updateAutoStart') {
      const { value } = message as { value: boolean };
      await vscode.workspace
        .getConfiguration('hypercanvas.devServer')
        .update('autoStart', value, vscode.ConfigurationTarget.Global);
      return true;
    }

    // Open VS Code Settings UI at a specific query
    if (type === 'panel:openSettings') {
      const { query } = message as { query: string };
      await vscode.commands.executeCommand('workbench.action.openSettings', query);
      return true;
    }

    // Style reading operations (right panel inspector)
    if (type === 'styles:readClassName') {
      const { requestId, elementId, componentPath, domTextContent, activeLocale } = message as {
        requestId: string;
        elementId: string;
        componentPath: string;
        domTextContent?: string;
        activeLocale?: string;
      };
      try {
        // Ensure NodeMapService is populated before reading styles
        // (same race condition as HYP-268 for writes).
        await this._astBridge.astService.ensureInitialized();
        const result = await this._styleReadService.readElementClassName(
          componentPath,
          elementId,
          domTextContent,
          activeLocale,
        );
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

    // Fetch all available i18n keys from the active locale file
    if (type === 'styles:fetchI18nKeys') {
      const { requestId, namespace, activeLocale } = message as {
        requestId: string;
        namespace?: string;
        activeLocale: string;
      };
      try {
        const keys = await this._styleReadService.getAvailableKeys(namespace, activeLocale);
        webview.postMessage({ type: 'styles:i18nKeysResponse', requestId, success: true, keys });
      } catch (e) {
        webview.postMessage({ type: 'styles:i18nKeysResponse', requestId, success: false, keys: [], error: String(e) });
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
    this._currentWebview = webview;
    this._astBridge.setWebview(webview);
  }

  /**
   * Set callback for ai:openChat messages from any panel.
   * Extension host wires this to AIChatPanelProvider.
   */
  setOnOpenAIChat(callback: (prompt: string) => void): void {
    this._onOpenAIChat = callback;
  }

  /**
   * Set callback for element-tracing messages from any panel.
   * Extension host wires this to PostMessageTracingTransport.receiveFromWebview().
   */
  setOnElementTracingMessage(callback: (msg: TracingClientMessage) => void): void {
    this._onElementTracingMessage = callback;
  }

  dispose(): void {
    // Nothing to dispose currently
  }

  private _createComponentService(workspaceRoot: string): ComponentService {
    return new ComponentService(workspaceRoot, () =>
      Promise.resolve(this._context.secrets.get('hypercanvas.ai.apiKey')),
    );
  }

  private _createStyleReadService(workspaceRoot: string): StyleReadService {
    return new StyleReadService(workspaceRoot, new VSCodeFileIO(), this._astBridge.astService.nodeMapService);
  }

  private _ensureCurrentWorkspace(): void {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || workspaceRoot === this._workspaceRoot) return;
    this._workspaceRoot = workspaceRoot;
    this._astBridge = new AstBridge(workspaceRoot);
    if (this._currentWebview) this._astBridge.setWebview(this._currentWebview);
    this._componentService = this._createComponentService(workspaceRoot);
    this._styleReadService = this._createStyleReadService(workspaceRoot);
  }
}
