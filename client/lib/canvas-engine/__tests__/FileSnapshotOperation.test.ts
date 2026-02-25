/**
 * FileSnapshotOperation unit tests
 *
 * Tests undo/redo via file snapshots using MockASTApiService.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { DocumentTree } from '../core/DocumentTree';
import { MockASTApiService } from './mocks/MockASTApiService';
import { FileSnapshotOperation } from '../operations/FileSnapshotOperation';
import type { FileSnapshotOperationParams } from '../operations/FileSnapshotOperation';

describe('FileSnapshotOperation', () => {
	let api: MockASTApiService;
	let tree: DocumentTree;

	const defaultParams: FileSnapshotOperationParams = {
		filePath: '/test/component.tsx',
		undoSnapshotId: 1,
		redoSnapshotId: 2,
		source: 'ai-agent',
		description: 'AI: edit_file /test/component.tsx',
	};

	beforeEach(() => {
		api = new MockASTApiService();
		tree = new DocumentTree();
	});

	describe('constructor', () => {
		it('should set operation name with source and description', () => {
			const op = new FileSnapshotOperation(api, defaultParams);
			expect(op.name).toBe('File Change (ai-agent): AI: edit_file /test/component.tsx');
		});

		it('should set source from params', () => {
			const op = new FileSnapshotOperation(api, { ...defaultParams, source: 'code-server' });
			expect(op.source).toBe('code-server');
		});
	});

	describe('execute', () => {
		it('should be a no-op and return success', () => {
			const op = new FileSnapshotOperation(api, defaultParams);
			const result = op.execute(tree);

			expect(result.success).toBe(true);
			expect(api.calls).toHaveLength(0);
		});
	});

	describe('undo', () => {
		it('should call restoreFileSnapshot with undoSnapshotId', () => {
			const op = new FileSnapshotOperation(api, defaultParams);
			const result = op.undo(tree);

			expect(result.success).toBe(true);
			expect(op._pendingPromise).toBeDefined();
			expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
			expect(api.getLastCall('restoreFileSnapshot')?.args).toEqual([1, '/test/component.tsx']);
		});

		it('should be a no-op when undoSnapshotId is undefined (new file)', () => {
			const op = new FileSnapshotOperation(api, {
				...defaultParams,
				undoSnapshotId: undefined,
			});
			const result = op.undo(tree);

			expect(result.success).toBe(true);
			expect(op._pendingPromise).toBeUndefined();
			expect(api.calls).toHaveLength(0);
		});
	});

	describe('redo', () => {
		it('should call restoreFileSnapshot with redoSnapshotId', () => {
			const op = new FileSnapshotOperation(api, defaultParams);
			const result = op.redo(tree);

			expect(result.success).toBe(true);
			expect(op._pendingPromise).toBeDefined();
			expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
			expect(api.getLastCall('restoreFileSnapshot')?.args).toEqual([2, '/test/component.tsx']);
		});

		it('should be a no-op when redoSnapshotId is undefined (deleted file)', () => {
			const op = new FileSnapshotOperation(api, {
				...defaultParams,
				redoSnapshotId: undefined,
			});
			const result = op.redo(tree);

			expect(result.success).toBe(true);
			expect(op._pendingPromise).toBeUndefined();
			expect(api.calls).toHaveLength(0);
		});
	});

	describe('source variants', () => {
		const sources = ['ui-editor', 'ai-agent', 'code-server', 'code-editor', 'external'] as const;

		for (const source of sources) {
			it(`should accept '${source}' as source`, () => {
				const op = new FileSnapshotOperation(api, { ...defaultParams, source });
				expect(op.source).toBe(source);
				expect(op.name).toContain(`(${source})`);
			});
		}
	});
});
