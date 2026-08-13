import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * DevServerManager test — focuses on log parsing, state machine,
 * and callback wiring. Does NOT test actual process spawning.
 *
 * Only mock PreviewProxy (it reads build artifacts at import time).
 * Do NOT mock ProjectDetector — it loads fine without mocks and
 * a global mock would break ProjectDetector's own tests
 * (bun mock.module is global, not scoped per file).
 */

// Mock PreviewProxy — it does fs.readFileSync at import time for
// iframe scripts that only exist after esbuild build step.
mock.module('../services/PreviewProxy', () => ({
  PreviewProxy: class {
    port = 9999;
    url = 'http://localhost:9999';
    start = mock(() => Promise.resolve());
    stop = mock();
  },
}));
const { appendScriptCliArgs, buildInstallCommand, DevServerManager, shouldRepairDependencies } =
  await import('../services/DevServerManager');

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
