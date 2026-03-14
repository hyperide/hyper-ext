/**
 * @file Blend mode style node — sets blendMode on a StyleValue
 *
 * Accessed via: Properties panel > Style > Blend Mode dropdown
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Style Nodes
 */

import type { BlendMode, NodeTypeDefinition, NodeValue, StyleValue } from '../../types';

export const blendModeNode: NodeTypeDefinition = {
  type: 'blendMode',
  label: 'Blend Mode',
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
    {
      name: 'mode',
      type: 'enum',
      default: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'multiply', label: 'Multiply' },
        { value: 'screen', label: 'Screen' },
        { value: 'overlay', label: 'Overlay' },
        { value: 'darken', label: 'Darken' },
        { value: 'lighten', label: 'Lighten' },
        { value: 'colorDodge', label: 'Color Dodge' },
        { value: 'colorBurn', label: 'Color Burn' },
        { value: 'hardLight', label: 'Hard Light' },
        { value: 'softLight', label: 'Soft Light' },
        { value: 'difference', label: 'Difference' },
        { value: 'exclusion', label: 'Exclusion' },
      ],
    },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue;
    const incomingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    const { mode } = params as { mode: BlendMode };

    const newStyle: StyleValue = { ...incomingStyle, blendMode: mode };
    const result: Record<string, NodeValue> = {
      path: pathInput,
      style: { type: 'style', value: newStyle },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
