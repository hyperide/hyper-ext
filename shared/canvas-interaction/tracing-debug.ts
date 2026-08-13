/**
 * @file Once-per-key console.debug for element-tracing silent-death points.
 *
 * Accessed via: overlay-rects.ts (shared RAF loop), client ElementTracer.findDOMElements
 * Assumptions: Callers run inside RAF/hot loops — an unconditional console.debug per frame
 *   would flood the console, so each key logs once until explicitly cleared on success.
 */

const MAX_TRACKED_KEYS = 1000;

const loggedKeys = new Set<string>();

/** Log a '[tracing]'-prefixed console.debug once per key (until cleared). */
export function tracingDebugOnce(key: string, message: string, ...args: unknown[]): void {
  if (loggedKeys.has(key)) return;
  // Hard cap so a pathological id churn can't grow the set unboundedly.
  if (loggedKeys.size >= MAX_TRACKED_KEYS) loggedKeys.clear();
  loggedKeys.add(key);
  // Prefix passed as a separate literal argument (not a template) so the console
  // format string stays constant (semgrep unsafe-formatstring); output is identical.
  console.debug('[tracing]', message, ...args);
}

/** Re-arm a key after the condition resolves, so a later regression logs again. */
export function clearTracingDebugOnce(key: string): void {
  loggedKeys.delete(key);
}
