import { describe, expect, it, mock } from 'bun:test';

// PreviewProxy reads iframe-*.js via fs.readFileSync AT IMPORT TIME (built next to the
// bundle, absent in src/). Stub readFileSync for iframe-* only — same pattern as the
// main DevServerManager.test.ts — so the real module imports cleanly. Capture the
// ORIGINAL readFileSync first (bun mutates the namespace in place).
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

// Dynamic imports are intentional: mock.module must be registered BEFORE the module
// under test is linked, so static imports cannot work.
const vscode = await import('vscode');
const fsp = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
const http = await import('node:http');
const {
  DevServerManager,
  // HYP-1185 — does not exist pre-fix; the RED run fails on exactly this.
  devServerRecordPinnedPort,
} = await import('../services/DevServerManager');
const { recordOwnedDevServer } = await import('../services/devServerOrphanRegistry');

/**
 * HYP-1185 — preview wedge: the manager proxies a DEAD backend port forever.
 *
 * Ground truth from the live wedged container (hyper-e2e-wedge-r1-s1, 2026-08-07):
 * the extension-host log shows `[PreviewProxy] Listening on port 37541, proxying to
 * 11600`, `DevServer ready detected via stdout`, then an endless storm of
 * `HTTP proxy error: connect ECONNREFUSED 127.0.0.1:11600` while the manager keeps
 * reporting `running`. Two product holes combine:
 *
 *  1. Attach-first adoption trusts pid-liveness + a probe of the CONFIGURED port,
 *     but never checks that the registry record actually describes the answering
 *     server. A record whose command pins a DIFFERENT port than the one answering
 *     is a stale identity — adopting it proxies a stranger (or a port the recorded
 *     server no longer serves).
 *  2. When the proxied backend dies, the proxy retries a GET 5 times (~4.5s) and
 *     then 502s every request FOREVER. The manager never learns; the preview
 *     iframe sits on about:blank and the webview postMessage loops on a dead
 *     origin. The 502 loop must end in a real state change: a bounded number of
 *     fresh-spawn restarts, then a terminal `error`.
 */

type ManagerPrivates = {
  _process: unknown;
  _status: string;
  _adoptedRecord: unknown;
  _previewProxy: unknown;
  _orphanBaseDir: string;
  _port: number | null;
  _reapOrphanedDevServer: () => void;
  _findFreePort: (start: number) => Promise<number>;
  _waitForReady: (timeout: number, gen?: number) => Promise<void>;
  _handleBackendRefused: (proxy: unknown) => void;
  _runBackendRecoveryRestart: (expectedGen: number) => Promise<void>;
  _backendRecoveryConfirmMs: number;
  _probeHttpServer: (port: number) => Promise<boolean>;
  _toolchain: { shouldInstallDependencies: (cwd: string, pm: string) => Promise<boolean> };
};

const tmpDirs: string[] = [];

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

async function writeViteProject(dir: string): Promise<void> {
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
  );
}

/** Point the global vscode workspace mock at `dir` with a configured default port. */
function stubWorkspace(dir: string, configuredPort?: number): () => void {
  const ws = vscode.workspace as unknown as {
    workspaceFolders: unknown[];
    getConfiguration: unknown;
  };
  const savedFolders = ws.workspaceFolders;
  const savedGetConfiguration = ws.getConfiguration;
  ws.workspaceFolders = [{ uri: { fsPath: dir }, name: 'ws', index: 0 }];
  ws.getConfiguration = () => ({
    get: <T>(_key: string, defaultValue?: T): T | undefined => (configuredPort ?? defaultValue) as T | undefined,
  });
  return () => {
    ws.workspaceFolders = savedFolders;
    ws.getConfiguration = savedGetConfiguration;
  };
}

/** Drain the 0ms confirm timer + lifecycle queue deterministically. */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 25));
}

function startHttpServer(): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>dev server</body></html>');
    });
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        resolve({
          port: addr.port,
          close: () =>
            new Promise<void>((res) => {
              server.close(() => res());
            }),
        });
      } else {
        reject(new Error('no server address'));
      }
    });
  });
}

