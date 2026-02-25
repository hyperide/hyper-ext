/**
 * AST Batch Delete Operation - deletes multiple elements from AST structure
 *
 * Used for cut operations and multi-selection deletes.
 * Preserves original IDs and full structure for undo.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import type { ASTNode } from '../types/ast';
import { BaseOperation } from './Operation';

export interface ASTBatchDeleteOperationParams {
  elementIds: string[];
  filePath: string;
}

interface DeletedElementInfo {
  element: ASTNode;
  parentId: string | null;
  index: number;
}

export class ASTBatchDeleteOperation extends BaseOperation {
  name = 'ASTBatchDelete';
  private params: ASTBatchDeleteOperationParams;
  private deletedElements: Map<string, DeletedElementInfo> = new Map();

  constructor(api: ASTApiService, params: ASTBatchDeleteOperationParams) {
    super(api);
    this.params = params;
  }

  /**
   * Execute batch delete: remove all elements from file
   */
  execute(tree: DocumentTree): OperationResult {
    console.log('[ASTBatchDeleteOperation] Executing batch delete:', this.params.elementIds);

    // Store all elements before deleting
    this.storeElementsForUndo(tree);

    // Delete all elements via API
    this.syncBatchDelete()
      .then(() => {
        console.log('[ASTBatchDeleteOperation] Batch delete complete');
      })
      .catch((error) => {
        console.error('[ASTBatchDeleteOperation] Batch delete failed:', error);
      });

    return this.success(this.params.elementIds);
  }

  /**
   * Undo batch delete: restore all deleted elements with original IDs
   */
  undo(_tree: DocumentTree): OperationResult {
    if (this.deletedElements.size === 0) {
      console.warn('[ASTBatchDeleteOperation] No elements to restore');
      return this.error('No deleted elements to restore');
    }

    console.log('[ASTBatchDeleteOperation] Undoing batch delete, restoring elements');

    // Restore all elements in reverse order (to maintain hierarchy)
    this.syncBatchRestore()
      .then(() => {
        console.log('[ASTBatchDeleteOperation] Batch restore complete');
      })
      .catch((error) => {
        console.error('[ASTBatchDeleteOperation] Undo failed:', error);
      });

    return this.success(this.params.elementIds);
  }

  /**
   * Redo batch delete: delete all elements again
   */
  redo(_tree: DocumentTree): OperationResult {
    if (this.deletedElements.size === 0) {
      console.warn('[ASTBatchDeleteOperation] No elements to delete');
      return this.error('No elements to delete');
    }

    console.log('[ASTBatchDeleteOperation] Redoing batch delete');

    // Delete all elements again
    this.syncBatchDelete()
      .then(() => {
        console.log('[ASTBatchDeleteOperation] Batch delete redo complete');
      })
      .catch((error) => {
        console.error('[ASTBatchDeleteOperation] Redo failed:', error);
      });

    return this.success(this.params.elementIds);
  }

  /**
   * Store all elements before deleting
   */
  private storeElementsForUndo(tree: DocumentTree): void {
    const root = tree.getRoot();

    // Helper to find element and its parent in AST
    const findElementWithParent = (
      nodes: ASTNode[],
      targetId: string,
      parent?: ASTNode,
      _index?: number,
    ): { element: ASTNode; parent: ASTNode | undefined; index: number } | null => {
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

    // Store each element
    for (const elementId of this.params.elementIds) {
      let found = false;

      // Search in root.metadata.astStructure
      const astStructure = root.metadata?.astStructure;
      if (Array.isArray(astStructure)) {
        const result = findElementWithParent(astStructure as ASTNode[], elementId);
        if (result) {
          // Deep copy to avoid mutation issues
          const info: DeletedElementInfo = {
            element: JSON.parse(JSON.stringify(result.element)),
            parentId: result.parent?.id || null,
            index: result.index,
          };
          this.deletedElements.set(elementId, info);
          console.log('[ASTBatchDeleteOperation] Stored element:', {
            id: elementId.substring(0, 8),
            type: result.element.type,
            parentId: info.parentId?.substring(0, 8) || 'root',
            index: info.index,
            hasChildren: !!result.element.children && result.element.children.length > 0,
            childrenCount: result.element.children?.length || 0,
            hasPropsChildren: !!result.element.props?.children,
            propsChildrenType: typeof result.element.props?.children,
            propsChildrenValue:
              typeof result.element.props?.children === 'string'
                ? result.element.props.children.substring(0, 50)
                : undefined,
          });
          found = true;
          continue;
        }
      }

      // Search in children metadata
      const rootChildren = root.children || [];
      for (const childId of rootChildren) {
        const inst = tree.getInstance(childId);
        const childAst = inst?.metadata?.astStructure;
        if (Array.isArray(childAst)) {
          const result = findElementWithParent(childAst as ASTNode[], elementId);
          if (result) {
            // Deep copy to avoid mutation issues
            const info: DeletedElementInfo = {
              element: JSON.parse(JSON.stringify(result.element)),
              parentId: result.parent?.id || null,
              index: result.index,
            };
            this.deletedElements.set(elementId, info);
            console.log('[ASTBatchDeleteOperation] Stored element:', {
              id: elementId.substring(0, 8),
              type: result.element.type,
              parentId: info.parentId?.substring(0, 8) || 'root',
              index: info.index,
              hasChildren: !!result.element.children && result.element.children.length > 0,
              childrenCount: result.element.children?.length || 0,
              hasPropsChildren: !!result.element.props?.children,
              propsChildrenType: typeof result.element.props?.children,
              propsChildrenValue:
                typeof result.element.props?.children === 'string'
                  ? result.element.props.children.substring(0, 50)
                  : undefined,
            });
            found = true;
            break;
          }
        }
      }

      if (!found) {
        console.error('[ASTBatchDeleteOperation] Element NOT FOUND in AST:', elementId.substring(0, 8));
      }
    }

    console.log(
      '[ASTBatchDeleteOperation] Stored',
      this.deletedElements.size,
      'of',
      this.params.elementIds.length,
      'elements for undo',
    );
  }

  /**
   * Sync batch delete to file
   */
  private async syncBatchDelete(): Promise<void> {
    console.log('[ASTBatchDeleteOperation] Calling API to delete elements:', this.params.elementIds);

    const result = await this.api.deleteElements({
      elementIds: this.params.elementIds,
      filePath: this.params.filePath,
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to delete elements');
    }

    // Reparse component to update AST structure
    // Skip sampleRender generation to avoid race conditions with file writes
    await this.api.reloadComponent(this.params.filePath);
  }

  /**
   * Sync batch restore to file
   * Restores all elements with their original IDs sorted by index
   * Adjusts indices to account for previously inserted elements
   */
  private async syncBatchRestore(): Promise<void> {
    console.log('[ASTBatchDeleteOperation] Restoring', this.deletedElements.size, 'elements');

    // Group elements by parent
    const elementsByParent = new Map<string | null, Array<[string, DeletedElementInfo]>>();
    for (const [elementId, info] of this.deletedElements.entries()) {
      const key = info.parentId || 'root';
      if (!elementsByParent.has(key)) {
        elementsByParent.set(key, []);
      }
      elementsByParent.get(key)?.push([elementId, info]);
    }

    // Sort elements within each parent by original index
    for (const [parentKey, elements] of elementsByParent.entries()) {
      elements.sort((a, b) => a[1].index - b[1].index);
      console.log(
        `[ASTBatchDeleteOperation] Parent ${parentKey}: restoring ${elements.length} elements at indices:`, // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        elements.map((e) => `${e[0].substring(0, 8)}@${e[1].index}`),
      );
    }

    // Restore elements group by group (parent by parent)
    for (const [_parentKey, elements] of elementsByParent.entries()) {
      for (const [elementId, info] of elements) {
        // Use original index - elements are sorted, so each insert shifts the array correctly
        const adjustedIndex = info.index;

        console.log('[ASTBatchDeleteOperation] Restoring element:', {
          id: elementId.substring(0, 8),
          type: info.element.type,
          parentId: info.parentId?.substring(0, 8) || 'root',
          originalIndex: info.index,
          adjustedIndex,
          hasProps: !!info.element.props,
          propsKeys: Object.keys(info.element.props || {}),
          hasPropsChildren: !!info.element.props?.children,
          propsChildrenType: typeof info.element.props?.children,
          propsChildrenPreview:
            typeof info.element.props?.children === 'string' ? info.element.props.children.substring(0, 50) : undefined,
          hasChildrenArray: !!info.element.children,
          childrenArrayLength: Array.isArray(info.element.children) ? info.element.children.length : 0,
        });

        // Prepare request body
        // IMPORTANT: Only include 'children' parameter if the array is not empty
        // Otherwise it will overwrite props.children (text content)
        const requestBody = {
          parentId: info.parentId ?? '',
          filePath: this.params.filePath,
          componentType: info.element.type,
          props: info.element.props ?? {},
          targetId: info.element.id, // Preserve original ID
          index: adjustedIndex, // Restore at adjusted position
          children: undefined as ASTNode[] | undefined,
        };

        // Only add children parameter if array has elements
        if (Array.isArray(info.element.children) && info.element.children.length > 0) {
          requestBody.children = info.element.children;
        }

        const result = await this.api.insertElement(requestBody);

        if (!result.success) {
          console.error('[ASTBatchDeleteOperation] Failed to restore element:', elementId, result.error);
          // Continue with other elements even if one fails
        } else {
          console.log('[ASTBatchDeleteOperation] Successfully restored element');
        }
      }
    }

    // Reparse component once after all elements are restored
    // Skip sampleRender generation to avoid race conditions with file writes
    await this.api.reloadComponent(this.params.filePath);
  }
}
