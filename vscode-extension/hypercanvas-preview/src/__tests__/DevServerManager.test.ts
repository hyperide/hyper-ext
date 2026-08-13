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
const { DevServerManager } = await import('../services/DevServerManager');

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
    it('onStatusChange fires on status updates', () => {
      const cb = mock();
      manager.onStatusChange(cb);

      // Trigger via stop() which calls _updateStatus('stopped')
      manager.stop();
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
  });

  describe('dispose', () => {
    it('does not throw when called on fresh instance', () => {
      expect(() => manager.dispose()).not.toThrow();
    });
  });
});
