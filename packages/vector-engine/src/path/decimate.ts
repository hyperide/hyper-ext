/**
 * @file Polyline point-decimation — Ramer-Douglas-Peucker and Visvalingam-Whyatt
 *
 * Accessed via: simplify node (nodes/path-ops/simplify.ts) and the CLI .simplify() chainable.
 * Assumptions: inputs are flat polylines (Point[]); curves must be flattened first
 *   (path/flatten.ts). Endpoints are always preserved. This is point-reduction, which is
 *   distinct from the WASM geometric simplify (self-intersection removal in
 *   vector-wasm/canvaskit-pathops.ts) — keep both, they solve different problems.
 * Tradeoffs: RDP is recursive and gives a hard max-deviation guarantee (every dropped point
 *   lies within `epsilon` of the simplified polyline). VW is area-greedy and tends to keep
 *   visually salient vertices but gives no per-point deviation bound.
 * Architecture: docs/specs/2026-06-03-vecli-vector-cli-decomposition.md §VECLI-3
 */

import type { Point } from '../types';

/** Perpendicular distance from point `p` to the segment `a`→`b`. */
function perpendicularDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/**
 * Ramer-Douglas-Peucker polyline decimation.
 *
 * Recursively keeps the point that deviates most from the chord between the current
 * endpoints; if that maximum deviation is within `epsilon`, the whole run between the
 * endpoints is dropped. Endpoints are always preserved.
 *
 * @param points  the input polyline
 * @param epsilon max allowed perpendicular deviation; `0` returns the input unchanged
 * @returns a new decimated polyline (every dropped point lies within `epsilon` of the result)
 */
export function decimateRDP(points: Point[], epsilon: number): Point[] {
  if (points.length < 3 || epsilon <= 0) return points.slice();

  const keep: boolean[] = Array.from({ length: points.length }, () => false);
  keep[0] = true;
  keep[points.length - 1] = true;

  // Iterative stack to avoid deep recursion on dense polylines.
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const segment = stack.pop();
    if (!segment) break;
    const [start, end] = segment;
    if (end - start < 2) continue;

    let maxDist = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i++) {
      const dist = perpendicularDistance(points[i], points[start], points[end]);
      if (dist > maxDist) {
        maxDist = dist;
        maxIndex = i;
      }
    }

    if (maxDist > epsilon && maxIndex !== -1) {
      keep[maxIndex] = true;
      stack.push([start, maxIndex]);
      stack.push([maxIndex, end]);
    }
  }

  const out: Point[] = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

/** Twice the signed area of triangle (a, b, c) — the "effective area" of vertex `b`. */
function triangleArea(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
}

/**
 * Visvalingam-Whyatt polyline decimation.
 *
 * Repeatedly removes the interior vertex whose triangle (with its two current neighbours)
 * has the smallest area, until the smallest remaining effective area exceeds
 * `areaThreshold`. Endpoints are always preserved.
 *
 * @param points        the input polyline
 * @param areaThreshold minimum effective triangle area to keep a vertex; `0` returns input
 * @returns a new decimated polyline
 */
export function decimateVW(points: Point[], areaThreshold: number): Point[] {
  if (points.length < 3 || areaThreshold <= 0) return points.slice();

  // Doubly linked list over indices so neighbour lookups stay O(1) after removals.
  const n = points.length;
  const prev: number[] = Array.from({ length: n }, () => 0);
  const next: number[] = Array.from({ length: n }, () => 0);
  const alive: boolean[] = Array.from({ length: n }, () => true);
  for (let i = 0; i < n; i++) {
    prev[i] = i - 1;
    next[i] = i + 1;
  }
  next[n - 1] = -1;

  const effectiveArea = (i: number): number => triangleArea(points[prev[i]], points[i], points[next[i]]);

  while (true) {
    let minArea = Infinity;
    let minIndex = -1;
    for (let i = 1; i < n - 1; i++) {
      if (!alive[i] || prev[i] < 0 || next[i] < 0) continue;
      const area = effectiveArea(i);
      if (area < minArea) {
        minArea = area;
        minIndex = i;
      }
    }
    if (minIndex === -1 || minArea >= areaThreshold) break;

    // Remove minIndex from the chain.
    alive[minIndex] = false;
    next[prev[minIndex]] = next[minIndex];
    prev[next[minIndex]] = prev[minIndex];
  }

  const out: Point[] = [];
  for (let i = 0; i >= 0 && i < n; i = next[i]) {
    if (alive[i]) out.push(points[i]);
  }
  return out;
}
