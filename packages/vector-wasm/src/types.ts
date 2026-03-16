/**
 * @file PathOpsBackend — abstraction over WASM path operations
 *
 * Accessed via: import { PathOpsBackend } from 'vector-wasm'
 */

import type { PathValue } from 'vector-engine';

export type BooleanOp = 'union' | 'subtract' | 'intersect' | 'xor';

export interface PathOpsBackend {
  boolean(op: BooleanOp, a: PathValue, b: PathValue): PathValue;
  simplify(path: PathValue, tolerance: number): PathValue;
  flatten(path: PathValue, maxError: number): PathValue;
  strokeToPath(
    path: PathValue,
    width: number,
    cap: 'butt' | 'round' | 'square',
    join: 'miter' | 'round' | 'bevel',
  ): PathValue;
  dash(path: PathValue, dashArray: number[], dashOffset: number): PathValue;
}
