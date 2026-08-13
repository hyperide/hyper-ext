import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  clearOwnedDevServer,
  findLiveOwnedDevServer,
  groupMembersLookLikeRecordedTool,
  isProcessAlive,
  isProcessGroupAlive,
  liveProcessLooksLikeRecord,
  type OwnedDevServerRecord,
  orphanRecordPath,
  readOwnedDevServer,
  readOwnedDevServers,
  reapStaleOwnedDevServer,
  recordOwnedDevServer,
} from '../devServerOrphanRegistry';

/**
 * Orphan-reap-on-reload regression. The reaper must:
 *  - persist a per-project record on spawn and clear it on stop/exit,
 *  - on the next start, kill the recorded pid ONLY when it is still alive and the
 *    record belongs to THIS project (never "whoever holds the port"),
 *  - degrade gracefully (best-effort, never throw) when the record is missing,
 *    stale (pid already dead), or for a different project.
 *
 * These tests exercise REAL code: they spawn a throwaway process, record it, and
 * call the real reaper with a real process-group kill — then assert the process is
 * actually gone. No mocking of the unit under test.
 */

let baseDir: string;
const spawnedPids: number[] = [];

function spawnSleeper(): number {
  // A plain `sleep` is a clean, killable leaf process. Detached so it becomes its
  // own process-group leader, mirroring how DevServerManager spawns the dev server
  // (the reaper kills the GROUP via -pid). We deliberately avoid `process.execPath`
  // here: under bun the exec path is the bun binary, whose detached children do not
  // reap cleanly and hang the test runner's shutdown.
  const child = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error('failed to spawn sleeper');
  spawnedPids.push(pid);
  return pid;
}

