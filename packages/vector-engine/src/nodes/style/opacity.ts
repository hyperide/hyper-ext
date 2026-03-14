/**
 * @file Opacity style node — sets opacity on a StyleValue
 *
 * Accessed via: Properties panel > Style > Opacity slider
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Style Nodes
 */

import type { NodeTypeDefinition, NodeValue, StyleValue } from '../../types';

export const opacityNode: NodeTypeDefinition = {
  type: 'opacity',
  label: 'Opacity',
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
  params: [{ name: 'value', type: 'number', default: 1, min: 0, max: 1, step: 0.01 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue;
    const incomingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    const { value } = params as { value: number };

    const newStyle: StyleValue = { ...incomingStyle, opacity: value };
    const result: Record<string, NodeValue> = {
      path: pathInput,
      style: { type: 'style', value: newStyle },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
