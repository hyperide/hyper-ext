/**
 * @file Subdivide path operation — splits a single path segment at parameter t using de Casteljau
 *
 * Accessed via: Path menu > Subdivide
 *
 * Assumptions: segmentIndex counts only drawable segments (Line, Cubic, Quad, Arc),
 *   not Move or Close commands. The Move starting the subpath is always preserved.
 *
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

/** Linear interpolation between two scalars. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * De Casteljau subdivision of a cubic bezier at parameter t.
 * Returns [left, right] where each is a Cubic command (start point is implicit).
 *
 * Given P0(start), P1(cx1,cy1), P2(cx2,cy2), P3(x,y):
 *   L1 = lerp(P0, P1, t),  M  = lerp(P1, P2, t),  R1 = lerp(P2, P3, t)
 *   L2 = lerp(L1,  M, t),  R2 = lerp(M,  R1, t)
 *   S  = lerp(L2, R2, t)   ← split point
 *   Left  half: P0 → [L1, L2, S]
 *   Right half: S  → [R2, R1, P3]
 */
function subdivideCubic(
  x0: number,
  y0: number,
  cx1: number,
  cy1: number,
  cx2: number,
  cy2: number,
  x3: number,
  y3: number,
  t: number,
): [PathCommand, PathCommand] {
  const l1x = lerp(x0, cx1, t);
  const l1y = lerp(y0, cy1, t);
  const mx = lerp(cx1, cx2, t);
  const my = lerp(cy1, cy2, t);
  const r1x = lerp(cx2, x3, t);
  const r1y = lerp(cy2, y3, t);

  const l2x = lerp(l1x, mx, t);
  const l2y = lerp(l1y, my, t);
  const r2x = lerp(mx, r1x, t);
  const r2y = lerp(my, r1y, t);

  const sx = lerp(l2x, r2x, t);
  const sy = lerp(l2y, r2y, t);

  const left: PathCommand = { type: PathCmd.Cubic, cx1: l1x, cy1: l1y, cx2: l2x, cy2: l2y, x: sx, y: sy };
  const right: PathCommand = { type: PathCmd.Cubic, cx1: r2x, cy1: r2y, cx2: r1x, cy2: r1y, x: x3, y: y3 };
  return [left, right];
}

/**
 * De Casteljau subdivision of a quadratic bezier at parameter t.
 *
 * Given P0(start), P1(cx,cy), P2(x,y):
 *   L1 = lerp(P0, P1, t),  R1 = lerp(P1, P2, t)
 *   S  = lerp(L1, R1, t)   ← split point
 *   Left  half: P0 → [L1, S]
 *   Right half: S  → [R1, P2]
 */
function subdivideQuad(
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x2: number,
  y2: number,
  t: number,
): [PathCommand, PathCommand] {
  const l1x = lerp(x0, cx, t);
  const l1y = lerp(y0, cy, t);
  const r1x = lerp(cx, x2, t);
  const r1y = lerp(cy, y2, t);

  const sx = lerp(l1x, r1x, t);
  const sy = lerp(l1y, r1y, t);

  const left: PathCommand = { type: PathCmd.Quad, cx: l1x, cy: l1y, x: sx, y: sy };
  const right: PathCommand = { type: PathCmd.Quad, cx: r1x, cy: r1y, x: x2, y: y2 };
  return [left, right];
}

export const subdivideNode: NodeTypeDefinition = {
  type: 'subdivide',
  label: 'Subdivide',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    { name: 'segmentIndex', type: 'number', default: 0, min: 0 },
    { name: 't', type: 'number', default: 0.5, min: 0, max: 1, step: 0.01 },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const segmentIndex = params.segmentIndex as number;
    const t = Math.max(0, Math.min(1, params.t as number));

    const cmds = decodeCommands(path.commands);

    // Build list of (cmdIndex, startX, startY) for drawable segments only.
    // Move and Close are structural — not user-addressable segments.
    let lastX = 0;
    let lastY = 0;
    let startX = 0;
    let startY = 0;
    const segments: Array<{ cmdIndex: number; fromX: number; fromY: number }> = [];

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      switch (cmd.type) {
        case PathCmd.Move:
          lastX = cmd.x;
          lastY = cmd.y;
          startX = cmd.x;
          startY = cmd.y;
          break;
        case PathCmd.Line:
          segments.push({ cmdIndex: i, fromX: lastX, fromY: lastY });
          lastX = cmd.x;
          lastY = cmd.y;
          break;
        case PathCmd.Cubic:
          segments.push({ cmdIndex: i, fromX: lastX, fromY: lastY });
          lastX = cmd.x;
          lastY = cmd.y;
          break;
        case PathCmd.Quad:
          segments.push({ cmdIndex: i, fromX: lastX, fromY: lastY });
          lastX = cmd.x;
          lastY = cmd.y;
          break;
        case PathCmd.Arc:
          segments.push({ cmdIndex: i, fromX: lastX, fromY: lastY });
          lastX = cmd.x;
          lastY = cmd.y;
          break;
        case PathCmd.Close:
          lastX = startX;
          lastY = startY;
          break;
      }
    }

    // Out-of-range index — return unchanged
    if (segmentIndex < 0 || segmentIndex >= segments.length) {
      return { path: { type: 'path', value: { ...path } } };
    }

    const { cmdIndex, fromX, fromY } = segments[segmentIndex];
    const target = cmds[cmdIndex];
    let replacement: PathCommand[];

    if (target.type === PathCmd.Line) {
      const midX = lerp(fromX, target.x, t);
      const midY = lerp(fromY, target.y, t);
      replacement = [
        { type: PathCmd.Line, x: midX, y: midY },
        { type: PathCmd.Line, x: target.x, y: target.y },
      ];
    } else if (target.type === PathCmd.Cubic) {
      replacement = subdivideCubic(fromX, fromY, target.cx1, target.cy1, target.cx2, target.cy2, target.x, target.y, t);
    } else if (target.type === PathCmd.Quad) {
      replacement = subdivideQuad(fromX, fromY, target.cx, target.cy, target.x, target.y, t);
    } else {
      // Arc — pass through unchanged (arc subdivision would require reparameterization)
      return { path: { type: 'path', value: { ...path } } };
    }

    const newCmds = [...cmds.slice(0, cmdIndex), ...replacement, ...cmds.slice(cmdIndex + 1)];

    return {
      path: {
        type: 'path',
        value: { commands: encodeCommands(newCmds), closed: path.closed },
      },
    };
  },
};
