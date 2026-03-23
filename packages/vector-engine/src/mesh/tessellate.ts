/**
 * @file Tessellate gradient mesh into triangles for GPU rendering
 *
 * Accessed via: CanvasKit drawVertices() — triangulated mesh data for GPU
 * Tradeoffs: bilinear subdivision (not bezier), handles are ignored in v1
 */

import type { MeshValue } from '../types';
import type { TessellatedMesh } from './types';

/** Parse a CSS hex color to [r, g, b] in 0–255 range. Falls back to white on error. */
function parseHex(color: string): [number, number, number] {
  const hex = color.replace('#', '');
  if (hex.length === 3) {
    return [
      Number.parseInt(hex[0] + hex[0], 16),
      Number.parseInt(hex[1] + hex[1], 16),
      Number.parseInt(hex[2] + hex[2], 16),
    ];
  }
  if (hex.length === 6) {
    return [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ];
  }
  return [255, 255, 255];
}

/** Encode [r, g, b] back to a hex color string. */
function toHex(r: number, g: number, b: number): string {
  const ch = (v: number) =>
    Math.round(Math.max(0, Math.min(255, v)))
      .toString(16)
      .padStart(2, '0');
  return `#${ch(r)}${ch(g)}${ch(b)}`;
}

/**
 * Bilinearly interpolate position and color inside a mesh cell.
 *
 * @param u - horizontal parameter [0, 1] within the cell
 * @param v - vertical parameter [0, 1] within the cell
 * @param tlPos - top-left vertex position
 * @param trPos - top-right vertex position
 * @param blPos - bottom-left vertex position
 * @param brPos - bottom-right vertex position
 * @param tlColor - top-left vertex color
 * @param trColor - top-right vertex color
 * @param blColor - bottom-left vertex color
 * @param brColor - bottom-right vertex color
 */
function bilerp(
  u: number,
  v: number,
  tlPos: { x: number; y: number },
  trPos: { x: number; y: number },
  blPos: { x: number; y: number },
  brPos: { x: number; y: number },
  tlColor: string,
  trColor: string,
  blColor: string,
  brColor: string,
): { x: number; y: number; color: string } {
  const x = (1 - u) * (1 - v) * tlPos.x + u * (1 - v) * trPos.x + (1 - u) * v * blPos.x + u * v * brPos.x;
  const y = (1 - u) * (1 - v) * tlPos.y + u * (1 - v) * trPos.y + (1 - u) * v * blPos.y + u * v * brPos.y;

  const [tlR, tlG, tlB] = parseHex(tlColor);
  const [trR, trG, trB] = parseHex(trColor);
  const [blR, blG, blB] = parseHex(blColor);
  const [brR, brG, brB] = parseHex(brColor);

  const r = (1 - u) * (1 - v) * tlR + u * (1 - v) * trR + (1 - u) * v * blR + u * v * brR;
  const g = (1 - u) * (1 - v) * tlG + u * (1 - v) * trG + (1 - u) * v * blG + u * v * brG;
  const b = (1 - u) * (1 - v) * tlB + u * (1 - v) * trB + (1 - u) * v * blB + u * v * brB;

  return { x, y, color: toHex(r, g, b) };
}

/**
 * Tessellate a gradient mesh into a triangle mesh for GPU rendering.
 *
 * Each mesh cell is subdivided into `subdivisions × subdivisions` sub-quads.
 * Each sub-quad becomes 2 triangles. Positions and colors are bilinearly
 * interpolated from the cell's four corner vertices.
 *
 * @param mesh - the gradient mesh to tessellate
 * @param subdivisions - number of sub-divisions per cell side (min 1)
 */
export function tessellateMesh(mesh: MeshValue, subdivisions: number): TessellatedMesh {
  const positions: number[] = [];
  const colors: string[] = [];
  const indices: number[] = [];

  const steps = Math.max(1, subdivisions);

  for (let row = 0; row < mesh.rows; row++) {
    for (let col = 0; col < mesh.cols; col++) {
      // Corner vertex indices in mesh.vertices (row-major)
      const cols1 = mesh.cols + 1;
      const tl = mesh.vertices[row * cols1 + col];
      const tr = mesh.vertices[row * cols1 + col + 1];
      const bl = mesh.vertices[(row + 1) * cols1 + col];
      const br = mesh.vertices[(row + 1) * cols1 + col + 1];

      // Build a local grid of (steps+1) × (steps+1) interpolated points
      const cellPoints: { x: number; y: number; color: string }[][] = [];
      for (let si = 0; si <= steps; si++) {
        cellPoints[si] = [];
        for (let sj = 0; sj <= steps; sj++) {
          const u = sj / steps;
          const v = si / steps;
          cellPoints[si][sj] = bilerp(
            u,
            v,
            tl.position,
            tr.position,
            bl.position,
            br.position,
            tl.color,
            tr.color,
            bl.color,
            br.color,
          );
        }
      }

      // Emit triangles for each sub-quad
      const baseIndex = positions.length / 2;
      for (let si = 0; si <= steps; si++) {
        for (let sj = 0; sj <= steps; sj++) {
          const pt = cellPoints[si][sj];
          positions.push(pt.x, pt.y);
          colors.push(pt.color);
        }
      }

      const stride = steps + 1;
      for (let si = 0; si < steps; si++) {
        for (let sj = 0; sj < steps; sj++) {
          const iTL = baseIndex + si * stride + sj;
          const iTR = baseIndex + si * stride + sj + 1;
          const iBL = baseIndex + (si + 1) * stride + sj;
          const iBR = baseIndex + (si + 1) * stride + sj + 1;
          // Two triangles per sub-quad
          indices.push(iTL, iTR, iBL);
          indices.push(iTR, iBR, iBL);
        }
      }
    }
  }

  return { positions, colors, indices };
}
