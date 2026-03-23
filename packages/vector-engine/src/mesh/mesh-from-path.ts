/**
 * @file Create regular grid mesh fitted to bounding box
 *
 * Accessed via: MCP tool vector_create_mesh — creates initial mesh grid
 */

import type { BoundingBox, MeshValue, MeshVertex } from '../types';

/**
 * Create a regular grid gradient mesh fitted to the given bounding box.
 * Vertices are placed in row-major order: row 0 is the top edge.
 * All vertices default to white (#ffffff) with full opacity.
 *
 * @param rows - number of cell rows (clamped to minimum 1)
 * @param cols - number of cell columns (clamped to minimum 1)
 */
export function meshFromBounds(bounds: BoundingBox, rows: number, cols: number): MeshValue {
  const safeRows = Math.max(1, rows);
  const safeCols = Math.max(1, cols);
  const vertices: MeshVertex[] = [];
  for (let r = 0; r <= safeRows; r++) {
    for (let c = 0; c <= safeCols; c++) {
      vertices.push({
        position: {
          x: bounds.x + (c / safeCols) * bounds.width,
          y: bounds.y + (r / safeRows) * bounds.height,
        },
        color: '#ffffff',
        opacity: 1,
      });
    }
  }
  return { rows: safeRows, cols: safeCols, vertices, handles: [] };
}
