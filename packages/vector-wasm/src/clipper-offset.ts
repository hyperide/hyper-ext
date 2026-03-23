/**
 * @file Path offset — inflate/deflate path contours via polygon offset
 *
 * Accessed via: Path Offset node — grow or shrink shape outlines
 * Assumptions: operates on flattened polyline approximation. Curves are linearized
 *   before offsetting, then the offset contour is returned as a polyline path.
 * Tradeoffs: polygon normal-offset algorithm (not Minkowski sum). Handles convex
 *   and simple concave shapes well. May produce artifacts on sharp concavities
 *   with miter join. Clipper2 WASM can replace this for production precision.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { decodeCommands, encodeCommands, flattenPath, PathCmd, type PathCommand, type PathValue } from 'vector-engine';
import type { PathOpsBackend } from './types';

export type OffsetJoinType = 'miter' | 'round' | 'square';

interface Vec2 {
  x: number;
  y: number;
}

/** Default flatten tolerance for curve → polyline conversion */
const DEFAULT_TOLERANCE = 0.5;

/** Max miter ratio before falling back to bevel */
const MAX_MITER_RATIO = 4;

/** Number of arc segments per 90 degrees for round joins */
const ARC_SEGMENTS_PER_QUARTER = 4;

/**
 * Compute twice the signed area of a polygon (shoelace formula).
 * Positive = CCW in standard math coords. Negative = CW.
 */
function signedArea2(points: Vec2[]): number {
  let sum = 0;
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += (points[j].x - points[i].x) * (points[j].y + points[i].y);
  }
  return sum;
}

/**
 * Offset a polygon contour by `distance`.
 *
 * Positive distance inflates outward regardless of winding direction.
 * Negative distance deflates inward.
 * Returns the offset polygon as an array of points.
 */
function offsetPolygon(points: Vec2[], distance: number, joinType: OffsetJoinType): Vec2[] {
  const n = points.length;
  if (n < 3) return points;

  // Detect winding direction and compute outward normals accordingly.
  // signedArea2 > 0 means CW in screen coords (Y-down), < 0 means CCW.
  // The left-normal (-dy, dx) points outward for CW polygons in screen coords.
  // For CCW polygons, we flip to (dy, -dx).
  const area2 = signedArea2(points);
  const normalSign = area2 >= 0 ? 1 : -1;

  const normals: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = points[j].x - points[i].x;
    const dy = points[j].y - points[i].y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-10) {
      normals.push(normals.length > 0 ? normals[normals.length - 1] : { x: 0, y: 1 });
    } else {
      normals.push({ x: (-dy / len) * normalSign, y: (dx / len) * normalSign });
    }
  }

  const result: Vec2[] = [];

  for (let i = 0; i < n; i++) {
    const prevIdx = (i - 1 + n) % n;
    const n1 = normals[prevIdx];
    const n2 = normals[i];

    // Offset lines for the two edges meeting at this vertex:
    // Line 1: points[i] + n1 * distance
    // Line 2: points[i] + n2 * distance
    const cross = n1.x * n2.y - n1.y * n2.x;
    const dot = n1.x * n2.x + n1.y * n2.y;

    if (Math.abs(cross) < 1e-10) {
      // Parallel edges — just offset the point
      result.push({
        x: points[i].x + n2.x * distance,
        y: points[i].y + n2.y * distance,
      });
      continue;
    }

    // Miter point: intersection of the two offset lines
    const miterRatio = 1 / Math.abs(Math.sin(Math.atan2(cross, dot) / 2));

    if (joinType === 'miter' && miterRatio <= MAX_MITER_RATIO) {
      // Compute miter intersection
      const avgNx = (n1.x + n2.x) / 2;
      const avgNy = (n1.y + n2.y) / 2;
      const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy);
      if (avgLen < 1e-10) {
        result.push({
          x: points[i].x + n2.x * distance,
          y: points[i].y + n2.y * distance,
        });
      } else {
        const scale = (distance / (avgNx * n2.x + avgNy * n2.y)) * avgLen;
        result.push({
          x: points[i].x + (avgNx / avgLen) * scale,
          y: points[i].y + (avgNy / avgLen) * scale,
        });
      }
    } else if (joinType === 'round') {
      // Insert arc segments between the two offset directions
      const angle1 = Math.atan2(n1.y, n1.x);
      const angle2 = Math.atan2(n2.y, n2.x);
      let sweep = angle2 - angle1;
      if (sweep > Math.PI) sweep -= 2 * Math.PI;
      if (sweep < -Math.PI) sweep += 2 * Math.PI;

      // Determine if we need arc on the outside (expanding)
      const isOutside = (distance > 0 && cross < 0) || (distance < 0 && cross > 0);
      if (isOutside) {
        const segments = Math.max(1, Math.ceil((Math.abs(sweep) / (Math.PI / 2)) * ARC_SEGMENTS_PER_QUARTER));
        const step = sweep / segments;
        for (let s = 0; s <= segments; s++) {
          const a = angle1 + s * step;
          result.push({
            x: points[i].x + Math.cos(a) * distance,
            y: points[i].y + Math.sin(a) * distance,
          });
        }
      } else {
        // Inside corner — single miter point
        const avgNx = (n1.x + n2.x) / 2;
        const avgNy = (n1.y + n2.y) / 2;
        const avgLen = Math.sqrt(avgNx * avgNx + avgNy * avgNy);
        if (avgLen < 1e-10) {
          result.push({
            x: points[i].x + n2.x * distance,
            y: points[i].y + n2.y * distance,
          });
        } else {
          const scale = (distance / (avgNx * n2.x + avgNy * n2.y)) * avgLen;
          result.push({
            x: points[i].x + (avgNx / avgLen) * scale,
            y: points[i].y + (avgNy / avgLen) * scale,
          });
        }
      }
    } else {
      // Square/bevel join: two points at the offset edges
      result.push({
        x: points[i].x + n1.x * distance,
        y: points[i].y + n1.y * distance,
      });
      result.push({
        x: points[i].x + n2.x * distance,
        y: points[i].y + n2.y * distance,
      });
    }
  }

  return result;
}

