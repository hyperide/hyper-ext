/**
 * Right Panel Provider — Inspector sidebar with style editing sections
 *
 * Renders a webview in the Secondary Side Bar that shows:
 * - Element type and tag info
 * - Style editing sections (Position, Margin, Layout, Fill, Stroke, Effects, etc.)
 * - Component list when Explorer is hidden and no component is open
 * - Synced via SharedEditorState through StateHub
 */

import * as vscode from 'vscode';
import type { LeftPanelProvider } from './LeftPanelProvider';
import type { PanelRouter } from './PanelRouter';
import { toPickerGroups } from './PreviewPanel';
import type { StateHub } from './StateHub';
import { TelemetryEvents } from './telemetry/events';
import type { TelemetrySink } from './telemetry/TelemetryService';
import type { ScanResult } from './services/ComponentService';
import type { DesignToken } from './services/DesignTokensService';
import type { ProjectCapabilities } from './types';
import { postToWebviewRawSafe } from './webview-post';

export class RightPanelProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.inspectorView';

  private _view?: vscode.WebviewView;
  private _ready = false;
  private _telemetry: TelemetrySink | null = null;
  /** Last reported visibility — dedupes repeated same-state visibility events. */
  private _lastVisible: boolean | null = null;
  // Observers of THIS panel's (Inspector) visibility — the PreviewPanel aggregator needs it to
  // decide when BOTH side panels are hidden and the canvas component picker should show (#92).
  private _visibilityListeners: Array<(visible: boolean) => void> = [];

  get visible(): boolean {
    return this._view?.visible ?? false;
  }

  onVisibilityChange(cb: (visible: boolean) => void): void {
    this._visibilityListeners.push(cb);
  }

  private _emitVisibility(visible: boolean): void {
    for (const listener of this._visibilityListeners) listener(visible);
  }

  /** Inject the telemetry sink so inspector open/close can be tracked. */
  public setTelemetry(sink: TelemetrySink): void {
    this._telemetry = sink;
  }

  constructor(
  private readonly _extensionUri: vscode.Uri,
  private readonly _stateHub: StateHub,
  private readonly _panelRouter: PanelRouter,
  private readonly _leftPanelProvider?: LeftPanelProvider,
  private readonly _getComponentGroups?: () => Promise<ScanResult>,
) {}

  private _capabilities: ProjectCapabilities | null = null;
  private _designTokens: DesignToken[] = [];

  /**
   * Notify the webview about project capabilities (readonly mode, CSS system).
   * Pass null to clear capabilities on workspace switch.
   * Caches capabilities so late-resolving webviews receive them on `webview:ready`.
   */
  public notifyCapabilities(capabilities: ProjectCapabilities | null): void {
    this._capabilities = capabilities;
    this._postToWebview({ type: 'projectCapabilities', capabilities: capabilities ?? null });
  }

  /**
   * Notify the webview about design tokens scanned from the project.
   * Caches the result so a late-resolving webview receives it on `webview:ready`.
   */
  public notifyDesignTokens(tokens: DesignToken[]): void {
    this._designTokens = tokens;
    this._postToWebview({ type: 'inspector:designTokens', tokens });
  }

  /**
   * Post through the disposed-safe poster (rationale: webview-post.ts / PR #514). Guards
   * the cached-`_view` reuse-after-dispose race for the deferred callers — `notifyCapabilities`
   * (workspace switch), the visibility callback, and the post-`await` `_sendComponentGroups`.
   */
  private _postToWebview(message: unknown): boolean {
    return postToWebviewRawSafe(this._view?.webview, message, () => this._clearDisposedView());
  }

  /**
   * Drop the stale ref so the next `resolveWebviewView` rebuilds. Resource teardown
   * (StateHub unregister, focus-guard clear) stays with `onDidDispose`; this is idempotent.
   */
  private _clearDisposedView(): void {
    this._view = undefined;
    this._ready = false;
    this._lastVisible = null;
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
    // Webview reloads — old inputs lose focus without firing focusout, clear the guard
    void vscode.commands.executeCommand('setContext', 'hypercanvas.rightPanelInputFocused', false);
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
    webview.html = this._getHtml(webview);
    await ready;
  }

  async focusAndEnsureReady(): Promise<void> {
    await vscode.commands.executeCommand(`${RightPanelProvider.viewType}.focus`);
    setTimeout(() => {
      void this.resetIfNotReady();
    }, 250);
  }

  async resetIfNotReady(): Promise<void> {
    if (!this._view || this._ready) return;
    await this.reset();
  }

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;
    this._ready = false;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this._extensionUri, 'out')],
    };

    // Register with StateHub for cross-panel sync
    this._stateHub.register(RightPanelProvider.viewType, webviewView.webview);

    // Telemetry: the inspector panel was opened (became visible). Emit the initial
    // state, then on every show/hide. Deduped so a no-op visibility event (same
    // boolean) doesn't double-count. SAFE: only an `open` boolean — never content.
    this._emitToggled(webviewView.visible);
    webviewView.onDidChangeVisibility(() => {
      this._emitToggled(webviewView.visible);
    });

    // Track explorer visibility changes → forward to webview. This callback fires
    // LATER (on a visibility toggle), by which point the view may be disposed — route
    // through the safe poster so a disposed view is a no-op, not a worker-poisoning throw.
    this._leftPanelProvider?.onVisibilityChange((visible) => {
      this._postToWebview({ type: 'inspector:explorerVisible', visible });
      // When the Explorer collapses, the Inspector's ComponentQuickList becomes the active
      // UI for picking a component. Component groups are otherwise pushed only once on
      // `webview:ready`; refresh here so the list is fresh+complete (and recovers from a
      // cold/empty scan at mount) exactly when it is about to be shown.
      if (!visible) this._sendComponentGroups();
    });

    // Broadcast THIS panel's visibility to the PreviewPanel aggregator (#92). onDidChangeVisibility
    // does not fire for the initial state, so emit it once here too.
    webviewView.onDidChangeVisibility(() => {
      this._emitVisibility(webviewView.visible);
    });
    this._emitVisibility(webviewView.visible);

    // Route messages through PanelRouter
    webviewView.webview.onDidReceiveMessage(async (message) => {
      const msg = message as { type?: string };

      if (msg.type === 'webview:ready') {
        this._ready = true;
        this._stateHub.sendInit(RightPanelProvider.viewType);
        // Send initial explorer visibility + component groups + capabilities + design tokens
        this._sendExplorerState();
        this._sendComponentGroups();
        this._postToWebview({ type: 'projectCapabilities', capabilities: this._capabilities ?? null });
        this._postToWebview({ type: 'inspector:designTokens', tokens: this._designTokens });
        return;
      }

      if (msg.type === 'component:open') {
        const { name, path } = message as { name: string; path: string };
        this._stateHub.applyUpdate({ currentComponent: { name, path } });
        return;
      }

      if (msg.type === 'component:listGroups') {
        this._sendComponentGroups();
        return;
      }

      await this._panelRouter.routeMessage(message, webviewView.webview);
    });

    webviewView.onDidDispose(() => {
      // Share the view-state clear with _clearDisposedView so a future lifecycle field
      // can't be cleared in one path and forgotten in the other; then extra teardown.
      this._clearDisposedView();
      this._stateHub.unregister(RightPanelProvider.viewType);
      // Clear input-focus guard so canvas keybindings aren't permanently blocked
      void vscode.commands.executeCommand('setContext', 'hypercanvas.rightPanelInputFocused', false);
    });

    webviewView.webview.html = this._getHtml(webviewView.webview);
  }

  /**
   * Emit `inspector.toggled` with an `open` boolean — deduped against the last
   * reported state so a repeated same-state visibility callback doesn't double
   * count. PII-safe: the only prop is a boolean.
   */
  private _emitToggled(visible: boolean): void {
    if (this._lastVisible === visible) return;
    this._lastVisible = visible;
    this._telemetry?.track(TelemetryEvents.inspectorToggled, { open: visible });
  }

  private _sendExplorerState(): void {
    const visible = this._leftPanelProvider?.visible ?? true;
    this._postToWebview({ type: 'inspector:explorerVisible', visible });
  }

  private async _sendComponentGroups(): Promise<void> {
    if (!this._getComponentGroups) return;
    try {
      const result = await this._getComponentGroups();
      // The view can be disposed across the await above — post through the safe poster.
      // `toPickerGroups` folds monorepo sub-project page groups into the flat `pageGroups`
      // (the scanner leaves flat `pageGroups: []` for monorepos to avoid double-render in the
      // SaaS PagesSection). The Inspector quick-list is a single flat list like the canvas
      // picker, so it must fold them too — otherwise monorepo pages stay unreachable here.
      // Shared with the canvas picker (PreviewPanel) so both lists agree (HYP-772/#535).
      this._postToWebview({
        type: 'inspector:componentGroups',
        ...toPickerGroups(result.data),
      });
    } catch (e) {
      console.error('[RightPanel] Failed to load component groups:', e);
    }
  }

  private _getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'out', 'webview-right.js'));
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
