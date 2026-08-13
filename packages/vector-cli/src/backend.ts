/**
 * @file Real PathOps backend bootstrap for the CLI
 *
 * Accessed via: bin/vecli.ts (batch + TUI entrypoints) — awaited once at startup.
 * Assumptions: CanvasKit WASM (~1.4 MB) loads on every CLI invocation, even for a
 *   plain `rect()` with no boolean/offset op. This is the accepted tradeoff for
 *   keeping createContext + the chainable DSL synchronous: initCanvasKit() is
 *   async, so the one async boundary lives here at the already-async entrypoint,
 *   not threaded through every sync node execution.
 * Tradeoffs: CanvasKitPathOps drives boolean / strokeToPath / dash / simplify;
 *   OffsetPathOps wraps it to drive offset() via the Clipper polygon algorithm
 *   (CanvasKit has no native polygon offset — its stroke+boolean approximation is
 *   worse). If WASM fails to load we throw — NOT silently fall back to MockPathOps,
 *   because a mock fallback recreates the exact GAP-1 bug (ops return wrong
 *   geometry with no signal).
 */

import { CanvasKitPathOps, initCanvasKit, OffsetPathOps, type PathOpsBackend } from 'vector-wasm';

/**
 * Load CanvasKit WASM and build the production PathOps backend. Throws if the
 * WASM module cannot initialize — callers must surface the failure, never
 * downgrade to the no-op mock.
 */
export async function createPathOpsBackend(): Promise<PathOpsBackend> {
  const ck = await initCanvasKit();
  return new OffsetPathOps(new CanvasKitPathOps(ck));
}
