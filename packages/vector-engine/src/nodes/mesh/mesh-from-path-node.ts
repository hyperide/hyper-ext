/**
 * @file Mesh from Path node — fits gradient mesh grid to path bounding box
 *
 * Accessed via: MCP tool vector_create_mesh with path reference
 */

import { meshFromBounds } from '../../mesh/mesh-from-path';
import { computeBounds } from '../../path/bounds';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export const meshFromPathNode: NodeTypeDefinition = {
  type: 'meshFromPath',
  label: 'Mesh from Path',
  category: 'generator',
  inputs: [{ name: 'path', type: 'path' }],
  outputs: [{ name: 'mesh', type: 'mesh' }],
  params: [
    { name: 'rows', type: 'number', default: 2, min: 1, max: 20 },
    { name: 'cols', type: 'number', default: 2, min: 1, max: 20 },
  ],
  execute(inputs, params) {
    const pathVal = inputs.path as NodeValue | undefined;
    const path = pathVal?.value as PathValue | undefined;
    const bounds = path ? computeBounds(path.commands) : { x: 0, y: 0, width: 100, height: 100 };
    const mesh = meshFromBounds(bounds, params.rows as number, params.cols as number);
    return { mesh: { type: 'mesh', value: mesh } };
  },
};
