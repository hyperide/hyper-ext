/**
 * DOM-mode map-iteration op on an in-component array literal (HYP-290e, category 3).
 *
 * Splices the `const items = [...]` array declared inside the component itself, targeting
 * the element at `itemIndex` — NOT the JSX `.map()` template. Only reached when the
 * selected iteration's data source classifies as `literal-array` (the server route
 * re-validates this gate; see routes/mapLiteralArrayOp.ts).
 *
 * Unlike ASTMapSampleArrayOperation (category 1), there is no separate sample file: the
 * COMPONENT file is both the mutation and snapshot target. `fileSnapshotMiddleware`
 * snapshots it via its `componentFilePath` fallback, so undo restores the component source.
 *
 * Undo uses server-side file-snapshot restore (same shape as ASTMapSampleArrayOperation):
 * splicing the array shifts node positions, so an inverse-op replay is unreliable —
 * restoring the pre-mutation snapshot is exact.
 *
 * CRITICAL async pattern (mirrors ASTMapSampleArrayOperation): the engine awaits an
 * operation's `_pendingPromise` during undo/redo. undo/redo here await the in-flight
 * execute write BEFORE reading the snapshot id, then re-assign the resulting chain to
 * `_pendingPromise` — an undo issued before execute resolves would otherwise read an
 * undefined snapshot and race the AST mutation.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService, MapLiteralArrayOpParams } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

export class ASTMapLiteralArrayOperation extends BaseOperation {
  name = 'AST Map Literal Array';
  private params: MapLiteralArrayOpParams;
  private undoSnapshotId?: number;
  private redoSnapshotId?: number;
  _pendingPromise?: Promise<void>;
  /**
   * Whether the most recent server write succeeded (mirrors ASTMapSampleArrayOperation).
   * `_pendingPromise` swallows the rejection, so the dual-mode dispatcher reads this after
   * awaiting it to decide whether to record the op or re-apply the JSX delete. `undefined`
   * until the first execute settles.
   */
  succeeded?: boolean;

  constructor(api: ASTApiService, params: MapLiteralArrayOpParams) {
    super(api);
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.executeAsync().catch((error) => {
      console.error('[ASTMapLiteralArrayOperation] Execute failed:', error);
    });

    return this.success([]);
  }

  undo(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.restoreSnapshot('undo').catch((error) => {
      console.error('[ASTMapLiteralArrayOperation] Undo failed:', error);
    });

    return this.success([]);
  }

  redo(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.restoreSnapshot('redo').catch((error) => {
      console.error('[ASTMapLiteralArrayOperation] Redo failed:', error);
    });

    return this.success([]);
  }

  private async restoreSnapshot(kind: 'undo' | 'redo'): Promise<void> {
    const prior = this._pendingPromise;
    if (prior) {
      await prior.catch(() => {});
    }

    const snapshotId = kind === 'undo' ? this.undoSnapshotId : this.redoSnapshotId;
    if (snapshotId === undefined) {
      if (kind === 'redo') {
        await this.executeAsync();
        return;
      }
      throw new Error('No snapshot for undo');
    }

    // Both the snapshot target and the re-render subject are the component file.
    await this.api.restoreFileSnapshot(snapshotId, this.params.componentFilePath, this.params.sampleName);
  }

  private async executeAsync(): Promise<void> {
    this.succeeded = undefined;
    const result = await this.api.mapLiteralArrayOp(this.params);

    if (!result.success) {
      this.succeeded = false;
      throw new Error(result.error || 'Failed to apply map literal-array op');
    }

    this.succeeded = true;
    this.undoSnapshotId = result.snapshotId;

    const snapshotResult = await this.api.saveFileSnapshot(this.params.componentFilePath);
    if (snapshotResult.success) {
      this.redoSnapshotId = snapshotResult.snapshotId;
    }

    // Re-render the canvas. fileSnapshotMiddleware marks the component file as API-mutated,
    // suppressing the chokidar HMR event — so an explicit reload is THE re-render trigger,
    // as in every sibling structural op.
    await this.api.reloadComponent(this.params.componentFilePath, this.params.sampleName);
  }
}
