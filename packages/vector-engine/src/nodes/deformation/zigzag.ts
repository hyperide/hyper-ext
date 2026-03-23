/**
 * @file Zigzag deformation node — displaces path points in alternating perpendicular directions
 *
 * Accessed via: Vector engine graph — add "Zigzag" node to create sawtooth/wave edge effects
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { fitCurve } from '../../curve/fit';
import { PathBuilder } from '../../path/builder';
import { flattenPath } from '../../path/flatten';
import type { NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';

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

export const zigzagNode: NodeTypeDefinition = {
  type: 'zigzag',
  label: 'Zigzag',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'size', type: 'number', default: 10, min: 0 },
    { name: 'ridgesPerSegment', type: 'number', default: 5, min: 1, max: 50 },
    {
      name: 'type',
      type: 'enum',
      default: 'corner',
      options: [
        { value: 'corner', label: 'Corner' },
        { value: 'smooth', label: 'Smooth' },
      ],
    },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const size = params.size as number;
    const ridgesPerSegment = Math.max(1, Math.round(params.ridgesPerSegment as number));
    const type = params.type as string;

    const source = flattenPath(path.commands, 0.5);
    if (source.length < 2) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // Each segment is divided into ridgesPerSegment * 2 sub-segments
    const subCount = ridgesPerSegment * 2;
    const displaced: Point[] = [source[0]];

    for (let i = 0; i < source.length - 1; i++) {
      const p0 = source[i];
      const p1 = source[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = len > 1e-10 ? -dy / len : 0;
      const ny = len > 1e-10 ? dx / len : 0;

      for (let k = 1; k <= subCount; k++) {
        const t = k / subCount;
        const px = p0.x + dx * t;
        const py = p0.y + dy * t;
        // Even sub-segments: +size, odd: -size (last sub-point is the endpoint, no offset)
        const offset = k < subCount ? (k % 2 === 0 ? size : -size) : 0;
        displaced.push({ x: px + nx * offset, y: py + ny * offset });
      }
    }

    return {
      path: {
        type: 'path',
        value: deformResult(displaced, type, size * 0.5),
      },
    };
  },
};
