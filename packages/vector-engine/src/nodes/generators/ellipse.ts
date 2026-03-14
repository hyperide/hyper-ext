/**
 * @file Ellipse generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Ellipse
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 *
 * Ellipse is approximated by 4 cubic bezier arcs using the standard kappa
 * constant (0.5522847498). Starting at (cx+rx, cy), arcs proceed clockwise
 * through (cx, cy+ry), (cx-rx, cy), (cx, cy-ry), back to start.
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

/** Cubic bezier approximation constant for a quarter-circle arc */
const KAPPA = 0.5522847498;

export const ellipseNode: NodeTypeDefinition = {
  type: 'ellipse',
  label: 'Ellipse',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'rx', type: 'number', default: 50, min: 0 },
    { name: 'ry', type: 'number', default: 50, min: 0 },
    { name: 'cx', type: 'number', default: 0 },
    { name: 'cy', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { rx, ry, cx, cy } = params as { rx: number; ry: number; cx: number; cy: number };
    const kx = rx * KAPPA;
    const ky = ry * KAPPA;

    // 4 arcs: right → bottom → left → top, starting at (cx+rx, cy)
    const path = new PathBuilder()
      .moveTo(cx + rx, cy)
      .cubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
      .cubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
      .cubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
      .cubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
      .close()
      .build();
    return { path: { type: 'path', value: path } };
  },
};
