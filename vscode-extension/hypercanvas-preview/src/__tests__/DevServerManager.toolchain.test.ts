import { afterEach, describe, expect, it, mock } from 'bun:test';

// PreviewProxy reads iframe-*.js via fs.readFileSync AT IMPORT TIME (built next to the
// bundle, absent in src/). Stub readFileSync for iframe-* only — same pattern as the
// other DevServerManager suites. Capture the ORIGINAL first (bun mutates the
// namespace in place).
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

const fsp = await import('node:fs/promises');
const os = await import('node:os');
const path = await import('node:path');
// Dynamic imports are intentional (same as the other DevServerManager suites):
// mock.module must be registered BEFORE the module under test is linked, so
// static imports cannot work here.
const vscode = await import('vscode');
const { buildDevServerChildPath, DevServerManager, requiredLocalBinaries, truncatePathForLog } =
  await import('../services/DevServerManager');
const { ToolchainInstallError } = await import('../services/toolchainInstaller');
const { _resetToolchainAvailabilityCacheForTests } = await import('../services/toolchainDetector');

/**
 * HYP-1169 — DevServerManager wiring: _runStart resolves the spawn plan, then
 * (BEFORE spawning) ensures the required tool exists, proactively installs
 * project dependencies, and refreshes the child PATH. The toolchain services
 * themselves are unit-tested in services/__tests__/toolchain*.test.ts; here
 * they are replaced through the manager's `_toolchain` seam so the ordering
 * and failure semantics of the WIRING are what get asserted.
 */

type ToolchainSeam = {
  detectAvailableTools: ReturnType<typeof mock>;
  ensureTool: ReturnType<typeof mock>;
  ensureDependencies: ReturnType<typeof mock>;
  shouldInstallDependencies: ReturnType<typeof mock>;
  findMissingLocalBinaries: ReturnType<typeof mock>;
  refreshPathForChild: ReturnType<typeof mock>;
};

type ManagerPrivates = {
  _toolchain: ToolchainSeam;
  _spawnPlanBaseDir: string;
  _orphanBaseDir: string;
  _process: unknown;
  _waitForReady: (timeout: number, gen?: number) => Promise<void>;
  _outputChannel: { appendLine(line: string): void; append(text: string): void; show(): void };
};

const tmpDirs: string[] = [];

async function makeTmpDir(prefix: string): Promise<string> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(async () => {
  _resetToolchainAvailabilityCacheForTests();
  while (tmpDirs.length > 0) {
    const dir = tmpDirs.pop();
    if (dir) await fsp.rm(dir, { recursive: true, force: true });
  }
});

async function makeProject(): Promise<string> {
  const dir = await makeTmpDir('hyp1169-wire-');
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { dev: 'vite' }, devDependencies: { vite: '^5.0.0' } }),
  );
  return dir;
}

/** A wrapper-script (HYP-1160) project: the dev script IS the command (`nx run …`). */
async function makeWrapperProject(script = 'nx run conloca-app:dev'): Promise<string> {
  const dir = await makeTmpDir('hyp1169-wrap-');
  await fsp.writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'x', scripts: { dev: script }, devDependencies: { nx: '^22.0.0' } }),
  );
  return dir;
}

/** Point the global vscode workspace mock at `dir` (same helper shape as the HYP-1160 suite). */
function stubWorkspace(dir: string): () => void {
  const ws = vscode.workspace as unknown as { workspaceFolders: unknown[] };
  const savedFolders = ws.workspaceFolders;
  ws.workspaceFolders = [{ uri: { fsPath: dir }, name: 'ws', index: 0 }];
  return () => {
    ws.workspaceFolders = savedFolders;
  };
}

const ALL_AVAILABLE = {
  node: true,
  npm: true,
  bun: true,
  pnpm: true,
  yarn: true,
  winget: null,
  brew: null,
  linuxDistro: null,
};

function stubToolchain(overrides: Partial<{ [K in keyof ToolchainSeam]: ToolchainSeam[K] }> = {}): ToolchainSeam {
  return {
    detectAvailableTools: mock(async () => ALL_AVAILABLE),
    ensureTool: mock(async () => [] as string[]),
    ensureDependencies: mock(async () => 'installed' as const),
    shouldInstallDependencies: mock(async () => true),
    findMissingLocalBinaries: mock(async () => [] as string[]),
    refreshPathForChild: mock(async () => '/fresh/path'),
    ...overrides,
  };
}

