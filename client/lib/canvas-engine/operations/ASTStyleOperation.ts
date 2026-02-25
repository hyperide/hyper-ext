/**
 * Operation for style changes via ASTApiService.
 * Uses server-side file-snapshot undo: the middleware saves file content before
 * the mutation, and snapshotId is returned in the response.
 * On undo, the snapshot is restored, preserving AST node types (template literals, etc.).
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

interface ASTStyleOperationParams {
	elementId: string;
	filePath: string;
	styles: Record<string, string>;
	domClasses?: string;
	instanceProps?: Record<string, unknown>;
	instanceId?: string;
	state?: string;
}

export class ASTStyleOperation extends BaseOperation {
	name = 'AST Style Update';
	private params: ASTStyleOperationParams;
	private undoSnapshotId?: number;
	private redoSnapshotId?: number;
	_pendingPromise?: Promise<void>;

	constructor(api: ASTApiService, params: ASTStyleOperationParams) {
		super(api);
		this.params = params;
	}

	execute(_tree: DocumentTree): OperationResult {
		this._pendingPromise = this.executeAsync().catch((error) => {
			console.error('[ASTStyleOperation] Execute failed:', error);
		});

		return this.success([this.params.elementId]);
	}

	undo(_tree: DocumentTree): OperationResult {
		if (!this.undoSnapshotId) {
			return this.error('No snapshot for undo');
		}

		this._pendingPromise = this.api
			.restoreFileSnapshot(this.undoSnapshotId, this.params.filePath)
			.catch((error) => {
				console.error('[ASTStyleOperation] Undo failed:', error);
			});

		return this.success([this.params.elementId]);
	}

	redo(_tree: DocumentTree): OperationResult {
		if (!this.redoSnapshotId) {
			return this.execute(_tree);
		}

		this._pendingPromise = this.api
			.restoreFileSnapshot(this.redoSnapshotId, this.params.filePath)
			.catch((error) => {
				console.error('[ASTStyleOperation] Redo failed:', error);
			});

		return this.success([this.params.elementId]);
	}

	private async executeAsync(): Promise<void> {
		// Apply style changes — middleware saves pre-mutation snapshot automatically
		const result = await this.api.updateStyles({
			selectedId: this.params.elementId,
			filePath: this.params.filePath,
			styles: this.params.styles,
			domClasses: this.params.domClasses,
			instanceProps: this.params.instanceProps,
			instanceId: this.params.instanceId,
			state: this.params.state,
		});

		if (!result.success) {
			throw new Error(result.error || 'Failed to update styles');
		}

		// snapshotId from middleware = pre-mutation file state (for undo)
		this.undoSnapshotId = result.snapshotId;

		// Save post-mutation state for redo (via snapshot of the result)
		const snapshotResult = await this.api.saveFileSnapshot(this.params.filePath);
		if (snapshotResult.success) {
			this.redoSnapshotId = snapshotResult.snapshotId;
		}
	}
}
