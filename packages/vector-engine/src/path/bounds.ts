/**
 * @file Bounding box computation for path commands
 *
 * Accessed via: Selection handles and Properties panel — bounding box shown when shape is selected
 *
 * Assumptions: arc bounds use SVG spec §B.2.4 endpoint-to-center parameterization —
 * rotation is applied to the ellipse axes, not the coordinate system.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import type { BoundingBox } from '../types';
import { decodeCommands, PathCmd } from './commands';

/** Evaluate a cubic Bézier at parameter t. */
function cubicAt(t: number, p0: number, p1: number, p2: number, p3: number): number {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

/** Evaluate a quadratic Bézier at parameter t. */
function quadAt(t: number, p0: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

/**
 * Solve at² + bt + c = 0 and return real roots.
 * Degenerates to linear when |a| is negligible.
 */
function solveQuadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) < 1e-12) return [];
    return [-c / b];
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) return [-b / (2 * a)];
  const sq = Math.sqrt(disc);
  return [(-b - sq) / (2 * a), (-b + sq) / (2 * a)];
}

/**
 * Compute tight bounding box for an SVG arc segment.
 *
 * Implements SVG spec §B.2.4 endpoint-to-center parameterization.
 * Finds all axis-aligned extrema by checking where derivatives vanish,
 * then tracks whichever extrema fall within the arc's angular sweep.
 */
