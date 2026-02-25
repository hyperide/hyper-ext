/**
 * AST Update Props Operation - batch updates multiple AST element props via file API
 *
 * Similar to ASTUpdateOperation but handles multiple props in a single operation
 */

import { getPreviewIframe } from '@/lib/dom-utils';
import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

export interface ASTUpdatePropsOperationParams {
  elementId: string;
  filePath: string;
  props: Record<string, unknown>; // Multiple prop names and values
}

export class ASTUpdatePropsOperation extends BaseOperation {
  name = 'AST Update Props';
  private params: ASTUpdatePropsOperationParams;
  private oldValues: Record<string, unknown> = {};

  constructor(api: ASTApiService, params: ASTUpdatePropsOperationParams) {
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
   * Execute operation - update props via API and apply to DOM
   */
  execute(_tree: DocumentTree): OperationResult {
    try {
      // Store old values for undo (get from DOM)
      for (const propName of Object.keys(this.params.props)) {
        this.oldValues[propName] = this.getPropFromDOM(this.params.elementId, propName);
      }

      // Apply to DOM immediately (for instant feedback)
      for (const [propName, propValue] of Object.entries(this.params.props)) {
        this.applyPropToDOM(this.params.elementId, propName, propValue);
      }

      // Sync to file in background (don't wait for it)
      this.syncToFile().catch((error) => {
        console.error('[ASTUpdatePropsOperation] Failed to sync to file:', error);
        // Revert DOM changes on error
        for (const [propName, oldValue] of Object.entries(this.oldValues)) {
          if (oldValue !== undefined) {
            this.applyPropToDOM(this.params.elementId, propName, oldValue);
          }
        }
      });

      return this.success([this.params.elementId]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  /**
   * Undo operation - restore old values
   */
  undo(_tree: DocumentTree): OperationResult {
    if (Object.keys(this.oldValues).length === 0) {
      return this.error('No old values to restore');
    }

    try {
      // Apply old values to DOM
      for (const [propName, oldValue] of Object.entries(this.oldValues)) {
        this.applyPropToDOM(this.params.elementId, propName, oldValue);
      }

      // Sync to file in background
      this.syncToFile(this.oldValues).catch((error) => {
        console.error('[ASTUpdatePropsOperation] Failed to sync undo to file:', error);
      });

      return this.success([this.params.elementId]);
    } catch (error) {
      return this.error((error as Error).message);
    }
  }

  /**
   * Get prop value from DOM
   */
  private getPropFromDOM(elementId: string, propName: string): unknown {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      return undefined;
    }

    const element = iframe.contentDocument.querySelector(`[data-uniq-id="${elementId}"]`) as HTMLElement;

    if (!element) {
      return undefined;
    }

    // Get prop from element (className, style, etc.)
    if (propName === 'className') {
      return element.className;
    }

    // For style props, get from element.style
    if (element.style && propName in element.style) {
      return element.style.getPropertyValue(propName);
    }

    // Try to get attribute
    return element.getAttribute(propName);
  }

  /**
   * Apply prop value to DOM
   */
  private applyPropToDOM(elementId: string, propName: string, propValue: unknown): void {
    const iframe = getPreviewIframe();
    if (!iframe?.contentDocument) {
      throw new Error('Iframe not found');
    }

    const element = iframe.contentDocument.querySelector(`[data-uniq-id="${elementId}"]`) as HTMLElement;

    if (!element) {
      throw new Error(`Element with data-uniq-id="${elementId}" not found`);
    }

    // Apply className
    if (propName === 'className' && typeof propValue === 'string') {
      element.className = propValue;
      return;
    }

    // Apply style props
    if (element.style && propName in element.style) {
      element.style.setProperty(propName, String(propValue ?? ''));
      return;
    }

    // Set attribute
    if (propValue === null || propValue === undefined) {
      element.removeAttribute(propName);
    } else {
      element.setAttribute(propName, String(propValue));
    }
  }

  /**
   * Sync props to file via API
   */
  private async syncToFile(props?: Record<string, unknown>): Promise<void> {
    const propsToSync = props || this.params.props;

    const result = await this.api.updatePropsBatch({
      selectedId: this.params.elementId,
      filePath: this.params.filePath,
      props: propsToSync,
    });

    if (!result.success) {
      throw new Error(`Failed to update props: ${result.error}`);
    }
  }
}
