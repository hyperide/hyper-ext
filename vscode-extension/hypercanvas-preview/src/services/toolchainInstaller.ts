/**
 * @file toolchainInstaller — HYP-1169 self-healing toolchain: install a missing
 * package manager / runtime, and proactively install project dependencies,
 * before the dev-server spawn.
 *
 * Accessed via: DevServerManager._runStart (through _prepareToolchain). The
 * point of the module: a non-technical user on a fresh machine opens a
 * project and gets a running preview, not "'bun' is not recognized".
 *
 * Structure:
 *  - buildInstallPlan(tool, env) is PURE — a (platform × tool × winget/brew ×
 *    distro) decision table returning the exact commands to run, so the whole
 *    matrix is unit-testable without installing anything.
 *  - ensureTool / ensureDependencies execute a plan through the runStep seam:
 *    the default runner shows a cancellable vscode.window.withProgress
 *    notification, decodes child output through StreamOutputDecoder (Russian
 *    Windows emits OEM-codepage bytes — HYP-1140), enforces a timeout, and
 *    kills the child on cancellation.
 *
 * Safety invariants:
 *  - NO plan ever contains a bare `sudo` unless env.sudoConfirmed is set —
 *    ensureTool obtains that confirmation interactively (confirmSudo callback)
 *    and rebuilds the plan; declining falls back to a docs link.
 *  - Homebrew itself is NEVER bootstrapped (its installer needs sudo + an
 *    interactive shell); without brew, macOS falls back to per-tool official
 *    installers or a docs link.
 *  - nvm is deliberately NOT used (too invasive: it rewrites the user's shell
 *    rc files); linux node without sudo confirmation gets a docs link.
 */

import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { delimiter } from 'node:path';
import * as vscode from 'vscode';
import {
  invalidateToolAvailability,
  markToolAvailable,
  type LinuxDistro,
  type ToolAvailability,
  type ToolchainTool,
} from './toolchainDetector';
import { probeToolBinaryDirs } from './toolchainPath';
import { detectWindowsOemCodePage, StreamOutputDecoder } from './windowsOutputDecoding';

export type PackageManagerName = 'npm' | 'yarn' | 'pnpm' | 'bun';

/** Everything the plan builder needs to know about the host. */
export interface InstallEnvironment {
  platform: NodeJS.Platform;
  winget: boolean;
  brew: boolean;
  linuxDistro: LinuxDistro | null;
  nodeAvailable: boolean;
  /** Set only AFTER the user explicitly confirmed a sudo-requiring install. */
  sudoConfirmed: boolean;
}

export interface InstallStep {
  /** The tool this step installs (a pnpm plan may contain a `node` step). */
  tool: ToolchainTool;
  /** Full shell command line (spawned with shell: true by the default runner). */
  command: string;
  /** Human-readable progress title, e.g. "Installing Bun via winget". */
  display: string;
  /** True only for steps the user explicitly confirmed (see the no-sudo invariant). */
  requiresSudo: boolean;
  /** Official install docs — surfaced by the "Open instructions" failure action. */
  docsUrl: string;
  /** Working directory (dependency installs run in the spawn-plan cwd). */
  cwd?: string;
}

export class ToolchainInstallError extends Error {
  constructor(
    message: string,
    readonly tool: ToolchainTool,
    readonly docsUrl: string,
  ) {
    super(message);
    this.name = 'ToolchainInstallError';
  }
}

const DOCS_URLS: Record<ToolchainTool, string> = {
  bun: 'https://bun.sh/docs/installation',
  node: 'https://nodejs.org/en/download',
  npm: 'https://nodejs.org/en/download',
  pnpm: 'https://pnpm.io/installation',
  yarn: 'https://yarnpkg.com/getting-started/install',
};

export function installDocsUrl(tool: ToolchainTool): string {
  return DOCS_URLS[tool];
}

/** The tools that must exist on PATH before the dev-server spawn for a given pm. */
export function requiredToolsForPackageManager(pm: PackageManagerName): ToolchainTool[] {
  switch (pm) {
    case 'bun':
      return ['bun'];
    case 'pnpm':
      return ['pnpm']; // node is chained inside the plan when missing
    case 'yarn':
      return ['yarn'];
    default:
      return ['node']; // npm ships with node
  }
}

