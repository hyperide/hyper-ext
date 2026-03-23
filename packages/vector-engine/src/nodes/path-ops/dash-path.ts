/**
 * @file Dash node — applies a dash pattern to a path
 *
 * Accessed via: Vector engine graph — add "Dash Path" node to apply stroke dash pattern as geometry
 * Assumptions: PathOpsBackend is injected at registry creation and is stateless.
 *   dashArray is passed as a JSON string param and parsed at execute time.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §WASM-Backed Path Op Nodes
 */

import type { PathOpsBackend } from 'vector-wasm';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export function createDashNode(backend: PathOpsBackend): NodeTypeDefinition {
  return {
    type: 'dashPath',
    label: 'Dash Path',
    category: 'pathOp',
    inputs: [{ name: 'path', type: 'path' }],
    outputs: [{ name: 'path', type: 'path' }],
    params: [
      { name: 'dashArray', type: 'json', default: '[10, 5]' },
      { name: 'dashOffset', type: 'number', default: 0, step: 1 },
    ],
    execute(
      inputs: Record<string, NodeValue | NodeValue[]>,
      params: Record<string, unknown>,
    ): Record<string, NodeValue> {
      const pathVal = inputs.path as NodeValue | undefined;
      if (!pathVal) {
        return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
      }
      let dashArray: number[];
      try {
        dashArray = JSON.parse(params.dashArray as string) as number[];
      } catch {
        // Invalid JSON — return input path unchanged
        return { path: pathVal };
      }
      const result = backend.dash(pathVal.value as PathValue, dashArray, params.dashOffset as number);
      return { path: { type: 'path', value: result } };
    },
  };
}
