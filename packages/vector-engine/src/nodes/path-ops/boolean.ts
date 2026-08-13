/**
 * @file Boolean operation nodes — union, subtract, intersect, xor
 *
 * Accessed via: Path menu > Boolean > Union / Subtract / Intersect / Exclude
 * Assumptions: PathOpsBackend is injected at registry creation, shared across all boolean nodes. Backend is stateless — no per-operation cleanup needed.
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Boolean Operation Nodes
 */

import type { BooleanOp, PathOpsBackend } from 'vector-wasm';
import { transformPathCommands } from '../../path/transform-path';
import type { NodeTypeDefinition, NodeValue, PathValue, TransformMatrix } from '../../types';

/**
 * Bake an operand's accumulated scene transform into its path before the op.
 * The transform rides on a separate `transform` port (translate/rotate/scale
 * nodes leave the path commands raw); without this, the op combines the operand
 * at its untransformed position (HYP-519). Identity transform is a no-op.
 */
function bakeOperand(pathInput: NodeValue, transformInput: NodeValue | undefined): PathValue {
  const path = pathInput.value as PathValue;
  if (!transformInput || transformInput.type !== 'transform') return path;
  const matrix = transformInput.value as TransformMatrix;
  const commands = transformPathCommands(path.commands, matrix);
  if (commands === path.commands) return path;
  // bounds is stale once geometry moves — drop it.
  return { commands, closed: path.closed };
}

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
      // Each operand's accumulated transform, baked into its path before the op.
      { name: 'aTransform', type: 'transform' as const },
      { name: 'bTransform', type: 'transform' as const },
    ],
    outputs: [{ name: 'path', type: 'path' as const }],
    params: [],
    execute(inputs: Record<string, NodeValue | NodeValue[]>): Record<string, NodeValue> {
      const aInput = inputs.a as NodeValue | undefined;
      const bInput = inputs.b as NodeValue | undefined;
      if (!aInput || !bInput) {
        return { path: { type: 'path', value: { commands: new Float64Array(0), closed: false } } };
      }
      const a = bakeOperand(aInput, inputs.aTransform as NodeValue | undefined);
      const b = bakeOperand(bInput, inputs.bTransform as NodeValue | undefined);
      const result = backend.boolean(op, a, b);
      return { path: { type: 'path', value: result } };
    },
  }));
}
