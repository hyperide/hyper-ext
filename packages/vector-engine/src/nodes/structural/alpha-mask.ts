/**
 * @file Alpha mask node — routes a content path and a mask path to separate outputs
 *
 * Accessed via: Node graph > Structural > Alpha Mask — applies a path mask to clip content
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Structural Nodes
 */

import type { NodeTypeDefinition } from '../../types';

export const alphaMaskNode: NodeTypeDefinition = {
  type: 'alphaMask',
  label: 'Alpha Mask',
  category: 'utility',
  inputs: [
    { name: 'content', type: 'path' },
    { name: 'mask', type: 'path' },
  ],
  outputs: [
    { name: 'path', type: 'path' },
    { name: 'clipPath', type: 'path' },
  ],
  params: [],
  execute(inputs) {
    return {
      path: inputs.content,
      clipPath: inputs.mask,
    };
  },
};