function trackArcBounds(
  x1: number,
  y1: number,
  rx: number,
  ry: number,
  rotationDeg: number,
  largeArc: number,
  sweep: number,
  x2: number,
  y2: number,
  track: (x: number, y: number) => void,
): void {
  // Degenerate: endpoints coincide — nothing to sweep
  if (x1 === x2 && y1 === y2) {
    track(x1, y1);
    return;
  }

  // Clamp radii to positive — zero radius degenerates to a line
  let absRx = Math.abs(rx);
  let absRy = Math.abs(ry);
  if (absRx === 0 || absRy === 0) {
    track(x1, y1);
    track(x2, y2);
    return;
  }

  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: compute (x1', y1') — endpoint in rotated frame (SVG spec F.6.5.1)
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 2: radius scaling — ensure radii are large enough (SVG spec F.6.6.3)
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

  // Step 3: compute center (cx', cy') in rotated frame (SVG spec F.6.5.2)
  const num = rxSq * rySq - rxSq * y1pSq - rySq * x1pSq;
  const den = rxSq * y1pSq + rySq * x1pSq;
  const sqrtArg = Math.max(0, num / den);
  const k = (largeArc === sweep ? -1 : 1) * Math.sqrt(sqrtArg);

  const cxp = k * ((absRx * y1p) / absRy);
  const cyp = k * ((-absRy * x1p) / absRx);

  // Step 4: transform center back to original frame (SVG spec F.6.5.3)
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // Step 5: compute start angle and delta angle (SVG spec F.6.5.5 / F.6.5.6)
  function angle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    const cosA = Math.max(-1, Math.min(1, dot / len));
    const a = Math.acos(cosA);
    return ux * vy - uy * vx < 0 ? -a : a;
  }

  const startAngle = angle(1, 0, (x1p - cxp) / absRx, (y1p - cyp) / absRy);
  let dAngle = angle((x1p - cxp) / absRx, (y1p - cyp) / absRy, (-x1p - cxp) / absRx, (-y1p - cyp) / absRy);

  if (sweep === 0 && dAngle > 0) dAngle -= 2 * Math.PI;
  if (sweep === 1 && dAngle < 0) dAngle += 2 * Math.PI;

  // Step 6: always include the endpoint
  track(x2, y2);

  // Step 7: check axis-aligned extrema — 0°, 90°, 180°, 270°
  // Ellipse point at angle t: P(t) = center + R(phi) * (rx*cos(t), ry*sin(t))
  // Extrema occur at angles where dP/dt = 0 for each axis.
  // For x: t = atan(-ry*sin(phi) / (rx*cos(phi))) + n*pi
  // For y: t = atan( ry*cos(phi) / (rx*sin(phi))) + n*pi
  // Simpler: just check t = 0, π/2, π, 3π/2 after accounting for ellipse rotation.
  // The exact extrema for a rotated ellipse:
  //   tx = atan2(-ry * sinPhi, rx * cosPhi)  [x extremum]
  //   ty = atan2( ry * cosPhi, rx * sinPhi)  [y extremum]
  const extremaTx = Math.atan2(-absRy * sinPhi, absRx * cosPhi);
  const extremaTy = Math.atan2(absRy * cosPhi, absRx * sinPhi);

  function isInSweep(t: number): boolean {
    // Normalize t relative to startAngle
    let rel = t - startAngle;
    if (sweep === 1) {
      // Forward sweep: normalize to [0, 2π]
      rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const dNorm = ((dAngle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      return rel <= dNorm;
    } else {
      // Backward sweep: normalize to [-2π, 0]
      rel = ((rel % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (rel > 0) rel -= 2 * Math.PI;
      const dNorm = ((dAngle % (2 * Math.PI)) - 2 * Math.PI) % (2 * Math.PI);
      return rel >= dNorm;
    }
  }

  function ellipsePoint(t: number): { ex: number; ey: number } {
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    return {
      ex: cx + cosPhi * absRx * cosT - sinPhi * absRy * sinT,
      ey: cy + sinPhi * absRx * cosT + cosPhi * absRy * sinT,
    };
  }

  // Each extremum repeats every π — check both occurrences in [startAngle, startAngle ± 2π]
  for (const baseT of [extremaTx, extremaTy]) {
    for (const t of [baseT, baseT + Math.PI, baseT - Math.PI, baseT + 2 * Math.PI, baseT - 2 * Math.PI]) {
      if (isInSweep(t)) {
        const { ex, ey } = ellipsePoint(t);
        track(ex, ey);
      }
    }
  }
}

export function computeBounds(commands: Float64Array): BoundingBox {
  if (commands.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const decoded = decodeCommands(commands);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function track(x: number, y: number): void {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  let lastX = 0;
  let lastY = 0;
  // Track subpath start so Close can reset current point per SVG spec
  let startX = 0;
  let startY = 0;

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        track(cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      case PathCmd.Line:
        track(cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Cubic: {
        // Tight bounds via derivative root solving.
        // B'(t) is quadratic: coefficients derived from the four control points.
        // Solve for x and y extrema separately; evaluate only roots in (0, 1).
        track(cmd.x, cmd.y);
        const cx0 = lastX,
          cy0 = lastY;
        const cx1 = cmd.cx1,
          cy1 = cmd.cy1;
        const cx2 = cmd.cx2,
          cy2 = cmd.cy2;
        const cx3 = cmd.x,
          cy3 = cmd.y;
        for (const [p0, p1, p2, p3, isX] of [
          [cx0, cx1, cx2, cx3, true],
          [cy0, cy1, cy2, cy3, false],
        ] as [number, number, number, number, boolean][]) {
          const a = 3 * (-p0 + 3 * p1 - 3 * p2 + p3);
          const b = 6 * (p0 - 2 * p1 + p2);
          const c = 3 * (p1 - p0);
          for (const t of solveQuadratic(a, b, c)) {
            if (t > 0 && t < 1) {
              const v = cubicAt(t, p0, p1, p2, p3);
              if (isX) track(v, lastY);
              else track(lastX, v);
            }
          }
        }
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Quad: {
        // Tight bounds via derivative root solving.
        // B'(t) is linear: extremum at t = (P0 - P1) / (P0 - 2*P1 + P2).
        // Evaluate only if t is in (0, 1).
        track(cmd.x, cmd.y);
        const qx0 = lastX,
          qy0 = lastY;
        const qx1 = cmd.cx,
          qy1 = cmd.cy;
        const qx2 = cmd.x,
          qy2 = cmd.y;
        for (const [p0, p1, p2, isX] of [
          [qx0, qx1, qx2, true],
          [qy0, qy1, qy2, false],
        ] as [number, number, number, boolean][]) {
          const denom = p0 - 2 * p1 + p2;
          if (Math.abs(denom) > 1e-12) {
            const t = (p0 - p1) / denom;
            if (t > 0 && t < 1) {
              const v = quadAt(t, p0, p1, p2);
              if (isX) track(v, lastY);
              else track(lastX, v);
            }
          }
        }
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Arc:
        trackArcBounds(lastX, lastY, cmd.rx, cmd.ry, cmd.rotation, cmd.largeArc, cmd.sweep, cmd.x, cmd.y, track);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Close:
        // Reset current point to subpath start per SVG spec
        lastX = startX;
        lastY = startY;
        break;
    }
  }

  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
