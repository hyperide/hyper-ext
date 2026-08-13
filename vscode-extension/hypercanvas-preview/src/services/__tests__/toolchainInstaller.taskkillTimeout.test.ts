import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

/**
 * HYP-1188 follow-up: `killProcessTree`'s default win32 kill (`defaultSpawnSyncTreeKill`)
 * must bound its `spawnSync('taskkill', ...)` call
 * with a `timeout` + `killSignal`, or a stalled `taskkill.exe` freezes the whole extension
 * host (single JS thread) until the user force-quits VS Code.
 *
 * This lives in its own file (not `toolchainInstaller.test.ts`) because verifying it
 * requires mocking `node:child_process`'s real `spawnSync` — `toolchainInstaller.test.ts`
 * already statically imports the module under test, which binds the real `spawnSync`
 * before any in-file `mock.module` call could take effect. `FileStructureStore.test.ts`
 * uses the same mock-then-dynamic-import shape for the same reason.
 */

const spawnSyncCalls: Array<{ command: string; args: readonly string[]; options: Record<string, unknown> }> = [];

mock.module('node:child_process', () => ({
  spawn: () => {
    throw new Error('not used by this test — only spawnSync is exercised');
  },
  spawnSync: (command: string, args: readonly string[], options: Record<string, unknown>) => {
    spawnSyncCalls.push({ command, args, options });
    return { status: 0, signal: null, error: undefined };
  },
}));

const { killProcessTree } = await import('../toolchainInstaller');
type StepChildProcess = Parameters<typeof killProcessTree>[0];

function hangingChild(pid: number, kill: (signal?: NodeJS.Signals) => void): StepChildProcess {
  return { stdout: new EventEmitter(), stderr: new EventEmitter(), pid, on: () => {}, kill } as StepChildProcess;
}

describe('killProcessTree default win32 kill: bounded spawnSync (HYP-1188 follow-up)', () => {
  it('passes a positive, bounded timeout and a forceful killSignal to spawnSync', () => {
    spawnSyncCalls.length = 0;
    const kill = mock(() => {});
    // No third arg — exercises the real `defaultSpawnSyncTreeKill`, not a test fake.
    killProcessTree(hangingChild(4321, kill), 'win32');

    expect(spawnSyncCalls).toHaveLength(1);
    const [call] = spawnSyncCalls;
    expect(call.command).toBe('taskkill');
    expect(call.args).toEqual(['/pid', '4321', '/t', '/f']);
    expect(call.options.stdio).toBe('ignore');
    // Bounded: must not be left unset (undefined = spawnSync blocks forever on a stall).
    expect(typeof call.options.timeout).toBe('number');
    expect(call.options.timeout as number).toBeGreaterThan(0);
    // Generous upper bound — this pins "bounded at all", not the exact chosen constant.
    expect(call.options.timeout as number).toBeLessThanOrEqual(30_000);
    expect(call.options.killSignal).toBe('SIGKILL');
  });
});
