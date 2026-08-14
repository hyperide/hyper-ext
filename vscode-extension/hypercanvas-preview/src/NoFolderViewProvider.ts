/**
 * Empty-state webview view provider for HyperIDE's side/panel views when no
 * workspace folder is open (HYP-1237: "Hyper Explorer shows infinite loading
 * spinner when no folder is open").
 *
 * Bug this exists to prevent: `activate()` used to `return` BEFORE calling
 * `vscode.window.registerWebviewViewProvider(...)` for ANY of HyperIDE's
 * views whenever `getWorkspaceRoot()` was null (e.g. a single file opened
 * with no folder). The views are still declared statically in package.json's
 * `contributes.views`, so VS Code renders the activity-bar container and the
 * view slot regardless — but since no provider ever resolves it, the view
 * sits in its initial "loading" state forever: a permanent spinner badge on
 * the activity-bar icon and a blank panel body, with no error and no
 * timeout. Registering this provider for every HyperIDE view ID as soon as
 * activation detects "no folder" makes each view resolve immediately with a
 * real (if minimal) empty state instead of spinning forever.
 */

import * as vscode from 'vscode';

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

/**
 * Minimal HTML-escape for text interpolated into the empty-state markup.
 * Every caller today passes a hard-coded constant, but this is exported and
 * unit-tested as a general string→HTML builder — escaping here means a
 * future caller can't accidentally break the DOM (or worse) by passing
 * untrusted/localized text containing `<`, `&`, or a quote.
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Fixed copy for the empty state, matching what Alex specified verbatim and
// mirroring VS Code's own native Explorer empty-state convention: a heading,
// an explanatory paragraph that inline-links a *secondary* action ("add a
// folder") distinct from the primary "Open Folder" button. The two actions
// are deliberately different commands, not two labels for the same thing —
// see the two `case` branches below for why.
export const NO_FOLDER_HEADING = 'No folder opened';
export const NO_FOLDER_BODY_BEFORE_LINK = 'Opening folder will close all current editors. To keep them open, ';
export const NO_FOLDER_BODY_LINK_TEXT = 'add a folder';
export const NO_FOLDER_BODY_AFTER_LINK = ' instead.';

/**
 * Builds the "no folder opened" empty-state HTML. Exported standalone (no
 * `vscode.Webview` dependency — the copy is a set of compile-time constants,
 * no webview resource URIs are needed) so it can be unit-tested as a plain
 * string-producing function without mocking a live webview.
 */
export function buildNoFolderEmptyStateHtml(): string {
  const nonce = getNonce();
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';" />
<style nonce="${nonce}">
  body {
    font-family: var(--vscode-font-family, sans-serif);
    color: var(--vscode-foreground);
    padding: 16px 12px;
    text-align: center;
  }
  h2 { font-size: 13px; font-weight: 600; margin: 0 0 8px; }
  p { opacity: 0.85; margin: 0 0 14px; line-height: 1.4; }
  a {
    color: var(--vscode-textLink-foreground);
    cursor: pointer;
    text-decoration: none;
  }
  a:hover { color: var(--vscode-textLink-activeForeground); text-decoration: underline; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    padding: 6px 14px;
    border-radius: 2px;
    cursor: pointer;
    font-family: inherit;
  }
  button:hover { background: var(--vscode-button-hoverBackground); }
</style>
</head>
<body>
  <h2>${escapeHtml(NO_FOLDER_HEADING)}</h2>
  <p>${escapeHtml(NO_FOLDER_BODY_BEFORE_LINK)}<a id="hyperide-add-folder" href="#" role="button">${escapeHtml(NO_FOLDER_BODY_LINK_TEXT)}</a>${escapeHtml(NO_FOLDER_BODY_AFTER_LINK)}</p>
  <button id="hyperide-open-folder">Open Folder</button>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('hyperide-open-folder').addEventListener('click', () => {
      vscode.postMessage({ type: 'openFolder' });
    });
    document.getElementById('hyperide-add-folder').addEventListener('click', (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'addFolder' });
    });
  </script>
</body>
</html>`;
}

export class NoFolderViewProvider implements vscode.WebviewViewProvider {
  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = buildNoFolderEmptyStateHtml();
    webviewView.webview.onDidReceiveMessage((message: { type?: string }) => {
      switch (message?.type) {
        case 'openFolder':
          // Not `vscode.openFolder` — that command targets a SPECIFIC uri and
          // is meant to be called WITH one. `workbench.action.files.openFolder`
          // is the "File: Open Folder…" command that reliably shows the
          // native folder picker, matching the button's own label. This
          // REPLACES the current window's workspace, closing all open editors.
          void vscode.commands.executeCommand('workbench.action.files.openFolder');
          break;
        case 'addFolder':
          // `workbench.action.addRootFolder` ADDS a folder to a (possibly
          // empty) multi-root workspace WITHOUT closing any currently open
          // editors — the entire reason the copy above contrasts it against
          // "Open Folder". Do not collapse this into the openFolder branch.
          void vscode.commands.executeCommand('workbench.action.addRootFolder');
          break;
        default:
          break;
      }
    });
  }
}
