/**
 * Minimal time-gate for high-frequency webview telemetry (hover, scroll).
 *
 * WHAT: `createThrottleGate(windowMs)` returns a predicate `shouldEmit(now)` that
 * returns true on the first call and then suppresses until `windowMs` has elapsed
 * since the last allowed call. No trailing edge, no buffering — a hover stream
 * that fires hundreds of times per second collapses to ~one event per window.
 * HOW REACHED: `useCanvasInteraction` gates `canvas.elementHovered` through it.
 * INVARIANT: pure aside from the captured `last` timestamp; `now` is injected so
 * tests use a fake clock. No `Date.now()` inside.
 * PII RULE: carries no event data at all — it only decides whether to emit.
 */

/** A stateful predicate: true to emit, false to suppress within the window. */
export type ThrottleGate = (now: number) => boolean;

/**
 * Build a leading-edge throttle gate. Emits the first call, then suppresses
 * further calls until `windowMs` has elapsed since the last emitted one.
 */
export function createThrottleGate(windowMs: number): ThrottleGate {
  let last = Number.NEGATIVE_INFINITY;
  return (now: number): boolean => {
    if (now - last >= windowMs) {
      last = now;
      return true;
    }
    return false;
  };
}
