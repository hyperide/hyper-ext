/**
 * FileSnapshotOperation — undo/redo via file snapshots for non-canvas changes.
 * Used for AI agent, code-server, Monaco, and chokidar (external) file changes.
 * Follows ASTStyleOperation pattern with _pendingPromise.
 */

import type { DocumentTree } from '../core/DocumentTree';
import type { OperationResult } from '../models/types';
import type { ASTApiService } from '../services/ASTApiService';
import { BaseOperation } from './Operation';

export type FileChangeSource =
	| 'ui-editor'
	| 'ai-agent'
	| 'code-server'
	| 'code-editor'
	| 'external';

export interface FileSnapshotOperationParams {
	filePath: string;
	undoSnapshotId?: number;
	redoSnapshotId?: number;
	source: FileChangeSource;
	description: string;
}

export class FileSnapshotOperation extends BaseOperation {
	name: string;
	_pendingPromise?: Promise<void>;

	private filePath: string;
	private undoSnapshotId?: number;
	private redoSnapshotId?: number;

	constructor(api: ASTApiService, params: FileSnapshotOperationParams) {
		super(api);
		this.filePath = params.filePath;
		this.undoSnapshotId = params.undoSnapshotId;
		this.redoSnapshotId = params.redoSnapshotId;
		this.source = params.source;
		this.name = `File Change (${params.source}): ${params.description}`;
	}

	execute(_tree: DocumentTree): OperationResult {
		// No-op — the change already happened externally
		return this.success();
	}

	undo(_tree: DocumentTree): OperationResult {
		if (this.undoSnapshotId === undefined) {
			return this.success(); // No undo snapshot = new file, nothing to restore
		}

		this._pendingPromise = this.api
			.restoreFileSnapshot(this.undoSnapshotId, this.filePath)
			.catch((error) => {
				console.error('[FileSnapshotOperation] Undo failed:', error);
			});

		return this.success();
	}

	redo(_tree: DocumentTree): OperationResult {
		if (this.redoSnapshotId === undefined) {
			return this.success(); // No redo snapshot = deleted file, nothing to restore
		}

		this._pendingPromise = this.api
			.restoreFileSnapshot(this.redoSnapshotId, this.filePath)
			.catch((error) => {
				console.error('[FileSnapshotOperation] Redo failed:', error);
			});

		return this.success();
	}
}
