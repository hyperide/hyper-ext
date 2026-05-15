/**
 * Undo/Redo Service — content-based snapshots.
 *
 * Each mutation records the file content before and after the change.
 * Undo writes the "before" content, redo writes the "after" content —
 * completely independent of VS Code's native undo/redo stack.
 *
 * Why not native VS Code undo?
 * AST writes go through disk-first file operations so Vite HMR sees changes
 * reliably. Content snapshots sidestep VS Code's editor undo stack entirely.
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
  // Tracks active _withUndoTracking() calls. While > 0, redo is blocked:
  // a new edit is being recorded and recordEdit() hasn't cleared the redo
  // stack yet — allowing redo to fire in that window would be a no-op at
  // best, or replay a stale entry at worst.
  private _trackingCount = 0;

  constructor(private readonly _workspaceRoot: string) {}

  /** Record a mutation with file content before and after. Clears redo stack (new edit branch). */
  recordEdit(absolutePath: string, contentBefore: string, contentAfter: string): void {
    const resolved = path.resolve(absolutePath);
    // Append separator to prevent prefix match on sibling dirs (e.g. /workspace2)
    if (!resolved.startsWith(this._workspaceRoot + path.sep) && resolved !== this._workspaceRoot) {
      console.warn(
        `[UndoRedoService] recordEdit REJECTED — path outside workspace: ${resolved} (workspace: ${this._workspaceRoot})`,
      );
      return;
    }

    this._undoStack.push({ filePath: resolved, contentBefore, contentAfter });
    if (this._undoStack.length > this._maxLength) this._undoStack.shift();
    this._redoStack.length = 0;
    console.log(
      `[UndoRedoService] recordEdit: ${path.basename(resolved)}, undoStack=${this._undoStack.length}, before=${contentBefore.length}B, after=${contentAfter.length}B`,
    );
  }

  async undo(panel: vscode.WebviewPanel): Promise<boolean> {
    console.log(
      `[UndoRedoService] undo() called — canUndo=${this.canUndo()}, inProgress=${this._inProgress}, undoStack=${this._undoStack.length}, redoStack=${this._redoStack.length}`,
    );
    if (this._inProgress || !this.canUndo()) return false;
    this._inProgress = true;
    try {
      const entry = this._undoStack[this._undoStack.length - 1];
      console.log(
        `[UndoRedoService] undo: writing contentBefore (${entry.contentBefore.length}B) to ${path.basename(entry.filePath)}`,
      );
      const success = await this._writeContent(entry.filePath, entry.contentBefore);
      if (success) {
        this._undoStack.pop();
        this._redoStack.push(entry);
        console.log(
          `[UndoRedoService] undo OK — undoStack=${this._undoStack.length}, redoStack=${this._redoStack.length}`,
        );
      } else {
        console.warn('[UndoRedoService] undo: _writeContent returned false');
      }
      panel.reveal();
      return success;
    } finally {
      this._inProgress = false;
    }
  }

  async redo(panel: vscode.WebviewPanel): Promise<boolean> {
    console.log(
      `[UndoRedoService] redo() called — canRedo=${this.canRedo()}, inProgress=${this._inProgress}, undoStack=${this._undoStack.length}, redoStack=${this._redoStack.length}`,
    );
    if (this._inProgress || !this.canRedo()) return false;
    this._inProgress = true;
    try {
      const entry = this._redoStack[this._redoStack.length - 1];
      console.log(
        `[UndoRedoService] redo: writing contentAfter (${entry.contentAfter.length}B) to ${path.basename(entry.filePath)}`,
      );
      const success = await this._writeContent(entry.filePath, entry.contentAfter);
      if (success) {
        this._redoStack.pop();
        this._undoStack.push(entry);
        console.log(
          `[UndoRedoService] redo OK — undoStack=${this._undoStack.length}, redoStack=${this._redoStack.length}`,
        );
      } else {
        console.warn('[UndoRedoService] redo: _writeContent returned false');
      }
      panel.reveal();
      return success;
    } finally {
      this._inProgress = false;
    }
  }

  beginTracking(): void {
    this._trackingCount++;
    // Eagerly clear redo when a new edit begins. Even if the write fails and
    // recordEdit() is skipped, the user's intent was a new action — redo history
    // should not survive.
    this._redoStack.length = 0;
  }

  endTracking(): void {
    if (this._trackingCount > 0) this._trackingCount--;
  }

  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  canRedo(): boolean {
    return this._redoStack.length > 0 && this._trackingCount === 0;
  }

  /** Write content disk-first, then sync an already-open VS Code document. */
  private async _writeContent(filePath: string, content: string): Promise<boolean> {
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

      const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === uri.fsPath);
      if (openDoc && openDoc.getText() !== content) {
        const edit = new vscode.WorkspaceEdit();
        const fullRange = new vscode.Range(openDoc.positionAt(0), openDoc.positionAt(openDoc.getText().length));
        edit.replace(uri, fullRange, content);

        const synced = await Promise.resolve(vscode.workspace.applyEdit(edit)).catch((error: unknown) => {
          console.warn('[UndoRedoService] open document sync failed:', error);
          return false;
        });
        if (!synced) {
          console.warn(`[UndoRedoService] open document sync was not applied for ${path.basename(filePath)}`);
        }
      }

      return true;
    } catch (error) {
      console.error('[UndoRedoService] write failed:', error);
      return false;
    }
  }
}
