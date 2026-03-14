/**
 * @file Transform matrix composition utility
 *
 * Accessed via: Internal module, not exposed
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Transform Nodes
 */

import type { NodeValue, TransformMatrix } from '../../types';

/**
 * Multiply two 2D affine matrices: result = A * B
 * Matrix layout: [a, b, c, d, e, f] represents:
 *   | a c e |
 *   | b d f |
 *   | 0 0 1 |
 */
function multiplyMatrices(a: TransformMatrix, b: TransformMatrix): TransformMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

/**
 * Compose an incoming transform (from upstream node) with a local matrix.
 * Returns `local * incoming` if incoming is present, otherwise just `local`.
 */
export function composeTransforms(incoming: NodeValue | undefined, local: TransformMatrix): TransformMatrix {
  if (!incoming || incoming.type !== 'transform') return local;
  return multiplyMatrices(local, incoming.value as TransformMatrix);
}
