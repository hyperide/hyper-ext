/**
 * AI Chat Panel Provider
 *
 * Manages a webview panel in the secondary sidebar for AI chat.
 * Owns the AIBridge instance for streaming AI responses.
 * Owns the ChatHistoryService for persistence.
 */

import * as vscode from 'vscode';
import type { DisplayMessage } from '../../../shared/ai-chat-display';
import { AIBridge } from './bridges/AIBridge';
import type { StateHub } from './StateHub';
import { ChatHistoryService } from './services/ChatHistoryService';
import type { DevServerManager } from './services/DevServerManager';

export class AIChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.aiChatView';

  private _view?: vscode.WebviewView;
  private _aiBridge: AIBridge;
  private _chatHistory: ChatHistoryService;
  private _pendingAIPrompt: string | null = null;

  constructor(
    private readonly _extensionUri: vscode.Uri,
    workspaceRoot: string,
    private readonly _context: vscode.ExtensionContext,
    stateHub: StateHub,
  ) {
    this._aiBridge = new AIBridge(workspaceRoot, _context);
    this._aiBridge.setStateHub(stateHub);
    this._chatHistory = new ChatHistoryService(_context.globalStorageUri.fsPath);
  }

  /**
   * Send an AI prompt to the chat webview.
   * Focuses the panel and delivers the prompt.
   */
  sendAIPrompt(prompt: string): void {
    vscode.commands.executeCommand('hypercanvas.aiChatView.focus');

    if (this._view) {
      this._view.webview.postMessage({ type: 'ai:openChat', prompt });
    } else {
      this._pendingAIPrompt = prompt;
    }
  }

  /**
   * Connect to DevServerManager for check_build_status tool
   */
  setDevServerManager(manager: DevServerManager): void {
    this._aiBridge.setDevServerManager(manager);
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

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message, webviewView.webview);
    });

    // Flush any pending AI prompt that arrived before the webview was ready
    if (this._pendingAIPrompt) {
      webviewView.webview.postMessage({ type: 'ai:openChat', prompt: this._pendingAIPrompt });
      this._pendingAIPrompt = null;
    }

    // Send initial API key status and listen for changes
    this._sendKeyStatus(webviewView.webview);
    const secretsSub = this._context.secrets.onDidChange(() => {
      this._sendKeyStatus(webviewView.webview);
    });

    webviewView.onDidDispose(() => {
      this._view = undefined;
      this._aiBridge.dispose();
      secretsSub.dispose();
    });
  }

  private async _handleMessage(
    message: { type?: string; [key: string]: unknown },
    webview: vscode.Webview,
  ): Promise<void> {
    if (!message.type) return;

    switch (message.type) {
      case 'ai:chat': {
        const requestId = message.requestId as string;
        const messages = message.messages as Array<{ role: 'user' | 'assistant'; content: string }>;
        this._aiBridge.handleChat(requestId, messages, (event) => {
          webview.postMessage(event);
        });
        return;
      }

      case 'ai:abort': {
        const requestId = message.requestId as string;
        this._aiBridge.abort(requestId);
        return;
      }

      // --- Chat history messages ---

      case 'chat:list': {
        const chats = await this._chatHistory.listChats();
        webview.postMessage({ type: 'chat:list', chats });
        return;
      }

      case 'chat:create': {
        const title = message.title as string | undefined;
        const session = await this._chatHistory.createChat(title);
        webview.postMessage({ type: 'chat:created', session });
        return;
      }

      case 'chat:load': {
        const chatId = message.chatId as string;
        const data = await this._chatHistory.loadChat(chatId);
        webview.postMessage({ type: 'chat:loaded', chatId, data });
        return;
      }

      case 'chat:save': {
        const chatId = message.chatId as string;
        const msgs = message.messages as DisplayMessage[];
        await this._chatHistory.saveMessages(chatId, msgs);
        return;
      }

      case 'chat:updateTitle': {
        const chatId = message.chatId as string;
        const title = message.title as string;
        await this._chatHistory.updateTitle(chatId, title);
        return;
      }

      case 'chat:delete': {
        const chatId = message.chatId as string;
        await this._chatHistory.deleteChat(chatId);
        webview.postMessage({ type: 'chat:deleted', chatId });
        return;
      }

      case 'ai:askUserResponse': {
        const toolUseId = message.toolUseId as string;
        const response = message.response as string;
        this._aiBridge.provideUserResponse(toolUseId, response);
        return;
      }

      case 'command:execute': {
        const command = message.command as string;
        const args = message.args as string[] | undefined;
        vscode.commands.executeCommand(command, ...(args ?? []));
        return;
      }

      case 'ai:checkKey': {
        this._sendKeyStatus(webview);
        return;
      }
    }
  }

  private async _sendKeyStatus(webview: vscode.Webview): Promise<void> {
    const key = await this._context.secrets.get('hypercanvas.ai.apiKey');
    webview.postMessage({ type: 'ai:keyStatus', hasApiKey: !!key });
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview-ai-chat.js'));
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
  <title>AI Chat</title>
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
