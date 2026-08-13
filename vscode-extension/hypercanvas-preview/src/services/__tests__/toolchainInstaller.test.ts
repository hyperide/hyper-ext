import { afterEach, describe, expect, it, mock, vi } from 'bun:test';
import { EventEmitter } from 'node:events';
import {
  _resetToolchainAvailabilityCacheForTests,
  detectAvailableTools,
  invalidateToolAvailability,
  markToolAvailable,
  type ToolAvailability,
  type ToolchainTool,
} from '../toolchainDetector';
import {
  buildInstallPlan,
  createThrottledLineReporter,
  ensureDependencies,
  ensureTool,
  findMissingLocalBinaries,
  installDocsUrl,
  isToleratedExitCode,
  requiredToolsForPackageManager,
  shouldInstallDependencies,
  ToolchainInstallError,
  type InstallEnvironment,
  type SpawnStepProcess,
  type StepChildProcess,
} from '../toolchainInstaller';

/**
 * HYP-1169 — install plans for the self-healing toolchain. NO real installs:
 * plan building is pure; execution tests inject a fake `runStep` seam.
 */

function env(overrides: Partial<InstallEnvironment>): InstallEnvironment {
  return {
    platform: 'linux',
    winget: false,
    brew: false,
    linuxDistro: null,
    nodeAvailable: false,
    sudoConfirmed: false,
    ...overrides,
  };
}

function availability(overrides: Partial<ToolAvailability>): ToolAvailability {
  return {
    node: false,
    npm: false,
    bun: false,
    pnpm: false,
    yarn: false,
    winget: null,
    brew: null,
    linuxDistro: null,
    ...overrides,
  };
}

/**
 * A fake step child process (the ToolchainExecDeps.spawnProcess seam): emits
 * the given stdout lines, then exits with `exitCode`. No real process ever
 * spawns — the repo convention for installer tests.
 */
function fakeChild(exitCode: number | null, ...stdoutLines: string[]): StepChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter();
  queueMicrotask(() => {
    for (const line of stdoutLines) stdout.emit('data', Buffer.from(`${line}\n`));
    child.emit('exit', exitCode);
  });
  return { stdout, stderr, on: child.on.bind(child), kill: mock(() => {}) };
}

describe('requiredToolsForPackageManager', () => {
  it('maps each package manager to the tools that must exist before spawn', () => {
    expect(requiredToolsForPackageManager('bun')).toEqual(['bun']);
    expect(requiredToolsForPackageManager('npm')).toEqual(['node']); // npm ships with node
    expect(requiredToolsForPackageManager('pnpm')).toEqual(['pnpm']); // node chained inside the plan
    expect(requiredToolsForPackageManager('yarn')).toEqual(['yarn']);
  });
});

describe('buildInstallPlan — bun', () => {
  it('win32 + winget → winget install Oven-sh.Bun', () => {
    const plan = buildInstallPlan('bun', env({ platform: 'win32', winget: true }));
    expect(plan).toHaveLength(1);
    expect(plan[0].command).toBe('winget install --id Oven-sh.Bun -e --silent');
    expect(plan[0].requiresSudo).toBe(false);
  });

  it('win32 without winget → official powershell installer', () => {
    const plan = buildInstallPlan('bun', env({ platform: 'win32', winget: false }));
    expect(plan).toHaveLength(1);
    expect(plan[0].command).toContain('powershell');
    expect(plan[0].command).toContain('bun.sh/install.ps1');
  });

  it('darwin + brew → brew install bun', () => {
    const plan = buildInstallPlan('bun', env({ platform: 'darwin', brew: true }));
    expect(plan.map((s) => s.command)).toEqual(['brew install bun']);
  });

  it('darwin without brew → official curl installer (never bootstraps brew)', () => {
    const plan = buildInstallPlan('bun', env({ platform: 'darwin', brew: false }));
    expect(plan).toHaveLength(1);
    expect(plan[0].command).toBe('curl -fsSL https://bun.sh/install | bash');
    expect(plan[0].command).not.toContain('brew');
  });

  it('linux → official curl installer, never sudo', () => {
    const plan = buildInstallPlan('bun', env({ platform: 'linux', linuxDistro: 'debian' }));
    expect(plan.map((s) => s.command)).toEqual(['curl -fsSL https://bun.sh/install | bash']);
    expect(plan.every((s) => !s.requiresSudo)).toBe(true);
  });
});

