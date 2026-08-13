import { beforeEach, describe, expect, it, mock, setSystemTime } from 'bun:test';
import * as realFs from 'node:fs';
import * as realFsPromises from 'node:fs/promises';
import { createMockWebview } from './mocks';

// Mock node:fs/promises at the lowest level so DiagnosticPersistenceService
// (used internally by DiagnosticHub) works with our fake filesystem.
const fsState = {
  fileContent: null as string | null,
  writtenContent: null as string | null,
  unlinkCalled: false,
  sinkContent: '',
};

// DiagnosticHub writes the optional E2E error sink via node:fs appendFileSync.
// Spread the real module: bun's mock.module is global, so replacing the whole
// module would leave every other node:fs export undefined for any test file that
// transitively loads it (AGENTS.md mock.module convention).
mock.module('node:fs', () => ({
  ...realFs,
  appendFileSync: (_path: string, data: string) => {
    fsState.sinkContent += data;
  },
}));

mock.module('node:fs/promises', () => ({
  ...realFsPromises,
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

const { DiagnosticHub, isExpectedTransientPreviewRoute404 } = await import('../DiagnosticHub');

describe('DiagnosticHub', () => {
  beforeEach(() => {
    fsState.fileContent = null;
    fsState.writtenContent = null;
    fsState.unlinkCalled = false;
    fsState.sinkContent = '';
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

  describe('retractExpectedTransientPreviewRoute404s (HYP-943)', () => {
    // Exact shape observed in Hyper Logs on cms-spa preview open: React Router's default
    // ErrorBoundary console.error for the /test-preview navigation before the router patch lands.
    // The capture script stringifies each arg and DiagnosticHub joins them with a space.
    function captureRouter404(hub: InstanceType<typeof DiagnosticHub>): void {
      hub.handleConsoleCapture([
        {
          level: 'error',
          args: [
            'Error handled by React Router default ErrorBoundary:',
            '{"status":404,"statusText":"Not Found","internal":true,' +
              '"data":"Error: No route matches URL \\"/test-preview\\""}',
          ],
          timestamp: Date.now(),
        },
      ]);
    }

    it('retracts the known transient router 404 and rebroadcasts full state', async () => {
      const hub = new DiagnosticHub('/fake/path');
      captureRouter404(hub);
      hub.handleConsoleCapture([{ level: 'error', args: ['genuine app error'], timestamp: Date.now() }]);

      const wv = createMockWebview();
      hub.register('logs', wv as never);
      wv.messages.length = 0;
      fsState.writtenContent = null;

      expect(hub.retractExpectedTransientPreviewRoute404s()).toBe(true);

      expect(hub.state.logs).toHaveLength(1);
      expect(hub.state.logs[0].line).toBe('genuine app error');
      // Full-state rebroadcast so the Hyper Logs panel drops the retracted entry.
      expect(wv.messages).toHaveLength(1);
      const msg = wv.messages[0] as { type: string; state: { logs: Array<{ line: string }> } };
      expect(msg.type).toBe('diagnostic:state');
      expect(msg.state.logs).toHaveLength(1);
      // Persisted state no longer contains the retracted entry. Retraction writes
      // IMMEDIATELY (saveNow — not the 2s debounce), superseding any pending
      // capture-time write, so a dispose/reload right after cannot resurrect the 404.
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(fsState.writtenContent).not.toBeNull();
      expect(fsState.writtenContent).not.toContain('React Router default ErrorBoundary');
    });

    it('is a no-op (no broadcast, no persistence write) when nothing matches', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.handleConsoleCapture([{ level: 'error', args: ['genuine app error'], timestamp: Date.now() }]);

      const wv = createMockWebview();
      hub.register('logs', wv as never);
      wv.messages.length = 0;
      fsState.writtenContent = null;

      expect(hub.retractExpectedTransientPreviewRoute404s()).toBe(false);
      expect(hub.state.logs).toHaveLength(1);
      expect(wv.messages).toHaveLength(0);
      expect(fsState.writtenContent).toBeNull();
    });

    it('keeps a boundary-handled REAL error that merely mentions /test-preview (no 404 evidence)', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.handleConsoleCapture([
        {
          level: 'error',
          args: [
            'Error handled by React Router default ErrorBoundary:',
            'TypeError: Cannot read properties of undefined (reading "map") at /test-preview',
          ],
          timestamp: Date.now(),
        },
      ]);

      expect(hub.retractExpectedTransientPreviewRoute404s()).toBe(false);
      expect(hub.state.logs).toHaveLength(1);
    });

    it('appends a compensating diagnosticRetraction record to the E2E error sink', () => {
      process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK = '/fake/sink.ndjson';
      try {
        const hub = new DiagnosticHub('/fake/path');
        captureRouter404(hub);
        expect(hub.retractExpectedTransientPreviewRoute404s()).toBe(true);

        const kinds = fsState.sinkContent
          .split('\n')
          .filter((l) => l.trim())
          .map((l) => (JSON.parse(l) as { kind: string }).kind);
        expect(kinds).toEqual(['diagnosticEntry', 'diagnosticRetraction']);
      } finally {
        delete process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
      }
    });

    it('does NOT write a retraction record for an entry captured before the sink was armed', () => {
      const hub = new DiagnosticHub('/fake/path');
      captureRouter404(hub); // sink not armed — no diagnosticEntry record exists anywhere
      process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK = '/fake/sink.ndjson';
      try {
        expect(hub.retractExpectedTransientPreviewRoute404s()).toBe(true);
        // A blind retraction here would subtract an unrelated real error from the
        // capture count — the sink must stay untouched.
        expect(fsState.sinkContent).toBe('');
      } finally {
        delete process.env.HYPERIDE_DIAGNOSTIC_ERROR_SINK;
      }
    });

    it('drops a late-flushed transient 404 arriving within the post-success grace window', () => {
      // Batched-console race (review finding): the iframe hook batches console entries
      // 100ms, so the 404 can land AFTER renderSucceeded already ran the retraction.
      const hub = new DiagnosticHub('/fake/path');
      expect(hub.notePreviewRenderSucceeded()).toBe(false); // nothing captured yet
      captureRouter404(hub); // flushes 100ms later in reality — within the grace window
      expect(hub.state.logs).toHaveLength(0);

      // Unrelated console errors inside the grace window are still captured.
      hub.handleConsoleCapture([{ level: 'error', args: ['real error'], timestamp: Date.now() }]);
      expect(hub.state.logs).toHaveLength(1);
    });

    it('still captures a transient-looking 404 arriving after the grace window', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.notePreviewRenderSucceeded();
      setSystemTime(new Date(Date.now() + 5_000));
      try {
        captureRouter404(hub); // a NEW preview attempt's 404 — must stay red until ITS success
        expect(hub.state.logs).toHaveLength(1);
        expect(hub.state.logs[0].isError).toBe(true);
      } finally {
        setSystemTime();
      }
    });

    it('keeps server-source /test-preview lines and non-error console entries', () => {
      const hub = new DiagnosticHub('/fake/path');
      hub.pushServerLogs([{ line: 'GET /test-preview 404 in 12ms', timestamp: Date.now(), isError: true }]);
      hub.handleConsoleCapture([
        // React Router dev warning — warn level, never red; must not be touched.
        { level: 'warn', args: ['No routes matched location "/test-preview?component=x"'], timestamp: Date.now() },
      ]);
      captureRouter404(hub);

      expect(hub.retractExpectedTransientPreviewRoute404s()).toBe(true);
      expect(hub.state.logs.map((l) => l.source)).toEqual(['server', 'console']);
    });
  });

  describe('isExpectedTransientPreviewRoute404', () => {
    it('matches only console errors carrying the router-404 signature for /test-preview', () => {
      const base = { timestamp: 1, source: 'console' as const, isError: true, level: 'error' as const };
      expect(isExpectedTransientPreviewRoute404({ ...base, line: 'No route matches URL "/test-preview"' })).toBe(true);
      // A 404 for some OTHER route is a real app problem — never retract it.
      expect(isExpectedTransientPreviewRoute404({ ...base, line: 'No route matches URL "/orders"' })).toBe(false);
      // /test-preview mentioned without the router-404 wording is not the known transient.
      expect(isExpectedTransientPreviewRoute404({ ...base, line: 'failed to fetch /test-preview' })).toBe(false);
      // The generic boundary preamble alone is NOT 404 evidence — a real render error
      // mentioning /test-preview must survive retraction (review finding).
      expect(
        isExpectedTransientPreviewRoute404({
          ...base,
          line: 'Error handled by React Router default ErrorBoundary: TypeError: x is undefined at /test-preview',
        }),
      ).toBe(false);
      // Status fields alone are not evidence either — a real app fetch failure carries
      // them too; only the router's route-miss message qualifies (review finding).
      expect(
        isExpectedTransientPreviewRoute404({
          ...base,
          line: 'fetch /test-preview failed: {"status":404,"statusText":"Not Found"}',
        }),
      ).toBe(false);
      // The route-miss URL may carry a query suffix — still the known transient.
      expect(
        isExpectedTransientPreviewRoute404({
          ...base,
          line: 'No route matches URL "/test-preview?component=src%2FApp.tsx"',
        }),
      ).toBe(true);
      // JSON-escaped quotes (ErrorResponse stringified by the capture script) still match.
      expect(
        isExpectedTransientPreviewRoute404({
          ...base,
          line: '{"status":404,"data":"Error: No route matches URL \\"/test-preview\\""}',
        }),
      ).toBe(true);
      // A DIFFERENT route's miss with /test-preview merely elsewhere in the joined line
      // (e.g. a stack/source URL from another console arg) is a real app error (review finding).
      expect(
        isExpectedTransientPreviewRoute404({
          ...base,
          line: 'No route matches URL "/orders" at http://localhost:3000/test-preview?component=x',
        }),
      ).toBe(false);
      // Non-error and non-console entries are out of scope.
      expect(
        isExpectedTransientPreviewRoute404({ ...base, isError: false, line: 'No route matches URL "/test-preview"' }),
      ).toBe(false);
      expect(
        isExpectedTransientPreviewRoute404({
          ...base,
          source: 'server',
          line: 'No route matches URL "/test-preview"',
        }),
      ).toBe(false);
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
