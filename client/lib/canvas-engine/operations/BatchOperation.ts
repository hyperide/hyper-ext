/**
 * Batch Operation - executes multiple operations as one
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import { BaseOperation, type Operation } from './Operation';

/** Narrow shape of ops that kick off an async server write in execute/undo/redo. */
type WithPendingPromise = { _pendingPromise?: Promise<void> };

export class BatchOperation extends BaseOperation {
  name = 'Batch';
  private operations: Operation[];
  /** Resolves only after every child op's in-flight server write settles. */
  _pendingPromise?: Promise<void>;

  constructor(operations: Operation[]) {
    super();
    this.operations = operations;
  }

  execute(tree: DocumentTree): OperationResult {
    const allChangedIds: string[] = [];

    for (const operation of this.operations) {
      const result = operation.execute(tree);

      if (!result.success) {
        return this.error(`Batch failed at ${operation.name}: ${result.error}`);
      }

      if (result.changedIds) {
        allChangedIds.push(...result.changedIds);
      }
    }

    this.collectPendingPromises();

    return this.success(allChangedIds);
  }

  /**
   * Redo each child via its own redo() (NOT execute()), in original order.
   * The inherited BaseOperation.redo() delegates to execute(), which would replay
   * snapshot/ID-sensitive children (file-snapshot, style, paste, duplicate) with fresh
   * IDs instead of the recorded ones — violating the Operation contract. Mirror execute():
   * collect changed IDs and refresh the batch _pendingPromise from the redo writes.
   */
  redo(tree: DocumentTree): OperationResult {
    const allChangedIds: string[] = [];

    for (const operation of this.operations) {
      const result = operation.redo(tree);

      if (!result.success) {
        return this.error(`Batch redo failed at ${operation.name}: ${result.error}`);
      }

      if (result.changedIds) {
        allChangedIds.push(...result.changedIds);
      }
    }

    this.collectPendingPromises();

    return this.success(allChangedIds);
  }

  undo(tree: DocumentTree): OperationResult {
    const allChangedIds: string[] = [];

    // Undo in reverse order
    for (let i = this.operations.length - 1; i >= 0; i--) {
      const operation = this.operations[i];

      if (!operation.canUndo()) {
        continue;
      }

      const result = operation.undo(tree);

      if (!result.success) {
        return this.error(`Batch undo failed at ${operation.name}: ${result.error}`);
      }

      if (result.changedIds) {
        allChangedIds.push(...result.changedIds);
      }
    }

    this.collectPendingPromises();

    return this.success(allChangedIds);
  }

  /**
   * Gather the in-flight server-write promises freshly set by child ops during the
   * just-run execute()/undo() loop, so callers can await the batch as a whole.
   */
  private collectPendingPromises(): void {
    const pending = this.operations
      .map((op) => (op as WithPendingPromise)._pendingPromise)
      .filter((p): p is Promise<void> => Boolean(p));

    this._pendingPromise = Promise.all(pending).then(() => undefined);
  }

  canUndo(): boolean {
    return this.operations.every((op) => op.canUndo());
  }
}
