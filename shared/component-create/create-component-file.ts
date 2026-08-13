/**
 * @file Host-side file creation for the "New component" flow (HYP-1184).
 *
 * Accessed via: the SaaS server route (server/routes/createComponent.ts) and
 *   the VS Code extension host (PanelRouter 'component:create'). Imports
 *   node:fs — never pull this into a browser bundle; the dialog talks to the
 *   host over HTTP / the platform message bus instead.
 * Assumptions: containment is a lexical check (same model as the server's
 *   validateFilePath and the extension's resolveContainedPath) — dirPath comes
 *   from the webview/client and must never escape an authorized root.
 *   User-facing failures throw CreateComponentUserError (plain-language, safe
 *   to show); anything else is an unexpected system error.
 * Past bugs: HYP-269 — unguarded client-supplied paths in mutation routes.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { CreateComponentUserError } from './errors';
import { resolveTargetDir } from './resolve-target-dir';
import { renderComponentTemplate } from './templates';
import { COMPONENT_KINDS, type ComponentKind, type CreatedComponent } from './types';
import { validateComponentName } from './validate-name';

export interface CreateComponentFileInput {
  /**
   * Absolute root the returned relativePath is computed against — the opened
   * project/workspace folder. Writes are contained to this root plus any
   * containmentRoots.
   */
  projectRoot: string;
  /**
   * Additional absolute roots a write may land in — e.g. the extension's
   * discovered monorepo ancestor root when VS Code is opened at a sub-package
   * leaf and component groups legitimately point at `../sibling/...` (HYP-909).
   * The returned relativePath still rebases onto projectRoot.
   */
  containmentRoots?: string[];
  kind: ComponentKind;
  name: string;
  /** Root-relative target directory. Falls back to the conventional dir. */
  dirPath?: string;
}

/**
 * Write a new component file from the shared template.
 * Throws CreateComponentUserError with a plain-language message on
 * validation / containment / collision failures — hosts surface that message
 * verbatim to the dialog.
 */
export async function createComponentFile(input: CreateComponentFileInput): Promise<CreatedComponent> {
  if (!COMPONENT_KINDS.includes(input.kind)) {
    throw new CreateComponentUserError('Pick what you want to build: a building block, a section, or a page.');
  }
  const name = input.name.trim();
  const nameError = validateComponentName(name);
  if (nameError) throw new CreateComponentUserError(nameError);

  const dirPath = input.dirPath ?? defaultDir(input.projectRoot, input.kind);
  const absoluteDir = resolveContained(input.projectRoot, dirPath, input.containmentRoots ?? []);
  const absoluteFile = path.join(absoluteDir, `${name}.tsx`);

  await mkdir(absoluteDir, { recursive: true });
  // wx = exclusive create — refuses to clobber an existing file atomically.
  await writeFile(absoluteFile, renderComponentTemplate({ kind: input.kind, name }), { flag: 'wx' }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') {
        throw new CreateComponentUserError(`A file named ${name}.tsx already exists there — pick a different name.`);
      }
      throw error;
    },
  );

  // projectRoot-relative with forward slashes (matches scanner output).
  return { name, relativePath: path.relative(path.resolve(input.projectRoot), absoluteFile).split(path.sep).join('/') };
}

/** Conventional fallback dir: src/<dir> when the project has a src/ folder. */
function defaultDir(projectRoot: string, kind: ComponentKind): string {
  const hasSrcDir = existsSync(path.join(projectRoot, 'src'));
  return resolveTargetDir({ kind, groupDirs: [], hasSrcDir });
}

/**
 * Resolve dirPath against projectRoot (dirPath is always opened-root-relative,
 * matching scanner output like `../sibling/src/components`), then require the
 * resulting absolute path to be contained by an authorized root: projectRoot
 * itself, or a containmentRoot (the scanned monorepo ancestor — HYP-909).
 */
function resolveContained(projectRoot: string, dirPath: string, containmentRoots: string[]): string {
  if (path.isAbsolute(dirPath)) {
    throw new CreateComponentUserError('Access denied: the target folder must be inside the project.');
  }
  const absolute = path.resolve(path.resolve(projectRoot), dirPath);
  for (const root of [projectRoot, ...containmentRoots]) {
    const relative = path.relative(path.resolve(root), absolute);
    const escapes = relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    if (!escapes) return absolute;
  }
  throw new CreateComponentUserError('Access denied: path traversal detected.');
}
