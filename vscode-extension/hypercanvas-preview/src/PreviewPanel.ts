/**
 * Preview Panel
 *
 * Manages a WebviewPanel for component preview as an editor tab.
 * Uses local dev server for preview rendering.
 * Unlike WebviewViewProvider, this creates a draggable editor tab.
 *
 * The webview renders a React app (PreviewPanelApp) that handles:
 * - iframe loading, overlay rendering, canvas interaction
 * - context menu for element operations
 * - message bridging between iframe and extension
 */

import * as vscode from 'vscode';
import { handleEditorMessage, setupActiveFileListener } from './EditorBridge';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import { SyncPositionService } from './services/SyncPositionService';
import type { DevServerRuntimeError } from './types';

export class PreviewPanel {
  public static readonly viewType = 'hypercanvas.previewPanel';
  private static readonly PANEL_ID = 'preview';

  private _panel?: vscode.WebviewPanel;
  private _currentComponent?: string;
  private _defaultComponent?: string;
  private _disposables: vscode.Disposable[] = [];

  // Runtime error callback
  private _onRuntimeErrorCallback: ((error: DevServerRuntimeError | null) => void) | null = null;

  // Console capture callback (from iframe console intercept)
  private _onConsoleCaptureCallback:
    | ((entries: Array<{ level: string; args: string[]; timestamp: number }>) => void)
    | null = null;

  // Pending content requests (for Copy Text / Copy as HTML round-trip)
  private _pendingContentRequests = new Map<string, (result: { text?: string; html?: string }) => void>();

  // Preview URL (set dynamically when dev server starts)
  private _previewBaseUrl = 'http://localhost:3000';

  // Whether dev server is actually running
  private _devServerRunning = false;

  // Bidirectional code/preview position sync
  private _syncService?: SyncPositionService;