describe('buildInstallPlan — node (also serves npm)', () => {
  it('win32 + winget → winget OpenJS.NodeJS; without winget there is NO auto plan', () => {
    const withWinget = buildInstallPlan('node', env({ platform: 'win32', winget: true }));
    expect(withWinget.map((s) => s.command)).toEqual(['winget install --id OpenJS.NodeJS -e --silent']);
    expect(buildInstallPlan('node', env({ platform: 'win32', winget: false }))).toEqual([]);
  });

  it('darwin + brew → brew install node; without brew there is NO auto plan', () => {
    expect(buildInstallPlan('node', env({ platform: 'darwin', brew: true })).map((s) => s.command)).toEqual([
      'brew install node',
    ]);
    expect(buildInstallPlan('node', env({ platform: 'darwin', brew: false }))).toEqual([]);
  });

  it('linux + apt distro installs via the distro package manager ONLY when sudo was confirmed', () => {
    const confirmed = buildInstallPlan('node', env({ platform: 'linux', linuxDistro: 'debian', sudoConfirmed: true }));
    expect(confirmed.length).toBeGreaterThan(0);
    expect(confirmed.every((s) => s.requiresSudo)).toBe(true);
    expect(confirmed.some((s) => s.command.includes('apt-get'))).toBe(true);

    // No confirmation → no plan at all (never a bare sudo without the flag).
    expect(buildInstallPlan('node', env({ platform: 'linux', linuxDistro: 'debian' }))).toEqual([]);
    expect(buildInstallPlan('node', env({ platform: 'linux', linuxDistro: 'ubuntu' }))).toEqual([]);
  });

  it('linux on a non-apt distro never auto-installs node', () => {
    expect(buildInstallPlan('node', env({ platform: 'linux', linuxDistro: 'other', sudoConfirmed: true }))).toEqual([]);
  });

  it('npm maps to the node install plan (npm ships with node)', () => {
    const plan = buildInstallPlan('npm', env({ platform: 'win32', winget: true }));
    expect(plan.map((s) => s.command)).toEqual(['winget install --id OpenJS.NodeJS -e --silent']);
  });
});

describe('buildInstallPlan — pnpm/yarn via corepack', () => {
  it('chains the node install first when node is missing', () => {
    const plan = buildInstallPlan('pnpm', env({ platform: 'darwin', brew: true, nodeAvailable: false }));
    expect(plan.map((s) => s.command)).toEqual([
      'brew install node',
      'corepack enable',
      'corepack prepare pnpm@latest --activate',
    ]);
  });

  it('is corepack-only when node is already available', () => {
    const plan = buildInstallPlan('yarn', env({ platform: 'linux', linuxDistro: 'debian', nodeAvailable: true }));
    expect(plan.map((s) => s.command)).toEqual(['corepack enable', 'corepack prepare yarn@latest --activate']);
  });

  it('has no plan when node is missing AND node cannot be auto-installed', () => {
    expect(buildInstallPlan('pnpm', env({ platform: 'darwin', brew: false, nodeAvailable: false }))).toEqual([]);
  });
});

describe('buildInstallPlan — the no-sudo invariant', () => {
  it('no plan EVER contains a sudo command unless sudoConfirmed is set', () => {
    const tools = ['bun', 'node', 'npm', 'pnpm', 'yarn'] as const;
    const platforms = ['win32', 'darwin', 'linux'] as const;
    for (const tool of tools) {
      for (const platform of platforms) {
        for (const winget of [true, false]) {
          for (const brew of [true, false]) {
            for (const linuxDistro of ['debian', 'ubuntu', 'other', null] as const) {
              for (const nodeAvailable of [true, false]) {
                const plan = buildInstallPlan(
                  tool,
                  env({ platform, winget, brew, linuxDistro, nodeAvailable, sudoConfirmed: false }),
                );
                for (const step of plan) {
                  expect(step.requiresSudo).toBe(false);
                  expect(step.command).not.toMatch(/(?:^|\s)sudo\s/);
                }
              }
            }
          }
        }
      }
    }
  });

  it('every step carries the official docs URL for its tool', () => {
    const plan = buildInstallPlan('bun', env({ platform: 'darwin', brew: true }));
    expect(plan[0].docsUrl).toBe(installDocsUrl('bun'));
  });
});

