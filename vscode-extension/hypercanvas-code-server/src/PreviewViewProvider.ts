import * as vscode from 'vscode';
import { buildPreviewUrl, extractComponentPath } from './utils';

export class PreviewViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'hypercanvas.previewView';

  private _view?: vscode.WebviewView;
  private _currentComponent?: string;
  private _defaultComponent?: string;
  private _disposables: vscode.Disposable[] = [];

  constructor(
    private readonly _projectId: string,
    private readonly _origin: string,
    private readonly _getAccessToken: () => string,
  ) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ) {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [],
    };

    // Initial render with loading state
    this._updateWebviewContent();

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((message) => {
      if (message.type === 'previewLoaded') {
        console.log('[HyperCanvas Preview] Preview iframe loaded');
      } else if (message.type === 'previewError') {
        console.error('[HyperCanvas Preview] Preview error:', message.error);
      }
    });

    // Listen for active editor changes
    this._disposables.push(
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        this._updateComponentFromEditor(editor);
      }),
    );

    // Cleanup on dispose
    webviewView.onDidDispose(() => {
      for (const d of this._disposables) {
        d.dispose();
      }
      this._disposables = [];
    });

    // Fetch default component and set initial state
    this._initializeComponent();
  }

  private async _initializeComponent() {
    // First check active editor
    if (vscode.window.activeTextEditor) {
      const component = this._extractComponentFromEditor(vscode.window.activeTextEditor);
      if (component) {
        this._currentComponent = component;
        this._updatePreviewUrl();
        return;
      }
    }

    // Fallback: fetch default component from API
    await this._fetchDefaultComponent();
    this._updatePreviewUrl();
  }

  private async _fetchDefaultComponent() {
    if (this._projectId === 'unknown') {
      console.log('[HyperCanvas Preview] No project ID, skipping component fetch');
      return;
    }

    try {
      const token = this._getAccessToken();
      const response = await fetch(`${this._origin}/api/get-components?projectId=${this._projectId}`, {
        headers: {
          Accept: 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
        },
      });

      if (!response.ok) {
        console.error('[HyperCanvas Preview] Failed to fetch components:', response.status);
        return;
      }

      const data = (await response.json()) as {
        atomGroups?: Array<{ components?: Array<{ path: string }> }>;
        compositeGroups?: Array<{ components?: Array<{ path: string }> }>;
        pageGroups?: Array<{ components?: Array<{ path: string }> }>;
      };

      // Get first component from atoms, composites, or pages
      const firstGroup = data.atomGroups?.[0] || data.compositeGroups?.[0] || data.pageGroups?.[0];
      if (firstGroup?.components?.[0]) {
        this._defaultComponent = firstGroup.components[0].path;
        console.log('[HyperCanvas Preview] Default component:', this._defaultComponent);
      }
    } catch (error) {
      console.error('[HyperCanvas Preview] Failed to fetch components:', error);
    }
  }

  private _extractComponentFromEditor(editor: vscode.TextEditor): string | undefined {
    return extractComponentPath(editor.document.uri.fsPath);
  }

  private _updateComponentFromEditor(editor?: vscode.TextEditor) {
    if (editor) {
      const component = this._extractComponentFromEditor(editor);
      if (component) {
        if (this._currentComponent !== component) {
          this._currentComponent = component;
          console.log('[HyperCanvas Preview] Component from editor:', component);
          this._updatePreviewUrl();
        }
        return;
      }
    }

    // If no valid component from editor, use default
    if (this._currentComponent) {
      this._currentComponent = undefined;
      this._updatePreviewUrl();
    }
  }

  private _updatePreviewUrl() {
    const component = this._currentComponent || this._defaultComponent;
    const url = buildPreviewUrl(this._origin, this._projectId, component);

    if (this._view) {
      this._view.webview.postMessage({ type: 'updateUrl', url });
    }
  }

  public refresh() {
    if (this._view) {
      this._view.webview.postMessage({ type: 'refresh' });
    }
  }

  /** Send Go to Visual command to webview, which forwards it to parent window */
  public sendGoToVisual(filePath: string, line: number, column: number) {
    if (this._view) {
      this._view.webview.postMessage({
        type: 'goToVisual',
        filePath,
        line,
        column,
      });
    } else {
      console.warn('[HyperCanvas Preview] No view available for goToVisual');
    }
  }

  private _updateWebviewContent() {
    if (!this._view) {
      return;
    }

    // Build initial preview URL (may not have component yet)
    const component = this._currentComponent || this._defaultComponent;
    const previewUrl = buildPreviewUrl(this._origin, this._projectId, component);

    this._view.webview.html = this._getHtmlForWebview(previewUrl);
  }

  private _getHtmlForWebview(previewUrl: string): string {
    const nonce = this._getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="
    default-src 'none';
    frame-src *;
    style-src 'unsafe-inline';
    script-src 'nonce-${nonce}';
    connect-src *;
  ">
  <title>HyperIDE Preview</title>
  <style>
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }
    .preview-frame {
      border: none;
      width: 100%;
      height: 100%;
      background: #fff;
    }
  </style>
</head>
<body>
  <iframe
    id="previewFrame"
    class="preview-frame"
    src="${previewUrl}"
    sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
  ></iframe>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('previewFrame');

    function refreshPreview() {
      const currentSrc = frame.src;
      frame.src = '';
      setTimeout(() => {
        frame.src = currentSrc;
      }, 50);
    }

    window.addEventListener('message', event => {
      const message = event.data;
      if (message.type === 'refresh') {
        refreshPreview();
      } else if (message.type === 'updateUrl') {
        frame.src = message.url;
      } else if (message.type === 'goToVisual') {
        if (frame && frame.contentWindow) {
          frame.contentWindow.postMessage({
            type: 'hypercanvas:goToVisual',
            filePath: message.filePath,
            line: message.line,
            column: message.column
          }, '*');
        }
      }
    });

    frame.addEventListener('load', () => {
      vscode.postMessage({ type: 'previewLoaded' });
    });

    frame.addEventListener('error', (e) => {
      vscode.postMessage({ type: 'previewError', error: e.message });
    });
  </script>
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
