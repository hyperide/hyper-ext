/**
 * AST Insert Operation - inserts new element into AST structure (iframe component)
 *
 * Unlike regular InsertOperation which works with DocumentTree instances,
 * this operation inserts AST elements into the source file.
 */

import type { DocumentTree } from "../core/DocumentTree";
import type { OperationResult } from "../models/types";
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from "./Operation";

export interface ASTInsertOperationParams {
  parentId: string | null;
  filePath: string;
  componentType: string;
  props: Record<string, any>;
  componentFilePath?: string; // Source file path for import resolution
}

export class ASTInsertOperation extends BaseOperation {
  name = "ASTInsert";
  private params: ASTInsertOperationParams;
  private insertedId?: string; // Store ID of inserted element for undo

  constructor(api: ASTApiService, params: ASTInsertOperationParams) {
    super(api);
    this.params = params;
  }

  /**
   * Execute insert: add element to file, return new ID
   */
  execute(tree: DocumentTree): OperationResult {
    console.log('[ASTInsertOperation] Executing insert:', this.params.componentType);

    // Sync to file immediately
    this.syncToFile()
      .then((newId) => {
        this.insertedId = newId;
        console.log('[ASTInsertOperation] Insert complete, new ID:', newId);
      })
      .catch((error) => {
        console.error('[ASTInsertOperation] Insert failed:', error);
      });

    return this.success([]);
  }

  /**
   * Undo insert: delete the inserted element
   */
  undo(tree: DocumentTree): OperationResult {
    if (!this.insertedId) {
      console.warn('[ASTInsertOperation] No insertedId to undo');
      return this.error('No inserted element to undo');
    }

    console.log('[ASTInsertOperation] Undoing insert:', this.insertedId);

    // Delete element from file
    this.syncDelete()
      .catch((error) => {
        console.error('[ASTInsertOperation] Undo failed:', error);
      });

    return this.success([this.insertedId]);
  }

  /**
   * Sync insert to file
   */
  private async syncToFile(): Promise<string> {
    const result = await this.api.insertElement({
      parentId: this.params.parentId ?? '',
      filePath: this.params.filePath,
      componentType: this.params.componentType,
      props: this.params.props,
      componentFilePath: this.params.componentFilePath,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to insert element');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);

    return result.newId!;
  }

  /**
   * Sync delete to file (for undo)
   */
  private async syncDelete(): Promise<void> {
    if (!this.insertedId) {
      throw new Error('No inserted element to delete');
    }

    const result = await this.api.deleteElement({
      elementId: this.insertedId,
      filePath: this.params.filePath,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete element');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);
  }

  /**
   * Get inserted element ID (for testing/debugging)
   */
  getInsertedId(): string | undefined {
    return this.insertedId;
  }
}
