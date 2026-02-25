/**
 * AST Paste Operation - pastes TSX code from clipboard into AST structure
 *
 * This operation reads TSX from clipboard, inserts it into file, and records in history for undo/redo.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import type { ASTNode } from '../types/ast';
import { BaseOperation } from './Operation';

export interface ASTPasteOperationParams {
  parentId: string | null;
  filePath: string;
  tsxCode: string;
}

export class ASTPasteOperation extends BaseOperation {
  name = 'ASTPaste';
  private params: ASTPasteOperationParams;
  private newElementId?: string; // Store first new element ID for backward compatibility
  private newElementIds: string[] = []; // Store all new element IDs for undo
  private pastedElementStructure?: ASTNode; // Store full element structure for redo

  constructor(api: ASTApiService, params: ASTPasteOperationParams) {
    super(api);
    this.params = params;
  }

  /**
   * Execute paste: insert TSX code into file
   * Note: This triggers async file operation, actual paste happens in background
   */
  execute(_tree: DocumentTree): OperationResult {
    console.log('[ASTPasteOperation] Executing paste');

    // Insert in file in background
    // Store promise for later awaiting
    this.pastePromise = this.syncPaste()
      .then((result) => {
        this.newElementId = result.newId;
        this.newElementIds = result.newIds || [result.newId];
        console.log('[ASTPasteOperation] Paste complete, IDs:', this.newElementIds);
        return result.newId;
      })
      .catch((error) => {
        console.error('[ASTPasteOperation] Paste failed:', error);
        throw error;
      });

    return this.success([]);
  }

  private pastePromise?: Promise<string>;

  /**
   * Undo paste: delete all pasted elements
   */
  undo(tree: DocumentTree): OperationResult {
    if (this.newElementIds.length === 0) {
      console.warn('[ASTPasteOperation] No new element IDs to undo');
      return this.error('No pasted elements to remove');
    }

    console.log('[ASTPasteOperation] Undoing paste, deleting elements:', this.newElementIds);

    // Store element structure before deleting (for redo)
    this.storePastedElement(tree);

    // Delete all pasted elements via API
    this.syncBatchDelete(this.newElementIds)
      .then(() => {
        console.log('[ASTPasteOperation] Undo complete');
      })
      .catch((error) => {
        console.error('[ASTPasteOperation] Undo failed:', error);
      });

    return this.success(this.newElementIds);
  }

  /**
   * Redo paste: re-insert all pasted elements
   */
  redo(_tree: DocumentTree): OperationResult {
    if (this.newElementIds.length === 0) {
      console.warn('[ASTPasteOperation] No elements to redo');
      return this.error('No paste to restore');
    }

    console.log('[ASTPasteOperation] Redoing paste, re-inserting', this.newElementIds.length, 'elements');

    // Re-insert by calling syncPaste again (TSX code is preserved in params)
    this.syncPaste()
      .then((result) => {
        this.newElementId = result.newId;
        this.newElementIds = result.newIds || [result.newId];
        console.log('[ASTPasteOperation] Redo complete, new IDs:', this.newElementIds);
      })
      .catch((error) => {
        console.error('[ASTPasteOperation] Redo failed:', error);
      });

    return this.success(this.newElementIds);
  }

  /**
   * Store pasted element structure for redo
   */
  private storePastedElement(tree: DocumentTree): void {
    if (this.pastedElementStructure) {
      return; // Already stored
    }

    const root = tree.getRoot();

    // Helper to find element in AST
    const findElement = (nodes: ASTNode[], targetId: string): ASTNode | null => {
      for (const node of nodes) {
        if (node.id === targetId) {
          return node;
        }
        if (node.children) {
          const found = findElement(node.children, targetId);
          if (found) return found;
        }
      }
      return null;
    };

    // Search in root.metadata.astStructure
    const astStructure = root.metadata?.astStructure;
    if (Array.isArray(astStructure) && this.newElementId) {
      const element = findElement(astStructure as ASTNode[], this.newElementId);
      if (element) {
        this.pastedElementStructure = element;
        return;
      }
    }

    // Search in children metadata
    const rootChildren = root.children || [];
    for (const childId of rootChildren) {
      const inst = tree.getInstance(childId);
      const childAst = inst?.metadata?.astStructure;
      if (Array.isArray(childAst) && this.newElementId) {
        const element = findElement(childAst as ASTNode[], this.newElementId);
        if (element) {
          this.pastedElementStructure = element;
          return;
        }
      }
    }
  }

  /**
   * Get the new element ID after paste
   */
  getNewElementId(): string | undefined {
    return this.newElementId;
  }

  /**
   * Wait for paste to complete and return new ID
   */
  async waitForCompletion(): Promise<string | null> {
    if (!this.pastePromise) {
      return null;
    }
    try {
      return await this.pastePromise;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Sync paste to file
   */
  private async syncPaste(): Promise<{ newId: string; newIds: string[] }> {
    console.log('[ASTPasteOperation] Calling API to paste');

    const result = await this.api.pasteElement({
      parentId: this.params.parentId || '',
      filePath: this.params.filePath,
      tsx: this.params.tsxCode,
    });

    console.log('[ASTPasteOperation] API response:', result);

    if (!result.success || !result.newId) {
      throw new Error(result.error || 'Failed to paste element');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);

    return {
      newId: result.newId,
      newIds: result.newIds || [result.newId],
    };
  }

  /**
   * Sync batch delete to file (for undo)
   */
  private async syncBatchDelete(elementIds: string[]): Promise<void> {
    console.log('[ASTPasteOperation] Calling API to delete elements:', elementIds);

    const result = await this.api.deleteElements({
      elementIds,
      filePath: this.params.filePath,
    });

    console.log('[ASTPasteOperation] Batch delete API response:', result);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete elements');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);
  }
}
