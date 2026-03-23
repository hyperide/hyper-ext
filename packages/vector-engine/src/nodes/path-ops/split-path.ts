/**
 * @file Split Path operation — divides a path at a normalized arc-length offset
 *
 * Accessed via: Path menu > Split Path
 *
 * Tradeoffs: produces polyline sub-paths by flattening to vertices first, then
 *   walking to the split point. This avoids exact bezier reparameterization at
 *   arbitrary arc-length offsets. Tolerance 0.5px is adequate for display.
 *
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import { flattenPath } from '../../path/flatten';
import { pathLength } from '../../path/geometry';
import { dist } from '../../path/math';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

const EMPTY_PATH: PathValue = { commands: new Float64Array(0), closed: false };

export const splitPathNode: NodeTypeDefinition = {
  type: 'splitPath',
  label: 'Split Path',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [
    { name: 'pathA', type: 'path' },
    { name: 'pathB', type: 'path' },
  ],
  params: [{ name: 'offset', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 }],
  execute(inputs, params) {
    const emptyResult = {
      pathA: { type: 'path' as const, value: EMPTY_PATH },
      pathB: { type: 'path' as const, value: EMPTY_PATH },
    };

    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) return emptyResult;

    const path = pathInput.value as PathValue;
    if (path.commands.length === 0) return emptyResult;

    const offset = Math.max(0, Math.min(1, params.offset as number));

    // offset=0 → everything in pathB
    if (offset <= 1e-10) {
      return {
        pathA: { type: 'path', value: EMPTY_PATH },
        pathB: { type: 'path', value: { ...path } },
      };
    }

    // offset=1 → everything in pathA
    if (offset >= 1 - 1e-10) {
      return {
        pathA: { type: 'path', value: { ...path } },
        pathB: { type: 'path', value: EMPTY_PATH },
      };
    }

    const total = pathLength(path.commands);
    if (total < 1e-10) return emptyResult;

    const splitDist = offset * total;

    const pts = flattenPath(path.commands, 0.5);
    if (pts.length === 0) return emptyResult;

    // Walk the flattened polyline to find the split point
    const aCmds: PathCommand[] = [];
    const bCmds: PathCommand[] = [];

    let accumulated = 0;
    let splitFound = false;

    aCmds.push({ type: PathCmd.Move, x: pts[0].x, y: pts[0].y });

    for (let i = 1; i < pts.length; i++) {
      const segLen = dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      const segStart = accumulated;
      const segEnd = accumulated + segLen;

      if (!splitFound && segEnd >= splitDist) {
        // Interpolate exact split point within this segment
        const localT = segLen > 1e-10 ? (splitDist - segStart) / segLen : 0;
        const sx = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * localT;
        const sy = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * localT;

        aCmds.push({ type: PathCmd.Line, x: sx, y: sy });
        bCmds.push({ type: PathCmd.Move, x: sx, y: sy });
        splitFound = true;
      }

      if (splitFound) {
        bCmds.push({ type: PathCmd.Line, x: pts[i].x, y: pts[i].y });
      } else {
        aCmds.push({ type: PathCmd.Line, x: pts[i].x, y: pts[i].y });
      }

      accumulated = segEnd;
    }

    // Fallback: split point never reached (floating-point edge case) — all in pathA
    if (!splitFound) {
      return {
        pathA: { type: 'path', value: { ...path } },
        pathB: { type: 'path', value: EMPTY_PATH },
      };
    }

    return {
      pathA: {
        type: 'path',
        value: { commands: encodeCommands(aCmds), closed: false },
      },
      pathB: {
        type: 'path',
        value: { commands: encodeCommands(bCmds), closed: false },
      },
    };
  },
};
