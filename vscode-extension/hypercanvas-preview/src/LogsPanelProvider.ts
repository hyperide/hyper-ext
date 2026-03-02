/**
 * Logs Panel Provider
 *
 * Manages a webview panel that shows diagnostic logs.
 * Registers with DiagnosticHub for diagnostic:* messages.
 * Routes ai:openChat to AIChatPanelProvider via callback.
 */

import * as vscode from 'vscode';
import type { DiagnosticHub } from './DiagnosticHub';

export class LogsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.logsView';

  private _diagnosticHub: DiagnosticHub | null = null;
  private _onOpenAIChat?: (prompt: string) => void;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    _workspaceRoot: string,
    _context: vscode.ExtensionContext,
  ) {}

  /**
   * Set callback for ai:openChat messages from the logs webview.
   * Extension host wires this to AIChatPanelProvider.
   */
  setOnOpenAIChat(callback: (prompt: string) => void): void {
    this._onOpenAIChat = callback;
  }

  /**
   * Connect to DiagnosticHub for centralized diagnostic broadcasts.
   */
  setDiagnosticHub(hub: DiagnosticHub): void {
    this._diagnosticHub = hub;
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

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Register with DiagnosticHub for broadcasts
    if (this._diagnosticHub) {
      this._diagnosticHub.register(LogsPanelProvider.viewType, webviewView.webview);
    }

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    });

    webviewView.onDidDispose(() => {
      if (this._diagnosticHub) {
        this._diagnosticHub.unregister(LogsPanelProvider.viewType);
      }
      this._view = undefined;
    });
  }

  private async _handleMessage(message: { type?: string; [key: string]: unknown }): Promise<void> {
    if (!message.type) return;

    // Webview requests full diagnostic state (on mount)
    if (message.type === 'diagnostic:requestState') {
      this._diagnosticHub?.sendState(LogsPanelProvider.viewType);
      return;
    }

    // Webview requests clear
    if (message.type === 'diagnostic:clear') {
      this._diagnosticHub?.clear();
      return;
    }

    // Forward ai:openChat to AIChatPanelProvider via callback
    if (message.type === 'ai:openChat') {
      const prompt = message.prompt as string | undefined;
      if (this._onOpenAIChat && prompt) {
        this._onOpenAIChat(prompt);
      }
      return;
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'));
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
  <title>Diagnostics</title>
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
