/**
 * @file Twist deformation node — rotates path points around the centroid proportional to distance
 *
 * Accessed via: Vector engine graph — add "Twist" node to spiral/rotate shapes from their center
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { flattenPath } from '../../path/flatten';
import type { NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';
import { deformResult } from './deform-util';

/** Rotate a point around a center by the given angle (radians). */
function rotateAround(p: Point, center: Point, rad: number): Point {
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export const twistNode: NodeTypeDefinition = {
  type: 'twist',
  label: 'Twist',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'angle', type: 'number', default: 45, min: -360, max: 360 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const angleDeg = params.angle as number;

    const source = flattenPath(path.commands, 0.5);
    if (source.length < 2) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // Compute centroid
    let cx = 0;
    let cy = 0;
    for (const p of source) {
      cx += p.x;
      cy += p.y;
    }
    cx /= source.length;
    cy /= source.length;
    const center: Point = { x: cx, y: cy };

    // Find max distance from centroid
    let maxDist = 0;
    for (const p of source) {
      const d = Math.sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
      if (d > maxDist) maxDist = d;
    }

    const displaced: Point[] = source.map((p) => {
      const dist = Math.sqrt((p.x - cx) * (p.x - cx) + (p.y - cy) * (p.y - cy));
      const normalizedDist = maxDist > 1e-10 ? dist / maxDist : 0;
      const rotationRad = (angleDeg * normalizedDist * Math.PI) / 180;
      return rotateAround(p, center, rotationRad);
    });

    return {
      path: {
        type: 'path',
        value: deformResult(displaced, 'smooth', 1),
      },
    };
  },
};
