/**
 * AST Delete Operation - deletes element from AST structure (iframe component)
 *
 * Unlike regular DeleteOperation which works with DocumentTree instances,
 * this operation deletes AST elements from the source file.
 */

import type { DocumentTree } from "../core/DocumentTree";
import type { OperationResult } from "../models/types";
import { BaseOperation } from "./Operation";
import type { ASTApiService } from '../services/ASTApiService';

export interface ASTDeleteOperationParams {
  elementId: string;
  filePath: string;
}

export class ASTDeleteOperation extends BaseOperation {
  name = "ASTDelete";
  private params: ASTDeleteOperationParams;
  private deletedElement?: any; // Store deleted element structure for undo
  private parentId?: string; // Store parent ID for undo
  private elementIndex?: number; // Store position in parent for undo

  constructor(api: ASTApiService, params: ASTDeleteOperationParams) {
    super(api);
    this.params = params;
  }

  /**
   * Execute delete: remove element from file
   * Store element structure for potential undo
   */
  execute(tree: DocumentTree): OperationResult {
    console.log('[ASTDeleteOperation] Executing delete:', this.params.elementId);

    // First, find and store the element in AST before deleting
    // This allows us to restore it on undo
    this.storeElementForUndo(tree);

    // Delete from file in background
    this.syncDelete()
      .then(() => {
        console.log('[ASTDeleteOperation] Delete complete');
      })
      .catch((error) => {
        console.error('[ASTDeleteOperation] Delete failed:', error);
      });

    return this.success([this.params.elementId]);
  }

  /**
   * Undo delete: restore the deleted element with original ID
   */
  undo(tree: DocumentTree): OperationResult {
    if (!this.deletedElement || this.parentId === undefined) {
      console.warn('[ASTDeleteOperation] No element data to restore');
      return this.error('No deleted element to restore');
    }

    console.log('[ASTDeleteOperation] Undoing delete, restoring element with original ID');

    // Restore element via insert API - preserves original ID
    this.syncRestore()
      .then((restoredId) => {
        // Verify that ID matches original
        if (restoredId !== this.deletedElement.id) {
          console.warn('[ASTDeleteOperation] Restored ID differs from original:', {
            original: this.deletedElement.id,
            restored: restoredId,
          });
        }
        console.log('[ASTDeleteOperation] Element restored with ID:', restoredId);
      })
      .catch((error) => {
        console.error('[ASTDeleteOperation] Undo failed:', error);
      });

    return this.success([this.params.elementId]);
  }

  /**
   * Redo delete: delete the element again
   */
  redo(tree: DocumentTree): OperationResult {
    console.log('[ASTDeleteOperation] Redoing delete');

    // Delete element again
    this.syncDelete()
      .then(() => {
        console.log('[ASTDeleteOperation] Redo complete');
      })
      .catch((error) => {
        console.error('[ASTDeleteOperation] Redo failed:', error);
      });

    return this.success([this.params.elementId]);
  }

  /**
   * Store element structure before deleting (for undo)
   */
  private storeElementForUndo(tree: DocumentTree): void {
    const root = tree.getRoot();

    // Helper to find element and its parent in AST
    const findElementWithParent = (
      nodes: any[],
      targetId: string,
      parent?: any,
      index?: number
    ): { element: any; parent: any; index: number } | null => {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        if (node.id === targetId) {
          return { element: node, parent: parent || null, index: i };
        }
        if (node.children) {
          const found = findElementWithParent(node.children, targetId, node, i);
          if (found) return found;
        }
      }
      return null;
    };

    // Search in root.metadata.astStructure
    if (root.metadata?.astStructure) {
      const result = findElementWithParent(root.metadata.astStructure, this.params.elementId);
      if (result) {
        // Deep copy to avoid mutation issues
        this.deletedElement = JSON.parse(JSON.stringify(result.element));
        this.parentId = result.parent?.id || null;
        this.elementIndex = result.index;
        console.log('[ASTDeleteOperation] Stored element:', this.params.elementId.substring(0, 8), 'at index', this.elementIndex);
        return;
      }
    }

    // Search in children metadata
    const rootChildren = root.children || [];
    for (const childId of rootChildren) {
      const inst = tree.getInstance(childId);
      if (inst?.metadata?.astStructure) {
        const result = findElementWithParent(inst.metadata.astStructure, this.params.elementId);
        if (result) {
          // Deep copy to avoid mutation issues
          this.deletedElement = JSON.parse(JSON.stringify(result.element));
          this.parentId = result.parent?.id || null;
          this.elementIndex = result.index;
          console.log('[ASTDeleteOperation] Stored element:', this.params.elementId.substring(0, 8), 'at index', this.elementIndex);
          return;
        }
      }
    }

    console.error('[ASTDeleteOperation] Element NOT FOUND in AST:', this.params.elementId.substring(0, 8));
  }

  /**
   * Sync delete to file
   */
  private async syncDelete(): Promise<void> {
    console.log('[ASTDeleteOperation] Calling API to delete:', {
      elementId: this.params.elementId,
      filePath: this.params.filePath,
    });

    const result = await this.api.deleteElement({
      elementId: this.params.elementId,
      filePath: this.params.filePath,
    });

    console.log('[ASTDeleteOperation] API response:', result);

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete element');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);
  }

  /**
   * Sync restore to file (for undo)
   * Returns original element ID after restoration
   * Preserves original ID and full element structure including children
   */
  private async syncRestore(): Promise<string> {
    if (!this.deletedElement) {
      throw new Error('No deleted element to restore');
    }

    console.log('[ASTDeleteOperation] Restoring element:', this.deletedElement.id.substring(0, 8), 'at index', this.elementIndex);

    // Use insert API to restore element with original ID and full structure
    // IMPORTANT: Only include 'children' parameter if the array is not empty
    // Otherwise it will overwrite props.children (text content)
    const requestBody: any = {
      parentId: this.parentId,
      filePath: this.params.filePath,
      componentType: this.deletedElement.type,
      props: this.deletedElement.props || {},
      targetId: this.deletedElement.id, // Preserve original ID
      index: this.elementIndex, // Restore at exact position
    };

    // Only add children parameter if array has elements
    if (Array.isArray(this.deletedElement.children) && this.deletedElement.children.length > 0) {
      requestBody.children = this.deletedElement.children;
    }

    console.log('[ASTDeleteOperation] Sending restore request:', {
      parentId: requestBody.parentId?.substring(0, 8),
      index: requestBody.index,
      type: requestBody.componentType,
      targetId: requestBody.targetId?.substring(0, 8),
    });

    const result = await this.api.insertElement(requestBody);

    console.log('[ASTDeleteOperation] Server response:', {
      success: result.success,
      newId: result.newId?.substring(0, 8),
    });

    if (!result.success) {
      console.error('[ASTDeleteOperation] Restore failed:', result.error);
      throw new Error(result.error || 'Failed to restore element');
    }

    // Reparse component to update AST structure
    await this.api.reloadComponent(this.params.filePath);

    // Return original element ID (should match deletedElement.id)
    return this.deletedElement.id;
  }
}
