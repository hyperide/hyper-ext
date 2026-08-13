/**
 * Unit test for the webview telemetry throttle gate.
 *
 * Run via the extension suite: `bun test src/__tests__/`
 *
 * The gate is leading-edge: emit the first call, suppress within the window,
 * emit again after the window elapses. `now` is injected so we drive a fake clock
 * deterministically — no real timers.
 */

import { describe, expect, it } from 'bun:test';
import { createThrottleGate } from '../webview-preview-panel/telemetry-throttle';

describe('createThrottleGate', () => {
  it('emits the very first call', () => {
    const gate = createThrottleGate(2000);
    expect(gate(0)).toBe(true);
  });

  it('suppresses calls inside the window', () => {
    const gate = createThrottleGate(2000);
    expect(gate(1000)).toBe(true);
    expect(gate(1500)).toBe(false);
    expect(gate(2999)).toBe(false);
  });

  it('emits again once the window has elapsed since the last emit', () => {
    const gate = createThrottleGate(2000);
    expect(gate(1000)).toBe(true); // emit, last=1000
    expect(gate(2500)).toBe(false); // within window
    expect(gate(3000)).toBe(true); // 3000-1000 >= 2000 -> emit, last=3000
    expect(gate(4000)).toBe(false); // within new window
    expect(gate(5000)).toBe(true); // 5000-3000 >= 2000 -> emit
  });

  it('treats the boundary (exactly windowMs later) as emit-eligible', () => {
    const gate = createThrottleGate(2000);
    expect(gate(0)).toBe(true);
    expect(gate(2000)).toBe(true); // 2000-0 === 2000 -> >= window
  });
});