function step(tool: ToolchainTool, command: string, display: string, requiresSudo = false): InstallStep {
  return { tool, command, display, requiresSudo, docsUrl: DOCS_URLS[tool] };
}

function bunInstallPlan(env: InstallEnvironment): InstallStep[] {
  if (env.platform === 'win32') {
    return env.winget
      ? [step('bun', 'winget install --id Oven-sh.Bun -e --silent', 'Installing Bun via winget')]
      : [
          step(
            'bun',
            'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm bun.sh/install.ps1|iex"',
            'Installing Bun (official installer)',
          ),
        ];
  }
  if (env.platform === 'darwin' && env.brew) {
    return [step('bun', 'brew install bun', 'Installing Bun via Homebrew')];
  }
  // macOS without brew, and linux: the official installer drops a standalone
  // binary into ~/.bun — no sudo, no shell-rc surgery.
  return [step('bun', 'curl -fsSL https://bun.sh/install | bash', 'Installing Bun (official installer)')];
}

function nodeInstallPlan(env: InstallEnvironment): InstallStep[] {
  if (env.platform === 'win32') {
    // winget only — there is no sanctioned non-interactive node installer on
    // Windows without it (nvm-windows still needs an admin installer).
    return env.winget
      ? [step('node', 'winget install --id OpenJS.NodeJS -e --silent', 'Installing Node.js via winget')]
      : [];
  }
  if (env.platform === 'darwin') {
    // NEVER bootstrap Homebrew itself (its installer is interactive + sudo).
    return env.brew ? [step('node', 'brew install node', 'Installing Node.js via Homebrew')] : [];
  }
  // linux: the distro package manager is the only sane non-nvm path and it
  // needs sudo — gated on explicit user confirmation (the no-sudo invariant).
  if (env.sudoConfirmed && (env.linuxDistro === 'debian' || env.linuxDistro === 'ubuntu')) {
    return [
      step(
        'node',
        'sudo apt-get update && sudo apt-get install -y nodejs npm',
        'Installing Node.js via apt (requires sudo)',
        true,
      ),
    ];
  }
  return [];
}

function corepackPlan(tool: 'pnpm' | 'yarn'): InstallStep[] {
  return [
    step(tool, 'corepack enable', `Enabling corepack for ${tool}`),
    step(tool, `corepack prepare ${tool}@latest --activate`, `Installing ${tool} via corepack`),
  ];
}

/**
 * The exact commands to install `tool` on this host, in execution order.
 * Empty means "no safe non-interactive install exists here" — the caller
 * surfaces the docs link instead of guessing.
 */
export function buildInstallPlan(tool: ToolchainTool, env: InstallEnvironment): InstallStep[] {
  switch (tool) {
    case 'bun':
      return bunInstallPlan(env);
    case 'node':
    case 'npm':
      return nodeInstallPlan(env);
    case 'pnpm':
    case 'yarn': {
      const nodeSteps = env.nodeAvailable ? [] : nodeInstallPlan(env);
      if (!env.nodeAvailable && nodeSteps.length === 0) return []; // corepack is useless without node
      return [...nodeSteps, ...corepackPlan(tool)];
    }
  }
}

/** True when a sudo-gated install COULD exist for this tool/host (so the user should be asked). */
function canSudoInstall(tool: ToolchainTool, env: InstallEnvironment): boolean {
  const needsNode = tool === 'node' || tool === 'npm' || ((tool === 'pnpm' || tool === 'yarn') && !env.nodeAvailable);
  return needsNode && env.platform === 'linux' && (env.linuxDistro === 'debian' || env.linuxDistro === 'ubuntu');
}

type InstallStepRunner = (step: InstallStep) => Promise<void>;

/** Live progress sink shared with the outer toolchain notification (HYP-1169 round 2). */
export interface ToolchainProgress {
  report(message: string): void;
}

