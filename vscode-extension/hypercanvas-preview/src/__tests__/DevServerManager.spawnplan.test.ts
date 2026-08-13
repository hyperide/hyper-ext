import { afterEach, describe, expect, it, mock } from 'bun:test';

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

// Dynamic imports are intentional here (and across this suite): mock.module must be
// registered BEFORE the module under test is linked, so static imports cannot work.
const vscode = await import('vscode');
const fsp = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
const http = await import('node:http');
const {
  DevServerManager,
  // HYP-1160 — does not exist pre-fix; the RED run fails on exactly this.
  resolveSpawnCommand,
} = await import('../services/DevServerManager');

/**
 * HYP-1160 — dev-server spawn on a bun + Nx monorepo (conloca).
 *
 * Ground truth from live QA (2026-08-01, conloca-private-qa @ b2a1ea60):
 *  1. targets/conloca-app has no lockfile; the workspace root has bun.lock.
 *  2. The app's `dev` script is `nx run conloca-app:dev --outputStyle=dynamic-legacy`;
 *     spawning it with cwd=app dir breaks the Nx project graph — it must run with
 *     cwd=repo root.
 *  3. An already-listening vite on the expected port must be ATTACHED to, not
 *     competed with by a fresh spawn.
 *  4. A window-reload respawn must reuse the persisted spawn plan (pm + cwd +
 *     command) instead of re-detecting (detection flipped bun → npm across reload).
 *
 * Fact 1 is covered in services/__tests__/ProjectDetector.test.ts (lockfile walk-up).
 * This file covers facts 2-4.
 */

type ManagerPrivates = {
  _process: unknown;
  _spawnPlanBaseDir: string;
  _orphanBaseDir: string;
  _resolveSpawnPlan: (
    devScript: string,
    scripts: Record<string, string>,
  ) => Promise<{ cmd: string; args: string[]; cwd: string; branch: string; packageManager: string }>;
};

const tmpDirs: string[] = [];

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
  }
});

/** Point the global vscode workspace mock at `dir` and (optionally) a configured port. */
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

describe('HYP-1160 (b): task-runner wrapper dev commands run from the workspace root', () => {
  it('resolves nx-wrapped dev scripts to cwd=repo root, executing the script command itself', async () => {
    const root = await makeTmpDir('hyp1160-root-');
    const app = path.join(root, 'targets', 'conloca-app');
    await fsp.mkdir(app, { recursive: true });
    await fsp.writeFile(path.join(root, 'bun.lock'), '');

    const plan = await resolveSpawnCommand(app, 'bun', 'dev', 'nx run conloca-app:dev --outputStyle=dynamic-legacy');
    expect(plan.cwd).toBe(root);
    expect(plan.cmd).toBe('nx');
    expect(plan.args).toEqual(['run', 'conloca-app:dev', '--outputStyle=dynamic-legacy']);
  });

  it('keeps plain dev-server scripts in the project dir via the package manager', async () => {
    const root = await makeTmpDir('hyp1160-plain-');
    const app = path.join(root, 'targets', 'conloca-app');
    await fsp.mkdir(app, { recursive: true });
    await fsp.writeFile(path.join(root, 'bun.lock'), '');

    const plan = await resolveSpawnCommand(app, 'bun', 'dev', 'vite dev');
    expect(plan.cwd).toBe(app);
    expect(plan.cmd).toBe('bun');
    expect(plan.args).toEqual(['run', 'dev']);
  });

  it('falls back to <pm> run <script> in the SELECTED package dir for shell-unsafe wrapper text', async () => {
    const root = await makeTmpDir('hyp1160-unsafe-');
    const app = path.join(root, 'app');
    await fsp.mkdir(app, { recursive: true });
    await fsp.writeFile(path.join(root, 'bun.lock'), '');

    // P1 (PR #692): the fallback must keep the package context — running
    // `bun run dev` at the workspace ROOT would boot the root package's
    // same-named script (wrong app) or fail when the root lacks it.
    const plan = await resolveSpawnCommand(app, 'bun', 'dev', 'nx run app:dev && nx run other:dev');
    expect(plan.cwd).toBe(app);
    expect(plan.cmd).toBe('bun');
    expect(plan.args).toEqual(['run', 'dev']);
  });
});

