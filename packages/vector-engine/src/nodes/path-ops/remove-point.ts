/**
 * @file Remove Point path operation — removes a vertex by index and reconnects with a line
 *
 * Accessed via: Path menu > Remove Anchor Point (while anchor is selected)
 *
 * Assumptions: pointIndex addresses the vertex list (Move = index 0, then each
 *   drawable segment endpoint). Removing the first vertex (Move) shifts the path
 *   start to the next endpoint. Removing the last vertex drops the final segment.
 *   Arc segments are preserved as-is when not directly involved in the removal.
 *
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { decodeCommands, encodeCommands, PathCmd, type PathCommand } from '../../path/commands';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export const removePointNode: NodeTypeDefinition = {
  type: 'removePoint',
  label: 'Remove Point',
  category: 'pathOp',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'path', type: 'path' }],
  params: [{ name: 'pointIndex', type: 'number', default: 0, min: 0 }],
  execute(inputs, params) {
    const pathInput = inputs.path as NodeValue | undefined;
    if (!pathInput) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }
    const path = pathInput.value as PathValue;
    const pointIndex = params.pointIndex as number;

    const cmds = decodeCommands(path.commands);

    // Build vertex list: each entry records the command index that places the vertex,
    // plus its coordinates. The Move command places vertex 0.
    // Each drawable segment places the next vertex at its endpoint.
    // Close and Arc are structural/pass-through — they don't define addressable vertices here.
    interface VertexRecord {
      /** Index of command that "places" this vertex (Move or drawable segment). */
      cmdIndex: number;
      x: number;
      y: number;
    }

    const vertices: VertexRecord[] = [];

    for (let i = 0; i < cmds.length; i++) {
      const cmd = cmds[i];
      switch (cmd.type) {
        case PathCmd.Move:
          vertices.push({ cmdIndex: i, x: cmd.x, y: cmd.y });
          break;
        case PathCmd.Line:
        case PathCmd.Cubic:
        case PathCmd.Quad:
        case PathCmd.Arc:
          vertices.push({ cmdIndex: i, x: cmd.x, y: cmd.y });
          break;
        case PathCmd.Close:
          // Close doesn't add a vertex — the path loops back to the subpath start
          break;
      }
    }

    // Out-of-range index — return unchanged
    if (pointIndex < 0 || pointIndex >= vertices.length) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // Single vertex path — removing it leaves an empty path
    if (vertices.length <= 1) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }

    const targetCmdIndex = vertices[pointIndex].cmdIndex;

    const newCmds: PathCommand[] = [];
    let skipNext = false;

    for (let i = 0; i < cmds.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const cmd = cmds[i];

      if (i !== targetCmdIndex) {
        newCmds.push(cmd);
        continue;
      }

      // This is the command placing the vertex to remove.
      if (cmd.type === PathCmd.Move) {
        // Removing the first vertex (Move): skip the Move and replace the next drawable
        // segment with a Move to its endpoint (the path now starts there).
        let nextDrawable = i + 1;
        while (nextDrawable < cmds.length && cmds[nextDrawable].type === PathCmd.Close) {
          nextDrawable++;
        }
        if (nextDrawable < cmds.length) {
          const next = cmds[nextDrawable];
          if (next.type !== PathCmd.Move && next.type !== PathCmd.Close) {
            newCmds.push({ type: PathCmd.Move, x: next.x, y: next.y });
            skipNext = true;
          }
          // If next is another Move or Close we just drop the original Move
        }
        // else: Move was the only command — drop it, path becomes empty (handled above)
      } else {
        // Removing a mid/end vertex: connect the previous point to the next endpoint
        // via a straight line, bypassing any curve control points.
        const nextCmdIndex = i + 1;
        if (nextCmdIndex < cmds.length) {
          const nextCmd = cmds[nextCmdIndex];
          if (
            nextCmd.type === PathCmd.Line ||
            nextCmd.type === PathCmd.Cubic ||
            nextCmd.type === PathCmd.Quad ||
            nextCmd.type === PathCmd.Arc
          ) {
            // Replace the removed vertex's command AND the following command with a
            // single Line from prev → next endpoint.
            newCmds.push({ type: PathCmd.Line, x: nextCmd.x, y: nextCmd.y });
            skipNext = true;
          }
          // If next is Close or Move, just drop the current segment (last vertex in subpath)
        }
        // If this is the last command, just omit it — no following segment to merge
      }
    }

    if (newCmds.length === 0) {
      return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
    }

    return {
      path: {
        type: 'path',
        value: { commands: encodeCommands(newCmds), closed: path.closed },
      },
    };
  },
};
