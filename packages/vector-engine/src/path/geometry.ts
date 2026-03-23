/**
 * @file Geometry queries — path length, area, point-at-offset, tangent, normal
 *
 * Accessed via: Properties panel geometry readouts, variable stroke calculations,
 *   trim path operations
 * Tradeoffs: cubic length uses 5-point Gauss-Legendre quadrature (fast, ~0.01% error).
 *   Area uses shoelace on flattened polyline for curves.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { decodeCommands, PathCmd } from './commands';
import { flattenPath } from './flatten';
import { dist, normalize } from './math';

// 5-point Gauss-Legendre quadrature nodes and weights on [-1, 1]
const GL_NODES = [-0.906_179_845_938_664, -0.538_469_310_105_683, 0, 0.538_469_310_105_683, 0.906_179_845_938_664];
const GL_WEIGHTS = [
  0.236_926_885_056_189, 0.478_628_670_499_366, 0.568_888_888_888_889, 0.478_628_670_499_366, 0.236_926_885_056_189,
];

/**
 * Cubic bezier derivative magnitude at parameter t.
 * B'(t) = 3[(1-t)^2(P1-P0) + 2t(1-t)(P2-P1) + t^2(P3-P2)]
 */
function cubicDerivMag(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  t: number,
): number {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  const dx = 3 * (mt2 * (cx1 - x0) + 2 * t * mt * (cx2 - cx1) + t2 * (x3 - cx2));
  const dy = 3 * (mt2 * (cy1 - y0) + 2 * t * mt * (cy2 - cy1) + t2 * (y3 - cy2));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Quadratic bezier derivative magnitude at parameter t.
 * B'(t) = 2[(1-t)(P1-P0) + t(P2-P1)]
 */
function quadDerivMag(x0: number, y0: number, cx: number, cy: number, x2: number, y2: number, t: number): number {
  const mt = 1 - t;
  const dx = 2 * (mt * (cx - x0) + t * (x2 - cx));
  const dy = 2 * (mt * (cy - y0) + t * (y2 - cy));
  return Math.sqrt(dx * dx + dy * dy);
}

/** 5-point Gauss-Legendre arc-length of a cubic bezier segment. */
function cubicLength(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
): number {
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) {
    // Map node from [-1,1] to [0,1]: t = 0.5*(1+xi)
    const t = 0.5 * (1 + GL_NODES[i]);
    sum += GL_WEIGHTS[i] * cubicDerivMag(x0, y0, cx1, cy1, cx2, cy2, x3, y3, t);
  }
  return 0.5 * sum;
}

/** 5-point Gauss-Legendre arc-length of a quadratic bezier segment. */
function quadLength(x0: number, y0: number, cx: number, cy: number, x2: number, y2: number): number {
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) {
    const t = 0.5 * (1 + GL_NODES[i]);
    sum += GL_WEIGHTS[i] * quadDerivMag(x0, y0, cx, cy, x2, y2, t);
  }
  return 0.5 * sum;
}

/**
 * Compute total arc-length of a path (Float64Array of encoded commands).
 *
 * Lines: Euclidean distance.
 * Cubics/Quads: 5-point Gauss-Legendre quadrature (~0.01% error).
 * Arcs: flattened to polyline and summed (analytical ellipse arc length is complex).
 * Close: adds distance from current point back to subpath start.
 */
