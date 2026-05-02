/**
 * Undo/Redo Service — content-based snapshots.
 *
 * Each mutation records the file content before and after the change.
 * Undo writes the "before" content, redo writes the "after" content —
 * completely independent of VS Code's native undo/redo stack.
 *
 * Why not native VS Code undo?
 * doc.save() after WorkspaceEdit clears the native redo stack.
 * Since we must save to trigger HMR, native redo is always broken.
 * Content snapshots sidestep this entirely.
 */

import path from 'node:path';
import * as vscode from 'vscode';

export interface UndoEntry {
  filePath: string;
  contentBefore: string;
  contentAfter: string;
}

export class UndoRedoService {
  private _undoStack: UndoEntry[] = [];
  private _redoStack: UndoEntry[] = [];
  private _maxLength = 50;
  private _inProgress = false;

  constructor(private readonly _workspaceRoot: string) {}

  /** Record a mutation with file content before and after. Clears redo stack (new edit branch). */
  recordEdit(absolutePath: string, contentBefore: string, contentAfter: string): void {
    const resolved = path.resolve(absolutePath);
    // Append separator to prevent prefix match on sibling dirs (e.g. /workspace2)
    if (!resolved.startsWith(this._workspaceRoot + path.sep) && resolved !== this._workspaceRoot) return;

    this._undoStack.push({ filePath: resolved, contentBefore, contentAfter });
    if (this._undoStack.length > this._maxLength) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  async undo(panel: vscode.WebviewPanel): Promise<boolean> {
    if (this._inProgress || !this.canUndo()) return false;
    this._inProgress = true;
    try {
      const entry = this._undoStack[this._undoStack.length - 1];
      const success = await this._writeContent(entry.filePath, entry.contentBefore);
      if (success) {
        this._undoStack.pop();
        this._redoStack.push(entry);
      }
      panel.reveal();
      return success;
    } finally {
      this._inProgress = false;
    }
  }

  async redo(panel: vscode.WebviewPanel): Promise<boolean> {
    if (this._inProgress || !this.canRedo()) return false;
    this._inProgress = true;
    try {
      const entry = this._redoStack[this._redoStack.length - 1];
      const success = await this._writeContent(entry.filePath, entry.contentAfter);
      if (success) {
        this._redoStack.pop();
        this._undoStack.push(entry);
      }
      panel.reveal();
      return success;
    } finally {
      this._inProgress = false;
    }
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  canRedo(): boolean {
    return this._redoStack.length > 0;
  }

  /**
   * Write content directly to file via WorkspaceEdit + save.
   * This creates a native VS Code undo entry as a side effect, but we don't
   * rely on it — our own stack manages undo/redo state.
   */
  private async _writeContent(filePath: string, content: string): Promise<boolean> {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);

      // Skip if content is already identical (e.g. double-undo to same state)
      if (doc.getText() === content) return true;

      const edit = new vscode.WorkspaceEdit();
      const fullRange = new vscode.Range(doc.positionAt(0), doc.positionAt(doc.getText().length));
      edit.replace(uri, fullRange, content);
      const applied = await vscode.workspace.applyEdit(edit);

      if (applied && doc.isDirty) {
        const saved = await doc.save();
        if (!saved) {
          // Fallback: write directly to disk for HMR
          await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
        }
      } else if (!applied) {
        await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));
      }

      return true;
    } catch (error) {
      console.error('[UndoRedoService] write failed:', error);
      return false;
    }
  }
}