describe('ensureTool — execution', () => {
  const output = { appendLine: mock() };

  it('skips the install when the tool is already available AND passes a live probe', async () => {
    const runStep = mock(async () => {});
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: true }),
      output,
      exec: {
        runStep,
        // The tool answers only once its probe-resolved dir is on PATH (the
        // plain-env fast path fails first, then the probe dirs rescue it).
        verify: async (_tool, env) => (env.PATH ?? '').includes('/verified/bun/bin'),
        probeDirs: async () => ['/verified/bun/bin'],
      },
    });
    expect(runStep).not.toHaveBeenCalled();
    expect(dirs).toEqual(['/verified/bun/bin']);
  });

  it('runs every plan step through the runner, in order', async () => {
    const commands: string[] = [];
    // Round 3: a live pre-install probe can skip the whole plan, so the
    // install-path tests gate `verify` on the steps having actually run.
    let installed = false;
    await ensureTool('pnpm', {
      availability: availability({ brew: true, node: false }),
      output,
      exec: {
        platform: 'darwin',
        verify: async () => installed,
        probeDirs: async () => [],
        runStep: async (step) => {
          commands.push(step.command);
          installed = true;
        },
      },
    });
    expect(commands).toEqual(['brew install node', 'corepack enable', 'corepack prepare pnpm@latest --activate']);
  });

  it('asks for sudo confirmation on linux node installs and runs the apt plan when confirmed', async () => {
    const commands: string[] = [];
    let installed = false;
    const confirmSudo = mock(async () => true);
    await ensureTool('node', {
      availability: availability({ linuxDistro: 'debian' }),
      output,
      confirmSudo,
      exec: {
        platform: 'linux',
        verify: async () => installed,
        probeDirs: async () => [],
        runStep: async (step) => {
          commands.push(step.command);
          installed = true;
        },
      },
    });
    expect(confirmSudo).toHaveBeenCalled();
    expect(commands.some((c) => c.includes('apt-get'))).toBe(true);
  });

  it('throws ToolchainInstallError with the docs URL when sudo is declined', async () => {
    const confirmSudo = mock(async () => false);
    const error = await ensureTool('node', {
      availability: availability({ linuxDistro: 'debian' }),
      output,
      confirmSudo,
      exec: { platform: 'linux', runStep: async () => {}, verify: async () => false, probeDirs: async () => [] },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect((error as ToolchainInstallError).docsUrl).toBe(installDocsUrl('node'));
  });

  it('asks for sudo confirmation when a pnpm install must chain a node install on linux', async () => {
    const commands: string[] = [];
    let installed = false;
    const confirmSudo = mock(async () => true);
    await ensureTool('pnpm', {
      availability: availability({ linuxDistro: 'ubuntu', node: false }),
      output,
      confirmSudo,
      exec: {
        platform: 'linux',
        verify: async () => installed,
        probeDirs: async () => [],
        runStep: async (step) => {
          commands.push(step.command);
          installed = true;
        },
      },
    });
    expect(confirmSudo).toHaveBeenCalled();
    expect(commands[0]).toContain('apt-get');
    expect(commands.slice(1)).toEqual(['corepack enable', 'corepack prepare pnpm@latest --activate']);
  });

  it('throws ToolchainInstallError with the docs URL when no auto-install exists', async () => {
    const error = await ensureTool('node', {
      availability: availability({}),
      output,
      exec: { platform: 'darwin', runStep: async () => {}, verify: async () => false, probeDirs: async () => [] },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect((error as ToolchainInstallError).tool).toBe('node');
    expect((error as ToolchainInstallError).message).toContain('node');
  });
});

/**
 * Populate the session availability cache with real (default-deps) probes,
 * then force one tool's entry. Hoisted to module scope: the round-3
 * describes prime the cache the same way.
 */
async function primeAvailabilityCache(tool: ToolchainTool, available: boolean): Promise<void> {
  _resetToolchainAvailabilityCacheForTests();
  await detectAvailableTools(); // populates the session cache (real probes, no installs)
  if (available) markToolAvailable(tool);
  else invalidateToolAvailability(tool);
}

describe('ensureTool — post-install verification gates markToolAvailable (HYP-1169 round 2)', () => {
  const output = { appendLine: mock() };

  afterEach(() => {
    _resetToolchainAvailabilityCacheForTests();
  });

  it('a successful install that FAILS the live --version probe throws and never marks the tool available', async () => {
    await primeAvailabilityCache('bun', false);
    const runStep = mock(async () => {});
    const error = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        runStep,
        verify: async () => false, // installer exited 0, but bun is NOT reachable
        probeDirs: async () => [],
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect((error as ToolchainInstallError).tool).toBe('bun');
    expect((error as Error).message).toContain('not reachable');
    // The session cache must NOT claim bun exists — the next start re-runs the heal.
    expect((await detectAvailableTools()).bun).toBe(false);
  });

  it('win32: after install the probe finds bun in %USERPROFILE%\\.bun\\bin and the verify env PATH contains it', async () => {
    await primeAvailabilityCache('bun', false);
    let verifiedPath = '';
    // Round 3: the pre-install live probe runs with the SAME seams — gate on
    // the install having run so this test exercises the post-install path.
    let installed = false;
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        runStep: async () => {
          installed = true;
        },
        probeDirs: async () => ['C:\\Users\\x\\.bun\\bin'],
        verify: async (_tool, env) => {
          if (!installed) return false;
          verifiedPath = env.PATH ?? '';
          return verifiedPath.includes('C:\\Users\\x\\.bun\\bin');
        },
      },
    });
    expect(dirs).toEqual(['C:\\Users\\x\\.bun\\bin']);
    // The verified binary dir must be FIRST on the probe PATH (precedence over
    // any stale entry); the joiner is the host delimiter (';' on Windows).
    expect(verifiedPath.startsWith('C:\\Users\\x\\.bun\\bin')).toBe(true);
    expect((await detectAvailableTools()).bun).toBe(true); // marked only after the live probe passed
  });

  it('a tool marked available but truly dead (probe finds no binary anywhere) is re-healed, cache invalidated mid-heal', async () => {
    await primeAvailabilityCache('bun', true); // stale cache entry: claims bun exists
    let cacheDuringInstall: boolean | undefined;
    let installed = false;
    const runStep = mock(async () => {
      cacheDuringInstall = (await detectAvailableTools()).bun;
      installed = true;
    });
    await ensureTool('bun', {
      availability: availability({ bun: true, winget: true }),
      output,
      exec: {
        platform: 'win32',
        runStep,
        // bun answers only once its (post-install) binary dir is on PATH.
        verify: async (_tool, env) => (env.PATH ?? '').includes('C:\\Users\\x\\.bun\\bin'),
        // Before the heal the binary is nowhere; the install recreates it.
        probeDirs: async () => (installed ? ['C:\\Users\\x\\.bun\\bin'] : []),
      },
    });
    expect(runStep).toHaveBeenCalled(); // re-healed despite the cache claiming availability
    expect(cacheDuringInstall).toBe(false); // invalidated so a failed heal would retry in full
    expect((await detectAvailableTools()).bun).toBe(true); // re-marked after the verified install
  });

  it('a cached tool that IS installed but invisible to the stale process PATH is NOT reinstalled — its dir is returned', async () => {
    // Alex's exact retry case: winget installed bun, the extension host's PATH
    // never saw it. The live probe under the probe-resolved dirs succeeds, so
    // the fix is the child PATH, not another install.
    const runStep = mock(async () => {});
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: true, winget: true }),
      output,
      exec: {
        platform: 'win32',
        runStep,
        verify: async (_tool, env) => (env.PATH ?? '').includes('C:\\Users\\x\\.bun\\bin'),
        probeDirs: async () => ['C:\\Users\\x\\.bun\\bin'],
      },
    });
    expect(runStep).not.toHaveBeenCalled();
    expect(dirs).toEqual(['C:\\Users\\x\\.bun\\bin']);
  });

  it('a node install must verify BOTH node and npm before marking either', async () => {
    await primeAvailabilityCache('node', false);
    const verified: string[] = [];
    const error = await ensureTool('node', {
      availability: availability({ node: false, npm: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        runStep: async () => {},
        probeDirs: async () => [],
        verify: async (tool) => {
          verified.push(tool);
          return tool !== 'npm'; // node reachable, npm is not (broken nodejs dir)
        },
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect(verified).toContain('node');
    expect(verified).toContain('npm');
    expect((await detectAvailableTools()).node).toBe(false);
  });
});

describe('ensureTool — round 3: the live probe wins over a "missing" detection (skip the install entirely)', () => {
  const output = { appendLine: mock() };

  afterEach(() => {
    _resetToolchainAvailabilityCacheForTests();
  });

  it("bun declared missing but answering a live probe from a well-known dir → NO install, dir returned, cache patched (Alex's bun 1.3.14)", async () => {
    await primeAvailabilityCache('bun', false);
    const linksDir = 'C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links';
    const runStep = mock(async () => {});
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        runStep,
        verify: async (_tool, env) => (env.PATH ?? '').includes(linksDir),
        probeDirs: async () => [linksDir],
      },
    });
    expect(runStep).not.toHaveBeenCalled();
    expect(dirs).toEqual([linksDir]);
    // The session cache learned the truth — the next start trusts it.
    expect((await detectAvailableTools()).bun).toBe(true);
  });

  it('a node check probes BOTH node and npm before skipping the install', async () => {
    const probed: ToolchainTool[] = [];
    const runStep = mock(async () => {});
    await ensureTool('node', {
      availability: availability({ node: false, npm: false }),
      output,
      exec: {
        platform: 'darwin',
        runStep,
        verify: async (tool) => {
          probed.push(tool);
          return true;
        },
        probeDirs: async () => [],
      },
    });
    expect(runStep).not.toHaveBeenCalled();
    expect(probed).toContain('node');
    expect(probed).toContain('npm');
  });
});