interface ToolchainExecDeps {
  platform?: NodeJS.Platform;
  runStep?: InstallStepRunner;
  /** Install timeout; default 10 minutes (winget/brew downloads can be slow). */
  timeoutMs?: number;
  /**
   * Live `<tool> --version` verification under the post-install env
   * (default: bounded shell spawn). markToolAvailable is gated on this —
   * installer exit code 0 alone NEVER marks a tool available.
   */
  verify?: (tool: ToolchainTool, env: NodeJS.ProcessEnv) => Promise<boolean>;
  /**
   * Post-install binary-dir resolution (default: probeToolBinaryDirs — fs
   * probes of the well-known install dirs + registry PATH mentions).
   */
  probeDirs?: (tool: ToolchainTool) => Promise<string[]>;
  /**
   * When set, step output titles report HERE instead of opening a per-step
   * notification — the caller (DevServerManager) drives one "step i/N"
   * notification for the whole toolchain pipeline.
   */
  progress?: ToolchainProgress;
  /** Cancellation token borrowed from the caller's progress notification. */
  token?: { isCancellationRequested: boolean; onCancellationRequested?: (cb: () => void) => unknown };
  /**
   * Env override for step spawns (KEY: value merges over process.env). The
   * dependency install MUST see the just-verified tool dirs on PATH —
   * otherwise `bun install` fails with "'bun' is not recognized" on the same
   * machine that just installed bun (Alex's Windows run, HYP-1169 round 2).
   */
  env?: NodeJS.ProcessEnv;
}

export interface EnsureToolContext {
  availability: ToolAvailability;
  output: { appendLine(line: string): void };
  /**
   * Ask the user to confirm a sudo-requiring install (modal dialog in
   * production). Called at most once per ensureTool; a decline/absence falls
   * back to the docs-link error — sudo is never used silently.
   */
  confirmSudo?: (description: string) => Promise<boolean>;
  exec?: ToolchainExecDeps;
}

const INSTALL_TIMEOUT_MS = 600_000;

// SYNC: same stripper lives in DevServerManager.ts (ANSI_ESCAPE_PATTERN, \x.. escapes) —
// keep both in sync; DevServerManager cannot be imported here (module cycle).
// The \x1b/\x07 form matches DevServerManager verbatim; the control characters are the
// whole point (the pattern exists to match ESC/BEL bytes).
// oxlint-disable-next-line no-control-regex -- intentional: strips ANSI/VT escape sequences
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[A-Z\\[\]^_@]/g;

function envFromAvailability(availability: ToolAvailability, platform: NodeJS.Platform): InstallEnvironment {
  return {
    platform,
    winget: availability.winget === true,
    brew: availability.brew === true,
    linuxDistro: availability.linuxDistro,
    nodeAvailable: availability.node,
    sudoConfirmed: false,
  };
}

/**
 * The default step runner: cancellable progress notification + shell spawn +
 * OEM-aware output decoding + timeout. Output flows to the extension's output
 * channel via onOutput; a non-zero exit (or cancellation/timeout) rejects
 * with a ToolchainInstallError carrying the tool's docs URL. When the caller
 * supplied a progress sink / token (the DevServerManager step-i/N
 * notification), the step reports there instead of nesting a second
 * notification.
 */
function createDefaultRunner(output: { appendLine(line: string): void }, exec: ToolchainExecDeps): InstallStepRunner {
  const platform = exec.platform ?? process.platform;
  const timeoutMs = exec.timeoutMs ?? INSTALL_TIMEOUT_MS;
  return async (installStep) => {
    if (exec.progress) {
      exec.progress.report(`${installStep.display}…`);
      await runStepProcess(
        installStep,
        platform,
        timeoutMs,
        exec.token ?? { isCancellationRequested: false },
        output,
        exec.env,
      );
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `HyperIDE: ${installStep.display}…`,
        cancellable: true,
      },
      async (_progress, token) => {
        await runStepProcess(installStep, platform, timeoutMs, token, output, exec.env);
      },
    );
  };
}

