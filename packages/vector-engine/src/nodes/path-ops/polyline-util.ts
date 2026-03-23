/**
 * @file Shared polyline vertex extraction — parses closed polyline paths for corner operations
 *
 * Internal module, not exposed
 */

import { PathCmd, type PathCommand } from '../../path/commands';

/**
 * Extracts vertices from a closed polyline path (Move + Line* + Close).
 * Returns null if the path contains curves or is not closed.
 */
export function extractPolylineVertices(cmds: PathCommand[]): Array<{ x: number; y: number }> | null {
  if (cmds.length < 2) return null;

  const last = cmds[cmds.length - 1];
  if (last.type !== PathCmd.Close) return null;

  const drawing = cmds.slice(0, -1);
  const vertices: Array<{ x: number; y: number }> = [];

  for (const cmd of drawing) {
    if (cmd.type === PathCmd.Move || cmd.type === PathCmd.Line) {
      vertices.push({ x: cmd.x, y: cmd.y });
    } else {
      // Contains curves — pass through
      return null;
    }
  }

  if (vertices.length < 3) return null;
  return vertices;
}
