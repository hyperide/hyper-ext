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
import type { DiagnosticHub } from './DiagnosticHub';
import type { StateHub } from './StateHub';
import { ChatHistoryService } from './services/ChatHistoryService';
import type { DevServerManager } from './services/DevServerManager';
import { postToWebviewRawSafe } from './webview-post';
import { TelemetryEvents } from './telemetry/events';

/**
 * Telemetry surface used by the AI chat provider: request counting, host-side
 * event tracking, and the allow-listed webview-origin forward (AI thumbs).
 * Nullable so the provider no-ops cleanly when telemetry is absent.
 */
export interface AIChatTelemetry {
  track(name: string, props?: Record<string, string | number | boolean>): void;
  trackFromWebview(name: string, props?: Record<string, string | number | boolean>): void;
  incAiRequest(): void;
}

export class AIChatPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.aiChatView';

  private _view?: vscode.WebviewView;
  private _aiBridge: AIBridge;
  private _chatHistory: ChatHistoryService;
  private _pendingAIPrompt: string | null = null;
  private _ready = false;
  private _telemetry: AIChatTelemetry | null = null;

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
   * Force the webview to reload its HTML, clearing all local React state.
   * Returns a promise that resolves when the new React app has mounted and
   * sent its `webview:ready` handshake (or after a 1.5s safety timeout).
   */
  public async reset(): Promise<void> {
    // Direct webview access (not the safe poster): reset() writes `.html` to reload, not
    // postMessage, on a view known live at call time. See webview-post.ts for the guard rationale.
    if (!this._view) return;
    const webview = this._view.webview;
    this._ready = false;
    const ready = new Promise<void>((resolve) => {
      const sub = webview.onDidReceiveMessage((msg: { type?: string }) => {
        if (msg?.type === 'webview:ready') {
          sub.dispose();
          resolve();
        }
      });
      setTimeout(() => {
        sub.dispose();
        resolve();
      }, 1_500);
    });
    webview.html = this._getHtmlForWebview(webview);
    await ready;
  }

  async focusAndEnsureReady(): Promise<void> {
    await vscode.commands.executeCommand(`${AIChatPanelProvider.viewType}.focus`);
    setTimeout(() => {
      void this.resetIfNotReady();
    }, 250);
  }

  async resetIfNotReady(): Promise<void> {
    if (!this._view || this._ready) return;
    await this.reset();
  }

  /**
   * Send an AI prompt to the chat webview.
   * Focuses the panel and delivers the prompt.
   */
  sendAIPrompt(prompt: string): void {
    void this.focusAndEnsureReady();

    // _ready is the real gate (don't post before the handshake); _postToWebview already
    // returns false for a missing/disposed view. If the post didn't land, queue it — the
    // rebuilt view replays _pendingAIPrompt once it sends `webview:ready`.
    const posted = this._ready && this._postToWebview({ type: 'ai:openChat', prompt });
    if (!posted) {
      this._pendingAIPrompt = prompt;
    }
  }

  /**
   * Post through the disposed-safe poster (rationale: webview-post.ts / PR #514). Guards
   * the cached-`_view` reuse-after-dispose race for the deferred callers — `sendAIPrompt`,
   * the streaming `ai:chat` events, and the `secrets.onDidChange` key-status push.
   */
  private _postToWebview(message: unknown): boolean {
    return postToWebviewRawSafe(this._view?.webview, message, () => this._clearDisposedView());
  }

  /**
   * Drop the stale ref so the next `resolveWebviewView` rebuilds. Resource teardown
   * (AIBridge dispose, secrets subscription) stays with `onDidDispose`; this is idempotent.
   */
  private _clearDisposedView(): void {
    this._view = undefined;
    this._ready = false;
  }

  /**
   * Connect to DevServerManager for fallback log access
   */
  setDevServerManager(manager: DevServerManager): void {
    this._aiBridge.setDevServerManager(manager);
  }

  /**
   * Connect to DiagnosticHub for get_diagnostics tool
   */
  setDiagnosticHub(hub: DiagnosticHub): void {
    this._aiBridge.setDiagnosticHub(hub);
  }

  /**
   * Telemetry: forward the sink to the AIBridge (ai.requestStarted/Completed) and
   * keep a reference so the webview's telemetry:event messages (allow-listed AI
   * thumbs) route to the host, and AI-request counts feed session totals.
   */
  setTelemetry(telemetry: AIChatTelemetry): void {
    this._telemetry = telemetry;
    this._aiBridge.setTelemetry(telemetry);
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this._ready = false;

    // Telemetry: the AI chat view became visible.
    this._telemetry?.track(TelemetryEvents.panelOpened, { panel: 'aiChat' });

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this._handleMessage(message);
    });

    // Send initial API key status and listen for changes. onDidChange fires LATER (a
    // secret edit), by which point the view may be disposed — _sendKeyStatus posts
    // through the safe poster, so a disposed view is a no-op, not a worker-poisoning throw.
    this._refreshKeyStatus();
    const secretsSub = this._context.secrets.onDidChange(() => {
      this._refreshKeyStatus();
    });

    webviewView.onDidDispose(() => {
      this._telemetry?.track(TelemetryEvents.panelClosed, { panel: 'aiChat' });
      // Share the view-state clear with _clearDisposedView so a future lifecycle field
      // can't be cleared in one path and forgotten in the other; then extra teardown.
      this._clearDisposedView();
      this._aiBridge.dispose();
      secretsSub.dispose();
    });
  }

  private async _handleMessage(message: { type?: string; [key: string]: unknown }): Promise<void> {
    if (!message.type) return;

    switch (message.type) {
      case 'webview:ready': {
        this._ready = true;
        await this._sendKeyStatus();
        this._flushPendingPrompt();
        return;
      }

      case 'ai:chat': {
        const requestId = message.requestId as string;
        const messages = message.messages as Array<{ role: 'user' | 'assistant'; content: string }>;
        this._telemetry?.incAiRequest();
        // The stream runs for many ticks; the view can be disposed mid-stream — each
        // event posts through the safe poster so a late event can't poison the worker.
        this._aiBridge.handleChat(requestId, messages, (event) => {
        void this._postToWebview(event);
      });
        return;
      }

      case 'ai:abort': {
        const requestId = message.requestId as string;
        this._aiBridge.abort(requestId);
        return;
      }

      // Telemetry: allow-listed webview-origin event (AI 👍/👎 thumb). Gating +
      // PII scrubbing happen host-side in trackFromWebview.
      //
      // TODO(telemetry) HYP-840: wire ai.suggestionShown/Accepted/Rejected once an
      // apply/reject signal exists. The event NAMES are defined in events.ts but
      // are intentionally NOT in WEBVIEW_ALLOWED_EVENTS yet: the AI chat currently
      // renders code edits as tool RESULTS (no per-suggestion accept/reject UI and
      // no ai:applyEdit/ai:rejectEdit message). When that UI lands it should post
      // `telemetry:event` with name=ai.suggestion* and props={provider,model}
      // ONLY (no content) and the names get added to the allow-list — this same
      // handler then forwards them unchanged.
      case 'telemetry:event': {
        const name = message.name as string;
        const props = message.props as Record<string, string | number | boolean> | undefined;
        if (typeof name === 'string') this._telemetry?.trackFromWebview(name, props);
        return;
      }

      // --- Chat history messages ---

      case 'chat:list': {
        const chats = await this._chatHistory.listChats();
        this._postToWebview({ type: 'chat:list', chats });
        return;
      }

      case 'chat:create': {
        const title = message.title as string | undefined;
        const session = await this._chatHistory.createChat(title);
        this._postToWebview({ type: 'chat:created', session });
        return;
      }

      case 'chat:load': {
        const chatId = message.chatId as string;
        const data = await this._chatHistory.loadChat(chatId);
        this._postToWebview({ type: 'chat:loaded', chatId, data });
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
        this._postToWebview({ type: 'chat:deleted', chatId });
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
        this._refreshKeyStatus();
        return;
      }
    }
  }

  private _flushPendingPrompt(): void {
    if (!this._pendingAIPrompt) return;
    // Clear the pending slot ONLY if the post actually landed — if the view was disposed
    // in the window between `webview:ready` and this flush, keep the prompt queued so the
    // next rebuilt view replays it instead of dropping it permanently.
    if (this._postToWebview({ type: 'ai:openChat', prompt: this._pendingAIPrompt })) {
      this._pendingAIPrompt = null;
    }
  }

  /**
   * Fire-and-forget _sendKeyStatus with rejection logging. _sendKeyStatus awaits
   * `secrets.get`, which can reject; a bare `void` would swallow that signal entirely.
   */
  private _refreshKeyStatus(): void {
    this._sendKeyStatus().catch((e) => console.error('[AIChat] key status refresh failed:', e));
  }

  private async _sendKeyStatus(): Promise<void> {
    const secretKey = await this._context.secrets.get('hypercanvas.ai.apiKey');
    const settingsKey = vscode.workspace.getConfiguration('hypercanvas.ai').get<string>('apiKey');
    const provider = vscode.workspace.getConfiguration('hypercanvas.ai').get<string>('provider');
    // Key must exist AND be non-empty. Also require provider to be configured.
    const key = secretKey || settingsKey;
    const hasApiKey = !!(key && key.trim().length > 3 && provider);
    this._postToWebview({ type: 'ai:keyStatus', hasApiKey });
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
