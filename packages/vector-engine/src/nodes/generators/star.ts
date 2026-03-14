/**
 * @file Star generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Star
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 *
 * Alternates between outer and inner vertices. For N points: 2*N vertices total,
 * outer at angle = i * 2π/N - π/2, inner offset by π/N.
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

export const starNode: NodeTypeDefinition = {
  type: 'star',
  label: 'Star',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'points', type: 'number', default: 5, min: 3, step: 1 },
    { name: 'outerRadius', type: 'number', default: 50, min: 0 },
    { name: 'innerRadius', type: 'number', default: 20, min: 0 },
    { name: 'cx', type: 'number', default: 0 },
    { name: 'cy', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { points, outerRadius, innerRadius, cx, cy } = params as {
      points: number;
      outerRadius: number;
      innerRadius: number;
      cx: number;
      cy: number;
    };
    const p = Math.max(3, Math.round(points));
    const builder = new PathBuilder();
    const total = p * 2;

    for (let i = 0; i < total; i++) {
      const angle = (i * Math.PI) / p - Math.PI / 2;
      const r = i % 2 === 0 ? outerRadius : innerRadius;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
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
