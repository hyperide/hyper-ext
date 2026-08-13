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
 *
 * Round 3 (Alex's Windows run, bun 1.3.14 via winget):
 *  - The LIVE VERIFICATION PROBE is the arbiter of every step, not the
 *    installer's exit code. A step's toleratedExitCodes (winget 0x8A15002B
 *    "already installed, no upgrade available") only suppress the immediate
 *    failure path — the post-install `<tool> --version` probe still decides,
 *    and ensureTool re-probes BEFORE installing too, so an
 *    installed-but-not-on-PATH tool is never reinstalled.
 *  - The installer's last non-empty output line streams into the progress
 *    notification (throttled ~500ms), so a multi-minute winget/brew download
 *    shows movement instead of a dead title.
 *
 * HYP-1188 (a Windows user's `bun install` run: a burst of "Fail extracting
 * tarball" / "Integrity check failed" errors — a flaky network mid-download
 * corrupting bun's local install cache — ending in an esbuild postinstall
 * version-mismatch crash):
 *  - killProcessTree replaces a bare `child.kill('SIGKILL')` on timeout/
 *    cancellation. `spawn(cmd, {shell:true})` on Windows launches cmd.exe as
 *    the tracked pid, which execs the real installer as ITS OWN child;
 *    SIGKILLing cmd.exe does not touch that child or any workers it forked —
 *    they keep writing to the inherited stdout/stderr pipe, which is why the
 *    output channel kept growing lines after "timed out after 10 minutes"
 *    was already logged. Windows gets `taskkill /pid <pid> /t /f` (kills the
 *    whole tree); POSIX keeps a single SIGKILL — `shell:true` execs a single
 *    simple command IN PLACE of the shell (no subshell fork), so the tracked
 *    pid already IS the real installer there.
 *  - `runStepProcess`'s onData listeners now check `killed` (set ONLY on a
 *    timeout/cancellation teardown, never on a normal exit — a normal exit
 *    can still emit a `data` event before `close` drains the OS-buffered
 *    pipe, and that output is legitimate) before appending —
 *    belt-and-suspenders for the case a tree-kill itself fails (e.g.
 *    `taskkill` missing or blocked): an orphan that survived the kill must
 *    never keep growing the output channel after we already gave up on it.
 *  - `ensureDependencies` retries a failed `<pm> install` up to 2 additional
 *    times, each with `--force`/`--check-cache` (the flag bun/npm/pnpm/yarn
 *    Classic vs Yarn Berry share for "bypass a stale/corrupted local cache
 *    entry, refetch from the registry") — a single corrupted tarball
 *    otherwise fails every identical retry (including DevServerManager's one
 *    interactive Retry button) forever. A user cancellation is never
 *    retried, and a non-retryable failure (permission error, etc.) surfaces
 *    immediately, unwrapped. `resolveStepOutcome` attaches a bounded output
 *    tail to a non-zero-exit rejection (`createRecentOutputBuffer`) —
 *    without it every step failure collapses to the generic "<display>
 *    failed (exit code N)", which never contains the installer's actual
 *    "Fail extracting tarball" / "Integrity check failed" text that
 *    `isRetryableInstallError` classifies on, so the retry would never fire
 *    for a real installer failure. `ToolchainInstallError.retriesExhausted`
 *    marks ONLY the final give-up error, so DevServerManager's dialog can
 *    show the "flaky network" framing exactly when it is earned instead of
 *    unconditionally for every dependency-install failure.
 *  - `runStepProcess` finalizes a step's outcome on the child's `close`
 *    event, NOT `exit` (round 2 of this ticket, a review finding): Node
 *    documents that `exit` can fire before the stdio streams finish
 *    draining, so a step whose final stderr line arrives in that window was
 *    intermittently finalizing `resolveStepOutcome` BEFORE that line reached
 *    `recentOutput` — silently losing the exact text `isRetryableInstallError`
 *    needs, so the cache-bypassing retry described above would work or not
 *    depending on pipe-drain timing. `close` is Node's documented guarantee
 *    that both stdio streams have ended.
 *  - Round 3: waiting UNCONDITIONALLY for `close` reintroduced the exact
 *    orphan problem this ticket is about — a detached child that inherited
 *    the pipe and outlives the tracked process means `close` may never fire
 *    at all, hanging an already-finished step for the full step timeout.
 *    `attachStepLifecycle` now bridges both: on `exit`, wait
 *    `EXIT_TO_CLOSE_GRACE_MS` for `close`; if it hasn't arrived, finalize
 *    anyway using the exit code already in hand.
 *  - Round 4: two review findings on the round-3 grace window. (1) The main
 *    step-timeout timer wasn't cleared on `exit`, so a timeout landing
 *    inside the grace window could `kill()` — and reject as "timed out" —
 *    an ALREADY-EXITED, possibly-successful process; `exited` now makes
 *    `kill()` a no-op once `exit` has fired, and the timer is cleared
 *    immediately. (2) `onData` gated `recentOutput` collection on the same
 *    flag as output-channel suppression, so an orphan's error text arriving
 *    just past the grace window silently vanished from BOTH — quietly
 *    reintroducing the round-2 bug; `recentOutput` now always collects,
 *    only the channel/progress side effects are suppressed.
 *  - Round 5: two P2 review findings on PR #715, PLUS a same-round self-review
 *    finding on the first fix. (1) `createRecentOutputBuffer` truncated
 *    purely chronologically (last `RECENT_OUTPUT_MAX_LINES` lines) — a cache
 *    failure followed by more than 20 further diagnostic lines (e.g. the
 *    esbuild postinstall crash the original incident continued into) lost the
 *    ONE line `isRetryableInstallError` classifies on. A first attempt at the
 *    fix pinned that line at `lines[0]` — which `tail()`'s OWN
 *    `.slice(-RECENT_OUTPUT_MAX_CHARS)` then evicted right back out once the
 *    remaining lines joined past ~2000 chars (realistic for real installer
 *    stack traces; caught independently by two reviewers). `tail()` now
 *    computes the normal bounded text first and appends the decisive line —
 *    itself budget-capped — only if it isn't already present, so the
 *    guarantee holds against BOTH truncation layers. (2) `isYarnBerry` checked
 *    only `cwd` for `.yarnrc.yml` — a Berry workspace MEMBER (the file lives
 *    at the workspace root) misclassified as Classic and picked `--force`, an
 *    unrecognized flag for Berry, so the cache-bypass retry failed
 *    immediately. It now walks ancestors via the same bounded `ancestorDirs`
 *    primitive `detectPackageManagerLockfile` uses (home dir injectable via
 *    `DependenciesFsDeps.homeDir`), stopping at the nearest `yarn.lock` (a
 *    NESTED Classic package inside a Berry monorepo must not inherit the
 *    monorepo root's Berry-ness) or the VCS root, whichever comes first.
 */

import { spawn, spawnSync } from 'node:child_process';
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
import { ancestorDirs } from './ProjectDetector';
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
  /**
   * Round 3: exit codes meaning "already satisfied", NOT failure (winget
   * 0x8A15002B UPDATE_NOT_APPLICABLE: the package is already installed and
   * no upgrade applies). They ONLY suppress the immediate failure path — the
   * post-install live verification probe remains the arbiter, so a tolerated
   * exit that leaves the tool unreachable still fails the install.
   */
  toleratedExitCodes?: readonly number[];
}

export class ToolchainInstallError extends Error {
  constructor(
    message: string,
    readonly tool: ToolchainTool,
    readonly docsUrl: string,
    /**
     * HYP-1188: true ONLY for ensureDependencies' own "gave up after N
     * attempts, including a cache-bypassing retry" error. Lets a caller
     * (DevServerManager's dialog) show flaky-network framing ONLY when it is
     * actually earned by an exhausted retry loop — every other
     * ensureDependencies failure (a cancellation, a non-retryable error like
     * EACCES) is deliberately surfaced UNWRAPPED (see isRetryableInstallError)
     * precisely so it is NOT mislabeled as network flakiness; a caller that
     * ignores this flag and shows the flaky-network wording unconditionally
     * defeats that design.
     */
    readonly retriesExhausted = false,
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

/**
 * winget's APPINSTALLER_CLI_ERROR_UPDATE_NOT_APPLICABLE — "the package is
 * already installed and no upgrade applies". For a self-healing install this
 * is success-in-disguise (Alex's bun 1.3.14: winget exited 2316632107 and
 * the extension aborted a healthy machine). Compared as unsigned 32-bit.
 */
const WINGET_UPDATE_NOT_APPLICABLE = 0x8a15002b;

/**
 * Round 3: is `code` a tolerated "already satisfied" outcome for the step?
 * Compares UNSIGNED 32-bit forms so the signed int32 (-1978335189) and
 * unsigned DWORD (2316632107) spellings of 0x8A15002B both match — Node's
 * reported exit code for a Windows child varies by how the process exits.
 */
export function isToleratedExitCode(toleratedExitCodes: readonly number[] | undefined, code: number | null): boolean {
  if (code === null || !toleratedExitCodes) return false;
  const unsigned = code >>> 0;
  return toleratedExitCodes.some((tolerated) => tolerated >>> 0 === unsigned);
}

function step(
  tool: ToolchainTool,
  command: string,
  display: string,
  requiresSudo = false,
  toleratedExitCodes?: readonly number[],
): InstallStep {
  return { tool, command, display, requiresSudo, docsUrl: DOCS_URLS[tool], toleratedExitCodes };
}

function bunInstallPlan(env: InstallEnvironment): InstallStep[] {
  if (env.platform === 'win32') {
    return env.winget
      ? [
          step('bun', 'winget install --id Oven-sh.Bun -e --silent', 'Installing Bun via winget', false, [
            WINGET_UPDATE_NOT_APPLICABLE,
          ]),
        ]
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
      ? [
          step('node', 'winget install --id OpenJS.NodeJS -e --silent', 'Installing Node.js via winget', false, [
            WINGET_UPDATE_NOT_APPLICABLE,
          ]),
        ]
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

/* --------------------------------------------------------------------------
 * Round 3: the step-runner spawn seam. Tests drive the default runner with a
 * fake child (EventEmitter-based) — the repo convention is that tests never
 * spawn or install anything, but the tolerated-exit / progress-streaming
 * behavior lives INSIDE the default runner, so the runner's spawn must be
 * injectable (same seam shape as detectWindowsOemCodePage(platform, spawnFn)).
 * ------------------------------------------------------------------------ */

/** The stdout/stderr slice of a child process the step runner consumes. */
interface StepChildStream {
  on(event: 'data', listener: (data: Buffer) => void): void;
}

/** The ChildProcess subset the step runner needs — implemented by the real spawn result and by test fakes. */
export interface StepChildProcess {
  readonly stdout: StepChildStream | null;
  readonly stderr: StepChildStream | null;
  /** Undefined only if spawn failed before the OS assigned a pid — killProcessTree tolerates that. */
  readonly pid?: number;
  on(event: 'error', listener: (error: Error) => void): void;
  on(event: 'exit', listener: (code: number | null) => void): void;
  /**
   * HYP-1188: `runStepProcess` finalizes the step's outcome on `close`, not
   * `exit` — Node's own docs warn `'exit'` can fire BEFORE the stdio streams
   * finish draining (a burst of stderr right before the process dies can
   * still be in flight), while `'close'` is guaranteed to fire only after
   * both streams have ended. Finalizing on `'exit'` intermittently lost the
   * installer's final error line from `resolveStepOutcome`'s output-tail
   * capture — the exact text `isRetryableInstallError` classifies on —
   * making the cache-bypassing retry a coin flip for the real-world failure
   * this change targets (review finding, HYP-1188 round 2).
   */
  on(event: 'close', listener: (code: number | null) => void): void;
  kill(signal?: NodeJS.Signals): void;
}

/** How the step runner spawns the install command (default: node:child_process spawn, shell: true). */
export type SpawnStepProcess = (command: string, options: { cwd?: string; env: NodeJS.ProcessEnv }) => StepChildProcess;

const defaultSpawnStepProcess: SpawnStepProcess = (command, options) =>
  // nosemgrep: spawn-shell-true -- install commands are built by buildInstallPlan, never from user input
  spawn(command, { ...options, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });

/** Runs the OS process-tree kill (default killProcessTree's win32 branch: `taskkill /pid <pid> /t /f`). */
export type SpawnSyncTreeKill = (command: string, args: readonly string[]) => void;

/**
 * HYP-1188 follow-up: bounds `defaultSpawnSyncTreeKill`'s `spawnSync` call.
 * `spawnSync` runs synchronously on the extension host's single JS thread —
 * without a timeout, a stalled `taskkill.exe` (locked handle, AV interception, a
 * pathological process tree) freezes the ENTIRE extension host for every extension in
 * the window until the user force-quits VS Code, not just this one. This is an
 * availability risk, not the milder "manual Retry" degradation of this PR's other known
 * limitations: the condition that makes a user cancel/timeout an install (a wedged
 * process holding file locks) is the same condition that makes `taskkill` slow to walk
 * that tree, so the two aren't independent rare events. 5s comfortably covers a normal
 * `taskkill /t /f` (which returns in milliseconds) while bounding the worst case to a
 * brief hitch instead of a hang.
 *
 * A timeout does NOT throw — `spawnSync` returns with `killSignal` already applied to
 * `taskkill.exe` itself, so the descendant walk it was mid-way through may be only
 * partially complete (some orphans could survive). This is an accepted, bounded-time-
 * over-guaranteed-completeness tradeoff, not a regression: `killProcessTree`'s own
 * unconditional `child.kill('SIGKILL')` right below already treats any taskkill outcome
 * (success, throw, or now a timeout) as best-effort and never assumes the tree is fully
 * gone — see that call's doc comment.
 */
const TASKKILL_SPAWN_TIMEOUT_MS = 5_000;

const defaultSpawnSyncTreeKill: SpawnSyncTreeKill = (command, args) => {
  spawnSync(command, args, { stdio: 'ignore', timeout: TASKKILL_SPAWN_TIMEOUT_MS, killSignal: 'SIGKILL' });
};

/**
 * HYP-1188: terminate the ENTIRE process tree rooted at a step's spawned
 * pid, not just that single process. `shell:true` on Windows spawns
 * `cmd.exe /d /s /c "<command>"` — cmd.exe is the pid Node tracks, and it
 * execs the real installer (bun.exe, npm.cmd → node.exe, …) as ITS OWN
 * child, which inherits cmd.exe's stdout/stderr pipe handles. A plain
 * `child.kill('SIGKILL')` (TerminateProcess) only reaches that one cmd.exe
 * pid: the real installer, and any workers IT forked (e.g. bun's parallel
 * tarball downloaders), survive and keep writing into the inherited pipe —
 * which is why a Windows user's output channel kept growing lines well
 * after "timed out after 10 minutes" was already logged and the step had
 * already rejected. `taskkill /t` recurses the whole tree; `/f` forces it.
 *
 * POSIX does not need the SAME widening for the common case: `shell:true`
 * there spawns `/bin/sh -c "<command>"`, and for a single simple command sh
 * execs the real program IN PLACE of itself rather than forking a child, so
 * the tracked pid already IS the real installer and a single SIGKILL
 * reaches it directly — true for the ensureDependencies `<pm> install`
 * commands this bug is about. It is NOT universally true across
 * buildInstallPlan: the linux sudo-node step
 * (`sudo apt-get update && sudo apt-get install -y nodejs npm`) IS a
 * compound command, which sh runs by forking rather than exec-in-place, so
 * a SIGKILL to the tracked pid there would not reach apt-get. That step
 * requires an interactive sudo confirmation and is comparatively rare to
 * hit at exactly a timeout/cancellation; tracked as a known gap rather than
 * widened here (see HYP-1188 follow-up: POSIX process-group kill).
 */
export function killProcessTree(
  child: StepChildProcess,
  platform: NodeJS.Platform,
  spawnSyncFn: SpawnSyncTreeKill = defaultSpawnSyncTreeKill,
): void {
  if (platform === 'win32' && typeof child.pid === 'number') {
    try {
      spawnSyncFn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
    } catch {
      // best-effort — the SIGKILL below is the fallback (e.g. taskkill missing/blocked)
    }
  }
  try {
    child.kill('SIGKILL');
  } catch {
    // already gone
  }
}

/** Round 3: progress-line streaming cadence (the installer's last non-empty line, throttled). */
const PROGRESS_LINE_THROTTLE_MS = 500;

export interface ThrottledLineReporter {
  push(line: string): void;
  /** Flush any pending (throttled) line and cancel the trailing timer — call when the step ends. */
  dispose(): void;
}

/**
 * Round 3: leading+trailing throttle for streaming installer output into a
 * progress notification. The first line reports immediately; lines arriving
 * inside the window collapse to the LATEST one (a stale "Downloading 3%"
 * must never displace "Installing…"), delivered on the trailing edge;
 * dispose() flushes so the final line is never lost. intervalMs is
 * injectable purely so tests can drive it with fake timers.
 */
export function createThrottledLineReporter(
  report: (message: string) => void,
  intervalMs = PROGRESS_LINE_THROTTLE_MS,
): ThrottledLineReporter {
  let lastReportAt = 0;
  let pending: string | null = null;
  let timer: NodeJS.Timeout | null = null;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (pending === null) return;
    const message = pending;
    pending = null;
    lastReportAt = Date.now();
    report(message);
  };
  return {
    push(line) {
      const elapsed = Date.now() - lastReportAt;
      if (elapsed >= intervalMs) {
        lastReportAt = Date.now();
        report(line);
        return;
      }
      pending = line;
      if (!timer) {
        timer = setTimeout(flush, intervalMs - elapsed);
        timer.unref?.();
      }
    },
    dispose: flush,
  };
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
  /**
   * Round 3: step-process spawn seam (default: node:child_process spawn with
   * shell: true). Tests drive the default runner with a fake child — the
   * tolerated-exit and progress-streaming behavior lives inside the runner,
   * and tests never spawn real installers.
   */
  spawnProcess?: SpawnStepProcess;
  /**
   * HYP-1188: process-tree kill seam for tests (default: killProcessTree —
   * Windows `taskkill /pid <pid> /t /f`, POSIX single SIGKILL). Runs on
   * timeout and on cancellation.
   */
  killTree?: (child: StepChildProcess, platform: NodeJS.Platform) => void;
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
    const progressSink = exec.progress;
    if (progressSink) {
      progressSink.report(`${installStep.display}…`);
      // Round 3: stream the installer's last non-empty line into the shared
      // notification (throttled) — a silent multi-minute winget download
      // looked indistinguishable from a hang.
      const lines = createThrottledLineReporter((message) => progressSink.report(message));
      try {
        await runStepProcess(installStep, {
          platform,
          timeoutMs,
          token: exec.token ?? { isCancellationRequested: false },
          output,
          env: exec.env,
          onOutputLine: lines.push,
          spawnProcess: exec.spawnProcess,
          killTree: exec.killTree,
        });
      } finally {
        lines.dispose();
      }
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `HyperIDE: ${installStep.display}…`,
        cancellable: true,
      },
      async (progress, token) => {
        const lines = createThrottledLineReporter((message) => progress.report({ message }));
        try {
          await runStepProcess(installStep, {
            platform,
            timeoutMs,
            token,
            output,
            env: exec.env,
            onOutputLine: lines.push,
            spawnProcess: exec.spawnProcess,
            killTree: exec.killTree,
          });
        } finally {
          lines.dispose();
        }
      },
    );
  };
}

interface RunStepProcessOptions {
  platform: NodeJS.Platform;
  timeoutMs: number;
  token: { isCancellationRequested: boolean; onCancellationRequested?: (cb: () => void) => unknown };
  output: { appendLine(line: string): void };
  env?: NodeJS.ProcessEnv;
  /** Round 3: sink for the installer's non-empty output lines (progress streaming). */
  onOutputLine?: (line: string) => void;
  spawnProcess?: SpawnStepProcess;
  /** HYP-1188: process-tree kill seam (default: killProcessTree). See its doc comment. */
  killTree?: (child: StepChildProcess, platform: NodeJS.Platform) => void;
}

/**
 * HYP-1188: bounded tail of a step's combined stdout+stderr, attached to a
 * non-zero-exit rejection message. Without this, EVERY runStepProcess
 * failure collapses to the generic `"<display> failed (exit code N)"` —
 * `ensureDependencies`' `isRetryableInstallError` classifies on the error
 * MESSAGE, so a real `bun install` exit (stderr: "Fail extracting tarball
 * ...") would never match the retryable pattern and the cache-bypassing
 * retry — the actual point of this change — would never fire for a real
 * installer failure, only for the step's own timeout/cancellation reason
 * strings. Bounded (last N lines / M chars) so a chatty installer can't
 * balloon the error message.
 */
const RECENT_OUTPUT_MAX_LINES = 20;
const RECENT_OUTPUT_MAX_CHARS = 2000;

/**
 * Round 5 (P2 review, PR #715): a chronological FIFO window silently drops
 * the decisive "Fail extracting tarball" / "Integrity check failed" line once
 * more than RECENT_OUTPUT_MAX_LINES of further diagnostic output follows it —
 * exactly the shape of the original incident, which continued into an esbuild
 * postinstall crash. `isRetryableInstallError` then never sees the text it
 * classifies on and the retry this ticket exists to provide never fires.
 *
 * The buffer tracks the FIRST line matching the retry pattern independently
 * of the sliding window (`decisiveLine`), but does NOT try to keep it IN
 * `lines` — an earlier version pinned it at `lines[0]`, which `tail()`'s own
 * `.slice(-RECENT_OUTPUT_MAX_CHARS)` then evicted right back out the moment
 * the other ~19 lines joined to more than ~2000 chars (entirely realistic
 * for real installer stack traces — round-5 review finding, confirmed by two
 * independent reviewers). Instead `tail()` computes the normal bounded text
 * first, and appends `decisiveLine` — itself budget-capped — ONLY if that
 * text doesn't already contain it, so the guarantee holds regardless of how
 * either truncation layer (line count or char count) would otherwise cut it.
 *
 * Known, accepted tradeoff (review finding, tracked as HYP-1206): this
 * necessarily broadens retry classification from "the tail of output" to
 * "anything retryable seen ANYWHERE in this attempt" — an install that logs
 * a transient `Fail extracting tarball…` early (and recovers) then fails
 * LATER for a genuinely non-retryable reason (e.g. EACCES) will still
 * classify as retryable and burn one bounded `--force`/`--check-cache`
 * attempt before the real error surfaces. Low blast radius (bounded by
 * `DEFAULT_INSTALL_ATTEMPTS`, and the cache-bypass flags are harmless
 * no-ops against a permission error), but a correct fix needs the retry
 * decision to consult a signal captured independently of this display
 * buffer rather than round-tripped through its (necessarily lossy) text —
 * see HYP-1206.
 */
function createRecentOutputBuffer(): { push(text: string): void; tail(): string } {
  let lines: string[] = [];
  let decisiveLine: string | null = null;
  return {
    push(text: string) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (decisiveLine === null && RETRYABLE_INSTALL_ERROR_PATTERN.test(trimmed)) {
          decisiveLine = trimmed;
        }
        lines.push(trimmed);
      }
      if (lines.length > RECENT_OUTPUT_MAX_LINES) lines = lines.slice(-RECENT_OUTPUT_MAX_LINES);
    },
    tail() {
      const bounded = lines.join(' | ').slice(-RECENT_OUTPUT_MAX_CHARS);
      if (decisiveLine === null || bounded.includes(decisiveLine)) return bounded;
      // Keep the START of decisiveLine, not its end: `Fail extracting
      // tarball…` / `Integrity check failed…` are prefixes, so a decisive
      // line long enough to alone exceed RECENT_OUTPUT_MAX_CHARS (a review
      // finding on this fix's first draft) must be truncated from the back —
      // slicing the combined " | line" suffix from the front, as an earlier
      // draft did, would cut the classifying keyword itself back out.
      const separator = ' | ';
      const keptLine = decisiveLine.slice(0, Math.max(0, RECENT_OUTPUT_MAX_CHARS - separator.length));
      const suffix = separator + keptLine;
      const room = Math.max(0, RECENT_OUTPUT_MAX_CHARS - suffix.length);
      return bounded.slice(bounded.length - room) + suffix;
    },
  };
}

