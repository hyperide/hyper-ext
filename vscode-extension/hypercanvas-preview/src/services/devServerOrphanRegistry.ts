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
 * Strategy: when we spawn, we append { pid, projectPath, command, startedAt } to
 * a bounded per-project JSON file under the OS temp dir. On the next start,
 * BEFORE picking a port, we read every record and — only if the recorded leader
 * pid or its process group is still alive and the record is one WE wrote for THIS
 * projectPath — kill that process group. We attribute the kill via pids WE
 * recorded, NEVER via "whoever holds the port" (EADDRINUSE proves occupancy, not
 * ownership; killing the port holder could kill the user's unrelated server).
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
 * Leader-dead / group-live floor: the process we record is the detached wrapper
 * leader (`npm run dev`, `bun run dev`, etc.). In real reload races that leader can
 * exit before its nested dev-server child, leaving a live descendant in the SAME
 * process group holding the port. `process.kill(-pgid, 0)` succeeds as long as any
 * process in that group is alive, even after the original leader pid is gone, so
 * the reaper checks leader OR group liveness before pruning a record. Group
 * membership alone is reachable only through a pid we recorded at spawn time, but
 * it is not eternal proof: if a group fully exits later and the OS reissues that
 * exact pgid number to an unrelated detached process, the SAME topology could
 * recur for a stranger. So the leader-dead path additionally requires a live
 * group member to look like a recognizable dev tool (`groupMembersLookLikeRecordedTool`)
 * before killing — the same best-effort, degrade-to-proceed-on-can't-tell posture
 * as the leader-alive recheck, not port ownership or a wider kill-authorization.
 *
 * Assumptions:
 *  - One bounded record-history file per projectPath (keyed by sha1(projectPath)).
 *    Repeated crash/reload cycles keep recent generations without unbounded growth.
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

/** Persisted description of one dev-server process-group leader we spawned. */
export interface OwnedDevServerRecord {
  pid: number;
  projectPath: string;
  /** Resolved command we spawned, e.g. "bun run dev" — for diagnostics / a future ownership tightening. */
  command: string;
  /** Epoch ms when the child was spawned. */
  startedAt: number;
}

const RECORD_PREFIX = 'hyperide-devserver-';
const MAX_OWNED_DEV_SERVER_RECORDS = 20;

type JsonObject = { readonly [key: string]: unknown };

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ownedDevServerRecordFromJson(value: unknown, projectPath: string): OwnedDevServerRecord | null {
  if (!isJsonObject(value)) return null;
  const { pid, projectPath: storedProjectPath, command, startedAt } = value;
  if (typeof pid !== 'number' || storedProjectPath !== projectPath) return null;
  return {
    pid,
    projectPath: storedProjectPath,
    command: typeof command === 'string' ? command : '',
    startedAt: typeof startedAt === 'number' ? startedAt : 0,
  };
}

function writeOwnedDevServerRecords(
  projectPath: string,
  records: readonly OwnedDevServerRecord[],
  baseDir: string,
): void {
  if (records.length === 0) {
    rmSync(orphanRecordPath(projectPath, baseDir), { force: true });
    return;
  }
  if (!existsSync(baseDir)) mkdirSync(baseDir, { recursive: true });
  const boundedRecords = records.slice(-MAX_OWNED_DEV_SERVER_RECORDS);
  // codeql[js/insecure-temporary-file] -- the registry deliberately lives at a PREDICTABLE per-project path in the os tmp dir so a FUTURE extension process can find and reap orphaned dev servers after a crash; mkdtemp would defeat the feature, and the record holds only non-sensitive pid/port/path data
  writeFileSync(orphanRecordPath(projectPath, baseDir), JSON.stringify(boundedRecords), 'utf8');
}

/** Absolute path of the record file for a given project path. */
export function orphanRecordPath(projectPath: string, baseDir: string = tmpdir()): string {
  const hash = createHash('sha1').update(projectPath).digest('hex');
  return join(baseDir, `${RECORD_PREFIX}${hash}.json`);
}

/**
 * Persist an owned dev-server record. Called right after spawn when child.pid is
 * known. Best-effort: a write failure is swallowed — losing the record only means
 * we cannot reap that orphan later.
 */
export function recordOwnedDevServer(record: OwnedDevServerRecord, baseDir: string = tmpdir()): void {
  try {
    writeOwnedDevServerRecords(
      record.projectPath,
      [...readOwnedDevServers(record.projectPath, baseDir), record],
      baseDir,
    );
  } catch {
    // Non-fatal: reaping the orphan on the next start is a best-effort safety net.
  }
}

/** Read all owned dev-server records for a project, newest last. */
export function readOwnedDevServers(projectPath: string, baseDir: string = tmpdir()): OwnedDevServerRecord[] {
  try {
    const file = orphanRecordPath(projectPath, baseDir);
    if (!existsSync(file)) return [];
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const values = Array.isArray(parsed) ? parsed : isJsonObject(parsed) ? [parsed] : [];
    return values
      .map((value) => ownedDevServerRecordFromJson(value, projectPath))
      .filter((record): record is OwnedDevServerRecord => record !== null);
  } catch {
    return [];
  }
}

/** Read the most recent owned dev-server record for a project, or null if none. */
export function readOwnedDevServer(projectPath: string, baseDir: string = tmpdir()): OwnedDevServerRecord | null {
  const records = readOwnedDevServers(projectPath, baseDir);
  return records.at(-1) ?? null;
}

/**
 * Find a live, identity-matching owned dev-server record for this project —
 * the ATTACH-side identity proof (HYP-1160). Before DevServerManager adopts a
 * server already answering HTTP on the expected port, it must know the listener
 * is one WE spawned for THIS project, not a different project's dev server or an
 * unrelated service that happens to hold the port. A record in this project's
 * registry file whose process/group is still alive is exactly that proof: only
 * our own spawn writes it (keyed by sha1(projectPath)), so a random service
 * cannot spoof it.
 *
 * Uses the SAME aliveness + positive-identity ladder as the reaper
 * (reapOneRecord): a POSITIVE identity mismatch (the live command line no
 * longer matches the recorded command — pid reuse) rejects the record;
 * "can't tell" (null — win32, `ps` unavailable, no usable tokens) is accepted,
 * the same floor the reaper applies before killing. Newest record wins.
 *
 * Read-only: dead/mismatched records are left in place for the reaper's prune.
 */
export function findLiveOwnedDevServer(projectPath: string, baseDir: string = tmpdir()): OwnedDevServerRecord | null {
  try {
    // Newest record wins — reverse-INDEX the array instead of spread+reverse
    // copying it on every call (PR #692 review).
    const records = readOwnedDevServers(projectPath, baseDir);
    for (let i = records.length - 1; i >= 0; i--) {
      const record = records[i];
      const leaderAlive = isProcessAlive(record.pid);
      const groupAlive = leaderAlive || isProcessGroupAlive(record.pid);
      if (!groupAlive) continue;
      const identityMismatch = leaderAlive
        ? liveProcessLooksLikeRecord(record.pid, record.command) === false
        : groupMembersLookLikeRecordedTool(record.pid, record.command) === false;
      if (identityMismatch) continue;
      return record;
    }
    return null;
  } catch {
    // Best-effort, same contract as the rest of the registry.
    return null;
  }
}

/** Delete one owned dev-server record (clean stop / child exit). Best-effort. */
export function clearOwnedDevServer(projectPath: string, pid: number, baseDir: string = tmpdir()): void {
  try {
    writeOwnedDevServerRecords(
      projectPath,
      readOwnedDevServers(projectPath, baseDir).filter((record) => record.pid !== pid),
      baseDir,
    );
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

/**
 * True when `process.kill(-pgid, 0)` sees any live member of the process group.
 *
 * The recorded detached wrapper can exit before a nested dev-server child. POSIX
 * still lets us probe the original process group with a negative pid: success here
 * means at least one descendant in that group is alive, even when `pgid` itself is
 * no longer a live pid. EPERM is treated as alive for the same reason as
 * `isProcessAlive`: lack of permission is not proof the group is gone.
 */
export function isProcessGroupAlive(pgid: number): boolean {
  if (!Number.isInteger(pgid) || pgid <= 0) return false;
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (err) {
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
 * Best-effort check that SOME live member of process group `pgid` still looks
 * like a dev-server tool — used only when the recorded LEADER pid has already
 * exited (so there is no live command line at `record.pid` for
 * `liveProcessLooksLikeRecord` to compare). Without this, a leader-dead/group-
 * alive record would be reaped on group membership ALONE, with zero positive
 * identity check (review finding, HYP-926): if our orphan's group fully exits
 * later and the OS coincidentally reissues that exact pgid number to an
 * unrelated detached process that ALSO exits its own wrapper before a
 * descendant, we would kill a stranger with no check at all. This closes that
 * gap the same best-effort way `liveProcessLooksLikeRecord` does for the
 * leader-alive case: lists every live pid in the group via `ps`, and looks for
 * either a token from the recorded command (matches the specific tool we
 * spawned) OR any well-known dev-tool token (the wrapper and its child are
 * rarely the same binary — `npm run dev` vs `bun --hot dev-server.tsx` — so a
 * generic "does this look like a dev toolchain at all" signal is the right
 * bar here, not an exact match).
 *
 * @returns true  — some live group member's command line matches.
 *          false — `ps` listed live members and NONE matched (positive
 *                  mismatch; suppress the kill).
 *          null  — couldn't tell (win32, `ps` missing/errored/timed out, or no
 *                  member of `pgid` could be listed); caller proceeds as
 *                  before — same floor as `liveProcessLooksLikeRecord`.
 */
export function groupMembersLookLikeRecordedTool(pgid: number, command: string): boolean | null {
  if (process.platform === 'win32') return null;
  try {
    const out = execFileSync('ps', ['-Ao', 'pgid=,command='], {
      encoding: 'utf8',
      timeout: 1500,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).toLowerCase();
    const memberLines = out
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith(`${pgid} `) || line === String(pgid));
    if (memberLines.length === 0) return null; // couldn't confirm any member — can't tell
    const combined = memberLines.join(' ');
    const recordedTokens = identityTokensFromCommand(command);
    if (recordedTokens.some((token) => combined.includes(token))) return true;
    // No match on the recorded command's OWN tokens (expected — the wrapper and
    // its surviving child are often different binaries) — fall back to a
    // generic dev-tool signal before declaring a positive mismatch.
    return KNOWN_DEV_TOOL_TOKENS.some((token) => combined.includes(token));
  } catch {
    // ps unavailable / errored / timed out — degrade to "can't tell".
    return null;
  }
}

/**
 * Reap stale recorded dev-server groups for this project BEFORE a fresh start.
 *
 * Reads every recent record, and only when the recorded pid or its process group is
 * still alive AND the record is one we wrote for THIS projectPath, asks
 * `killGroup` to terminate it. The caller supplies `killGroup` (a SIGTERM→SIGKILL
 * ladder around the raw pid) so the reaper reuses DevServerManager's existing kill
 * logic instead of duplicating it. Resolved records are pruned independently so one
 * stale generation never erases another still-actionable generation.
 *
 * PID-reuse guard (best-effort): a pid alone is not identity — if our orphan exited
 * and the OS recycled its pid to an unrelated process, pid+projectPath would still
 * match. When the leader pid itself is alive, we ask `liveProcessLooksLikeRecord`;
 * only a POSITIVE mismatch (false) suppresses the kill (we still clear the stale
 * record, since our process is gone). When the leader is dead but the group is
 * alive, there is no live command line at the recorded pid to compare, so we ask
 * `groupMembersLookLikeRecordedTool` instead — group membership alone is reachable
 * only through the leader pid we recorded, but is NOT by itself proof against a
 * later, unrelated pgid-number reuse (a fully-exited group's number can eventually
 * be reissued), so we still require at least one live member to look like a dev
 * tool before killing a leader-dead group.
 *
 * @returns the pids whose groups were reaped, or null when there was nothing to do.
 */
export function reapStaleOwnedDevServer(
  projectPath: string,
  killGroup: (pid: number) => void,
  options: { baseDir?: string; onLog?: (message: string) => void } = {},
): number[] | null {
  const baseDir = options.baseDir ?? tmpdir();
  try {
    const reapedPids: number[] = [];
    for (const record of readOwnedDevServers(projectPath, baseDir)) {
      const reapedPid = reapOneRecord(record, killGroup, { baseDir, onLog: options.onLog });
      if (reapedPid !== null) reapedPids.push(reapedPid);
    }
    return reapedPids.length > 0 ? reapedPids : null;
  } catch {
    // Never let a reap failure block a fresh start.
    return null;
  }
}

function reapOneRecord(
  record: OwnedDevServerRecord,
  killGroup: (pid: number) => void,
  options: { baseDir: string; onLog?: (message: string) => void },
): number | null {
  const leaderAlive = isProcessAlive(record.pid);
  const groupAlive = leaderAlive || isProcessGroupAlive(record.pid);
  if (!groupAlive) {
    clearOwnedDevServer(record.projectPath, record.pid, options.baseDir);
    return null;
  }
  // Positive-identity recheck before killing — which check applies depends on
  // whether the recorded LEADER pid is still alive (see the file-level doc above).
  const identityMismatch = leaderAlive
    ? liveProcessLooksLikeRecord(record.pid, record.command) === false
    : groupMembersLookLikeRecordedTool(record.pid, record.command) === false;
  if (identityMismatch) {
    options.onLog?.(
      `[DevServer] Skipping reap of pid ${record.pid}: live process no longer matches recorded command (${record.command}); pid likely reused`,
    );
    clearOwnedDevServer(record.projectPath, record.pid, options.baseDir);
    return null;
  }
  options.onLog?.(
    `[DevServer] Reaping orphaned dev server pid ${record.pid} (${record.command}) from previous session`,
  );
  try {
    killGroup(record.pid);
  } catch {
    return null;
  }
  clearOwnedDevServer(record.projectPath, record.pid, options.baseDir);
  return record.pid;
}
