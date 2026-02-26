/**
 * Logs Panel Provider
 *
 * Manages a webview panel that shows dev server logs.
 * AI chat has been moved to AIChatPanelProvider (secondary sidebar).
 */

import * as vscode from 'vscode';
import type { DevServerManager, LogEntry } from './services/DevServerManager';
import { getProjectInfo } from './services/ProjectDetector';

export class LogsPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.logsView';

  private _view?: vscode.WebviewView;
  private _devServerManager: DevServerManager | null = null;
  private _pendingLogs: LogEntry[] = [];
  private _pendingHasErrors = false;
  private _onOpenAIChat?: (prompt: string) => void;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _workspaceRoot: string,
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
   * Connect to DevServerManager for log streaming
   */
  setDevServerManager(manager: DevServerManager): void {
    this._devServerManager = manager;

    manager.onLogsUpdate((logs, hasErrors) => {
      this._pendingLogs = logs;
      this._pendingHasErrors = hasErrors;
      this._pushLogsToWebview(logs, hasErrors);
    });

    // Forward runtime errors to webview
    manager.onRuntimeErrorChange((error) => {
      this._view?.webview.postMessage({
        type: 'devserver:runtimeError',
        error,
      });
    });
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

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message, webviewView.webview);
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
    });
  }

  private async _handleMessage(
    message: { type?: string; [key: string]: unknown },
    webview: vscode.Webview,
  ): Promise<void> {
    if (!message.type) return;

    // Dev server log messages
    if (message.type === 'devserver:requestLogs') {
      const logs = this._devServerManager?.getLogs() ?? this._pendingLogs;
      const hasErrors = this._devServerManager?.hasErrors ?? this._pendingHasErrors;
      webview.postMessage({
        type: 'devserver:logs',
        logs,
        hasErrors,
      });

      // Always send current runtime error state (including null to clear banner)
      webview.postMessage({
        type: 'devserver:runtimeError',
        error: this._devServerManager?.runtimeError ?? null,
      });

      // Also send project info
      try {
        const info = await getProjectInfo(this._workspaceRoot);
        webview.postMessage({
          type: 'devserver:projectInfo',
          projectInfo: {
            framework: info.type,
            path: this._workspaceRoot,
          },
        });
      } catch {
        // Project info is optional
      }
      return;
    }

    if (message.type === 'devserver:clearLogs') {
      this._devServerManager?.clearLogs();
      return;
    }

    // Forward ai:openChat to AIChatPanelProvider via callback
    if (message.type === 'ai:openChat') {
      const prompt = message.prompt as string | undefined;
      if (this._onOpenAIChat && prompt) {
        this._onOpenAIChat(prompt);
      }
    }
  }

  private _pushLogsToWebview(logs: LogEntry[], hasErrors: boolean): void {
    this._view?.webview.postMessage({
      type: 'devserver:logs',
      logs,
      hasErrors,
    });
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
  <title>Dev Server Logs</title>
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
