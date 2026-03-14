/**
 * @file Polygon generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Polygon
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 *
 * Vertices placed at angle = i * 2π/sides - π/2, starting from the top.
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

export const polygonNode: NodeTypeDefinition = {
  type: 'polygon',
  label: 'Polygon',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'sides', type: 'number', default: 6, min: 3, step: 1 },
    { name: 'radius', type: 'number', default: 50, min: 0 },
    { name: 'cx', type: 'number', default: 0 },
    { name: 'cy', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { sides, radius, cx, cy } = params as { sides: number; radius: number; cx: number; cy: number };
    const s = Math.max(3, Math.round(sides));
    const builder = new PathBuilder();

    for (let i = 0; i < s; i++) {
      const angle = (i * 2 * Math.PI) / s - Math.PI / 2;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      if (i === 0) {
        builder.moveTo(x, y);
      } else {
        builder.lineTo(x, y);
      }
    }

    const path = builder.close().build();
    return { path: { type: 'path', value: path } };
  },
};
