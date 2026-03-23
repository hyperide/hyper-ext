/**
 * @file Nearest point on path — find closest point and distance
 *
 * Accessed via: Snap-to-path, selection distance ranking
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import type { PathValue, Point } from '../types';
import { flattenPath } from './flatten';
import { dist } from './math';

export interface NearestResult {
  point: Point;
  distance: number;
  /** Normalized offset along the path, 0..1 */
  offset: number;
}

export function nearestPointOnPath(point: Point, path: PathValue): NearestResult {
  const points = flattenPath(path.commands, 0.5);
  if (points.length === 0) {
    return { point: { x: 0, y: 0 }, distance: Infinity, offset: 0 };
  }
  if (points.length === 1) {
    return {
      point: points[0],
      distance: dist(point.x, point.y, points[0].x, points[0].y),
      offset: 0,
    };
  }

  // First pass: compute total length
  let totalLen = 0;
  for (let i = 1; i < points.length; i++) {
    totalLen += dist(points[i - 1].x, points[i - 1].y, points[i].x, points[i].y);
  }

  // Second pass: find nearest point
  let bestDist = Infinity;
  let bestPoint: Point = points[0];
  let bestOffset = 0;
  let accLen = 0;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const segLen = dist(a.x, a.y, b.x, b.y);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((point.x - a.x) * dx + (point.y - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj = { x: a.x + t * dx, y: a.y + t * dy };
    const d = dist(point.x, point.y, proj.x, proj.y);
    if (d < bestDist) {
      bestDist = d;
      bestPoint = proj;
      bestOffset = totalLen > 0 ? (accLen + t * segLen) / totalLen : 0;
    }
    accLen += segLen;
  }

  return { point: bestPoint, distance: bestDist, offset: bestOffset };
}
