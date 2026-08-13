/**
 * Editor Bridge - handles editor operations from webview
 *
 * Receives platform messages from webview and translates them
 * to VS Code editor commands.
 */

import * as vscode from 'vscode';

/**
 * Platform message types (subset relevant to editor operations)
 */
export type EditorMessage =
  | { type: 'editor:openFile'; path: string; line?: number; column?: number }
  | { type: 'editor:goToCode'; path: string; line: number; column: number }
  | { type: 'editor:getActiveFile'; requestId: string };

/**
 * Handle editor-related messages from webview
 */
export async function handleEditorMessage(message: EditorMessage, webview: vscode.Webview): Promise<void> {
  console.log('[EditorBridge] Received message:', message.type);

  switch (message.type) {
    case 'editor:openFile':
      await openFile(message.path, message.line, message.column);
      break;

    case 'editor:goToCode':
      await goToCode(message.path, message.line, message.column, {
        preserveFocus: false,
      });
      break;

    case 'editor:getActiveFile':
      sendActiveFile(webview);
      break;
  }
}

/**
 * Open a file in the editor, optionally at a specific line/column
 */
async function openFile(filePath: string, line?: number, column?: number): Promise<void> {
  try {
    // Resolve path relative to workspace
    const uri = resolveFilePath(filePath);

    const doc = await vscode.workspace.openTextDocument(uri);
    const targetColumn = getNonPreviewColumn();
    const editor = await vscode.window.showTextDocument(doc, targetColumn);

    if (line !== undefined) {
      const position = new vscode.Position(
        line - 1, // VS Code uses 0-indexed lines
        (column ?? 1) - 1,
      );
      editor.selection = new vscode.Selection(position, position);
      editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
    }

    console.log(`[EditorBridge] Opened file: ${filePath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  } catch (error) {
    console.error('[EditorBridge] Failed to open file:', error);
    vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
  }
}

/**
 * Navigate to a specific code location (for "Go to Code" feature)
 */
export async function goToCode(
  filePath: string,
  line: number,
  column: number,
  options?: { preserveFocus?: boolean },
): Promise<void> {
  try {
    const uri = resolveFilePath(filePath);
    const position = new vscode.Position(line - 1, column - 1);

    const doc = await vscode.workspace.openTextDocument(uri);
    const targetColumn = getNonPreviewColumn();
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: targetColumn,
      preserveFocus: options?.preserveFocus ?? true,
    });

    editor.selection = new vscode.Selection(position, position);
    editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);

    console.log(`[EditorBridge] Navigated to ${filePath}:${line}:${column}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  } catch (error) {
    console.error('[EditorBridge] Failed to navigate:', error);
    vscode.window.showErrorMessage(`Failed to open file: ${filePath}`);
  }
}

/**
 * Send current active file info to webview
 */
function sendActiveFile(webview: vscode.Webview): void {
  const editor = vscode.window.activeTextEditor;
  const path = editor ? getRelativePath(editor.document.uri.fsPath) : null;

  webview.postMessage({
    type: 'editor:activeFileChanged',
    path,
  });
}

/**
 * Set up listener to notify webview of active file changes
 */
export function setupActiveFileListener(webview: vscode.Webview): vscode.Disposable {
  return vscode.window.onDidChangeActiveTextEditor((editor) => {
    const path = editor ? getRelativePath(editor.document.uri.fsPath) : null;

    webview.postMessage({
      type: 'editor:activeFileChanged',
      path,
    });

    console.log(`[EditorBridge] Active file changed: ${path}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  });
}

/**
 * Find a view column that does NOT contain the HyperCanvas preview webview.
 * When preview is in a split, this ensures files open on the opposite side.
 */
function getNonPreviewColumn(): vscode.ViewColumn {
  const previewViewType = 'hypercanvas.previewPanel';

  for (const group of vscode.window.tabGroups.all) {
    const hasPreview = group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(previewViewType),
    );
    if (!hasPreview) {
      return group.viewColumn;
    }
  }

  // Fallback: use column One (code is typically on the left)
  return vscode.ViewColumn.One;
}

/**
 * Resolve file path to VS Code Uri
 * Handles absolute paths and paths relative to workspace root
 */
function resolveFilePath(filePath: string): vscode.Uri {
  // If path is absolute, use as-is
  if (filePath.startsWith('/')) {
    return vscode.Uri.file(filePath);
  }

  // Relative path — resolve against workspace root
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    return vscode.Uri.file(`${workspaceRoot}/${filePath}`);
  }

  // Fallback: let VS Code try to resolve it
  return vscode.Uri.file(filePath);
}

/**
 * Get relative path from absolute path
 * Strips workspace root prefix to get relative path
 */
function getRelativePath(absolutePath: string): string {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot && absolutePath.startsWith(workspaceRoot)) {
    return absolutePath.slice(workspaceRoot.length + 1);
  }
  return absolutePath;
}
