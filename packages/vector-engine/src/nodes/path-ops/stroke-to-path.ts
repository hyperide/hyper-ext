/**
 * @file Stroke-to-path node — converts a stroked path to a filled outline
 *
 * Accessed via: Vector engine graph — add "Stroke to Path" node to expand stroke into filled shape
 * Assumptions: PathOpsBackend is injected at registry creation and is stateless. Output path is always closed.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §WASM-Backed Path Op Nodes
 */

import type { PathOpsBackend } from 'vector-wasm';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

export function createStrokeToPathNode(backend: PathOpsBackend): NodeTypeDefinition {
  return {
    type: 'strokeToPath',
    label: 'Stroke to Path',
    category: 'pathOp',
    inputs: [{ name: 'path', type: 'path' }],
    outputs: [{ name: 'path', type: 'path' }],
    params: [
      { name: 'width', type: 'number', default: 1, min: 0, step: 0.5 },
      {
        name: 'cap',
        type: 'enum',
        default: 'butt',
        options: [
          { value: 'butt', label: 'Butt' },
          { value: 'round', label: 'Round' },
          { value: 'square', label: 'Square' },
        ],
      },
      {
        name: 'join',
        type: 'enum',
        default: 'miter',
        options: [
          { value: 'miter', label: 'Miter' },
          { value: 'round', label: 'Round' },
          { value: 'bevel', label: 'Bevel' },
        ],
      },
    ],
    execute(
      inputs: Record<string, NodeValue | NodeValue[]>,
      params: Record<string, unknown>,
    ): Record<string, NodeValue> {
      const pathVal = inputs.path as NodeValue | undefined;
      if (!pathVal) {
        return { path: { type: 'path', value: { commands: new Float64Array(0), closed: true } } };
      }
      const result = backend.strokeToPath(
        pathVal.value as PathValue,
        params.width as number,
        params.cap as 'butt' | 'round' | 'square',
        params.join as 'miter' | 'round' | 'bevel',
      );
      return { path: { type: 'path', value: result } };
    },
  };
}
