/**
 * @file Basic path operations — pure TypeScript, no WASM needed
 *
 * Accessed via: Path menu > Reverse / Close / Join / Break Apart
 *
 * These operations work directly on Float64Array path commands.
 * No external library needed — all are simple array manipulations.
 *
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Basic Path Operations
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

// -- Reverse Path --

/**
 * Returns the endpoint (x, y) of a path command.
 * Close commands have no endpoint — return the provided fallback.
 */
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

/**
 * Reverses a single drawing command so it travels from its original
 * endpoint back to `fromPoint` (the start of the segment in the original order).
 */
function reverseCmd(cmd: PathCommand, fromPoint: { x: number; y: number }): PathCommand {
  switch (cmd.type) {
    case PathCmd.Line:
      return { type: PathCmd.Line, x: fromPoint.x, y: fromPoint.y };
    case PathCmd.Cubic:
      // Swap cp1 ↔ cp2, endpoint becomes the segment's original start
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
      // Control point stays at absolute position; endpoint reverses to fromPoint
      return { type: PathCmd.Quad, cx: cmd.cx, cy: cmd.cy, x: fromPoint.x, y: fromPoint.y };
    case PathCmd.Arc:
      // Flip sweep flag to travel the arc in the opposite direction
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
      // Move/Close should never reach here in a drawing segment context
      return cmd;
  }
}

export const reversePathNode: NodeTypeDefinition = {
  type: 'reverse-path',
  label: 'Reverse Path',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [],
  execute(inputs) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const cmds = decodeCommands(path.commands);

    // Separate Close from drawing commands
    const hasClosed = cmds.length > 0 && cmds[cmds.length - 1].type === PathCmd.Close;
    const drawing = hasClosed ? cmds.slice(0, -1) : cmds;

    if (drawing.length === 0) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // Build (startPoint, command) pairs so we can reverse the traversal direction.
    // segments[i].start is the position BEFORE command drawing[i] is executed.
    const segments: Array<{ start: { x: number; y: number }; cmd: PathCommand }> = [];
    let cur = { x: 0, y: 0 };
    for (const cmd of drawing) {
      segments.push({ start: { ...cur }, cmd });
      cur = cmdEndpoint(cmd, cur);
    }
    // `cur` now holds the final endpoint of the original path (last point before Close)

    // The reversed path starts at the original final endpoint
    const reversed: PathCommand[] = [{ type: PathCmd.Move, x: cur.x, y: cur.y }];

    // Walk segments in reverse: each segment becomes a command ending at its original start
    for (let i = segments.length - 1; i >= 1; i--) {
      const seg = segments[i];
      if (seg.cmd.type === PathCmd.Move) {
        // A mid-path Move starts a new sub-path; preserve as Move in reversed order
        reversed.push({ type: PathCmd.Move, x: seg.start.x, y: seg.start.y });
      } else {
        reversed.push(reverseCmd(seg.cmd, seg.start));
      }
    }

    if (hasClosed) {
      reversed.push({ type: PathCmd.Close });
    }

    const result: PathValue = {
      commands: encodeCommands(reversed),
      closed: path.closed,
    };
    return { path: { type: 'path', value: result } };
  },
};

// -- Close/Open Path --

export const closeOpenNode: NodeTypeDefinition = {
  type: 'close-open-path',
  label: 'Close / Open Path',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [
    {
      name: 'action',
      type: 'enum',
      default: 'close',
      options: [
        { value: 'close', label: 'Close' },
        { value: 'open', label: 'Open' },
      ],
    },
  ],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const action = params.action as 'close' | 'open';
    const cmds = decodeCommands(path.commands);
    const lastIsClose = cmds.length > 0 && cmds[cmds.length - 1].type === PathCmd.Close;

    if (action === 'close') {
      const updated = lastIsClose ? cmds : [...cmds, { type: PathCmd.Close } as PathCommand];
      return { path: { type: 'path', value: { commands: encodeCommands(updated), closed: true } } };
    }

    // action === 'open'
    const updated = lastIsClose ? cmds.slice(0, -1) : cmds;
    return { path: { type: 'path', value: { commands: encodeCommands(updated), closed: false } } };
  },
};

// -- Join Paths --

export const joinPathsNode: NodeTypeDefinition = {
  type: 'join-paths',
  label: 'Join Paths',
  category: 'pathOp',
  inputs: [
    { name: 'a', type: 'path' },
    { name: 'b', type: 'path' },
  ],
  outputs: [{ name: 'path', type: 'path' }],
  params: [],
  execute(inputs) {
    const aInput = inputs.a as NodeValue | undefined;
    const bInput = inputs.b as NodeValue | undefined;
    if (!aInput || !bInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const a = aInput.value as PathValue;
    const b = bInput.value as PathValue;

    const aCmds = decodeCommands(a.commands);
    const bCmds = decodeCommands(b.commands);

    // Drop the Move from the second path so it continues from where the first ends.
    // Note: if path `a` ends with a Close command, the join creates
    // a new sub-path starting from b's first point rather than a
    // continuous line from a's last drawn point.
    const bBody = bCmds[0]?.type === PathCmd.Move ? bCmds.slice(1) : bCmds;
    const joined = [...aCmds, ...bBody];

    const result: PathValue = {
      commands: encodeCommands(joined),
      closed: false,
    };
    return { path: { type: 'path', value: result } };
  },
};

// -- Break Apart Paths (utility function) --

/**
 * Splits a compound path (multiple Move commands) into individual sub-paths.
 * Each sub-path inherits `closed` from the parent if its last command is Close.
 */
export function breakApartPaths(path: PathValue): PathValue[] {
  const cmds = decodeCommands(path.commands);
  const subPaths: PathValue[] = [];
  let current: PathCommand[] = [];

  for (const cmd of cmds) {
    if (cmd.type === PathCmd.Move && current.length > 0) {
      // Flush the current sub-path before starting a new one
      const lastIsClosed = current[current.length - 1].type === PathCmd.Close;
      subPaths.push({ commands: encodeCommands(current), closed: lastIsClosed });
      current = [];
    }
    current.push(cmd);
  }

  if (current.length > 0) {
    const lastIsClosed = current[current.length - 1].type === PathCmd.Close;
    subPaths.push({ commands: encodeCommands(current), closed: lastIsClosed });
  }

  return subPaths;
}
