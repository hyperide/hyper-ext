/**
 * @file Rotate transform node — produces a 2D rotation matrix with optional origin
 *
 * Accessed via: import { rotateNode } from 'vector-engine'
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Transform Nodes
 */

import type { NodeTypeDefinition, TransformMatrix } from '../../types';

export const rotateNode: NodeTypeDefinition = {
  type: 'rotate',
  label: 'Rotate',
  category: 'transform',
  inputs: [],
  outputs: [{ name: 'transform', type: 'transform' }],
  params: [
    { name: 'angle', type: 'number', default: 0 },
    { name: 'originX', type: 'number', default: 0 },
    { name: 'originY', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const {
      angle,
      originX: ox,
      originY: oy,
    } = params as {
      angle: number;
      originX: number;
      originY: number;
    };
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Rotation with origin: T(ox,oy) × R(θ) × T(-ox,-oy)
    const tx = ox - ox * cos + oy * sin;
    const ty = oy - ox * sin - oy * cos;
    const m: TransformMatrix = [cos, sin, -sin, cos, tx, ty];
    return { transform: { type: 'transform', value: m } };
  },
};
