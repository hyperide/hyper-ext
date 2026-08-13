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
import { detectFramework } from './framework-routing';

async function exists(io: FileIO, p: string): Promise<boolean> {
  try {
    await io.access(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Workspace member parent dirs, in priority order. Mirrors
 * lib/component-scanner/scanner.ts WORKSPACE_DIRS — `targets`/`apps` (runnable
 * apps) are checked before `packages`/`libs` (shared libraries).
 */
const WORKSPACE_DIRS = ['targets', 'apps', 'packages', 'libs', 'services'] as const;

interface PackageJsonShape {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

async function readPackageJson(projectRoot: string, io: FileIO): Promise<PackageJsonShape | null> {
  try {
    return JSON.parse(await io.readFile(join(projectRoot, 'package.json'))) as PackageJsonShape;
  } catch {
    return null;
  }
}

/** True when `target`'s package.json declares `libName` as a dependency. */
function dependsOn(target: PackageJsonShape | null, libName: string | undefined): boolean {
  if (!target || !libName) return false;
  return Boolean(target.dependencies?.[libName] ?? target.devDependencies?.[libName]);
}

/**
 * A project root is "runnable" (can host a HyperIDE preview) when a real bundler
 * framework is detected AND the package defines a dev/start script. The script
 * check is load-bearing: a monorepo root may carry `vite` in devDependencies
 * (so detectFramework returns a framework) yet have no dev script and no entry
 * file — rooting the preview there ships a broken iframe (HYP-441).
 */
async function isRunnableProject(projectRoot: string, io: FileIO): Promise<boolean> {
  const { framework } = await detectFramework(projectRoot, io);
  if (framework === 'unknown') return false;
  const pkg = await readPackageJson(projectRoot, io);
  const scripts = pkg?.scripts ?? {};
  return Boolean(scripts.dev || scripts.start);
}

/**
 * Enumerate workspace member dirs under the known WORKSPACE_DIRS parents and
 * return their absolute roots in deterministic order (WORKSPACE_DIRS order, then
 * alphabetical within each parent). Uses io.listFiles to discover member
 * package.json files; returns [] when listFiles is unavailable.
 */
async function enumerateMemberRoots(workspaceRoot: string, io: FileIO): Promise<string[]> {
  if (!io.listFiles) return [];
  const roots: string[] = [];
  for (const dir of WORKSPACE_DIRS) {
    const parent = join(workspaceRoot, dir);
    if (!(await exists(io, parent))) continue;
    let pkgFiles: string[];
    try {
      pkgFiles = await io.listFiles(parent, ['package.json']);
    } catch {
      continue;
    }
    // Keep only direct members (parent/<member>/package.json), not nested ones.
    const memberRoots = pkgFiles.map((p) => dirname(p)).filter((d) => dirname(d) === parent);
    memberRoots.sort();
    roots.push(...memberRoots);
  }
  return roots;
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

/**
 * Resolve the project root the PREVIEW pipeline should run against for a selected
 * component.
 *
 * Differs from resolveActiveProjectRoot (which returns the package that *owns* the
 * component — correct for AST edits): a library sub-package (react in peerDeps, no
 * bundler, no dev script) owns its components but cannot host a preview. Opening a
 * file there used to root the preview pipeline at the library → detectFramework
 * returned `unknown` → a spurious "unsupported project type" toast, even though the
 * surrounding monorepo has perfectly runnable app targets (HYP-441).
 *
 * Resolution order:
 *   1. The owning package, if it is itself runnable (app target, single-package repo).
 *   2. Otherwise, a runnable app target in the monorepo. Among runnable targets,
 *      prefer one that declares the owning library as a dependency (its Vite/webpack
 *      dev server can actually resolve the cross-package import). Tiebreak is
 *      deterministic: WORKSPACE_DIRS order (targets/apps before packages/libs),
 *      alphabetical within each parent.
 *   3. Otherwise, workspaceRoot (genuinely unsupported — the caller's framework
 *      detection then surfaces the compatibility screen, not a toast).
 *
 * Picking a SINGLE target for a library consumed by multiple apps is a deliberate
 * simplification; full per-app disambiguation is deferred (see HYP-441 follow-up).
 */
export async function resolveRunnableProjectRoot(
  workspaceRoot: string,
  componentPath: string,
  io: FileIO,
): Promise<string> {
  const owner = await resolveActiveProjectRoot(workspaceRoot, componentPath, io);
  if (await isRunnableProject(owner, io)) return owner;

  // The owning package is not runnable (a shared library). Find a runnable app
  // target, preferring one that consumes this library.
  const ownerPkg = await readPackageJson(owner, io);
  const libName = ownerPkg?.name;

  const runnableTargets: string[] = [];
  for (const memberRoot of await enumerateMemberRoots(workspaceRoot, io)) {
    if (memberRoot === owner) continue;
    if (await isRunnableProject(memberRoot, io)) runnableTargets.push(memberRoot);
  }

  for (const target of runnableTargets) {
    if (dependsOn(await readPackageJson(target, io), libName)) return target;
  }
  if (runnableTargets.length > 0) return runnableTargets[0];

  return workspaceRoot;
}