describe('toleratedExitCodes — winget "already installed" is not a failure (HYP-1169 round 3)', () => {
  const output = { appendLine: mock() };

  afterEach(() => {
    _resetToolchainAvailabilityCacheForTests();
  });

  it('the winget bun/node steps tolerate 0x8A15002B; non-winget steps tolerate nothing', () => {
    expect(buildInstallPlan('bun', env({ platform: 'win32', winget: true }))[0].toleratedExitCodes).toContain(
      0x8a15002b,
    );
    expect(buildInstallPlan('node', env({ platform: 'win32', winget: true }))[0].toleratedExitCodes).toContain(
      0x8a15002b,
    );
    expect(buildInstallPlan('bun', env({ platform: 'darwin', brew: true }))[0].toleratedExitCodes ?? []).toHaveLength(
      0,
    );
    expect(buildInstallPlan('bun', env({ platform: 'linux' }))[0].toleratedExitCodes ?? []).toHaveLength(0);
  });

  it('isToleratedExitCode normalizes the signed/unsigned 32-bit forms of the same code', () => {
    expect(isToleratedExitCode([0x8a15002b], 2316632107)).toBe(true); // unsigned DWORD (what Node reports)
    expect(isToleratedExitCode([0x8a15002b], -1978335189)).toBe(true); // signed int32 form
    expect(isToleratedExitCode([0x8a15002b], 1)).toBe(false);
    expect(isToleratedExitCode([0x8a15002b], null)).toBe(false); // signal kill
    expect(isToleratedExitCode(undefined, 2316632107)).toBe(false);
  });

  it("winget's 0x8A15002B no longer aborts the start — the post-install live probe is the arbiter (Alex's exact failure)", async () => {
    await primeAvailabilityCache('bun', false);
    const linksDir = 'C:\\Users\\x\\AppData\\Local\\Microsoft\\WinGet\\Links';
    // Before winget runs, the binary is nowhere (the Links dir probe raced
    // winget's refresh); after the tolerated no-op exit it appears on disk.
    let wingetRan = false;
    const spawnProcess: SpawnStepProcess = mock(() => {
      wingetRan = true;
      return fakeChild(2316632107, 'Found an existing package already installed. No available upgrade found.');
    });
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        probeDirs: async () => (wingetRan ? [linksDir] : []),
        verify: async (_tool, env) => (env.PATH ?? '').includes(linksDir),
      },
    });
    expect(spawnProcess).toHaveBeenCalled();
    expect(dirs).toEqual([linksDir]);
    expect((await detectAvailableTools()).bun).toBe(true);
    // The tolerated exit is logged AS tolerated — never silently swallowed.
    const lines = output.appendLine.mock.calls.map((call) => String(call[0]));
    expect(lines.some((line) => line.includes('tolerated'))).toBe(true);
  });

  it('a tolerated exit that verification does NOT confirm is still a failure', async () => {
    await primeAvailabilityCache('bun', false);
    const spawnProcess = mock(() => fakeChild(2316632107));
    const error = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        probeDirs: async () => [],
        verify: async () => false,
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect((error as Error).message).toContain('not reachable');
    expect((await detectAvailableTools()).bun).toBe(false);
  });

  it('a NON-tolerated non-zero exit still fails the step immediately', async () => {
    const spawnProcess = mock(() => fakeChild(1, 'some real winget error'));
    const error = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: { platform: 'win32', spawnProcess, probeDirs: async () => [], verify: async () => false },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect((error as Error).message).toContain('exit code 1');
  });
});

