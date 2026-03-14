/**
 * @file Scale transform node — produces a 2D scale matrix
 *
 * Accessed via: Properties panel > Transform > Scale (drag handles or numeric input)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Transform Nodes
 *
 * Scale with origin (ox, oy): T(ox,oy) × S(sx,sy) × T(-ox,-oy)
 * Matrix: [sx, 0, 0, sy, ox - ox*sx, oy - oy*sy]
 */

import type { NodeTypeDefinition, NodeValue, TransformMatrix } from '../../types';
import { composeTransforms } from './compose';

export const scaleNode: NodeTypeDefinition = {
  type: 'scale',
  label: 'Scale',
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
    { name: 'sx', type: 'number', default: 1 },
    { name: 'sy', type: 'number', default: 1 },
    { name: 'originX', type: 'number', default: 0 },
    { name: 'originY', type: 'number', default: 0 },
  ],
  execute(inputs, params) {
    const {
      sx,
      sy,
      originX: ox,
      originY: oy,
    } = params as {
      sx: number;
      sy: number;
      originX: number;
      originY: number;
    };
    const m: TransformMatrix = [sx, 0, 0, sy, ox - ox * sx, oy - oy * sy];
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