/** Short-circuit the spawn path so a test proves WHICH path start() took without a real spawn. */
function stubSpawnPath(priv: ManagerPrivates, freePort: number): void {
  priv._findFreePort = mock(async () => freePort);
  priv._waitForReady = mock(async () => {
    throw new Error('test-shortcircuit-ready');
  });
  priv._toolchain.shouldInstallDependencies = mock(async () => false);
}

describe('devServerRecordPinnedPort (HYP-1185)', () => {
  it('extracts the port pinned by an injected --port flag', () => {
    expect(devServerRecordPinnedPort('bun run dev --port 11100')).toBe(11100);
    expect(devServerRecordPinnedPort('npm run dev -- --port 3000')).toBe(3000);
    expect(devServerRecordPinnedPort('pnpm dev --port=4000')).toBe(4000);
  });

  it('extracts a next-style -p pin', () => {
    expect(devServerRecordPinnedPort('next dev -p 4000')).toBe(4000);
  });

  it('returns null when the command pins no port', () => {
    expect(devServerRecordPinnedPort('bun run dev')).toBe(null);
    expect(devServerRecordPinnedPort('npm run dev')).toBe(null);
  });

  it('rejects out-of-range ports instead of adopting garbage', () => {
    expect(devServerRecordPinnedPort('bun run dev --port 0')).toBe(null);
    expect(devServerRecordPinnedPort('bun run dev --port 99999')).toBe(null);
    // A 6-digit run must NOT silently parse as its first 5 digits.
    expect(devServerRecordPinnedPort('bun run dev --port 655350')).toBe(null);
  });
});

describe('HYP-1185 adopt/abandon: stale registry identity must not be adopted', () => {
  it('abandons (reaps) a record whose pinned port differs from the answering port, and spawns fresh', async () => {
    const dir = await makeTmpDir('hyp1185-stale-');
    const store = await makeTmpDir('hyp1185-stale-store-');
    await writeViteProject(dir);
    // A record WE wrote for this project — but its command pins port 1, NOT the
    // port that currently answers HTTP. The live pid is our own test runner
    // (alive, and `ps` shows a command line containing the recorded 'bun'
    // identity token), mirroring the wedge's "live pid, stale identity" shape.
    recordOwnedDevServer(
      { pid: process.pid, projectPath: dir, command: 'bun run dev --port 1', startedAt: Date.now() },
      store,
    );
    const server = await startHttpServer();

    const restore = stubWorkspace(dir, server.port);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates;
    priv._orphanBaseDir = store;
    // The real reaper would (correctly) try to kill the recorded pid — which in
    // this test is OUR OWN process. Stub it and assert it was invoked instead;
    // the reap itself is covered by devServerOrphanRegistry.test.ts.
    const reap = mock(() => {});
    priv._reapOrphanedDevServer = reap;
    stubSpawnPath(priv, server.port + 1);
    try {
      const state = await manager.start();
      // The stale record must NOT be adopted: start falls through to the spawn
      // path (short-circuited here), reaping the stale identity on the way.
      expect(state.status).toBe('error');
      expect(state.error).toBe('test-shortcircuit-ready');
      expect(priv._adoptedRecord).toBe(null);
      expect(reap).toHaveBeenCalled();
      expect(state.port).not.toBe(server.port);
    } finally {
      restore();
      manager.dispose();
      await server.close();
    }
  });

  it('still adopts when the record pins the SAME port that answers (regression guard)', async () => {
    const dir = await makeTmpDir('hyp1185-match-');
    const store = await makeTmpDir('hyp1185-match-store-');
    await writeViteProject(dir);
    const server = await startHttpServer();
    recordOwnedDevServer(
      { pid: process.pid, projectPath: dir, command: `bun run dev --port ${server.port}`, startedAt: Date.now() },
      store,
    );

    const restore = stubWorkspace(dir, server.port);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates;
    priv._orphanBaseDir = store;
    try {
      const state = await manager.start();
      expect(state.status).toBe('running');
      expect(state.port).toBe(server.port);
      // Attach, not spawn: no child process may exist.
      expect(priv._process).toBe(null);
    } finally {
      restore();
      manager.dispose();
      await server.close();
    }
  });
});

