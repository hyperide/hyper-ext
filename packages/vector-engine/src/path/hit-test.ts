/**
 * @file Hit testing — point-in-path and point-on-stroke
 *
 * Accessed via: Selection tool click — determines which shape was clicked
 * Tradeoffs: uses flattened polyline for hit testing (not exact curve geometry).
 *   Tolerance 0.5px provides pixel-accurate results at normal zoom levels.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import type { PathValue, Point } from '../types';
import { flattenPath } from './flatten';
import { dist } from './math';

/**
 * Test if a point is inside a closed path using ray casting (even-odd rule).
 * Returns false for open paths.
 */
export function pointInPath(point: Point, path: PathValue): boolean {
  if (!path.closed) return false;
  const points = flattenPath(path.commands, 0.5);
  if (points.length < 3) return false;

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x;
    const yi = points[i].y;
    const xj = points[j].x;
    const yj = points[j].y;
    if (yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Test if a point is within `tolerance` distance of any path segment.
 */
export function pointOnStroke(point: Point, path: PathValue, tolerance: number): boolean {
  const points = flattenPath(path.commands, 0.5);
  if (points.length < 2) return false;
  for (let i = 1; i < points.length; i++) {
    const d = distToSegment(point, points[i - 1], points[i]);
    if (d <= tolerance) return true;
  }
  return false;
}

function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p.x, p.y, a.x, a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return dist(p.x, p.y, a.x + t * dx, a.y + t * dy);
}
