/**
 * @file Batch style operation — applies one set of style changes to many elements in a single round-trip
 *
 * Accessed via: CanvasEngine.updateASTStylesBatch (multi-select inspector edits)
 * Assumptions: all elements share one file; the server writes them sequentially in one request.
 * Tradeoffs: a single HTTP request and a single undo/redo file-snapshot pair instead of N
 *   separate ASTStyleOperation calls. Undo restores the whole-file pre-batch snapshot, so undo/redo
 *   is atomic across all elements (matching ASTStyleOperation's file-snapshot model).
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService, UpdateStylesBatchResult } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

/** Per-element resolution carried alongside the flat elementIds for the HYP-593 server loc fallback. */
interface BatchElementUpdate {
  /** Tracer nodeRef (or the raw id when the bridge can't resolve it). Dedupe + resolve target. */
  nodeRef: string;
  /** Client-side AST loc — the server cross-checks it when nodeRef is a parse UUID it can't resolve. */
  elementLoc?: { line: number; column: number; endLine?: number; endColumn?: number };
  /** Live applied className from the DOM (HYP-544) — the executor's authoritative replace target. */
  domClasses?: string;
}

interface ASTBatchStyleOperationParams {
  elementIds: string[];
  filePath: string;
  styles: Record<string, string>;
  state?: string;
  selectedSourceTabId?: string;
  /** UIKit-derived project default for the surfaceless Auto floor (D2 §4.3). */
  projectDefaultCssSystem?: string;
  /**
   * Per-element nodeRef + elementLoc (HYP-593 parity). Falls back to elementIds when absent so
   * callers that don't resolve client-side (history redo) still write. Carried verbatim to the route.
   */
  elementUpdates?: BatchElementUpdate[];
  /**
   * Authoritative per-element results from the host (D2 §6.2 / D3 §5.1). Fired after the initial
   * write only (not on undo/redo, which restore file snapshots and carry no per-element status).
   * Lets the inspector render the post-authoritative skip-banner without inferring from HTTP 200.
   */
  onResults?: (results: NonNullable<UpdateStylesBatchResult['results']>) => void;
}

export class ASTBatchStyleOperation extends BaseOperation {
  name = 'AST Batch Style Update';
  private params: ASTBatchStyleOperationParams;
  private undoSnapshotId?: number;
  private redoSnapshotId?: number;
  _pendingPromise?: Promise<void>;

  constructor(api: ASTApiService, params: ASTBatchStyleOperationParams) {
    super(api);
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    // Unlike ASTStyleOperation (whose single-select callers surface failures through the
    // style-verification pipeline), the batch caller (useStyleSync) awaits _pendingPromise and
    // needs the rejection to fire onSyncError → input revert + AI fallback (HYP-301). Keep the
    // promise rejecting for awaiting callers; the side .catch below marks the rejection as
    // handled so fire-and-forget call sites (history redo fallback) don't trip
    // unhandledrejection.
    this._pendingPromise = this.executeAsync();
    this._pendingPromise.catch((error) => {
      console.error('[ASTBatchStyleOperation] Execute failed:', error);
    });

    return this.success(this.params.elementIds);
  }

  undo(_tree: DocumentTree): OperationResult {
    if (!this.undoSnapshotId) {
      return this.error('No snapshot for undo');
    }

    this._pendingPromise = this.api.restoreFileSnapshot(this.undoSnapshotId, this.params.filePath).catch((error) => {
      console.error('[ASTBatchStyleOperation] Undo failed:', error);
    });

    return this.success(this.params.elementIds);
  }

  redo(_tree: DocumentTree): OperationResult {
    if (!this.redoSnapshotId) {
      return this.execute(_tree);
    }

    this._pendingPromise = this.api.restoreFileSnapshot(this.redoSnapshotId, this.params.filePath).catch((error) => {
      console.error('[ASTBatchStyleOperation] Redo failed:', error);
    });

    return this.success(this.params.elementIds);
  }

  private async executeAsync(): Promise<void> {
    const result = await this.api.updateStylesBatch({
      elementIds: this.params.elementIds,
      filePath: this.params.filePath,
      styles: this.params.styles,
      state: this.params.state,
      selectedSourceTabId: this.params.selectedSourceTabId,
      projectDefaultCssSystem: this.params.projectDefaultCssSystem,
      elementUpdates: this.params.elementUpdates,
    });

    // Surface the authoritative per-element results before the success gate: even a partial batch
    // (success:false because none applied) carries per-element skip/failure reasons the banner needs.
    if (result.results) {
      this.params.onResults?.(result.results);
    }

    if (!result.success) {
      throw new Error(result.error || 'Failed to update styles (batch)');
    }

    this.undoSnapshotId = result.snapshotId;

    const snapshotResult = await this.api.saveFileSnapshot(this.params.filePath);
    if (snapshotResult.success) {
      this.redoSnapshotId = snapshotResult.snapshotId;
    }
  }
}
