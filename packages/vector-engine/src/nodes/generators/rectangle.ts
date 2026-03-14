/**
 * @file Rectangle generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Rectangle
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

export const rectangleNode: NodeTypeDefinition = {
  type: 'rectangle',
  label: 'Rectangle',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'width', type: 'number', default: 100, min: 0 },
    { name: 'height', type: 'number', default: 100, min: 0 },
    { name: 'x', type: 'number', default: 0 },
    { name: 'y', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { width, height, x, y } = params as { width: number; height: number; x: number; y: number };
    const path = new PathBuilder()
      .moveTo(x, y)
      .lineTo(x + width, y)
      .lineTo(x + width, y + height)
      .lineTo(x, y + height)
      .close()
      .build();
    return { path: { type: 'path', value: path } };
  },
};
