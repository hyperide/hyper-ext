/**
 * @file devServerOrphanRegistry — persist and reap our OWN orphaned dev-server.
 *
 * Accessed via: DevServerManager.start() (reap step) and the spawn / stop / exit
 * paths (record + clear). Not exposed to the end user directly; its effect is a
 * preview that materializes after a "Developer: Reload Window" instead of hanging.
 *
 * Why this exists (orphan-reap-on-reload):
 * DevServerManager spawns the user's dev server DETACHED (its own process group).
 * On a VS Code window reload, deactivate() fires `void devServerManager.stop()`
 * fire-and-forget; VS Code tears down the extension host before the 5s graceful
 * stop completes, so the detached child is ORPHANED and survives, still holding
 * its port. For a Bun dev server that hardcodes `serve({ port: 3000 })` and
 * ignores PORT/--port, the orphan keeps port 3000; the next fresh start picks a
 * different free port but Bun re-binds 3000, hits EADDRINUSE, and exits — the
 * preview never appears. The deactivate() race is unfixable (VS Code does not
 * await async dispose), so cleanup must happen at the NEXT start.
 *
 * Strategy: when we spawn, we record { pid, projectPath, command, startedAt } to
 * a per-project JSON file under the OS temp dir. On the next start, BEFORE picking
 * a port, we read that record and — only if the pid is still alive and the record
 * is the one WE wrote for THIS projectPath — kill its process group. We attribute
 * the kill via the pid WE recorded, NEVER via "whoever holds the port"
 * (EADDRINUSE proves occupancy, not ownership; killing the port holder could kill
 * the user's unrelated server).
 *
 * PID-reuse guard (best-effort): a pid is not a stable identity. If our orphan
 * exits on its own, the OS can recycle its exact pid to an UNRELATED process
 * before the next start — and a pid+projectPath match would then kill that
 * stranger. So before the kill we read the live process's command line via `ps`
 * and SUPPRESS the kill only when we have POSITIVE evidence the live command is a
 * different tool than the one we recorded. This is a one-way safety: `ps` being
 * absent/erroring/timing-out, or any platform without it (win32), DEGRADES to the
 * old pid+projectPath behavior — we must never let an unavailable `ps` stop us
 * reaping a real orphan (that would reintroduce the original port-wedge bug).
 *
 * DOCUMENTED FLOOR — where the guard does NOT hold: on a platform without a usable
 * `ps` (notably win32, or a hardened env where exec of `ps` fails), a recycled pid
 * can still be killed. This is accepted: the reuse window between an orphan's exit
 * and the next start is tiny, and a falsely-killed stranger is a far rarer / lesser
 * harm than the original "preview never appears" wedge the reap exists to fix.
 *
 * Assumptions:
 *  - One record file per projectPath (keyed by sha1(projectPath)). A new spawn
 *    overwrites the previous record for the same project.
 *  - Best-effort and non-fatal: every operation swallows its own errors so a
 *    reap/record failure never blocks a fresh start.
 *  - POSIX process-group kill (`process.kill(-pid, signal)`) mirrors
 *    DevServerManager._killProcessTree. On Windows we fall back to a single-pid
 *    kill (detached process groups are a POSIX concept here).
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Persisted description of a dev-server child we own, for cross-reload reaping. */
export interface OwnedDevServerRecord {
  pid: number;
  projectPath: string;
  /** Resolved command we spawned, e.g. "bun run dev" — for diagnostics / a future ownership tightening. */
  command: string;
  /** Epoch ms when the child was spawned. */
  startedAt: number;
}

const RECORD_PREFIX = 'hyperide-devserver-';

/** Absolute path of the record file for a given project path. */
export function orphanRecordPath(projectPath: string, baseDir: string = tmpdir()): string {
  const hash = createHash('sha1').update(projectPath).digest('hex');
  return join(baseDir, `${RECORD_PREFIX}${hash}.json`);
}

/**
 * Persist the owned dev-server record. Called right after spawn when child.pid is
 * known. Best-effort: a write failure is logged via onWarn (if provided) and never
 * thrown — losing the record only means we cannot reap that orphan later.
 */
export function recordOwnedDevServer(record: OwnedDevServerRecord, baseDir: string = tmpdir()): void {
  try {
    if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
    writeFileSync(orphanRecordPath(record.projectPath, baseDir), JSON.stringify(record), 'utf8');
  } catch {
    // Non-fatal: reaping the orphan on the next start is a best-effort safety net.
  }
}

/** Read the owned dev-server record for a project, or null if absent/corrupt. */
export function readOwnedDevServer(projectPath: string, baseDir: string = tmpdir()): OwnedDevServerRecord | null {
  try {
    const file = orphanRecordPath(projectPath, baseDir);
    if (!existsSync(file)) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<OwnedDevServerRecord>;
    if (typeof parsed.pid !== 'number' || parsed.projectPath !== projectPath) return null;
    return {
      pid: parsed.pid,
      projectPath: parsed.projectPath,
      command: typeof parsed.command === 'string' ? parsed.command : '',
      startedAt: typeof parsed.startedAt === 'number' ? parsed.startedAt : 0,
    };
  } catch {
    return null;
  }
}

