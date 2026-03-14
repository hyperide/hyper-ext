/**
 * @file Spiral generator node
 *
 * Accessed via: Vector toolbar > Shape picker > Spiral
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Generator Nodes
 *
 * Parametric Archimedean spiral: r = startRadius + (endRadius - startRadius) * t
 * where t ∈ [0, 1] over the total arc. Approximated with line segments at
 * SEGMENTS_PER_TURN resolution.
 */

import { PathBuilder } from '../../path/builder';
import type { NodeTypeDefinition } from '../../types';

const SEGMENTS_PER_TURN = 32;

export const spiralNode: NodeTypeDefinition = {
  type: 'spiral',
  label: 'Spiral',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'turns', type: 'number', default: 3, min: 0.25, step: 0.25 },
    { name: 'startRadius', type: 'number', default: 10, min: 0 },
    { name: 'endRadius', type: 'number', default: 50, min: 0 },
    { name: 'cx', type: 'number', default: 0 },
    { name: 'cy', type: 'number', default: 0 },
  ],
  execute(_inputs, params) {
    const { turns, startRadius, endRadius, cx, cy } = params as {
      turns: number;
      startRadius: number;
      endRadius: number;
      cx: number;
      cy: number;
    };

    const totalSegments = Math.max(1, Math.round(turns * SEGMENTS_PER_TURN));
    const builder = new PathBuilder();

    for (let i = 0; i <= totalSegments; i++) {
      const t = i / totalSegments;
      const angle = t * turns * 2 * Math.PI - Math.PI / 2;
      const r = startRadius + (endRadius - startRadius) * t;
      const x = cx + r * Math.cos(angle);
      const y = cy + r * Math.sin(angle);
      if (i === 0) {
        builder.moveTo(x, y);
      } else {
        builder.lineTo(x, y);
      }
    }

    const path = builder.build();
    return { path: { type: 'path', value: path } };
  },
};
