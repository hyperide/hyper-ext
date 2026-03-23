/**
 * @file Curve fitting — convert point array to smooth bezier path
 *
 * Accessed via: Deformation nodes — re-fit curves after operating on flattened vertices
 * Assumptions: input points are ordered and reasonably spaced
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Curve Utilities
 */

import fitCurveLib from 'fit-curve';
import { PathBuilder } from '../path/builder';
import type { PathValue, Point } from '../types';

/**
 * Fit smooth cubic bezier curves through an ordered array of points.
 *
 * @param points - Input polyline vertices, in order
 * @param error - Max squared distance tolerance passed to fit-curve
 * @param closed - Whether the output path should be closed. When omitted,
 *   falls back to endpoint-coincidence heuristic (first ≈ last within 0.01).
 *   Pass `true` explicitly when fitting a flattened closed path whose first
 *   point was NOT duplicated at the end.
 */
export function fitCurve(points: Point[], error: number, closed?: boolean): PathValue {
  if (points.length < 2) {
    return new PathBuilder().build();
  }

  const input = points.map((p) => [p.x, p.y] as [number, number]);
  const beziers = fitCurveLib(input, error);
  const builder = new PathBuilder();

  if (beziers.length > 0) {
    builder.moveTo(beziers[0][0][0], beziers[0][0][1]);
    for (const [, cp1, cp2, p3] of beziers) {
      builder.cubicTo(cp1[0], cp1[1], cp2[0], cp2[1], p3[0], p3[1]);
    }
  }

  // Explicit closed flag takes priority; fall back to endpoint-coincidence heuristic
  const first = points[0];
  const last = points[points.length - 1];
  const isClosed =
    closed ??
    (first !== undefined &&
      last !== undefined &&
      Math.abs(first.x - last.x) < 0.01 &&
      Math.abs(first.y - last.y) < 0.01);
  if (isClosed) builder.close();

  return builder.build();
}
