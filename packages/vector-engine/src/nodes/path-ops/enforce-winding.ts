/**
 * @file Enforce winding direction — reverses path when winding doesn't match requested direction
 *
 * Accessed via: Path menu > Enforce Winding
 *
 * Assumptions: uses shoelace signed area on flattened polyline — accurate for all
 *   command types including cubic/quad beziers and arcs.
 *   CW winding produces positive area in screen coordinates (Y-down).
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Advanced Path Operations
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import { pathArea } from '../../path/geometry';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

// -- Reverse helpers (same logic as reversePathNode in basic-ops.ts) --

function cmdEndpoint(cmd: PathCommand, fallback: { x: number; y: number }): { x: number; y: number } {
  switch (cmd.type) {
    case PathCmd.Move:
    case PathCmd.Line:
    case PathCmd.Cubic:
    case PathCmd.Quad:
    case PathCmd.Arc:
      return { x: cmd.x, y: cmd.y };
    case PathCmd.Close:
      return fallback;
  }
}

function reverseCmd(cmd: PathCommand, fromPoint: { x: number; y: number }): PathCommand {
  switch (cmd.type) {
    case PathCmd.Line:
      return { type: PathCmd.Line, x: fromPoint.x, y: fromPoint.y };
    case PathCmd.Cubic:
      return {
        type: PathCmd.Cubic,
        cx1: cmd.cx2,
        cy1: cmd.cy2,
        cx2: cmd.cx1,
        cy2: cmd.cy1,
        x: fromPoint.x,
        y: fromPoint.y,
      };
    case PathCmd.Quad:
      return { type: PathCmd.Quad, cx: cmd.cx, cy: cmd.cy, x: fromPoint.x, y: fromPoint.y };
    case PathCmd.Arc:
      return {
        type: PathCmd.Arc,
        rx: cmd.rx,
        ry: cmd.ry,
        rotation: cmd.rotation,
        largeArc: cmd.largeArc,
        sweep: cmd.sweep === 0 ? 1 : 0,
        x: fromPoint.x,
        y: fromPoint.y,
      };
    default:
      return cmd;
  }
}

function reversePath(path: PathValue): PathValue {
  const cmds = decodeCommands(path.commands);
  const hasClosed = cmds.length > 0 && cmds[cmds.length - 1].type === PathCmd.Close;
  const drawing = hasClosed ? cmds.slice(0, -1) : cmds;

  if (drawing.length === 0) {
    return { ...path };
  }

  const segments: Array<{ start: { x: number; y: number }; cmd: PathCommand }> = [];
  let cur = { x: 0, y: 0 };
  for (const cmd of drawing) {
    segments.push({ start: { ...cur }, cmd });
    cur = cmdEndpoint(cmd, cur);
  }

  const reversed: PathCommand[] = [{ type: PathCmd.Move, x: cur.x, y: cur.y }];
  for (let i = segments.length - 1; i >= 1; i--) {
    const seg = segments[i];
    if (seg.cmd.type === PathCmd.Move) {
      reversed.push({ type: PathCmd.Move, x: seg.start.x, y: seg.start.y });
    } else {
      reversed.push(reverseCmd(seg.cmd, seg.start));
    }
  }

  if (hasClosed) {
    reversed.push({ type: PathCmd.Close });
  }

  return { commands: encodeCommands(reversed), closed: path.closed };
}

// -- Node definition --

export const enforceWindingNode: NodeTypeDefinition = {
  type: 'enforceWinding',
  label: 'Enforce Winding',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    {
      name: 'direction',
      type: 'enum',
      default: 'cw',
      options: [
        { value: 'cw', label: 'Clockwise' },
        { value: 'ccw', label: 'Counter-Clockwise' },
      ],
    },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const area = pathArea(path.commands);
    const wantCw = params.direction === 'cw';
    // CW = positive area (screen Y-down shoelace convention)
    const isCw = area > 0;

    if (area === 0 || wantCw === isCw) {
      return { path: inputs.path };
    }

    const reversed = reversePath(path);
    return { path: { type: 'path', value: reversed } };
  },
};
