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
      case PathCmd.Cubic:
        track(cmd.cx1, cmd.cy1);
        track(cmd.cx2, cmd.cy2);
        track(cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Quad:
        track(cmd.cx, cmd.cy);
        track(cmd.x, cmd.y);
        lastX = cmd.x;
        lastY = cmd.y;
        break;
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
