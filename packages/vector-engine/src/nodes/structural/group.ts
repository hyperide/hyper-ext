/**
 * @file Group node — merges multiple path inputs into a compound path
 *
 * Accessed via: Node graph > Structural > Group — collects child paths into one compound path
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Structural Nodes
 */

import { mergePaths } from '../../path/merge';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export const groupNode: NodeTypeDefinition = {
  type: 'group',
  label: 'Group',
  category: 'utility',
  inputs: [
    { name: 'children', type: 'path', multiple: true },
    { name: 'transform', type: 'transform' },
  ],
  outputs: [
    { name: 'path', type: 'path' },
    { name: 'transform', type: 'transform' },
  ],
  params: [{ name: 'opacity', type: 'number', default: 1, min: 0, max: 1, step: 0.01 }],
  execute(inputs) {
    const childInput = inputs.children;
    const children = Array.isArray(childInput)
      ? childInput.map((c) => (c as NodeValue).value as PathValue)
      : childInput
        ? [(childInput as NodeValue).value as PathValue]
        : [];
    const merged = mergePaths(children);
    const result: Record<string, NodeValue> = {
      path: { type: 'path', value: merged },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    return result;
  },
};
