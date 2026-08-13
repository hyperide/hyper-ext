/**
 * @file Apply a 2D affine transform matrix to a path's geometry.
 *
 * Accessed via: boolean / clip nodes — bake an operand's accumulated scene
 *   transform into its path commands before a PathOps op runs (HYP-519).
 * Assumptions: matrix is [a, b, c, d, e, f] (same layout as TransformMatrix /
 *   SVG `matrix(...)`). Move/Line/Cubic/Quad map exactly under an affine: every
 *   anchor AND control point is transformed. Close carries no geometry. Arc is
 *   the one command an affine cannot map by transforming its parameters (rx/ry/
 *   rotation would need conic decomposition), so a transformed arc is first
 *   flattened to a polyline (correct under any affine; lossless once it reaches
 *   CanvasKit, which re-tessellates) and emitted as line segments.
 */

import type { TransformMatrix } from '../types';
import { decodeCommands, encodeCommands, type PathCommand, PathCmd } from './commands';
import { flattenPath } from './flatten';

/** Tolerance (px) for flattening a transformed arc into line segments. */
const ARC_FLATTEN_TOLERANCE = 0.1;

function isIdentity(m: TransformMatrix): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** Apply matrix [a,b,c,d,e,f] to point (x, y): (a*x + c*y + e, b*x + d*y + f). */
function mapX(m: TransformMatrix, x: number, y: number): number {
  return m[0] * x + m[2] * y + m[4];
}
function mapY(m: TransformMatrix, x: number, y: number): number {
  return m[1] * x + m[3] * y + m[5];
}

/**
 * Bake a 2D affine transform into a path's commands, returning a new PathValue's
 * command buffer. Identity transform returns the input buffer unchanged. Any
 * cached bounds on the caller's PathValue must be dropped — geometry has moved.
 */
export function transformPathCommands(commands: Float64Array, m: TransformMatrix): Float64Array {
  if (isIdentity(m)) return commands;

  // Arcs are flattened in UNTRANSFORMED space (an affine can't be applied to SVG arc
  // params directly), then each point is mapped by m. A fixed tolerance would therefore be
  // multiplied by the transform's scale — arc(...).scale(1000) would feed PathOps a polyline
  // ~100px off the true curve. Divide the tolerance by the matrix's max linear scale so the
  // post-transform deviation stays near ARC_FLATTEN_TOLERANCE. (Cols of m are the basis
  // vectors: x-axis = (m[0],m[1]), y-axis = (m[2],m[3]).)
  const transformScale = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]), 1e-6);
  const arcFlattenTolerance = ARC_FLATTEN_TOLERANCE / transformScale;

  const decoded = decodeCommands(commands);
  const out: PathCommand[] = [];
  let lastX = 0;
  let lastY = 0;
  // Subpath start, for SVG current-point semantics: Close resets to it.
  let startX = 0;
  let startY = 0;

  for (const cmd of decoded) {
    switch (cmd.type) {
      case PathCmd.Move:
        out.push({ type: cmd.type, x: mapX(m, cmd.x, cmd.y), y: mapY(m, cmd.x, cmd.y) });
        lastX = cmd.x;
        lastY = cmd.y;
        startX = cmd.x;
        startY = cmd.y;
        break;
      case PathCmd.Line:
        out.push({ type: cmd.type, x: mapX(m, cmd.x, cmd.y), y: mapY(m, cmd.x, cmd.y) });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Cubic:
        out.push({
          type: PathCmd.Cubic,
          cx1: mapX(m, cmd.cx1, cmd.cy1),
          cy1: mapY(m, cmd.cx1, cmd.cy1),
          cx2: mapX(m, cmd.cx2, cmd.cy2),
          cy2: mapY(m, cmd.cx2, cmd.cy2),
          x: mapX(m, cmd.x, cmd.y),
          y: mapY(m, cmd.x, cmd.y),
        });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Quad:
        out.push({
          type: PathCmd.Quad,
          cx: mapX(m, cmd.cx, cmd.cy),
          cy: mapY(m, cmd.cx, cmd.cy),
          x: mapX(m, cmd.x, cmd.y),
          y: mapY(m, cmd.x, cmd.y),
        });
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      case PathCmd.Arc: {
        // An affine cannot be applied to SVG arc parameters directly. Flatten the
        // single arc (Move(lastX,lastY) → Arc) to a polyline in untransformed space,
        // then map each point. flattenPath emits the start point first; skip it.
        const arcBuffer = encodeCommands([
          { type: PathCmd.Move, x: lastX, y: lastY },
          {
            type: PathCmd.Arc,
            rx: cmd.rx,
            ry: cmd.ry,
            rotation: cmd.rotation,
            largeArc: cmd.largeArc,
            sweep: cmd.sweep,
            x: cmd.x,
            y: cmd.y,
          },
        ]);
        const pts = flattenPath(arcBuffer, arcFlattenTolerance);
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i];
          out.push({ type: PathCmd.Line, x: mapX(m, p.x, p.y), y: mapY(m, p.x, p.y) });
        }
        lastX = cmd.x;
        lastY = cmd.y;
        break;
      }
      case PathCmd.Close:
        out.push({ type: PathCmd.Close });
        // SVG: Close returns the current point to the subpath start.
        lastX = startX;
        lastY = startY;
        break;
    }
  }

  return encodeCommands(out);
}