function spawnNode(): number {
  // A real `node` process whose `ps` command line begins with "node" — used to
  // exercise the MATCHING side of the PID-reuse guard (record.command also starts
  // with "node"). We spawn `node` by NAME (not process.execPath, which under bun is
  // the bun binary and would both mis-match and hang the runner on shutdown).
  const child = spawn('node', ['-e', 'setTimeout(() => {}, 30000)'], { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error('failed to spawn node');
  spawnedPids.push(pid);
  return pid;
}

/**
 * Reproduces the REAL incident topology: a detached WRAPPER process (the pid
 * DevServerManager records) backgrounds a leaf child and exits almost immediately,
 * leaving the leaf alive in the SAME process group (reparented to init once the
 * wrapper is gone). The shell backgrounds a `node` sleep-loop (which inherits the
 * shell's pgid — it is never itself re-detached) then exits — so the recorded
 * leader pid dies almost instantly while the group survives via the node process.
 * Verified empirically against the real orphaned `bun run dev` / nx / bun --hot
 * dev-server.tsx trees found live on the dev machine during this investigation:
 * the wrapper leader dies first, a descendant in the same pgid outlives it and
 * keeps the port. Uses `node` (not plain `sleep`) as the surviving leaf so its
 * `ps` command line carries a recognizable dev-tool token — required by
 * `groupMembersLookLikeRecordedTool`'s identity check.
 */
function spawnOrphanedGroupSurvivor(): number {
  const child = spawn('sh', ['-c', 'node -e "setTimeout(() => {}, 30000)" & exit 0'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error('failed to spawn orphan-survivor group');
  spawnedPids.push(pid);
  return pid;
}

/**
 * Same leader-dies-before-child topology as `spawnOrphanedGroupSurvivor`, but the
 * surviving leaf is a plain `sleep` — a command line with NO recognizable dev-tool
 * token. Used to exercise `groupMembersLookLikeRecordedTool`'s positive-mismatch
 * (suppress) path: a fully-exited group's pgid number could, in principle, later
 * be reissued to an unrelated process with this same shape, and the reaper must
 * not kill it on group membership alone.
 */
function spawnOrphanedGroupSurvivorUnrecognizable(): number {
  const child = spawn('sh', ['-c', 'sleep 30 & exit 0'], { detached: true, stdio: 'ignore' });
  child.unref();
  const pid = child.pid;
  if (!pid) throw new Error('failed to spawn unrecognizable orphan-survivor group');
  spawnedPids.push(pid);
  return pid;
}

/** SIGTERM→SIGKILL group-kill ladder mirroring DevServerManager._reapOrphanPid. */
function killGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGKILL');
  } catch {
    try {
      process.kill(pid, 'SIGKILL');
    } catch {
      // already gone
    }
  }
}

async function waitForDeath(pid: number, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isProcessAlive(pid);
}

/**
 * A SIGKILL delivered to a group is not synchronously reflected in
 * `isProcessGroupAlive` — the kernel briefly still reports the target as alive
 * until it is actually reaped (confirmed empirically: immediately after
 * `process.kill(-pgid, 'SIGKILL')` the group can still read as alive for tens of
 * milliseconds). Poll instead of asserting immediately after a kill.
 */
async function waitForGroupDeath(pgid: number, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessGroupAlive(pgid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isProcessGroupAlive(pgid);
}

/** Waits for the leader-dead / group-alive topology to settle (the shell exits
 * almost instantly, but poll rather than assume timing). */
async function waitForLeaderDeadGroupAlive(leaderPid: number, timeoutMs = 2000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!isProcessAlive(leaderPid) && isProcessGroupAlive(leaderPid)) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return !isProcessAlive(leaderPid) && isProcessGroupAlive(leaderPid);
}

function makeRecord(pid: number, projectPath = '/proj/a'): OwnedDevServerRecord {
  return { pid, projectPath, command: 'bun run dev', startedAt: Date.now() };
}

beforeEach(() => {
  baseDir = mkdtempSync(join(tmpdir(), 'orphan-reg-test-'));
});

afterEach(() => {
  for (const pid of spawnedPids.splice(0)) killGroup(pid);
  rmSync(baseDir, { recursive: true, force: true });
});

describe('orphanRecordPath', () => {
  it('is deterministic per project path and differs across projects', () => {
    const a1 = orphanRecordPath('/proj/a', baseDir);
    const a2 = orphanRecordPath('/proj/a', baseDir);
    const b = orphanRecordPath('/proj/b', baseDir);
    expect(a1).toBe(a2);
    expect(a1).not.toBe(b);
    expect(a1.startsWith(baseDir)).toBe(true);
    expect(a1.endsWith('.json')).toBe(true);
  });
});

describe('record / read / clear round-trip', () => {
  it('persists a record and reads it back', () => {
    const record = makeRecord(12345);
    recordOwnedDevServer(record, baseDir);
    expect(existsSync(orphanRecordPath(record.projectPath, baseDir))).toBe(true);
    expect(readOwnedDevServer(record.projectPath, baseDir)).toEqual(record);
  });

  it('writes valid JSON as a bounded history array, not a single overwritten object', () => {
    const record = makeRecord(222);
    recordOwnedDevServer(record, baseDir);
    const onDisk = JSON.parse(readFileSync(orphanRecordPath(record.projectPath, baseDir), 'utf8'));
    expect(onDisk).toEqual([{ pid: 222, projectPath: '/proj/a', command: 'bun run dev', startedAt: record.startedAt }]);
  });

  it('appends rather than overwrites when the same project spawns again', () => {
    // This is the direct proof of the single-slot bug: a second spawn for the SAME
    // project used to clobber the first spawn's record, permanently losing any
    // orphan from an earlier generation. Now both generations persist.
    recordOwnedDevServer(makeRecord(101), baseDir);
    recordOwnedDevServer(makeRecord(102), baseDir);
    expect(readOwnedDevServers('/proj/a', baseDir).map((r) => r.pid)).toEqual([101, 102]);
  });

  it('caps history at 20 entries, dropping the oldest generation first', () => {
    for (let i = 0; i < 25; i++) {
      recordOwnedDevServer(makeRecord(1000 + i), baseDir);
    }
    const pids = readOwnedDevServers('/proj/a', baseDir).map((r) => r.pid);
    expect(pids.length).toBe(20);
    expect(pids[0]).toBe(1005); // oldest 5 (1000-1004) evicted
    expect(pids.at(-1)).toBe(1024);
  });

  it('clear removes only the matching pid, leaving a sibling record for the same project intact', () => {
    recordOwnedDevServer(makeRecord(111), baseDir);
    recordOwnedDevServer(makeRecord(222), baseDir);

    clearOwnedDevServer('/proj/a', 111, baseDir);

    expect(readOwnedDevServers('/proj/a', baseDir).map((r) => r.pid)).toEqual([222]);
  });

  it('clear deletes the record file once the last entry for the project is cleared', () => {
    const record = makeRecord(333);
    recordOwnedDevServer(record, baseDir);
    clearOwnedDevServer(record.projectPath, 333, baseDir);
    expect(existsSync(orphanRecordPath(record.projectPath, baseDir))).toBe(false);
    expect(readOwnedDevServer(record.projectPath, baseDir)).toBeNull();
  });

  it('clear is a no-op (no throw) when no record exists', () => {
    expect(() => clearOwnedDevServer('/never/recorded', 1, baseDir)).not.toThrow();
  });

  it('returns null for a record whose projectPath does not match the key', () => {
    // Tamper: a record file whose stored projectPath differs from the lookup key
    // (defensive against hash collision / manual corruption). Write RAW JSON
    // directly under /proj/a's own file path, with a body claiming /proj/OTHER —
    // recordOwnedDevServer always writes under record.projectPath's own hash, so
    // it cannot construct this mismatch; only a direct file write can.
    const tamperedBody = JSON.stringify([
      { pid: 444, projectPath: '/proj/OTHER', command: 'bun run dev', startedAt: Date.now() },
    ]);
    // codeql[js/insecure-temporary-file] -- same predictable-per-project-path pattern as recordOwnedDevServer's own suppression (devServerOrphanRegistry.ts); this is a per-test mkdtemp'd baseDir (see beforeEach above), not a shared/guessable path, and the body holds only non-sensitive pid/project-path test fixture data
    writeFileSync(orphanRecordPath('/proj/a', baseDir), tamperedBody, 'utf8');
    expect(readOwnedDevServers('/proj/a', baseDir)).toEqual([]);
    expect(readOwnedDevServer('/proj/a', baseDir)).toBeNull();
  });
});

describe('isProcessAlive', () => {
  it('returns true for a live process and false after it dies', async () => {
    const pid = spawnSleeper();
    expect(isProcessAlive(pid)).toBe(true);
    killGroup(pid);
    expect(await waitForDeath(pid)).toBe(true);
    expect(isProcessAlive(pid)).toBe(false);
  });

  it('returns false for an obviously invalid pid', () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(2 ** 31)).toBe(false); // not a live pid
  });
});

