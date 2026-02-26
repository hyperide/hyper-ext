/**
 * HyperCanvas Code Server Extension
 *
 * Lightweight extension for code-server (Docker IDE).
 * Provides iframe preview of HyperCanvas SaaS, SSE-based Go to Code,
 * Go to Visual via API, and file-save tracking for undo/redo.
 */

import { readFileSync } from 'node:fs';
import * as vscode from 'vscode';
import { PreviewViewProvider } from './PreviewViewProvider';

// Store provider reference at module level for goToVisual command
let previewProvider: PreviewViewProvider | null = null;

// SSE connection state
let sseAbortController: AbortController | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('[HyperCanvas Code Server] Extension activating...');

  // Get project ID from environment variable (set by IDE container)
  const projectId = process.env.IDE_PROJECT_ID || 'unknown';
  const origin = process.env.HYPERCANVAS_ORIGIN || 'http://localhost:8080';

  // Register the webview view provider
  previewProvider = new PreviewViewProvider(projectId, origin);

  // Set up SSE subscription for commands from canvas (Go to Code)
  setupCommandSSE(context, projectId, origin);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PreviewViewProvider.viewType, previewProvider, {
      webviewOptions: {
        retainContextWhenHidden: true,
      },
    }),
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.openPreview', () => {
      vscode.commands.executeCommand('hypercanvas.previewView.focus');
    }),
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.refreshPreview', () => {
      previewProvider?.refresh();
    }),
  );

  // Go to Visual command — navigate from code to canvas
  context.subscriptions.push(
    vscode.commands.registerCommand('hypercanvas.goToVisual', async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) {
        vscode.window.showWarningMessage('No active editor');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      if (!/\.(tsx|jsx)$/.test(filePath)) {
        vscode.window.showWarningMessage('Go to Visual only works in TSX/JSX files');
        return;
      }

      const position = editor.selection.active;
      const line = position.line + 1; // API expects 1-indexed
      const column = position.character + 1;

      // Convert /app/src/... to relative path
      const relativePath = filePath.replace(/^\/app\//, '');

      try {
        const response = await fetch(`${origin}/api/projects/${projectId}/ide/go-to-visual`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filePath: relativePath, line, column }),
        });

        if (!response.ok) {
          const data = (await response.json()) as { error?: string };
          vscode.window.showWarningMessage(data.error || 'No element found at cursor position');
          return;
        }

        const result = (await response.json()) as {
          element?: { elementType: string };
        };
        vscode.window.showInformationMessage(`Selected: ${result.element?.elementType || 'element'}`);
      } catch (error) {
        console.error('[HyperCanvas Code Server] Go to Visual error:', error);
        vscode.window.showErrorMessage('Failed to navigate to visual editor');
      }
    }),
  );

  // Status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(eye) Preview';
  statusBarItem.tooltip = 'Open HyperCanvas Preview';
  statusBarItem.command = 'hypercanvas.openPreview';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // Track file saves for undo/redo snapshots (code-server extension -> HyperCanvas server)
  // Auth tokens are injected as env vars when the code-server pod starts
  let accessToken = process.env.HYPERCANVAS_AUTH_TOKEN || '';
  const refreshToken = process.env.HYPERCANVAS_REFRESH_TOKEN || '';

  // Cache pre-save content so the first IDE save in a session is undoable
  const preSaveContentCache = new Map<string, string>();

  context.subscriptions.push(
    vscode.workspace.onWillSaveTextDocument((event) => {
      try {
        const content = readFileSync(event.document.uri.fsPath, 'utf-8');
        preSaveContentCache.set(event.document.uri.fsPath, content);
      } catch {
        // New file or unreadable — no pre-save content
      }
    }),
  );

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!accessToken) return;

      const preContent = preSaveContentCache.get(doc.uri.fsPath);
      preSaveContentCache.delete(doc.uri.fsPath);

      const payload = {
        path: doc.uri.fsPath,
        source: 'code-server' as const,
        ...(preContent !== undefined && { preContent }),
      };

      try {
        let res = await fetch(`${origin}/api/code-editor/saved`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify(payload),
        });

        // Auto-refresh on 401 (access token expired, TTL=15min)
        if (res.status === 401 && refreshToken) {
          const refreshRes = await fetch(`${origin}/api/auth/refresh`, {
            method: 'POST',
            headers: { Cookie: `refresh_token=${refreshToken}` },
          });
          if (refreshRes.ok) {
            const data = (await refreshRes.json()) as { accessToken: string };
            accessToken = data.accessToken;
            res = await fetch(`${origin}/api/code-editor/saved`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${accessToken}`,
              },
              body: JSON.stringify(payload),
            });
          }
        }

        if (!res.ok) {
          console.warn(`[HyperCanvas Code Server] code-editor/saved failed: ${res.status}`); // nosemgrep: unsafe-formatstring
        }
      } catch {
        // Server not reachable — ignore silently
      }
    }),
  );

  console.log('[HyperCanvas Code Server] Extension activated successfully');
}

export function deactivate() {
  if (sseAbortController) {
    sseAbortController.abort();
    sseAbortController = null;
  }
  console.log('[HyperCanvas Code Server] Extension deactivated');
}

/**
 * SSE subscription for commands from canvas.
 * Used for Go to Code navigation — canvas sends gotoPosition commands via SSE.
 */
function setupCommandSSE(context: vscode.ExtensionContext, projectId: string, origin: string) {
  const url = `${origin}/api/projects/${projectId}/ide/commands/stream`;

  const connect = async () => {
    if (sseAbortController) {
      sseAbortController.abort();
    }
    sseAbortController = new AbortController();

    try {
      const response = await fetch(url, {
        signal: sseAbortController.signal,
        headers: {
          Accept: 'text/event-stream',
        },
      });

      if (!response.ok) {
        console.error(
          `[HyperCanvas Code Server] SSE connection failed: ${response.status}`, // nosemgrep: unsafe-formatstring
        );
        setTimeout(connect, 5000);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        console.error('[HyperCanvas Code Server] SSE: No response body');
        setTimeout(connect, 5000);
        return;
      }

      console.log('[HyperCanvas Code Server] SSE connected for commands');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('[HyperCanvas Code Server] SSE stream ended, reconnecting...');
          setTimeout(connect, 1000);
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Parse SSE messages from buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.slice(6).trim();
            if (jsonStr) {
              try {
                const data = JSON.parse(jsonStr) as {
                  type?: string;
                  filePath?: string;
                  line?: number;
                  column?: number;
                };

                if (data.type === 'gotoPosition' && data.filePath && data.line && data.column) {
                  await handleGotoPosition(data.filePath, data.line, data.column);
                }
              } catch (e) {
                console.error('[HyperCanvas Code Server] SSE parse error:', e);
              }
            }
          }
        }
      }
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }
      console.error('[HyperCanvas Code Server] SSE error:', error);
      setTimeout(connect, 5000);
    }
  };

  connect();

  context.subscriptions.push({
    dispose: () => {
      if (sseAbortController) {
        sseAbortController.abort();
        sseAbortController = null;
      }
    },
  });
}

/** Navigate to a specific position in a file (Go to Code from canvas). */
async function handleGotoPosition(filePath: string, line: number, column: number) {
  try {
    const uri = vscode.Uri.file(filePath);
    const position = new vscode.Position(line - 1, column - 1);

    const doc = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(doc);
    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
  } catch (error) {
    console.error('[HyperCanvas Code Server] Failed to navigate:', error);
    vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
  }
}
