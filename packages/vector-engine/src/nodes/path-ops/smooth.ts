/**
 * @file Smooth path operation — converts corner vertices to cubic Bézier curves
 *
 * Accessed via: Path menu > Smooth
 *
 * Assumptions: only processes line segments (Move + Line* [+ Close]).
 *   Paths that already contain curves are passed through unchanged.
 *   Symmetric tangent handles: both handles at a vertex are equal length and
 *   collinear, giving G1 continuity.
 *
 * Algorithm: for each interior vertex compute the chord from prev→next,
 *   normalize it, scale by smoothness * min(prevEdge, nextEdge) * 0.5,
 *   and use ±direction as the outgoing/incoming control points.
 *   Open-path endpoints use one-sided tangents.
 *   Closed paths wrap around so the first/last vertex is also smoothed.
 *
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Advanced Path Operations
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

function dist(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

function normalize(dx: number, dy: number): { x: number; y: number } {
  const mag = Math.sqrt(dx * dx + dy * dy);
  if (mag < 1e-10) return { x: 0, y: 0 };
  return { x: dx / mag, y: dy / mag };
}

/**
 * Extracts vertices from an open or closed pure-polyline path.
 * Returns null when the path contains non-line commands (curves/arcs) — those pass through.
 */
function extractPolylineVertices(cmds: PathCommand[], closed: boolean): Array<{ x: number; y: number }> | null {
  const hasClosed = cmds.length > 0 && cmds[cmds.length - 1].type === PathCmd.Close;
  const drawing = hasClosed ? cmds.slice(0, -1) : cmds;

  if (drawing.length < 2) return null;

  const vertices: Array<{ x: number; y: number }> = [];
  for (const cmd of drawing) {
    if (cmd.type === PathCmd.Move || cmd.type === PathCmd.Line) {
      vertices.push({ x: cmd.x, y: cmd.y });
    } else {
      // Contains curves — pass through unchanged
      return null;
    }
  }

  // Closed paths need at least 3 vertices to smooth
  if (closed || hasClosed) {
    return vertices.length >= 3 ? vertices : null;
  }
  // Open paths need at least 2 vertices (interior vertex = the middle one(s))
  return vertices.length >= 2 ? vertices : null;
}

/**
 * Builds smoothed commands from an array of vertices.
 *
 * For each interior vertex (or all vertices if closed), computes a symmetric
 * Catmull-Rom-style tangent handle and replaces the Line with a Cubic.
 */
function buildSmoothedPath(
  vertices: Array<{ x: number; y: number }>,
  smoothness: number,
  closed: boolean,
): PathCommand[] {
  const n = vertices.length;
  const cmds: PathCommand[] = [{ type: PathCmd.Move, x: vertices[0].x, y: vertices[0].y }];

  // Pre-compute per-vertex outgoing tangent handle (direction + length)
  // handles[i] = outgoing handle offset from vertices[i]
  const outHandle: Array<{ x: number; y: number }> = new Array(n);

  for (let i = 0; i < n; i++) {
    const prev = closed ? vertices[(i - 1 + n) % n] : i > 0 ? vertices[i - 1] : null;
    const next = closed ? vertices[(i + 1) % n] : i < n - 1 ? vertices[i + 1] : null;
    const cur = vertices[i];

    if (!prev && !next) {
      outHandle[i] = { x: 0, y: 0 };
      continue;
    }

    let tangentX: number;
    let tangentY: number;
    let handleLen: number;

    if (prev && next) {
      // Interior vertex (or all in closed path): symmetric chord tangent
      const dir = normalize(next.x - prev.x, next.y - prev.y);
      const prevEdgeLen = dist(prev.x, prev.y, cur.x, cur.y);
      const nextEdgeLen = dist(cur.x, cur.y, next.x, next.y);
      handleLen = smoothness * Math.min(prevEdgeLen, nextEdgeLen) * 0.5;
      tangentX = dir.x;
      tangentY = dir.y;
    } else if (next) {
      // First vertex of open path: one-sided tangent toward next
      const dir = normalize(next.x - cur.x, next.y - cur.y);
      const nextEdgeLen = dist(cur.x, cur.y, next.x, next.y);
      handleLen = smoothness * nextEdgeLen * 0.5;
      tangentX = dir.x;
      tangentY = dir.y;
    } else if (prev) {
      // Last vertex of open path: one-sided tangent from prev
      const dir = normalize(cur.x - prev.x, cur.y - prev.y);
      const prevEdgeLen = dist(prev.x, prev.y, cur.x, cur.y);
      handleLen = smoothness * prevEdgeLen * 0.5;
      tangentX = dir.x;
      tangentY = dir.y;
    } else {
      // Isolated vertex — no neighbors
      outHandle[i] = { x: 0, y: 0 };
      continue;
    }

    outHandle[i] = { x: tangentX * handleLen, y: tangentY * handleLen };
  }

  // Build segments: each segment from vertices[i] → vertices[i+1]
  // cp1 = vertices[i] + outHandle[i]  (outgoing handle of start)
  // cp2 = vertices[i+1] - outHandle[i+1]  (incoming handle of end = -outHandle direction)
  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const from = vertices[i];
    const to = vertices[(i + 1) % n];
    const h1 = outHandle[i];
    const h2 = outHandle[(i + 1) % n];

    cmds.push({
      type: PathCmd.Cubic,
      cx1: from.x + h1.x,
      cy1: from.y + h1.y,
      cx2: to.x - h2.x,
      cy2: to.y - h2.y,
      x: to.x,
      y: to.y,
    });
  }

  if (closed) {
    cmds.push({ type: PathCmd.Close });
  }

  return cmds;
}

export const smoothNode: NodeTypeDefinition = {
  type: 'smooth',
  label: 'Smooth',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'smoothness', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const smoothness = params.smoothness as number;

    if (smoothness <= 0) {
      return { path: { type: 'path', value: { ...path } } };
    }

    const cmds = decodeCommands(path.commands);
    const vertices = extractPolylineVertices(cmds, path.closed);

    if (!vertices) {
      // Not a polyline — pass through unchanged
      return { path: { type: 'path', value: { ...path } } };
    }

    const hasClosed = cmds.length > 0 && cmds[cmds.length - 1].type === PathCmd.Close;
    const result: PathValue = {
      commands: encodeCommands(buildSmoothedPath(vertices, smoothness, hasClosed)),
      closed: path.closed,
    };
    return { path: { type: 'path', value: result } };
  },
};