/** Delete the owned dev-server record (clean stop / child exit). Best-effort. */
export function clearOwnedDevServer(projectPath: string, baseDir: string = tmpdir()): void {
  try {
    rmSync(orphanRecordPath(projectPath, baseDir), { force: true });
  } catch {
    // Non-fatal.
  }
}

/** True when `process.kill(pid, 0)` succeeds — the pid is a live, signalable process. */
export function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but we can't signal it — treat as alive so we
    // don't drop a record for a process we merely lack permission over.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/** Dev-tool tokens we treat as a recognizable identity signal in a command line. */
const KNOWN_DEV_TOOL_TOKENS = ['bun', 'vite', 'next', 'npm', 'pnpm', 'yarn', 'node', 'deno', 'remix', 'webpack'];

/**
 * Identity tokens to look for in a live process's command line, derived from the
 * recorded `command`. The first whitespace token is the resolved binary/script we
 * actually spawned (e.g. "bun" in "bun run dev"); we also surface any well-known
 * dev-tool name appearing anywhere in the command. Tokens are basename'd and
 * lower-cased so "/usr/local/bin/bun" still matches "bun".
 */
function identityTokensFromCommand(command: string): string[] {
  const words = command.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const tokens = new Set<string>();
  const first = words[0]?.split('/').pop();
  if (first) tokens.add(first);
  for (const word of words) {
    const leaf = word.split('/').pop() ?? word;
    if (KNOWN_DEV_TOOL_TOKENS.includes(leaf)) tokens.add(leaf);
  }
  return [...tokens];
}

/**
 * Best-effort check that the live process at `pid` still looks like the dev server
 * we recorded as `command`. Reads the live command line via `ps` (darwin/linux).
 *
 * @returns true  — live command line CONTAINS a recognizable token from `command`
 *                  (looks like ours; proceed with the kill).
 *          false — `ps` returned a command line that does NOT contain any of our
 *                  identity tokens (positive evidence of pid reuse; suppress kill).
 *          null  — couldn't tell (win32, `ps` missing/errored/timed out, or the
 *                  record carried no usable command); caller proceeds as before.
 */
export function liveProcessLooksLikeRecord(pid: number, command: string): boolean | null {
  if (process.platform === 'win32') return null;
  const tokens = identityTokensFromCommand(command);
  if (tokens.length === 0) return null; // no signal to compare against
  try {
    const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .toLowerCase();
    if (!out) return null; // ps gave us nothing usable — can't tell
    return tokens.some((token) => out.includes(token));
  } catch {
    // ps unavailable / errored / timed out — degrade to "can't tell".
    return null;
  }
}

/**
 * Reap a stale recorded dev-server for this project, if any, BEFORE a fresh start.
 *
 * Reads the record, and only when the recorded pid is still alive AND the record
 * is the one we wrote for THIS projectPath, asks `killGroup` to terminate it. The
 * caller supplies `killGroup` (a SIGTERM→SIGKILL ladder around the raw pid) so the
 * reaper reuses DevServerManager's existing kill logic instead of duplicating it.
 * The record is deleted afterwards regardless. Fully wrapped in try/catch so a
 * reap failure never blocks the start it precedes.
 *
 * PID-reuse guard (best-effort): a pid alone is not identity — if our orphan exited
 * and the OS recycled its pid to an unrelated process, pid+projectPath would still
 * match. Before the kill we ask `liveProcessLooksLikeRecord`; only a POSITIVE
 * mismatch (false) suppresses the kill (we still clear the stale record, since our
 * process is gone). A null ("can't tell" — no `ps`, error, timeout, win32, or no
 * recorded command) DOES NOT block the kill — see the documented floor in the file
 * header: on a platform without a usable `ps`, a recycled pid may still be killed,
 * which is the lesser harm versus failing to reap a real port-wedging orphan.
 *
 * @returns the pid that was reaped, or null when there was nothing to do.
 */
export function reapStaleOwnedDevServer(
  projectPath: string,
  killGroup: (pid: number) => void,
  options: { baseDir?: string; onLog?: (message: string) => void } = {},
): number | null {
  const baseDir = options.baseDir ?? tmpdir();
  try {
    const record = readOwnedDevServer(projectPath, baseDir);
    if (!record) return null;
    if (!isProcessAlive(record.pid)) {
      clearOwnedDevServer(projectPath, baseDir);
      return null;
    }
    // PID-reuse guard: only suppress when we have positive evidence (false) that
    // the live process is a DIFFERENT command. null = "can't tell" → proceed.
    if (liveProcessLooksLikeRecord(record.pid, record.command) === false) {
      options.onLog?.(
        `[DevServer] Skipping reap of pid ${record.pid}: live process no longer matches recorded command (${record.command}); pid likely reused`,
      );
      clearOwnedDevServer(projectPath, baseDir);
      return null;
    }
    options.onLog?.(
      `[DevServer] Reaping orphaned dev server pid ${record.pid} (${record.command}) from previous session`,
    );
    killGroup(record.pid);
    clearOwnedDevServer(projectPath, baseDir);
    return record.pid;
  } catch {
    // Never let a reap failure block a fresh start.
    return null;
  }
}
