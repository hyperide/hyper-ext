/**
 * @file Chamfer path operation — replaces sharp vertices with straight diagonal cuts
 *
 * Accessed via: Path menu > Chamfer
 *
 * Assumptions: only processes closed polyline paths (Move + Line commands + Close).
 * Paths with curves or open paths are passed through unchanged.
 *
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Advanced Path Operations
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';
import { extractPolylineVertices } from './polyline-util';

function edgeLength(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Builds a chamfered path from a list of polygon vertices and a cut distance.
 * Each corner vertex is replaced by two points on the adjacent edges, connected by a line.
 */
function buildChamferedPath(vertices: Array<{ x: number; y: number }>, distance: number): PathCommand[] {
  const n = vertices.length;
  const cmds: PathCommand[] = [];

  // Pre-compute cut points for each corner
  const cuts = vertices.map((v, i) => {
    const prev = vertices[(i + n - 1) % n];
    const next = vertices[(i + 1) % n];

    const lenP = edgeLength(v.x, v.y, prev.x, prev.y);
    const lenN = edgeLength(v.x, v.y, next.x, next.y);

    const d = Math.min(distance, lenP / 2, lenN / 2);

    const vpx = (prev.x - v.x) / lenP;
    const vpy = (prev.y - v.y) / lenP;
    const vnx = (next.x - v.x) / lenN;
    const vny = (next.y - v.y) / lenN;

    // Entry point (on edge toward prev) and exit point (on edge toward next)
    return {
      sx: v.x + d * vpx,
      sy: v.y + d * vpy,
      ex: v.x + d * vnx,
      ey: v.y + d * vny,
    };
  });

  // Build path: start at exit point of corner 0 (after the chamfer cut)
  cmds.push({ type: PathCmd.Move, x: cuts[0].ex, y: cuts[0].ey });

  for (let i = 0; i < n; i++) {
    const next = cuts[(i + 1) % n];
    // Line along edge from current corner's exit to next corner's entry
    cmds.push({ type: PathCmd.Line, x: next.sx, y: next.sy });
    // Chamfer cut: only emit when the cut is non-degenerate (d > 0)
    if (next.sx !== next.ex || next.sy !== next.ey) {
      cmds.push({ type: PathCmd.Line, x: next.ex, y: next.ey });
    }
  }

  cmds.push({ type: PathCmd.Close });
  return cmds;
}

export const chamferNode: NodeTypeDefinition = {
  type: 'chamfer',
  label: 'Chamfer',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'distance', type: 'number', default: 10, min: 0 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const distance = params.distance as number;
    const cmds = decodeCommands(path.commands);
    const vertices = extractPolylineVertices(cmds);

    if (!vertices) {
      // Not a closed polyline — pass through unchanged
      return { path: { type: 'path', value: { ...path } } };
    }

    const result: PathValue = {
      commands: encodeCommands(buildChamferedPath(vertices, distance)),
      closed: true,
    };
    return { path: { type: 'path', value: result } };
  },
};
