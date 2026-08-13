/**
 * Left Panel Provider — Activity Bar sidebar with Components list and Elements Tree
 *
 * Renders a webview in the Activity Bar that shows:
 * - Component/page list (via ComponentService through PanelRouter)
 * - Elements tree (synced via SharedEditorState through StateHub)
 */

import * as vscode from 'vscode';
import type { PanelRouter } from './PanelRouter';
import type { StateHub } from './StateHub';
import { TelemetryEvents } from './telemetry/events';
import type { TelemetrySink } from './telemetry/TelemetryService';

export class LeftPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.explorerView';

  private _view?: vscode.WebviewView;
  // Multiple consumers observe Explorer visibility: the Inspector (component quick-list fallback)
  // and the PreviewPanel aggregator (both-panels-hidden gate for the canvas picker, #92). Keep a
  // list so a second subscriber does not clobber the first.
  private _visibilityListeners: Array<(visible: boolean) => void> = [];
  private _telemetry: TelemetrySink | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _stateHub: StateHub,
    private readonly _panelRouter: PanelRouter,
  ) {}

  /** Inject the telemetry sink so explorer-origin interactions can be tracked. */
  public setTelemetry(sink: TelemetrySink): void {
    this._telemetry = sink;
  }

  get visible(): boolean {
    return this._view?.visible ?? false;
  }

  /**
   * Force the webview to reload its HTML, clearing all local React state.
   * Returns a promise that resolves when the new React app has mounted and
   * sent its `webview:ready` handshake (or after a 1.5s safety timeout).
   *
   * Primarily for E2E tests between specs — otherwise the tree expand/collapse
   * state, selection, scroll position etc. persist across tests because the
   * sidebar webview has retainContextWhenHidden semantics. Waiting for ready
   * also prevents race conditions where the next test's clicks land on a
   * still-reloading sidebar that can't respond.
   */
  public async reset(): Promise<void> {
    if (!this._view) return;
    const webview = this._view.webview;
    const ready = new Promise<void>((resolve) => {
      const sub = webview.onDidReceiveMessage((msg: { type?: string }) => {
        if (msg?.type === 'webview:ready') {
          sub.dispose();
          resolve();
        }
      });
      // Safety timeout so a stuck webview can't wedge the fixture.
      setTimeout(() => {
        sub.dispose();
        resolve();
      }, 1_500);
    });
    webview.html = this._getHtml(webview);
    await ready;
  }

  onVisibilityChange(cb: (visible: boolean) => void): void {
    this._visibilityListeners.push(cb);
  }

  private _emitVisibility(visible: boolean): void {
    for (const listener of this._visibilityListeners) listener(visible);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // Telemetry: the explorer view became visible.
    this._telemetry?.track(TelemetryEvents.panelOpened, { panel: 'explorer' });

    // Register with StateHub for cross-panel sync
    this._stateHub.register(LeftPanelProvider.viewType, webviewView.webview);

    // Route messages through PanelRouter
    webviewView.webview.onDidReceiveMessage(async (message) => {
      const msg = message as { type?: string };
      if (msg.type === 'webview:ready') {
        this._stateHub.sendInit(LeftPanelProvider.viewType);
        return;
      }
      // Explorer-origin telemetry: attributed here (not in PanelRouter, which is
      // shared with the preview/inspector webviews) so explorer interactions are
      // not mislabeled. SAFE props only — no paths, no query text (see helper).
      this._emitExplorerTelemetry(message);
      await this._panelRouter.routeMessage(message, webviewView.webview);
    });

    webviewView.onDidChangeVisibility(() => {
      this._emitVisibility(webviewView.visible);
    });

    // Notify initial visibility (onDidChangeVisibility won't fire for the initial state)
    this._emitVisibility(webviewView.visible);

    webviewView.onDidDispose(() => {
      this._telemetry?.track(TelemetryEvents.panelClosed, { panel: 'explorer' });
      this._stateHub.unregister(LeftPanelProvider.viewType);
      this._view = undefined;
    });
  }

  /**
   * Map an explorer-origin webview message to a SAFE `explorer.*` event. Sends
   * ONLY counts/booleans — never the component path, element nodeRef, or any
   * search query (those are PII / source locations). Item create/rename/delete/
   * move are forward-declared in the taxonomy but have no explorer message yet.
   */
  private _emitExplorerTelemetry(message: unknown): void {
    if (!this._telemetry) return;
    const msg = message as { type?: string; patch?: Record<string, unknown> };
    if (msg.type === 'iframe:scrollToElement') {
      // Tree row clicked → canvas scrolls to that element.
      this._telemetry.track(TelemetryEvents.explorerItemOpened);
      return;
    }
    if (msg.type === 'state:update' && msg.patch && typeof msg.patch === 'object') {
      const patch = msg.patch;
      if ('currentComponent' in patch && patch.currentComponent) {
        this._telemetry.track(TelemetryEvents.explorerNavigated);
      }
      if (Array.isArray(patch.selectedIds)) {
        this._telemetry.track(TelemetryEvents.explorerItemSelected, { count: patch.selectedIds.length });
      }
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview-left.js'));
    const cssUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.css'));
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    style-src ${webview.cspSource} 'unsafe-inline';
    script-src 'nonce-${nonce}';
    font-src ${webview.cspSource};
  ">
  <link rel="stylesheet" href="${cssUri}">
  <title>Explorer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private _getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
