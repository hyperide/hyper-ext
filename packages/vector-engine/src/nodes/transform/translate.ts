/**
 * @file Translate transform node — produces a 2D translation matrix
 *
 * Accessed via: Properties panel > Transform > Position (X, Y)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Transform Nodes
 */

import type { NodeTypeDefinition, NodeValue, TransformMatrix } from '../../types';
import { composeTransforms } from './compose';

export const translateNode: NodeTypeDefinition = {
  type: 'translate',
  label: 'Translate',
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
    { name: 'dx', type: 'number', default: 0 },
    { name: 'dy', type: 'number', default: 0 },
  ],
  execute(inputs, params) {
    const { dx, dy } = params as { dx: number; dy: number };
    const m: TransformMatrix = [1, 0, 0, 1, dx, dy];
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
