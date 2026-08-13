/**
 * MapOpDispatchController unit tests (HYP-290c — dual-mode JSX/DOM toast UX).
 *
 * The controller owns the dual-mode decision for a structural op on a `.map()`
 * iteration: JSX mode is applied immediately (default, current behavior), a toast
 * exposes a DOM toggle, and a ~3s window lets the user switch to DOM — which undoes
 * the JSX op (awaited) and dispatches the HYP-290d data-mode op. A REFUSED DOM op
 * (server reclassifies the receiver) re-applies the JSX delete so it is never lost.
 *
 * Framework-agnostic + timer-injectable so the acceptance is a reducer/state test
 * (spec: "no e2e required for green").
 */

import { describe, expect, it } from 'bun:test';
import { MapOpDispatchController, type MapOpDomParams } from '../core/MapOpDispatchController';
import type { MapSampleArrayOpParams } from '../services/ASTApiService';

/** A controllable timer the controller calls instead of real setTimeout. */
function makeFakeTimer() {
  let pending: (() => void) | null = null;
  return {
    schedule(cb: () => void): () => void {
      pending = cb;
      return () => {
        pending = null;
      };
    },
    fire(): void {
      const cb = pending;
      pending = null;
      cb?.();
    },
    get isArmed() {
      return pending !== null;
    },
  };
}

const domParams: MapSampleArrayOpParams = {
  filePath: '/test/List.samples.tsx',
  componentFilePath: '/test/List.tsx',
  sampleName: 'SampleDefault',
  mapExpression: 'items',
  itemIndex: 1,
  operation: 'delete',
};

interface Recorder {
  order: string[];
  jsxCalls: number;
  undoCalls: number;
  redoCalls: number;
  domCalls: MapOpDomParams[];
}

function makeController(opts?: { domEnabled?: boolean; domAccepts?: boolean }) {
  const rec: Recorder = { order: [], jsxCalls: 0, undoCalls: 0, redoCalls: 0, domCalls: [] };
  const timer = makeFakeTimer();
  const controller = new MapOpDispatchController({
    operation: 'delete',
    domEnabled: opts?.domEnabled ?? true,
    domParams,
    applyJsx: () => {
      rec.jsxCalls++;
      rec.order.push('jsx');
    },
    undoJsx: () => {
      rec.undoCalls++;
      rec.order.push('undo');
    },
    applyDom: async (params) => {
      rec.domCalls.push(params);
      rec.order.push('dom');
      return opts?.domAccepts ?? true;
    },
    redoJsx: () => {
      rec.redoCalls++;
      rec.order.push('redo');
    },
    windowMs: 3000,
    schedule: timer.schedule,
  });
  return { controller, rec, timer };
}

describe('MapOpDispatchController (HYP-290c)', () => {
  it('applies the JSX op immediately on start (default mode)', () => {
    const { controller, rec, timer } = makeController();

    controller.start();

    expect(rec.jsxCalls).toBe(1);
    expect(rec.domCalls).toHaveLength(0);
    expect(timer.isArmed).toBe(true);
    expect(controller.getState().status).toBe('open');
  });

  it('exposes toast state with the DOM toggle enabled for category 1', () => {
    const { controller } = makeController({ domEnabled: true });
    controller.start();

    const state = controller.getState();
    expect(state.operation).toBe('delete');
    expect(state.domEnabled).toBe(true);
  });

  it('disables the DOM toggle when not props-from-sample (category != 1)', () => {
    const { controller } = makeController({ domEnabled: false });
    controller.start();

    expect(controller.getState().domEnabled).toBe(false);
  });

  it('switchToDom within the window undoes the JSX op THEN dispatches the DOM op', async () => {
    const { controller, rec } = makeController();
    controller.start();
    expect(rec.jsxCalls).toBe(1);

    await controller.switchToDom();

    // Undo must precede the DOM dispatch (server re-reads the restored source).
    expect(rec.order).toEqual(['jsx', 'undo', 'dom']);
    expect(rec.domCalls[0]).toEqual(domParams);
    expect(rec.redoCalls).toBe(0);
    expect(controller.getState().status).toBe('dom');
  });

  it('re-applies the JSX op when the server REFUSES the DOM op (no data loss)', async () => {
    const { controller, rec } = makeController({ domAccepts: false });
    controller.start();

    await controller.switchToDom();

    // undo → dom (refused) → redo restores the JSX delete.
    expect(rec.order).toEqual(['jsx', 'undo', 'dom', 'redo']);
    expect(rec.redoCalls).toBe(1);
    expect(controller.getState().status).toBe('closed');
  });

  it('letting the window lapse keeps the JSX result (no undo, no DOM op)', () => {
    const { controller, rec, timer } = makeController();
    controller.start();

    timer.fire();

    expect(rec.undoCalls).toBe(0);
    expect(rec.domCalls).toHaveLength(0);
    expect(controller.getState().status).toBe('closed');
  });

  it('switchToDom after lapse is a no-op (window closed)', async () => {
    const { controller, rec, timer } = makeController();
    controller.start();
    timer.fire(); // window closed

    await controller.switchToDom();

    expect(rec.undoCalls).toBe(0);
    expect(rec.domCalls).toHaveLength(0);
    expect(controller.getState().status).toBe('closed');
  });

  it('switchToDom is rejected when the DOM toggle is disabled', async () => {
    const { controller, rec } = makeController({ domEnabled: false });
    controller.start();

    await controller.switchToDom();

    expect(rec.undoCalls).toBe(0);
    expect(rec.domCalls).toHaveLength(0);
    expect(controller.getState().status).toBe('open');
  });

  it('switchToDom is idempotent — a concurrent second call does not re-dispatch', async () => {
    const { controller, rec } = makeController();
    controller.start();

    const first = controller.switchToDom();
    // Second call while the first is in flight (status 'switching') must be ignored.
    await controller.switchToDom();
    await first;

    expect(rec.undoCalls).toBe(1);
    expect(rec.domCalls).toHaveLength(1);
  });

  it('dismiss closes the window and cancels the timer (keeps JSX)', () => {
    const { controller, rec, timer } = makeController();
    controller.start();

    controller.dismiss();

    expect(timer.isArmed).toBe(false);
    expect(controller.getState().status).toBe('closed');
    expect(rec.undoCalls).toBe(0);
    expect(rec.domCalls).toHaveLength(0);
  });

  it('switching to DOM cancels the lapse timer (no double-finalize)', async () => {
    const { controller, timer } = makeController();
    controller.start();

    await controller.switchToDom();

    expect(timer.isArmed).toBe(false);
  });

  it('captures DOM params at start — switch uses them even after selection would clear', async () => {
    // The engine clears selection right after the JSX delete; the controller must
    // hold the params captured at start, never re-read live selection on the switch.
    const { controller, rec } = makeController();
    controller.start();

    domParams.itemIndex = 999;
    await controller.switchToDom();
    domParams.itemIndex = 1; // restore for other tests

    expect(rec.domCalls[0].itemIndex).toBe(1);
  });
});
