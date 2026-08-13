/**
 * AST Duplicate Operation - duplicates element in AST structure (iframe component)
 *
 * This operation duplicates AST elements in the source file and records in history for undo/redo.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import type { ASTNode } from '../types/ast';
import { BaseOperation } from './Operation';

export interface ASTDuplicateOperationParams {
  elementId: string;
  filePath: string;
}

export class ASTDuplicateOperation extends BaseOperation {
  name = 'ASTDuplicate';
  private params: ASTDuplicateOperationParams;
  private newElementId?: string; // Store new element ID for undo
  private newElementIndex?: number; // Store index where duplicate was inserted
  private parentId?: string | null; // Store parent ID for redo
  private duplicatedElementStructure?: ASTNode; // Store full element structure for redo

  constructor(api: ASTApiService, params: ASTDuplicateOperationParams) {
    super(api);
    this.params = params;
  }

  /**
   * Execute duplicate: create copy of element in file
   * Note: This triggers async file operation, actual duplication happens in background
   */
  execute(tree: DocumentTree): OperationResult {
    console.log('[ASTDuplicateOperation] Executing duplicate:', this.params.elementId);

    // Store original element structure before duplicating
    this.storeOriginalElement(tree);

    // Duplicate in file in background
    // Store promise for later awaiting
    this.duplicatePromise = this.syncDuplicate()
      .then((newId) => {
        this.newElementId = newId;
        console.log('[ASTDuplicateOperation] Duplicate complete, new ID:', newId);
        return newId;
      })
      .catch((error) => {
        console.error('[ASTDuplicateOperation] Duplicate failed:', error);
        throw error;
      });

    return this.success([this.params.elementId]);
  }

  private duplicatePromise?: Promise<string>;

  /**
   * Store original element structure for redo
   */
  private storeOriginalElement(tree: DocumentTree): void {
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
    if (Array.isArray(astStructure)) {
      const element = findElement(astStructure as ASTNode[], this.params.elementId);
      if (element) {
        this.duplicatedElementStructure = element;
        return;
      }
    }

    // Search in children metadata
    const rootChildren = root.children || [];
    for (const childId of rootChildren) {
      const inst = tree.getInstance(childId);
      const childAst = inst?.metadata?.astStructure;
      if (Array.isArray(childAst)) {
        const element = findElement(childAst as ASTNode[], this.params.elementId);
        if (element) {
          this.duplicatedElementStructure = element;
          return;
        }
      }
    }
  }

  /**
   * Undo duplicate: delete the duplicated element
   */
  undo(_tree: DocumentTree): OperationResult {
    if (!this.newElementId) {
      console.warn('[ASTDuplicateOperation] No new element ID to undo');
      return this.error('No duplicated element to remove');
    }

    console.log('[ASTDuplicateOperation] Undoing duplicate, deleting element:', this.newElementId);

    // Delete the duplicated element via API
    this.syncDelete(this.newElementId)
      .then(() => {
        console.log('[ASTDuplicateOperation] Undo complete');
      })
      .catch((error) => {
        console.error('[ASTDuplicateOperation] Undo failed:', error);
      });

    return this.success([this.newElementId]);
  }

  /**
   * Redo duplicate: re-create the duplicate at the same position
   */
  redo(_tree: DocumentTree): OperationResult {
    if (!this.duplicatedElementStructure || !this.newElementId) {
      console.warn('[ASTDuplicateOperation] No element structure to redo');
      return this.error('No duplicate to restore');
    }

    console.log('[ASTDuplicateOperation] Redoing duplicate at position:', this.newElementIndex);

    // Re-insert the duplicate at the same position
    this.syncReduplicate()
      .then((newId) => {
        console.log('[ASTDuplicateOperation] Redo complete, new ID:', newId);
      })
      .catch((error) => {
        console.error('[ASTDuplicateOperation] Redo failed:', error);
      });

    return this.success([this.newElementId]);
  }

  /**
   * Get the new element ID after duplication
   */
  getNewElementId(): string | undefined {
    return this.newElementId;
  }

  /**
   * Wait for duplication to complete and return new ID
   */
  async waitForCompletion(): Promise<string | null> {
    if (!this.duplicatePromise) {
      return null;
    }
    try {
      return await this.duplicatePromise;
    } catch (_error) {
      return null;
    }
  }

  /**
   * Sync duplicate to file
   */
  private async syncDuplicate(): Promise<string> {
    console.log('[ASTDuplicateOperation] Calling API to duplicate:', {
      elementId: this.params.elementId,
      filePath: this.params.filePath,
    });

    const result = await this.api.duplicateElement({
      elementId: this.params.elementId,
      filePath: this.params.filePath,
    });

    console.log('[ASTDuplicateOperation] API response:', result);

    if (!result.success || !result.newId) {
      throw new Error(result.error || 'Failed to duplicate element');
    }

    // Store position info for redo
    if (result.parentId !== undefined) {
      this.parentId = result.parentId;
    }
    if (result.index !== undefined) {
      this.newElementIndex = result.index;
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);

    return result.newId;
  }

  /**
   * Sync delete to file (for undo)
   */
  private async syncDelete(elementId: string): Promise<void> {
    console.log('[ASTDuplicateOperation] Calling API to delete:', {
      elementId,
      filePath: this.params.filePath,
    });

    const result = await this.api.deleteElement({
      elementId,
      filePath: this.params.filePath,
    });

    console.log('[ASTDuplicateOperation] Delete API response:', result);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete element');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);
  }

  /**
   * Sync re-duplicate to file (for redo)
   * Re-inserts the duplicate at the exact same position
   */
  private async syncReduplicate(): Promise<string> {
    if (!this.duplicatedElementStructure) {
      throw new Error('No element structure to restore');
    }

    console.log('[ASTDuplicateOperation] Re-inserting duplicate at index:', this.newElementIndex);

    // Prepare request body
    // IMPORTANT: Only include 'children' parameter if the array is not empty
    // Otherwise it will overwrite props.children (text content)
    const requestBody = {
      parentId: this.parentId ?? '',
      filePath: this.params.filePath,
      componentType: this.duplicatedElementStructure.type,
      props: this.duplicatedElementStructure.props ?? {},
      targetId: this.newElementId, // Use the same ID as before
      index: this.newElementIndex, // Insert at exact same position
      children: undefined as ASTNode[] | undefined,
    };

    // Only add children parameter if array has elements
    if (
      Array.isArray(this.duplicatedElementStructure.children) &&
      this.duplicatedElementStructure.children.length > 0
    ) {
      requestBody.children = this.duplicatedElementStructure.children;
    }

    const result = await this.api.insertElement(requestBody);

    if (!result.success) {
      throw new Error(result.error || 'Failed to re-insert duplicate');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);

    if (!this.newElementId) {
      throw new Error('No new element ID available');
    }
    return this.newElementId;
  }
}
