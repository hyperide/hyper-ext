import { beforeEach, describe, expect, it, mock } from 'bun:test';
import { createMockWebview } from './mocks';

// Mock node:fs/promises at the lowest level so DiagnosticPersistenceService
// (used internally by DiagnosticHub) works with our fake filesystem.
const fsState = {
  fileContent: null as string | null,
  writtenContent: null as string | null,
  unlinkCalled: false,
};

mock.module('node:fs/promises', () => ({
  readFile: async () => {
    if (fsState.fileContent === null) throw new Error('ENOENT');
    return fsState.fileContent;
  },
  writeFile: async (_path: string, content: string) => {
    fsState.writtenContent = content;
  },
  unlink: async () => {
    fsState.unlinkCalled = true;
  },
  mkdir: async () => {},
}));

const { DiagnosticHub } = await import('../DiagnosticHub');

describe('DiagnosticHub', () => {
  beforeEach(() => {
    fsState.fileContent = null;
    fsState.writtenContent = null;
    fsState.unlinkCalled = false;
  });

  describe('init', () => {
    it('should load persisted logs when globalStoragePath provided', async () => {
      fsState.fileContent = JSON.stringify([
        { line: 'persisted log', timestamp: 1000, source: 'server', isError: false },
      ]);

      const hub = new DiagnosticHub('/fake/path');
      await hub.init();

      expect(hub.state.logs).toHaveLength(1);
      expect(hub.state.logs[0].line).toBe('persisted log');
    });

    it('should work without globalStoragePath (no persistence)', async () => {
      const hub = new DiagnosticHub();
      await hub.init();
      expect(hub.state.logs).toHaveLength(0);
    });
  });

  describe('pushServerLogs', () => {
    it('should update logs and set connected', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.pushServerLogs([{ line: 'test line', timestamp: Date.now(), isError: false }]);

      expect(hub.state.logs).toHaveLength(1);
      expect(hub.state.logs[0].line).toBe('test line');
      expect(hub.state.isConnected).toBe(true);
    });

    it('should append logs instead of replacing', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.pushServerLogs([{ line: 'first', timestamp: Date.now(), isError: false }]);
      hub.pushServerLogs([{ line: 'second', timestamp: Date.now(), isError: false }]);

      expect(hub.state.logs).toHaveLength(2);
      expect(hub.state.logs[0].line).toBe('first');
      expect(hub.state.logs[1].line).toBe('second');
    });

    it('should broadcast only new entries, not entire buffer', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.pushServerLogs([{ line: 'first', timestamp: Date.now(), isError: false }]);

      const wv = createMockWebview();
      hub.register('logs', wv as never);
      wv.messages.length = 0;

      hub.pushServerLogs([{ line: 'second', timestamp: Date.now(), isError: false }]);

      expect(wv.messages).toHaveLength(1);
      const msg = wv.messages[0] as { type: string; entries: Array<{ line: string }> };
      expect(msg.type).toBe('diagnostic:log');
      expect(msg.entries).toHaveLength(1);
      expect(msg.entries[0].line).toBe('second');
    });
  });

  describe('handleConsoleCapture', () => {
    it('should append console entries to logs', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.handleConsoleCapture([
        { level: 'log', args: ['hello'], timestamp: Date.now() },
        { level: 'error', args: ['fail'], timestamp: Date.now() },
      ]);

      expect(hub.state.logs).toHaveLength(2);
      expect(hub.state.logs[0].source).toBe('console');
      expect(hub.state.logs[1].isError).toBe(true);
    });
  });

  describe('clear', () => {
    it('should clear logs and runtime error', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.pushServerLogs([{ line: 'test', timestamp: Date.now(), isError: false }]);
      hub.setRuntimeError({ type: 'Error', message: 'boom', framework: 'react' });

      hub.clear();

      expect(hub.state.logs).toHaveLength(0);
      expect(hub.state.runtimeError).toBeNull();
    });

    it('should broadcast clear to panels', () => {
      const hub = new DiagnosticHub('/fake/path');
      const wv = createMockWebview();
      hub.register('logs', wv as never);
      wv.messages.length = 0;

      hub.clear();

      expect(wv.messages).toHaveLength(1);
      expect((wv.messages[0] as { type: string }).type).toBe('diagnostic:clear');
    });
  });

  describe('setBuildStatus', () => {
    it('should update build status and connection state', () => {
      const hub = new DiagnosticHub();
      hub.setBuildStatus('building');
      expect(hub.state.buildStatus).toBe('building');
      expect(hub.state.isConnected).toBe(true);

      hub.setBuildStatus('idle');
      expect(hub.state.isConnected).toBe(false);
    });
  });

  describe('register/unregister', () => {
    it('should send state to newly registered panel', () => {
      const hub = new DiagnosticHub();
      hub.pushServerLogs([{ line: 'existing', timestamp: Date.now(), isError: false }]);

      const wv = createMockWebview();
      hub.register('panel-a', wv as never);

      // sendState is manual — no auto-send on register in DiagnosticHub
      hub.sendState('panel-a');
      const stateMsg = wv.messages.find((m) => (m as { type: string }).type === 'diagnostic:state');
      expect(stateMsg).toBeDefined();
    });

    it('should stop broadcasting to unregistered panels', () => {
      const hub = new DiagnosticHub();
      const wv = createMockWebview();
      hub.register('panel-a', wv as never);
      hub.unregister('panel-a');
      wv.messages.length = 0;

      hub.clear();
      expect(wv.messages).toHaveLength(0);
    });
  });

  describe('getAIContext', () => {
    it('should include server logs in context', () => {
      const hub = new DiagnosticHub();
      hub.pushServerLogs([{ line: 'Error: something broke', timestamp: Date.now(), isError: true }]);

      const context = hub.getAIContext();
      expect(context).toContain('Error: something broke');
      expect(context).toContain('Server logs');
    });

    it('should return empty string when no data', () => {
      const hub = new DiagnosticHub();
      expect(hub.getAIContext()).toBe('');
    });
  });

  describe('dispose', () => {
    it('should clear panels and logs', () => {
      const hub = new DiagnosticHub('/fake/path');
      const wv = createMockWebview();
      hub.register('logs', wv as never);

      hub.pushServerLogs([{ line: 'test', timestamp: Date.now(), isError: false }]);

      hub.dispose();
      expect(hub.state.logs).toHaveLength(0);
    });
  });
});
