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

interface FileEdit {
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

  // Extra root accepted alongside `_workspaceRoot`. Set when the Explorer's
  // ancestor-monorepo fallback surfaces sibling sub-projects that live outside
  // the opened folder (VS Code is opened at a leaf package, e.g.
  // `packages/cms-spa`, but a monorepo ancestor was discovered). Those sibling
  // component paths resolve to absolute paths outside `_workspaceRoot` by
  // design — without this, `_isInWorkspace` rejected them, so editing a
  // sibling component succeeded on disk but its undo snapshot was silently
  // dropped (HYP-909 follow-up).
  private _additionalWorkspaceRoot: string | null = null;

  constructor(private readonly _workspaceRoot: string) {}

  /** Widen the workspace boundary to also accept paths under `root` (or narrow back with null). */
  setAdditionalWorkspaceRoot(root: string | null): void {
    // Treat '' the same as null: `_isWithinRoot('', ...)` would otherwise match
    // every absolute POSIX path (`startsWith('/')`), silently disabling the
    // workspace-boundary check entirely.
    this._additionalWorkspaceRoot = root || null;
  }

  private _isInWorkspace(resolved: string): boolean {
    if (this._isWithinRoot(resolved, this._workspaceRoot)) return true;
    return this._additionalWorkspaceRoot !== null && this._isWithinRoot(resolved, this._additionalWorkspaceRoot);
  }

  private _isWithinRoot(resolved: string, root: string): boolean {
    return root.length > 0 && (resolved === root || resolved.startsWith(root + path.sep));
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

  /**
   * `panel` is optional: the content-based undo/redo stacks live in this
   * service, independent of any webview panel, and survive the preview panel
   * being closed. Callers with no live panel (e.g. the canvasUndo keybinding
   * firing from the Explorer/Inspector sidebar while the preview tab is
   * closed) still get the content-based stack tried first — `panel?.reveal()`
   * is a no-op rather than a crash in that case (HYP-1026 follow-up).
   */
  async undo(panel?: vscode.WebviewPanel): Promise<boolean> {
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
      panel?.reveal();
      return success;
    } finally {
      this._inProgress = false;
    }
  }

  /** See the `undo()` doc comment above — `panel` is optional for the same reason. */
  async redo(panel?: vscode.WebviewPanel): Promise<boolean> {
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
      panel?.reveal();
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

  /**
   * `_undoStack.pop()` inside `undo()` happens AFTER its file-write `await`s
   * complete, with no further `await` between the pop and `_inProgress` being
   * reset to `false` in `undo()`'s `finally`. So a caller that reads
   * `canUndo()` as a preflight BEFORE calling `undo()` (to distinguish
   * "nothing to undo" from "undo() returned false because it's already in
   * progress") can never observe a state where the stack was already popped
   * by a concurrent in-flight `undo()` call while `_inProgress` is still
   * `true` — those two state changes are atomic relative to any other
   * scheduled call. A second, overlapping `undo()` call's `canUndo()` read
   * either lands BEFORE the in-flight call's pop (stack still has the entry,
   * so `canUndo()` correctly stays `true`) or AFTER the in-flight call has
   * fully returned (stack is genuinely empty by then, so `canUndo()`
   * correctly reports `false`). Reviewed and traced during a PR #673
   * follow-up review pass that raised this exact race as a P1 concern; see
   * `PreviewPanel.undo()`'s `stackWasEmpty` preflight and the matching test
   * in `UndoRedoService.test.ts`.
   */
  canUndo(): boolean {
    return this._undoStack.length > 0;
  }

  /**
   * The `_trackingCount === 0` clause never actually diverges from a plain
   * `_redoStack.length > 0` check: `beginTracking()` unconditionally clears
   * `_redoStack` as its first, synchronous action, so by the time any caller
   * can observe `_trackingCount > 0`, the redo stack is ALREADY empty. This
   * is a documented invariant, not a coincidence — see the beginTracking()
   * doc comment and the `UndoRedoService.test.ts` test proving it
   * (`describe('canRedo() during beginTracking()/endTracking()...')`, added
   * after a review pass on PR #673's follow-up raised whether callers gating
   * a native-undo/redo-fallback decision on `canRedo()` could be fooled into
   * treating a non-empty stack as empty during a tracked edit — they cannot.
   */
  canRedo(): boolean {
    return this._redoStack.length > 0 && this._trackingCount === 0;
  }

  /**
   * Write content disk-first, then sync only dirty VS Code documents.
   *
   * KNOWN LIMITATION (pre-existing, extension-wide — not specific to undo/redo):
   * always builds a local `file:` URI and matches open documents by `fsPath`
   * alone. There is no support anywhere in this extension for non-`file`
   * schemes (Remote SSH / WSL / Dev Containers / virtual filesystem
   * providers) — the whole file I/O layer (`vscode-file-io.ts`) shares this
   * assumption. Tracked in HYP-1128.
   */
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
