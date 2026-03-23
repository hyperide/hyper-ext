/**
 * @file Adaptive polyline approximation — converts path curves to line segments
 *
 * Accessed via: Deformation nodes (roughen, zigzag, etc.) — operate on flattened vertex arrays
 * Assumptions: tolerance is in the same coordinate space as the path commands (typically pixels)
 * Tradeoffs: uses recursive midpoint subdivision with chord-distance flatness test, not de Casteljau
 *   optimal splitting — simpler and fast enough for real-time deformation use cases
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import type { Point } from '../types';
import { decodeCommands, PathCmd } from './commands';

/**
 * Flatten a path (Float64Array of encoded commands) into an array of points.
 *
 * Curves are adaptively subdivided until each segment deviates less than
 * `tolerance` pixels from the true curve. Higher tolerance = fewer points.
 */
export function flattenPath(commands: Float64Array, tolerance: number): Point[] {
  // Clamp tolerance to a small positive value — zero/negative causes infinite subdivision
  const safeTolerance = Math.max(tolerance, 1e-6);
  const decoded = decodeCommands(commands);
  const points: Point[] = [];
  let lastX = 0;
  let lastY = 0;
  let startX = 0;
  let startY = 0;

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        points.push({ x: cmd.x, y: cmd.y });
        lastX = cmd.x;
        lastY = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      case PathCmd.Line:
        points.push({ x: cmd.x, y: cmd.y });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Cubic:
        flattenCubic(lastX, lastY, cmd.cx1, cmd.cy1, cmd.cx2, cmd.cy2, cmd.x, cmd.y, safeTolerance, points);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Quad:
        flattenQuad(lastX, lastY, cmd.cx, cmd.cy, cmd.x, cmd.y, safeTolerance, points);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Arc:
        flattenArc(
          lastX,
          lastY,
          cmd.rx,
          cmd.ry,
          cmd.rotation,
          cmd.largeArc,
          cmd.sweep,
          cmd.x,
          cmd.y,
          safeTolerance,
          points,
        );
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Close:
        // Don't add duplicate start point — caller knows the path is closed
        lastX = startX;
        lastY = startY;
        break;
    }
  }

  return points;
}

/**
 * Adaptively subdivide a cubic bezier into points and push them (excluding start point).
 *
 * Flatness test: measures the maximum perpendicular distance of the two control
 * points from the chord (start → end). When both are within tolerance, the segment
 * is considered flat and we emit the endpoint.
 */
function flattenCubic(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  tolerance: number,
  out: Point[],
): void {
  const dx = x3 - x0;
  const dy = y3 - y0;
  const len2 = dx * dx + dy * dy;

  let d1: number;
  let d2: number;

  if (len2 < 1e-10) {
    // Degenerate chord — use distance from start point
    d1 = Math.sqrt((cx1 - x0) * (cx1 - x0) + (cy1 - y0) * (cy1 - y0));
    d2 = Math.sqrt((cx2 - x0) * (cx2 - x0) + (cy2 - y0) * (cy2 - y0));
  } else {
    // Perpendicular distance from control point to chord line (unsigned)
    d1 = Math.abs(dy * cx1 - dx * cy1 + x3 * y0 - y3 * x0) / Math.sqrt(len2);
    d2 = Math.abs(dy * cx2 - dx * cy2 + x3 * y0 - y3 * x0) / Math.sqrt(len2);
  }

  if (d1 <= tolerance && d2 <= tolerance) {
    out.push({ x: x3, y: y3 });
    return;
  }

  // de Casteljau split at t = 0.5
  const mx1 = (x0 + cx1) / 2;
  const my1 = (y0 + cy1) / 2;
  const mx2 = (cx1 + cx2) / 2;
  const my2 = (cy1 + cy2) / 2;
  const mx3 = (cx2 + x3) / 2;
  const my3 = (cy2 + y3) / 2;

  const mx12 = (mx1 + mx2) / 2;
  const my12 = (my1 + my2) / 2;
  const mx23 = (mx2 + mx3) / 2;
  const my23 = (my2 + my3) / 2;

  const midX = (mx12 + mx23) / 2;
  const midY = (my12 + my23) / 2;

  flattenCubic(x0, y0, mx1, my1, mx12, my12, midX, midY, tolerance, out);
  flattenCubic(midX, midY, mx23, my23, mx3, my3, x3, y3, tolerance, out);
}

/**
 * Adaptively subdivide a quadratic bezier into points (excluding start point).
 *
 * Elevates the quad to a cubic and delegates to flattenCubic.
 * Degree elevation: cx1 = p0 + 2/3*(cp - p0), cx2 = p2 + 2/3*(cp - p2)
 */
function flattenQuad(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  tolerance: number,
  out: Point[],
): void {
  // Elevate quadratic to cubic
  const cx1 = x0 + (2 / 3) * (cx - x0);
  const cy1 = y0 + (2 / 3) * (cy - y0);
  const cx2 = x2 + (2 / 3) * (cx - x2);
  const cy2 = y2 + (2 / 3) * (cy - y2);
  flattenCubic(x0, y0, cx1, cy1, cx2, cy2, x2, y2, tolerance, out);
}

/**
 * Approximate an SVG elliptical arc with cubic bezier segments and flatten them.
 *
 * Uses the SVG spec §F.6 endpoint-to-center parameterization to find the center,
 * start angle, and sweep. Splits the arc into segments of at most 90° each,
 * approximating each with a cubic bezier (max error ~0.27% of radius).
 */
