/**
 * @file toolchainDetector — HYP-1169 self-healing toolchain: WHAT tool does
 * this project need, and WHAT is already installed on this machine?
 *
 * Accessed via: DevServerManager._runStart (through _prepareToolchain) before
 * every dev-server spawn, so a designer on a fresh machine gets the required
 * package manager auto-installed instead of a "bunx is not recognized" wall.
 *
 * Two halves:
 *  - detectRequiredTool(projectPath): the tool the PROJECT asks for.
 *    Precedence: package.json `packageManager` field → `engines` → lockfile
 *    walk-up (detectPackageManagerLockfile, the HYP-1160 primitive) → npm.
 *    NOTE the deliberate difference from ProjectDetector.detectPackageManager
 *    (lockfile-first): that one resolves which pm actually INSTALLED the deps
 *    (lockfile is authoritative evidence of past use); this one answers "what
 *    must exist on a machine that has nothing yet", where the author's
 *    declared intent (the corepack-style `packageManager` field) is the
 *    strongest signal — a fresh machine has not installed anything yet.
 *  - detectAvailableTools(): probes node/npm/bun/pnpm/yarn presence (parallel
 *    `<tool> --version` spawns, 5s timeout each), winget on win32, brew on
 *    darwin, and the linux distro id from /etc/os-release. Cached per
 *    extension-host session (a probe burst per dev-server start would add
 *    noticeable latency); markToolAvailable() patches the cache after a
 *    successful install so a just-installed tool is not re-installed.
 *
 * Every platform primitive (spawn probe, file read) is injectable so tests
 * never spawn or install anything (repo convention, same seam shape as
 * detectWindowsOemCodePage(platform, spawnFn)).
 */

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { detectPackageManagerLockfile } from './ProjectDetector';

export type ToolchainTool = 'node' | 'npm' | 'bun' | 'pnpm' | 'yarn';
export type LinuxDistro = 'debian' | 'ubuntu' | 'other';

export interface ToolAvailability {
  node: boolean;
  npm: boolean;
  bun: boolean;
  pnpm: boolean;
  yarn: boolean;
  /** Present on win32 only; null elsewhere. */
  winget: boolean | null;
  /** Present on darwin only; null elsewhere. */
  brew: boolean | null;
  /** Present on linux only; null elsewhere. */
  linuxDistro: LinuxDistro | null;
}

export interface ToolchainDetectorDeps {
  platform?: NodeJS.Platform;
  homeDir?: string;
  /** "Does `<command>` exit 0 within the timeout?" — default spawns via the OS shell. */
  probe?: (command: string) => Promise<boolean>;
  /** Text file reader (os-release, package.json) — defaults to fs.readFile utf8. */
  readFile?: (path: string) => Promise<string>;
}

const PROBE_TIMEOUT_MS = 5_000;

/**
 * Default probe: run the command through the OS shell and check the exit code.
 * `shell: true` is required on win32 so `.cmd` shims (npm.cmd, corepack
 * shims) resolve; output is drained-and-discarded, the process is killed at
 * the timeout so a hung shim can never wedge detection.
 */
function defaultProbe(command: string): Promise<boolean> {
  // `new Promise` (not Promise.withResolvers): the extension tsconfig targets
  // ES2022, where withResolvers is not in the lib — same shape as
  // DevServerManager._repairDependencies.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    // nosemgrep: spawn-shell-true -- fixed probe strings (`<tool> --version`), never user input
    const child = spawn(command, { shell: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish(false);
    }, PROBE_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
  });
}

const PACKAGE_MANAGER_FIELD_TOOLS: Record<string, ToolchainTool> = {
  npm: 'npm',
  yarn: 'yarn',
  pnpm: 'pnpm',
  bun: 'bun',
};

/** Engines keys checked in priority order; `node` is the weakest (near-universal) signal. */
const ENGINES_PRIORITY: ReadonlyArray<readonly [string, ToolchainTool]> = [
  ['bun', 'bun'],
  ['pnpm', 'pnpm'],
  ['yarn', 'yarn'],
  ['npm', 'npm'],
  ['node', 'node'],
];

/**
 * The tool the project requires, per HYP-1169 precedence:
 * `packageManager` field → `engines` → lockfile walk-up → npm.
 */