describe('HYP-1160 (c): attach-first when the expected port already answers HTTP', () => {
  it('adopts a running server whose identity matches a record WE wrote for this project', async () => {
    const { recordOwnedDevServer } = await import('../services/devServerOrphanRegistry');
    const dir = await makeTmpDir('hyp1160-attach-');
    const store = await makeTmpDir('hyp1160-attach-store-');
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
    );
    // A server left running by a previous session of THIS extension: we hold a
    // registry record for it. The test runner's own pid stands in for the live
    // dev-server process — alive, and `ps` shows a command line containing the
    // recorded 'bun' identity token (the suite runs under `bun test`).
    recordOwnedDevServer({ pid: process.pid, projectPath: dir, command: 'bun run dev', startedAt: Date.now() }, store);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>dev server</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const restore = stubWorkspace(dir, port);
    const manager = new DevServerManager(dir);
    (manager as unknown as ManagerPrivates)._orphanBaseDir = store;
    try {
      const state = await manager.start();
      expect(state.status).toBe('running');
      expect(state.port).toBe(port);
      // Attach, not spawn: no child process may exist.
      expect((manager as unknown as ManagerPrivates)._process).toBe(null);
    } finally {
      restore();
      manager.dispose();
      server.close();
    }
  });

  it('spawns on a free port when the listening server is NOT one we recorded for this project', async () => {
    const dir = await makeTmpDir('hyp1160-stranger-');
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
    );
    // A stranger on the expected port: another project's dev server or an
    // unrelated service. No registry record exists for THIS project, so the
    // manager must NOT attach (P1, PR #692) — it spawns on a free port instead.
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>someone else</body></html>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;

    const restore = stubWorkspace(dir, port);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates & {
      _findFreePort: (start: number) => Promise<number>;
      _waitForReady: (timeout: number, gen?: number) => Promise<void>;
      _toolchain: { shouldInstallDependencies: (cwd: string, pm: string) => Promise<boolean> };
    };
    // Avoid a real spawn/readiness wait: this test only proves the attach probe
    // did NOT adopt the unverified listener (start proceeds down the spawn path).
    priv._findFreePort = mock(async () => port + 1);
    priv._waitForReady = mock(async () => {
      throw new Error('test-shortcircuit-ready');
    });
    // The deps phase is not under test either: the fixture's vite devDependency
    // makes the REAL npm install take ~4.5s warm-cache, racing the 5s test
    // timeout under full-suite parallel load (timed out twice at 5002/5026ms).
    priv._toolchain.shouldInstallDependencies = mock(async () => false);
    try {
      const state = await manager.start();
      // Reached the spawn path (short-circuited), NOT the attach path.
      expect(state.status).toBe('error');
      expect(state.error).toBe('test-shortcircuit-ready');
      expect(state.port).not.toBe(port);
    } finally {
      restore();
      manager.dispose();
      server.close();
    }
  });

  it('still spawns when the expected port does not answer HTTP', async () => {
    const dir = await makeTmpDir('hyp1160-noattach-');
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
    );
    // Occupy a port with a non-HTTP listener (plain TCP that never speaks HTTP).
    const net = await import('node:net');
    const blocker = net.createServer((socket) => socket.end());
    await new Promise<void>((resolve) => blocker.listen(0, '127.0.0.1', resolve));
    const port = (blocker.address() as { port: number }).port;

    const restore = stubWorkspace(dir, port);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates & {
      _findFreePort: (start: number) => Promise<number>;
      _waitForReady: (timeout: number, gen?: number) => Promise<void>;
      _toolchain: { shouldInstallDependencies: (cwd: string, pm: string) => Promise<boolean> };
    };
    // Avoid a real spawn/readiness wait: this test only proves the attach probe
    // did NOT adopt a non-HTTP listener (start proceeds down the spawn path).
    priv._findFreePort = mock(async () => port + 1);
    priv._waitForReady = mock(async () => {
      throw new Error('test-shortcircuit-ready');
    });
    // Same real-npm-install hazard as the stranger-port test above.
    priv._toolchain.shouldInstallDependencies = mock(async () => false);
    try {
      const state = await manager.start();
      // Reached the spawn path (short-circuited), NOT the attach path.
      expect(state.status).toBe('error');
      expect(state.error).toBe('test-shortcircuit-ready');
      expect(state.port).not.toBe(port);
    } finally {
      restore();
      manager.dispose();
      blocker.close();
    }
  });
});

