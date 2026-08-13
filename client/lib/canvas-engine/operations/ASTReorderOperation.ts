/**
 * Operation for reordering a JSX element among its siblings via ASTApiService (HYP-290a).
 *
 * Uses server-side file-snapshot undo (same shape as ASTStyleOperation): the snapshot
 * middleware saves file content before the mutation and returns `snapshotId`; undo
 * restores that snapshot. Snapshot-restore (not index-reversal) is required because a
 * reorder rewrites the file and shifts the moved element's source position — and thus
 * its nodeRef — so re-targeting it for a reverse move is unreliable.
 *
 * CRITICAL async pattern (do NOT mirror ASTDeleteOperation's fire-and-forget): the
 * engine awaits an operation's `_pendingPromise` during undo/redo
 * (CanvasEngine.ts:355-357, :400-402). undo/redo here therefore await the in-flight
 * execute write BEFORE reading the snapshot id, and re-assign the resulting chain to
 * `_pendingPromise`. An undo issued before the execute write resolves would otherwise
 * read an undefined snapshot and race the AST mutation, restoring the wrong order.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

interface ASTReorderOperationParams {
  /** nodeRef / id of the JSX element to move within its parent */
  elementId: string;
  filePath: string;
  /** Zero-based logical index among the parent's JSXElement children */
  targetIndex: number;
}

export class ASTReorderOperation extends BaseOperation {
  name = 'AST Reorder';
  private params: ASTReorderOperationParams;
  private undoSnapshotId?: number;
  private redoSnapshotId?: number;
  _pendingPromise?: Promise<void>;

  constructor(api: ASTApiService, params: ASTReorderOperationParams) {
    super(api);
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.executeAsync().catch((error) => {
      console.error('[ASTReorderOperation] Execute failed:', error);
    });

    return this.success([this.params.elementId]);
  }

  undo(_tree: DocumentTree): OperationResult {
    // Await any in-flight execute write before reading the snapshot id, then
    // restore. Re-assigning the chain to `_pendingPromise` lets the engine block
    // on the whole restore during undo (CanvasEngine.ts:355-357) — no race.
    this._pendingPromise = this.restoreSnapshot('undo').catch((error) => {
      console.error('[ASTReorderOperation] Undo failed:', error);
    });

    return this.success([this.params.elementId]);
  }

  redo(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.restoreSnapshot('redo').catch((error) => {
      console.error('[ASTReorderOperation] Redo failed:', error);
    });

    return this.success([this.params.elementId]);
  }

  private async restoreSnapshot(kind: 'undo' | 'redo'): Promise<void> {
    // Block on the previous async step (the execute write, or a prior undo/redo
    // restore) so the snapshot ids are populated before we read them.
    const prior = this._pendingPromise;
    if (prior) {
      await prior.catch(() => {
        // Failure of the prior step is surfaced by its own catch handler.
      });
    }

    const snapshotId = kind === 'undo' ? this.undoSnapshotId : this.redoSnapshotId;
    if (snapshotId === undefined) {
      if (kind === 'redo') {
        // No post-mutation snapshot captured — re-run the forward write.
        await this.executeAsync();
        return;
      }
      throw new Error('No snapshot for undo');
    }

    await this.api.restoreFileSnapshot(snapshotId, this.params.filePath);
  }

  private async executeAsync(): Promise<void> {
    const result = await this.api.reorderElement({
      elementId: this.params.elementId,
      filePath: this.params.filePath,
      targetIndex: this.params.targetIndex,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to reorder element');
    }

    // snapshotId from middleware = pre-mutation file state (for undo)
    this.undoSnapshotId = result.snapshotId;

    // Capture post-mutation state for redo
    const snapshotResult = await this.api.saveFileSnapshot(this.params.filePath);
    if (snapshotResult.success) {
      this.redoSnapshotId = snapshotResult.snapshotId;
    }
  }
}