/**
 * Decide the step's outcome once its process has exited: flush+emit any
 * buffered decoder tail, then resolve on a clean/tolerated exit or reject
 * with a ToolchainInstallError otherwise. Split out of runStepProcess to
 * keep that function under the repo's ~80-line guideline — this is the
 * self-contained "what does this exit code mean" decision, with no
 * dependency on the timeout/cancellation/kill wiring around it.
 */
function resolveStepOutcome(
  code: number | null,
  installStep: InstallStep,
  decoders: { stdout: StreamOutputDecoder; stderr: StreamOutputDecoder },
  output: { appendLine(line: string): void },
  emitLines: (text: string) => void,
  recentOutput: ReturnType<typeof createRecentOutputBuffer>,
  resolve: () => void,
  reject: (error: Error) => void,
): void {
  const stdoutTail = decoders.stdout.flush();
  const stderrTail = decoders.stderr.flush();
  if (stdoutTail) {
    const text = stdoutTail.replace(ANSI_ESCAPE_PATTERN, '').trimEnd();
    output.appendLine(text);
    emitLines(text);
    recentOutput.push(text);
  }
  if (stderrTail) {
    const text = stderrTail.replace(ANSI_ESCAPE_PATTERN, '').trimEnd();
    output.appendLine(text);
    emitLines(text);
    recentOutput.push(text);
  }
  if (code === 0) {
    resolve();
    return;
  }
  // Round 3: a tolerated "already satisfied" exit (winget 0x8A15002B) is
  // NOT a failure — but it is never success on its own either. The step
  // resolves here and the post-install live `<tool> --version`
  // verification (the arbiter) decides the outcome.
  if (isToleratedExitCode(installStep.toleratedExitCodes, code)) {
    output.appendLine(
      `[Toolchain] ${installStep.display} exited ${code} — tolerated (already satisfied); verifying with a live probe.`,
    );
    resolve();
    return;
  }
  const tail = recentOutput.tail();
  reject(
    new ToolchainInstallError(
      `${installStep.display} failed (exit code ${code ?? 'unknown'})${tail ? `: ${tail}` : ''}`,
      installStep.tool,
      installStep.docsUrl,
    ),
  );
}

