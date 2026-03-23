/**
 * @file Variable width stroke — generates outline path from width profile
 *
 * Accessed via: Width tool in vector mode (v1.x), MCP tools (v1)
 * Tradeoffs: uses polyline sampling at fixed intervals (path length / 2px, min 20 samples).
 *   Higher sample count = smoother outline but more vertices.
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { PathBuilder } from '../../path/builder';
import { pathLength, pointAtOffset } from '../../path/geometry';
import type { NodeTypeDefinition, NodeValue, PathValue, WidthPoint } from '../../types';

const EMPTY_PATH: PathValue = { commands: new Float64Array(0), closed: false };

/** Linear interpolation between two width profile points. */
function interpolateWidth(profile: WidthPoint[], offset: number): number {
  if (profile.length === 0) return 0;
  if (profile.length === 1) return profile[0].width;

  // Clamp to profile range
  if (offset <= profile[0].offset) return profile[0].width;
  if (offset >= profile[profile.length - 1].offset) return profile[profile.length - 1].width;

  // Binary search for surrounding segment
  let lo = 0;
  let hi = profile.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (profile[mid].offset <= offset) {
      lo = mid;
    } else {
      hi = mid;
    }
  }

  const a = profile[lo];
  const b = profile[hi];
  const span = b.offset - a.offset;
  if (span < 1e-10) return a.width;
  const t = (offset - a.offset) / span;
  return a.width + (b.width - a.width) * t;
}

/** Approximate semicircle as cubic beziers (2 beziers, going from left to right via end cap). */
function appendSemicircle(
  builder: PathBuilder,
  cx: number,
  cy: number,
  nx: number,
  ny: number,
  radius: number,
  reverse: boolean,
): void {
  // Normal vector points from center toward the left offset point.
  // The arc goes from left endpoint around the cap to right endpoint.
  // left = center + normal * radius
  // right = center - normal * radius
  // The semicircle goes in the direction of the tangent.

  // Approximate a 180-degree arc as two cubic beziers.
  // Each quarter circle uses kappa = 0.5522847498.
  const kappa = 0.5522847498;

  // tangent direction: perpendicular to normal, pointing outward (in path travel direction)
  // End cap (reverse=false): tangent = (ny, -nx) → bulge in forward direction
  // Start cap (reverse=true): tangent = (-ny, nx) → bulge in backward direction
  const tx = reverse ? -ny : ny;
  const ty = reverse ? nx : -nx;

  // Start point: center + normal * radius
  // End point: center - normal * radius
  // For the semicircle going "outward" via the tangent direction:
  // P0 = center + n*r
  // P3 = center - n*r
  // CP1 = P0 + t*r*kappa*2 (kappa*2 for half-circle approximation)
  // CP2 = P3 + t*r*kappa*2

  const r = radius;
  // Half-circle: use kappa factor 4/3 * tan(pi/4) = 4/3 ≈ 1.333... for 90-deg arcs
  // For 180-deg arc split into two 90-deg arcs:
  // midpoint of arc: center + tangent * radius
  const midX = cx + tx * r;
  const midY = cy + ty * r;

  // First quarter: P0 → mid
  const p0x = cx + nx * r;
  const p0y = cy + ny * r;
  const p3x = cx - nx * r;
  const p3y = cy - ny * r;

  const cp1x = p0x + tx * r * kappa;
  const cp1y = p0y + ty * r * kappa;
  const cp2x = midX - nx * r * kappa;
  const cp2y = midY - ny * r * kappa;

  const cp3x = midX + nx * r * kappa;
  const cp3y = midY + ny * r * kappa;
  const cp4x = p3x + tx * r * kappa;
  const cp4y = p3y + ty * r * kappa;

  builder.cubicTo(cp1x, cp1y, cp2x, cp2y, midX, midY);
  builder.cubicTo(cp3x, cp3y, cp4x, cp4y, p3x, p3y);
}

/** Append a square cap: extends by halfWidth along the tangent before closing. */
function appendSquareCap(
  builder: PathBuilder,
  cx: number,
  cy: number,
  tx: number,
  ty: number,
  nx: number,
  ny: number,
  halfWidth: number,
  reverse: boolean,
): void {
  // The square cap extends the stroke by halfWidth in the tangent direction.
  // Going from left side to right side via the extended corner.
  const extX = cx + tx * halfWidth * (reverse ? -1 : 1);
  const extY = cy + ty * halfWidth * (reverse ? -1 : 1);

  // left = cx + nx*hw, right = cx - nx*hw
  // extended left = extX + nx*hw, extended right = extX - nx*hw
  if (!reverse) {
    builder.lineTo(extX + nx * halfWidth, extY + ny * halfWidth);
    builder.lineTo(extX - nx * halfWidth, extY - ny * halfWidth);
  } else {
    builder.lineTo(extX - nx * halfWidth, extY - ny * halfWidth);
    builder.lineTo(extX + nx * halfWidth, extY + ny * halfWidth);
  }
}

