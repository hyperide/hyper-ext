/**
 * @file Envelope distort — deform path using a mesh grid
 *
 * Accessed via: Envelope distort effect in Properties panel (v1.x)
 * Tradeoffs: uses bilinear interpolation within mesh cells (not bicubic —
 *   handles are ignored in v1, same as tessellate.ts)
 * Architecture: https://hyperide.github.io/reports/HYP-308
 */

import { fitCurve } from '../../curve/fit';
import { flattenPath } from '../../path/flatten';
import type { MeshValue, NodeTypeDefinition, NodeValue, PathValue, Point } from '../../types';

/**
 * Bilinear interpolate a point within a mesh cell.
 *
 * s, t are local coordinates in [0..1] within the cell.
 * TL/TR/BL/BR are the four corner vertex positions.
 */
function bilinear(tl: Point, tr: Point, bl: Point, br: Point, s: number, t: number): Point {
  return {
    x: (1 - s) * (1 - t) * tl.x + s * (1 - t) * tr.x + (1 - s) * t * bl.x + s * t * br.x,
    y: (1 - s) * (1 - t) * tl.y + s * (1 - t) * tr.y + (1 - s) * t * bl.y + s * t * br.y,
  };
}

/**
 * Deform a single point using the mesh.
 *
 * Maps the point to UV coords relative to the mesh bounding box, finds the
 * containing cell, and bilinearly interpolates from the four corner vertices.
 */
function deformPoint(
  p: Point,
  mesh: MeshValue,
  bbMinX: number,
  bbMinY: number,
  bbWidth: number,
  bbHeight: number,
): Point {
  const { rows, cols, vertices } = mesh;

  // Normalize to [0..1] relative to bounding box
  const u = bbWidth > 1e-10 ? (p.x - bbMinX) / bbWidth : 0;
  const v = bbHeight > 1e-10 ? (p.y - bbMinY) / bbHeight : 0;

  // Find cell indices, clamped to valid range
  const col = Math.min(Math.floor(u * cols), cols - 1);
  const row = Math.min(Math.floor(v * rows), rows - 1);

  // Local coordinates within cell
  const s = u * cols - col;
  const t = v * rows - row;

  // Four corners of cell in row-major vertex array
  const tl = vertices[row * (cols + 1) + col].position;
  const tr = vertices[row * (cols + 1) + col + 1].position;
  const bl = vertices[(row + 1) * (cols + 1) + col].position;
  const br = vertices[(row + 1) * (cols + 1) + col + 1].position;

  return bilinear(tl, tr, bl, br, s, t);
}

const EMPTY_PATH = { type: 'path' as const, value: { commands: new Float64Array(0), closed: false } };

export const envelopeDistortNode: NodeTypeDefinition = {
  type: 'envelopeDistort',
  label: 'Envelope Distort',
  category: 'pathOp',
  inputs: [
    { name: 'path', type: 'path' },
    { name: 'mesh', type: 'mesh' },
  ],
  outputs: [{ name: 'path', type: 'path' }],
  params: [],
  execute(inputs, _params) {
    const pathInput = inputs.path as NodeValue | undefined;
    const meshInput = inputs.mesh as NodeValue | undefined;

    if (!pathInput || !meshInput) {
      return { path: EMPTY_PATH };
    }

    const path = pathInput.value as PathValue;
    const mesh = meshInput.value as MeshValue;

    const source = flattenPath(path.commands, 0.5);
    if (source.length < 2) {
      return { path: { type: 'path', value: { ...path } } };
    }

    // Compute bounding box of all mesh vertex positions
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const vertex of mesh.vertices) {
      const { x, y } = vertex.position;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const bbWidth = maxX - minX;
    const bbHeight = maxY - minY;

    const deformed: Point[] = source.map((p) => deformPoint(p, mesh, minX, minY, bbWidth, bbHeight));

    return {
      path: {
        type: 'path',
        value: fitCurve(deformed, 2.0),
      },
    };
  },
};
