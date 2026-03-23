/**
 * @file Pucker & Bloat deformation node — moves path points toward or away from the centroid
 *
 * Accessed via: Vector engine graph — add "Pucker & Bloat" node to reshape paths radially
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { fitCurve } from '../../curve/fit';
import { flattenPath } from '../../path/flatten';
import type { NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';

function deformResult(points: Point[], fitError: number): PathValue {
  return fitCurve(points, fitError);
}

export const puckerBloatNode: NodeTypeDefinition = {
  type: 'puckerBloat',
  label: 'Pucker & Bloat',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'amount', type: 'number', default: 50, min: -100, max: 100 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const amount = params.amount as number;

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

    const factor = amount / 100;
    const displaced: Point[] = source.map((p) => {
      const dirX = p.x - cx;
      const dirY = p.y - cy;
      if (amount >= 0) {
        // Pucker: move toward centroid
        return { x: cx + dirX * (1 - factor), y: cy + dirY * (1 - factor) };
      }
      // Bloat: move away from centroid
      return { x: cx + dirX * (1 + Math.abs(factor)), y: cy + dirY * (1 + Math.abs(factor)) };
    });

    return {
      path: {
        type: 'path',
        value: deformResult(displaced, Math.max(1, Math.abs(amount) * 0.1)),
      },
    };
  },
};