describe('live install progress (HYP-1169 round 3)', () => {
  const output = { appendLine: mock() };

  afterEach(() => {
    _resetToolchainAvailabilityCacheForTests();
  });

  it('throttles output lines: the first line reports immediately, a burst collapses to the latest, dispose flushes', () => {
    // Fake timers: bun's vi.setSystemTime does not exist, but the leading
    // edge needs no fixed clock (lastReportAt starts at 0, so the first push
    // always reports) and the trailing flush is timer-driven.
    vi.useFakeTimers();
    try {
      const reported: string[] = [];
      const reporter = createThrottledLineReporter((message) => reported.push(message), 500);
      reporter.push('downloading');
      reporter.push('extracting');
      reporter.push('linking');
      expect(reported).toEqual(['downloading']);
      vi.advanceTimersByTime(500); // trailing edge: the LATEST line, never a stale one
      expect(reported).toEqual(['downloading', 'linking']);
      reporter.push('done');
      reporter.dispose(); // a pending line is never lost
      expect(reported).toEqual(['downloading', 'linking', 'done']);
    } finally {
      vi.useRealTimers();
    }
  });

  it("streams the installer's last non-empty output line into the progress sink", async () => {
    const reported: string[] = [];
    let installed = false;
    const spawnProcess = mock(() => {
      installed = true;
      return fakeChild(0, '', 'Resolving Oven-sh.Bun...', '', 'Installing...');
    });
    await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        progress: { report: (message) => reported.push(message) },
        probeDirs: async () => [],
        verify: async () => installed,
      },
    });
    expect(spawnProcess).toHaveBeenCalled();
    expect(reported[0]).toBe('Installing Bun via winget…');
    expect(reported).toContain('Resolving Oven-sh.Bun...');
    expect(reported).toContain('Installing...');
    // Blank lines never reach the notification.
    expect(reported.some((message) => message.trim() === '')).toBe(false);
  });
});

