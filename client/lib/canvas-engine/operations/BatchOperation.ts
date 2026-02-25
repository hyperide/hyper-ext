/**
 * Batch Operation - executes multiple operations as one
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import { BaseOperation, type Operation } from './Operation';

export class BatchOperation extends BaseOperation {
  name = 'Batch';
  private operations: Operation[];

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

    return this.success(allChangedIds);
  }

  canUndo(): boolean {
    return this.operations.every((op) => op.canUndo());
  }
}
