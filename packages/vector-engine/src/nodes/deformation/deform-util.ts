/**
 * @file Shared deformation result builder — converts displaced point arrays to PathValue
 *
 * Internal module, not exposed
 */

import { fitCurve } from '../../curve/fit';
import { PathBuilder } from '../../path/builder';
import type { PathValue, Point } from '../../types';

/**
 * Build a PathValue from displaced points.
 *
 * When type is 'smooth', uses curve-fitting to produce bezier output.
 * When type is 'corner', connects points with straight line segments.
 */
export function deformResult(points: Point[], type: string, fitError: number): PathValue {
  if (type === 'smooth' && points.length >= 2) {
    return fitCurve(points, fitError);
  }
  const builder = new PathBuilder();
  if (points.length > 0) {
    builder.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      builder.lineTo(points[i].x, points[i].y);
    }
  }
  return builder.build();
}
