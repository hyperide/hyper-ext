/**
 * Right Panel Provider — Inspector sidebar with style editing sections
 *
 * Renders a webview in the Secondary Side Bar that shows:
 * - Element type and tag info
 * - Style editing sections (Position, Margin, Layout, Fill, Stroke, Effects, etc.)
 * - Synced via SharedEditorState through StateHub
 */

import * as vscode from 'vscode';
import type { StateHub } from './StateHub';
import type { PanelRouter } from './PanelRouter';

export class RightPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.inspectorView';

  private _view?: vscode.WebviewView;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _stateHub: StateHub,
    private readonly _panelRouter: PanelRouter,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'out'),
      ],
    };

    webviewView.webview.html = this._getHtml(webviewView.webview);

    // Register with StateHub for cross-panel sync
    this._stateHub.register(RightPanelProvider.viewType, webviewView.webview);

    // Route messages through PanelRouter
    webviewView.webview.onDidReceiveMessage(async (message) => {
      const msg = message as { type?: string };
      if (msg.type === 'webview:ready') {
        this._stateHub.sendInit(RightPanelProvider.viewType);
        return;
      }
      await this._panelRouter.routeMessage(
        RightPanelProvider.viewType,
        message,
        webviewView.webview,
      );
    });

    webviewView.onDidDispose(() => {
      this._stateHub.unregister(RightPanelProvider.viewType);
      this._view = undefined;
    });
  }

  private _getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview-right.js'),
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.css'),
    );
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
  <title>Inspector</title>
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