/**
 * HYP-1188: on `exit`, wait this long for `close` before finalizing anyway.
 * Long enough to absorb the normal stdio-drain race (Node's I/O poll phase
 * resolves in well under this); short enough that an orphan holding the
 * inherited pipe open (the Windows `shell:true` scenario this ticket
 * targets) adds a barely-perceptible delay instead of hanging the step for
 * the full step timeout. See `attachStepLifecycle`'s doc comment.
 */
const EXIT_TO_CLOSE_GRACE_MS = 300;

/**
 * Wires a spawned step's timeout, cancellation, and exit/close finalization
 * onto `resolve`/`reject`. Split out of `runStepProcess` to keep that
 * function under the repo's ~80-line guideline.
 *
 * Finalization waits for `close`, not the tracked process's own `exit` —
 * Node documents `exit` can fire before stdio streams finish draining,
 * which was intermittently truncating the output tail
 * `resolveStepOutcome`/`isRetryableInstallError` depend on (HYP-1188 round
 * 2). But `close` alone can never fire at all if a DETACHED CHILD of the
 * tracked process inherited the pipe and outlives it (the exact Windows
 * `shell:true` orphan scenario this ticket is about) — waiting
 * unconditionally for `close` would hang an already-finished step for the
 * full `timeoutMs` (HYP-1188 round 3). `EXIT_TO_CLOSE_GRACE_MS` bridges
 * both: on `exit`, wait briefly for `close` (catches the normal drain
 * race); if `close` hasn't arrived by then, finalize anyway using the exit
 * code already in hand and mark `killedBox` so the caller's `onData` stops
 * appending that orphan's output (it is not this step's problem to wait
 * out any further).
 *
 * `exited` (review finding, HYP-1188 round 4): the process is done as soon
 * as `exit` fires — only pipe-drain is still pending. Without this guard,
 * a timeout or cancellation landing inside the grace window would call
 * `kill()` on an ALREADY-DEAD pid (on Windows, a possibly-recycled pid —
 * `taskkill /t` could hit an unrelated process tree) and reject an
 * install that may have exited 0 as "timed out"/"cancelled". `exit`
 * clears the main `timer` immediately (it can no longer legitimately
 * fire) and `kill()` no-ops once `exited` is set — the grace window only
 * ever affects WHEN finalization happens, never WHETHER it's a kill.
 */