describe('HYP-1185 wiring: start() arms the proxy so a dead backend reaches the manager', () => {
  it('adopt path wires setOnBackendRefused — killing the adopted backend schedules a recovery restart', async () => {
    const dir = await makeTmpDir('hyp1185-wiring-');
    const store = await makeTmpDir('hyp1185-wiring-store-');
    await writeViteProject(dir);
    const server = await startHttpServer();
    // Identity-matching record pinning the live server's port → the adopt
    // path runs and _startPreviewProxy creates the REAL proxy (the seam under
    // test: without the setOnBackendRefused wiring line this test stays red).
    recordOwnedDevServer(
      { pid: process.pid, projectPath: dir, command: `bun run dev --port ${server.port}`, startedAt: Date.now() },
      store,
    );

    const restore = stubWorkspace(dir, server.port);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates;
    priv._orphanBaseDir = store;
    priv._backendRecoveryConfirmMs = 0;
    // Port-aware probe: answers only for the adopted server's port while it is
    // alive (the adopt gate passes at start; after server.close() + alive=false
    // the confirm re-probe sees the dead backend). A flat `false` stub would
    // push start() off the adopt path into the REAL reaper — which then targets
    // the record's pid = our own test process (the reap self-guard exists for
    // this).
    let backendAlive = true;
    priv._probeHttpServer = mock(async (port: number) => backendAlive && port === server.port);
    const runRestart = mock(async () => manager.getState());
    (manager as unknown as { _runRestart: unknown })._runRestart = runRestart;
    try {
      const state = await manager.start();
      expect(state.status).toBe('running');
      const proxy = priv._previewProxy as { port: number | null };
      expect(proxy !== null && proxy.port !== null && proxy.port > 0).toBe(true);

      // The backend dies AFTER adoption (the wedge shape). The next request
      // burns the GET retry ladder (~4.5s) and must reach the manager.
      await server.close();
      backendAlive = false;
      const res = await new Promise<{ status: number }>((resolvePromise, reject) => {
        const req = http.request(
          {
            hostname: 'localhost',
            port: proxy?.port ?? 0,
            path: '/test-preview?component=src%2FApp.tsx',
            method: 'GET',
          },
          (r) => {
            r.resume();
            r.on('end', () => resolvePromise({ status: r.statusCode ?? 0 }));
          },
        );
        req.on('error', reject);
        req.end();
      });
      expect(res.status).toBe(502);
      await settle();
      expect(runRestart).toHaveBeenCalledTimes(1);
    } finally {
      restore();
      manager.dispose();
    }
  }, 20_000); // GET retry ladder ≈ 4.5s + startup margin.
});