describe('shouldInstallDependencies', () => {
  const deps = (files: Record<string, number | null>) => ({
    fileExists: async (p: string) => files[p] !== undefined && files[p] !== null,
    mtimeMs: async (p: string) => files[p] ?? null,
  });

  it('installs when node_modules is missing', async () => {
    const d = deps({ '/p/package.json': 100 });
    expect(await shouldInstallDependencies('/p', 'npm', d)).toBe(true);
  });

  it('skips when node_modules exists and the manifest is not newer than the lockfile', async () => {
    const d = deps({
      '/p/package.json': 100,
      '/p/node_modules': 50,
      '/p/package-lock.json': 200,
    });
    expect(await shouldInstallDependencies('/p', 'npm', d)).toBe(false);
  });

  it('installs when package.json is newer than the lockfile (manifest edited after install)', async () => {
    const d = deps({
      '/p/package.json': 300,
      '/p/node_modules': 50,
      '/p/package-lock.json': 200,
    });
    expect(await shouldInstallDependencies('/p', 'npm', d)).toBe(true);
  });

  it('skips when there is no package.json at all', async () => {
    const d = deps({});
    expect(await shouldInstallDependencies('/p', 'npm', d)).toBe(false);
  });

  it('checks the pm-specific lockfile (bun.lock for bun)', async () => {
    const d = deps({
      '/p/package.json': 300,
      '/p/node_modules': 50,
      '/p/bun.lock': 200,
    });
    expect(await shouldInstallDependencies('/p', 'bun', d)).toBe(true);
    // npm's lockfile is absent → mtime comparison is skipped → no install.
    expect(await shouldInstallDependencies('/p', 'npm', d)).toBe(false);
  });
});