export function pathLength(commands: Float64Array): number {
  if (commands.length === 0) return 0;

  const decoded = decodeCommands(commands);
  let total = 0;
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        lastX = cmd.x;
        lastY = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      case PathCmd.Line:
        total += dist(lastX, lastY, cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Cubic:
        total += cubicLength(lastX, lastY, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Quad:
        total += quadLength(lastX, lastY, cmd.cx, cmd.cy, cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Arc: {
        // Flatten arc to polyline and sum segment lengths.
        // Use tight tolerance (0.001) — 0.5 underestimates small-radius arcs by ~10%.
        const arcCmds = new Float64Array([
          PathCmd.Move,
          lastX,
          lastY,
          PathCmd.Arc,
          cmd.rx,
          cmd.ry,
          cmd.rotation,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
        ]);
        const pts = flattenPath(arcCmds, 0.001);
        for (let i = 1; i < pts.length; i++) {
          total += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        }
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Close:
        total += dist(lastX, lastY, startX, startY);
        lastX = startX;
        lastY = startY;
        break;
    }
  }

  return total;
}

/** Shoelace area of a closed polygon (point array). */
function shoelaceArea(pts: { x: number; y: number }[]): number {
  const n = pts.length;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += pts[i].x * pts[j].y - pts[j].x * pts[i].y;
  }
  return sum / 2;
}

/** Point, unit tangent, and unit normal at a normalized path offset. */
export interface PointAtOffsetResult {
  point: { x: number; y: number };
  tangent: { x: number; y: number };
  normal: { x: number; y: number };
}

/**
 * Evaluate cubic bezier position at parameter t.
 * B(t) = (1-t)^3 P0 + 3(1-t)^2 t P1 + 3(1-t) t^2 P2 + t^3 P3
 */
function cubicPoint(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const mt3 = mt2 * mt;
  const t2 = t * t;
  const t3 = t2 * t;
  return {
    x: mt3 * x0 + 3 * mt2 * t * cx1 + 3 * mt * t2 * cx2 + t3 * x3,
    y: mt3 * y0 + 3 * mt2 * t * cy1 + 3 * mt * t2 * cy2 + t3 * y3,
  };
}

/**
 * Evaluate cubic bezier derivative (tangent direction, not unit) at parameter t.
 * B'(t) = 3[(1-t)^2(P1-P0) + 2t(1-t)(P2-P1) + t^2(P3-P2)]
 */
function cubicDeriv(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x: 3 * (mt2 * (cx1 - x0) + 2 * t * mt * (cx2 - cx1) + t2 * (x3 - cx2)),
    y: 3 * (mt2 * (cy1 - y0) + 2 * t * mt * (cy2 - cy1) + t2 * (y3 - cy2)),
  };
}

/**
 * Evaluate quadratic bezier position at parameter t.
 * B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2
 */
function quadPoint(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: mt * mt * x0 + 2 * mt * t * cx + t * t * x2,
    y: mt * mt * y0 + 2 * mt * t * cy + t * t * y2,
  };
}

/**
 * Evaluate quadratic bezier derivative (tangent direction, not unit) at parameter t.
 * B'(t) = 2[(1-t)(P1-P0) + t(P2-P1)]
 */
function quadDeriv(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  t: number,
): { x: number; y: number } {
  const mt = 1 - t;
  return {
    x: 2 * (mt * (cx - x0) + t * (x2 - cx)),
    y: 2 * (mt * (cy - y0) + t * (y2 - cy)),
  };
}

/**
 * Gauss-Legendre arc-length of a quadratic bezier on [0, tEnd].
 */
function quadLengthUpTo(x0: number, y0: number, cx: number, cy: number, x2: number, y2: number, tEnd: number): number {
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) {
    const t = (tEnd / 2) * (1 + GL_NODES[i]);
    sum += GL_WEIGHTS[i] * quadDerivMag(x0, y0, cx, cy, x2, y2, t);
  }
  return (tEnd / 2) * sum;
}

/**
 * Find quadratic bezier parameter t where arc-length from 0 equals targetLen.
 * Uses binary search with Gauss-Legendre length evaluation.
 */
