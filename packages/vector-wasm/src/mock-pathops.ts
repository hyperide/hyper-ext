/**
 * @file Mock PathOps backend for unit tests
 *
 * Accessed via: Unit tests and development — stands in for WASM backend until Rust binding is ready
 * Assumptions: consumers only care that data flows through the graph correctly, not geometric precision
 */

import type { PathValue } from 'vector-engine';
import type { BooleanOp, PathOpsBackend } from './types';

export class MockPathOps implements PathOpsBackend {
  boolean(_op: BooleanOp, a: PathValue, b: PathValue): PathValue {
    const combined = new Float64Array(a.commands.length + b.commands.length);
    combined.set(a.commands);
    combined.set(b.commands, a.commands.length);
    return { commands: combined, closed: a.closed || b.closed };
  }

  simplify(path: PathValue, _tolerance: number): PathValue {
    return path;
  }

  flatten(path: PathValue, _maxError: number): PathValue {
    return path;
  }

  strokeToPath(path: PathValue, _width: number, _cap: string, _join: string): PathValue {
    return { ...path, closed: true };
  }

  dash(path: PathValue, _dashArray: number[], _dashOffset: number): PathValue {
    return path;
  }

  offset(path: PathValue, _distance: number): PathValue {
    return path;
  }

  removeSelfIntersections(path: PathValue): PathValue {
    return path;
  }
}
