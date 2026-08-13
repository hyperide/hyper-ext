import { afterEach, describe, expect, it, mock, vi } from 'bun:test';
import { EventEmitter } from 'node:events';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
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
  killProcessTree,
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
 *
 * Emits BOTH `exit` and `close` (real Node child processes always emit both)
 * — `runStepProcess` finalizes on `close` (HYP-1188 round 2: `exit` can fire
 * before stdio streams finish draining), so a fake that emitted only `exit`
 * would hang every caller of this helper.
 */
function fakeChild(exitCode: number | null, ...stdoutLines: string[]): StepChildProcess {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const child = new EventEmitter();
  queueMicrotask(() => {
    for (const line of stdoutLines) stdout.emit('data', Buffer.from(`${line}\n`));
    child.emit('exit', exitCode);
    child.emit('close', exitCode);
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

/** A fake step child that never exits/errors on its own — simulates a hung installer. */
function hangingChild(pid: number | undefined, kill: (signal?: NodeJS.Signals) => void): StepChildProcess {
  return { stdout: new EventEmitter(), stderr: new EventEmitter(), pid, on: () => {}, kill };
}

describe('killProcessTree (HYP-1188: Windows orphaned process tree)', () => {
  it('win32: runs taskkill /pid <pid> /t /f, THEN SIGKILLs the spawned pid too', () => {
    const calls: Array<{ command: string; args: readonly string[] }> = [];
    const kill = mock(() => {});
    killProcessTree(hangingChild(4321, kill), 'win32', (command, args) => calls.push({ command, args }));
    expect(calls).toEqual([{ command: 'taskkill', args: ['/pid', '4321', '/t', '/f'] }]);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('darwin/linux: never calls taskkill — shell:true execs a single simple command in place, so SIGKILL alone reaches the real process', () => {
    for (const platform of ['darwin', 'linux'] as const) {
      const calls: unknown[] = [];
      const kill = mock(() => {});
      killProcessTree(hangingChild(123, kill), platform, (...args) => calls.push(args));
      expect(calls).toEqual([]);
      expect(kill).toHaveBeenCalledWith('SIGKILL');
    }
  });

  it('win32 without a pid (spawn failed before the OS assigned one) skips taskkill, still SIGKILLs', () => {
    const calls: unknown[] = [];
    const kill = mock(() => {});
    killProcessTree(hangingChild(undefined, kill), 'win32', (...args) => calls.push(args));
    expect(calls).toEqual([]);
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });

  it('a taskkill failure still falls through to SIGKILL (best-effort, never leaves the child unkilled)', () => {
    const kill = mock(() => {});
    killProcessTree(hangingChild(99, kill), 'win32', () => {
      throw new Error('taskkill: ERROR: The process with PID 99 could not be terminated.');
    });
    expect(kill).toHaveBeenCalledWith('SIGKILL');
  });
});

describe('runStepProcess wiring: timeout kills the process TREE, not just the pid (HYP-1188)', () => {
  const output = { appendLine: mock() };

  afterEach(() => {
    _resetToolchainAvailabilityCacheForTests();
    output.appendLine.mockClear();
  });

  it('a timed-out step invokes killTree with the spawned child + platform (not a bare child.kill)', async () => {
    const killCalls: Array<{ pid?: number; platform: NodeJS.Platform }> = [];
    const childKill = mock(() => {});
    const child = hangingChild(777, childKill);
    const spawnProcess: SpawnStepProcess = mock(() => child);
    const error = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        timeoutMs: 15,
        probeDirs: async () => [],
        verify: async () => false,
        killTree: (c, platform) => killCalls.push({ pid: (c as StepChildProcess).pid, platform }),
      },
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    expect((error as Error).message).toContain('timed out');
    expect(killCalls).toEqual([{ pid: 777, platform: 'win32' }]);
  });

  it('an orphan that keeps writing to stdout AFTER the step already timed out never reaches the output channel', async () => {
    const stdout = new EventEmitter();
    const child: StepChildProcess = { stdout, stderr: new EventEmitter(), pid: 778, on: () => {}, kill: mock() };
    const spawnProcess: SpawnStepProcess = mock(() => child);
    const ensurePromise = ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        timeoutMs: 15,
        probeDirs: async () => [],
        verify: async () => false,
        // Simulates taskkill failing to actually stop the orphan — the onData
        // `killed` guard is the belt-and-suspenders layer for exactly this.
        killTree: () => {},
      },
    });
    const error = await ensurePromise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    output.appendLine.mockClear();
    stdout.emit('data', Buffer.from('orphaned bun.exe still downloading a tarball\n'));
    expect(output.appendLine).not.toHaveBeenCalled();
  });

  it('HYP-1188 round 3: `exit` fires but `close` never arrives (a detached child inherited the pipe and outlives the tracked process) — the step still finalizes within the bounded grace window, NOT the full step timeout', async () => {
    // `verify` is STATEFUL (false until the fake install actually runs),
    // NOT a bare `async () => true` — ensureTool's pre-install live-probe
    // (round 3 of HYP-1169: "the live probe is the arbiter in BOTH
    // directions") treats an always-true verify as "already installed" and
    // returns BEFORE ever calling `spawnProcess`, making the whole
    // exit/close/grace mechanism this test exists to exercise a no-op. This
    // shape (flip to true only once the fake child has actually exited)
    // forces the real install pipeline to run.
    let installedOk = false;
    const child: StepChildProcess = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 999,
      on: (event, listener) => {
        // 'close' is deliberately never emitted — simulates an orphan still
        // holding the inherited stdout/stderr pipe (the Windows shell:true
        // scenario). Only wire the events this fake actually fires.
        if (event === 'exit') {
          queueMicrotask(() => {
            installedOk = true;
            (listener as (code: number | null) => void)(0);
          });
        }
      },
      kill: mock(() => {}),
    };
    const spawnProcess: SpawnStepProcess = mock(() => child);
    const startedAt = Date.now();
    // A LARGE step timeout — if the grace-window fix regresses back to
    // waiting unconditionally for 'close', this test would hang for the
    // full timeout instead of the ~300ms grace window, making the
    // regression obvious (a slow test) rather than silent.
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        timeoutMs: 60_000,
        probeDirs: async () => [],
        verify: async () => installedOk,
      },
    });
    const elapsedMs = Date.now() - startedAt;
    expect(spawnProcess).toHaveBeenCalledTimes(1); // proves the install step actually ran, not a pre-check short-circuit
    expect(dirs).toEqual([]); // resolved successfully — exit code 0, not timed out/killed
    expect(elapsedMs).toBeLessThan(5_000); // well under the 60s timeoutMs; bounded by the grace window instead
  });

  it('HYP-1188 round 4: a step timeout landing INSIDE the exit→close grace window does not kill an already-exited process or reject a successful install', async () => {
    // See the round-3 test above for why `verify` must be stateful.
    let installedOk = false;
    const killCalls: unknown[] = [];
    const child: StepChildProcess = {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: 4242,
      on: (event, listener) => {
        // 'close' never fires — same "orphan holds the pipe" shape as the
        // round-3 test above, but here `timeoutMs` is deliberately SMALLER
        // than the grace window: if the main step-timeout timer isn't
        // cleared as soon as 'exit' fires, it elapses WHILE we're still
        // waiting inside the grace window and wrongly kills/rejects a run
        // that already completed successfully.
        if (event === 'exit') {
          queueMicrotask(() => {
            installedOk = true;
            (listener as (code: number | null) => void)(0);
          });
        }
      },
      kill: mock(() => {}),
    };
    const spawnProcess: SpawnStepProcess = mock(() => child);
    const dirs = await ensureTool('bun', {
      availability: availability({ bun: false, winget: true }),
      output,
      exec: {
        platform: 'win32',
        spawnProcess,
        timeoutMs: 50, // << EXIT_TO_CLOSE_GRACE_MS (300ms)
        probeDirs: async () => [],
        verify: async () => installedOk,
        killTree: (...args) => killCalls.push(args),
      },
    });
    expect(spawnProcess).toHaveBeenCalledTimes(1); // proves the install step actually ran, not a pre-check short-circuit
    expect(dirs).toEqual([]); // resolved successfully — never killed, never rejected as "timed out"
    expect(killCalls).toEqual([]);
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

describe('ensureDependencies — HYP-1188: bounded retry with cache-bypass', () => {
  const staleDeps = { fileExists: async (p: string) => p === '/p/package.json', mtimeMs: async () => null };

  it('retries a failed install with --force and succeeds on attempt 2', async () => {
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('Fail extracting tarball for "@rolldown/binding-win32-x64-msvc"');
    });
    const output = { appendLine: mock() };
    const result = await ensureDependencies('/p', 'bun', { output, exec: { runStep }, deps: staleDeps });
    expect(result).toBe('installed');
    expect(ran).toEqual(['bun install', 'bun install --force']);
    // Clear, visible progress — the user must not think the extension hung.
    const logged = output.appendLine.mock.calls.map((call) => String(call[0]));
    expect(logged.some((line) => line.includes('retrying 2/3') && line.includes('cache-bypassing'))).toBe(true);
  });

  it('gives up after maxAttempts with an honest, actionable error (flaky network, output channel, attempt count)', async () => {
    const runStep = mock(async () => {
      throw new Error('Integrity check failed for tarball: iconv-lite');
    });
    const error = await ensureDependencies('/p', 'npm', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: staleDeps,
      maxAttempts: 2, // keep the test fast — bounded-retry semantics don't depend on the exact default
    }).catch((e: unknown) => e);
    expect(runStep).toHaveBeenCalledTimes(2);
    expect(error).toBeInstanceOf(ToolchainInstallError);
    const message = (error as Error).message;
    expect(message).toContain('2 attempts');
    expect(message).toContain('cache-bypassing retry');
    expect(message).toContain('flaky network');
    expect(message).toContain("'HyperIDE Dev Server' output channel");
  });

  it('a user-initiated cancellation is NEVER retried — it propagates immediately as-is', async () => {
    const runStep = mock(async () => {
      throw new Error('bun install was cancelled');
    });
    const token = { isCancellationRequested: true };
    const error = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { runStep, token },
      deps: staleDeps,
    }).catch((e: unknown) => e);
    expect(runStep).toHaveBeenCalledTimes(1); // no retry attempted
    expect((error as Error).message).toBe('bun install was cancelled'); // the ORIGINAL error, not the wrapped one
  });

  it('a non-retryable failure (e.g. a permission error) is surfaced immediately, unwrapped — never force-retried', async () => {
    const runStep = mock(async () => {
      throw new Error("EACCES: permission denied, mkdir '/p/node_modules'");
    });
    const error = await ensureDependencies('/p', 'npm', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: staleDeps,
    }).catch((e: unknown) => e);
    expect(runStep).toHaveBeenCalledTimes(1); // no retry — a permission error will not go away on an identical retry
    // The ORIGINAL error, not the "flaky network" wrapper — a permission
    // error mislabeled as network flakiness would send the user chasing
    // the wrong fix.
    expect((error as Error).message).toContain('EACCES');
    expect((error as Error).message).not.toContain('flaky network');
  });

  it('Yarn Classic (no .yarnrc.yml) retries with --force, same as bun/npm/pnpm', async () => {
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const result = await ensureDependencies('/p', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: staleDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --force']);
  });

  it('Yarn Berry (.yarnrc.yml present) retries with --check-cache, NOT --force (an unknown flag there)', async () => {
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const berryDeps = {
      fileExists: async (p: string) => p === '/p/package.json' || p === '/p/.yarnrc.yml',
      mtimeMs: async () => null,
    };
    const result = await ensureDependencies('/p', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: berryDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --check-cache']);
  });

  it('Yarn Berry WORKSPACE MEMBER (.yarnrc.yml only at the ancestor workspace root, not cwd) still retries with --check-cache (HYP-1188 round 5)', async () => {
    // Before the fix, isYarnBerry checked ONLY cwd for .yarnrc.yml. A Berry
    // workspace member's cwd never carries its own .yarnrc.yml (it lives at
    // the workspace root, same shape as a monorepo subpackage having no
    // lockfile of its own) — so this misclassified as Classic and picked
    // --force, an unrecognized flag for Berry's `install`, failing the retry
    // immediately instead of bypassing the cache.
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const memberDeps = {
      fileExists: async (p: string) => p === '/repo/packages/member/package.json' || p === '/repo/.yarnrc.yml',
      mtimeMs: async () => null,
      // Explicit, unrelated $HOME (review finding) — the walk must not
      // depend on the test-running machine's REAL os.homedir() not
      // colliding with these fixture paths.
      homeDir: '/home/ci-runner',
    };
    const result = await ensureDependencies('/repo/packages/member', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: memberDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --check-cache']);
  });

  it('Yarn Berry ancestor walk stops at the VCS root — an unrelated .yarnrc.yml above the repo is never inherited (HYP-1188 round 5)', async () => {
    // Mirrors detectPackageManagerLockfile's own VCS-root bound: a
    // .yarnrc.yml living ABOVE the repository's .git must not leak in and
    // misclassify a Classic project as Berry.
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const outsideRepoDeps = {
      fileExists: async (p: string) =>
        p === '/workspace/repo/packages/member/package.json' ||
        p === '/workspace/repo/.git' ||
        p === '/workspace/.yarnrc.yml', // stray, ABOVE the repo root — must not be inherited
      mtimeMs: async () => null,
      homeDir: '/home/ci-runner',
    };
    const result = await ensureDependencies('/workspace/repo/packages/member', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: outsideRepoDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --force']); // Classic default, NOT --check-cache
  });

  it("a NESTED Classic package (own yarn.lock, no .yarnrc.yml) inside a Berry monorepo does NOT inherit the root's Berry-ness (HYP-1188 round 5)", async () => {
    // The mirror image of the workspace-member test above: Yarn's own
    // project-root resolution stops at the NEAREST yarn.lock/.yarnrc.yml, not
    // the outermost one. A nested Classic package must classify as Classic
    // even though a Berry monorepo root sits above it — inheriting Berry
    // here would pick --check-cache for a yarn install that doesn't
    // recognize it.
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const nestedClassicDeps = {
      fileExists: async (p: string) =>
        p === '/monorepo/vendor/legacy-pkg/package.json' ||
        p === '/monorepo/vendor/legacy-pkg/yarn.lock' || // nearest project root — Classic
        p === '/monorepo/.yarnrc.yml' || // the ENCLOSING Berry monorepo — must not leak down
        p === '/monorepo/.git',
      mtimeMs: async () => null,
      homeDir: '/home/ci-runner',
    };
    const result = await ensureDependencies('/monorepo/vendor/legacy-pkg', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: nestedClassicDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --force']); // Classic, NOT --check-cache
  });

  it('a stray ~/.yarnrc.yml at $HOME itself is never inherited — ancestorDirs stops BEFORE entering $HOME (HYP-1188 round 5)', async () => {
    // The reason DependenciesFsDeps.homeDir exists at all: ancestorDirs
    // (ProjectDetector.ts) deliberately does NOT yield $HOME when climbing
    // from a project rooted below it — $HOME's own files are not project
    // evidence. A real per-user ~/.yarnrc.yml (Berry's user-level
    // registry/auth config, common on real machines) must not leak into a
    // project with no repo-level Berry marker of its own — there is no .git
    // anywhere in this fixture either, so the walk exhausts at the $HOME
    // boundary having found nothing.
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const homeYarnrcDeps = {
      fileExists: async (p: string) =>
        p === '/home/ci-runner/projects/app/package.json' || p === '/home/ci-runner/.yarnrc.yml', // stray, AT $HOME itself
      mtimeMs: async () => null,
      homeDir: '/home/ci-runner',
    };
    const result = await ensureDependencies('/home/ci-runner/projects/app', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: homeYarnrcDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --force']); // Classic — $HOME's yarnrc is never inherited
  });

  it('a Berry root with BOTH .yarnrc.yml AND yarn.lock in the SAME directory still classifies as Berry (HYP-1188 round 5)', async () => {
    // Load-bearing check order: a real Berry project keeps a yarn.lock too
    // (Berry didn't drop lockfiles, it changed their format), so a real
    // Berry root has BOTH files side by side. isYarnBerry checks
    // .yarnrc.yml BEFORE yarn.lock within each directory specifically so
    // this case still resolves Berry — none of the other new fixtures put
    // both files in the same directory, so a future reorder of those two
    // checks would silently regress every direct-cwd-is-Berry-root case
    // (the ORIGINAL pre-round-5 scenario) with this suite otherwise green.
    const ran: string[] = [];
    let attempt = 0;
    const runStep = mock(async (step: { command: string }) => {
      attempt += 1;
      ran.push(step.command);
      if (attempt === 1) throw new Error('network error: socket hang up');
    });
    const berryRootDeps = {
      fileExists: async (p: string) =>
        p === '/berry-root/package.json' || p === '/berry-root/.yarnrc.yml' || p === '/berry-root/yarn.lock',
      mtimeMs: async () => null,
      homeDir: '/home/ci-runner',
    };
    const result = await ensureDependencies('/berry-root', 'yarn', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: berryRootDeps,
    });
    expect(result).toBe('installed');
    expect(ran).toEqual(['yarn install', 'yarn install --check-cache']); // Berry, NOT --force
  });

  it('the VCS-root ".git" stop engages against a REAL directory on a REAL filesystem, not just a mocked existence check (HYP-1188 round 5)', async () => {
    // Two reviewers independently raised the same concern: every other test
    // in this block injects a mock `fileExists` that answers `.git` queries
    // by fiat, which cannot catch a regression if the real defaultFileExists
    // ever became file-only (e.g. stat().isFile()) instead of existence-only
    // — in a normal clone `.git` is a DIRECTORY (a file only in
    // worktrees/submodules), so a file-only check would never engage the
    // VCS-root stop in practice and a stray ancestor .yarnrc.yml WOULD leak
    // in. This test uses NO fileExists/mtimeMs override — the real fs — with
    // a REAL `.git` directory and proves the walk actually stops there.
    const outer = await fsp.mkdtemp(path.join(os.tmpdir(), 'hyp1188-vcs-root-'));
    try {
      await fsp.writeFile(path.join(outer, '.yarnrc.yml'), ''); // stray, ABOVE the repo — must not be inherited
      const repoRoot = path.join(outer, 'repo');
      const memberDir = path.join(repoRoot, 'packages', 'member');
      await fsp.mkdir(path.join(repoRoot, '.git'), { recursive: true }); // REAL directory, the normal shape
      await fsp.mkdir(memberDir, { recursive: true });
      await fsp.writeFile(path.join(memberDir, 'package.json'), '{}');

      const ran: string[] = [];
      let attempt = 0;
      const runStep = mock(async (step: { command: string }) => {
        attempt += 1;
        ran.push(step.command);
        if (attempt === 1) throw new Error('network error: socket hang up');
      });
      const result = await ensureDependencies(memberDir, 'yarn', {
        output: { appendLine: mock() },
        exec: { runStep },
        // No `deps` override — exercises the real defaultFileExists against the real fs.
      });
      expect(result).toBe('installed');
      expect(ran).toEqual(['yarn install', 'yarn install --force']); // Classic — the real .git dir stopped the climb
    } finally {
      await fsp.rm(outer, { recursive: true, force: true });
    }
  });

  it('a REAL bun install exit — stderr arriving AFTER "exit" but before "close" (Node\'s documented ordering) still triggers the cache-bypassing retry', async () => {
    // Regression coverage for TWO review findings:
    // 1. Every OTHER test in this describe block injects a `runStep` mock
    //    that throws the raw installer TEXT as the error message directly —
    //    a contract the real createDefaultRunner/runStepProcess pipeline
    //    never satisfies (its rejection was `"<display> failed (exit code
    //    N)"`, with the actual stderr going only to the output channel).
    //    Those tests passed while the retry was DEAD CODE in production.
    // 2. A follow-up review round caught that finalizing on `exit` (not
    //    `close`) made the fix from #1 intermittent: Node's docs state
    //    `exit` can fire BEFORE stdio streams finish draining. This test
    //    deliberately emits the failing stderr line and `close` in a LATER
    //    microtask than `exit` — the ordering Node warns about — so it only
    //    passes if `resolveStepOutcome` finalizes on `close`.
    const commands: string[] = [];
    let attempt = 0;
    const spawnProcess: SpawnStepProcess = mock((command) => {
      attempt += 1;
      commands.push(command);
      const stdout = new EventEmitter();
      const stderr = new EventEmitter();
      const child = new EventEmitter();
      queueMicrotask(() => {
        if (attempt === 1) {
          child.emit('exit', 1); // process has exited...
          queueMicrotask(() => {
            // ...but its final stderr line only drains on a LATER tick, before 'close'.
            stderr.emit('data', Buffer.from('Fail extracting tarball for "@rolldown/binding-win32-x64-msvc"\n'));
            child.emit('close', 1);
          });
        } else {
          child.emit('exit', 0);
          child.emit('close', 0);
        }
      });
      return { stdout, stderr, on: child.on.bind(child), kill: mock(() => {}) };
    });
    const result = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { platform: 'linux', spawnProcess },
      deps: staleDeps,
    });
    expect(result).toBe('installed');
    expect(commands).toEqual(['bun install', 'bun install --force']);
  });

  it('the decisive "Fail extracting tarball" line survives even after 25 MORE diagnostic lines follow it (HYP-1188 round 5)', async () => {
    // Before the fix, createRecentOutputBuffer truncated purely
    // chronologically (last RECENT_OUTPUT_MAX_LINES=20 non-empty lines) — a
    // cache failure followed by more diagnostic output than that (exactly
    // the shape of the original incident, which continued into an esbuild
    // postinstall crash) silently sliced the ONE line isRetryableInstallError
    // classifies on out of the tail attached to the rejection. Attempt 1
    // would then reject as NON-retryable and the retry would never fire:
    // `result` stays a rejection and only one spawnProcess call happens.
    const filler = Array.from({ length: 25 }, (_, i) => `esbuild postinstall note ${i}`);
    const commands: string[] = [];
    let attempt = 0;
    const spawnProcess: SpawnStepProcess = mock((command) => {
      attempt += 1;
      commands.push(command);
      if (attempt === 1) {
        return fakeChild(1, 'Fail extracting tarball for "@rolldown/binding-win32-x64-msvc"', ...filler);
      }
      return fakeChild(0);
    });
    const result = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { platform: 'linux', spawnProcess },
      deps: staleDeps,
    });
    expect(result).toBe('installed');
    expect(commands).toEqual(['bun install', 'bun install --force']);
  });

  it('the decisive line survives CHAR-based truncation too, not just line-count truncation (HYP-1188 round 5)', async () => {
    // A distinct failure mode from the line-count test above: even with
    // FEWER than RECENT_OUTPUT_MAX_LINES=20 lines total, real installer
    // diagnostics (absolute paths, checksums) routinely run >100 chars/line —
    // enough for the aggregate to exceed RECENT_OUTPUT_MAX_CHARS=2000 on its
    // own and get chopped by tail()'s `.slice(-2000)` BEFORE the line-count
    // window ever engages. An earlier fix attempt (pinning the decisive line
    // at lines[0]) still lost it here — slice(-N) truncates from the FRONT,
    // exactly where that pin placed it. Caught independently by two
    // reviewers on the first round-5 attempt.
    const longPath = '/home/user/AppData/Local/bun/install/cache/@rolldown/binding-win32-x64-msvc/package/';
    const filler = Array.from(
      { length: 15 },
      (_, i) => `note: verifying checksum for ${longPath}chunk-${i}.tar.gz against registry manifest entry ${i}`,
    );
    const commands: string[] = [];
    let attempt = 0;
    const spawnProcess: SpawnStepProcess = mock((command) => {
      attempt += 1;
      commands.push(command);
      if (attempt === 1) {
        return fakeChild(1, 'Fail extracting tarball for "@rolldown/binding-win32-x64-msvc"', ...filler);
      }
      return fakeChild(0);
    });
    const result = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { platform: 'linux', spawnProcess },
      deps: staleDeps,
    });
    expect(result).toBe('installed');
    expect(commands).toEqual(['bun install', 'bun install --force']);
  });

  it('a decisive line LONGER than RECENT_OUTPUT_MAX_CHARS on its own still classifies as retryable (HYP-1188 round 5)', async () => {
    // A review finding on this fix's second draft: appending the decisive
    // line back in still sliced it with `.slice(-RECENT_OUTPUT_MAX_CHARS)` —
    // truncating a >2000-char line from its FRONT, exactly where the
    // classifying keyword ("Fail extracting tarball…") sits. `tail()` now
    // keeps the START of an over-long decisive line instead.
    const longDecisiveLine = `Fail extracting tarball for "@rolldown/binding-win32-x64-msvc": ${'x'.repeat(2100)}`;
    const commands: string[] = [];
    let attempt = 0;
    const spawnProcess: SpawnStepProcess = mock((command) => {
      attempt += 1;
      commands.push(command);
      if (attempt === 1) return fakeChild(1, longDecisiveLine);
      return fakeChild(0);
    });
    const result = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { platform: 'linux', spawnProcess },
      deps: staleDeps,
    });
    expect(result).toBe('installed');
    expect(commands).toEqual(['bun install', 'bun install --force']);
  });

  it('pins the documented HYP-1206 tradeoff: an EARLY transient retryable line still forces a retry even when the attempt later fails for a genuinely non-retryable reason', async () => {
    // This is the accepted-tradeoff behavior documented on
    // createRecentOutputBuffer (review finding, tracked as HYP-1206): once
    // ANY line in this attempt's output matched RETRYABLE_INSTALL_ERROR_PATTERN,
    // that line survives into every subsequent tail() call for the SAME
    // attempt — so a "Fail extracting tarball" logged early (say, for one
    // package bun's own internal retry recovered from) still makes THIS
    // failing attempt classify as retryable even though the actual fatal
    // reason (EACCES) has nothing to do with the network/cache. This test
    // exists so that when HYP-1206 lands a correct fix (classification
    // captured independently of the lossy tail text), its own test suite
    // update shows up here as an intentional, visible behavior change — not
    // a silent regression.
    const commands: string[] = [];
    let attempt = 0;
    const spawnProcess: SpawnStepProcess = mock((command) => {
      attempt += 1;
      commands.push(command);
      if (attempt === 1) {
        // Early transient line (recovered from — the OVERALL attempt still
        // fails later, for an unrelated reason).
        return fakeChild(
          1,
          'Fail extracting tarball for "@rolldown/binding-win32-x64-msvc"',
          'retrying download…',
          "EACCES: permission denied, mkdir '/p/node_modules'",
        );
      }
      return fakeChild(0);
    });
    const result = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { platform: 'linux', spawnProcess },
      deps: staleDeps,
    });
    // Documented current behavior: retries anyway, because the early
    // retryable line is still present in the tail. A future fix that
    // classifies on the ACTUAL failure reason would instead reject
    // immediately, unwrapped, with an EACCES message and only ONE command.
    expect(result).toBe('installed');
    expect(commands).toEqual(['bun install', 'bun install --force']);
  });

  it('ToolchainInstallError.retriesExhausted is true ONLY on the final give-up error, never on an unwrapped non-retryable/cancelled error', async () => {
    const exhausted = await ensureDependencies('/p', 'npm', {
      output: { appendLine: mock() },
      exec: {
        runStep: mock(async () => {
          throw new Error('integrity check failed for tarball');
        }),
      },
      deps: staleDeps,
      maxAttempts: 1,
    }).catch((e: unknown) => e);
    expect(exhausted).toBeInstanceOf(ToolchainInstallError);
    expect((exhausted as ToolchainInstallError).retriesExhausted).toBe(true);

    const unwrapped = await ensureDependencies('/p', 'npm', {
      output: { appendLine: mock() },
      exec: {
        runStep: mock(async () => {
          throw new Error('EACCES: permission denied');
        }),
      },
      deps: staleDeps,
    }).catch((e: unknown) => e);
    expect((unwrapped as Error).message).toContain('EACCES'); // unwrapped, not a ToolchainInstallError
    expect((unwrapped as { retriesExhausted?: boolean }).retriesExhausted).toBeUndefined();
  });

  it('a step TIMEOUT is never retried — a corrupted-cache failure fails fast, a genuine hang should surface promptly instead of tripling the wait', async () => {
    const runStep = mock(async () => {
      throw new ToolchainInstallError(
        'Installing project dependencies (bun install) timed out after 10 minutes',
        'bun',
        'https://bun.sh',
      );
    });
    const error = await ensureDependencies('/p', 'bun', {
      output: { appendLine: mock() },
      exec: { runStep },
      deps: staleDeps,
    }).catch((e: unknown) => e);
    expect(runStep).toHaveBeenCalledTimes(1); // no retry — the ORIGINAL timeout error propagates immediately
    expect((error as Error).message).toContain('timed out');
    expect((error as ToolchainInstallError).retriesExhausted).toBe(false); // NOT the exhausted-retries give-up error
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
