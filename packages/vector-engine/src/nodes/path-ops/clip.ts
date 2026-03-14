/**
 * @file Clip node — attaches a clipping shape to a path
 *
 * Takes a path and a clip shape, passes both through. The executor
 * picks up clipPath from terminal outputs and forwards it to the scene.
 *
 * Accessed via: Right-click > Set as Clip Mask, or Path menu > Clip
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Path Ops
 */

import type { NodeTypeDefinition, NodeValue } from '../../types';

export const clipNode: NodeTypeDefinition = {
  type: 'clip',
  label: 'Clip',
  category: 'pathOp',
  inputs: [
    { name: 'path', type: 'path' },
    { name: 'clip', type: 'path' },
    { name: 'style', type: 'style' },
    { name: 'transform', type: 'transform' },
  ],
  outputs: [
    { name: 'path', type: 'path' },
    { name: 'style', type: 'style' },
    { name: 'clipPath', type: 'path' },
    { name: 'transform', type: 'transform' },
  ],
  params: [],
  execute(inputs) {
    const result: Record<string, NodeValue> = {};
    if (inputs.path) result.path = inputs.path as NodeValue;
    if (inputs.style) result.style = inputs.style as NodeValue;
    if (inputs.clip) result.clipPath = inputs.clip as NodeValue;
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    return result;
  },
};