describe('isProcessGroupAlive', () => {
  it('returns true for a live detached group and false once fully killed', async () => {
    const pid = spawnSleeper();
    expect(isProcessGroupAlive(pid)).toBe(true);
    killGroup(pid);
    expect(await waitForDeath(pid)).toBe(true);
    expect(isProcessGroupAlive(pid)).toBe(false);
  });

  it('returns false for an obviously invalid pgid', () => {
    expect(isProcessGroupAlive(0)).toBe(false);
    expect(isProcessGroupAlive(-1)).toBe(false);
    expect(isProcessGroupAlive(2 ** 31)).toBe(false);
  });

  it('returns true even after the recorded leader pid itself has exited, when a group member survives', async () => {
    // The exact gap this fix closes: isProcessAlive(leaderPid) is false (the
    // wrapper already exited), but the group — reachable only via the pid we
    // recorded at spawn time — still has a live member.
    const leaderPid = spawnOrphanedGroupSurvivor();
    expect(await waitForLeaderDeadGroupAlive(leaderPid)).toBe(true);
    expect(isProcessAlive(leaderPid)).toBe(false);
    expect(isProcessGroupAlive(leaderPid)).toBe(true);
  });
});

describe('liveProcessLooksLikeRecord (real ps path)', () => {
  it('returns true when the live command line contains a recorded token', () => {
    const pid = spawnNode();
    // Recorded command and the live `ps` line both contain "node".
    expect(liveProcessLooksLikeRecord(pid, 'node -e setTimeout')).toBe(true);
  });

  it('returns false when the live command line is a DIFFERENT tool (pid reuse)', () => {
    const pid = spawnSleeper(); // live ps line is "sleep 30"
    // Recorded a bun dev server, but the pid now belongs to `sleep` — mismatch.
    expect(liveProcessLooksLikeRecord(pid, 'bun --hot src/index.ts')).toBe(false);
  });

  it("returns null (can't tell) when the record carries no command token", () => {
    const pid = spawnSleeper();
    expect(liveProcessLooksLikeRecord(pid, '')).toBeNull();
  });
});

