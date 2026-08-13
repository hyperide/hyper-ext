import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import {
  clearOwnedDevServer,
  isProcessAlive,
  liveProcessLooksLikeRecord,
  type OwnedDevServerRecord,
  orphanRecordPath,
  readOwnedDevServer,
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

  it('writes valid JSON with the documented shape', () => {
    const record = makeRecord(222);
    recordOwnedDevServer(record, baseDir);
    const onDisk = JSON.parse(readFileSync(orphanRecordPath(record.projectPath, baseDir), 'utf8'));
    expect(onDisk).toEqual({ pid: 222, projectPath: '/proj/a', command: 'bun run dev', startedAt: record.startedAt });
  });

  it('clear deletes the record file', () => {
    const record = makeRecord(333);
    recordOwnedDevServer(record, baseDir);
    clearOwnedDevServer(record.projectPath, baseDir);
    expect(existsSync(orphanRecordPath(record.projectPath, baseDir))).toBe(false);
    expect(readOwnedDevServer(record.projectPath, baseDir)).toBeNull();
  });

  it('clear is a no-op (no throw) when no record exists', () => {
    expect(() => clearOwnedDevServer('/never/recorded', baseDir)).not.toThrow();
  });

  it('returns null for a record whose projectPath does not match the key', () => {
    // Tamper: a record file whose stored projectPath differs from the lookup key
    // (defensive against hash collision / manual corruption). Write under /proj/a's
    // path but with a mismatched body.
    recordOwnedDevServer({ ...makeRecord(444), projectPath: '/proj/OTHER' }, baseDir);
    // Reading under the body's own key works; reading under a different key is null.
    expect(readOwnedDevServer('/proj/OTHER', baseDir)?.pid).toBe(444);
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

    expect(reaped).toBe(pid);
    expect(await waitForDeath(pid)).toBe(true);
    // Record removed so a later start does not re-target a dead/recycled pid.
    expect(readOwnedDevServer('/proj/a', baseDir)).toBeNull();
    expect(logs.some((m) => m.includes(String(pid)))).toBe(true);
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

    expect(reaped).toBe(pid);
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
