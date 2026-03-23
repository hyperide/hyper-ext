/**
 * @file Trim path operation — extracts a sub-path between start% and end% of total arc-length
 *
 * Accessed via: Path menu > Trim Path (After Effects-style)
 *
 * Tradeoffs: produces a polyline approximation of the trimmed path by flattening to
 *   vertices first, then walking to start/end offsets. This avoids the complexity of
 *   exact bezier reparameterization at arbitrary arc-length offsets. Tolerance 0.5px
 *   is adequate for display; tighten for high-precision export.
 *
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import { flattenPath } from '../../path/flatten';
import { pathLength } from '../../path/geometry';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

/** Euclidean distance between two points. */
function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

export const trimPathNode: NodeTypeDefinition = {
  type: 'trimPath',
  label: 'Trim Path',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'start', type: 'number', default: 0, min: 0, max: 1, step: 0.01 },
    { name: 'end', type: 'number', default: 1, min: 0, max: 1, step: 0.01 },
  ],
  execute(inputs, params) {
    const empty: PathValue = { commands: new Float64Array(0), closed: false };

    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: empty } };
    }
    const path = pathInput.value as PathValue;
    const start = Math.max(0, Math.min(1, params.start as number));
    const end = Math.max(0, Math.min(1, params.end as number));

    if (path.commands.length === 0) {
      return { path: { type: 'path', value: empty } };
    }

    const total = pathLength(path.commands);

    if (total < 1e-10) {
      return { path: { type: 'path', value: empty } };
    }

    const startDist = start * total;
    const endDist = end * total;

    // Degenerate: zero-length trim — emit single Move at start point
    if (Math.abs(endDist - startDist) < 1e-10) {
      const pts = flattenPath(path.commands, 0.5);
      if (pts.length === 0) {
        return { path: { type: 'path', value: empty } };
      }
      // Walk to startDist to find the exact point
      let accumulated = 0;
      let px = pts[0].x;
      let py = pts[0].y;
      for (let i = 1; i < pts.length; i++) {
        const segLen = dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
        if (accumulated + segLen >= startDist) {
          const localT = segLen > 1e-10 ? (startDist - accumulated) / segLen : 0;
          px = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * localT;
          py = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * localT;
          break;
        }
        accumulated += segLen;
      }
      const cmds: PathCommand[] = [{ type: PathCmd.Move, x: px, y: py }];
      return { path: { type: 'path', value: { commands: encodeCommands(cmds), closed: false } } };
    }

    // Full path: start=0, end=1 — return as-is (preserve original commands)
    if (startDist <= 1e-10 && endDist >= total - 1e-10) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // General case: flatten and walk from startDist to endDist
    const pts = flattenPath(path.commands, 0.5);
    if (pts.length === 0) {
      return { path: { type: 'path', value: empty } };
    }

    const outCmds: PathCommand[] = [];
    let accumulated = 0;
    let emitting = false;

    for (let i = 1; i < pts.length; i++) {
      const segLen = dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y);
      const segStart = accumulated;
      const segEnd = accumulated + segLen;

      // Segment overlaps with [startDist, endDist]
      if (segEnd > startDist && segStart < endDist) {
        if (!emitting) {
          // Interpolate exact start point within this segment
          const localT = segLen > 1e-10 ? (startDist - segStart) / segLen : 0;
          const sx = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * Math.max(0, localT);
          const sy = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * Math.max(0, localT);
          outCmds.push({ type: PathCmd.Move, x: sx, y: sy });
          emitting = true;
        }

        if (segEnd >= endDist) {
          // Interpolate exact end point within this segment
          const localT = segLen > 1e-10 ? (endDist - segStart) / segLen : 1;
          const ex = pts[i - 1].x + (pts[i].x - pts[i - 1].x) * Math.min(1, localT);
          const ey = pts[i - 1].y + (pts[i].y - pts[i - 1].y) * Math.min(1, localT);
          outCmds.push({ type: PathCmd.Line, x: ex, y: ey });
          break;
        }

        // Emit the full segment endpoint
        outCmds.push({ type: PathCmd.Line, x: pts[i].x, y: pts[i].y });
      }

      accumulated = segEnd;
    }

    if (outCmds.length === 0) {
      return { path: { type: 'path', value: empty } };
    }

    return {
      path: {
        type: 'path',
        value: { commands: encodeCommands(outCmds), closed: false },
      },
    };
  },
};