describe('HYP-1160 (d): respawn reuses the persisted spawn plan', () => {
  it('a fresh manager reuses the persisted pm + cwd instead of re-detecting', async () => {
    const { readSpawnPlan } = await import('../services/devServerSpawnPlan');
    const dir = await makeTmpDir('hyp1160-plan-');
    const store = await makeTmpDir('hyp1160-store-');
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }));
    await fsp.writeFile(path.join(dir, 'bun.lock'), '');
    const scripts = { dev: 'vite' };

    const m1 = new DevServerManager(dir);
    const p1 = m1 as unknown as ManagerPrivates;
    p1._spawnPlanBaseDir = store;
    const first = await p1._resolveSpawnPlan('dev', scripts);
    expect(first.packageManager).toBe('bun');
    expect(readSpawnPlan(dir, store)?.packageManager).toBe('bun');
    m1.dispose();

    // Simulate the reload-time detection flip: the lockfile evidence is gone, so
    // re-detection would now resolve npm. The persisted plan must win.
    await fsp.rm(path.join(dir, 'bun.lock'));
    const m2 = new DevServerManager(dir);
    const p2 = m2 as unknown as ManagerPrivates;
    p2._spawnPlanBaseDir = store;
    const second = await p2._resolveSpawnPlan('dev', scripts);
    expect(second.packageManager).toBe('bun');
    expect(second.cmd).toBe('bun');
    expect(second.args).toEqual(['run', 'dev']);
    m2.dispose();
  });

  it('discards a persisted plan whose script disappeared from package.json', async () => {
    const { writeSpawnPlan } = await import('../services/devServerSpawnPlan');
    const dir = await makeTmpDir('hyp1160-stale-');
    const store = await makeTmpDir('hyp1160-store2-');
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }));
    writeSpawnPlan(
      {
        version: 2,
        projectPath: dir,
        script: 'gone',
        packageManager: 'bun',
        cwd: dir,
        wrapper: false,
        branch: 'pm-run',
        createdAt: Date.now(),
      },
      store,
    );

    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates;
    priv._spawnPlanBaseDir = store;
    // The persisted plan names a script that no longer exists — it must be
    // ignored and re-resolved (here: npm, no lockfiles anywhere).
    const plan = await priv._resolveSpawnPlan('dev', { dev: 'vite' });
    expect(plan.packageManager).toBe('npm');
    manager.dispose();
  });

  it('discards a plan when the live lockfile evidence names a different pm (PR #692 review)', async () => {
    const { writeSpawnPlan } = await import('../services/devServerSpawnPlan');
    const dir = await makeTmpDir('hyp1160-migrate-');
    const store = await makeTmpDir('hyp1160-store3-');
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }));
    // The project migrated bun → pnpm after the plan was resolved: a pnpm
    // lock exists, the bun lock is gone. The persisted bun plan must lose.
    await fsp.writeFile(path.join(dir, 'pnpm-lock.yaml'), '');
    writeSpawnPlan(
      {
        version: 2,
        projectPath: dir,
        script: 'dev',
        packageManager: 'bun',
        cwd: dir,
        wrapper: false,
        branch: 'pm-run',
        createdAt: Date.now(),
      },
      store,
    );

    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates;
    priv._spawnPlanBaseDir = store;
    const plan = await priv._resolveSpawnPlan('dev', { dev: 'vite' });
    expect(plan.packageManager).toBe('pnpm');
    manager.dispose();
  });

  it('keeps a plan when the live evidence names the SAME pm (PR #692 review)', async () => {
    const { writeSpawnPlan } = await import('../services/devServerSpawnPlan');
    const dir = await makeTmpDir('hyp1160-samepm-');
    const store = await makeTmpDir('hyp1160-store4-');
    await fsp.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', scripts: { dev: 'vite' } }));
    await fsp.writeFile(path.join(dir, 'bun.lock'), '');
    writeSpawnPlan(
      {
        version: 2,
        projectPath: dir,
        script: 'dev',
        packageManager: 'bun',
        cwd: dir,
        wrapper: false,
        branch: 'pm-run',
        createdAt: Date.now(),
      },
      store,
    );

    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates;
    priv._spawnPlanBaseDir = store;
    const plan = await priv._resolveSpawnPlan('dev', { dev: 'vite' });
    expect(plan.packageManager).toBe('bun');
    manager.dispose();
  });
});

