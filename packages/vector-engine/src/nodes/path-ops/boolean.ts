/**
 * @file Boolean operation nodes — union, subtract, intersect, xor
 *
 * Accessed via: Path menu > Boolean > Union / Subtract / Intersect / Exclude
 * Assumptions: PathOpsBackend is injected at registry creation, shared across all boolean nodes. Backend is stateless — no per-operation cleanup needed.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Boolean Operation Nodes
 */

import type { BooleanOp, PathOpsBackend } from 'vector-wasm';
import type { NodeTypeDefinition, NodeValue, PathValue } from '../../types';

const BOOLEAN_OPS: Array<{ op: BooleanOp; type: string; label: string }> = [
  { op: 'union', type: 'boolean-union', label: 'Union' },
  { op: 'subtract', type: 'boolean-subtract', label: 'Subtract' },
  { op: 'intersect', type: 'boolean-intersect', label: 'Intersect' },
  { op: 'xor', type: 'boolean-xor', label: 'XOR' },
];

export function createBooleanNodes(backend: PathOpsBackend): NodeTypeDefinition[] {
  return BOOLEAN_OPS.map(({ op, type, label }) => ({
    type,
    label,
    category: 'pathOp' as const,
    inputs: [
      { name: 'a', type: 'path' as const },
      { name: 'b', type: 'path' as const },
    ],
    outputs: [{ name: 'path', type: 'path' as const }],
    params: [],
    execute(inputs: Record<string, NodeValue | NodeValue[]>): Record<string, NodeValue> {
      const aInput = inputs.a as NodeValue | undefined;
      const bInput = inputs.b as NodeValue | undefined;
      if (!aInput || !bInput) {
        return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
      }
      const a = aInput.value as PathValue;
      const b = bInput.value as PathValue;
      const result = backend.boolean(op, a, b);
      return { path: { type: 'path', value: result } };
    },
  }));
}