async function runStepProcess(
  installStep: InstallStep,
  platform: NodeJS.Platform,
  timeoutMs: number,
  token: { isCancellationRequested: boolean; onCancellationRequested?: (cb: () => void) => unknown },
  output: { appendLine(line: string): void },
  envOverride?: NodeJS.ProcessEnv,
): Promise<void> {
  // `new Promise` (not Promise.withResolvers): the extension tsconfig targets ES2022.
  return new Promise<void>((resolve, reject) => {
    // Same live-box pattern as DevServerManager: the (cached, win32-only) probe
    // resolves mid-stream; chunks before it resolves decode as UTF-8.
    const oemCodePageBox: { value: number | null } = { value: null };
    detectWindowsOemCodePage().then((codePage) => {
      oemCodePageBox.value = codePage;
    });

    output.appendLine(`[Toolchain] ${installStep.display}: ${installStep.command}`);
    // nosemgrep: spawn-shell-true -- install commands are built by buildInstallPlan, never from user input
    const child = spawn(installStep.command, {
      cwd: installStep.cwd,
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverride, CI: 'true' },
    });
    const stdoutDecoder = new StreamOutputDecoder(platform, () => oemCodePageBox.value);
    const stderrDecoder = new StreamOutputDecoder(platform, () => oemCodePageBox.value);
    const onData = (decoder: StreamOutputDecoder) => (data: Buffer) => {
      output.appendLine(decoder.push(data).replace(ANSI_ESCAPE_PATTERN, '').trimEnd());
    };
    child.stdout?.on('data', onData(stdoutDecoder));
    child.stderr?.on('data', onData(stderrDecoder));

    let finished = false;
    const kill = (reason: string) => {
      if (finished) return;
      finished = true;
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      reject(new ToolchainInstallError(reason, installStep.tool, installStep.docsUrl));
    };
    const timer = setTimeout(
      () => kill(`${installStep.display} timed out after ${Math.round(timeoutMs / 60_000)} minutes`),
      timeoutMs,
    );
    timer.unref?.();
    token.onCancellationRequested?.(() => kill(`${installStep.display} was cancelled`));

    child.on('error', (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(new ToolchainInstallError(error.message, installStep.tool, installStep.docsUrl));
    });
    child.on('exit', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const stdoutTail = stdoutDecoder.flush();
      const stderrTail = stderrDecoder.flush();
      if (stdoutTail) output.appendLine(stdoutTail.replace(ANSI_ESCAPE_PATTERN, '').trimEnd());
      if (stderrTail) output.appendLine(stderrTail.replace(ANSI_ESCAPE_PATTERN, '').trimEnd());
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new ToolchainInstallError(
          `${installStep.display} failed (exit code ${code ?? 'unknown'})`,
          installStep.tool,
          installStep.docsUrl,
        ),
      );
    });
  });
}

const VERIFY_TIMEOUT_MS = 8_000;

/**
 * The default post-install verification: spawn `<tool> --version` against the
 * refreshed env (probe-resolved binary dirs prepended to PATH). Bounded and
 * drained-and-discarded like the detector probe.
 */
function defaultVerify(tool: ToolchainTool, env: NodeJS.ProcessEnv): Promise<boolean> {
  // `new Promise` (not Promise.withResolvers): the extension tsconfig targets ES2022.
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    // nosemgrep: spawn-shell-true -- fixed probe strings (`<tool> --version`), never user input
    const child = spawn(`${tool} --version`, { shell: true, stdio: ['ignore', 'ignore', 'ignore'], env });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      finish(false);
    }, VERIFY_TIMEOUT_MS);
    timer.unref?.();
    child.on('error', () => finish(false));
    child.on('exit', (code) => finish(code === 0));
  });
}

/** Every tool an install makes available (npm ships with node; chained plan steps count). */
function toolsProvidedByPlan(tool: ToolchainTool, plan: readonly InstallStep[]): ToolchainTool[] {
  const provided = new Set<ToolchainTool>([tool]);
  for (const planStep of plan) provided.add(planStep.tool);
  if (provided.has('node')) provided.add('npm');
  return [...provided];
}

/**
 * Install `tool` if it is missing. Resolves with the probe-verified binary
 * dirs to prepend to the child PATH (empty when the tool was already on the
 * process PATH). Throws ToolchainInstallError (docsUrl attached) when no safe
 * install exists, the user declines a sudo step, or the tool FAILS the live
 * post-install `<tool> --version` verification.
 *
 * Honest-availability invariants (HYP-1169 round 2):
 *  - A cached "available" entry is only trusted after a live probe; a failed
 *    probe INVALIDATES the cache entry and re-runs the full heal.
 *  - markToolAvailable fires ONLY after the post-install verification passes
 *    — never on installer exit code alone (a winget install can exit 0 while
 *    the binary is unreachable from any child we spawn).
 */
