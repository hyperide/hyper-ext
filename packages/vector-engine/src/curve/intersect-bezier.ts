/**
 * @file Curve intersection algorithms — line x line, line x cubic, cubic x cubic
 *
 * Accessed via: splitIntersections() — resolves segment crossings for topology solver
 * Tradeoffs: cubic x cubic uses recursive subdivision with bbox culling.
 *   Converges in ~10 iterations for well-separated curves.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Curve Utilities
 */

import type { Point } from '../types';

export interface IntersectionHit {
  point: Point;
  /** Parameter on first curve (0..1) */
  t1: number;
  /** Parameter on second curve (0..1) */
  t2: number;
}

/** Max distance of control points from chord to consider a cubic "flat enough" */
const FLATNESS_EPSILON = 0.5;

/** Minimum parameter range to keep subdividing */
const T_EPSILON = 1e-8;

/** Distance threshold for deduplicating intersection hits */
const DEDUP_DISTANCE = 1e-4;

/** Max recursion depth for subdivision algorithms */
const MAX_DEPTH = 50;

// -- Line x Line --

/**
 * Find intersection of two line segments using cross-product method.
 *
 * Solves: t1 = cross(q-p, s) / cross(r, s), t2 = cross(q-p, r) / cross(r, s)
 * where p,r = first line start/direction, q,s = second line start/direction.
 */
export function intersectLineLine(p0: Point, p1: Point, q0: Point, q1: Point): IntersectionHit[] {
  const rx = p1.x - p0.x;
  const ry = p1.y - p0.y;
  const sx = q1.x - q0.x;
  const sy = q1.y - q0.y;

  const denom = rx * sy - ry * sx;
  if (Math.abs(denom) < 1e-12) return []; // parallel or collinear

  const dx = q0.x - p0.x;
  const dy = q0.y - p0.y;

  const t1 = (dx * sy - dy * sx) / denom;
  const t2 = (dx * ry - dy * rx) / denom;

  if (t1 < -T_EPSILON || t1 > 1 + T_EPSILON) return [];
  if (t2 < -T_EPSILON || t2 > 1 + T_EPSILON) return [];

  const ct1 = clamp01(t1);
  const ct2 = clamp01(t2);

  return [
    {
      point: { x: p0.x + ct1 * rx, y: p0.y + ct1 * ry },
      t1: ct1,
      t2: ct2,
    },
  ];
}

// -- Line x Cubic --

/**
 * Find intersections of a line segment with a cubic bezier curve.
 * Uses recursive subdivision of the cubic with bbox culling.
 */
export function intersectLineCubic(
  l0: Point,
  l1: Point,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
): IntersectionHit[] {
  const hits: IntersectionHit[] = [];
  intersectLineCubicRec(l0, l1, p0, p1, p2, p3, 0, 1, 0, hits);
  return deduplicateHits(hits);
}

function intersectLineCubicRec(
  l0: Point,
  l1: Point,
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  tMin: number,
  tMax: number,
  depth: number,
  hits: IntersectionHit[],
): void {
  // Check if line bbox overlaps cubic bbox
  if (!bboxOverlap(lineBbox(l0, l1), cubicBbox(p0, p1, p2, p3))) return;

  if (depth > MAX_DEPTH) return;

  const tRange = tMax - tMin;
  if (tRange < T_EPSILON) return;

  // If cubic is flat enough, approximate as line and intersect
  if (isFlatEnough(p0, p1, p2, p3)) {
    const lineHits = intersectLineLine(l0, l1, p0, p3);
    for (const hit of lineHits) {
      // Map the cubic t parameter: linearly interpolate within [tMin, tMax]
      // hit.t2 is the parameter on the p0->p3 line, map to cubic parameter
      const tCubic = tMin + hit.t2 * tRange;
      hits.push({
        point: hit.point,
        t1: hit.t1, // parameter on the line segment
        t2: tCubic, // parameter on the cubic
      });
    }
    return;
  }

  // Subdivide cubic at t=0.5
  const { left, right } = splitCubicAt(p0, p1, p2, p3, 0.5);
  const tMid = (tMin + tMax) / 2;

  intersectLineCubicRec(l0, l1, left[0], left[1], left[2], left[3], tMin, tMid, depth + 1, hits);
  intersectLineCubicRec(l0, l1, right[0], right[1], right[2], right[3], tMid, tMax, depth + 1, hits);
}

// -- Cubic x Cubic --

/**
 * Find intersections of two cubic bezier curves.
 * Uses recursive subdivision of both curves with bbox culling.
 */
export function intersectCubicCubic(
  a0: Point,
  a1: Point,
  a2: Point,
  a3: Point,
  b0: Point,
  b1: Point,
  b2: Point,
  b3: Point,
): IntersectionHit[] {
  const hits: IntersectionHit[] = [];
  intersectCubicCubicRec(a0, a1, a2, a3, 0, 1, b0, b1, b2, b3, 0, 1, 0, hits);
  return deduplicateHits(hits);
}

