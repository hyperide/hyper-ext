/**
 * @file Bounding box computation for path commands
 *
 * Accessed via: Selection handles and Properties panel — bounding box shown when shape is selected
 *
 * Tradeoffs: uses control-point bounding box for curves (not tight bounds).
 * Tight cubic bounds require solving derivative roots — deferred to v1.x.
 */

import type { BoundingBox } from '../types';
import { decodeCommands, PathCmd } from './commands';

export function computeBounds(commands: Float64Array): BoundingBox {
  if (commands.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  const decoded = decodeCommands(commands);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  function track(x: number, y: number): void {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
      case PathCmd.Line:
        track(cmd.x, cmd.y);
        break;
      case PathCmd.Cubic:
        track(cmd.cx1, cmd.cy1);
        track(cmd.cx2, cmd.cy2);
        track(cmd.x, cmd.y);
        break;
      case PathCmd.Quad:
        track(cmd.cx, cmd.cy);
        track(cmd.x, cmd.y);
        break;
      case PathCmd.Arc:
        // Approximation: endpoint ± radii. Not tight — can be both too large
        // and too small depending on arc geometry. Sufficient for v0.
        track(cmd.x - cmd.rx, cmd.y - cmd.ry);
        track(cmd.x + cmd.rx, cmd.y + cmd.ry);
        track(cmd.x, cmd.y);
        break;
      case PathCmd.Close:
        break;
    }
  }

  if (minX === Infinity) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
