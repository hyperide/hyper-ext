/**
 * ASTMapLiteralArrayOperation unit tests (HYP-290e — DOM-mode category 3).
 *
 * Verifies the engine op delegates to ASTApiService.mapLiteralArrayOp, stores the
 * snapshot ids, snapshots/reloads the COMPONENT file (no separate sample file), and —
 * CRITICALLY — that an undo issued BEFORE the server write resolves still restores the
 * pre-mutation snapshot (asserts the op awaits the in-flight execute `_pendingPromise`).
 */

import { describe, expect, it } from 'bun:test';
import { DocumentTree } from '../core/DocumentTree';
import { ASTMapLiteralArrayOperation } from '../operations/ASTMapLiteralArrayOperation';
import type { MapLiteralArrayOpParams } from '../services/ASTApiService';
import { MockASTApiService } from './mocks/MockASTApiService';

const params: MapLiteralArrayOpParams = {
  componentFilePath: '/test/Gallery.tsx',
  sampleName: 'SampleDefault',
  mapExpression: 'items',
  itemIndex: 1,
  operation: 'delete',
};

describe('ASTMapLiteralArrayOperation', () => {
  it('calls mapLiteralArrayOp on execute with the full params', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    const op = new ASTMapLiteralArrayOperation(api, params);

    const result = op.execute(tree);
    expect(result.success).toBe(true);

    await op._pendingPromise;

    expect(api.getCallCount('mapLiteralArrayOp')).toBe(1);
    expect(
      api.wasCalledWith('mapLiteralArrayOp', {
        componentFilePath: '/test/Gallery.tsx',
        itemIndex: 1,
        operation: 'delete',
      }),
    ).toBe(true);
  });

  it('snapshots + reloads the COMPONENT file on execute (re-render trigger)', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    const op = new ASTMapLiteralArrayOperation(api, params);

    op.execute(tree);
    await op._pendingPromise;

    // The component file is the snapshot target — no separate sample file in category 3.
    expect(api.getCallCount('saveFileSnapshot')).toBe(1);
    expect(api.getLastCall('saveFileSnapshot')?.args[0]).toBe('/test/Gallery.tsx');

    expect(api.getCallCount('reloadComponent')).toBe(1);
    const call = api.getLastCall('reloadComponent');
    expect(call?.args[0]).toBe('/test/Gallery.tsx');
    expect(call?.args[1]).toBe('SampleDefault');
  });

  it('restores the pre-mutation component snapshot on undo', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    api.mapLiteralArrayOpResult = { success: true, snapshotId: 42 };

    const op = new ASTMapLiteralArrayOperation(api, params);
    op.execute(tree);
    await op._pendingPromise;

    api.reset();
    const undoResult = op.undo(tree);
    expect(undoResult.success).toBe(true);
    await op._pendingPromise;

    expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
    expect(api.getLastCall('restoreFileSnapshot')?.args[0]).toBe(42);
    // Restores + re-renders the component file itself.
    expect(api.getLastCall('restoreFileSnapshot')?.args[1]).toBe('/test/Gallery.tsx');
    expect(api.getLastCall('restoreFileSnapshot')?.args[2]).toBe('SampleDefault');
  });

  it('CRITICAL: undo issued BEFORE the literal-array write resolves still restores the original', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();

    let releaseWrite: () => void = () => {};
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    api.mapLiteralArrayOpResult = { success: true, snapshotId: 99 };
    api.mapLiteralArrayOpGate = writeGate;

    const op = new ASTMapLiteralArrayOperation(api, params);
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
