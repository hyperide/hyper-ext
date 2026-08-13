/**
 * @file Target-directory resolution for the "New component" flow (HYP-1184).
 *
 * Accessed via: the CreateComponentDialog (to show "will be created in …")
 *   and create-component-file as the fallback when no dirPath is given.
 * Assumptions: pure, browser-safe. The rule a non-programmer expects: "put it
 *   where the similar things already are" — so the most populous existing
 *   directory for the kind wins; conventional fallbacks only for empty projects.
 */

import type { ComponentKind } from './types';

export interface TargetDirInput {
  kind: ComponentKind;
  /** Existing directories holding components of this kind, with their sizes. */
  groupDirs: { dirPath: string; count: number }[];
  /** Whether the project has a top-level src/ directory. */
  hasSrcDir: boolean;
}

/** Pick the directory a new component of `kind` should live in. */
export function resolveTargetDir({ kind, groupDirs, hasSrcDir }: TargetDirInput): string {
  const best = groupDirs.reduce<{ dirPath: string; count: number } | null>(
    (acc, g) => (acc === null || g.count > acc.count ? g : acc),
    null,
  );
  if (best) return best.dirPath;

  const prefix = hasSrcDir ? 'src/' : '';
  return kind === 'page' ? `${prefix}pages` : `${prefix}components`;
}
