/**
 * @file Warp deformation node — applies arc/wave/flag/bulge envelope distortions to paths
 *
 * Accessed via: Vector engine graph — add "Warp" node to bend shapes along envelope curves
 * Assumptions: bounding box must have non-zero width and height; degenerate paths pass through
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { flattenPath } from '../../path/flatten';
import type { NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';
import { deformResult } from './deform-util';

type WarpType = 'arc' | 'wave' | 'flag' | 'bulge';

/** Apply warp displacement in normalized (u, v) space, returning adjusted v. */
function applyWarpUV(u: number, v: number, warpType: WarpType, bendFactor: number): { u: number; v: number } {
  switch (warpType) {
    case 'arc':
      return { u, v: v + Math.sin(u * Math.PI) * bendFactor };
    case 'wave':
      return { u, v: v + Math.sin(u * 2 * Math.PI) * bendFactor };
    case 'flag':
      // Attenuates toward bottom (v=1): stronger at top, fades at bottom
      return { u, v: v + Math.sin(u * 2 * Math.PI) * bendFactor * (1 - v) };
    case 'bulge': {
      // Radial expansion from center (0.5, 0.5)
      const du = u - 0.5;
      const dv = v - 0.5;
      const r = Math.sqrt(du * du + dv * dv);
      // r' = r + (1 - r) * |bendFactor| — expand toward edges when positive
      const rNew = r + (1 - r) * Math.abs(bendFactor) * Math.sign(bendFactor);
      if (r < 1e-10) return { u, v };
      const scale = rNew / r;
      return { u: 0.5 + du * scale, v: 0.5 + dv * scale };
    }
  }
}

export const warpNode: NodeTypeDefinition = {
  type: 'warp',
  label: 'Warp',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    {
      name: 'warpType',
      type: 'enum',
      default: 'arc',
      options: [
        { value: 'arc', label: 'Arc' },
        { value: 'wave', label: 'Wave' },
        { value: 'flag', label: 'Flag' },
        { value: 'bulge', label: 'Bulge' },
      ],
    },
    { name: 'bend', type: 'number', default: 50, min: -100, max: 100 },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const warpType = (params.warpType as WarpType) ?? 'arc';
    const bend = params.bend as number;

    const source = flattenPath(path.commands, 0.5);
    if (source.length < 2) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // Compute bounding box
    let minX = source[0].x;
    let minY = source[0].y;
    let maxX = source[0].x;
    let maxY = source[0].y;
    for (const p of source) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }

    const width = maxX - minX;
    const height = maxY - minY;

    // Degenerate bounding box — nothing to warp
    if (width < 1e-10 || height < 1e-10) {
      return { path: { type: 'path', value: { ...path } } };
    }

    const bendFactor = bend / 100;

    const displaced: Point[] = source.map((p) => {
      const u = (p.x - minX) / width;
      const v = (p.y - minY) / height;
      const warped = applyWarpUV(u, v, warpType, bendFactor);
      return {
        x: minX + warped.u * width,
        y: minY + warped.v * height,
      };
    });

    return {
      path: {
        type: 'path',
        value: deformResult(displaced, 'smooth', 1),
      },
    };
  },
};