describe('groupMembersLookLikeRecordedTool (real ps path, leader-dead case)', () => {
  it('returns true when a surviving group member looks like a known dev tool', async () => {
    // The recorded command ("npm run dev") and the surviving node process share no
    // token, but "node" is itself a recognized dev-tool token — the generic
    // fallback signal this function adds beyond a strict command match.
    const leaderPid = spawnOrphanedGroupSurvivor();
    expect(await waitForLeaderDeadGroupAlive(leaderPid)).toBe(true);
    expect(groupMembersLookLikeRecordedTool(leaderPid, 'npm run dev')).toBe(true);
  });

  it('returns false when no surviving group member looks like any known dev tool', async () => {
    // Review finding (HYP-926): without this check, a leader-dead group would be
    // killed on group membership ALONE with zero positive identity signal. A
    // plain `sleep` survivor matches neither the recorded command's own tokens
    // nor any KNOWN_DEV_TOOL_TOKENS — a positive mismatch, must suppress.
    const leaderPid = spawnOrphanedGroupSurvivorUnrecognizable();
    expect(await waitForLeaderDeadGroupAlive(leaderPid)).toBe(true);
    expect(groupMembersLookLikeRecordedTool(leaderPid, 'npm run dev')).toBe(false);
  });

  it("returns null (can't tell) for a pgid with no listable member", () => {
    expect(groupMembersLookLikeRecordedTool(2 ** 31, 'npm run dev')).toBeNull();
  });
});

