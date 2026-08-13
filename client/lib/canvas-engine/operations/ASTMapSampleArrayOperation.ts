/**
 * DOM-mode map-iteration op on a Sample-file array prop (HYP-290d, category 1).
 *
 * Splices the array passed via a prop to the Sample export (in `*.samples.tsx`),
 * targeting the element at `itemIndex` — NOT the JSX `.map()` template. Only reached
 * when the selected iteration's data source classifies as `props-from-sample`
 * (the server route re-validates this gate; see routes/mapSampleArrayOp.ts).
 *
 * Undo uses server-side file-snapshot restore of the SAMPLE file (same shape as
 * ASTReorderOperation / ASTStyleOperation): splicing the array rewrites the sample
 * source and shifts node positions, so an inverse-op replay is unreliable — restoring
 * the pre-mutation snapshot is exact.
 *
 * CRITICAL async pattern (do NOT mirror ASTDeleteOperation's fire-and-forget): the
 * engine awaits an operation's `_pendingPromise` during undo/redo
 * (CanvasEngine.ts:355-357, :400-402). undo/redo here await the in-flight execute
 * write BEFORE reading the snapshot id, then re-assign the resulting chain to
 * `_pendingPromise`. An undo issued before execute resolves would otherwise read an
 * undefined snapshot and race the AST mutation.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService, MapSampleArrayOpParams } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

export class ASTMapSampleArrayOperation extends BaseOperation {
  name = 'AST Map Sample Array';
  private params: MapSampleArrayOpParams;
  private undoSnapshotId?: number;
  private redoSnapshotId?: number;
  _pendingPromise?: Promise<void>;
  /**
   * Whether the most recent server write succeeded. `_pendingPromise` swallows the
   * rejection (it `.catch`es to keep undo/redo non-throwing), so callers that must
   * branch on server success — the dual-mode switch, which re-applies the JSX delete
   * if the DOM op is refused (e.g. server reclassifies the receiver as not
   * props-from-sample) — read this after awaiting `_pendingPromise`. `undefined`
   * until the first execute settles.
   */
  succeeded?: boolean;

  constructor(api: ASTApiService, params: MapSampleArrayOpParams) {
    super(api);
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.executeAsync().catch((error) => {
      console.error('[ASTMapSampleArrayOperation] Execute failed:', error);
    });

    return this.success([]);
  }

  undo(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.restoreSnapshot('undo').catch((error) => {
      console.error('[ASTMapSampleArrayOperation] Undo failed:', error);
    });

    return this.success([]);
  }

  redo(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.restoreSnapshot('redo').catch((error) => {
      console.error('[ASTMapSampleArrayOperation] Redo failed:', error);
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

    // The snapshot restore targets the SAMPLE file (by snapshotId), but the canvas must
    // re-render the COMPONENT for the active sample — so reload componentFilePath + sampleName,
    // not the sample file. (restoreFileSnapshot uses its filePath/sampleName args only to drive
    // the post-restore reloadComponent; the snapshot id alone identifies what content to restore.)
    await this.api.restoreFileSnapshot(snapshotId, this.params.componentFilePath, this.params.sampleName);
  }

  private async executeAsync(): Promise<void> {
    this.succeeded = undefined;
    const result = await this.api.mapSampleArrayOp(this.params);

    if (!result.success) {
      this.succeeded = false;
      throw new Error(result.error || 'Failed to apply map sample-array op');
    }

    this.succeeded = true;
    this.undoSnapshotId = result.snapshotId;

    const snapshotResult = await this.api.saveFileSnapshot(this.params.filePath);
    if (snapshotResult.success) {
      this.redoSnapshotId = snapshotResult.snapshotId;
    }

    // Re-render the canvas. fileSnapshotMiddleware marks the sample file as API-mutated,
    // suppressing the chokidar HMR event (apiMutationTracker, 2s TTL) — so an explicit
    // reload is THE re-render trigger, as in every sibling structural op
    // (ASTDeleteOperation/ASTDuplicateOperation/…). Reload the COMPONENT for the active
    // sample, not the mutated sample file. (ASTReorderOperation omits this only because
    // it is still unwired; do not copy that omission.)
    await this.api.reloadComponent(this.params.componentFilePath, this.params.sampleName);
  }
}
