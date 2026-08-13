/**
 * ASTMapSampleArrayOperation unit tests (HYP-290d — DOM-mode category 1).
 *
 * Verifies the engine op delegates to ASTApiService.mapSampleArrayOp, stores the
 * snapshot ids, and — CRITICALLY — that an undo issued BEFORE the server write
 * resolves still restores the pre-mutation snapshot (asserts the op awaits the
 * in-flight execute `_pendingPromise`, no race; see CanvasEngine.undo at :355-357).
 */

import { describe, expect, it } from 'bun:test';
import { DocumentTree } from '../core/DocumentTree';
import { ASTMapSampleArrayOperation } from '../operations/ASTMapSampleArrayOperation';
import type { MapSampleArrayOpParams } from '../services/ASTApiService';
import { MockASTApiService } from './mocks/MockASTApiService';

const params: MapSampleArrayOpParams = {
  filePath: '/test/List.samples.tsx',
  componentFilePath: '/test/List.tsx',
  sampleName: 'SampleDefault',
  mapExpression: 'items',
  itemIndex: 1,
  operation: 'delete',
};

describe('ASTMapSampleArrayOperation', () => {
  it('calls mapSampleArrayOp on execute with the full params', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    const op = new ASTMapSampleArrayOperation(api, params);

    const result = op.execute(tree);
    expect(result.success).toBe(true);

    await op._pendingPromise;

    expect(api.getCallCount('mapSampleArrayOp')).toBe(1);
    expect(
      api.wasCalledWith('mapSampleArrayOp', { sampleName: 'SampleDefault', itemIndex: 1, operation: 'delete' }),
    ).toBe(true);
  });

  it('reloads the component for the active sample on execute (re-render trigger)', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    const op = new ASTMapSampleArrayOperation(api, params);

    op.execute(tree);
    await op._pendingPromise;

    expect(api.getCallCount('reloadComponent')).toBe(1);
    const call = api.getLastCall('reloadComponent');
    expect(call?.args[0]).toBe('/test/List.tsx');
    expect(call?.args[1]).toBe('SampleDefault');
  });

  it('stores undo + redo snapshot ids on execute', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    api.mapSampleArrayOpResult = { success: true, snapshotId: 42 };

    const op = new ASTMapSampleArrayOperation(api, params);
    op.execute(tree);
    await op._pendingPromise;

    expect(api.getCallCount('saveFileSnapshot')).toBe(1);
  });

  it('restores the pre-mutation snapshot on undo', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    api.mapSampleArrayOpResult = { success: true, snapshotId: 42 };

    const op = new ASTMapSampleArrayOperation(api, params);
    op.execute(tree);
    await op._pendingPromise;

    api.reset();
    const undoResult = op.undo(tree);
    expect(undoResult.success).toBe(true);
    await op._pendingPromise;

    expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
    expect(api.getLastCall('restoreFileSnapshot')?.args[0]).toBe(42);
    // Reloads the COMPONENT for the active sample, not the sample file (undo must
    // re-render the rendered component, not parse *.samples.tsx as a component).
    expect(api.getLastCall('restoreFileSnapshot')?.args[1]).toBe('/test/List.tsx');
    expect(api.getLastCall('restoreFileSnapshot')?.args[2]).toBe('SampleDefault');
  });

  it('CRITICAL: undo issued BEFORE the sample-array write resolves still restores the original', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();

    let releaseWrite: () => void = () => {};
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    api.mapSampleArrayOpResult = { success: true, snapshotId: 99 };
    api.mapSampleArrayOpGate = writeGate;

    const op = new ASTMapSampleArrayOperation(api, params);
    op.execute(tree);

    // Undo BEFORE the server write resolves — must await the in-flight execute, not
    // read an undefined snapshot id.
    const undoResult = op.undo(tree);
    expect(undoResult.success).toBe(true);

    releaseWrite();
    await op._pendingPromise;

    expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
    expect(api.getLastCall('restoreFileSnapshot')?.args[0]).toBe(99);
  });
});