describe('reapStaleOwnedDevServer', () => {
  it('kills a live recorded process we own and deletes the record', async () => {
    const pid = spawnSleeper();
    // Record the command the throwaway process actually runs ("sleep …") so the
    // PID-reuse recheck legitimately recognizes it as ours and proceeds to kill.
    recordOwnedDevServer({ ...makeRecord(pid), command: 'sleep 30' }, baseDir);

    const logs: string[] = [];
    const reaped = reapStaleOwnedDevServer('/proj/a', killGroup, {
      baseDir,
      onLog: (m) => logs.push(m),
    });

    expect(reaped).toEqual([pid]);
    expect(await waitForDeath(pid)).toBe(true);
    // Record removed so a later start does not re-target a dead/recycled pid.
    expect(readOwnedDevServer('/proj/a', baseDir)).toBeNull();
    expect(logs.some((m) => m.includes(String(pid)))).toBe(true);
  });

  it('REGRESSION (real incident repro): kills a surviving group member even though the recorded leader pid already exited', async () => {
    // This is the dominant bug this ticket fixes. Confirmed live on the dev machine:
    // a recorded wrapper leader (npm run dev / bun run dev) dies before its nested
    // dev-server child, leaving the child alive in the SAME process group holding
    // the port. The OLD code checked only isProcessAlive(record.pid) (the leader),
    // saw it dead, deleted the record, and returned WITHOUT ever attempting the
    // kill — even though process.kill(-pgid, signal) would have reached the
    // survivor. This test reproduces that exact topology with real processes.
    const leaderPid = spawnOrphanedGroupSurvivor();
    expect(await waitForLeaderDeadGroupAlive(leaderPid)).toBe(true);
    recordOwnedDevServer({ ...makeRecord(leaderPid), command: 'npm run dev' }, baseDir);

    const logs: string[] = [];
    const reaped = reapStaleOwnedDevServer('/proj/a', killGroup, {
      baseDir,
      onLog: (m) => logs.push(m),
    });

    expect(reaped).toEqual([leaderPid]);
    // The surviving descendant shared the leader's pgid — a real group kill must
    // have reached it, so the group has no live member left at all. SIGKILL is not
    // reflected synchronously (the kernel briefly still reports the target alive
    // until reaped), so poll rather than assert immediately.
    expect(await waitForGroupDeath(leaderPid)).toBe(true);
    expect(readOwnedDevServers('/proj/a', baseDir)).toEqual([]);
  });

  it('does NOT kill a leader-dead group whose surviving member looks like nothing we recognize', async () => {
    // Review finding (HYP-926): the leader-dead/group-alive path must still require
    // a positive identity signal, not group membership alone — otherwise a fully-
    // exited group's pgid number being reissued later to an unrelated process with
    // the same shape (wrapper dies, child survives) would get killed with zero
    // check at all. A plain `sleep` survivor is the unrecognizable case.
    const leaderPid = spawnOrphanedGroupSurvivorUnrecognizable();
    expect(await waitForLeaderDeadGroupAlive(leaderPid)).toBe(true);
    recordOwnedDevServer({ ...makeRecord(leaderPid), command: 'npm run dev' }, baseDir);

    let killed = false;
    const reaped = reapStaleOwnedDevServer(
      '/proj/a',
      () => {
        killed = true;
      },
      { baseDir },
    );

    expect(reaped).toBeNull();
    expect(killed).toBe(false); // never asked to kill the unrecognizable survivor
    expect(isProcessGroupAlive(leaderPid)).toBe(true); // survivor — not ours to kill
    expect(readOwnedDevServers('/proj/a', baseDir)).toEqual([]); // stale record still swept
  });

  it('reaps two separately-recorded generations for the same project in one call', async () => {
    // Direct proof the single-slot bug is fixed: TWO spawns for the same project,
    // recorded in sequence without an intervening reap, must BOTH still be
    // reapable — the old single-slot registry would have silently discarded the
    // first generation's record the moment the second was written.
    const pidA = spawnSleeper();
    const pidB = spawnSleeper();
    recordOwnedDevServer({ ...makeRecord(pidA), command: 'sleep 30' }, baseDir);
    recordOwnedDevServer({ ...makeRecord(pidB), command: 'sleep 30' }, baseDir);
    expect(readOwnedDevServers('/proj/a', baseDir).map((r) => r.pid)).toEqual([pidA, pidB]);

    const reaped = reapStaleOwnedDevServer('/proj/a', killGroup, { baseDir });

    expect(reaped?.slice().sort((a, b) => a - b)).toEqual([pidA, pidB].sort((a, b) => a - b));
    expect(await waitForDeath(pidA)).toBe(true);
    expect(await waitForDeath(pidB)).toBe(true);
    expect(readOwnedDevServers('/proj/a', baseDir)).toEqual([]);
  });

  it('returns null and does NOT call killGroup when there is no record', () => {
    let called = false;
    const reaped = reapStaleOwnedDevServer(
      '/proj/none',
      () => {
        called = true;
      },
      { baseDir },
    );
    expect(reaped).toBeNull();
    expect(called).toBe(false);
  });

  it('does not call killGroup for a stale (already-dead) recorded pid, and clears the record', async () => {
    const pid = spawnSleeper();
    killGroup(pid);
    await waitForDeath(pid);
    recordOwnedDevServer(makeRecord(pid), baseDir);

    let called = false;
    const reaped = reapStaleOwnedDevServer(
      '/proj/a',
      () => {
        called = true;
      },
      { baseDir },
    );

    expect(reaped).toBeNull();
    expect(called).toBe(false);
    expect(readOwnedDevServer('/proj/a', baseDir)).toBeNull(); // stale record swept
  });

  it('does not reap a process recorded under a DIFFERENT project (no cross-project kill)', async () => {
    const pid = spawnSleeper();
    recordOwnedDevServer(makeRecord(pid, '/proj/a'), baseDir);

    // Start for a different project — must not touch /proj/a's process.
    const reaped = reapStaleOwnedDevServer('/proj/b', killGroup, { baseDir });
    expect(reaped).toBeNull();
    expect(isProcessAlive(pid)).toBe(true); // survivor — not ours to kill
  });

  it('does NOT kill a reused pid whose live command no longer matches the record, but clears the record', async () => {
    // Simulate PID reuse: our recorded dev server exited and the OS handed its pid
    // to an unrelated `sleep`. The record says we ran a bun dev server, but the live
    // process at that pid is `sleep 30` — the `ps` recheck must suppress the kill.
    const pid = spawnSleeper();
    recordOwnedDevServer({ ...makeRecord(pid), command: 'bun --hot src/index.ts' }, baseDir);

    let killed = false;
    const reaped = reapStaleOwnedDevServer(
      '/proj/a',
      () => {
        killed = true;
      },
      { baseDir },
    );

    expect(reaped).toBeNull();
    expect(killed).toBe(false); // never asked to kill the stranger
    expect(isProcessAlive(pid)).toBe(true); // the reused-pid process survives
    expect(readOwnedDevServer('/proj/a', baseDir)).toBeNull(); // stale record swept
  });

  it('DOES kill when the live command still matches the recorded dev tool', async () => {
    // The recorded process is genuinely still alive: record.command and the live
    // `ps` line both contain "node", so the recheck returns true → kill proceeds.
    const pid = spawnNode();
    recordOwnedDevServer({ ...makeRecord(pid), command: 'node -e setTimeout' }, baseDir);

    const reaped = reapStaleOwnedDevServer('/proj/a', killGroup, { baseDir });

    expect(reaped).toEqual([pid]);
    expect(await waitForDeath(pid)).toBe(true);
    expect(readOwnedDevServer('/proj/a', baseDir)).toBeNull();
  });

  it('never throws even if killGroup itself throws (best-effort start guard)', () => {
    const pid = spawnSleeper();
    // Align the record with the spawned tool so the recheck passes and killGroup is
    // actually reached — otherwise the throwing killGroup would never be invoked and
    // the test would pass vacuously.
    recordOwnedDevServer({ ...makeRecord(pid), command: 'sleep 30' }, baseDir);
    expect(() =>
      reapStaleOwnedDevServer(
        '/proj/a',
        () => {
          throw new Error('kill failed');
        },
        { baseDir },
      ),
    ).not.toThrow();
  });
});

