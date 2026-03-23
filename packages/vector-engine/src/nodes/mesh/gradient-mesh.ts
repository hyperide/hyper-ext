/**
 * @file Gradient mesh generator node — creates a mesh grid
 *
 * Accessed via: MCP tool vector_create_mesh, mesh tool (v1.x)
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Gradient Mesh
 */

import { meshFromBounds } from '../../mesh/mesh-from-path';
import type { NodeTypeDefinition } from '../../types';

export const gradientMeshNode: NodeTypeDefinition = {
  type: 'gradientMesh',
  label: 'Gradient Mesh',
  category: 'generator',
  inputs: [],
  outputs: [{ name: 'mesh', type: 'mesh' }],
  params: [
    { name: 'rows', type: 'number', default: 2, min: 1, max: 20 },
    { name: 'cols', type: 'number', default: 2, min: 1, max: 20 },
    { name: 'width', type: 'number', default: 100, min: 1 },
    { name: 'height', type: 'number', default: 100, min: 1 },
    { name: 'x', type: 'number', default: 0 },
    { name: 'y', type: 'number', default: 0 },
    { name: 'color', type: 'color', default: '#ffffff' },
  ],
  execute(_inputs, params) {
    const mesh = meshFromBounds(
      {
        x: params.x as number,
        y: params.y as number,
        width: params.width as number,
        height: params.height as number,
      },
      params.rows as number,
      params.cols as number,
    );
    const color = params.color as string;
    for (const v of mesh.vertices) v.color = color;
    return { mesh: { type: 'mesh', value: mesh } };
  },
};
