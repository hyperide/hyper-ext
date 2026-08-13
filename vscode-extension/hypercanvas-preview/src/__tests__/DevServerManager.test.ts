import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { DevServerStatus } from '../types';

/**
 * DevServerManager test — focuses on log parsing, state machine,
 * and callback wiring. Does NOT test actual process spawning.
 *
 * Do NOT mock ProjectDetector — it loads fine without mocks and
 * a global mock would break ProjectDetector's own tests
 * (bun mock.module is global, not scoped per file).
 *
 * PreviewProxy reads iframe-*.js via fs.readFileSync AT IMPORT TIME, and those
 * files only exist next to the bundled output, not in src/. Previously this file
 * globally mock.module'd '../services/PreviewProxy' with a stub class — but that
 * mock is process-global and IRREVERSIBLE (bun's mock.restore does not undo
 * module mocks), so under a non-isolated run it leaked into
 * PreviewProxy.serving.test.ts, whose assertions need the REAL proxy (the stub
 * lacks setIsServing) — 3 spurious failures (HYP-579). The tests here never
 * instantiate PreviewProxy anyway; every case that needs a proxy injects its own
 * local `{ stop: mock() }` via Object.assign(manager, { _previewProxy }). So we
 * only need the import to succeed: stub readFileSync for iframe-* (spreading real
 * fs so every other read is untouched — AGENTS.md global-mock rule), exactly like
 * PreviewProxy.serving.test.ts does. The real module then imports cleanly and
 * nothing leaks.
 */
const realFs = await import('node:fs');
mock.module('node:fs', () => ({
  ...realFs,
  default: realFs,
  readFileSync: (file: string, enc?: unknown) => {
    if (typeof file === 'string' && file.includes('iframe-')) return '/* stub */';
    return realFs.readFileSync(file as string, enc as never);
  },
}));
const {
  appendScriptCliArgs,
  buildInstallCommand,
  devScriptDeclaresPort,
  devScriptUsesWrapper,
  DevServerManager,
  portInjectionArgs,
  shouldRepairDependencies,
} = await import('../services/DevServerManager');