function wireManager(
  dir: string,
  toolchain: ToolchainSeam,
): { manager: InstanceType<typeof DevServerManager>; priv: ManagerPrivates } {
  const manager = new DevServerManager(dir);
  const priv = manager as unknown as ManagerPrivates;
  priv._toolchain = toolchain;
  // Short-circuit the readiness poll: the spawned `npm run dev` in a tmp dir
  // exits immediately; we only care about what happened BEFORE the spawn.
  priv._waitForReady = mock(async () => {
    throw new Error('test-shortcircuit-ready');
  });
  return { manager, priv };
}

describe('HYP-1169 wiring: _runStart prepares the toolchain before spawning', () => {
  it('runs the one-shot pipeline in order: globals → deps → verify → refresh-PATH → spawn', async () => {
    const dir = await makeProject();
    const order: string[] = [];
    const toolchain = stubToolchain({
      ensureTool: mock(async () => {
        order.push('ensureTool');
        return [] as string[];
      }),
      ensureDependencies: mock(async () => {
        order.push('ensureDependencies');
        return 'installed' as const;
      }),
      findMissingLocalBinaries: mock(async () => {
        order.push('verify');
        return [] as string[];
      }),
      refreshPathForChild: mock(async () => {
        order.push('refreshPathForChild');
        // The PATH refresh feeds the spawn env, so it must happen while no
        // child exists yet — capture the proof inside the seam.
        order.push(priv._process === null ? 'pre-spawn' : 'post-spawn');
        return '/fresh/path';
      }),
    });
    const restore = stubWorkspace(dir);
    const { manager, priv } = wireManager(dir, toolchain);
    try {
      const state = await manager.start();
      expect(state.error).toBe('test-shortcircuit-ready');
      expect(order).toEqual(['ensureTool', 'ensureDependencies', 'verify', 'refreshPathForChild', 'pre-spawn']);
      // npm project → the required tool is node (npm ships with it).
      expect(toolchain.ensureTool).toHaveBeenCalledWith('node', expect.anything());
      // ensureDependencies runs in the PLAN cwd (the project dir here).
      expect(toolchain.ensureDependencies).toHaveBeenCalledWith(dir, 'npm', expect.anything());
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('skips the registry/PATH refresh entirely on a warm start (nothing installed, no verified dirs)', async () => {
    const dir = await makeProject();
    const toolchain = stubToolchain({
      shouldInstallDependencies: mock(async () => false),
    });
    const restore = stubWorkspace(dir);
    const { manager } = wireManager(dir, toolchain);
    try {
      const state = await manager.start();
      // Reached the spawn (fails only at the test short-circuit)…
      expect(state.error).toBe('test-shortcircuit-ready');
      // …without paying for a PATH refresh or a dependency install.
      expect(toolchain.refreshPathForChild).not.toHaveBeenCalled();
      expect(toolchain.ensureDependencies).not.toHaveBeenCalled();
      // …but the verification phase still ran (an incomplete node_modules is
      // caught even when mtimes look fresh).
      expect(toolchain.findMissingLocalBinaries).toHaveBeenCalled();
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('requires bun for a bun lockfile project', async () => {
    const dir = await makeProject();
    await fsp.writeFile(path.join(dir, 'bun.lock'), '');
    const toolchain = stubToolchain();
    const restore = stubWorkspace(dir);
    const { manager } = wireManager(dir, toolchain);
    try {
      await manager.start();
      expect(toolchain.ensureTool).toHaveBeenCalledWith('bun', expect.anything());
      expect(toolchain.ensureDependencies).toHaveBeenCalledWith(dir, 'bun', expect.anything());
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('a tool-install failure surfaces a friendly error state (no raw ENOENT, no spawn)', async () => {
    const dir = await makeProject();
    const toolchain = stubToolchain({
      detectAvailableTools: mock(async () => ({ ...ALL_AVAILABLE, node: false, npm: false })),
      ensureTool: mock(async () => {
        throw new ToolchainInstallError(
          'HyperIDE could not auto-install node on this machine. Install it manually, then restart VS Code.',
          'node',
          'https://nodejs.org/en/download',
        );
      }),
    });
    const restore = stubWorkspace(dir);
    const { manager, priv } = wireManager(dir, toolchain);
    try {
      const state = await manager.start();
      expect(state.status).toBe('error');
      expect(state.error).toContain('could not auto-install node');
      expect(state.error).not.toContain('ENOENT');
      // The spawn was never reached.
      expect(priv._process).toBe(null);
      // Dependencies are irrelevant once the tool itself is missing.
      expect(toolchain.ensureDependencies).not.toHaveBeenCalled();
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('a dependency-install failure STOPS the pipeline with a friendly error + Retry — no blind spawn', async () => {
    const dir = await makeProject();
    const toolchain = stubToolchain({
      ensureDependencies: mock(async () => {
        throw new Error("'bun' is not recognized as an internal or external command");
      }),
    });
    const restore = stubWorkspace(dir);
    const { manager, priv } = wireManager(dir, toolchain);
    try {
      const state = await manager.start();
      expect(state.status).toBe('error');
      expect(state.error).toContain('not recognized');
      // The pipeline stopped: no binary verification, no PATH refresh, NO SPAWN.
      expect(toolchain.findMissingLocalBinaries).not.toHaveBeenCalled();
      expect(toolchain.refreshPathForChild).not.toHaveBeenCalled();
      expect(priv._process).toBe(null);
      // The user was offered a Retry (and a way to the install log).
      const errorCalls = (vscode.window.showErrorMessage as ReturnType<typeof mock>).mock.calls;
      const depsError = errorCalls.find((call) =>
        String(call[0]).includes('could not install the project dependencies'),
      );
      expect(depsError).toBeDefined();
      expect(depsError).toContain('Retry');
      expect(depsError).toContain('Open Logs');
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('the Retry action re-runs the dependency install once and then proceeds', async () => {
    const dir = await makeProject();
    let attempts = 0;
    const toolchain = stubToolchain({
      ensureDependencies: mock(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('network hiccup');
        return 'installed' as const;
      }),
    });
    (vscode.window.showErrorMessage as ReturnType<typeof mock>).mockImplementationOnce(async () => 'Retry' as never);
    const restore = stubWorkspace(dir);
    const { manager } = wireManager(dir, toolchain);
    try {
      const state = await manager.start();
      expect(attempts).toBe(2);
      // The retry succeeded → the pipeline proceeded all the way to the spawn.
      expect(state.error).toBe('test-shortcircuit-ready');
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('deps install succeeded but node_modules/.bin/nx is absent → friendly error naming nx, NO spawn', async () => {
    const dir = await makeWrapperProject();
    const toolchain = stubToolchain({
      findMissingLocalBinaries: mock(async (_cwd: string, binaries: string[]) => binaries),
    });
    const restore = stubWorkspace(dir);
    const { manager, priv } = wireManager(dir, toolchain);
    try {
      const state = await manager.start();
      expect(state.status).toBe('error');
      expect(state.error).toContain("'nx'");
      expect(state.error).toContain('node_modules/.bin');
      expect(state.error).toContain('HyperIDE Dev Server');
      expect(priv._process).toBe(null);
      // The verifier was asked for exactly the binary the wrapper script executes.
      expect(toolchain.findMissingLocalBinaries).toHaveBeenCalledWith(dir, ['nx']);
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('progress: step i/N messages per phase and an Open Logs offer that reveals the output channel', async () => {
    const dir = await makeProject();
    await fsp.writeFile(path.join(dir, 'bun.lock'), '');
    const toolchain = stubToolchain({
      detectAvailableTools: mock(async () => ({ ...ALL_AVAILABLE, bun: false })),
    });
    const messages: string[] = [];
    (vscode.window.withProgress as ReturnType<typeof mock>).mockImplementationOnce((async (
      _options: unknown,
      task: (progress: { report(m: { message: string }): void }, token: unknown) => unknown,
    ) =>
      Promise.resolve(
        task(
          {
            report: (m: { message: string }) => {
              messages.push(m.message);
            },
          },
          { isCancellationRequested: false },
        ),
      )) as never);
    (vscode.window.showInformationMessage as ReturnType<typeof mock>).mockImplementationOnce(
      (async () => 'Open Logs') as never,
    );
    const restore = stubWorkspace(dir);
    const { manager, priv } = wireManager(dir, toolchain);
    const showMock = mock();
    priv._outputChannel = { appendLine: mock(), append: mock(), show: showMock, dispose: mock() } as never;
    try {
      await manager.start();
      expect(messages).toEqual([
        'Step 1/3: Checking bun',
        'Step 2/3: Installing project dependencies (bun install)…',
        'Step 3/3: Verifying installation…',
      ]);
      // The Open Logs .then callback is a microtask chained on the mocked
      // message promise — it has run by the time start() (real async I/O)
      // resolves. No timer needed.
      expect(showMock).toHaveBeenCalled();
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('verified tool binary dirs are prepended to the child PATH (and logged for one-glance diagnosis)', async () => {
    const dir = await makeProject();
    await fsp.writeFile(path.join(dir, 'bun.lock'), '');
    const toolchain = stubToolchain({
      ensureTool: mock(async () => ['C:\\Users\\x\\.bun\\bin']),
    });
    const restore = stubWorkspace(dir);
    const { manager, priv } = wireManager(dir, toolchain);
    const logs: string[] = [];
    priv._outputChannel = {
      appendLine: (line: string) => logs.push(line),
      append: mock(),
      show: mock(),
      dispose: mock(),
    } as never;
    try {
      const state = await manager.start();
      expect(state.error).toBe('test-shortcircuit-ready');
      const pathLine = logs.find((line) => line.startsWith('[DevServer] Child PATH: '));
      expect(pathLine).toBeDefined();
      const bunDir = pathLine?.indexOf('C:\\Users\\x\\.bun\\bin') ?? -1;
      const refreshed = pathLine?.indexOf('/fresh/path') ?? -1;
      expect(bunDir).toBeGreaterThanOrEqual(0);
      expect(refreshed).toBeGreaterThan(bunDir); // verified dir BEFORE the refreshed PATH
      // The deps install saw the verified dir on ITS env PATH too.
      const depsCall = toolchain.ensureDependencies.mock.calls[0];
      const depsExec = (depsCall?.[2] as { exec?: { env?: { PATH?: string } } })?.exec;
      expect(depsExec?.env?.PATH?.startsWith('C:\\Users\\x\\.bun\\bin')).toBe(true);
    } finally {
      restore();
      manager.dispose();
    }
  });

  it('the spawn env PATH prepends node_modules/.bin to the refreshed toolchain PATH', () => {
    const childPath = buildDevServerChildPath('/proj', '/fresh/toolchain/path');
    const sep = process.platform === 'win32' ? ';' : ':';
    expect(childPath).toBe(`/proj/node_modules/.bin${sep}/fresh/toolchain/path`);
  });
});

describe('requiredLocalBinaries (HYP-1169 round 2: what the normalized spawn command needs from .bin)', () => {
  it('a bare wrapper binary is required locally (nx after HYP-1160 normalization)', () => {
    expect(requiredLocalBinaries('nx', ['run', 'conloca-app:dev'], 'wrapper-script')).toEqual(['nx']);
  });

  it('a runner token (bunx/npx) shifts the requirement to its target binary', () => {
    expect(requiredLocalBinaries('bunx', ['nx', 'run', 'conloca-app:dev'], 'wrapper-script')).toEqual(['nx']);
    expect(requiredLocalBinaries('npx', ['--yes', 'vite', 'dev'], 'wrapper-script')).toEqual(['vite']);
  });

  it('package managers and runtimes themselves are never local requirements', () => {
    expect(requiredLocalBinaries('bun', ['x', 'nx'], 'wrapper-script')).toEqual([]);
    expect(requiredLocalBinaries('node', ['server.js'], 'wrapper-script')).toEqual([]);
  });

  it('the pm-run branch has no local requirement from the spawn command (the pm resolves .bin itself)', () => {
    expect(requiredLocalBinaries('bun', ['run', 'dev'], 'pm-run')).toEqual([]);
    expect(requiredLocalBinaries('npm', ['run', 'dev'], 'pm-run')).toEqual([]);
  });
});

describe('truncatePathForLog', () => {
  it('keeps short PATHs verbatim', () => {
    expect(truncatePathForLog('/a:/b')).toBe('/a:/b');
  });

  it('truncates long PATHs with an entry count + total length summary', () => {
    const long = ['C:\\a', 'C:\\b', 'C:\\c', 'C:\\d', 'C:\\e', 'C:\\f', 'C:\\g', 'C:\\h'].join(';');
    const rendered = truncatePathForLog(long, 3);
    expect(rendered).toBe(`C:\\a;C:\\b;C:\\c;… (+5 more entries, ${long.length} chars total)`);
  });
});
