/**
 * @file Path merge utility — concatenate multiple paths into a compound path
 *
 * Accessed via: Group node, SVG import — combines sub-paths into single PathValue
 * Architecture: docs/specs/2026-03-13-vector-engine-design.md §Structural Nodes
 */

import type { PathValue } from '../types';

export function mergePaths(paths: PathValue[]): PathValue {
  let totalSize = 0;
  for (const p of paths) totalSize += p.commands.length;
  const merged = new Float64Array(totalSize);
  let offset = 0;
  for (const p of paths) {
    merged.set(p.commands, offset);
    offset += p.commands.length;
  }
  return { commands: merged, closed: paths.length > 0 && paths.every((p) => p.closed) };
}
