/**
 * @file Blur style node — adds a Gaussian blur radius to a StyleValue
 *
 * Accessed via: Properties panel > Style > Blur (radius slider)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Style Nodes
 */

import type { NodeTypeDefinition, NodeValue, StyleValue } from '../../types';

export const blurNode: NodeTypeDefinition = {
  type: 'blur',
  label: 'Blur',
  category: 'style',
  inputs: [
    { name: 'path', type: 'path' },
    { name: 'style', type: 'style' },
    { name: 'transform', type: 'transform' },
    { name: 'clipPath', type: 'path' },
  ],
  outputs: [
    { name: 'path', type: 'path' },
    { name: 'style', type: 'style' },
    { name: 'transform', type: 'transform' },
    { name: 'clipPath', type: 'path' },
  ],
  params: [{ name: 'radius', type: 'number', default: 5, min: 0 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue;
    const incomingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    const { radius } = params as { radius: number };

    const newStyle: StyleValue = { ...incomingStyle, blur: radius };
    const result: Record<string, NodeValue> = {
      path: pathInput,
      style: { type: 'style', value: newStyle },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
