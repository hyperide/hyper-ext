/**
 * @file Clip node — attaches a clipping shape to a path
 *
 * Takes a path and a clip shape, passes both through. The executor
 * picks up clipPath from terminal outputs and forwards it to the scene.
 *
 * Accessed via: Right-click > Set as Clip Mask, or Path menu > Clip
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Path Ops
 */

import { transformPathCommands } from '../../path/transform-path';
import type { NodeTypeDefinition, NodeValue, PathValue, TransformMatrix } from '../../types';

export const clipNode: NodeTypeDefinition = {
  type: 'clip',
  label: 'Clip',
  category: 'pathOp',
  inputs: [
    { name: 'path', type: 'path' },
    { name: 'clip', type: 'path' },
    { name: 'style', type: 'style' },
    { name: 'transform', type: 'transform' },
    // The clip mask's own accumulated transform, baked into clipPath (HYP-519).
    { name: 'clipTransform', type: 'transform' },
  ],
  outputs: [
    { name: 'path', type: 'path' },
    { name: 'style', type: 'style' },
    { name: 'clipPath', type: 'path' },
    { name: 'transform', type: 'transform' },
  ],
  params: [],
  execute(inputs) {
    const result: Record<string, NodeValue> = {};
    if (inputs.path) result.path = inputs.path as NodeValue;
    if (inputs.style) result.style = inputs.style as NodeValue;
    if (inputs.clip) {
      // Bake the mask's transform so the clip region sits at its scene position,
      // not its raw (untransformed) position. The content's transform flows
      // through `transform` to the scene item and is applied at render.
      const clipInput = inputs.clip as NodeValue;
      const clipPath = clipInput.value as PathValue;
      const clipTransform = inputs.clipTransform as NodeValue | undefined;
      if (clipTransform && clipTransform.type === 'transform') {
        const matrix = clipTransform.value as TransformMatrix;
        const commands = transformPathCommands(clipPath.commands, matrix);
        result.clipPath =
          commands === clipPath.commands ? clipInput : { type: 'path', value: { commands, closed: clipPath.closed } };
      } else {
        result.clipPath = clipInput;
      }
    }
    if (inputs.transform) result.transform = inputs.transform as NodeValue;
    return result;
  },
};