describe('HYP-1160 (c2): attach supersede + adopted-server lifecycle (PR #692 review)', () => {
  it('a supersede landing during the attach proxy start tears down the proxy and never reaches running', async () => {
    const { recordOwnedDevServer } = await import('../services/devServerOrphanRegistry');
    const dir = await makeTmpDir('hyp1160-attachsup-');
    const store = await makeTmpDir('hyp1160-attachsup-store-');
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
    );
    // Identity stand-in: the test runner's own pid (alive; `ps` shows 'bun').
    // The attach is ABANDONED below, so _adoptedRecord is never set and
    // dispose()'s stop() never tries to kill this pid.
    recordOwnedDevServer({ pid: process.pid, projectPath: dir, command: 'bun run dev', startedAt: Date.now() }, store);
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end('<html><body>dev server</body></html>');
    });
    const { promise: listening, resolve: markListening } = Promise.withResolvers<void>();
    server.listen(0, '127.0.0.1', markListening);
    await listening;
    const port = (server.address() as { port: number }).port;

    const restore = stubWorkspace(dir, port);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates & {
      _generation: number;
      _previewProxy: unknown;
      _startPreviewProxy: () => Promise<void>;
    };
    priv._orphanBaseDir = store;
    // The supersede trigger: a concurrent stop/reroot bumps the epoch while the
    // attach path awaits proxy.start() — mirrors the _findFreePort bump the
    // spawn-path HYP-52 test uses.
    const realStartProxy = priv._startPreviewProxy.bind(manager);
    priv._startPreviewProxy = async () => {
      await realStartProxy();
      priv._generation += 1;
    };
    try {
      const state = await manager.start();
      // Abandoned attach: the just-started proxy is torn down and the manager
      // never transitions to running.
      expect(state.status).toBe('stopped');
      expect(priv._previewProxy).toBe(null);
    } finally {
      restore();
      manager.dispose();
      server.close();
    }
  });

  it('stop() after attach kills the adopted server; a second start() spawns fresh instead of re-attaching', async () => {
    const { recordOwnedDevServer, readOwnedDevServers, isProcessAlive } =
      await import('../services/devServerOrphanRegistry');
    const { spawn } = await import('node:child_process');
    const dir = await makeTmpDir('hyp1160-adoptstop-');
    const store = await makeTmpDir('hyp1160-adoptstop-store-');
    await fsp.writeFile(
      path.join(dir, 'package.json'),
      JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
    );
    // A real "server a previous session spawned": detached (its own process
    // group, like the manager's own spawns) HTTP server that prints its port.
    const serverScript = path.join(dir, 'fake-dev-server.mjs');
    await fsp.writeFile(
      serverScript,
      "import http from 'node:http';\n" +
        "const server = http.createServer((req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>ok</html>'); });\n" +
        "server.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + server.address().port + '\\n'));\n",
    );
    const child = spawn(process.execPath, [serverScript], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const { promise: portReady, resolve: portKnown, reject: portFailed } = Promise.withResolvers<number>();
    let out = '';
    child.stdout?.on('data', (data: Buffer) => {
      out += data.toString();
      const match = out.match(/PORT (\d+)/);
      if (match) portKnown(Number(match[1]));
    });
    child.on('error', portFailed);
    setTimeout(() => portFailed(new Error('fake dev server did not report a port')), 10_000);
    const serverPort = await portReady;
    const serverPid = child.pid as number;
    // The recorded command's identity token ('bun') matches the live command
    // line: the suite runs under `bun test`, so process.execPath is bun.
    recordOwnedDevServer({ pid: serverPid, projectPath: dir, command: 'bun run dev', startedAt: Date.now() }, store);

    const restore = stubWorkspace(dir, serverPort);
    const manager = new DevServerManager(dir);
    const priv = manager as unknown as ManagerPrivates & {
      _findFreePort: (start: number) => Promise<number>;
      _waitForReady: (timeout: number, gen?: number) => Promise<void>;
    };
    priv._orphanBaseDir = store;
    try {
      const attached = await manager.start();
      expect(attached.status).toBe('running');
      expect(attached.port).toBe(serverPort);
      expect(priv._process).toBe(null); // attached, not spawned

      await manager.stop();
      // The adopted server was killed via its recorded process group and its
      // registry record cleared — nothing may re-attach to it.
      expect(isProcessAlive(serverPid)).toBe(false);
      expect(readOwnedDevServers(dir, store)).toEqual([]);
      expect(manager.getState().status).toBe('stopped');

      // A second start must go down the SPAWN path (short-circuited here by the
      // readiness stub), not re-attach to the dead port.
      priv._findFreePort = mock(async () => serverPort + 1);
      priv._waitForReady = mock(async () => {
        throw new Error('test-shortcircuit-ready');
      });
      const respawned = await manager.start();
      expect(respawned.status).toBe('error');
      expect(respawned.error).toBe('test-shortcircuit-ready');
    } finally {
      restore();
      manager.dispose();
      // Cleanup if an assertion above failed before stop() could kill it.
      if (isProcessAlive(serverPid)) {
        try {
          process.kill(-serverPid, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    }
  });
});

describe('HYP-1160 (e): plan invalidation on edited scripts (PR #692 review)', () => {
  it('a wrapper-ness flip (nx run → vite) invalidates the persisted plan', async () => {
    const { writeSpawnPlan, readSpawnPlan } = await import('../services/devServerSpawnPlan');
    const root = await makeTmpDir('hyp1160-flip-root-');
    const app = path.join(root, 'targets', 'app');
    await fsp.mkdir(app, { recursive: true });
    const store = await makeTmpDir('hyp1160-flip-store-');
    await fsp.writeFile(path.join(root, 'bun.lock'), '');
    await fsp.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'vite' } }));
    // Plan persisted when `dev` was an nx wrapper executed from the root.
    writeSpawnPlan(
      {
        version: 2,
        projectPath: app,
        script: 'dev',
        packageManager: 'bun',
        cwd: root,
        wrapper: true,
        branch: 'wrapper-script',
        createdAt: Date.now(),
      },
      store,
    );

    const manager = new DevServerManager(app);
    const priv = manager as unknown as ManagerPrivates;
    priv._spawnPlanBaseDir = store;
    // The script is now a plain dev-server invocation — wrapper-ness flipped,
    // so the plan is discarded and re-resolved with cwd back at the package dir.
    const plan = await priv._resolveSpawnPlan('dev', { dev: 'vite' });
    expect(plan.branch).toBe('pm-run');
    expect(plan.cwd).toBe(app);
    expect(plan.cmd).toBe('bun');
    expect(readSpawnPlan(app, store)?.branch).toBe('pm-run');
    manager.dispose();
  });

  it('a shell-safety flip with UNCHANGED wrapper-ness does not inherit the workspace-root cwd', async () => {
    // Persisted: `nx run app:dev` (shell-safe wrapper → cwd = workspace root).
    // Live:      `nx run app:dev && nx run other:dev` (still a wrapper, but no
    //            longer shell-safe → the correct cwd is the PACKAGE dir).
    //            Reusing the persisted root cwd would run `bun run dev` at the
    //            ROOT and boot the wrong package's script (P2, PR #692 review).
    const { writeSpawnPlan, readSpawnPlan } = await import('../services/devServerSpawnPlan');
    const root = await makeTmpDir('hyp1160-shellflip-root-');
    const app = path.join(root, 'targets', 'app');
    await fsp.mkdir(app, { recursive: true });
    const store = await makeTmpDir('hyp1160-shellflip-store-');
    await fsp.writeFile(path.join(root, 'bun.lock'), '');
    const edited = 'nx run app:dev && nx run other:dev';
    await fsp.writeFile(path.join(app, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: edited } }));
    writeSpawnPlan(
      {
        version: 2,
        projectPath: app,
        script: 'dev',
        packageManager: 'bun',
        cwd: root,
        wrapper: true,
        branch: 'wrapper-script',
        createdAt: Date.now(),
      },
      store,
    );

    const manager = new DevServerManager(app);
    const priv = manager as unknown as ManagerPrivates;
    priv._spawnPlanBaseDir = store;
    const plan = await priv._resolveSpawnPlan('dev', { dev: edited });
    expect(plan.branch).toBe('pm-run');
    expect(plan.cwd).toBe(app); // package dir, NOT the persisted workspace root
    expect(plan.cmd).toBe('bun');
    expect(plan.args).toEqual(['run', 'dev']);
    const rewritten = readSpawnPlan(app, store);
    expect(rewritten?.branch).toBe('pm-run');
    expect(rewritten?.cwd).toBe(app);
    manager.dispose();
  });
});
