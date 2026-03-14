/**
 * @file Stroke style node — constructs StrokeStyle and merges into a StyleValue
 *
 * Accessed via: Properties panel > Style > Stroke (width, color, dash pattern)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Style Nodes
 */

import type { NodeTypeDefinition, NodeValue, StrokeStyle, StyleValue } from '../../types';

export const strokeNode: NodeTypeDefinition = {
  type: 'stroke',
  label: 'Stroke',
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
    { name: 'color', type: 'color', default: '#000000' },
    { name: 'width', type: 'number', default: 1, min: 0 },
    {
      name: 'cap',
      type: 'enum',
      default: 'butt',
      options: [
        { value: 'butt', label: 'Butt' },
        { value: 'round', label: 'Round' },
        { value: 'square', label: 'Square' },
      ],
    },
    {
      name: 'join',
      type: 'enum',
      default: 'miter',
      options: [
        { value: 'miter', label: 'Miter' },
        { value: 'round', label: 'Round' },
        { value: 'bevel', label: 'Bevel' },
      ],
    },
    { name: 'dashArray', type: 'json', default: [] },
    { name: 'dashOffset', type: 'number', default: 0 },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue;
    const incomingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    const { color, width, cap, join, dashArray, dashOffset } = params as {
      color: string;
      width: number;
      cap: StrokeStyle['cap'];
      join: StrokeStyle['join'];
      dashArray?: number[];
      dashOffset?: number;
    };

    const stroke: StrokeStyle = { color, width, cap, join };
    if (dashArray && dashArray.length > 0) {
      stroke.dashArray = dashArray;
      stroke.dashOffset = dashOffset;
    }

    const newStyle: StyleValue = { ...incomingStyle, stroke };
    const result: Record<string, NodeValue> = {
      path: pathInput,
      style: { type: 'style', value: newStyle },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