/**
 * Convert a Vec2[] polygon back to PathValue (closed polyline path).
 */
function polygonToPathValue(points: Vec2[]): PathValue {
  if (points.length === 0) {
    return { commands: new Float64Array(0), closed: false };
  }

  const commands: PathCommand[] = [];
  commands.push({ type: PathCmd.Move, x: points[0].x, y: points[0].y });
  for (let i = 1; i < points.length; i++) {
    commands.push({ type: PathCmd.Line, x: points[i].x, y: points[i].y });
  }
  commands.push({ type: PathCmd.Close });

  return { commands: encodeCommands(commands), closed: true };
}

/**
 * Extract closed polygon contours from a PathValue.
 * Each contour is a separate closed subpath delimited by Move...Close.
 */
function extractContours(path: PathValue): Vec2[][] {
  const decoded = decodeCommands(path.commands);
  const contours: Vec2[][] = [];
  let current: Vec2[] = [];

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        if (current.length > 0) {
          contours.push(current);
        }
        current = [{ x: cmd.x, y: cmd.y }];
        break;
      case PathCmd.Line:
        current.push({ x: cmd.x, y: cmd.y });
        break;
      case PathCmd.Close:
        if (current.length >= 3) {
          contours.push(current);
        }
        current = [];
        break;
      default:
        // Curves should be flattened before calling this
        break;
    }
  }

  if (current.length >= 3) {
    contours.push(current);
  }

  return contours;
}

/**
 * Offset a PathValue by `distance` pixels.
 *
 * Positive values inflate (grow), negative values deflate (shrink).
 * Curves are flattened to polylines before offsetting.
 */
export function offsetPath(
  path: PathValue,
  distance: number,
  joinType: OffsetJoinType = 'miter',
  tolerance: number = DEFAULT_TOLERANCE,
): PathValue {
  if (distance === 0) return path;

  // Flatten curves to polylines first
  const flatPoints = flattenPath(path.commands, tolerance);

  // If the path has Close commands, extract contours; otherwise treat as single polygon
  const decoded = decodeCommands(path.commands);
  const hasClose = decoded.some((cmd) => cmd.type === PathCmd.Close);

  if (hasClose) {
    // Work with contours
    const contours = extractContours(path);
    if (contours.length === 0) return path;

    // Offset each contour and combine
    const allCommands: PathCommand[] = [];
    for (const contour of contours) {
      const offsetPts = offsetPolygon(contour, distance, joinType);
      if (offsetPts.length < 3) continue;
      allCommands.push({ type: PathCmd.Move, x: offsetPts[0].x, y: offsetPts[0].y });
      for (let i = 1; i < offsetPts.length; i++) {
        allCommands.push({ type: PathCmd.Line, x: offsetPts[i].x, y: offsetPts[i].y });
      }
      allCommands.push({ type: PathCmd.Close });
    }

    if (allCommands.length === 0) return path;
    return { commands: encodeCommands(allCommands), closed: true };
  }

  // Open polyline — treat flatPoints as a single polygon
  if (flatPoints.length < 3) return path;
  const offsetPts = offsetPolygon(flatPoints, distance, joinType);
  return polygonToPathValue(offsetPts);
}

/**
 * PathOpsBackend wrapper that delegates `offset()` to the polygon offset algorithm.
 * All other methods delegate to a wrapped inner backend.
 */
export class OffsetPathOps implements PathOpsBackend {
  private inner: PathOpsBackend;
  private joinType: OffsetJoinType;
  private tolerance: number;

  constructor(inner: PathOpsBackend, joinType: OffsetJoinType = 'miter', tolerance: number = DEFAULT_TOLERANCE) {
    this.inner = inner;
    this.joinType = joinType;
    this.tolerance = tolerance;
  }

  boolean(...args: Parameters<PathOpsBackend['boolean']>): PathValue {
    return this.inner.boolean(...args);
  }

  simplify(...args: Parameters<PathOpsBackend['simplify']>): PathValue {
    return this.inner.simplify(...args);
  }

  flatten(...args: Parameters<PathOpsBackend['flatten']>): PathValue {
    return this.inner.flatten(...args);
  }

  strokeToPath(...args: Parameters<PathOpsBackend['strokeToPath']>): PathValue {
    return this.inner.strokeToPath(...args);
  }

  dash(...args: Parameters<PathOpsBackend['dash']>): PathValue {
    return this.inner.dash(...args);
  }

  offset(path: PathValue, distance: number): PathValue {
    return offsetPath(path, distance, this.joinType, this.tolerance);
  }

  removeSelfIntersections(...args: Parameters<PathOpsBackend['removeSelfIntersections']>): PathValue {
    return this.inner.removeSelfIntersections(...args);
  }
}
