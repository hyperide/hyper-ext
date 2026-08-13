/**
 * DissatisfactionDetector unit tests — pure logic, deterministic clock.
 *
 * Run with: cd vscode-extension/hypercanvas-preview && bun test src/telemetry/
 */

import { describe, expect, it } from 'bun:test';
import { DissatisfactionDetector } from '../dissatisfaction';
import { TelemetryEvents } from '../events';

describe('DissatisfactionDetector.quickUndo', () => {
  it('fires when undo follows apply within the threshold', () => {
    const d = new DissatisfactionDetector();
    d.onApply('canvasWrap', 1000);
    const out = d.onUndo(3000); // 2000ms <= 5000ms
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe(TelemetryEvents.dissatisfactionQuickUndo);
    expect(out[0].props.action).toBe('canvasWrap');
    expect(out[0].props.elapsedMs).toBe(2000);
  });

  it('does NOT fire when undo is outside the threshold', () => {
    const d = new DissatisfactionDetector();
    d.onApply('canvasWrap', 1000);
    const out = d.onUndo(9000); // 8000ms > 5000ms
    expect(out).toHaveLength(0);
  });

  it('does NOT double-fire on a second undo (apply consumed)', () => {
    const d = new DissatisfactionDetector();
    d.onApply('apply', 1000);
    expect(d.onUndo(2000)).toHaveLength(1);
    expect(d.onUndo(2500)).toHaveLength(0);
  });

  it('does nothing when there was no prior apply', () => {
    const d = new DissatisfactionDetector();
    expect(d.onUndo(5000)).toHaveLength(0);
  });
});

describe('DissatisfactionDetector.retryLoop', () => {
  it('fires at count >= threshold within the window', () => {
    const d = new DissatisfactionDetector();
    expect(d.onInvoke('ai-regenerate', 0)).toHaveLength(0); // count 1
    expect(d.onInvoke('ai-regenerate', 1000)).toHaveLength(0); // count 2
    const out = d.onInvoke('ai-regenerate', 2000); // count 3 -> fire
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe(TelemetryEvents.dissatisfactionRetryLoop);
    expect(out[0].props.count).toBe(3);
  });

  it('does not re-fire on the same window after first trip', () => {
    const d = new DissatisfactionDetector();
    d.onInvoke('cmd', 0);
    d.onInvoke('cmd', 100);
    expect(d.onInvoke('cmd', 200)).toHaveLength(1);
    expect(d.onInvoke('cmd', 300)).toHaveLength(0); // count 4, already fired
  });

  it('resets the counter once the window expires', () => {
    const d = new DissatisfactionDetector();
    d.onInvoke('cmd', 0);
    d.onInvoke('cmd', 1000);
    // 40s later: outside the 30s window -> counter resets to 1
    expect(d.onInvoke('cmd', 41000)).toHaveLength(0);
    expect(d.onInvoke('cmd', 41500)).toHaveLength(0); // count 2
    expect(d.onInvoke('cmd', 42000)).toHaveLength(1); // count 3 -> fire
  });

  it('a success clears the loop (broken)', () => {
    const d = new DissatisfactionDetector();
    d.onInvoke('cmd', 0);
    d.onInvoke('cmd', 100);
    d.onSuccess('cmd');
    expect(d.onInvoke('cmd', 200)).toHaveLength(0); // counter was reset
  });
});

describe('DissatisfactionDetector.errorThenQuit', () => {
  it('fires when an error precedes session end within the window', () => {
    const d = new DissatisfactionDetector();
    d.onError(1000);
    const out = d.onSessionEnd(6000); // 5000ms <= 10000ms
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe(TelemetryEvents.dissatisfactionErrorThenQuit);
    expect(out[0].props.sinceErrorMs).toBe(5000);
  });

  it('does NOT fire when the error is too old', () => {
    const d = new DissatisfactionDetector();
    d.onError(1000);
    expect(d.onSessionEnd(20000)).toHaveLength(0); // 19000ms > 10000ms
  });

  it('does nothing when there was no error', () => {
    const d = new DissatisfactionDetector();
    expect(d.onSessionEnd(5000)).toHaveLength(0);
  });
});
