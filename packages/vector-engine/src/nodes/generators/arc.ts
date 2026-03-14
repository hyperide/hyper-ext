/**
 * @file Arc generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Arc
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 *
 * Arc is approximated by cubic bezier segments, split at 90° intervals.
 * Each segment uses the standard cubic arc approximation formula:
 *   k = (4/3) * tan(angle/4)
 * which minimises max error vs. a true circular arc.
 *
 * Past bugs: degenerate arcs (startAngle === endAngle) return single M point.
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

const DEG_TO_RAD = Math.PI / 180;
/** Max arc segment size before splitting (90°) */
const MAX_SEGMENT_ANGLE = Math.PI / 2;

/**
 * Appends cubic bezier approximations of a circular arc onto the builder.
 * Assumes builder is already at the arc start point.
 */
function appendArcCubics(
  builder: PathBuilder,
  cx: number,
  cy: number,
  radius: number,
  startRad: number,
  endRad: number,
): void {
  const totalAngle = endRad - startRad;
  const segments = Math.ceil(Math.abs(totalAngle) / MAX_SEGMENT_ANGLE);
  const step = totalAngle / segments;

  for (let i = 0; i < segments; i++) {
    const a1 = startRad + i * step;
    const a2 = a1 + step;
    // Per-segment handle length: (4/3) * tan(θ/4) is the standard formula
    // for approximating a circular arc of angle θ with a single cubic bezier.
    // See: https://pomax.github.io/bezierinfo/#circles_cubic
    const k = (4 / 3) * Math.tan(step / 4);

    const cos1 = Math.cos(a1);
    const sin1 = Math.sin(a1);
    const cos2 = Math.cos(a2);
    const sin2 = Math.sin(a2);

    const x1 = cx + radius * cos1;
    const y1 = cy + radius * sin1;
    const x2 = cx + radius * cos2;
    const y2 = cy + radius * sin2;

    builder.cubicTo(
      x1 - k * radius * sin1,
      y1 + k * radius * cos1,
      x2 + k * radius * sin2,
      y2 - k * radius * cos2,
      x2,
      y2,
    );
  }
}

export const arcNode: NodeTypeDefinition = {
  type: 'arc',
  label: 'Arc',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'radius', type: 'number', default: 50, min: 0 },
    { name: 'startAngle', type: 'number', default: 0, label: 'Start Angle (°)' },
    { name: 'endAngle', type: 'number', default: 90, label: 'End Angle (°)' },
    { name: 'cx', type: 'number', default: 0 },
    { name: 'cy', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { radius, startAngle, endAngle, cx, cy } = params as {
      radius: number;
      startAngle: number;
      endAngle: number;
      cx: number;
      cy: number;
    };

    const startRad = startAngle * DEG_TO_RAD;
    const endRad = endAngle * DEG_TO_RAD;

    const startX = cx + radius * Math.cos(startRad);
    const startY = cy + radius * Math.sin(startRad);

    const builder = new PathBuilder().moveTo(startX, startY);

    if (startRad !== endRad) {
      appendArcCubics(builder, cx, cy, radius, startRad, endRad);
    }

    const path = builder.build();
    return { path: { type: 'path', value: path } };
  },
};
