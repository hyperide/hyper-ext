/**
 * @file Offset node — expands or contracts a path by a fixed distance
 *
 * Accessed via: Vector engine graph — add "Path Offset" node to expand/contract shapes
 * Assumptions: PathOpsBackend is injected at registry creation and is stateless
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §WASM-Backed Path Op Nodes
 */

import type { PathOpsBackend } from 'vector-wasm';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export function createOffsetNode(backend: PathOpsBackend): NodeTypeDefinition {
  return {
    type: 'offset',
    label: 'Path Offset',
    category: 'pathOp',
    inputs: [{ name: 'path', type: 'path' }],
    outputs: [{ name: 'path', type: 'path' }],
    params: [{ name: 'distance', type: 'number', default: 10, step: 1 }],
    execute(
      inputs: Record<string, NodeValue | NodeValue[]>,
      params: Record<string, unknown>,
    ): Record<string, NodeValue> {
      const pathVal = inputs.path as NodeValue | undefined;
      if (!pathVal) {
        return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
      }
      const result = backend.offset(pathVal.value as PathValue, params.distance as number);
      return { path: { type: 'path', value: result } };
    },
  };
}