describe('ensureDependencies', () => {
  it('runs <pm> install in the given cwd when dependencies are stale', async () => {
    const ran: Array<{ command: string; cwd?: string }> = [];
    const result = await ensureDependencies('/plan/cwd', 'bun', {
      output: { appendLine: mock() },
      exec: {
        runStep: async (step) => {
          ran.push({ command: step.command, cwd: step.cwd });
        },
      },
      deps: {
        fileExists: async (p) => p === '/plan/cwd/package.json',
        mtimeMs: async () => null,
      },
    });
    expect(result).toBe('installed');
    expect(ran).toEqual([{ command: 'bun install', cwd: '/plan/cwd' }]);
  });

  it('skips when dependencies are fresh', async () => {
    const runStep = mock(async () => {});
    const result = await ensureDependencies('/p', 'npm', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: {
        fileExists: async () => true,
        mtimeMs: async (p) => (p.endsWith('package.json') ? 100 : 200),
      },
    });
    expect(result).toBe('skipped');
    expect(runStep).not.toHaveBeenCalled();
  });

  it('force: true runs the install even when dependencies look fresh (Retry path)', async () => {
    const runStep = mock(async () => {});
    const result = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: {
        fileExists: async () => true,
        mtimeMs: async (p) => (p.endsWith('package.json') ? 100 : 200),
      },
      force: true,
    });
    expect(result).toBe('installed');
    expect(runStep).toHaveBeenCalled();
  });
});

describe('findMissingLocalBinaries (HYP-1169 round 2: verify node_modules/.bin after install)', () => {
  const depsWith = (existing: readonly string[]) => ({
    fileExists: async (p: string) => existing.includes(p),
  });

  it('returns the binaries absent from <cwd>/node_modules/.bin', async () => {
    const missing = await findMissingLocalBinaries(
      '/plan/cwd',
      ['nx', 'vite'],
      depsWith(['/plan/cwd/node_modules/.bin/vite']),
    );
    expect(missing).toEqual(['nx']);
  });

  it('accepts the win32 shim extensions (.cmd/.exe/.bat/.ps1) as present', async () => {
    for (const ext of ['.cmd', '.exe', '.bat', '.ps1']) {
      const missing = await findMissingLocalBinaries(
        'C:\\proj',
        ['nx'],
        depsWith([`C:\\proj/node_modules/.bin/nx${ext}`]),
      );
      expect(missing).toEqual([]);
    }
  });

  it('returns [] for an empty requirement list (pm-run branch — the pm resolves .bin itself)', async () => {
    expect(await findMissingLocalBinaries('/p', [], depsWith([]))).toEqual([]);
  });
});