describe('devScriptDeclaresPort', () => {
  it('detects a CLI --port / -p flag (the only reliable pin)', () => {
    expect(devScriptDeclaresPort('vite dev --port 3000')).toBe(true);
    expect(devScriptDeclaresPort('vite dev --port=3000')).toBe(true);
    expect(devScriptDeclaresPort('next dev -p 4000')).toBe(true);
    expect(devScriptDeclaresPort('next dev -p=4000')).toBe(true);
  });

  it('does NOT treat env-var port declarations as a pin (Vite ignores them; inline env overrides ours)', () => {
    expect(devScriptDeclaresPort('PORT=3000 vite')).toBe(false);
    expect(devScriptDeclaresPort('VITE_PORT=5180 vite')).toBe(false);
    expect(devScriptDeclaresPort('cross-env PORT=3001 react-scripts start')).toBe(false);
  });

  it('returns false when the script leaves the port to us', () => {
    expect(devScriptDeclaresPort('vite dev')).toBe(false);
    expect(devScriptDeclaresPort('next dev')).toBe(false);
    expect(devScriptDeclaresPort('remix vite:dev')).toBe(false);
    expect(devScriptDeclaresPort('')).toBe(false);
    // Must not false-positive on unrelated flags or substrings.
    expect(devScriptDeclaresPort('vite dev --open --host')).toBe(false);
    expect(devScriptDeclaresPort('node --import tsx server.ts')).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // ADVERSARIAL (HYP-462 audit): probe the regex for the false-positives /
  // false-negatives named in the audit brief. The blast radius is small — a
  // false positive only means we skip injecting --port and rely on stdout
  // port-detection (_maybeUpdatePortFromOutput) instead, which usually self-heals.
  // These are documented as expectations of the CURRENT behaviour, not bugs.
  describe('adversarial edge cases', () => {
    it('does not match flags that merely START with -p (--public, --print)', () => {
      // `-p` branch requires (^|\s)-p, so the leading `--` of --public/--print blocks it.
      expect(devScriptDeclaresPort('vite --public 3000')).toBe(false);
      expect(devScriptDeclaresPort('tsx --print 3')).toBe(false);
    });

    it('does not match --port with no following number', () => {
      expect(devScriptDeclaresPort('vite dev --port')).toBe(false);
      expect(devScriptDeclaresPort('vite dev --port --host')).toBe(false);
      expect(devScriptDeclaresPort('vite dev --port=')).toBe(false);
    });

    it('does not match -p used as a non-port flag (project/path) with a non-digit value', () => {
      // tsc -p tsconfig.json, tsx watch -p ./dir — value is not a digit, so no match.
      expect(devScriptDeclaresPort('tsc -p tsconfig.json')).toBe(false);
      expect(devScriptDeclaresPort('tsx watch -p ./src')).toBe(false);
    });

    it('does not match a flag whose name merely embeds "port"', () => {
      // --port-prefix / --portal would only match if followed directly by [=\s]+\d.
      expect(devScriptDeclaresPort('my-cli --port-prefix 80')).toBe(false);
      expect(devScriptDeclaresPort('my-cli --portal 3000')).toBe(false);
    });

    // KNOWN/ACCEPTED false positives — documenting that they DO trigger a skip.
    // Not worth fixing (would require shell parsing); blast radius is benign
    // because stdout port-detection recovers the real bound port.
    it('FALSE POSITIVE (accepted): --port belonging to a co-process under concurrently', () => {
      // The --port here belongs to a sidecar proxy, not the dev server, but the
      // regex cannot tell. We skip injection; stdout detection saves us.
      expect(devScriptDeclaresPort('concurrently "vite" "node proxy.js --port 9000"')).toBe(true);
    });

    it('FALSE POSITIVE (accepted): --port inside a quoted, unrelated value', () => {
      expect(devScriptDeclaresPort('vite dev --config "server --port 3000"')).toBe(true);
    });

    it('matches -p directly after a shell separator (&&, ;)', () => {
      // (^|\s) only allows start-of-string or whitespace before -p, so a -p glued
      // to a separator without a space is NOT matched. Documenting the boundary.
      expect(devScriptDeclaresPort('build && next -p 4000')).toBe(true); // space before -p
      expect(devScriptDeclaresPort('build &&next -p 4000')).toBe(true); // still has space before -p
    });
  });
});

describe('devScriptUsesWrapper', () => {
  // HYP-547: monorepo task runners (nx, turbo, pnpm -r, …) wrap the real dev
  // process. A `--port` appended to `bun run dev` reaches the WRAPPER (nx/bun),
  // not the underlying vite/next/astro, so it never binds the port we asked for.
  // Detecting the wrapper lets start() skip the blind injection and fall back to
  // stdout port auto-detection (_maybeUpdatePortFromOutput), which works because
  // vite still prints `http://localhost:PORT`.
  it('detects nx task-runner wrappers', () => {
    expect(devScriptUsesWrapper('nx run conloca-website:dev --outputStyle=stream')).toBe(true);
    expect(devScriptUsesWrapper('nx run @conloca/conloca-app:dev')).toBe(true);
    expect(devScriptUsesWrapper('nx run-many --target=dev')).toBe(true);
    expect(devScriptUsesWrapper('nx dev my-app')).toBe(true);
  });

  it('detects turbo wrappers', () => {
    expect(devScriptUsesWrapper('turbo run dev')).toBe(true);
    expect(devScriptUsesWrapper('turbo dev --filter=web')).toBe(true);
  });

  it('detects pnpm recursive / filtered wrappers', () => {
    expect(devScriptUsesWrapper('pnpm -r dev')).toBe(true);
    expect(devScriptUsesWrapper('pnpm --recursive run dev')).toBe(true);
    expect(devScriptUsesWrapper('pnpm --filter web dev')).toBe(true);
  });

  it('detects yarn workspace wrappers', () => {
    expect(devScriptUsesWrapper('yarn workspace web dev')).toBe(true);
    expect(devScriptUsesWrapper('yarn workspaces foreach run dev')).toBe(true);
  });

  it('detects lerna and npm-run-all wrappers', () => {
    expect(devScriptUsesWrapper('lerna run dev')).toBe(true);
    expect(devScriptUsesWrapper('npm-run-all -p dev:*')).toBe(true);
    expect(devScriptUsesWrapper('run-p dev:client dev:server')).toBe(true);
    expect(devScriptUsesWrapper('run-s build dev')).toBe(true);
  });

  it('returns false for direct dev-server invocations', () => {
    expect(devScriptUsesWrapper('vite dev')).toBe(false);
    expect(devScriptUsesWrapper('vite')).toBe(false);
    expect(devScriptUsesWrapper('next dev')).toBe(false);
    expect(devScriptUsesWrapper('remix vite:dev')).toBe(false);
    expect(devScriptUsesWrapper('astro dev')).toBe(false);
    expect(devScriptUsesWrapper('react-scripts start')).toBe(false);
    expect(devScriptUsesWrapper('')).toBe(false);
    // Must not false-positive on substrings: a component named "turbofan",
    // a flag --next, a path containing nx, etc.
    expect(devScriptUsesWrapper('vite dev --turbofan')).toBe(false);
    expect(devScriptUsesWrapper('node ./scripts/lernaesque.js')).toBe(false);
  });
});

describe('portInjectionArgs', () => {
  // HYP-547: the actual decision start() makes. Tested as a pure function so the
  // wiring (not just the predicate) is covered without spawning a process.
  it('injects --port for direct vite', () => {
    expect(portInjectionArgs('vite', 'vite dev', 5173)).toEqual(['--port', '5173']);
  });

  it('injects --port for direct remix', () => {
    expect(portInjectionArgs('remix', 'remix vite:dev', 5173)).toEqual(['--port', '5173']);
  });

  it('injects -p for direct nextjs', () => {
    expect(portInjectionArgs('nextjs', 'next dev', 3000)).toEqual(['-p', '3000']);
  });

  it('injects --port for direct webpack', () => {
    expect(portInjectionArgs('webpack', 'webpack serve', 3000)).toEqual(['--port', '3000']);
  });

  it('injects nothing for cra (reads PORT env var)', () => {
    expect(portInjectionArgs('cra', 'react-scripts start', 3000)).toEqual([]);
  });

  it('injects nothing for bun type', () => {
    expect(portInjectionArgs('bun', 'bun run server.ts', 3000)).toEqual([]);
  });

  it('skips injection when the script already declares its own port', () => {
    expect(portInjectionArgs('vite', 'vite dev --port 4000', 5173)).toEqual([]);
    expect(portInjectionArgs('nextjs', 'next dev -p 4001', 3000)).toEqual([]);
  });

  it('skips injection for an nx-wrapped vite dev script (the HYP-547 bug)', () => {
    // Without the wrapper guard this returned ['--port','5173'], which got
    // appended after `bun run dev` and clobbered onto nx instead of vite.
    expect(portInjectionArgs('vite', 'nx run conloca-website:dev --outputStyle=stream', 5173)).toEqual([]);
  });

  it('skips injection for a turbo-wrapped nextjs dev script', () => {
    expect(portInjectionArgs('nextjs', 'turbo run dev --filter=web', 3000)).toEqual([]);
  });
});

describe('DevServerManager', () => {
  let manager: InstanceType<typeof DevServerManager>;

  beforeEach(() => {
    manager = new DevServerManager('/test-project');
  });

  describe('initial state', () => {
    it('starts with stopped status', () => {
      const state = manager.getState();
      expect(state.status).toBe('stopped');
      expect(state.port).toBeUndefined();
      expect(state.url).toBeUndefined();
    });

    it('has empty logs', () => {
      expect(manager.getLogs()).toEqual([]);
      expect(manager.hasErrors).toBe(false);
    });

    it('has no runtime error', () => {
      expect(manager.runtimeError).toBeNull();
    });
  });

  describe('callbacks', () => {
    it('onStatusChange fires on status updates', async () => {
      const cb = mock();
      manager.onStatusChange(cb);

      // Trigger via stop() which calls _updateStatus('stopped')
      await manager.stop();
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
    });

    it('onRuntimeErrorChange fires on setRuntimeError', () => {
      const cb = mock();
      manager.onRuntimeErrorChange(cb);

      const err = { message: 'Cannot read property', stack: 'at App.tsx:10' };
      manager.setRuntimeError(err as never);
      expect(cb).toHaveBeenCalledWith(err);
      expect(manager.runtimeError).toEqual(err);

      manager.setRuntimeError(null);
      expect(cb).toHaveBeenCalledWith(null);
      expect(manager.runtimeError).toBeNull();
    });
  });

  describe('stop', () => {
    it('stops the preview proxy before terminating the dev server process', async () => {
      const events: string[] = [];
      const proxy = {
        stop: mock(() => {
          events.push('proxy.stop');
        }),
      };
      const proc = {
        killed: false,
        kill: mock((signal: string) => {
          events.push(`process.kill:${signal}`);
          proc.killed = true;
          return true;
        }),
        once: mock((event: string, callback: () => void) => {
          expect(event).toBe('exit');
          queueMicrotask(callback);
          return proc;
        }),
      };

      Object.assign(manager, {
        _previewProxy: proxy,
        _process: proc,
        _port: 5173,
      });

      await manager.stop();

      expect(events).toEqual(['proxy.stop', 'process.kill:SIGTERM']);
    });

    it('does not let an old stop clear a replacement process', async () => {
      let resolveOldExit: (() => void) | null = null;
      const oldProxy = { stop: mock() };
      const oldProc = {
        killed: false,
        kill: mock(() => {
          oldProc.killed = true;
          return true;
        }),
        once: mock((_event: string, callback: () => void) => {
          resolveOldExit = callback;
          return oldProc;
        }),
      };
      Object.assign(manager, {
        _previewProxy: oldProxy,
        _process: oldProc,
        _port: 5173,
      });

      const stopPromise = manager.stop();
      await Promise.resolve();

      const replacementProxy = { stop: mock() };
      const replacementProc = {
        killed: false,
        kill: mock(() => true),
        once: mock(() => replacementProc),
      };
      Object.assign(manager, {
        _previewProxy: replacementProxy,
        _process: replacementProc,
        _port: 5174,
      });

      resolveOldExit?.();
      await stopPromise;

      expect(oldProxy.stop).toHaveBeenCalled();
      expect(replacementProxy.stop).not.toHaveBeenCalled();
      expect((manager as unknown as { _process: unknown })._process).toBe(replacementProc);
      expect((manager as unknown as { _port: number })._port).toBe(5174);
    });
  });

  describe('setProjectPath', () => {
    it('stops the old server and clears project-scoped state', async () => {
      const proxy = { stop: mock() };
      const proc = {
        killed: false,
        kill: mock(() => {
          proc.killed = true;
          return true;
        }),
        once: mock((_event: string, callback: () => void) => {
          queueMicrotask(callback);
          return proc;
        }),
      };
      Object.assign(manager, {
        _previewProxy: proxy,
        _process: proc,
        _port: 5173,
      });
      manager.setRuntimeError({ message: 'old error' } as never);
      (manager as unknown as { _appendLog(text: string): void })._appendLog('old log\n');

      await manager.setProjectPath('/next-project');

      expect(proc.kill).toHaveBeenCalledWith('SIGTERM');
      expect(proxy.stop).toHaveBeenCalled();
      expect(manager.runtimeError).toBeNull();
      expect(manager.getLogs()).toEqual([]);
      expect((manager as unknown as { _projectPath: string })._projectPath).toBe('/next-project');
    });

    // HYP-420: an explicitly pinned sub-project path must survive start()'s
    // _syncProjectPathWithWorkspace, which would otherwise reset it to the VS Code
    // workspace folder (the monorepo root, which has no runnable dev script).
    it('pins the path so _syncProjectPathWithWorkspace does not reset it', async () => {
      await manager.setProjectPath('/repo/targets/conloca-app');
      expect((manager as unknown as { _projectPathPinned: boolean })._projectPathPinned).toBe(true);

      await (manager as unknown as { _syncProjectPathWithWorkspace(): Promise<void> })._syncProjectPathWithWorkspace();

      expect((manager as unknown as { _projectPath: string })._projectPath).toBe('/repo/targets/conloca-app');
    });
  });

  describe('clearLogs', () => {
    it('clears log buffer and resets error flag', () => {
      // We need to access _appendLog indirectly. Use the callback to verify.
      const logCb = mock();
      manager.onLogsUpdate(logCb);

      manager.clearLogs();
      expect(manager.getLogs()).toEqual([]);
      expect(manager.hasErrors).toBe(false);
      expect(logCb).toHaveBeenCalledWith([], false);
    });
  });

  describe('log parsing via _appendLog', () => {
    // _appendLog is private, but we can test it through the start() flow
    // or by accessing it via prototype. For unit testing, we'll use
    // the prototype trick since we can't easily mock spawn.

    function appendLog(mgr: InstanceType<typeof DevServerManager>, text: string) {
      // Access private method for testing
      (mgr as unknown as { _appendLog(text: string): void })._appendLog(text);
    }

    it('splits text into lines and creates log entries', () => {
      appendLog(manager, 'line1\nline2\n');
      const logs = manager.getLogs();
      expect(logs).toHaveLength(2);
      expect(logs[0].line).toBe('line1');
      expect(logs[1].line).toBe('line2');
    });

    it('detects error patterns', () => {
      const errorCb = mock();
      manager.onError(errorCb);

      appendLog(manager, 'error TS2345: Argument of type...\n');
      expect(manager.hasErrors).toBe(true);
      expect(manager.getLogs()[0].isError).toBe(true);
      expect(errorCb).toHaveBeenCalled();
    });

    it('resets hasErrors on success pattern', () => {
      appendLog(manager, 'error TS2345: something\n');
      expect(manager.hasErrors).toBe(true);

      appendLog(manager, 'compiled successfully\n');
      expect(manager.hasErrors).toBe(false);
    });

    it('trims log buffer to MAX_LOG_ENTRIES', () => {
      // Append 250 lines (MAX_LOG_ENTRIES = 200)
      const lines = `${Array.from({ length: 250 }, (_, i) => `line-${i}`).join('\n')}\n`;
      appendLog(manager, lines);
      expect(manager.getLogs().length).toBeLessThanOrEqual(200);
    });

    it('notifies onLogsUpdate callback', () => {
      const logCb = mock();
      manager.onLogsUpdate(logCb);

      appendLog(manager, 'hello\n');
      expect(logCb).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ line: 'hello' })]), false);
    });
  });

  describe('_buildCommand', () => {
    function buildCommand(mgr: InstanceType<typeof DevServerManager>, pm: string, script: string) {
      return (
        mgr as unknown as { _buildCommand(pm: string, script: string): { cmd: string; args: string[] } }
      )._buildCommand(pm, script);
    }

    function buildCommandWithScriptArgs(pm: 'npm' | 'yarn' | 'pnpm' | 'bun', args: string[]) {
      const command = buildCommand(manager, pm, 'dev');
      appendScriptCliArgs(command, pm, args);
      return command;
    }

    it('builds npm command', () => {
      expect(buildCommand(manager, 'npm', 'dev')).toEqual({ cmd: 'npm', args: ['run', 'dev'] });
    });

    it('builds bun command', () => {
      expect(buildCommand(manager, 'bun', 'dev')).toEqual({ cmd: 'bun', args: ['run', 'dev'] });
    });

    it('builds pnpm command', () => {
      expect(buildCommand(manager, 'pnpm', 'dev')).toEqual({ cmd: 'pnpm', args: ['run', 'dev'] });
    });

    it('builds yarn command (no run)', () => {
      expect(buildCommand(manager, 'yarn', 'dev')).toEqual({ cmd: 'yarn', args: ['dev'] });
    });

    it('uses npm argument separator for script CLI args', () => {
      expect(buildCommandWithScriptArgs('npm', ['--port', '5173'])).toEqual({
        cmd: 'npm',
        args: ['run', 'dev', '--', '--port', '5173'],
      });
    });

    it('passes pnpm script CLI args without a literal separator', () => {
      expect(buildCommandWithScriptArgs('pnpm', ['--port', '5173'])).toEqual({
        cmd: 'pnpm',
        args: ['run', 'dev', '--port', '5173'],
      });
    });

    it('passes yarn script CLI args without a literal separator', () => {
      expect(buildCommandWithScriptArgs('yarn', ['--port', '5173'])).toEqual({
        cmd: 'yarn',
        args: ['dev', '--port', '5173'],
      });
    });

    it('passes bun script CLI args without a literal separator', () => {
      expect(buildCommandWithScriptArgs('bun', ['--port', '5173'])).toEqual({
        cmd: 'bun',
        args: ['run', 'dev', '--port', '5173'],
      });
    });
  });

  describe('dependency repair detection', () => {
    it('detects missing rolldown optional native binding crashes', () => {
      expect(shouldRepairDependencies("Cannot find module '@rolldown/binding-darwin-arm64'", [])).toBe(true);
    });

    it('does not repair ordinary syntax errors', () => {
      expect(shouldRepairDependencies('Unexpected token in client/pages/Index.tsx', [])).toBe(false);
    });

    it('builds package-manager install commands for dependency repair', () => {
      expect(buildInstallCommand('pnpm')).toEqual({ cmd: 'pnpm', args: ['install', '--force'] });
      expect(buildInstallCommand('npm')).toEqual({ cmd: 'npm', args: ['install'] });
      expect(buildInstallCommand('yarn')).toEqual({ cmd: 'yarn', args: ['install'] });
      expect(buildInstallCommand('bun')).toEqual({ cmd: 'bun', args: ['install'] });
    });
  });

  describe('dispose', () => {
    it('does not throw when called on fresh instance', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });

  describe('recompile gate', () => {
    function appendLog(mgr: InstanceType<typeof DevServerManager>, text: string) {
      (mgr as unknown as { _appendLog(text: string): void })._appendLog(text);
    }

    function fireRecompileDetector(mgr: InstanceType<typeof DevServerManager>, text: string) {
      // Mirrors the path in the stdout/stderr handlers — they call
      // _maybeResolveRecompileGate(clean) on every chunk.
      (mgr as unknown as { _maybeResolveRecompileGate(text: string): void })._maybeResolveRecompileGate(text);
    }

    it('awaitRecompile is a no-op when no gate is armed', async () => {
      // Should resolve immediately
      await manager.awaitRecompile();
    });

    it('arm gate → fire compiled successfully → ready resolves', async () => {
      manager.armRecompileGate();

      let resolved = false;
      const wait = manager.awaitRecompile().then(() => {
        resolved = true;
      });

      // Microtask flush: gate is armed, awaiter must NOT be resolved yet
      await Promise.resolve();
      expect(resolved).toBe(false);

      fireRecompileDetector(manager, 'webpack 5.89.0 compiled successfully in 412 ms\n');
      await wait;
      expect(resolved).toBe(true);
    });

    it('ignores chunks without `compiled successfully`', async () => {
      manager.armRecompileGate();

      let resolved = false;
      const wait = manager.awaitRecompile().then(() => {
        resolved = true;
      });

      fireRecompileDetector(manager, 'wait until bundle finished\n');
      await Promise.resolve();
      expect(resolved).toBe(false);

      fireRecompileDetector(manager, 'compiled successfully\n');
      await wait;
      expect(resolved).toBe(true);
    });

    it('re-arming releases the previous gate so old awaiters do not deadlock', async () => {
      manager.armRecompileGate();
      const firstWait = manager.awaitRecompile();

      // Re-arm; previous gate should be released.
      manager.armRecompileGate();
      await firstWait; // must not hang

      // Fresh gate is still pending — fire to release.
      fireRecompileDetector(manager, 'compiled successfully\n');
      await manager.awaitRecompile();
    });

    it('case-insensitive match — Webpack capitalizes the line in CRA 5', async () => {
      manager.armRecompileGate();
      fireRecompileDetector(manager, 'Compiled successfully!\n');
      await manager.awaitRecompile();
    });

    it('logs flowing through _appendLog do not accidentally release the gate', async () => {
      // _appendLog only buffers/categorizes — it must NOT advance the gate.
      // The gate is driven only by stdout/stderr handlers via _maybeResolveRecompileGate.
      manager.armRecompileGate();

      appendLog(manager, 'compiled successfully\n');
      // Race the gate against a microtask; gate must still be pending.
      const settled = await Promise.race([manager.awaitRecompile().then(() => 'resolved'), Promise.resolve('pending')]);
      expect(settled).toBe('pending');
    });

    // HYP-370 Phase 3 — recompile surfaced as an explicit sub-state so consumers
    // can tell stable-serving (`running`) from mid-recompile WITHOUT reaching into
    // the recompile-gate promise.
    describe('recompiling sub-state (HYP-370 Phase 3)', () => {
      function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus, error?: string) {
        (mgr as unknown as { transition(to: DevServerStatus, error?: string): boolean }).transition(to, error);
      }

      it('getState().recompiling reflects the gate: false → armed=true → released=false', async () => {
        // Force `running` so the reported state isolates the recompiling flag.
        transition(manager, 'starting');
        transition(manager, 'running');

        expect(manager.getState().recompiling).toBe(false);

        manager.armRecompileGate();
        expect(manager.getState().status).toBe('running'); // status unchanged — additive
        expect(manager.getState().recompiling).toBe(true);

        fireRecompileDetector(manager, 'compiled successfully\n');
        await manager.awaitRecompile();
        expect(manager.getState().recompiling).toBe(false);
      });

      it('onStatusChange fires with recompiling:true on arm and recompiling:false on release', async () => {
        transition(manager, 'starting');
        transition(manager, 'running');

        const cb = mock();
        manager.onStatusChange(cb);

        manager.armRecompileGate();
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', recompiling: true }));

        cb.mockClear();
        fireRecompileDetector(manager, 'compiled successfully\n');
        await manager.awaitRecompile();
        expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'running', recompiling: false }));
      });

      it('re-arming keeps recompiling:true (the new patch supersedes, still mid-recompile)', async () => {
        transition(manager, 'starting');
        transition(manager, 'running');

        manager.armRecompileGate();
        manager.armRecompileGate(); // supersede
        expect(manager.getState().recompiling).toBe(true);

        fireRecompileDetector(manager, 'compiled successfully\n');
        await manager.awaitRecompile();
        expect(manager.getState().recompiling).toBe(false);
      });

      it('recompiling is false when no gate has ever been armed', () => {
        expect(manager.getState().recompiling).toBe(false);
      });

      it('recompiling is false once the server leaves `running`, even if a gate is still armed', () => {
        // A gate armed while running, then a crash/stop leaves _recompileGate non-null.
        // The reported sub-state must NOT claim "recompiling" when we are no longer
        // serving — "mid-recompile" only means anything while running.
        transition(manager, 'starting');
        transition(manager, 'running');
        manager.armRecompileGate();
        expect(manager.getState().recompiling).toBe(true);

        transition(manager, 'stopped'); // process exited / user stopped
        expect(manager.getState().status).toBe('stopped');
        expect(manager.getState().recompiling).toBe(false);
      });
    });
  });

  describe('status transition guard (HYP-370 Phase 2)', () => {
    // The status field is now a guarded machine: only legal edges (plus idempotent
    // self-loops) are applied + published; illegal cross-state jumps are no-ops and
    // do NOT fire onStatusChange. Drive the private transition() directly.
    function transition(mgr: InstanceType<typeof DevServerManager>, to: DevServerStatus, error?: string) {
      (mgr as unknown as { transition(to: DevServerStatus, error?: string): boolean }).transition(to, error);
    }
    function statusOf(mgr: InstanceType<typeof DevServerManager>) {
      return mgr.getState().status;
    }

    it('rejects an illegal cross-state jump (stopped -> running without starting) and does NOT fire onStatusChange', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      expect(statusOf(manager)).toBe('stopped');
      transition(manager, 'running');

      expect(statusOf(manager)).toBe('stopped'); // status unchanged
      expect(cb).not.toHaveBeenCalled(); // listeners not notified
    });

    it('rejects running <- error and starting <- running jumps too', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      // error -> running is illegal
      transition(manager, 'starting');
      transition(manager, 'error', 'boom');
      cb.mockClear();
      transition(manager, 'running');
      expect(statusOf(manager)).toBe('error');
      expect(cb).not.toHaveBeenCalled();
    });

    it('applies a legal transition path and fires onStatusChange with the payload', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      transition(manager, 'starting');
      expect(statusOf(manager)).toBe('starting');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'starting' }));

      cb.mockClear();
      transition(manager, 'running');
      expect(statusOf(manager)).toBe('running');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'running' }));
    });

    it('preserves the error payload on a legal -> error transition (getState().error)', () => {
      transition(manager, 'starting');
      transition(manager, 'error', 'spawn failed');
      const state = manager.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('spawn failed');
    });

    it('startup crash path: starting -> stopped (exit) -> error (catch) still surfaces the error', () => {
      // A dev command that exits before readiness: the exit handler sets `stopped`,
      // then start()'s catch surfaces the failure as `error`. stopped -> error must
      // be legal so the UI keeps the failure state + message (regression guard).
      const cb = mock();
      manager.onStatusChange(cb);

      transition(manager, 'starting');
      transition(manager, 'stopped'); // process exited during _waitForReady
      cb.mockClear();
      transition(manager, 'error', 'Server failed to start');

      const state = manager.getState();
      expect(state.status).toBe('error');
      expect(state.error).toBe('Server failed to start');
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'error', error: 'Server failed to start' }));
    });

    it('allows the stopped -> stopped self-loop to re-publish (idempotent, contract-preserving)', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      expect(statusOf(manager)).toBe('stopped');
      transition(manager, 'stopped');
      expect(statusOf(manager)).toBe('stopped');
      // Self-loop is legal — matches today's always-fire behavior on stop() of a fresh instance
      expect(cb).toHaveBeenCalledWith(expect.objectContaining({ status: 'stopped' }));
    });
  });

  describe('port auto-detection via _maybeUpdatePortFromOutput', () => {
    function firePortDetector(mgr: InstanceType<typeof DevServerManager>, text: string) {
      (mgr as unknown as { _maybeUpdatePortFromOutput(text: string): void })._maybeUpdatePortFromOutput(text);
    }

    it('updates proxy target when dev server binds to a different port than assigned', () => {
      const setTargetPort = mock();
      const proxy = { setTargetPort };
      Object.assign(manager, { _previewProxy: proxy, _port: 5174 });

      // Bun.serve output: "http://localhost:3000"
      firePortDetector(manager, '✨ CMS dev server running at http://localhost:3000');

      expect(setTargetPort).toHaveBeenCalledWith(3000);
      expect((manager as unknown as { _port: number })._port).toBe(3000);
    });

    it('does not call setTargetPort when detected port matches assigned port', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5173 });

      firePortDetector(manager, 'Local: http://localhost:5173/');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('is a no-op when _portDetected is already true', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174, _portDetected: true });

      firePortDetector(manager, 'http://localhost:3000');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('is a no-op when no port pattern in output', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'TypeScript watch started');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('matches 127.0.0.1 as well as localhost', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Listening on http://127.0.0.1:3000');

      expect(setTargetPort).toHaveBeenCalledWith(3000);
    });

    it('only fires once — subsequent output does not re-update the port', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'http://localhost:3000');
      firePortDetector(manager, 'http://localhost:4000');

      expect(setTargetPort).toHaveBeenCalledTimes(1);
      expect(setTargetPort).toHaveBeenCalledWith(3000);
    });

    it('ignores Node/Bun debugger WebSocket URLs (ws://127.0.0.1:9229)', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Debugger listening on ws://127.0.0.1:9229/uuid');

      expect(setTargetPort).not.toHaveBeenCalled();
    });

    it('detects low-numbered ports like :80', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Server listening at http://localhost:80');

      expect(setTargetPort).toHaveBeenCalledWith(80);
    });

    it('rejects port > 65535', () => {
      const setTargetPort = mock();
      Object.assign(manager, { _previewProxy: { setTargetPort }, _port: 5174 });

      firePortDetector(manager, 'Running at http://localhost:65536');

      expect(setTargetPort).not.toHaveBeenCalled();
    });
  });
});