function intersectCubicCubicRec(
  a0: Point,
  a1: Point,
  a2: Point,
  a3: Point,
  aMin: number,
  aMax: number,
  b0: Point,
  b1: Point,
  b2: Point,
  b3: Point,
  bMin: number,
  bMax: number,
  depth: number,
  hits: IntersectionHit[],
): void {
  // Check bbox overlap
  if (!bboxOverlap(cubicBbox(a0, a1, a2, a3), cubicBbox(b0, b1, b2, b3))) return;

  if (depth > MAX_DEPTH) return;

  const aRange = aMax - aMin;
  const bRange = bMax - bMin;
  if (aRange < T_EPSILON && bRange < T_EPSILON) return;

  const aFlat = isFlatEnough(a0, a1, a2, a3);
  const bFlat = isFlatEnough(b0, b1, b2, b3);

  // Both flat — approximate as lines and intersect
  if (aFlat && bFlat) {
    const lineHits = intersectLineLine(a0, a3, b0, b3);
    for (const hit of lineHits) {
      hits.push({
        point: hit.point,
        t1: aMin + hit.t1 * aRange,
        t2: bMin + hit.t2 * bRange,
      });
    }
    return;
  }

  // Subdivide the curve with the larger parameter range (or the non-flat one)
  if (!aFlat && (aRange >= bRange || bFlat)) {
    const { left, right } = splitCubicAt(a0, a1, a2, a3, 0.5);
    const aMid = (aMin + aMax) / 2;
    intersectCubicCubicRec(left[0], left[1], left[2], left[3], aMin, aMid, b0, b1, b2, b3, bMin, bMax, depth + 1, hits);
    intersectCubicCubicRec(
      right[0],
      right[1],
      right[2],
      right[3],
      aMid,
      aMax,
      b0,
      b1,
      b2,
      b3,
      bMin,
      bMax,
      depth + 1,
      hits,
    );
  } else {
    const { left, right } = splitCubicAt(b0, b1, b2, b3, 0.5);
    const bMid = (bMin + bMax) / 2;
    intersectCubicCubicRec(a0, a1, a2, a3, aMin, aMax, left[0], left[1], left[2], left[3], bMin, bMid, depth + 1, hits);
    intersectCubicCubicRec(
      a0,
      a1,
      a2,
      a3,
      aMin,
      aMax,
      right[0],
      right[1],
      right[2],
      right[3],
      bMid,
      bMax,
      depth + 1,
      hits,
    );
  }
}

// -- Helpers --

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

interface Bbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function lineBbox(p0: Point, p1: Point): Bbox {
  return {
    minX: Math.min(p0.x, p1.x),
    minY: Math.min(p0.y, p1.y),
    maxX: Math.max(p0.x, p1.x),
    maxY: Math.max(p0.y, p1.y),
  };
}

function cubicBbox(p0: Point, p1: Point, p2: Point, p3: Point): Bbox {
  return {
    minX: Math.min(p0.x, p1.x, p2.x, p3.x),
    minY: Math.min(p0.y, p1.y, p2.y, p3.y),
    maxX: Math.max(p0.x, p1.x, p2.x, p3.x),
    maxY: Math.max(p0.y, p1.y, p2.y, p3.y),
  };
}

function bboxOverlap(a: Bbox, b: Bbox): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

/**
 * Test if a cubic bezier is flat enough to approximate as a line.
 * Measures max distance of control points from the chord p0->p3.
 */
function isFlatEnough(p0: Point, p1: Point, p2: Point, p3: Point): boolean {
  // Distance from point to line segment p0->p3
  const d1 = pointToLineDistance(p1, p0, p3);
  const d2 = pointToLineDistance(p2, p0, p3);
  return Math.max(d1, d2) <= FLATNESS_EPSILON;
}

/** Perpendicular distance from point p to line through a and b. */
function pointToLineDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-20) {
    // a and b are the same point
    return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  }
  return Math.abs(dx * (a.y - p.y) - dy * (a.x - p.x)) / Math.sqrt(lenSq);
}

/**
 * Split a cubic bezier at parameter t using de Casteljau's algorithm.
 *
 * L1 = lerp(p0, p1, t)
 * M  = lerp(p1, p2, t)
 * R1 = lerp(p2, p3, t)
 * L2 = lerp(L1, M, t)
 * R2 = lerp(M, R1, t)
 * S  = lerp(L2, R2, t)
 *
 * Left half:  (p0, L1, L2, S)
 * Right half: (S, R2, R1, p3)
 */
export function splitCubicAt(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
): { left: [Point, Point, Point, Point]; right: [Point, Point, Point, Point] } {
  const l1 = lerp(p0, p1, t);
  const m = lerp(p1, p2, t);
  const r1 = lerp(p2, p3, t);
  const l2 = lerp(l1, m, t);
  const r2 = lerp(m, r1, t);
  const s = lerp(l2, r2, t);

  return {
    left: [p0, l1, l2, s],
    right: [s, r2, r1, p3],
  };
}

function lerp(a: Point, b: Point, t: number): Point {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/** Remove duplicate intersection hits that are within DEDUP_DISTANCE of each other. */
function deduplicateHits(hits: IntersectionHit[]): IntersectionHit[] {
  if (hits.length <= 1) return hits;

  const result: IntersectionHit[] = [hits[0]];
  for (let i = 1; i < hits.length; i++) {
    const hit = hits[i];
    let isDuplicate = false;
    for (const existing of result) {
      const dx = hit.point.x - existing.point.x;
      const dy = hit.point.y - existing.point.y;
      if (dx * dx + dy * dy < DEDUP_DISTANCE * DEDUP_DISTANCE) {
        isDuplicate = true;
        break;
      }
    }
    if (!isDuplicate) result.push(hit);
  }
  return result;
}
