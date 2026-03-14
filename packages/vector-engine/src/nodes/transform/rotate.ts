/**
 * @file Rotate transform node — produces a 2D rotation matrix
 *
 * Accessed via: Properties panel > Transform > Rotation
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Transform Nodes
 *
 * Rotation with origin (ox, oy): T(ox,oy) × R(θ) × T(-ox,-oy)
 * Matrix: [cos, sin, -sin, cos, ox - ox*cos + oy*sin, oy - ox*sin - oy*cos]
 */

import type { NodeTypeDefinition, NodeValue, TransformMatrix } from '../../types';
import { composeTransforms } from './compose';

export const rotateNode: NodeTypeDefinition = {
  type: 'rotate',
  label: 'Rotate',
  category: 'transform',
  inputs: [
    { name: 'path', type: 'path' },
    { name: 'transform', type: 'transform' },
    { name: 'clipPath', type: 'path' },
  ],
  outputs: [
    { name: 'path', type: 'path' },
    { name: 'transform', type: 'transform' },
    { name: 'clipPath', type: 'path' },
  ],
  params: [
    { name: 'angle', type: 'number', default: 0, label: 'Angle (deg)' },
    { name: 'originX', type: 'number', default: 0 },
    { name: 'originY', type: 'number', default: 0 },
  ],
  execute(inputs, params) {
    const { angle, originX: ox, originY: oy } = params as { angle: number; originX: number; originY: number };
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const m: TransformMatrix = [cos, sin, -sin, cos, ox - ox * cos + oy * sin, oy - ox * sin - oy * cos];
    const incoming = inputs.transform as NodeValue | undefined;
    const composed = composeTransforms(incoming, m);
    const result: Record<string, NodeValue> = {
      transform: { type: 'transform', value: composed },
    };
    if (inputs.path) result.path = inputs.path as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
