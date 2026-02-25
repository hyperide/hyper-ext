/**
 * Logs & AI Chat Panel Provider
 *
 * Manages a separate webview panel that shows dev server logs
 * and an AI chat for auto-fixing build errors.
 */

import * as vscode from 'vscode';
import { DevServerManager, type LogEntry } from './services/DevServerManager';
import { AIBridge } from './bridges/AIBridge';
import { getProjectInfo } from './services/ProjectDetector';

export class LogsAndChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.logsAndChatView';

  private _view?: vscode.WebviewView;
  private _devServerManager: DevServerManager | null = null;
  private _aiBridge: AIBridge;
  private _pendingLogs: LogEntry[] = [];
  private _pendingHasErrors = false;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    private readonly _workspaceRoot: string,
    context: vscode.ExtensionContext,
  ) {
    this._aiBridge = new AIBridge(_workspaceRoot, context);
  }

  /**
   * Send an AI prompt to the chat webview (e.g. from style sync error fallback).
   * If the webview isn't visible yet, opens the view first.
   */
  sendAIPrompt(prompt: string): void {
    // Focus the Logs & AI panel so user sees the chat
    vscode.commands.executeCommand('hypercanvas.logsAndChatView.focus');

    if (this._view) {
      this._view.webview.postMessage({ type: 'ai:openChat', prompt });
    } else {
      // Webview not yet resolved — queue the prompt for when it loads
      this._pendingAIPrompt = prompt;
    }
  }

  private _pendingAIPrompt: string | null = null;

  /**
   * Connect to DevServerManager for log streaming
   */
  setDevServerManager(manager: DevServerManager): void {
    this._devServerManager = manager;

    // Pass dev server manager to AI bridge for check_build_status tool
    this._aiBridge.setDevServerManager(manager);

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
      localResourceRoots: [
        vscode.Uri.joinPath(this._extensionUri, 'out'),
      ],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message, webviewView.webview);
    });

    // Flush any pending AI prompt that arrived before the webview was ready
    if (this._pendingAIPrompt) {
      webviewView.webview.postMessage({ type: 'ai:openChat', prompt: this._pendingAIPrompt });
      this._pendingAIPrompt = null;
    }

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._aiBridge.dispose();
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

    // AI chat messages
    if (message.type === 'ai:chat') {
      const requestId = message.requestId as string;
      const messages = message.messages as Array<{ role: 'user' | 'assistant'; content: string }>;

      this._aiBridge.handleChat(requestId, messages, (event) => {
        webview.postMessage(event);
      });
      return;
    }

    if (message.type === 'ai:abort') {
      const requestId = message.requestId as string;
      this._aiBridge.abort(requestId);
      return;
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
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'out', 'webview.js'),
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
  <title>Logs & AI Chat</title>
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
