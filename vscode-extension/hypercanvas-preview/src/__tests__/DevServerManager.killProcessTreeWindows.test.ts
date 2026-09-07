import { describe, expect, it, mock } from 'bun:test';
import { EventEmitter } from 'node:events';

// PreviewProxy reads iframe-*.js via fs.readFileSync AT IMPORT TIME (built next to the
// bundle, absent in src/) — same stub as DevServerManager.toolchain.test.ts. Capture the
// ORIGINAL first (bun mutates the namespace in place).
const realFs = await import('node:fs');
const origReadFileSync = realFs.readFileSync;
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return origReadFileSync(file as string, enc as never);
  },
}));

/**
 * HYP-1340 review finding: `DevServerManager._killProcessTree`'s Windows branch used to
 * call only `proc.kill(signal)`, which reaches the direct child (e.g. the `cmd.exe`
 * `shell:true` spawns) and leaves whatever it forked — a wedged Playwright
 * download/extract helper still holding the cache's `__dirlock` — alive as an orphan.
 * On SIGKILL (the force-kill sent only after a graceful SIGTERM's timeout window has
 * already passed) it now delegates to `killProcessTree` from toolchainInstaller.ts,
 * which already runs the bounded `taskkill /pid <pid> /t /f` tree-kill for the identical
 * problem on the other install path (see toolchainInstaller.taskkillTimeout.test.ts).
 *
 * SIGTERM — the graceful attempt tried FIRST on every Windows stop, well before any
 * timeout — deliberately stays a plain, instant `proc.kill`: routing it through a
 * synchronous `spawnSync('taskkill', …)` would block the extension host's single JS
 * thread on every ordinary stop, not just the wedged case this exists to fix
 * (perf regression caught in review round 2).
 *
 * Lives in its own file (not DevServerManager.toolchain.test.ts) for the same reason as
 * toolchainInstaller.taskkillTimeout.test.ts: verifying it requires mocking
 * `node:child_process`'s real `spawnSync` before the module under test links, and
 * DevServerManager.toolchain.test.ts already statically pulls in the real
 * `node:child_process` for its own spawn stubs.
 */

const spawnSyncCalls: Array<{ command: string; args: readonly string[] }> = [];

mock.module('node:child_process', () => ({
  spawn: () => {
    throw new Error('not used by this test — only spawnSync is exercised');
  },
  spawnSync: (command: string, args: readonly string[]) => {
    spawnSyncCalls.push({ command, args });
    return { status: 0, signal: null, error: undefined };
  },
}));

const { DevServerManager } = await import('../services/DevServerManager');

/** The slice of DevServerManager's prototype this test reaches into. */
interface HasKillProcessTree {
  _killProcessTree(proc: unknown, signal: NodeJS.Signals): void;
}

function withWin32<T>(fn: () => T): T {
  const originalPlatform = process.platform;
  Object.defineProperty(process, 'platform', { value: 'win32' });
  try {
    return fn();
  } finally {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  }
}

function fakeChildProcess(pid: number, kill: (signal?: NodeJS.Signals) => void) {
  return { stdout: new EventEmitter(), stderr: new EventEmitter(), pid, on: () => {}, kill };
}

describe('_killProcessTree on win32', () => {
  it('SIGKILL runs taskkill /t /f instead of a bare proc.kill on the tracked pid alone', () => {
    spawnSyncCalls.length = 0;
    withWin32(() => {
      const kill = mock(() => {});
      const fakeChild = fakeChildProcess(4321, kill);
      // The win32 branch under test doesn't touch `this`, so calling it directly off
      // the prototype (no full instance/constructor wiring) is enough to exercise it.
      const proto = DevServerManager.prototype as unknown as HasKillProcessTree;
      proto._killProcessTree.call({}, fakeChild, 'SIGKILL');

      expect(spawnSyncCalls).toHaveLength(1);
      expect(spawnSyncCalls[0].command).toBe('taskkill');
      expect(spawnSyncCalls[0].args).toEqual(['/pid', '4321', '/t', '/f']);
    });
  });

  // The graceful SIGTERM attempt runs on EVERY Windows stop, well before any timeout —
  // it must stay a plain, instant proc.kill. Routing it through the same synchronous
  // taskkill round trip as SIGKILL would block the extension host's single JS thread
  // on every ordinary stop, not just the wedged case the tree-kill exists to fix.
  it('SIGTERM stays a plain proc.kill — no synchronous taskkill on the routine graceful path', () => {
    spawnSyncCalls.length = 0;
    withWin32(() => {
      const kill = mock(() => {});
      const fakeChild = fakeChildProcess(4321, kill);
      const proto = DevServerManager.prototype as unknown as HasKillProcessTree;
      proto._killProcessTree.call({}, fakeChild, 'SIGTERM');

      expect(spawnSyncCalls).toHaveLength(0);
      expect(kill).toHaveBeenCalledWith('SIGTERM');
    });
  });
});