function attachStepLifecycle(deps: {
  child: StepChildProcess;
  installStep: InstallStep;
  platform: NodeJS.Platform;
  timeoutMs: number;
  token: { isCancellationRequested: boolean; onCancellationRequested?: (cb: () => void) => unknown };
  decoders: { stdout: StreamOutputDecoder; stderr: StreamOutputDecoder };
  output: { appendLine(line: string): void };
  emitLines: (text: string) => void;
  recentOutput: ReturnType<typeof createRecentOutputBuffer>;
  killTree: (child: StepChildProcess, platform: NodeJS.Platform) => void;
  killedBox: { value: boolean };
  resolve: () => void;
  reject: (error: Error) => void;
}): void {
  const {
    child,
    installStep,
    platform,
    timeoutMs,
    token,
    decoders,
    output,
    emitLines,
    recentOutput,
    killTree,
    killedBox,
    resolve,
    reject,
  } = deps;
  let finished = false;
  let exited = false; // 'exit' has fired — the process is done, only pipe-drain is pending
  let exitGraceTimer: NodeJS.Timeout | undefined;

  const kill = (reason: string) => {
    if (finished || exited) return; // already exited — nothing to kill, and rejecting now would mislabel a completed run
    finished = true;
    killedBox.value = true;
    clearTimeout(exitGraceTimer);
    killTree(child, platform);
    reject(new ToolchainInstallError(reason, installStep.tool, installStep.docsUrl));
  };
  const timer = setTimeout(
    () => kill(`${installStep.display} timed out after ${Math.round(timeoutMs / 60_000)} minutes`),
    timeoutMs,
  );
  timer.unref?.();
  token.onCancellationRequested?.(() => kill(`${installStep.display} was cancelled`));

  const finalize = (code: number | null) => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(exitGraceTimer);
    resolveStepOutcome(code, installStep, decoders, output, emitLines, recentOutput, resolve, reject);
  };

  child.on('error', (error) => {
    // `exited` too, for consistency with `kill()`: Node does not document
    // 'error' firing after a clean 'exit' for a shell-spawned child with no
    // IPC channel, but a late 'error' during the exit→close grace window
    // must not reject an already-completed run either.
    if (finished || exited) return;
    finished = true;
    clearTimeout(timer);
    clearTimeout(exitGraceTimer);
    reject(new ToolchainInstallError(error.message, installStep.tool, installStep.docsUrl));
  });
  child.on('exit', (code) => {
    if (finished) return;
    exited = true;
    clearTimeout(timer); // the process is done — it can no longer legitimately time out
    exitGraceTimer = setTimeout(() => {
      killedBox.value = true; // give up on this orphan's pipe — stop growing the output channel from it
      finalize(code);
    }, EXIT_TO_CLOSE_GRACE_MS);
    exitGraceTimer.unref?.();
  });
  child.on('close', (code) => finalize(code));
}