describe('HYP-1185 backend-refused recovery: the 502 loop ends in a state change', () => {
  function makeRunningManager(): {
    manager: InstanceType<typeof DevServerManager>;
    priv: ManagerPrivates;
    proxy: { marker: string; stop: ReturnType<typeof mock> };
  } {
    const manager = new DevServerManager('/hyp1185-no-such-project');
    const priv = manager as unknown as ManagerPrivates;
    const proxy = { marker: 'live-proxy', stop: mock(() => {}) };
    priv._status = 'running';
    priv._port = 11100;
    priv._previewProxy = proxy;
    priv._backendRecoveryConfirmMs = 0;
    // Deterministic dead backend at confirm time (nothing on 11100 here, but
    // never let a unit test touch a real port).
    priv._probeHttpServer = mock(async () => false);
    return { manager, priv, proxy };
  }

  function stubRunRestart(manager: InstanceType<typeof DevServerManager>): ReturnType<typeof mock> {
    const runRestart = mock(async () => manager.getState());
    (manager as unknown as { _runRestart: unknown })._runRestart = runRestart;
    return runRestart;
  }

  it('restarts exactly once for a storm of refused notifications', async () => {
    const { manager, priv, proxy } = makeRunningManager();
    const runRestart = stubRunRestart(manager);
    try {
      // The wedged iframe fires a whole STORM of terminal ECONNREFUSED errors
      // (every asset + retry). One recovery restart must absorb all of them.
      for (let i = 0; i < 5; i++) priv._handleBackendRefused(proxy);
      // Let the confirm timer + queued recovery op drain.
      await settle();
      expect(runRestart).toHaveBeenCalledTimes(1);
      // After the restart settles, the in-flight guard releases.
      priv._status = 'running';
      priv._handleBackendRefused(proxy);
      await settle();
      expect(runRestart).toHaveBeenCalledTimes(2);
    } finally {
      manager.dispose();
    }
  });

  it('ignores notifications from a stale (already-replaced) proxy', async () => {
    const { manager, priv } = makeRunningManager();
    const runRestart = stubRunRestart(manager);
    try {
      priv._handleBackendRefused({ marker: 'old-proxy', stop: mock(() => {}) });
      await settle();
      expect(runRestart).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
    }
  });

  it('ignores refused connections while starting (cold-boot tolerance)', async () => {
    const { manager, priv, proxy } = makeRunningManager();
    priv._status = 'starting';
    const runRestart = stubRunRestart(manager);
    try {
      priv._handleBackendRefused(proxy);
      await settle();
      expect(runRestart).not.toHaveBeenCalled();
    } finally {
      manager.dispose();
    }
  });

  it('does not restart when the backend answers again at confirm time (transient refusal)', async () => {
    const { manager, priv, proxy } = makeRunningManager();
    // Backend is back by the time the confirm probe runs (vite self-restart).
    priv._probeHttpServer = mock(async () => true);
    const runRestart = stubRunRestart(manager);
    try {
      priv._handleBackendRefused(proxy);
      await settle();
      expect(runRestart).not.toHaveBeenCalled();
      // A transient blip must not spend recovery budget.
      expect((priv as unknown as { _backendRecoveryAttempts: number[] })._backendRecoveryAttempts.length).toBe(0);
    } finally {
      manager.dispose();
    }
  });

  it('aborts a queued recovery when a stop/reroot landed between schedule and dequeue (no resurrection)', async () => {
    const { manager, priv } = makeRunningManager();
    const runRestart = stubRunRestart(manager);
    try {
      const gen = (priv as unknown as { _generation: number })._generation;
      // A stop queued after scheduling bumps the generation — the recovery op
      // must observe that and stand down instead of restarting.
      await priv._runBackendRecoveryRestart(gen + 1);
      expect(runRestart).not.toHaveBeenCalled();
      // Same generation but no longer running (the stop already completed).
      priv._status = 'stopped';
      await priv._runBackendRecoveryRestart(gen);
      expect(runRestart).not.toHaveBeenCalled();
      // Unchanged generation and still running: the recovery proceeds.
      priv._status = 'running';
      await priv._runBackendRecoveryRestart(gen);
      expect(runRestart).toHaveBeenCalledTimes(1);
    } finally {
      manager.dispose();
    }
  });

  it('bounds the recovery loop: after the cap the manager stops the proxy and transitions to error', async () => {
    const { manager, priv, proxy } = makeRunningManager();
    const runRestart = stubRunRestart(manager);
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        priv._status = 'running';
        priv._handleBackendRefused(proxy);
        await settle();
        await settle();
      }
      expect(runRestart).toHaveBeenCalledTimes(3);
      expect(priv._status).toBe('running');

      // 4th dead-backend episode inside the window: no more restarts — the
      // proxy is stopped (the 502 loop ENDS) and the manager surfaces a
      // terminal error instead of looping forever.
      priv._status = 'running';
      priv._handleBackendRefused(proxy);
      await settle();
      expect(runRestart).toHaveBeenCalledTimes(3);
      expect(proxy.stop).toHaveBeenCalled();
      expect(priv._status).toBe('error');
      expect(manager.getState().error ?? '').toContain('refus');
    } finally {
      manager.dispose();
    }
  });

  it('refunds the recovery budget on a manual start (a user recovery re-arms auto-recovery)', async () => {
    const { manager, priv, proxy } = makeRunningManager();
    stubRunRestart(manager);
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        priv._status = 'running';
        priv._handleBackendRefused(proxy);
        await settle();
        await settle();
      }
      expect((priv as unknown as { _backendRecoveryAttempts: number[] })._backendRecoveryAttempts.length).toBe(3);
      // Manual start — must not reach the real _runStart for this assertion.
      (manager as unknown as { _runStart: unknown })._runStart = mock(async () => manager.getState());
      await manager.start();
      expect((priv as unknown as { _backendRecoveryAttempts: number[] })._backendRecoveryAttempts.length).toBe(0);
    } finally {
      manager.dispose();
    }
  });
});
