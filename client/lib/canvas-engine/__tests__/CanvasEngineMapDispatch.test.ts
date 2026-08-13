/**
 * CanvasEngine dual-mode map-op dispatcher (HYP-290c).
 *
 * Asserts the dispatcher the HYP-290d engine op was left "unwired" against:
 *   - dispatchMapSampleArrayOp creates + records ASTMapSampleArrayOperation and
 *     drives the HYP-290d ASTApiService.mapSampleArrayOp call.
 *   - createMapOpDispatchController applies the JSX op immediately, and on switch
 *     undoes the JSX op then dispatches the DOM op, leaving the DOM op as the clean
 *     history head (the JSX op dropped from the redo branch).
 */

import { describe, expect, it } from 'bun:test';
import { CanvasEngine } from '../core/CanvasEngine';
import type { ASTApiService, MapLiteralArrayOpParams, MapSampleArrayOpParams } from '../services/ASTApiService';
import { MockASTApiService } from './mocks/MockASTApiService';

const domParams: MapSampleArrayOpParams = {
  filePath: '/test/List.samples.tsx',
  componentFilePath: '/test/List.tsx',
  sampleName: 'SampleDefault',
  mapExpression: 'items',
  itemIndex: 1,
  operation: 'delete',
};

const literalParams: MapLiteralArrayOpParams = {
  componentFilePath: '/test/List.tsx',
  sampleName: 'SampleDefault',
  mapExpression: 'items',
  itemIndex: 1,
  operation: 'delete',
};

/** Inject a mock ASTApiService into a fresh engine (the field is private). */
function engineWithMockApi(): { engine: CanvasEngine; api: MockASTApiService } {
  const api = new MockASTApiService();
  const engine = new CanvasEngine({ debug: false });
  (engine as unknown as { api: ASTApiService }).api = api;
  return { engine, api };
}