async function runStepProcess(installStep: InstallStep, options: RunStepProcessOptions): Promise<void> {
  const { platform, timeoutMs, token, output } = options;
  const spawnStep = options.spawnProcess ?? defaultSpawnStepProcess;
  /** Feed each non-empty output line to the progress sink (round 3). */
  const emitLines = (text: string) => {
    if (!options.onOutputLine) return;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (trimmed) options.onOutputLine(trimmed);
    }
  };
  // `new Promise` (not Promise.withResolvers): the extension tsconfig targets ES2022.
  return new Promise<void>((resolve, reject) => {
    // Same live-box pattern as DevServerManager: the (cached, win32-only) probe
    // resolves mid-stream; chunks before it resolves decode as UTF-8.
    const oemCodePageBox: { value: number | null } = { value: null };
    detectWindowsOemCodePage().then((codePage) => {
      oemCodePageBox.value = codePage;
    });

    output.appendLine(`[Toolchain] ${installStep.display}: ${installStep.command}`);
    const child = spawnStep(installStep.command, {
      cwd: installStep.cwd,
      env: { ...process.env, ...options.env, CI: 'true' },
    });
    const stdoutDecoder = new StreamOutputDecoder(platform, () => oemCodePageBox.value);
    const stderrDecoder = new StreamOutputDecoder(platform, () => oemCodePageBox.value);
    // HYP-1188: `killedBox.value` is set once we've explicitly torn down the
    // tree (timeout/cancellation) or given up waiting on an orphan's
    // inherited pipe past the close grace period — NOT on a normal exit. A
    // normal `exit` can still be followed by a `data` event before `close`
    // drains the OS-buffered pipe (Node documents this ordering); that
    // output was legitimately produced by the process and must still reach
    // the channel.
    //
    // `killedBox` gates ONLY the output-channel/progress side effects, NEVER
    // `recentOutput` (round 4 review finding): the two are different
    // concerns — "stop spamming the user-visible log with an abandoned
    // orphan's output" vs "keep the classification evidence
    // isRetryableInstallError needs". Gating both on the same flag meant an
    // orphan's error text arriving just past the close-grace window (loaded
    // machine, large buffered burst) silently vanished from BOTH — quietly
    // reintroducing the exact "retry never fires for a real failure" bug
    // round 2 fixed. `recentOutput` is already bounded (20 lines / 2000
    // chars), so collecting from an abandoned orphan a little longer is
    // cheap.
    const killedBox = { value: false };
    const recentOutput = createRecentOutputBuffer();
    const onData = (decoder: StreamOutputDecoder) => (data: Buffer) => {
      const text = decoder.push(data).replace(ANSI_ESCAPE_PATTERN, '').trimEnd();
      recentOutput.push(text);
      if (killedBox.value) return;
      output.appendLine(text);
      emitLines(text);
    };
    child.stdout?.on('data', onData(stdoutDecoder));
    child.stderr?.on('data', onData(stderrDecoder));

    attachStepLifecycle({
      child,
      installStep,
      platform,
      timeoutMs,
      token,
      decoders: { stdout: stdoutDecoder, stderr: stderrDecoder },
      output,
      emitLines,
      recentOutput,
      killTree: options.killTree ?? killProcessTree,
      killedBox,
      resolve,
      reject,
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
 * Honest-availability invariants (HYP-1169 rounds 2+3):
 *  - The availability boolean is only a HINT in both directions; the live
 *    `<tool> --version` probe is the arbiter. A cached "available" entry
 *    that fails the probe is invalidated and re-healed (round 2); a
 *    "missing" report that PASSES the probe (stale session cache, or an
 *    installed-but-not-on-PATH tool like Alex's winget-installed bun 1.3.14)
 *    skips the install entirely and patches the cache (round 3).
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

  // Round 3: the live probe is the arbiter in BOTH directions — run it
  // whether detection said "available" OR "missing". A missing-report that
  // passes the probe skips the install entirely (installed-but-not-on-PATH,
  // e.g. winget installed bun before VS Code launched); an available-report
  // that fails it falls through to the heal below.
  const checkTools = tool === 'node' || tool === 'npm' ? (['node', 'npm'] as ToolchainTool[]) : [tool];
  const preVerified = await verifyTools(checkTools);
  if (Array.isArray(preVerified)) {
    if (!context.availability[tool]) {
      for (const t of checkTools) markToolAvailable(t);
      context.output.appendLine(
        `[Toolchain] ${tool} was reported missing, but a live '<tool> --version' probe passes` +
          `${preVerified.length > 0 ? ` with ${preVerified.join('; ')} on PATH` : ''} — skipping the install.`,
      );
    }
    return preVerified;
  }
  if (context.availability[tool]) {
    // Honest cache: trust the session cache only after a live probe. The
    // probe env includes the probe-resolved dirs, so a tool installed but not
    // yet on the process PATH (Alex's bun) still verifies — and its dir is
    // returned for the child PATH.
    invalidateToolAvailability(tool);
    context.output.appendLine(
      `[Toolchain] ${tool} was cached as available but '<${preVerified}> --version' fails — re-running the install.`,
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
  /**
   * HYP-1188 round 5: override for the `$HOME` bound `isYarnBerry`'s
   * ancestor walk stops at (via `ancestorDirs`) — tests only. Production
   * always defaults to the real `os.homedir()`, same as every other
   * ancestor-walk consumer in `ProjectDetector.ts`.
   */
  homeDir?: string;
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
  /** HYP-1188: total install attempts before giving up (default 3 — see DEFAULT_INSTALL_ATTEMPTS). */
  maxAttempts?: number;
}

/** HYP-1188: 1 plain attempt + 2 cache-bypassing retries. */
const DEFAULT_INSTALL_ATTEMPTS = 3;

/**
 * HYP-1188: is this project's yarn a modern/Berry (2+) install, not Classic
 * (1.x)? Berry always writes `.yarnrc.yml` (its own config format; Classic
 * uses a plain `.yarnrc`) — the same marker corepack itself keys off to pick
 * an implementation. This matters because the two majors do NOT share a
 * cache-bypass flag (see resolveCacheBypassFlag) — defaults to Classic (no
 * marker found) since that is what a bare globally-installed `yarn` is on
 * most machines without corepack.
 *
 * Round 5 (P2 review, PR #715): a Yarn Berry WORKSPACE MEMBER doesn't carry
 * its own `.yarnrc.yml` — the file lives at the workspace root, exactly like
 * a monorepo subpackage has no lockfile of its own (see
 * `detectPackageManagerLockfile`). Checking only `cwd` misclassified every
 * Berry workspace member as Classic and picked `--force`, an unrecognized
 * flag for Berry's `install` — the retry then failed immediately instead of
 * bypassing the cache. Walks up via the same bounded `ancestorDirs` primitive
 * `detectPackageManagerLockfile` uses (bounded by `$HOME`, `homeDir`
 * injectable for tests — see `DependenciesFsDeps.homeDir`), with two stop
 * conditions per ancestor, checked in order:
 *  1. `yarn.lock` present (no `.yarnrc.yml` in this same dir, or it would
 *     have matched first) — this IS the nearest Yarn project root and it is
 *     Classic; do not keep climbing into an enclosing monorepo's `.yarnrc.yml`
 *     (a nested Classic package inside a Berry monorepo must not inherit the
 *     monorepo's Berry-ness — mirrors Yarn's own project-root resolution,
 *     which stops at the nearest `yarn.lock`/`.yarnrc.yml`).
 *  2. `.git` present (the VCS root) — stop; an unrelated ancestor project's
 *     `.yarnrc.yml` above the repository must never be inherited.
 */
async function isYarnBerry(
  cwd: string,
  fileExists: (path: string) => Promise<boolean>,
  homeDir?: string,
): Promise<boolean> {
  for (const dir of ancestorDirs(cwd, homeDir)) {
    if (await fileExists(`${dir}/.yarnrc.yml`)) return true;
    if (await fileExists(`${dir}/yarn.lock`)) return false; // nearest Yarn project root — Classic, stop here
    if (await fileExists(`${dir}/.git`)) break; // VCS root — stop (matches detectPackageManagerLockfile)
  }
  return false;
}

/**
 * The cache-bypass flag to append on a retry. Resolved ONCE per
 * ensureDependencies call, not per attempt — the answer cannot change
 * between attempts of the same install. npm, pnpm, bun, and Yarn Classic all
 * accept `--force` ("bypass a stale/corrupted local cache entry, refetch
 * from the registry" — npm's own docs literally say "force npm to fetch
 * remote resources even if a local copy exists on disk"). Yarn Berry (2+)
 * has NO `--force` flag for `install` at all — passing it is an unknown-
 * option error, which would fail every retry immediately instead of
 * bypassing the cache — its equivalent is `--check-cache` ("always refetch
 * the packages and ... ensure that their checksum matches").
 */
async function resolveCacheBypassFlag(pm: PackageManagerName, cwd: string, deps: DependenciesFsDeps): Promise<string> {
  if (pm !== 'yarn') return '--force';
  const fileExists = deps.fileExists ?? defaultFileExists;
  return (await isYarnBerry(cwd, fileExists, deps.homeDir)) ? '--check-cache' : '--force';
}

/**
 * Build the InstallStep for one dependency-install attempt. Attempt 1 runs
 * the plain `<pm> install`; every retry appends `cacheBypassFlag` (resolved
 * once per install by resolveCacheBypassFlag). Without the right flag, a
 * retry either reruns the byte-for-byte identical command against the SAME
 * corrupted cache entry (fails identically forever), or — for Yarn Berry
 * specifically — fails immediately on an unrecognized flag.
 */
function buildDependencyInstallStep(
  pm: PackageManagerName,
  cwd: string,
  attempt: number,
  maxAttempts: number,
  cacheBypassFlag: string,
): InstallStep {
  const isRetry = attempt > 1;
  const command = isRetry ? `${pm} install ${cacheBypassFlag}` : `${pm} install`;
  const display = isRetry
    ? `Retrying dependency install (attempt ${attempt}/${maxAttempts}, bypassing cache: ${command})`
    : `Installing project dependencies (${command})`;
  return { tool: pm, command, display, requiresSudo: false, docsUrl: DOCS_URLS[pm], cwd };
}

/**
 * HYP-1188: only network/cache-shaped failures are worth a bounded retry —
 * a permission error, a disk-full error, or a failing lifecycle script will
 * not go away on an identical retry, and silently re-running a side-
 * effecting install script (postinstall, etc.) a second and third time is
 * not something this pipeline may do unprompted. Matched against the exact
 * error shapes from the reported Windows crash (tarball extraction/download
 * failures, integrity-check failures) plus the common Node.js network-error
 * codes.
 *
 * Deliberately EXCLUDES "timed out"/"timeout": the step timeout is a full
 * `INSTALL_TIMEOUT_MS` (10 minutes) — a corrupted-cache/network failure like
 * the ones this pattern targets fails FAST (the installer exits promptly
 * with a stderr message), it does not hang for the full timeout window.
 * Classifying a timeout as retryable would silently triple the wait for a
 * genuinely stuck environment (10 min → 30 min internally, then another 30
 * min via DevServerManager's interactive Retry) instead of surfacing the
 * hang to the user promptly.
 */
const RETRYABLE_INSTALL_ERROR_PATTERN =
  /fail(?:ed)?\s+(?:extracting|to download|to fetch)|integrity check failed|econnreset|econnrefused|enotfound|socket hang up|network error/i;

function isRetryableInstallError(message: string): boolean {
  return RETRYABLE_INSTALL_ERROR_PATTERN.test(message);
}

/**
 * Proactively run `<pm> install` in `cwd` (the spawn-plan cwd — the install
 * root for wrapper-script monorepos). Returns 'installed' | 'skipped'.
 *
 * HYP-1169 round 2: a failure here is FATAL for the start (the caller stops
 * the pipeline with a friendly error + Retry) — blind-continuing spawned the
 * dev server into a guaranteed "'nx' is not recognized" (Alex's Windows run).
 *
 * HYP-1188: a failed attempt is retried up to `maxAttempts` times (default
 * 3) before giving up — a Windows user's run showed a single corrupted/
 * truncated tarball in the local package-manager cache (flaky network mid-
 * download) failing EVERY identical retry, including the one interactive
 * Retry button DevServerManager already offered. Retries bypass the cache
 * (see buildDependencyInstallStep). Only network/cache-shaped failures are
 * retried (see isRetryableInstallError) — a permission error or a failing
 * lifecycle script is surfaced immediately, unwrapped, instead of being
 * force-retried and re-labeled as network flakiness. A user-initiated
 * cancellation is never retried — it propagates immediately once
 * `context.exec.token` reports it.
 */
export async function ensureDependencies(
  cwd: string,
  pm: PackageManagerName,
  context: EnsureDependenciesContext,
): Promise<'installed' | 'skipped'> {
  if (!context.force && !(await shouldInstallDependencies(cwd, pm, context.deps))) return 'skipped';
  const runStep = context.exec?.runStep ?? createDefaultRunner(context.output, context.exec ?? {});
  const maxAttempts = context.maxAttempts ?? DEFAULT_INSTALL_ATTEMPTS;
  const token = context.exec?.token;
  const cacheBypassFlag = await resolveCacheBypassFlag(pm, cwd, context.deps ?? {});

  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) {
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      context.output.appendLine(
        `[Toolchain] Dependency install attempt ${attempt - 1}/${maxAttempts} failed (${reason}) — ` +
          `retrying ${attempt}/${maxAttempts} with a cache-bypassing install.`,
      );
    }
    try {
      await runStep(buildDependencyInstallStep(pm, cwd, attempt, maxAttempts, cacheBypassFlag));
      return 'installed';
    } catch (error) {
      lastError = error;
      if (token?.isCancellationRequested) throw error; // a user cancellation is never retried
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableInstallError(message)) throw error; // not network/cache-shaped — retrying will not help
    }
  }
  const lastErrorMessage = lastError instanceof Error ? lastError.message : String(lastError);
  const retryClause = maxAttempts > 1 ? ', including a cache-bypassing retry' : '';
  throw new ToolchainInstallError(
    `Installing project dependencies (${pm} install) failed after ${maxAttempts} attempts${retryClause} ` +
      `(last error: ${lastErrorMessage}). This pattern (repeated tarball-extraction or integrity-check failures) ` +
      `usually points at a flaky network connection rather than a problem with the project. See the 'HyperIDE ` +
      `Dev Server' output channel for the full install log.`,
    pm,
    DOCS_URLS[pm],
    true, // retriesExhausted — earns the "flaky network" framing in DevServerManager's dialog
  );
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