export async function detectRequiredTool(
  projectPath: string,
  deps: ToolchainDetectorDeps = {},
): Promise<ToolchainTool> {
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
  try {
    const pkg = JSON.parse(await read(join(projectPath, 'package.json'))) as {
      packageManager?: unknown;
      engines?: unknown;
    };
    if (typeof pkg.packageManager === 'string') {
      // Format: "<name>@<version>[+<integrity>]" — only the name matters.
      const name = pkg.packageManager.split('@', 1)[0]?.trim().toLowerCase() ?? '';
      const tool = PACKAGE_MANAGER_FIELD_TOOLS[name];
      if (tool) return tool;
    }
    if (pkg.engines && typeof pkg.engines === 'object' && !Array.isArray(pkg.engines)) {
      const engines = pkg.engines as Record<string, unknown>;
      for (const [key, tool] of ENGINES_PRIORITY) {
        if (typeof engines[key] === 'string') return tool;
      }
    }
  } catch {
    // No package.json / parse error — fall through to lockfile evidence.
  }
  const lockfile = await detectPackageManagerLockfile(projectPath, deps.homeDir ?? homedir());
  return lockfile?.manager ?? 'npm';
}

/**
 * Map an /etc/os-release body to the distro family the installer cares about.
 * Only apt-based distros (debian, ubuntu, and ID_LIKE derivatives such as
 * Linux Mint) get a distro-package-manager install path; everything else is
 * 'other' and falls back to per-tool official installers / docs links.
 */
export function parseLinuxDistro(osRelease: string): LinuxDistro {
  const fields = new Map<string, string>();
  for (const line of osRelease.split('\n')) {
    const match = /^([A-Z_]+)="?([^"\n]*)"?$/.exec(line.trim());
    if (match) fields.set(match[1], match[2]);
  }
  const id = fields.get('ID')?.toLowerCase() ?? '';
  if (id === 'debian') return 'debian';
  if (id === 'ubuntu') return 'ubuntu';
  const like = fields.get('ID_LIKE')?.toLowerCase() ?? '';
  // ID_LIKE lists nearest-first, but both families map to the same apt path —
  // prefer the base family for stability.
  if (/\bdebian\b/.test(like)) return 'debian';
  if (/\bubuntu\b/.test(like)) return 'ubuntu';
  return 'other';
}

/** Session cache — probing five tools + a package-manager-installer per dev-server start is wasted latency. */
let cachedAvailability: ToolAvailability | null = null;

/** Test hook: drop the session cache (bun test files share the module). */
export function _resetToolchainAvailabilityCacheForTests(): void {
  cachedAvailability = null;
}

/**
 * Patch the session cache after a successful install so a just-installed tool
 * is reported present (the on-disk PATH may not be visible to this process
 * yet — that side is handled by refreshPathForChild).
 */
export function markToolAvailable(tool: ToolchainTool): void {
  if (cachedAvailability) {
    cachedAvailability = { ...cachedAvailability, [tool]: true };
  }
}

/**
 * The honest-cache counterpart of markToolAvailable (HYP-1169 round 2): a
 * cached "available" entry that fails a LIVE `<tool> --version` probe is a
 * lie (stale PATH snapshot, half-finished install) — drop it so the next
 * dev-server start re-runs the full heal instead of trusting the cache and
 * spawning a command that does not exist. Ground truth: Alex's retry trusted
 * the session cache (bun marked available after the winget install) and
 * spawned bare `nx` into a PATH where nothing new was reachable.
 */
export function invalidateToolAvailability(tool: ToolchainTool): void {
  if (cachedAvailability) {
    cachedAvailability = { ...cachedAvailability, [tool]: false };
  }
}

/**
 * What exists on THIS machine right now. Probes run in parallel; each is a
 * bounded `<tool> --version` shell spawn. The result is cached for the
 * session when the default deps are used (dep overrides — tests — always
 * bypass the cache so injected probes are actually observed).
 */
export async function detectAvailableTools(deps: ToolchainDetectorDeps = {}): Promise<ToolAvailability> {
  const useCache = !deps.platform && !deps.probe && !deps.readFile && !deps.homeDir;
  if (useCache && cachedAvailability) return cachedAvailability;

  const platform = deps.platform ?? process.platform;
  const probe = deps.probe ?? defaultProbe;
  const toolProbes: Record<'node' | 'npm' | 'bun' | 'pnpm' | 'yarn', Promise<boolean>> = {
    node: probe('node --version'),
    npm: probe('npm --version'),
    bun: probe('bun --version'),
    pnpm: probe('pnpm --version'),
    yarn: probe('yarn --version'),
  };
  const winget = platform === 'win32' ? await probe('winget --version') : null;
  const brew = platform === 'darwin' ? await probe('brew --version') : null;
  let linuxDistro: LinuxDistro | null = null;
  if (platform === 'linux') {
    const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
    try {
      linuxDistro = parseLinuxDistro(await read('/etc/os-release'));
    } catch {
      linuxDistro = 'other';
    }
  }
  const result: ToolAvailability = {
    node: await toolProbes.node,
    npm: await toolProbes.npm,
    bun: await toolProbes.bun,
    pnpm: await toolProbes.pnpm,
    yarn: await toolProbes.yarn,
    winget,
    brew,
    linuxDistro,
  };
  if (useCache) cachedAvailability = result;
  return result;
}
