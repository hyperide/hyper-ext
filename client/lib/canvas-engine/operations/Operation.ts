/**
 * Base Operation interface (Command pattern)
 */

import type { DocumentTree } from "../core/DocumentTree";
import type { OperationResult } from "../models/types";
import type { ASTApiService } from "../services/ASTApiService";

/**
 * Base operation interface
 */
export type OperationSource =
  | 'ui-editor'
  | 'ai-agent'
  | 'code-server'
  | 'code-editor'
  | 'external';

export interface Operation {
  /** Operation name for debugging */
  name: string;

  /** Source that created this operation */
  source?: OperationSource;

  /** Execute the operation */
  execute(tree: DocumentTree): OperationResult;

  /** Undo the operation */
  undo(tree: DocumentTree): OperationResult;

  /** Redo the operation (may differ from execute, e.g. reuse stored IDs) */
  redo(tree: DocumentTree): OperationResult;

  /** Can this operation be undone? */
  canUndo(): boolean;
}

/**
 * Abstract base class for operations
 */
export abstract class BaseOperation implements Operation {
  abstract name: string;
  source: OperationSource = 'ui-editor';
  protected api!: ASTApiService;

  constructor(api?: ASTApiService) {
    if (api) {
      this.api = api;
    }
  }

  abstract execute(tree: DocumentTree): OperationResult;

  abstract undo(tree: DocumentTree): OperationResult;

  /** Default redo delegates to execute. Override when redo semantics differ. */
  redo(tree: DocumentTree): OperationResult {
    return this.execute(tree);
  }

  canUndo(): boolean {
    return true;
  }

  /**
   * Create success result
   */
  protected success(changedIds?: string[]): OperationResult {
    return {
      success: true,
      changedIds,
    };
  }

  /**
   * Create error result
   */
  protected error(message: string): OperationResult {
    return {
      success: false,
      error: message,
    };
  }
}