function flattenArc(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
  tolerance: number,
  out: Point[],
): void {
  // Degenerate: endpoints coincide — nothing to draw
  if (x1 === x2 && y1 === y2) return;

  let absRx = Math.abs(rx);
  let absRy = Math.abs(ry);

  // Degenerate: zero radius → straight line
  if (absRx === 0 || absRy === 0) {
    out.push({ x: x2, y: y2 });
    return;
  }

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // SVG spec F.6.5.1: transform endpoint to rotated frame
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // SVG spec F.6.6.3: radius scaling to fit
  const x1pSq = x1p * x1p;
  const y1pSq = y1p * y1p;
  let rxSq = absRx * absRx;
  let rySq = absRy * absRy;

  const lambda = x1pSq / rxSq + y1pSq / rySq;
  if (lambda > 1) {
    const sqrtLambda = Math.sqrt(lambda);
    absRx *= sqrtLambda;
    absRy *= sqrtLambda;
    rxSq = absRx * absRx;
    rySq = absRy * absRy;
  }

  // SVG spec F.6.5.2: center in rotated frame
  const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq;
  const den = rxSq * y1pSq + rySq * x1pSq;
  const sqrtArg = Math.max(0, num / den);
  const k = (largeArc === sweep ? -1 : 1) * Math.sqrt(sqrtArg);

  const cxp = k * ((absRx * y1p) / absRy);
  const cyp = k * ((-absRy * x1p) / absRx);

  // SVG spec F.6.5.3: center in original frame
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // SVG spec F.6.5.5 / F.6.5.6: start angle and delta angle
  const startAngle = vectorAngle(1, 0, (x1p - cxp) / absRx, (y1p - cyp) / absRy);
  let dAngle = vectorAngle((x1p - cxp) / absRx, (y1p - cyp) / absRy, (-x1p - cxp) / absRx, (-y1p - cyp) / absRy);

  if (sweep === 0 && dAngle > 0) dAngle -= 2 * Math.PI;
  if (sweep === 1 && dAngle < 0) dAngle += 2 * Math.PI;

  // Split arc into segments of at most π/2 (90°) and approximate each with a cubic
  const nSegs = Math.ceil(Math.abs(dAngle) / (Math.PI / 2));
  const segAngle = dAngle / nSegs;

  for (let i = 0; i < nSegs; i++) {
    const a0 = startAngle + i * segAngle;
    const a1 = startAngle + (i + 1) * segAngle;
    arcSegmentToCubic(cx, cy, absRx, absRy, cosPhi, sinPhi, a0, a1, tolerance, out);
  }

  // Snap the final point to the exact arc endpoint — cubic approximation accumulates
  // floating-point error so the computed endpoint may drift by ~1e-14 from x2, y2.
  if (out.length > 0) {
    out[out.length - 1] = { x: x2, y: y2 };
  }
}

/**
 * Signed angle from vector (ux, uy) to (vx, vy), in radians [-π, π].
 */
function vectorAngle(ux: number, uy: number, vx: number, vy: number): number {
  const dot = ux * vx + uy * vy;
  const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
  const cosA = Math.max(-1, Math.min(1, dot / len));
  const a = Math.acos(cosA);
  return ux * vy - uy * vx < 0 ? -a : a;
}

/**
 * Approximate one arc segment (a0 → a1, at most 90°) with a cubic bezier.
 *
 * Standard cubic approximation of a circular/elliptic arc — the control point
 * offset factor `alpha = sin(dA) * (sqrt(4+3*tan²(dA/2)) - 1) / 3` minimizes
 * the max error. Pushes only the endpoint (start is already in `out`).
 */
function arcSegmentToCubic(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  cosPhi: number,
  sinPhi: number,
  a0: number,
  a1: number,
  tolerance: number,
  out: Point[],
): void {
  const dA = a1 - a0;
  const alpha = (Math.sin(dA) * (Math.sqrt(4 + 3 * Math.tan(dA / 2) * Math.tan(dA / 2)) - 1)) / 3;

  const cosA0 = Math.cos(a0);
  const sinA0 = Math.sin(a0);
  const cosA1 = Math.cos(a1);
  const sinA1 = Math.sin(a1);

  // Ellipse point at angle t: P(t) = C + R(phi) * (rx*cos(t), ry*sin(t))
  const p0x = cx + cosPhi * rx * cosA0 - sinPhi * ry * sinA0;
  const p0y = cy + sinPhi * rx * cosA0 + cosPhi * ry * sinA0;
  const p1x = cx + cosPhi * rx * cosA1 - sinPhi * ry * sinA1;
  const p1y = cy + sinPhi * rx * cosA1 + cosPhi * ry * sinA1;

  // Derivative of ellipse point at angle t: dP/dt = R(phi) * (-rx*sin(t), ry*cos(t))
  const d0x = cosPhi * (-rx * sinA0) - sinPhi * (ry * cosA0);
  const d0y = sinPhi * (-rx * sinA0) + cosPhi * (ry * cosA0);
  const d1x = cosPhi * (-rx * sinA1) - sinPhi * (ry * cosA1);
  const d1y = sinPhi * (-rx * sinA1) + cosPhi * (ry * cosA1);

  const cp1x = p0x + alpha * d0x;
  const cp1y = p0y + alpha * d0y;
  const cp2x = p1x - alpha * d1x;
  const cp2y = p1y - alpha * d1y;

  flattenCubic(p0x, p0y, cp1x, cp1y, cp2x, cp2y, p1x, p1y, tolerance, out);
}
