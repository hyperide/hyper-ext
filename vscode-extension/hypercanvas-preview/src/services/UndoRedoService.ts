/**
 * Undo/Redo Service — native VS Code undo via tab-switch.
 *
 * Maintains a path stack of mutated files. On undo/redo, focuses the target
 * document, executes the VS Code undo/redo command, saves, and returns focus
 * to the preview panel.
 *
 * Works because VSCodeFileIO.writeFile() uses vscode.WorkspaceEdit,
 * which natively populates per-document undo history.
 */

import path from 'node:path';
import * as vscode from 'vscode';

export class UndoRedoService {
  private _undoStack: string[] = [];
  private _redoStack: string[] = [];
  private _maxLength = 50;
  private _inProgress = false;

  constructor(private readonly _workspaceRoot: string) {}

  /** Record a mutation. Clears redo stack (new edit branch). */
  recordEdit(absolutePath: string): void {
    const resolved = path.resolve(absolutePath);
    // Append separator to prevent prefix match on sibling dirs (e.g. /workspace2)
    if (!resolved.startsWith(this._workspaceRoot + path.sep) && resolved !== this._workspaceRoot) return;

    this._undoStack.push(resolved);
    if (this._undoStack.length > this._maxLength) this._undoStack.shift();
    this._redoStack.length = 0;
  }

  async undo(panel: vscode.WebviewPanel): Promise<boolean> {
    if (this._inProgress || !this.canUndo()) return false;
    this._inProgress = true;
    try {
      const filePath = this._undoStack[this._undoStack.length - 1];
      const success = await this._executeUndoRedo(filePath, 'undo', panel);
      if (success) {
        this._undoStack.pop();
        this._redoStack.push(filePath);
      }
      return success;
    } finally {
      this._inProgress = false;
    }
  }

  async redo(panel: vscode.WebviewPanel): Promise<boolean> {
    if (this._inProgress || !this.canRedo()) return false;
    this._inProgress = true;
    try {
      const filePath = this._redoStack[this._redoStack.length - 1];
      const success = await this._executeUndoRedo(filePath, 'redo', panel);
      if (success) {
        this._redoStack.pop();
        this._undoStack.push(filePath);
      }
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

  /** Focus document, execute undo/redo, save, return focus to panel. */
  private async _executeUndoRedo(
    filePath: string,
    command: 'undo' | 'redo',
    panel: vscode.WebviewPanel,
  ): Promise<boolean> {
    try {
      const uri = vscode.Uri.file(filePath);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.One,
        preserveFocus: false,
      });
      await vscode.commands.executeCommand(command);
      if (doc.isDirty) {
        await doc.save();
      }
      panel.reveal();
      return true;
    } catch (error) {
      // nosemgrep: unsafe-formatstring -- safe: command is 'undo' | 'redo' literal union
      console.error(`[UndoRedoService] ${command} failed:`, error);
      return false;
    }
  }
}