describe('findLiveOwnedDevServer (attach-first identity proof, HYP-1160)', () => {
  it('returns a live recorded server whose live command line matches the record', () => {
    // A real `node` process matches a recorded "node …" command through the
    // real `ps` identity check — the same ladder the reaper trusts before killing.
    const pid = spawnNode();
    recordOwnedDevServer({ ...makeRecord(pid), command: 'node scripts/dev.js' }, baseDir);

    const found = findLiveOwnedDevServer('/proj/a', baseDir);
    expect(found?.pid).toBe(pid);
  });

  it('returns the newest live record when several generations are recorded', () => {
    const pidA = spawnNode();
    const pidB = spawnNode();
    recordOwnedDevServer({ ...makeRecord(pidA), command: 'node scripts/dev.js' }, baseDir);
    recordOwnedDevServer({ ...makeRecord(pidB), command: 'node scripts/dev.js' }, baseDir);

    const found = findLiveOwnedDevServer('/proj/a', baseDir);
    expect(found?.pid).toBe(pidB);
  });

  it('returns null when no record exists for the project', () => {
    expect(findLiveOwnedDevServer('/proj/a', baseDir)).toBeNull();
  });

  it('returns null when the recorded pid is dead (a stranger holding the port proves nothing)', async () => {
    const pid = spawnNode();
    recordOwnedDevServer({ ...makeRecord(pid), command: 'node scripts/dev.js' }, baseDir);
    killGroup(pid);
    expect(await waitForDeath(pid)).toBe(true);
    // Group too must be gone — a dead leader with a live group is still "live".
    expect(await waitForGroupDeath(pid)).toBe(true);

    expect(findLiveOwnedDevServer('/proj/a', baseDir)).toBeNull();
  });

  it('returns null on a POSITIVE identity mismatch (pid likely reused by an unrelated process)', () => {
    // A plain `sleep` cannot match the recorded dev-tool command — the same
    // positive-mismatch signal that suppresses the reaper's kill must also
    // suppress an attach.
    const pid = spawnSleeper();
    recordOwnedDevServer({ ...makeRecord(pid), command: 'bun run dev' }, baseDir);

    expect(findLiveOwnedDevServer('/proj/a', baseDir)).toBeNull();
    expect(isProcessAlive(pid)).toBe(true); // record left for the reaper, not pruned
  });

  it('never throws on a corrupt record file (best-effort, same contract as the reaper)', () => {
    // codeql[js/insecure-temporary-file] -- test fixture: orphanRecordPath is given the mkdtemp-isolated baseDir here, so the file lands in an unpredictable per-test dir, not the shared tmp root
    writeFileSync(orphanRecordPath('/proj/a', baseDir), 'not json{', 'utf8');
    expect(() => findLiveOwnedDevServer('/proj/a', baseDir)).not.toThrow();
    expect(findLiveOwnedDevServer('/proj/a', baseDir)).toBeNull();
  });
});
