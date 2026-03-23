/**
 * @file Round corners path operation — replaces sharp vertices with cubic arc approximations
 *
 * Accessed via: Path menu > Round Corners
 *
 * Assumptions: only processes closed polyline paths (Move + Line commands + Close).
 * Paths with curves or open paths are passed through unchanged.
 *
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Advanced Path Operations
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import { dist } from '../../path/math';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';
import { extractPolylineVertices } from './polyline-util';

/**
 * Builds a rounded path from a list of polygon vertices and a radius.
 * Each corner is replaced with a cubic Bezier arc approximation.
 */
function buildRoundedPath(vertices: Array<{ x: number; y: number }>, radius: number): PathCommand[] {
  const n = vertices.length;
  const cmds: PathCommand[] = [];

  // Pre-compute per-corner data
  const corners = vertices.map((v, i) => {
    const prev = vertices[(i + n - 1) % n];
    const next = vertices[(i + 1) % n];

    const lenP = dist(v.x, v.y, prev.x, prev.y);
    const lenN = dist(v.x, v.y, next.x, next.y);

    // Unit vectors from corner toward adjacent vertices
    const vpx = (prev.x - v.x) / lenP;
    const vpy = (prev.y - v.y) / lenP;
    const vnx = (next.x - v.x) / lenN;
    const vny = (next.y - v.y) / lenN;

    // Half-angle at the corner
    const dot = vpx * vnx + vpy * vny;
    // Clamp dot to [-1, 1] to guard against floating point rounding
    const cosTheta = Math.max(-1, Math.min(1, dot));
    const theta = Math.acos(cosTheta);
    const halfAngle = theta / 2;

    // Offset distance from corner along each edge
    const tanHalf = Math.tan(halfAngle);
    const maxD = tanHalf < 1e-10 ? 0 : Math.min(radius, lenP / 2, lenN / 2);
    const actualRadius = tanHalf < 1e-10 ? 0 : Math.min(maxD / tanHalf, radius);
    const d = actualRadius * tanHalf;

    // Arc start and end on the two edges
    const sx = v.x + d * vpx;
    const sy = v.y + d * vpy;
    const ex = v.x + d * vnx;
    const ey = v.y + d * vny;

    // Cubic Bezier control-point factor for arc approximation
    // arcAngle = π - θ (exterior arc swept at the corner)
    const arcAngle = Math.PI - theta;
    const k = arcAngle > 1e-10 ? (4 / 3) * Math.tan(arcAngle / 4) : 0;
    const t = k * actualRadius;

    return { sx, sy, ex, ey, vpx, vpy, vnx, vny, t };
  });

  // Build the path: start at the arc entry of corner 0
  cmds.push({ type: PathCmd.Move, x: corners[0].sx, y: corners[0].sy });

  for (let i = 0; i < n; i++) {
    const c = corners[i];

    // Cubic arc through this corner (tangent at start = -vp, at end = vn)
    cmds.push({
      type: PathCmd.Cubic,
      cx1: c.sx - c.t * c.vpx,
      cy1: c.sy - c.t * c.vpy,
      cx2: c.ex - c.t * c.vnx,
      cy2: c.ey - c.t * c.vny,
      x: c.ex,
      y: c.ey,
    });

    const next = corners[(i + 1) % n];
    // Line to the start of the next arc
    cmds.push({ type: PathCmd.Line, x: next.sx, y: next.sy });
  }

  cmds.push({ type: PathCmd.Close });
  return cmds;
}

export const roundCornersNode: NodeTypeDefinition = {
  type: 'roundCorners',
  label: 'Round Corners',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'radius', type: 'number', default: 10, min: 0 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const radius = params.radius as number;

    if (radius <= 0) {
      return { path: { type: 'path', value: { ...path } } };
    }

    const cmds = decodeCommands(path.commands);
    const vertices = extractPolylineVertices(cmds);

    if (!vertices) {
      // Not a closed polyline — pass through unchanged
      return { path: { type: 'path', value: { ...path } } };
    }

    const result: PathValue = {
      commands: encodeCommands(buildRoundedPath(vertices, radius)),
      closed: true,
    };
    return { path: { type: 'path', value: result } };
  },
};