export const variableStrokeNode: NodeTypeDefinition = {
  type: 'variableStroke',
  label: 'Variable Stroke',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'profile', type: 'json', default: '[{"offset":0,"width":10},{"offset":1,"width":10}]' },
    {
      name: 'cap',
      type: 'enum',
      default: 'round',
      options: [
        { value: 'butt', label: 'Butt' },
        { value: 'round', label: 'Round' },
        { value: 'square', label: 'Square' },
      ],
    },
  ],
  execute(inputs: Record<string, NodeValue | NodeValue[]>, params: Record<string, unknown>): Record<string, NodeValue> {
    const pathVal = inputs.path as NodeValue | undefined;
    if (!pathVal) {
      return { path: { type: 'path', value: EMPTY_PATH } };
    }

    const inputPath = pathVal.value as PathValue;
    if (inputPath.commands.length === 0) {
      return { path: { type: 'path', value: EMPTY_PATH } };
    }

    // Parse width profile
    let profile: WidthPoint[];
    try {
      profile = JSON.parse(params.profile as string) as WidthPoint[];
      if (!Array.isArray(profile) || profile.length === 0) {
        return { path: { type: 'path', value: EMPTY_PATH } };
      }
    } catch {
      return { path: { type: 'path', value: EMPTY_PATH } };
    }

    // Sort profile by offset, just in case
    profile = [...profile].sort((a, b) => a.offset - b.offset);

    const cap = (params.cap as string) ?? 'round';
    const totalLength = pathLength(inputPath.commands);

    if (totalLength < 1e-6) {
      return { path: { type: 'path', value: EMPTY_PATH } };
    }

    // Determine sample count: N = max(floor(totalLength / 2), 20)
    const N = Math.max(Math.floor(totalLength / 2), 20);

    // Sample points along the path
    interface Sample {
      x: number;
      y: number;
      nx: number;
      ny: number;
      tx: number;
      ty: number;
      halfWidth: number;
    }

    const samples: Sample[] = [];
    for (let i = 0; i <= N; i++) {
      const offset = i / N;
      const { point, tangent, normal } = pointAtOffset(inputPath.commands, offset);
      const width = interpolateWidth(profile, offset);
      samples.push({
        x: point.x,
        y: point.y,
        nx: normal.x,
        ny: normal.y,
        tx: tangent.x,
        ty: tangent.y,
        halfWidth: width / 2,
      });
    }

    const first = samples[0];
    const last = samples[samples.length - 1];

    const builder = new PathBuilder();

    // Forward pass: left side (center + normal * halfWidth)
    builder.moveTo(first.x + first.nx * first.halfWidth, first.y + first.ny * first.halfWidth);
    for (let i = 1; i <= N; i++) {
      const s = samples[i];
      builder.lineTo(s.x + s.nx * s.halfWidth, s.y + s.ny * s.halfWidth);
    }

    // End cap
    if (cap === 'round') {
      appendSemicircle(builder, last.x, last.y, last.nx, last.ny, last.halfWidth, false);
    } else if (cap === 'square') {
      appendSquareCap(builder, last.x, last.y, last.tx, last.ty, last.nx, last.ny, last.halfWidth, false);
    } else {
      // butt: straight line to right side endpoint
      builder.lineTo(last.x - last.nx * last.halfWidth, last.y - last.ny * last.halfWidth);
    }

    // Backward pass: right side (center - normal * halfWidth), reversed
    for (let i = N - 1; i >= 1; i--) {
      const s = samples[i];
      builder.lineTo(s.x - s.nx * s.halfWidth, s.y - s.ny * s.halfWidth);
    }

    // Start cap
    if (cap === 'round') {
      // The backward pass ends at samples[1] right side; we now need the arc at the start.
      // We are currently at samples[1] right side; move to start right side first.
      builder.lineTo(first.x - first.nx * first.halfWidth, first.y - first.ny * first.halfWidth);
      // Semicircle going from right to left (reverse direction)
      appendSemicircle(builder, first.x, first.y, first.nx, first.ny, first.halfWidth, true);
    } else if (cap === 'square') {
      builder.lineTo(first.x - first.nx * first.halfWidth, first.y - first.ny * first.halfWidth);
      appendSquareCap(builder, first.x, first.y, first.tx, first.ty, first.nx, first.ny, first.halfWidth, true);
    } else {
      // butt: straight line back to start left side (closes the shape)
      builder.lineTo(first.x - first.nx * first.halfWidth, first.y - first.ny * first.halfWidth);
    }

    builder.close();
    const result = builder.build();

    return { path: { type: 'path', value: result } };
  },
};
