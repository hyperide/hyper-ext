/**
 * @file Line generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Line
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

export const lineNode: NodeTypeDefinition = {
  type: 'line',
  label: 'Line',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'x1', type: 'number', default: 0 },
    { name: 'y1', type: 'number', default: 0 },
    { name: 'x2', type: 'number', default: 100 },
    { name: 'y2', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { x1, y1, x2, y2 } = params as { x1: number; y1: number; x2: number; y2: number };
    const path = new PathBuilder().moveTo(x1, y1).lineTo(x2, y2).build();
    return { path: { type: 'path', value: path } };
  },
};
