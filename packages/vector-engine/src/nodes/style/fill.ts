/**
 * @file Fill style node — constructs FillStyle (solid or gradient) and merges into a StyleValue
 *
 * Accessed via: Properties panel > Style > Fill (color picker, gradient editor)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Style Nodes
 */

import type { FillStyle, GradientStop, NodeTypeDefinition, NodeValue, Point, StyleValue } from '../../types';

export const fillNode: NodeTypeDefinition = {
  type: 'fill',
  label: 'Fill',
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
      name: 'fillType',
      type: 'enum',
      default: 'solid',
      options: [
        { value: 'solid', label: 'Solid' },
        { value: 'linearGradient', label: 'Linear Gradient' },
        { value: 'radialGradient', label: 'Radial Gradient' },
        { value: 'conicGradient', label: 'Conic Gradient' },
      ],
    },
    { name: 'color', type: 'color', default: '#000000' },
    { name: 'stops', type: 'json', default: [] },
    { name: 'from', type: 'point', default: { x: 0, y: 0 } },
    { name: 'to', type: 'point', default: { x: 100, y: 0 } },
    { name: 'center', type: 'point', default: { x: 50, y: 50 } },
    { name: 'radius', type: 'number', default: 50, min: 0 },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue;
    const incomingStyle = inputs.style ? ((inputs.style as NodeValue).value as StyleValue) : {};
    const { fillType, color, stops, from, to, center, radius } = params as {
      fillType: FillStyle['type'];
      color?: string;
      stops?: GradientStop[];
      from?: Point;
      to?: Point;
      center?: Point;
      radius?: number;
    };

    let fill: FillStyle;
    if (fillType === 'solid') {
      fill = { type: 'solid', color: color ?? '#000000' };
    } else if (fillType === 'linearGradient') {
      fill = { type: 'linearGradient', stops: stops ?? [], from: from ?? { x: 0, y: 0 }, to: to ?? { x: 100, y: 0 } };
    } else if (fillType === 'radialGradient') {
      fill = { type: 'radialGradient', stops: stops ?? [], center: center ?? { x: 50, y: 50 }, radius: radius ?? 50 };
    } else {
      fill = { type: 'conicGradient', stops: stops ?? [], center: center ?? { x: 50, y: 50 } };
    }

    const newStyle: StyleValue = { ...incomingStyle, fill };
    const result: Record<string, NodeValue> = {
      path: pathInput,
      style: { type: 'style', value: newStyle },
    };
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    if (inputs.clipPath) result.clipPath = inputs.clipPath as NodeValue;
    return result;
  },
};
