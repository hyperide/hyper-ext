/**
 * @file Gradient mesh types — re-exported from main types.ts for convenience
 *
 * Accessed via: Gradient mesh tool (v1.x), MCP tools (v1)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Gradient Mesh
 */

export type { MeshHandle, MeshVertex } from '../types';

export interface TessellatedMesh {
  /** Flat position array: [x1, y1, x2, y2, ...] */
  positions: number[];
  /** Per-vertex color, one entry per position pair */
  colors: string[];
  /** Triangle indices into positions/colors arrays */
  indices: number[];
}