export async function ensureTool(tool: ToolchainTool, context: EnsureToolContext): Promise<string[]> {
  const platform = context.exec?.platform ?? process.platform;
  const verify = context.exec?.verify ?? defaultVerify;
  const probeDirs = context.exec?.probeDirs ?? ((t: ToolchainTool) => probeToolBinaryDirs(t, { platform }));

  /**
   * Live-probe each tool, returning the binary dirs to prepend to the child
   * PATH ([] when the tools answer on the plain process PATH) — or the name
   * of the first tool that failed. Plain process.env is tried FIRST: on a
   * warm machine that single probe is the entire cost, and no fs/registry
   * probing happens at all (review nit: never spawn `reg query` when nothing
   * needs healing).
   */
  const verifyTools = async (tools: ToolchainTool[]): Promise<string[] | ToolchainTool> => {
    const basePath = process.env.PATH ?? process.env.Path ?? '';
    const probeWith = async (extraDirs: readonly string[]): Promise<ToolchainTool | null> => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        PATH: [...extraDirs, ...basePath.split(delimiter).filter(Boolean)].join(delimiter),
      };
      for (const t of tools) {
        if (!(await verify(t, env))) return t;
      }
      return null;
    };
    if ((await probeWith([])) === null) return [];
    const dirs: string[] = [];
    for (const t of tools) {
      for (const dir of await probeDirs(t)) {
        if (!dirs.some((d) => d.toLowerCase() === dir.toLowerCase())) dirs.push(dir);
      }
    }
    if (dirs.length === 0) {
      // No dir to add — the plain-env failure stands; re-derive the culprit.
      for (const t of tools) {
        if (!(await verify(t, { ...process.env, PATH: basePath }))) return t;
      }
    }
    const failed = await probeWith(dirs);
    return failed ?? dirs;
  };

  if (context.availability[tool]) {
    // Honest cache: trust the session cache only after a live probe. The
    // probe env includes the probe-resolved dirs, so a tool installed but not
    // yet on the process PATH (Alex's bun) still verifies — and its dir is
    // returned for the child PATH.
    const checkTools = tool === 'node' || tool === 'npm' ? (['node', 'npm'] as ToolchainTool[]) : [tool];
    const verified = await verifyTools(checkTools);
    if (Array.isArray(verified)) return verified;
    invalidateToolAvailability(tool);
    context.output.appendLine(
      `[Toolchain] ${tool} was cached as available but '<${verified}> --version' fails — re-running the install.`,
    );
  }

  let env = envFromAvailability(context.availability, platform);
  let plan = buildInstallPlan(tool, env);
  if (plan.length === 0 && !env.sudoConfirmed && canSudoInstall(tool, env) && context.confirmSudo) {
    const description = `Node.js via the system package manager (sudo apt-get install nodejs npm)`;
    if (await context.confirmSudo(description)) {
      env = { ...env, sudoConfirmed: true };
      plan = buildInstallPlan(tool, env);
    }
  }
  if (plan.length === 0) {
    throw new ToolchainInstallError(
      `HyperIDE could not auto-install ${tool} on this machine. Install it manually, then restart VS Code.`,
      tool,
      installDocsUrl(tool),
    );
  }
  const runStep = context.exec?.runStep ?? createDefaultRunner(context.output, context.exec ?? {});
  for (const installStep of plan) {
    await runStep(installStep);
  }

  // Verification gate: every tool the install claims to provide must answer a
  // live `--version` under the probe-refreshed env BEFORE the session cache
  // is touched. Exit code 0 from the installer is NOT proof of reachability.
  const provided = toolsProvidedByPlan(tool, plan);
  const verified = await verifyTools(provided);
  if (!Array.isArray(verified)) {
    throw new ToolchainInstallError(
      `The ${tool} install finished, but '${verified}' is still not reachable from a new process. ` +
        `Restart VS Code and try again, or install ${verified} manually.`,
      tool,
      installDocsUrl(tool),
    );
  }
  for (const t of provided) markToolAvailable(t);
  context.output.appendLine(
    `[Toolchain] Verified ${provided.join(', ')} on PATH${verified.length > 0 ? ` (binary dirs: ${verified.join('; ')})` : ''}.`,
  );
  return verified;
}

/* --------------------------------------------------------------------------
 * Proactive dependency install (HYP-1169): run `<pm> install` BEFORE the
 * dev-server spawn when the project obviously needs it, so first open goes
 * straight to a running preview. Failure here must NOT fail the start — the
 * caller falls back to the reactive _repairDependencies path.
 * ------------------------------------------------------------------------ */

