/**
 * ASTReorderOperation unit tests (HYP-290a — JSX reorder primitive).
 *
 * Verifies the snapshot-based undo/redo plus the CRITICAL async invariant: an undo
 * issued BEFORE the server reorder write resolves must still restore the original
 * order. That only holds if undo awaits the in-flight execute `_pendingPromise`
 * before reading the snapshot — otherwise it races the AST mutation (see
 * CanvasEngine.undo at :355-357, which awaits `_pendingPromise`).
 */

import { describe, expect, it } from 'bun:test';
import { DocumentTree } from '../core/DocumentTree';
import { ASTReorderOperation } from '../operations/ASTReorderOperation';
import { MockASTApiService } from './mocks/MockASTApiService';

const params = {
  elementId: 'elem-C',
  filePath: '/test/component.tsx',
  targetIndex: 0,
};

describe('ASTReorderOperation', () => {
  it('calls reorderElement on execute', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    const op = new ASTReorderOperation(api, params);

    const result = op.execute(tree);
    expect(result.success).toBe(true);

    await op._pendingPromise;

    expect(api.getCallCount('reorderElement')).toBe(1);
    expect(api.wasCalledWith('reorderElement', { elementId: 'elem-C', targetIndex: 0 })).toBe(true);
  });

  it('stores undo + redo snapshot ids on execute', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    api.reorderElementResult = { success: true, snapshotId: 42 };

    const op = new ASTReorderOperation(api, params);
    op.execute(tree);
    await op._pendingPromise;

    // saveFileSnapshot captures post-mutation state for redo
    expect(api.getCallCount('saveFileSnapshot')).toBe(1);
  });

  it('restores the pre-mutation snapshot on undo', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    api.reorderElementResult = { success: true, snapshotId: 42 };

    const op = new ASTReorderOperation(api, params);
    op.execute(tree);
    await op._pendingPromise;

    api.reset();
    const undoResult = op.undo(tree);
    expect(undoResult.success).toBe(true);
    await op._pendingPromise;

    expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
    expect(api.getLastCall('restoreFileSnapshot')?.args[0]).toBe(42);
  });

  it('restores the redo snapshot on redo', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();
    api.reorderElementResult = { success: true, snapshotId: 42 };

    const op = new ASTReorderOperation(api, params);
    op.execute(tree);
    await op._pendingPromise;

    api.reset();
    const redoResult = op.redo(tree);
    expect(redoResult.success).toBe(true);
    await op._pendingPromise;

    expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
  });

  it('CRITICAL: undo issued BEFORE the reorder write resolves still restores the original order', async () => {
    const api = new MockASTApiService();
    const tree = new DocumentTree();

    // Gate the reorder write so it stays in-flight when undo fires.
    let releaseWrite: () => void = () => {};
    const writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    api.reorderElementResult = { success: true, snapshotId: 99 };
    api.reorderElementGate = writeGate;

    const op = new ASTReorderOperation(api, params);
    op.execute(tree);

    // Undo BEFORE the server write has resolved. The op must not read an
    // undefined snapshot id — it has to await the in-flight execute first.
    const undoResult = op.undo(tree);
    expect(undoResult.success).toBe(true);

    // Now let the gated write finish; the engine awaits op._pendingPromise.
    releaseWrite();
    await op._pendingPromise;

    // Restore happened, and with the correct pre-mutation snapshot id — no race.
    expect(api.getCallCount('restoreFileSnapshot')).toBe(1);
    expect(api.getLastCall('restoreFileSnapshot')?.args[0]).toBe(99);
  });
});