describe('CanvasEngine map-op dispatcher (HYP-290c)', () => {
  it('dispatchMapSampleArrayOp executes + records the HYP-290d op on success', async () => {
    const { engine, api } = engineWithMockApi();

    const accepted = await engine.dispatchMapSampleArrayOp(domParams);

    expect(accepted).toBe(true);
    expect(api.getCallCount('mapSampleArrayOp')).toBe(1);
    expect(api.wasCalledWith('mapSampleArrayOp', { itemIndex: 1, operation: 'delete' })).toBe(true);
    // Recorded in history → undoable.
    expect(engine.getHistoryState().canUndo).toBe(true);
  });

  it('dispatchMapSampleArrayOp does NOT record when the server refuses the op', async () => {
    const { engine, api } = engineWithMockApi();
    api.mapSampleArrayOpResult = { success: false, error: 'not props-from-sample' };

    const accepted = await engine.dispatchMapSampleArrayOp(domParams);

    expect(accepted).toBe(false);
    expect(api.getCallCount('mapSampleArrayOp')).toBe(1);
    // A refused op must not pollute history (the switch re-applies JSX instead).
    expect(engine.getHistoryState().canUndo).toBe(false);
  });

  it('dispatchMapLiteralArrayOp executes + records the HYP-290e op on success', async () => {
    const { engine, api } = engineWithMockApi();

    const accepted = await engine.dispatchMapLiteralArrayOp(literalParams);

    expect(accepted).toBe(true);
    expect(api.getCallCount('mapLiteralArrayOp')).toBe(1);
    expect(api.wasCalledWith('mapLiteralArrayOp', { itemIndex: 1, operation: 'delete' })).toBe(true);
    // The literal op must NOT touch the sample route.
    expect(api.getCallCount('mapSampleArrayOp')).toBe(0);
    expect(engine.getHistoryState().canUndo).toBe(true);
  });

  it('dispatchMapLiteralArrayOp does NOT record when the server refuses the op', async () => {
    const { engine, api } = engineWithMockApi();
    api.mapLiteralArrayOpResult = { success: false, error: 'not literal-array' };

    const accepted = await engine.dispatchMapLiteralArrayOp(literalParams);

    expect(accepted).toBe(false);
    expect(api.getCallCount('mapLiteralArrayOp')).toBe(1);
    expect(engine.getHistoryState().canUndo).toBe(false);
  });

  it('controller routes the DOM dispatch through a caller-supplied applyDom (literal op)', async () => {
    const { engine, api } = engineWithMockApi();

    const controller = engine.createMapOpDispatchController({
      operation: 'delete',
      domEnabled: true,
      domParams: literalParams,
      // HYP-290h: the hook decides the route; the engine no longer hardwires the sample op.
      applyDom: () => engine.dispatchMapLiteralArrayOp(literalParams),
      applyJsx: () => engine.deleteASTElement('jsx-target', '/test/List.tsx'),
    });
    controller.start();
    await controller.switchToDom();

    expect(api.getCallCount('mapLiteralArrayOp')).toBe(1);
    expect(api.getCallCount('mapSampleArrayOp')).toBe(0);
    expect(controller.getState().status).toBe('dom');
  });

  it('controller applies JSX immediately and arms the switch window', () => {
    const { engine } = engineWithMockApi();
    let jsxCalls = 0;

    const controller = engine.createMapOpDispatchController({
      operation: 'delete',
      domEnabled: true,
      domParams,
      applyJsx: () => {
        jsxCalls++;
      },
    });
    controller.start();

    expect(jsxCalls).toBe(1);
    expect(controller.getState().status).toBe('open');
    expect(controller.getState().domEnabled).toBe(true);
  });

  it('switch within window undoes JSX then dispatches the DOM op (HYP-290d)', async () => {
    const { engine, api } = engineWithMockApi();
    let jsxCalls = 0;

    const controller = engine.createMapOpDispatchController({
      operation: 'delete',
      domEnabled: true,
      domParams,
      applyJsx: () => {
        // Stand-in JSX op: record a real op so the engine has something to undo.
        jsxCalls++;
        engine.deleteASTElement('jsx-target', '/test/List.tsx');
      },
    });
    controller.start();
    expect(jsxCalls).toBe(1);

    await controller.switchToDom();

    // JSX delete was dispatched then undone; DOM op dispatched + accepted.
    expect(api.getCallCount('deleteElement')).toBe(1);
    expect(api.getCallCount('mapSampleArrayOp')).toBe(1);
    expect(controller.getState().status).toBe('dom');
    // The DOM op is the clean history head; the JSX delete was dropped from redo.
    expect(engine.getHistoryState().canUndo).toBe(true);
    expect(engine.getHistoryState().canRedo).toBe(false);
  });

  it('refused DOM op re-applies the JSX delete (no data loss, JSX restored)', async () => {
    const { engine, api } = engineWithMockApi();
    api.mapSampleArrayOpResult = { success: false, error: 'not props-from-sample' };

    const controller = engine.createMapOpDispatchController({
      operation: 'delete',
      domEnabled: true, // client heuristic said eligible, but the server reclassifies
      domParams,
      applyJsx: () => engine.deleteASTElement('jsx-target', '/test/List.tsx'),
    });
    controller.start();

    await controller.switchToDom();

    // DOM op attempted + refused; JSX delete re-applied via redo (not recorded as DOM).
    expect(api.getCallCount('mapSampleArrayOp')).toBe(1);
    expect(controller.getState().status).toBe('closed');
    // The JSX delete is back on the stack (redo restored it) — the delete is preserved.
    expect(engine.getHistoryState().canUndo).toBe(true);
  });

  it('CRITICAL: the JSX restore completes BEFORE the DOM op dispatches (no race)', async () => {
    // The DOM route re-reads the component source to re-classify the receiver. If the
    // JSX delete/restore is still in flight the route races a half-written file. Hold
    // the delete write in-flight, fire the switch, and assert the restore (insertElement)
    // lands before mapSampleArrayOp — proving CanvasEngine.undo() awaits the delete op's
    // `_pendingPromise`. (The mocks otherwise resolve instantly and never exercise this.)
    const { engine, api } = engineWithMockApi();

    // Seed a real AST node so storeElementForUndo succeeds → undo actually restores.
    const root = engine.getRoot();
    root.metadata = {
      ...root.metadata,
      astStructure: [{ id: 'real-node', type: 'Card', props: {}, children: [] }],
    };

    let releaseDelete: () => void = () => {};
    api.deleteElementGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });

    const controller = engine.createMapOpDispatchController({
      operation: 'delete',
      domEnabled: true,
      domParams,
      applyJsx: () => engine.deleteASTElement('real-node', '/test/List.tsx'),
    });
    controller.start();

    // Fire the switch while the delete write is still gated.
    const switched = controller.switchToDom();
    // Release the delete so the restore (insertElement) can proceed.
    releaseDelete();
    await switched;

    // Ordering: the restore's insertElement must precede mapSampleArrayOp.
    const insertIdx = api.calls.findIndex((c) => c.method === 'insertElement');
    const domIdx = api.calls.findIndex((c) => c.method === 'mapSampleArrayOp');
    expect(insertIdx).toBeGreaterThanOrEqual(0);
    expect(domIdx).toBeGreaterThanOrEqual(0);
    expect(insertIdx).toBeLessThan(domIdx);
    expect(controller.getState().status).toBe('dom');
  });

  it('disabled DOM toggle (category != 1) refuses the switch — JSX kept', async () => {
    const { engine, api } = engineWithMockApi();

    const controller = engine.createMapOpDispatchController({
      operation: 'delete',
      domEnabled: false,
      domParams,
      applyJsx: () => {
        engine.deleteASTElement('jsx-target', '/test/List.tsx');
      },
    });
    controller.start();
    await controller.switchToDom();

    expect(api.getCallCount('mapSampleArrayOp')).toBe(0);
    expect(controller.getState().status).toBe('open');
  });
});