function quadTAtLength(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  targetLen: number,
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const len = quadLengthUpTo(x0, y0, cx, cy, x2, y2, mid);
    if (len < targetLen) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/**
 * Gauss-Legendre arc-length of a cubic bezier on [0, tEnd].
 * Integrates |B'(t)| from 0 to tEnd via 5-point quadrature.
 */
function cubicLengthUpTo(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  tEnd: number,
): number {
  let sum = 0;
  for (let i = 0; i < GL_NODES.length; i++) {
    // Map node from [-1,1] to [0, tEnd]: t = (tEnd/2)*(1+xi)
    const t = (tEnd / 2) * (1 + GL_NODES[i]);
    sum += GL_WEIGHTS[i] * cubicDerivMag(x0, y0, cx1, cy1, cx2, cy2, x3, y3, t);
  }
  return (tEnd / 2) * sum;
}

/**
 * Find cubic bezier parameter t where arc-length from 0 equals targetLen.
 * Uses binary search with Gauss-Legendre length evaluation.
 */
function cubicTAtLength(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  targetLen: number,
): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    const len = cubicLengthUpTo(x0, y0, cx1, cy1, cx2, cy2, x3, y3, mid);
    if (len < targetLen) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

interface PathSegment {
  len: number;
  startX: number;
  startY: number;
  cmd: ReturnType<typeof decodeCommands>[number];
}

interface CollectedSegments {
  segments: PathSegment[];
  lastX: number;
  lastY: number;
}

/**
 * Collect per-segment lengths and start points from decoded path commands.
 * Close commands are represented as synthetic Line segments to the subpath start.
 * Returns segments and the last pen position (for degenerate path fallback).
 */
function collectPathSegments(commands: Float64Array): CollectedSegments {
  const decoded = decodeCommands(commands);
  const segments: PathSegment[] = [];
  let lastX = 0;
  let lastY = 0;
  let subStartX = 0;
  let subStartY = 0;

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        lastX = cmd.x;
        lastY = cmd.y;
        subStartX = cmd.x;
        subStartY = cmd.y;
        break;
      case PathCmd.Line: {
        const len = dist(lastX, lastY, cmd.x, cmd.y);
        segments.push({ len, startX: lastX, startY: lastY, cmd });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Cubic: {
        const len = cubicLength(lastX, lastY, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y);
        segments.push({ len, startX: lastX, startY: lastY, cmd });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Quad: {
        const len = quadLength(lastX, lastY, cmd.cx, cmd.cy, cmd.x, cmd.y);
        segments.push({ len, startX: lastX, startY: lastY, cmd });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Arc: {
        const arcCmds = new Float64Array([
          PathCmd.Move,
          lastX,
          lastY,
          PathCmd.Arc,
          cmd.rx,
          cmd.ry,
          cmd.rotation,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
        ]);
        const pts = flattenPath(arcCmds, 0.001);
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
          len += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        }
        segments.push({ len, startX: lastX, startY: lastY, cmd });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Close: {
        const len = dist(lastX, lastY, subStartX, subStartY);
        // Represent close as a synthetic line to subpath start
        segments.push({
          len,
          startX: lastX,
          startY: lastY,
          cmd: { type: PathCmd.Line, x: subStartX, y: subStartY },
        });
        lastX = subStartX;
        lastY = subStartY;
        break;
      }
    }
  }

  return { segments, lastX, lastY };
}

/**
 * Evaluate point and tangent at a given arc-length distance within one segment.
 * Dispatches to the appropriate curve evaluation based on command type.
 */
function evaluateSegmentAt(seg: PathSegment, localDist: number): PointAtOffsetResult {
  const { cmd, startX: sx, startY: sy, len } = seg;
  const localT = len > 1e-10 ? Math.min(1, localDist / len) : 0;

  if (cmd.type === PathCmd.Cubic) {
    const ct = cubicTAtLength(sx, sy, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y, localDist);
    const point = cubicPoint(sx, sy, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y, ct);
    const d = cubicDeriv(sx, sy, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y, ct);
    const tangent = normalize(d.x, d.y);
    return { point, tangent, normal: { x: -tangent.y, y: tangent.x } };
  }

  if (cmd.type === PathCmd.Quad) {
    const qt = quadTAtLength(sx, sy, cmd.cx, cmd.cy, cmd.x, cmd.y, localDist);
    const point = quadPoint(sx, sy, cmd.cx, cmd.cy, cmd.x, cmd.y, qt);
    const d = quadDeriv(sx, sy, cmd.cx, cmd.cy, cmd.x, cmd.y, qt);
    const tangent = normalize(d.x, d.y);
    return { point, tangent, normal: { x: -tangent.y, y: tangent.x } };
  }

  if (cmd.type === PathCmd.Arc) {
    // Flatten arc to polyline and walk to localDist within it
    const arcCmds = new Float64Array([
      PathCmd.Move,
      sx,
      sy,
      PathCmd.Arc,
      cmd.rx,
      cmd.ry,
      cmd.rotation,
      cmd.largeArc,
      cmd.sweep,
      cmd.x,
      cmd.y,
    ]);
    const pts = flattenPath(arcCmds, 0.001);
    let arcAcc = 0;
    for (let i = 1; i < pts.length; i++) {
      const segLen = dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      if (arcAcc + segLen >= localDist || i === pts.length - 1) {
        const segT = segLen > 1e-10 ? Math.min(1, (localDist - arcAcc) / segLen) : 0;
        const point = {
          x: pts[i - 1].x + (pts[i].x - pts[i - 1].x) * segT,
          y: pts[i - 1].y + (pts[i].y - pts[i - 1].y) * segT,
        };
        const tangent = normalize(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return { point, tangent, normal: { x: -tangent.y, y: tangent.x } };
      }
      arcAcc += segLen;
    }
  }

  // Line and synthetic Close-as-line: direct linear interpolation
  // cmd is never PathCmd.Close here — Close is stored as a synthetic Line in segments
  const endX = (cmd as { x: number; y: number }).x;
  const endY = (cmd as { x: number; y: number }).y;
  const point = {
    x: sx + (endX - sx) * localT,
    y: sy + (endY - sy) * localT,
  };
  const tangent = normalize(endX - sx, endY - sy);
  return { point, tangent, normal: { x: -tangent.y, y: tangent.x } };
}

/**
 * Compute point, unit tangent, and unit normal at a normalized offset along a path.
 *
 * offset is clamped to [0, 1]. For cubic beziers the exact curve tangent is
 * computed via B'(t); for lines/quads/arcs the polyline tangent is used.
 */
export function pointAtOffset(commands: Float64Array, offset: number): PointAtOffsetResult {
  const t = Math.max(0, Math.min(1, offset));

  if (commands.length === 0) {
    return { point: { x: 0, y: 0 }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
  }

  const { segments, lastX, lastY } = collectPathSegments(commands);
  const totalLength = segments.reduce((s, seg) => s + seg.len, 0);

  if (totalLength < 1e-10 || segments.length === 0) {
    return { point: { x: lastX, y: lastY }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
  }

  const targetDist = t * totalLength;

  // Walk segments to find the one containing targetDist
  let accumulated = 0;
  for (const seg of segments) {
    const segEnd = accumulated + seg.len;

    if (segEnd >= targetDist || seg === segments[segments.length - 1]) {
      const localDist = Math.max(0, targetDist - accumulated);
      return evaluateSegmentAt(seg, localDist);
    }

    accumulated = segEnd;
  }

  // Unreachable: the loop above always returns on the last segment.
  // Return the last pen position as a safe fallback.
  return { point: { x: lastX, y: lastY }, tangent: { x: 1, y: 0 }, normal: { x: 0, y: 1 } };
}

/**
 * Compute signed area of a path using the shoelace formula on a flattened polyline.
 *
 * Each subpath (separated by Move commands) is processed independently —
 * compound paths are handled correctly by summing per-contour areas.
 * Returns positive area for clockwise winding (screen coordinates, y-down),
 * negative for counter-clockwise.
 */
export function pathArea(commands: Float64Array): number {
  if (commands.length === 0) return 0;

  // Split encoded commands into subpath buffers at each Move command,
  // then flatten and apply shoelace per subpath.
  const decoded = decodeCommands(commands);
  let total = 0;

  // Collect command indices where subpaths start (Move commands)
  const subpathStarts: number[] = [];
  for (let i = 0; i < decoded.length; i++) {
    if (decoded[i].type === PathCmd.Move) subpathStarts.push(i);
  }

  for (let s = 0; s < subpathStarts.length; s++) {
    const start = subpathStarts[s];
    const end = s + 1 < subpathStarts.length ? subpathStarts[s + 1] : decoded.length;
    const subCmds = decoded.slice(start, end);

    // Only contours with drawable commands (not just a lone Move) contribute area
    const hasDrawing = subCmds.some((c) => c.type !== PathCmd.Move);
    if (!hasDrawing) continue;

    // Re-encode this subpath into a Float64Array so flattenPath can process it
    let size = 0;
    for (const c of subCmds) {
      switch (c.type) {
        case PathCmd.Move:
        case PathCmd.Line:
          size += 3;
          break;
        case PathCmd.Cubic:
          size += 7;
          break;
        case PathCmd.Quad:
          size += 5;
          break;
        case PathCmd.Arc:
          size += 8;
          break;
        case PathCmd.Close:
          size += 1;
          break;
      }
    }
    const buf = new Float64Array(size);
    let off = 0;
    for (const c of subCmds) {
      buf[off++] = c.type;
      switch (c.type) {
        case PathCmd.Move:
        case PathCmd.Line:
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Cubic:
          buf[off++] = c.cx1;
          buf[off++] = c.cy1;
          buf[off++] = c.cx2;
          buf[off++] = c.cy2;
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Quad:
          buf[off++] = c.cx;
          buf[off++] = c.cy;
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Arc:
          buf[off++] = c.rx;
          buf[off++] = c.ry;
          buf[off++] = c.rotation;
          buf[off++] = c.largeArc;
          buf[off++] = c.sweep;
          buf[off++] = c.x;
          buf[off++] = c.y;
          break;
        case PathCmd.Close:
          break;
      }
    }

    const pts = flattenPath(buf, 0.5);
    if (pts.length >= 3) {
      total += shoelaceArea(pts);
    }
  }

  return total;
}
