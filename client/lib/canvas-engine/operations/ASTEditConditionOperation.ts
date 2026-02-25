/**
 * Operation for editing condition/map expressions.
 * Undo swaps old/new expressions.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

interface ASTEditConditionOperationParams {
  /** 'condition' or 'map' */
  type: 'condition' | 'map';
  /** condId or parentMapId */
  boundaryId: string;
  elementId: string;
  filePath: string;
  oldExpression: string;
  newExpression: string;
}

export class ASTEditConditionOperation extends BaseOperation {
  name = 'AST Edit Condition';
  private params: ASTEditConditionOperationParams;
  _pendingPromise?: Promise<void>;

  constructor(api: ASTApiService, params: ASTEditConditionOperationParams) {
    super(api);
    this.params = params;
  }

  execute(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.applyExpression(this.params.newExpression, this.params.oldExpression).catch(
      (error) => {
        console.error('[ASTEditConditionOperation] Execute failed:', error);
      }
    );
    return this.success([this.params.elementId]);
  }

  undo(_tree: DocumentTree): OperationResult {
    this._pendingPromise = this.applyExpression(this.params.oldExpression, this.params.newExpression).catch(
      (error) => {
        console.error('[ASTEditConditionOperation] Undo failed:', error);
      }
    );
    return this.success([this.params.elementId]);
  }

  redo(_tree: DocumentTree): OperationResult {
    return this.execute(_tree);
  }

  private async applyExpression(newExpression: string, oldExpression: string): Promise<void> {
    const endpoint = this.params.type === 'condition' ? '/api/edit-condition' : '/api/edit-map';
    const idKey = this.params.type === 'condition' ? 'condId' : 'parentMapId';

    await this.api.editCondition({
      endpoint,
      idKey,
      boundaryId: this.params.boundaryId,
      newExpression,
      oldExpression,
      elementId: this.params.elementId,
      filePath: this.params.filePath,
    });

    // Trigger component reload
    await this.api.reloadComponent(this.params.filePath);
  }
}
