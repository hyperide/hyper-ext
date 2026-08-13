/**
 * Editor Bridge - handles editor operations from webview
 *
 * Receives platform messages from webview and translates them
 * to VS Code editor commands. When the preview panel is the only editor,
 * files open in a left split via a registered callback that moves the
 * preview to the right group first.
 */

import { stripViteFsPrefix } from '@shared/element-tracing/path-normalization';
import * as vscode from 'vscode';
import { isBundleArtifactPath } from './services/bundle-artifact-path';

export { isBundleArtifactPath };

/**
 * Callback to move the preview panel to ViewColumn.Two.
 * Registered by PreviewPanel on setup so EditorBridge can force a split
 * when no code-only editor group exists.
 */
let movePreviewToRightFn: (() => void) | null = null;

export function setMovePreviewToRight(fn: (() => void) | null): void {
  movePreviewToRightFn = fn;
}

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
  if (isBundleArtifactPath(filePath)) {
    console.log(`[EditorBridge] Skipping bundle artifact: ${filePath}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    return;
  }
  try {
    // Resolve path relative to workspace
    const uri = resolveFilePath(filePath);

    const doc = await vscode.workspace.openTextDocument(uri);
    const targetColumn = getNonPreviewColumn();
    const editor = await vscode.window.showTextDocument(doc, {
      viewColumn: targetColumn,
      preserveFocus: false,
      preview: true,
    });

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
  if (isBundleArtifactPath(filePath)) {
    console.log(`[EditorBridge] Skipping bundle artifact: ${filePath}:${line}:${column}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    return;
  }
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
 * When preview is the only editor, moves it to the right and returns the left column
 * so VS Code creates a split automatically.
 */
function getNonPreviewColumn(): vscode.ViewColumn {
  const previewViewType = 'hypercanvas.previewPanel';

  // Collect all non-preview groups, prefer ViewColumn.One (leftmost)
  let bestColumn: vscode.ViewColumn | undefined;
  for (const group of vscode.window.tabGroups.all) {
    const hasPreview = group.tabs.some(
      (tab) => tab.input instanceof vscode.TabInputWebview && tab.input.viewType.includes(previewViewType),
    );
    if (!hasPreview) {
      if (group.viewColumn === vscode.ViewColumn.One) {
        return vscode.ViewColumn.One;
      }
      if (bestColumn === undefined) {
        bestColumn = group.viewColumn;
      }
    }
  }
  if (bestColumn !== undefined) {
    return bestColumn;
  }

  // Every group contains the preview (or preview is the only tab).
  // Move preview to the right so the file opens in a left split.
  if (movePreviewToRightFn) {
    movePreviewToRightFn();
  }
  return vscode.ViewColumn.One;
}

/**
 * Resolve file path to VS Code Uri
 * Handles absolute paths and paths relative to workspace root.
 *
 * Past bugs: HYP-268 — Turbopack source maps produce file:// URLs that are normalized
 * to paths without a leading '/' (e.g. 'Users/ultra/.../page.tsx' instead of
 * '/Users/ultra/.../page.tsx'). Detect these stripped absolute paths by checking if
 * '/' + filePath starts with the workspace root — then it is an absolute path inside
 * the workspace with the leading slash dropped.
 */
function resolveFilePath(filePath: string): vscode.Uri {
  // Vite serves files OUTSIDE the project root (a cross-package monorepo library,
  // HYP-443) via `/@fs/<absolute>`, and that URL leaks into the React fiber path
  // the iframe reports for navigation. Strip it to recover the real absolute path
  // (handles both `/@fs/<abs>` and the slash-dropped `@fs/<abs>`).
  const fsStripped = stripViteFsPrefix(filePath);
  if (fsStripped !== filePath) {
    return vscode.Uri.file(fsStripped);
  }

  // Absolute path — use as-is
  if (filePath.startsWith('/')) {
    return vscode.Uri.file(filePath);
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) {
    // Turbopack normalizes 'file:///abs/path' → 'abs/path' (strips leading '/').
    // Check if restoring the slash produces a path that lives inside the workspace.
    // This is conservative: only fires when the full workspace path is a prefix of
    // the stripped path, avoiding false positives for legitimate relative paths.
    if (`/${filePath}`.startsWith(`${workspaceRoot}/`)) {
      return vscode.Uri.file(`/${filePath}`);
    }

    // Relative path — resolve against workspace root
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
