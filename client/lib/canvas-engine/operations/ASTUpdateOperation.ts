/**
 * AST Update Operation - updates AST element props via file API
 *
 * Unlike regular UpdateOperation which works with DocumentTree instances,
 * this operation works with AST elements in iframe components
 */

import type { DocumentTree } from "../core/DocumentTree";
import type { OperationResult } from "../models/types";
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from "./Operation";
import { getPreviewIframe } from '@/lib/dom-utils';

export interface ASTUpdateOperationParams {
  elementId: string;
  filePath: string;
  propName: string;
  propValue: any;
}

export class ASTUpdateOperation extends BaseOperation {
  name = "AST Update";
  private params: ASTUpdateOperationParams;
  private oldValue?: any;

  constructor(api: ASTApiService, params: ASTUpdateOperationParams) {
    super(api);
    this.params = params;
  }

  /**
   * Get element ID being updated
   */
  getElementId(): string {
    return this.params.elementId;
  }

  /**
   * Get prop name being updated
   */
  getPropName(): string {
    return this.params.propName;
  }

  /**
   * Execute operation - update prop via API and apply to DOM
   */
  execute(tree: DocumentTree): OperationResult {
    try {
      // Store old value for undo (get from DOM)
      this.oldValue = this.getPropFromDOM(this.params.elementId, this.params.propName);

      // Apply to DOM immediately (for instant feedback)
      this.applyPropToDOM(this.params.elementId, this.params.propName, this.params.propValue);

      // Sync to file in background (don't wait for it)
      this.syncToFile().catch((error) => {
        console.error('[ASTUpdateOperation] Failed to sync to file:', error);
        // Revert DOM change on error
        if (this.oldValue !== undefined) {
          this.applyPropToDOM(this.params.elementId, this.params.propName, this.oldValue);
        }
      });

      return this.success([this.params.elementId]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  /**
   * Undo operation - restore old value
   */
  undo(tree: DocumentTree): OperationResult {
    if (this.oldValue === undefined) {
      return this.error("No old value to restore");
    }

    try {
      // Apply old value to DOM
      this.applyPropToDOM(this.params.elementId, this.params.propName, this.oldValue);

      // Sync to file in background
      this.syncToFile(this.oldValue).catch((error) => {
        console.error('[ASTUpdateOperation] Failed to sync undo to file:', error);
      });

      return this.success([this.params.elementId]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  /**
   * Get prop value from DOM
   */
  private getPropFromDOM(elementId: string, propName: string): any {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      return undefined;
    }

    const element = iframe.contentDocument.querySelector(
      `[data-uniq-id="${elementId}"]`
    ) as HTMLElement;

    if (!element) {
      return undefined;
    }

    // Get prop from DOM
    if (propName === 'className') {
      return element.className;
    } else if (propName === 'text') {
      return element.textContent;
    } else if (propName === 'style') {
      return element.getAttribute('style');
    } else {
      return element.getAttribute(propName);
    }
  }

  /**
   * Apply prop change to DOM in iframe (instant feedback)
   */
  private applyPropToDOM(elementId: string, propName: string, propValue: any): void {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      console.warn('[ASTUpdateOperation] Iframe not found');
      return;
    }

    const element = iframe.contentDocument.querySelector(
      `[data-uniq-id="${elementId}"]`
    ) as HTMLElement;

    if (!element) {
      console.warn('[ASTUpdateOperation] Element not found in iframe:', elementId);
      return;
    }

    // Apply prop to DOM
    if (propName === 'className') {
      element.className = propValue || '';
    } else if (propName === 'text') {
      element.textContent = propValue || '';
    } else if (propName === 'style') {
      element.setAttribute('style', propValue || '');
    } else {
      // For other props, set as attribute
      if (propValue === null || propValue === undefined) {
        element.removeAttribute(propName);
      } else {
        element.setAttribute(propName, String(propValue));
      }
    }

    console.log('[ASTUpdateOperation] Applied prop to DOM:', propName, '=', propValue);
  }

  /**
   * Sync prop change to file via API
   */
  private async syncToFile(valueOverride?: any): Promise<void> {
    const propValue = valueOverride !== undefined ? valueOverride : this.params.propValue;

    // Use different API method for text updates
    if (this.params.propName === 'text') {
      const result = await this.api.updateText({
        selectedId: this.params.elementId,
        filePath: this.params.filePath,
        text: propValue,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update text on server');
      }
    } else {
      const result = await this.api.updateProp({
        selectedId: this.params.elementId,
        filePath: this.params.filePath,
        propName: this.params.propName,
        propValue,
      });
      if (!result.success) {
        throw new Error(result.error || 'Failed to update prop on server');
      }
    }

    // Trigger component reload to sync AST
    await this.api.reloadComponent(this.params.filePath);

    console.log('[ASTUpdateOperation] Synced to file successfully');
  }
}
