/**
 * @file Shadow style node — adds a drop shadow to a StyleValue
 *
 * Accessed via: Properties panel > Style > Shadow (color, offset, blur radius)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Style Nodes
 */

import type { NodeTypeDefinition, NodeValue, ShadowStyle, StyleValue } from '../../types';

export const shadowNode: NodeTypeDefinition = {
  type: 'shadow',
  label: 'Shadow',
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
  params: [
    { name: 'color', type: 'color', default: '#00000066' },
    { name: 'offsetX', type: 'number', default: 2 },
    { name: 'offsetY', type: 'number', default: 4 },
    { name: 'blur', type: 'number', default: 6, min: 0 },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue;
    const incomingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    const { color, offsetX, offsetY, blur } = params as {
      color: string;
      offsetX: number;
      offsetY: number;
      blur: number;
    };

    const shadow: ShadowStyle = { color, offsetX, offsetY, blur };
    const newStyle: StyleValue = { ...incomingStyle, shadow };
    const result: Record<string, NodeValue> = {
      path: pathInput,
      style: { type: 'style', value: newStyle },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