  // Cross-panel coordination
  private _stateHub: StateHub;
  private _panelRouter: PanelRouter;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _workspaceRoot: string,
    stateHub: StateHub,
    panelRouter: PanelRouter,
  ) {
    this._stateHub = stateHub;
    this._panelRouter = panelRouter;
  }

  /**
   * Create a new panel or reveal existing one
   */
  public createOrShow(column?: vscode.ViewColumn): void {
    if (this._panel) {
      this._panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      PreviewPanel.viewType,
      'Hyper Canvas',
      column || vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
      },
    );

    this._setupPanel(panel);
  }

  /**
   * Restore panel from serialized state (cross-restart persistence).
   * If we already created a panel via createOrShow, dispose it
   * in favor of the one VSCode is restoring.
   */
  public restorePanel(panel: vscode.WebviewPanel): void {
    if (this._panel) {
      this._panel.dispose();
    }
    this._setupPanel(panel);
  }

  /**
   * Shared panel initialization
   */
  private _setupPanel(panel: vscode.WebviewPanel): void {
    this._panel = panel;

    panel.iconPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.png');

    // Ensure scripts are enabled (matters for deserialized panels)
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
    };

    // Register with StateHub and PanelRouter
    this._stateHub.register(PreviewPanel.PANEL_ID, panel.webview);
    this._panelRouter.setAstResponseTarget(panel.webview);

    // Set HTML once — React app handles all UI state via messages
    panel.webview.html = this._getHtmlForWebview();

    // Handle messages from webview
    panel.webview.onDidReceiveMessage(
      async (message) => {
        await this._handleMessage(message, panel.webview);
      },
      undefined,
      this._disposables,
    );

    // Listen for active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this._updateComponentFromEditor(editor);
      }),
    );

    // Listen for active editor changes (for platform layer)
    this._disposables.push(setupActiveFileListener(panel.webview));

    // Listen for component changes from other panels (e.g. Left Panel component list)
    const unsubState = this._stateHub.onChange((_state, patch) => {
      if (patch.currentComponent !== undefined) {
        const component = patch.currentComponent;
        if (component && this._currentComponent !== component.path) {
          this._currentComponent = component.path;
          console.log('[HyperCanvas] Component changed via state:', component.path);
          this._updatePreviewUrl();
        }
      }
    });
    this._disposables.push({ dispose: unsubState });

    // Bidirectional code/preview position sync
    this._syncService = new SyncPositionService(
      this._panelRouter.astBridge.astService,
      this._stateHub,
      this._workspaceRoot,
      (elementId) => this.sendGoToVisual(elementId),
      () => this._currentComponent,
    );
    this._syncService.start();
    this._disposables.push(this._syncService);

    // Cleanup on dispose
    panel.onDidDispose(() => {
      for (const d of this._disposables) d.dispose();
      this._disposables = [];
      this._stateHub.unregister(PreviewPanel.PANEL_ID);
      this._syncService = undefined;
      this._panel = undefined;
    }, undefined);

    // Initialize component
    this._initializeComponent();
  }

  /**
   * Handle message from webview
   */
  private async _handleMessage(message: unknown, webview: vscode.Webview): Promise<void> {
    const msg = message as { type?: string; [key: string]: unknown };

    if (!msg.type) return;

    console.log('[HyperCanvas] Message from webview:', msg.type);

    // === Webview lifecycle ===
    if (msg.type === 'webview:ready') {
      // Send initial state
      this._stateHub.sendInit(PreviewPanel.PANEL_ID);
      // Send current devserver status
      webview.postMessage({
        type: 'devserver:statusChanged',
        running: this._devServerRunning,
        url: this._devServerRunning ? this._previewBaseUrl : null,
      });
      // If dev server is running, send current preview URL
      if (this._devServerRunning) {
        this._updatePreviewUrl();
      }
      return;
    }

    // === Preview-specific lifecycle messages (not routed) ===
    if (msg.type === 'previewLoaded') {
      console.log('[HyperCanvas] Preview iframe loaded');
      return;
    }
    if (msg.type === 'runtime:error') {
      const error = (msg as { error?: DevServerRuntimeError | null }).error ?? null;
      this._onRuntimeErrorCallback?.(error);
      return;
    }
    if (msg.type === 'diagnostic:console') {
      const entries = (msg as { entries?: Array<{ level: string; args: string[]; timestamp: number }> }).entries;
      if (entries) {
        this._onConsoleCaptureCallback?.(entries);
      }
      return;
    }
    if (msg.type === 'command:startDevServer') {
      vscode.commands.executeCommand('hypercanvas.startDevServer');
      return;
    }
    if (msg.type === 'previewError') {
      console.error('[HyperCanvas] Preview error:', (msg as { error?: string }).error);
      return;
    }

    // === Keyboard-driven delete (from iframe keyboard handler) ===
    if (msg.type === 'keyboard:delete') {
      const elementIds = msg.elementIds as string[] | undefined;
      const componentPath = this._currentComponent;
      if (!componentPath || !elementIds?.length) return;

      const result = await this._panelRouter.astBridge.astService.deleteElements(componentPath, elementIds);

      if (result.success) {
        this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
          selectedIds: [],
        });
      }
      return;
    }

    // === Context menu actions ===
    if (msg.type === 'contextMenu:goToCode') {
      await this._handleContextMenuGoToCode(msg, webview);
      return;
    }
    if (msg.type === 'contextMenu:duplicate') {
      await this._handleContextMenuDuplicate(msg);
      return;
    }
    if (msg.type === 'contextMenu:delete') {
      await this._handleContextMenuDelete(msg);
      return;
    }
    if (msg.type === 'contextMenu:wrapInDiv') {
      await this._handleContextMenuWrapInDiv(msg);
      return;
    }
    if (msg.type === 'contextMenu:copy') {
      await this._handleContextMenuCopy(msg);
      return;
    }
    if (msg.type === 'contextMenu:paste') {
      await this._handleContextMenuPaste(msg);
      return;
    }
    if (msg.type === 'contextMenu:cut') {
      await this._handleContextMenuCut(msg);
      return;
    }
    if (msg.type === 'contextMenu:selectParent') {
      await this._handleContextMenuSelectParent(msg);
      return;
    }
    if (msg.type === 'contextMenu:selectChild') {
      await this._handleContextMenuSelectChild(msg);
      return;
    }
    if (msg.type === 'contextMenu:copyText') {
      this._handleContextMenuCopyContent(msg, webview, 'text');
      return;
    }
    if (msg.type === 'contextMenu:copyAsHTML') {
      this._handleContextMenuCopyContent(msg, webview, 'html');
      return;
    }
    if (msg.type === 'elementContentResult') {
      this._handleElementContentResult(msg);
      return;
    }

    // Delegate shared platform messages to PanelRouter
    const handled = await this._panelRouter.routeMessage(PreviewPanel.PANEL_ID, msg, webview);

    if (!handled) {
      console.log('[HyperCanvas] Unknown message type:', msg.type);
    }
  }

  // === Context menu handlers ===

  private async _handleContextMenuGoToCode(msg: { [key: string]: unknown }, webview: vscode.Webview): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const loc = await this._panelRouter.astBridge.astService.getElementLocation(componentPath, elementId);

    if (loc) {
      await handleEditorMessage(
        {
          type: 'editor:goToCode',
          path: componentPath,
          line: loc.line,
          column: loc.column + 1,
        },
        webview,
      );
    }
  }

  private async _handleContextMenuDuplicate(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const result = await this._panelRouter.astBridge.astService.duplicateElement(componentPath, elementId);

    if (result.success && result.newId) {
      // Select the new element
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [result.newId],
      });
    }
  }

  private async _handleContextMenuDelete(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const result = await this._panelRouter.astBridge.astService.deleteElements(componentPath, [elementId]);

    if (result.success) {
      // Clear selection
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [],
      });
    }
  }

  private async _handleContextMenuWrapInDiv(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const result = await this._panelRouter.astBridge.astService.wrapElement(componentPath, elementId, 'div');

    if (result.success && result.wrapperId) {
      // Select the wrapper
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [result.wrapperId],
      });
    }
  }

  private async _handleContextMenuCopy(msg: { [key: string]: unknown }): Promise<void> {
    const elementIds = msg.elementIds as string[] | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementIds?.length) return;

    const codes: string[] = [];
    for (const id of elementIds) {
      const code = await this._panelRouter.astBridge.astService.getElementCode(componentPath, id);
      if (code) codes.push(code);
    }

    if (codes.length > 0) {
      await vscode.env.clipboard.writeText(codes.join('\n'));
    }
  }

  private async _handleContextMenuPaste(msg: { [key: string]: unknown }): Promise<void> {
    const targetId = (msg.targetId as string) || null;
    const componentPath = this._currentComponent;
    if (!componentPath) return;

    const tsxCode = await vscode.env.clipboard.readText();
    if (!tsxCode.trim()) return;

    const result = await this._panelRouter.astBridge.astService.pasteElement(componentPath, targetId, tsxCode);

    if (result.success && result.newId) {
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [result.newId],
      });
    }
  }

  private async _handleContextMenuCut(msg: { [key: string]: unknown }): Promise<void> {
    // Copy first
    await this._handleContextMenuCopy(msg);

    // Then delete
    const elementIds = msg.elementIds as string[] | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementIds?.length) return;

    const result = await this._panelRouter.astBridge.astService.deleteElements(componentPath, elementIds);

    if (result.success) {
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [],
      });
    }
  }

  private async _handleContextMenuSelectParent(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const parentId = await this._panelRouter.astBridge.astService.getParentElementId(componentPath, elementId);

    if (parentId) {
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [parentId],
      });
    }
  }

  private async _handleContextMenuSelectChild(msg: { [key: string]: unknown }): Promise<void> {
    const elementId = msg.elementId as string | undefined;
    const componentPath = this._currentComponent;
    if (!componentPath || !elementId) return;

    const childIds = await this._panelRouter.astBridge.astService.getChildElementIds(componentPath, elementId);

    if (childIds.length > 0) {
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: childIds,
      });
    }
  }

  private _handleContextMenuCopyContent(
    msg: { [key: string]: unknown },
    webview: vscode.Webview,
    mode: 'text' | 'html',
  ): void {
    const elementId = msg.elementId as string | undefined;
    if (!elementId) return;

    const requestId = `content-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this._pendingContentRequests.set(requestId, (result) => {
      const value = mode === 'text' ? result.text : result.html;
      if (value) {
        vscode.env.clipboard.writeText(value);
      }
    });

    webview.postMessage({
      type: mode === 'text' ? 'getElementText' : 'getElementHTML',
      elementId,
      requestId,
    });

    // Timeout: clean up if no response in 5 seconds
    setTimeout(() => {
      this._pendingContentRequests.delete(requestId);
    }, 5000);
  }

  private _handleElementContentResult(msg: { [key: string]: unknown }): void {
    const requestId = msg.requestId as string | undefined;
    if (!requestId) return;

    const callback = this._pendingContentRequests.get(requestId);
    if (callback) {
      callback({ text: msg.text as string, html: msg.html as string });
      this._pendingContentRequests.delete(requestId);
    }
  }

  /**
   * Initialize component from active editor
   */
  private _initializeComponent(): void {
    if (vscode.window.activeTextEditor) {
      const component = this._extractComponentFromEditor(vscode.window.activeTextEditor);
      if (component) {
        this._currentComponent = component;
        const name = component.replace(/^.*\//, '').replace(/\.\w+$/, '');
        this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
          currentComponent: { name, path: component },
        });
      }
    }
    this._updatePreviewUrl();
  }

  /**
   * Extract component path from editor (relative to workspace root)
   */
  private _extractComponentFromEditor(editor: vscode.TextEditor): string | undefined {
    const filePath = editor.document.uri.fsPath;

    if (!/\.(tsx|jsx)$/.test(filePath)) {
      return undefined;
    }

    if (filePath.startsWith(this._workspaceRoot)) {
      return filePath.substring(this._workspaceRoot.length + 1);
    }
    return undefined;
  }

  /**
   * Update component from editor
   */
  private _updateComponentFromEditor(editor?: vscode.TextEditor): void {
    // Ignore focus loss (e.g. clicking on preview tab or output panel).
    // Keep the last selected component instead of resetting.
    if (!editor) return;

    const component = this._extractComponentFromEditor(editor);
    if (component && this._currentComponent !== component) {
      this._currentComponent = component;
      console.log('[HyperCanvas] Component from editor:', component);

      // Dispatch to StateHub so Inspector and other panels sync
      const name = component.replace(/^.*\//, '').replace(/\.\w+$/, '');
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        currentComponent: { name, path: component },
      });

      this._updatePreviewUrl();
    }
  }

  /**
   * Update preview URL
   */
  private _updatePreviewUrl(): void {
    // No iframe to update when dev server isn't running
    if (!this._devServerRunning) {
      return;
    }

    const component = this._currentComponent || this._defaultComponent;

    // No component selected — show hint instead of loading bare URL
    if (!component) {
      console.log('[HyperCanvas] No component selected, showing hint');
      this._panel?.webview.postMessage({ type: 'showNoComponentHint' });
      return;
    }

    const baseUrl = `${this._previewBaseUrl}/test-preview`;
    const url = `${baseUrl}?component=${encodeURIComponent(component)}`;

    console.log('[HyperCanvas] Updating URL:', url);

    this._panel?.webview.postMessage({ type: 'updateUrl', url });
  }

  /**
   * Set preview URL (called by dev server when started)
   */
  public setPreviewUrl(url: string): void {
    this._previewBaseUrl = url;
    this._devServerRunning = true;

    // Notify React webview of devserver status change
    this._panel?.webview.postMessage({
      type: 'devserver:statusChanged',
      running: true,
      url,
    });

    this._updatePreviewUrl();
  }

  /**
   * Refresh preview
   */
  public refresh(): void {
    this._panel?.webview.postMessage({ type: 'refresh' });
  }

  /**
   * Set callback for runtime errors from iframe preview
   */
  public onRuntimeError(callback: (error: DevServerRuntimeError | null) => void): void {
    this._onRuntimeErrorCallback = callback;
  }

  /**
   * Set callback for console capture messages from iframe preview
   */
  public onConsoleCapture(
    callback: (entries: Array<{ level: string; args: string[]; timestamp: number }>) => void,
  ): void {
    this._onConsoleCaptureCallback = callback;
  }

  /**
   * Send Go to Visual command to webview
   */
  public sendGoToVisual(elementId: string): void {
    if (this._panel) {
      console.log(`[HyperCanvas] Sending goToVisual: ${elementId}`);
      this._panel.webview.postMessage({
        type: 'goToVisual',
        elementId,
      });
      // Update StateHub so inspector (right panel) and explorer (left panel) receive selection
      this._stateHub.applyUpdate(PreviewPanel.PANEL_ID, {
        selectedIds: [elementId],
      });
    }
  }

  /**
   * Generate HTML for webview — minimal shell, React handles all UI
   */
  private _getHtmlForWebview(): string {
    const webview = this._panel?.webview;
    if (!webview) {
      // Fallback HTML if the webview panel is not available
      return '<!DOCTYPE html><html><body><p>Preview is not available.</p></body></html>';
    }
    const nonce = this._getNonce();

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview-preview-panel.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <!-- unsafe-inline required: React applies styles via style={{}} attributes in PreviewPanelApp -->
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    frame-src *;
    style-src ${webview.cspSource} 'unsafe-inline';
    font-src ${webview.cspSource};
    script-src 'nonce-${nonce}';
    connect-src *;
  ">
  <title>HyperCanvas Preview</title>
  <link rel="stylesheet" href="${cssUri}">
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Generate nonce for CSP
   */
  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
