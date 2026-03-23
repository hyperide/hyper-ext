/**
 * @file Roughen deformation node — randomly displaces intermediate points along segment normals
 *
 * Accessed via: Vector engine graph — add "Roughen" node to add organic irregularity to paths
 * Assumptions: seeded PRNG (mulberry32) makes output deterministic for given seed/params
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { fitCurve } from '../../curve/fit';
import { PathBuilder } from '../../path/builder';
import { flattenPath } from '../../path/flatten';
import type { NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';

/**
 * Mulberry32 seeded PRNG — returns a function that yields floats in [0, 1).
 */
function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Build a polyline or re-fit bezier from displaced points.
 */
function deformResult(points: Point[], type: string, fitError: number): PathValue {
  if (type === 'smooth' && points.length >= 2) {
    return fitCurve(points, fitError);
  }
  const builder = new PathBuilder();
  if (points.length > 0) {
    builder.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i++) {
      builder.lineTo(points[i].x, points[i].y);
    }
  }
  return builder.build();
}

export const roughenNode: NodeTypeDefinition = {
  type: 'roughen',
  label: 'Roughen',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'size', type: 'number', default: 10, min: 0 },
    { name: 'detail', type: 'number', default: 5, min: 1, max: 20 },
    {
      name: 'type',
      type: 'enum',
      default: 'corner',
      options: [
        { value: 'corner', label: 'Corner' },
        { value: 'smooth', label: 'Smooth' },
      ],
    },
    { name: 'seed', type: 'number', default: 42 },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const size = params.size as number;
    const detail = Math.max(1, Math.round(params.detail as number));
    const type = params.type as string;
    const seed = params.seed as number;

    const source = flattenPath(path.commands, 0.5);
    if (source.length < 2) {
      return { path: { type: 'path', value: { ...path } } };
    }

    const prng = mulberry32(seed);
    const displaced: Point[] = [source[0]];

    for (let i = 0; i < source.length - 1; i++) {
      const p0 = source[i];
      const p1 = source[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      // Perpendicular normal (unit vector rotated 90°)
      const nx = len > 1e-10 ? -dy / len : 0;
      const ny = len > 1e-10 ? dx / len : 0;

      // Insert `detail` intermediate points between p0 and p1
      for (let k = 1; k <= detail; k++) {
        const t = k / (detail + 1);
        const px = p0.x + dx * t;
        const py = p0.y + dy * t;
        const offset = (prng() * 2 - 1) * size;
        displaced.push({ x: px + nx * offset, y: py + ny * offset });
      }

      displaced.push(p1);
    }

    return {
      path: {
        type: 'path',
        value: deformResult(displaced, type, size * 0.5),
      },
    };
  },
};
