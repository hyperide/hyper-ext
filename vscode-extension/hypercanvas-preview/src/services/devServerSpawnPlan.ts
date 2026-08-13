/**
 * @file devServerSpawnPlan — persist the RESOLVED dev-server spawn plan so a
 * window-reload respawn reuses it verbatim instead of re-detecting (HYP-1160).
 *
 * Accessed via: DevServerManager._runStart (write on first resolution, read on
 * every start). Not user-facing; its effect is that a respawn after
 * "Developer: Reload Window" spawns the SAME package manager + cwd + command
 * the previous window resolved — live QA on a bun + Nx monorepo (conloca)
 * showed the reload respawn re-running detection and flipping bun → npm, which
 * then spawned a broken command line.
 *
 * Why detection is not re-run on respawn: detection inputs are not stable
 * across a reload (the pinned monorepo sub-project path, lockfile presence,
 * and workspace-folder state can all differ transiently), and every flip
 * produces a different — broken — spawn. The plan is the resolved truth.
 *
 * Invalidation: a plan is reused only while its script key still exists in the
 * project's package.json, the script's wrapper-ness (task-runner delegation,
 * see devScriptUsesWrapper) is unchanged, AND the live resolution lands on the
 * same branch (wrapper-script-at-root vs pm-run-at-package-dir) — an edited
 * dev script that flips shell-safety keeps wrapper-ness but changes the correct
 * cwd, so it re-resolves (PR #692 review).
 * A plan is also discarded when the live lock-file evidence CONFIDENTLY
 * contradicts it (a lock file naming a different package manager — a pm
 * migration); absent evidence (a transiently unreadable lock file, the
 * reload-time flip this plan exists to survive) never invalidates (PR #692
 * review).
 *
 * Storage mirrors devServerOrphanRegistry: one JSON file per projectPath
 * (keyed by sha1) under the OS temp dir, surviving a window reload but not a
 * reboot. Best-effort and non-fatal: every operation swallows its own errors —
 * losing the plan only means the next start re-resolves it.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** The resolved, reused-on-respawn spawn decision for one project. */
export interface DevServerSpawnPlan {
  /** Schema version — bump on shape change; unknown versions are ignored. */
  version: 2;
  projectPath: string;
  /** package.json script key the plan was resolved for (e.g. "dev"). */
  script: string;
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun';
  /** Spawn cwd — the workspace root for task-runner wrappers, else projectPath. */
  cwd: string;
  /** True when the script delegates to a task-runner wrapper (nx/turbo/…). */
  wrapper: boolean;
  /**
   * The resolution branch of SpawnCommand the plan was resolved on. The
   * persisted cwd is reused only when the LIVE resolution lands on the same
   * branch (PR #692 review): an edited script that flips shell-safety
   * (`nx run app:dev` → `nx run app:dev && …`) keeps wrapper-ness but moves
   * the correct cwd from the workspace root back to the package dir.
   */
  branch: 'wrapper-script' | 'pm-run';
  /** Epoch ms when the plan was first resolved. */
  createdAt: number;
}

const PLAN_PREFIX = 'hyperide-devserver-plan-';

type JsonObject = { readonly [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const PACKAGE_MANAGERS: readonly string[] = ['npm', 'yarn', 'pnpm', 'bun'];
const RESOLUTION_BRANCHES: readonly string[] = ['wrapper-script', 'pm-run'];

function spawnPlanFromJson(value: unknown, projectPath: string): DevServerSpawnPlan | null {
  if (!isJsonObject(value)) return null;
  const { version, projectPath: storedProjectPath, script, packageManager, cwd, wrapper, branch, createdAt } = value;
  if (version !== 2 || storedProjectPath !== projectPath) return null;
  if (typeof script !== 'string' || typeof cwd !== 'string') return null;
  if (typeof packageManager !== 'string' || !PACKAGE_MANAGERS.includes(packageManager)) return null;
  if (typeof branch !== 'string' || !RESOLUTION_BRANCHES.includes(branch)) return null;
  return {
    version: 2,
    projectPath: storedProjectPath,
    script,
    packageManager: packageManager as DevServerSpawnPlan['packageManager'],
    cwd,
    wrapper: wrapper === true,
    branch: branch as DevServerSpawnPlan['branch'],
    createdAt: typeof createdAt === 'number' ? createdAt : 0,
  };
}

/** Absolute path of the plan file for a given project path. */
function spawnPlanPath(projectPath: string, baseDir: string = tmpdir()): string {
  const hash = createHash('sha1').update(projectPath).digest('hex');
  return join(baseDir, `${PLAN_PREFIX}${hash}.json`);
}

/**
 * Persist a resolved spawn plan. Called once per project after the first
 * successful resolution. Best-effort: a write failure is swallowed — losing
 * the plan only means the next start re-resolves it.
 */
export function writeSpawnPlan(plan: DevServerSpawnPlan, baseDir: string = tmpdir()): void {
  try {
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
    // codeql[js/insecure-temporary-file] -- the plan deliberately lives at a PREDICTABLE per-project path in the os tmp dir so a FUTURE extension process can reuse the resolved spawn plan after a window reload; mkdtemp would defeat the feature, and the plan holds only non-sensitive pm/cwd/script data
    writeFileSync(spawnPlanPath(plan.projectPath, baseDir), JSON.stringify(plan, null, 2), 'utf8');
  } catch {
    // best-effort — see module doc
  }
}

/** Read the persisted spawn plan for a project, or null if none/invalid. */
export function readSpawnPlan(projectPath: string, baseDir: string = tmpdir()): DevServerSpawnPlan | null {
  try {
    const raw = readFileSync(spawnPlanPath(projectPath, baseDir), 'utf8');
    return spawnPlanFromJson(JSON.parse(raw), projectPath);
  } catch {
    return null;
  }
}
