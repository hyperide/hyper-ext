/**
 * @file Resolve the active project root for a selected component in a monorepo.
 *
 * Accessed via: VS Code extension preview panel — on component select, the preview
 *               pipeline (detectFramework / entry-file patch / __canvas_preview__ path /
 *               dev server) must run against the sub-project that owns the component, not
 *               the monorepo root. The root often has no dev/start script and no
 *               index.html / src/main.tsx, so rooting the pipeline there fails (HYP-420).
 * Assumptions: a monorepo member is identified by its own package.json. The nearest
 *              ancestor with a package.json below the workspace root owns the component.
 */

import { dirname, isAbsolute, join, relative } from 'node:path';
import type { FileIO } from '../ast/file-io';

async function exists(io: FileIO, p: string): Promise<boolean> {
  try {
    await io.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Given the monorepo/workspace root and a component path (relative to that root, or
 * absolute), return the directory of the sub-project that owns the component — the
 * nearest ancestor (strictly below workspaceRoot) that has its own package.json.
 *
 * Returns workspaceRoot itself when the component is not inside a member package
 * (e.g. a plain single-package project, or a file directly under the root's src/).
 */
export async function resolveActiveProjectRoot(
  workspaceRoot: string,
  componentPath: string,
  io: FileIO,
): Promise<string> {
  const absComponent = isAbsolute(componentPath) ? componentPath : join(workspaceRoot, componentPath);

  // Bail out if the component is not under the workspace root (defensive — should not happen).
  const rel = relative(workspaceRoot, absComponent);
  if (rel.startsWith('..') || isAbsolute(rel)) return workspaceRoot;

  // Walk up from the component's directory toward workspaceRoot. The first ancestor
  // strictly below workspaceRoot that owns a package.json is the active sub-project.
  let current = dirname(absComponent);
  while (current !== workspaceRoot && current.startsWith(workspaceRoot)) {
    if (await exists(io, join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break; // filesystem root guard
    current = parent;
  }

  return workspaceRoot;
}
