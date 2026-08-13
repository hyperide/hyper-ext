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

export interface FileEdit {
  filePath: string;
  contentBefore: string;
  contentAfter: string;
}

/** One undoable step — may span multiple files (e.g. cross-file batch delete). */
export interface UndoEntry {
  files: FileEdit[];
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

  private _isInWorkspace(resolved: string): boolean {
    return resolved.startsWith(this._workspaceRoot + path.sep) || resolved === this._workspaceRoot;
  }

  /** Record a single-file mutation. Clears redo stack (new edit branch). */
  recordEdit(absolutePath: string, contentBefore: string, contentAfter: string): void {
    const resolved = path.resolve(absolutePath);
    // Append separator to prevent prefix match on sibling dirs (e.g. /workspace2)
    if (!this._isInWorkspace(resolved)) {
      console.warn(
        `[UndoRedoService] recordEdit REJECTED — path outside workspace: ${resolved} (workspace: ${this._workspaceRoot})`,
      );
      return;
    }

    this._undoStack.push({ files: [{ filePath: resolved, contentBefore, contentAfter }] });
    if (this._undoStack.length > this._maxLength) this._undoStack.shift();
    this._redoStack.length = 0;
    console.log(
      `[UndoRedoService] recordEdit: ${path.basename(resolved)}, undoStack=${this._undoStack.length}, before=${contentBefore.length}B, after=${contentAfter.length}B`,
    );
  }

  /**
   * Record a multi-file mutation as a single atomic undo entry.
   * All files in the batch are restored together on one undo press.
   */
  recordBatchEdit(edits: Array<{ filePath: string; contentBefore: string; contentAfter: string }>): void {
    const files: FileEdit[] = [];
    for (const e of edits) {
      const resolved = path.resolve(e.filePath);
      if (!this._isInWorkspace(resolved)) {
        console.warn(
          `[UndoRedoService] recordBatchEdit REJECTED entry — path outside workspace: ${resolved} (workspace: ${this._workspaceRoot})`,
        );
        continue;
      }
      files.push({ filePath: resolved, contentBefore: e.contentBefore, contentAfter: e.contentAfter });
    }
    if (files.length === 0) return;
    this._undoStack.push({ files });
    if (this._undoStack.length > this._maxLength) this._undoStack.shift();
    this._redoStack.length = 0;
    console.log(
      `[UndoRedoService] recordBatchEdit: ${files.map((f) => path.basename(f.filePath)).join(', ')}, undoStack=${this._undoStack.length}`,
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
        `[UndoRedoService] undo: restoring ${entry.files.length} file(s): ${entry.files.map((f) => path.basename(f.filePath)).join(', ')}`,
      );
      const reverted: Array<{ filePath: string; contentAfter: string }> = [];
      let success = true;
      for (const file of entry.files) {
        const ok = await this._writeContent(file.filePath, file.contentBefore);
        if (!ok) {
          console.warn(`[UndoRedoService] undo: _writeContent returned false for ${path.basename(file.filePath)}`);
          success = false;
          for (const w of reverted) {
            const rollbackOk = await this._writeContent(w.filePath, w.contentAfter);
            if (!rollbackOk)
              console.error(`[UndoRedoService] undo rollback write also failed for ${path.basename(w.filePath)}`);
          }
          break;
        }
        reverted.push({ filePath: file.filePath, contentAfter: file.contentAfter });
      }
      if (success) {
        this._undoStack.pop();
        this._redoStack.push(entry);
        console.log(
          `[UndoRedoService] undo OK — undoStack=${this._undoStack.length}, redoStack=${this._redoStack.length}`,
        );
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
        `[UndoRedoService] redo: replaying ${entry.files.length} file(s): ${entry.files.map((f) => path.basename(f.filePath)).join(', ')}`,
      );
      const replayed: Array<{ filePath: string; contentBefore: string }> = [];
      let success = true;
      for (const file of entry.files) {
        const ok = await this._writeContent(file.filePath, file.contentAfter);
        if (!ok) {
          console.warn(`[UndoRedoService] redo: _writeContent returned false for ${path.basename(file.filePath)}`);
          success = false;
          for (const w of replayed) {
            const rollbackOk = await this._writeContent(w.filePath, w.contentBefore);
            if (!rollbackOk)
              console.error(`[UndoRedoService] redo rollback write also failed for ${path.basename(w.filePath)}`);
          }
          break;
        }
        replayed.push({ filePath: file.filePath, contentBefore: file.contentBefore });
      }
      if (success) {
        this._redoStack.pop();
        this._undoStack.push(entry);
        console.log(
          `[UndoRedoService] redo OK — undoStack=${this._undoStack.length}, redoStack=${this._redoStack.length}`,
        );
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

  /** Write content disk-first, then sync only dirty VS Code documents. */
  private async _writeContent(filePath: string, content: string): Promise<boolean> {
    try {
      const uri = vscode.Uri.file(filePath);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(content, 'utf-8'));

      const openDoc = vscode.workspace.textDocuments.find((doc) => doc.uri.fsPath === uri.fsPath);
      if (openDoc?.isDirty && openDoc.getText() !== content) {
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
