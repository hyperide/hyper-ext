/**
 * @file Skew transform node — produces a 2D skew matrix
 *
 * Accessed via: Properties panel > Transform > Skew
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Transform Nodes
 *
 * Skew matrix: [1, tan(skewY), tan(skewX), 1, 0, 0]
 * where m[1]=tan(skewY) shears vertically, m[2]=tan(skewX) shears horizontally
 */

import type { NodeTypeDefinition, NodeValue, TransformMatrix } from '../../types';
import { composeTransforms } from './compose';

export const skewNode: NodeTypeDefinition = {
  type: 'skew',
  label: 'Skew',
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
    { name: 'ax', type: 'number', default: 0, label: 'Skew X (deg)' },
    { name: 'ay', type: 'number', default: 0, label: 'Skew Y (deg)' },
  ],
  execute(inputs, params) {
    const { ax, ay } = params as { ax: number; ay: number };
    const tanX = Math.tan((ax * Math.PI) / 180);
    const tanY = Math.tan((ay * Math.PI) / 180);
    const m: TransformMatrix = [1, tanY, tanX, 1, 0, 0];
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