export interface DependenciesFsDeps {
  fileExists?: (path: string) => Promise<boolean>;
  /** mtime in ms, or null when the path does not exist. */
  mtimeMs?: (path: string) => Promise<number | null>;
}

const LOCKFILE_BY_PM: Record<PackageManagerName, readonly string[]> = {
  bun: ['bun.lock', 'bun.lockb'],
  pnpm: ['pnpm-lock.yaml'],
  yarn: ['yarn.lock'],
  npm: ['package-lock.json'],
};

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function defaultMtimeMs(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * True when the project at `cwd` needs `<pm> install` before a dev-server
 * start: a package.json exists AND (node_modules is missing OR package.json
 * is newer than the pm's lockfile — the manifest was edited after the last
 * install). No lockfile → no reliable staleness signal → skip.
 */
export async function shouldInstallDependencies(
  cwd: string,
  pm: PackageManagerName,
  deps: DependenciesFsDeps = {},
): Promise<boolean> {
  const fileExists = deps.fileExists ?? defaultFileExists;
  const mtimeMs = deps.mtimeMs ?? defaultMtimeMs;
  const joinPath = (name: string) => `${cwd}/${name}`;
  if (!(await fileExists(joinPath('package.json')))) return false;
  if (!(await fileExists(joinPath('node_modules')))) return true;
  for (const lockfile of LOCKFILE_BY_PM[pm]) {
    const lockMtime = await mtimeMs(joinPath(lockfile));
    if (lockMtime === null) continue;
    const pkgMtime = await mtimeMs(joinPath('package.json'));
    return pkgMtime !== null && pkgMtime > lockMtime;
  }
  return false;
}

export interface EnsureDependenciesContext {
  output: { appendLine(line: string): void };
  exec?: ToolchainExecDeps;
  deps?: DependenciesFsDeps;
  /**
   * Skip the staleness check and run `<pm> install` unconditionally — the
   * Retry path after a successful install left required .bin entries missing
   * (an incomplete/interrupted node_modules can look fresh by mtime).
   */
  force?: boolean;
}

/**
 * Proactively run `<pm> install` in `cwd` (the spawn-plan cwd — the install
 * root for wrapper-script monorepos). Returns 'installed' | 'skipped'.
 *
 * HYP-1169 round 2: a failure here is FATAL for the start (the caller stops
 * the pipeline with a friendly error + Retry) — blind-continuing spawned the
 * dev server into a guaranteed "'nx' is not recognized" (Alex's Windows run).
 */
export async function ensureDependencies(
  cwd: string,
  pm: PackageManagerName,
  context: EnsureDependenciesContext,
): Promise<'installed' | 'skipped'> {
  if (!context.force && !(await shouldInstallDependencies(cwd, pm, context.deps))) return 'skipped';
  const installStep: InstallStep = {
    tool: pm,
    command: `${pm} install`,
    display: `Installing project dependencies (${pm} install)`,
    requiresSudo: false,
    docsUrl: DOCS_URLS[pm],
    cwd,
  };
  const runStep = context.exec?.runStep ?? createDefaultRunner(context.output, context.exec ?? {});
  await runStep(installStep);
  return 'installed';
}

/** Shim extensions a package manager can drop into node_modules/.bin on Windows. */
const LOCAL_BINARY_EXTENSIONS: readonly string[] = ['', '.cmd', '.exe', '.bat', '.ps1'];

/**
 * Which of the local binaries the spawn command actually needs are ABSENT
 * from `<cwd>/node_modules/.bin` (HYP-1169 round 2). Checked AFTER the
 * dependency install: a binary still missing then means the install was
 * incomplete, and spawning would die with "'<bin>' is not recognized" — the
 * caller surfaces a friendly error naming the binary instead.
 */
export async function findMissingLocalBinaries(
  cwd: string,
  binaries: readonly string[],
  deps: DependenciesFsDeps = {},
): Promise<string[]> {
  const fileExists = deps.fileExists ?? defaultFileExists;
  const missing: string[] = [];
  for (const binary of binaries) {
    let found = false;
    for (const ext of LOCAL_BINARY_EXTENSIONS) {
      if (await fileExists(`${cwd}/node_modules/.bin/${binary}${ext}`)) {
        found = true;
        break;
      }
    }
    if (!found) missing.push(binary);
  }
  return missing;
}
