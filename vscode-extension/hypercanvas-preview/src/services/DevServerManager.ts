/**
 * Dev Server Manager - manages local dev server for user projects
 *
 * Starts/stops the dev server as a child process.
 * Detects project type and runs appropriate dev command.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { delimiter, join } from 'node:path';
import { detectFramework } from '@lib/preview-generator/framework-routing';
import { VITE_CONFIG_CANDIDATES } from '@lib/preview-generator/vite-config-ast';
import { patchViteConfigForReactDedupe } from '@lib/preview-generator/vite-config-react-dedupe';
import * as vscode from 'vscode';
import { ERROR_PATTERNS, SUCCESS_PATTERNS } from '../../../../shared/log-patterns';
import type { RuntimeError } from '../../../../shared/runtime-error';
import type { DevServerState, DevServerStatus, ProjectType } from '../types';
import { VSCodeFileIO } from '../vscode-file-io';
import {
  clearOwnedDevServer,
  findLiveOwnedDevServer,
  isProcessAlive,
  isProcessGroupAlive,
  type OwnedDevServerRecord,
  reapStaleOwnedDevServer,
  recordOwnedDevServer,
} from './devServerOrphanRegistry';
import { readSpawnPlan, writeSpawnPlan } from './devServerSpawnPlan';
import { findFreePort, probeHttp, probeOpen } from './netProbe';
import { PreviewProxy } from './PreviewProxy';
import {
  detectPackageManager,
  detectPackageManagerLockfile,
  findWorkspaceRoot,
  getPackageScripts,
  getProjectInfo,
} from './ProjectDetector';
import { detectWindowsOemCodePage, StreamOutputDecoder } from './windowsOutputDecoding';
import { detectAvailableTools } from './toolchainDetector';
import {
  ensureDependencies,
  ensureTool,
  findMissingLocalBinaries,
  requiredToolsForPackageManager,
  shouldInstallDependencies,
  ToolchainInstallError,
  type ToolchainProgress,
} from './toolchainInstaller';
import { mergePathEntries, refreshPathForChild } from './toolchainPath';

/**
 * Pure predicate behind {@link DevServerManager._hasDirtyViteConfig}: do any of the dirty open
 * documents' absolute paths point at a vite.config candidate under `projectPath`? Extracted so the
 * dirty-buffer guard is unit-testable without a process-global `vscode` mock (which leaks across the
 * extension's bun test files — see this suite's header / HYP-579). Matches every candidate filename,
 * a superset of the single file the patcher writes, so it never clobbers an unsaved config.
 *
 * Comparison is CASE-INSENSITIVE on macOS/Windows (default APFS/NTFS are case-insensitive): VS Code
 * can report `_projectPath` and an open doc's `fsPath` with different casing for the SAME file, and a
 * case-sensitive miss here would let the patch proceed and clobber the dirty buffer — the exact
 * data-loss this guard prevents. The false direction we MUST avoid is a false-negative (missed
 * dirty file → clobber), so on a case-insensitive platform we fold case before comparing.
 * `caseInsensitiveFs` defaults to the host platform but is an explicit param so the fold is
 * unit-testable per platform.
 */
export function anyDirtyDocIsViteConfig(
  projectPath: string,
  dirtyDocPaths: readonly string[],
  caseInsensitiveFs: boolean = process.platform === 'darwin' || process.platform === 'win32',
): boolean {
  const fold = (p: string): string => (caseInsensitiveFs ? p.toLowerCase() : p);
  const candidatePaths = new Set(VITE_CONFIG_CANDIDATES.map((name) => fold(join(projectPath, name))));
  return dirtyDocPaths.some((p) => candidatePaths.has(fold(p)));
}

const MAX_LOG_ENTRIES = 200;
// Strips all ANSI/VT escape sequences: CSI (ESC[...final), OSC (ESC]...BEL/ST), and bare ESC+char.
// CSI pattern covers color codes AND terminal mode sequences like \x1b[?2004h that Bun emits.
const ANSI_ESCAPE_PATTERN = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[A-Z\\[\]^_@]/g;
type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun';

/**
 * True when a dev-server output line signals Bun HMR staleness — the bundler can
 * no longer hot-replace a module because it is not a dynamic import (or explicitly
 * reports HMR stale state). The server keeps running but subsequent changes are not
 * reflected; a full restart of the dev server is the only reliable recovery.
 *
 * Exported so the predicate is unit-testable without spawning a process.
 */
export function isDynamicImportStalenessMessage(text: string): boolean {
  return /not a dynamic import|HMR stale/i.test(text);
}

/** Cap: maximum auto-restarts per episode before giving up and waiting for user action. */
const HMR_STALENESS_RESTART_CAP = 3;
/** Episode window: if the last staleness-restart was older than this, start a fresh episode. */
const HMR_STALENESS_EPISODE_WINDOW_MS = 60_000;

// Explicit dev-server lifecycle edges (HYP-370 Phase 2). The DevServerStatus enum
// (types.ts) is the de facto state; this table makes it a guarded machine instead of
// a passively-set field. Idempotent self-loops (to === from) are handled by transition()
// and are always legal, so they are not listed here.
//   stopped|error -> starting   start() begins a spawn
//   starting      -> running     stdout/stderr ready or _waitForReady port poll
//   starting      -> error       spawn 'error' event / start() catch
//   running       -> error       process 'error' event after it was serving
//   stopped       -> error       startup crash: the dev command exits during
//                                _waitForReady() (exit handler sets `stopped`),
//                                then start()'s catch surfaces the failure as `error`
//                                with the message — without this edge the UI would
//                                silently lose the failure state/message.
//   starting|running|error -> stopped   exit handler / stop()
const LEGAL_TRANSITIONS: Record<DevServerStatus, readonly DevServerStatus[]> = {
  stopped: ['starting', 'error'],
  starting: ['running', 'error', 'stopped'],
  running: ['error', 'stopped'],
  error: ['starting', 'stopped'],
};

export interface LogEntry {
  line: string;
  timestamp: number;
  isError: boolean;
}

export function appendScriptCliArgs(command: { args: string[] }, packageManager: PackageManager, args: string[]): void {
  if (packageManager === 'npm') {
    command.args.push('--', ...args);
    return;
  }
  command.args.push(...args);
}

/**
 * True when a dev/start script already pins its own port via a CLI `--port`/`-p` flag
 * (e.g. `vite dev --port 3000`, `next -p 4000`). In that case our injected `--port`
 * would be a redundant second port that only confuses the user, so we skip injecting it
 * and discover the real bound port from stdout (_maybeUpdatePortFromOutput).
 *
 * Only the CLI flag counts — env vars (`PORT=`, `VITE_PORT=`) are not reliable pins:
 * Vite ignores them, and an inline `PORT=…` assignment in the script overrides whatever
 * env we set anyway, so they never require suppressing our `--port` injection.
 */
export function devScriptDeclaresPort(script: string): boolean {
  return /--port[=\s]+\d/.test(script) || /(?:^|\s)-p[=\s]+\d/.test(script);
}

/**
 * True when a dev script delegates to a monorepo task runner / multi-process
 * wrapper (`nx run x:dev`, `turbo run dev`, `pnpm -r dev`, `yarn workspace …`,
 * `lerna run dev`, `npm-run-all`/`run-p`/`run-s`) rather than invoking the
 * dev-server binary directly (HYP-547).
 *
 * This matters for `--port` injection: our injected flag is appended to
 * `bun run dev` / `npm run dev --`, so it reaches the WRAPPER, not the
 * underlying vite/next/astro process — the port is silently ignored and the
 * server binds its own default ("dev server starts on wrong port" class).
 * When a wrapper is detected we skip injection and rely on stdout port
 * auto-detection (_maybeUpdatePortFromOutput); the underlying tool still prints
 * `http://localhost:PORT`, so the proxy retargets to the real bound port.
 *
 * False positives are benign — they only mean "skip injection, auto-detect
 * instead", the same safe fallback `devScriptDeclaresPort` already relies on.
 * False negatives are the actual bug, so the matchers lean broad. Word-boundary
 * anchored to avoid matching substrings (e.g. `--turbofan`, a `nx`-containing path).
 */
export function devScriptUsesWrapper(script: string): boolean {
  return (
    /(?:^|\s|&&|;|\|)\s*nx\s/.test(script) || // nx run / nx run-many / nx dev
    /(?:^|\s|&&|;|\|)\s*turbo\s/.test(script) || // turbo run dev / turbo dev
    /(?:^|\s|&&|;|\|)\s*lerna\s/.test(script) || // lerna run dev
    /(?:^|\s|&&|;|\|)\s*(?:npm-run-all|run-p|run-s)\b/.test(script) || // parallel/serial script runners
    /(?:^|\s)pnpm\s+(?:-r\b|--recursive\b|--filter\b|-F\b)/.test(script) || // pnpm workspace fan-out
    /(?:^|\s)yarn\s+workspaces?\b/.test(script) // yarn workspace / workspaces foreach
  );
}

/**
 * The `--port` CLI args to append for a given project type + dev script (HYP-547).
 * This is the exact decision `start()` makes, extracted as a pure function so the
 * wiring — not just the predicates — is unit-testable without spawning a process.
 *
 * Returns `[]` (no injection, fall back to stdout port auto-detection) when:
 *  - the script already pins its own port (`devScriptDeclaresPort`), or
 *  - the script delegates to a task-runner wrapper (`devScriptUsesWrapper`), or
 *  - the type does not take a CLI port flag (cra reads PORT env; bun/unknown).
 *
 * Otherwise returns the framework-appropriate flag pair (`--port N` for
 * vite/remix/webpack, `-p N` for nextjs). These args are passed to
 * `appendScriptCliArgs`, which handles the npm `--` separator.
 */
export function portInjectionArgs(type: ProjectType, script: string, port: number): string[] {
  if (devScriptDeclaresPort(script) || devScriptUsesWrapper(script)) {
    return [];
  }
  if (type === 'vite' || type === 'remix' || type === 'webpack') {
    return ['--port', String(port)];
  }
  if (type === 'nextjs') {
    return ['-p', String(port)];
  }
  // cra reads PORT env var; bun/unknown have no standard CLI port flag.
  return [];
}

/** The final dev-server spawn decision: what to run, and from where. */
export interface SpawnCommand {
  cmd: string;
  args: string[];
  cwd: string;
  /**
   * Which resolution branch produced this command (PR #692 review):
   * 'wrapper-script' — the wrapper script text executed directly with cwd at
   * the workspace root; 'pm-run' — `<pm> run <script>` with cwd at the package
   * dir. Persisted in the spawn plan; a persisted cwd is reused only when the
   * live resolution lands on the SAME branch (an edited script that flips
   * shell-safety must not inherit the other branch's cwd).
   */
  branch: 'wrapper-script' | 'pm-run';
}

/**
 * One stage of the HYP-1169 toolchain pipeline (globals → deps → verify).
 * `run` receives the shared progress sink (already prefixed with "Step i/N")
 * and the outer notification's cancellation token.
 */
interface ToolchainPhase {
  title: string;
  run: (progress: ToolchainProgress, token: { isCancellationRequested: boolean }) => Promise<void>;
}

/** The `<pm> run <script>` invocation for a package manager (npm/pnpm/bun run, yarn bare). */
function pmRunCommand(packageManager: PackageManager, script: string): { cmd: string; args: string[] } {
  if (packageManager === 'yarn') return { cmd: 'yarn', args: [script] };
  return { cmd: packageManager, args: ['run', script] };
}

/**
 * Resolve the dev-server spawn command for a dev script (HYP-1160).
 *
 * Plain scripts (`vite dev`, `next dev`) keep the historical shape: `<pm> run
 * <script>` with cwd = the project dir.
 *
 * Task-runner wrapper scripts (`nx run conloca-app:dev …`, `turbo run dev`) must
 * execute from the WORKSPACE ROOT, not the subpackage dir — the Nx project
 * graph fails to resolve when `nx run …` runs with cwd inside a subpackage
 * (confirmed on conloca: same command works from the repo root, breaks from
 * targets/conloca-app). We therefore execute the script TEXT directly (the
 * same command `npm run` would run) with cwd = the workspace root, which also
 * preserves the exact target the user picked via the HYP-1104 monorepo
 * auto-target — running `<pm> run <script>` at the root would instead boot
 * whatever app the ROOT package.json's script of the same name points at.
 *
 * Script text is only executed directly when every token passes
 * {@link SHELL_SAFE_TOKEN} (the spawn folds tokens into a `shell: true`
 * string); otherwise we fall back to `<pm> run <script>` with cwd = the
 * SELECTED package dir (projectPath), NOT the workspace root (P1, PR #692):
 * running `<pm> run <script>` at the root would resolve the ROOT package's
 * same-named script — booting the wrong app, or failing when the root lacks
 * the script. Running from the package dir preserves the HYP-1104 auto-target
 * (the package the user actually picked) while the package manager still
 * resolves wrapper binaries the usual way (every ancestor `node_modules/.bin`
 * up to the workspace root lands on the script's PATH). The fallback remains
 * degraded for the Nx-graph edge (the script text still executes with cwd
 * inside the subpackage) — degraded, but never the wrong package's script.
 */
export async function resolveSpawnCommand(
  projectPath: string,
  packageManager: PackageManager,
  script: string,
  scriptText: string,
): Promise<SpawnCommand> {
  if (devScriptUsesWrapper(scriptText)) {
    const cwd = await findWorkspaceRoot(projectPath);
    const tokens = scriptText.trim().split(/\s+/);
    if (tokens.every((token) => SHELL_SAFE_TOKEN.test(token))) {
      const [cmd, ...args] = tokens;
      return { cmd, args, cwd, branch: 'wrapper-script' };
    }
    return { ...pmRunCommand(packageManager, script), cwd: projectPath, branch: 'pm-run' };
  }
  return { ...pmRunCommand(packageManager, script), cwd: projectPath, branch: 'pm-run' };
}

/** Tokens that resolve globally (package managers / runtimes), never from node_modules/.bin. */
const PACKAGE_MANAGER_TOKENS: Record<string, true> = {
  npm: true,
  pnpm: true,
  yarn: true,
  bun: true,
  node: true,
  corepack: true,
};

/** Runner tokens whose NEXT non-flag token is the binary actually executed (`bunx nx …`, `npx vite …`). */
const RUNNER_TOKENS: Record<string, true> = { npx: true, bunx: true, dlx: true, pnpx: true };

/**
 * The local binaries a resolved spawn command needs from `<plan.cwd>/node_modules/.bin`
 * (HYP-1169 round 2). Mirrors what will actually be executed:
 *  - 'wrapper-script' branch: the script TEXT runs directly at the workspace
 *    root, so its first executable token (e.g. bare `nx` after the HYP-1160
 *    wrapper normalization) must exist in .bin — a missing one dies with
 *    "'nx' is not recognized" (Alex's Windows run). Behind a runner token
 *    (`bunx nx …`) the runner's TARGET is the local binary, not the runner.
 *  - 'pm-run' branch: `<pm> run <script>` — the package manager itself
 *    prepends every ancestor node_modules/.bin when running the script, so
 *    there is nothing to verify from the spawn command.
 */
export function requiredLocalBinaries(
  cmd: string,
  args: readonly string[],
  branch: 'wrapper-script' | 'pm-run',
): string[] {
  if (branch !== 'wrapper-script') return [];
  if (RUNNER_TOKENS[cmd]) {
    const target = args.find((token) => !token.startsWith('-'));
    return target && !PACKAGE_MANAGER_TOKENS[target] ? [target] : [];
  }
  return PACKAGE_MANAGER_TOKENS[cmd] ? [] : [cmd];
}

/**
 * One-line PATH rendering for the output channel (HYP-1169 round 2): a full
 * Windows PATH is thousands of chars; log the first entries (the ones that
 * decide resolution) plus a summary of the rest so a "binary not on PATH" bug
 * is a one-glance diagnosis.
 */
export function truncatePathForLog(path: string, maxEntries = 6): string {
  const separator = path.includes(';') ? ';' : ':';
  const entries = path.split(separator).filter(Boolean);
  if (entries.length <= maxEntries) return path;
  return `${entries.slice(0, maxEntries).join(separator)}${separator}… (+${entries.length - maxEntries} more entries, ${path.length} chars total)`;
}

export function shouldRepairDependencies(errorMessage: string, logs: LogEntry[]): boolean {
  const text = `${errorMessage}\n${logs.map((entry) => entry.line).join('\n')}`.toLowerCase();
  return (
    text.includes('cannot find native binding') ||
    text.includes('optional dependencies') ||
    text.includes('@rolldown/binding') ||
    text.includes('@rollup/rollup-') ||
    (text.includes('node_modules') && text.includes('module_not_found') && text.includes('binding'))
  );
}

export function buildInstallCommand(packageManager: PackageManager): { cmd: string; args: string[] } {
  switch (packageManager) {
    case 'bun':
      return { cmd: 'bun', args: ['install'] };
    case 'pnpm':
      return { cmd: 'pnpm', args: ['install', '--force'] };
    case 'yarn':
      return { cmd: 'yarn', args: ['install'] };
    default:
      return { cmd: 'npm', args: ['install'] };
  }
}

/**
 * The PATH for the dev-server child (HYP-1169): the spawn cwd's
 * node_modules/.bin first (wrapper-script binaries resolve the way `npm run`
 * would resolve them), then the TOOLCHAIN-REFRESHED PATH — not raw
 * `process.env.PATH`, which the extension host snapshotted at VS Code launch
 * and which therefore cannot see a package manager _prepareToolchain just
 * installed mid-session.
 */
export function buildDevServerChildPath(cwd: string, refreshedPath: string): string {
  return `${join(cwd, 'node_modules', '.bin')}${delimiter}${refreshedPath}`;
}

/**
 * Characters allowed in a command token that is concatenated into a shell
 * string. Deliberately restrictive: letters, digits, and the punctuation that
 * appears in package-manager invocations (`run`, `--force`, `--port`, `5173`,
 * `dev:web`, `@scope/pkg`, `./bin`, `--`). Everything else — whitespace and
 * every shell metacharacter — is rejected.
 */
const SHELL_SAFE_TOKEN = /^[A-Za-z0-9_@:./=-]+$/;

/**
 * Fold a `{ cmd, args }` command into a single shell string.
 *
 * We spawn dev-server / package-manager commands with `shell: true` (needed so
 * PATH shims, corepack, and npm/pnpm/yarn `.cmd` wrappers resolve). Node 20+
 * deprecates passing a non-empty `args` array together with `shell: true`
 * (DEP0190) because the shell re-parses the args. Passing the whole command as
 * one string with no `args` array quiets the warning and is the shape Node
 * documents for the shell case.
 *
 * Because the string is re-parsed by the shell, we do NOT attempt to quote
 * arbitrary input (double-quoting is a false safety contract — a POSIX shell
 * still expands `$(...)`, `$VAR`, and backticks inside double quotes). Instead
 * every token must match {@link SHELL_SAFE_TOKEN}; an unsafe token throws. All
 * real callers pass controlled tokens (package-manager name, `run`/`install`,
 * the dev-script key, `--`, numeric `--port`/`--host`), so this never fires in
 * practice but turns any future injection vector into a loud, early error
 * instead of a silently-built injectable command line.
 */
export function toShellCommandString(cmd: string, args: string[]): string {
  const tokens = [cmd, ...args];
  for (const token of tokens) {
    if (!SHELL_SAFE_TOKEN.test(token)) {
      throw new Error(`Refusing to build shell command: unsafe token ${JSON.stringify(token)}`);
    }
  }
  return tokens.join(' ');
}

/**
 * REMOVED (HYP-1140 follow-up): this file used to prefix the spawned command with
 * `chcp 65001>nul&` on win32, hoping to force cmd.exe's OWN text (e.g. `'npm' is not
 * recognized...`) into UTF-8. A real Windows repro proved this ineffective AND
 * regressive, for two independent reasons:
 *
 * 1. Encoding: `chcp` reprograms the ACTIVE CONSOLE code page. This process spawns
 *    with `stdio: ['pipe','pipe','pipe']` — there is no attached console, so `chcp`
 *    has nothing to reprogram; cmd.exe's own built-in message text is still emitted in
 *    the OS's OEM code page regardless. The mojibake was never actually fixed by this
 *    prefix — decoding now happens via {@link StreamOutputDecoder}
 *    (`./windowsOutputDecoding`), which detects the real OEM code page and decodes
 *    with iconv-lite only when the bytes are not valid UTF-8.
 * 2. Exit code: `spawn('npm run dev', {shell:true})` on Windows compiles to a SINGLE
 *    command (`cmd /c "npm run dev"`); when cmd.exe cannot resolve `npm` it fails to
 *    launch the target and the whole process exits with the documented "command not
 *    found via cmd /c" code, 9009. Prefixing `chcp 65001>nul&` turned this into a
 *    COMPOUND command (`cmd /c "chcp 65001>nul&npm run dev"`): cmd.exe runs each
 *    sub-command as if typed at a prompt, so the unresolved second command just prints
 *    its "not recognized" text and sets the ordinary errorlevel 1 — which, being last
 *    in the chain, becomes the overall exit code instead of 9009. That silently broke
 *    {@link buildMissingCommandHint}'s exit-code-based detection for the exact case the
 *    prefix was meant to help with.
 *
 * Do not re-add a codepage prefix to the spawned shell command for this reason.
 * Every spawn() callsite in this file now calls {@link toShellCommandString} directly.
 */

/**
 * Windows cmd.exe's own (English) message when it can't resolve a command on PATH.
 * Best-effort only: names the missing binary when the shell happens to run in an
 * English locale. `chcp 65001` (above) fixes the BYTE ENCODING of cmd.exe's text, not
 * its LANGUAGE — a Russian-locale box (the actual HYP-1140 report) emits
 * `"npm" не является внутренней или внешней командой...`, which this pattern will never
 * match. The locale-independent signal is cmd.exe's exit code (see
 * WIN_COMMAND_NOT_FOUND_EXIT_CODE below), which `buildMissingCommandHint` gates on
 * independently of whether a binary name could be parsed out of the text.
 */
// All four patterns below carry the `g` flag — NOT for a single lookup, but so
// extractMissingCommandName can walk EVERY match within a category via matchAll and
// skip past a "chcp" capture to find a REAL match later in the same buffer (review
// finding: a plain first-match .match() would stop at line 1's "chcp" and never see
// line 2's "npm" — see extractMissingCommandName's doc comment for the full scenario).
const WIN_COMMAND_NOT_FOUND_PATTERN = /'([^']+)' is not recognized as an internal or external command/gi;
/**
 * POSIX zsh: `command not found: <cmd>` (name comes AFTER the phrase, unlike sh/bash).
 * Checked BEFORE the sh/bash pattern below: zsh's own line is `zsh: command not found:
 * bun`, which the sh/bash pattern ALSO matches (as a substring, capturing "zsh" — the
 * shell name, not the missing binary). Trying this pattern first ensures zsh output
 * resolves to the real missing command.
 */
const POSIX_COMMAND_NOT_FOUND_ZSH_PATTERN = /command not found: (\S+)/gim;
/** POSIX sh/bash: `<cmd>: command not found`. */
const POSIX_COMMAND_NOT_FOUND_PATTERN = /(?:^|\s)(\S+): command not found/gim;
/**
 * Node's own spawn error when the shell/binary itself could not be found. With
 * `shell: true` (every spawn in this file), a bare ENOENT names the SHELL binary
 * (`/bin/sh`, `cmd.exe`), not the user's package manager — an edge case rare enough
 * (the whole OS shell is missing) that surfacing it as-is is still more useful than
 * silence, even though the wording ends up naming the shell rather than e.g. `npm`.
 */
const NODE_SPAWN_ENOENT_PATTERN = /spawn (\S+) ENOENT/gi;

/** cmd.exe's own exit code when it cannot resolve a command on PATH — locale-independent. */
const WIN_COMMAND_NOT_FOUND_EXIT_CODE = 9009;
/** POSIX shells' conventional exit code for "command not found" — locale-independent. */
const POSIX_COMMAND_NOT_FOUND_EXIT_CODE = 127;

/** First capture-group match in `text` for `pattern` whose value isn't "chcp" (case-insensitive), or undefined. */
function firstNonChcpMatch(text: string, pattern: RegExp): string | undefined {
  for (const match of text.matchAll(pattern)) {
    const name = match[1];
    if (name && name.toLowerCase() !== 'chcp') return name;
  }
  return undefined;
}

/**
 * Best-effort: pull a missing-binary name out of text via the known signatures.
 * Pattern-category priority order (Windows, zsh, sh/bash, Node ENOENT) — first
 * CATEGORY with any non-"chcp" match wins, not just the first match overall.
 *
 * Skips "chcp" specifically (case-insensitive): this predates removal of the
 * `chcp 65001>nul&` spawn prefix (see the removal note above `toShellCommandString`'s
 * callsites) — when that prefix was still chained into the dev-server command, a PATH
 * broken enough that even `System32\chcp.com` couldn't resolve made cmd.exe print its
 * OWN "not recognized" line for `chcp` BEFORE the real command's line, and a naive
 * first-match lookup would lock onto that line and never see the real binary's line
 * right after it. The chcp prefix is gone now, so this line can no longer appear from
 * OUR injection — kept as cheap, still-correct defense in case a user's own dev script
 * happens to invoke `chcp` itself. Naming "chcp" in that case would be a confusing
 * hint; falling through to the generic "the required command" wording is more honest.
 */
function extractMissingCommandName(text: string): string | undefined {
  return (
    firstNonChcpMatch(text, WIN_COMMAND_NOT_FOUND_PATTERN) ??
    firstNonChcpMatch(text, POSIX_COMMAND_NOT_FOUND_ZSH_PATTERN) ??
    firstNonChcpMatch(text, POSIX_COMMAND_NOT_FOUND_PATTERN) ??
    firstNonChcpMatch(text, NODE_SPAWN_ENOENT_PATTERN)
  );
}

/**
 * Turn a raw "command not found" shell failure into an actionable diagnostic instead of
 * just the opaque "Server failed to start" the catch block would otherwise surface
 * (HYP-1140). Two DIFFERENT trust levels, deliberately not conflated:
 *  - `errorMessage` is a CONTROLLED string — either Node's own `spawn X ENOENT` (the
 *    child 'error' handler, no arbitrary program output involved) or something this file
 *    built itself — so matching it directly is always trustworthy on its own, no
 *    corroboration needed.
 *  - `logs` is ARBITRARY dev-server program output. A benign, non-fatal line that happens
 *    to contain one of these phrases (e.g. a healthy script probing
 *    `which foo || echo "not found"`) must never attach a misleading PATH hint to some
 *    later, unrelated failure — so log TEXT is used ONLY to best-effort name the binary,
 *    and ONLY once `exitCode` (9009 Windows / 127 POSIX, locale-independent — works even
 *    when the shell's own text is in a language the patterns above can't parse) has
 *    ALREADY confirmed this really was a command-not-found failure. Log text alone,
 *    without a corroborating exit code, is never sufficient to trigger a hint.
 * Returns `null` when neither signal fires, so ordinary errors (syntax errors, port
 * conflicts, startup timeouts) never get a misleading PATH hint.
 */
export function buildMissingCommandHint(
  errorMessage: string,
  logs: readonly LogEntry[],
  exitCode: number | null = null,
): string | null {
  const exitCodeSignalsMissingCommand =
    exitCode === WIN_COMMAND_NOT_FOUND_EXIT_CODE || exitCode === POSIX_COMMAND_NOT_FOUND_EXIT_CODE;
  const missingFromMessage = extractMissingCommandName(errorMessage);
  if (!missingFromMessage && !exitCodeSignalsMissingCommand) return null;

  const missing =
    missingFromMessage ??
    (exitCodeSignalsMissingCommand ? extractMissingCommandName(logs.map((entry) => entry.line).join('\n')) : undefined);
  const target = missing ? `"${missing}"` : 'the required command';
  return `Could not find ${target} on your PATH. If you just installed it, fully restart VS Code (a reload is not enough) so it picks up the updated PATH.`;
}

export class DevServerManager {
  private _process: ChildProcess | null = null;
  private _port: number | null = null;
  private _status: DevServerStatus = 'stopped';
  private _error: string | undefined;
  private _projectPath: string;
  // True once setProjectPath has explicitly pinned the project path (e.g. to a monorepo
  // sub-project for a selected component, HYP-420). When set, start() must NOT reset the
  // path back to the VS Code workspace folder via _syncProjectPathWithWorkspace — the
  // repo root often has no dev/start script and would fail to launch.
  private _projectPathPinned = false;
  // Base dir for the persisted spawn plan (HYP-1160) — undefined means the
  // store's default (OS temp dir). Overridden by tests to isolate the store.
  private _spawnPlanBaseDir?: string;
  // Base dir for the owned-dev-server orphan registry — undefined means the
  // registry's default (OS temp dir). Overridden by tests to isolate it.
  private _orphanBaseDir?: string;
  // The registry record of the dev server we ATTACHED to (HYP-1160 attach-first),
  // or null when the running server is one we spawned this session (_process) or
  // none is running. Attach requires the identity-verified record — we only adopt
  // servers a previous session of this manager spawned — so stop() owns the
  // teardown: _runStop kills the adopted process group by the recorded pid and
  // clears the record, so a restart spawns a FRESH server instead of silently
  // re-attaching to the stale one, and a dead adopted server is reaped rather
  // than leaked (PR #692 review).
  private _adoptedRecord: OwnedDevServerRecord | null = null;
  private _outputChannel: vscode.OutputChannel;
  private _onStatusChangeListeners: Array<(state: DevServerState) => void> = [];

  // HYP-1169 toolchain seam (self-healing bring-up). Field-shaped so tests can
  // inject fakes via Object.assign (same convention as _spawnPlanBaseDir /
  // _orphanBaseDir) — production uses the real services.
  private _toolchain = {
    detectAvailableTools,
    ensureTool,
    ensureDependencies,
    shouldInstallDependencies,
    findMissingLocalBinaries,
    refreshPathForChild,
  };

  // Log buffer and error detection
  private _logs: LogEntry[] = [];
  private _hasErrors = false;
  private _onLogsUpdateListeners: Array<(logs: LogEntry[], hasErrors: boolean) => void> = [];
  private _onError: ((errorLines: string) => void) | null = null;

  // Preview proxy and runtime errors
  private _previewProxy: PreviewProxy | null = null;
  private _pendingIsolatedMode = false; // setIsolatedMode() may arrive before proxy exists
  private _runtimeError: RuntimeError | null = null;
  private _onRuntimeErrorChangeListeners: Array<(error: RuntimeError | null) => void> = [];

  // Port auto-detection — set once per start() when dev server stdout reveals
  // the actual bound port (e.g. "http://localhost:3000"). Resets on each start().
  private _portDetected = false;

  // Last exit code of the dev-server child, captured in child.on('exit'). Read by
  // buildMissingCommandHint (HYP-1140) as a locale-independent "command not found"
  // signal (9009 on Windows, 127 on POSIX) — the shell's own error TEXT may be in a
  // language none of the English patterns can parse, but the exit code is not. Reset
  // on each start() alongside the log buffer.
  private _lastExitCode: number | null = null;

  // HMR-staleness auto-restart state (HYP-758 / task #38).
  // Counts how many times we have restarted for the current staleness episode.
  //
  // Give-up is sticky: once the cap is reached the flag stays set until the
  // server successfully transitions to `running` (meaning the restart actually
  // helped — the staleness was transient).  A purely time-based reset would
  // resume restarts every ~60 s for a persistent structural staleness, causing
  // an infinite restart loop even after the "reload manually" log message.
  // Cleared in transition() when status reaches `running`.
  //
  // The episode window (HMR_STALENESS_EPISODE_WINDOW_MS) still gates the
  // counter for truly independent staleness events: if the server was `running`
  // for a long time and a NEW unrelated staleness occurs well after the last
  // restart, the window resets the counter so the new event gets its own budget.
  // This is only reachable when _hmrStalenessGaveUp === false (cap not hit).
  private _hmsRestartsThisEpisode = 0;
  private _hmrLastRestartAt = 0;
  // True once the per-episode cap is exhausted; cleared on a successful `running`
  // transition so a recovery restart re-arms auto-restart for future staleness.
  private _hmrStalenessGaveUp = false;

  // Recompile gate — webpack-only. Armed by PreviewModeManager BEFORE it AST-rewrites
  // the entry file. Forces _waitForReady() / consumers to wait for a FRESH
  // "compiled successfully" message that arrives AFTER the patch was written, instead
  // of accepting the stale pre-patch one. Without this gate, the iframe can request
  // /test-preview during webpack's second compile (20–40s) and time out at 30s.
  private _recompileGate: {
    promise: Promise<void>;
    resolve: () => void;
    armedAt: number;
  } | null = null;

  // Lifecycle serialization (HYP-52). start()/stop()/restart() must not interleave:
  // a concurrent start()+stop() lets stop() capture a still-null _process (start has
  // not spawned yet), skip its kill block, and return — then start() spawns a child
  // that nobody tracks (orphan) while _waitForReady loops the full 90s. We chain every
  // lifecycle op onto _lifecycleOp so each runs only after the previous one SETTLES.
  private _lifecycleOp: Promise<unknown> = Promise.resolve();
  // Belt-and-suspenders epoch token: bumped at the top of every _runStart and _runStop.
  // An in-flight _runStart compares its captured gen against this after each await (and
  // inside _waitForReady's poll); if a newer op bumped it, the start is superseded and
  // bails instead of spawning into / polling for a server a concurrent stop just tore
  // down. Closes the symmetric "stop kills, start keeps polling" hole even within a
  // single queued op's await points.
  private _generation = 0;

  constructor(projectPath: string) {
    this._projectPath = projectPath;
    this._outputChannel = vscode.window.createOutputChannel('HyperIDE Dev Server');
  }

  /**
   * Set callback for status changes
   */
  onStatusChange(callback: (state: DevServerState) => void): void {
    this._onStatusChangeListeners.push(callback);
  }

  /**
   * Add listener for log updates (real-time push to webview)
   */
  onLogsUpdate(callback: (logs: LogEntry[], hasErrors: boolean) => void): void {
    this._onLogsUpdateListeners.push(callback);
  }

  /**
   * Set callback for new errors detected
   */
  onError(callback: (errorLines: string) => void): void {
    this._onError = callback;
  }

  /**
   * Add listener for runtime error changes (from iframe error overlays)
   */
  onRuntimeErrorChange(callback: (error: RuntimeError | null) => void): void {
    this._onRuntimeErrorChangeListeners.push(callback);
  }

  /**
   * Set runtime error detected from iframe preview
   */
  setRuntimeError(error: RuntimeError | null): void {
    this._runtimeError = error;
    for (const cb of this._onRuntimeErrorChangeListeners) cb(error);
  }

  /**
   * Get current runtime error
   */
  get runtimeError(): RuntimeError | null {
    return this._runtimeError;
  }

  /**
   * Get current log buffer
   */
  getLogs(): LogEntry[] {
    return this._logs;
  }

  /**
   * Whether log buffer contains errors
   */
  get hasErrors(): boolean {
    return this._hasErrors;
  }

  /**
   * Clear log buffer
   */
  clearLogs(): void {
    this._logs = [];
    this._hasErrors = false;
    for (const cb of this._onLogsUpdateListeners) cb(this._logs, this._hasErrors);
  }

  /**
   * Get current status
   */
  getState(): DevServerState {
    return this._buildState();
  }

  /**
   * True while a recompile gate is armed (post-patch, pre fresh "compiled
   * successfully") AND the server is still serving. Guarded by `running` so a gate
   * that outlives a stop/crash (the gate is only cleared on success or re-arm, not
   * on exit) never reports an incoherent `{ status: 'stopped', recompiling: true }`.
   * "Mid-recompile" only means anything while running.
   */
  private get _recompiling(): boolean {
    return this._recompileGate !== null && this._status === 'running';
  }

  /** Single source of truth for the published DevServerState shape. */
  private _buildState(): DevServerState {
    // Return proxy URL if available (for script injection), otherwise direct URL
    const proxyUrl = this._previewProxy?.url;
    return {
      status: this._status,
      port: this._port ?? undefined,
      url: proxyUrl ?? (this._port ? `http://localhost:${this._port}` : undefined),
      error: this._error,
      recompiling: this._recompiling,
    };
  }

  /** Build the current state and push it to every onStatusChange listener. */
  private _publishState(): void {
    const state = this._buildState();
    for (const cb of this._onStatusChangeListeners) cb(state);
  }

  /**
   * Best-effort: if this is a Remix project, patch its vite.config to pin a single React
   * identity (resolve.dedupe + optimizeDeps.include) so the dev server reads dedupe at cold
   * boot. Must run BEFORE spawn (see callsite in start()). Never throws — a framework-detect,
   * IO-construct, or patch failure must not block dev-server start; we log and move on.
   *
   * Scope: detects + patches at `_projectPath` (the dev-server target). For a monorepo where
   * the root `dev` script boots a Remix app in a subpackage (e.g. `apps/web`), the root won't
   * classify as Remix and this no-ops — the cold-start dual-React fix is missed for that layout.
   * The original ensurePreviewFiles() patch has the same single-root scope; making the patch
   * monorepo-aware (resolving the concrete sub-app the dev command runs) is a separate follow-up.
   *
   * Dirty-buffer guard: this patches an UNMANAGED user file as an automatic side effect of preview
   * start. VSCodeFileIO reads the open editor buffer for a dirty document and force-syncs it on
   * write, so patching while the user has UNSAVED edits in vite.config would silently persist those
   * edits to disk (and could clobber/race a mid-edit). We skip the best-effort patch in that case
   * rather than touch the unsaved buffer — the dev server still boots; the dedupe is re-applied on a
   * later start once the user has saved. See P2 on PR #504 / VSCodeFileIO read/write semantics.
   */
  private async _patchViteConfigIfRemix(): Promise<void> {
    try {
      const io = new VSCodeFileIO();
      const { framework } = await detectFramework(this._projectPath, io);
      if (framework !== 'remix') return;
      if (this._hasDirtyViteConfig()) {
        this._outputChannel.appendLine(
          '[DevServer] vite.config dedupe patch skipped: config has unsaved edits (will retry on next start)',
        );
        return;
      }
      const patched = await patchViteConfigForReactDedupe(io, this._projectPath);
      if (patched) {
        this._outputChannel.appendLine('[DevServer] Patched vite.config for React dedupe (Remix dual-React fix)');
      }
    } catch (err) {
      this._outputChannel.appendLine(`[DevServer] vite.config dedupe patch skipped: ${String(err)}`);
    }
  }

  /**
   * Is any of the project's vite.config candidates open with UNSAVED edits? Guards the best-effort
   * dedupe patch from persisting a user's dirty editor buffer to disk (VSCodeFileIO reads/writes the
   * dirty buffer). Delegates the path matching to {@link anyDirtyDocIsViteConfig} (unit-tested).
   */
  private _hasDirtyViteConfig(): boolean {
    const dirtyDocPaths = vscode.workspace.textDocuments.filter((d) => d.isDirty).map((d) => d.uri.fsPath);
    return anyDirtyDocIsViteConfig(this._projectPath, dirtyDocPaths);
  }

  /**
   * Start the preview proxy for script injection (error detection) against the
   * currently selected `_port`. Shared by the spawn path and the HYP-1160
   * attach-first path (adopting an already-listening server still needs the
   * proxy so runtime-error capture and preview wiring work).
   */
  private async _startPreviewProxy(): Promise<void> {
    const port = this._port;
    if (port === null) throw new Error('Cannot start preview proxy before a port is selected');
    const proxy = new PreviewProxy(port, this._projectPath);
    // Single source of truth for "are we serving" (HYP-370 Phase 4): the proxy
    // serves only while this manager still owns it. _stopProxy() nulls
    // _previewProxy at the exact instant the old proxy._isStopping used to flip,
    // so behavior is preserved (stop()/exit short-circuits; the process-error
    // path, which does not call _stopProxy, keeps serving as before).
    proxy.setIsServing(() => this._previewProxy === proxy);
    this._previewProxy = proxy;
    // Apply isolated mode that may have been set before proxy was created
    // (PreviewModeManager.startWatching() fires before dev server starts)
    if (this._pendingIsolatedMode) {
      proxy.setIsolatedMode(true);
    }
    await proxy.start();
    this._outputChannel.appendLine(`[DevServer] PreviewProxy started on port ${this._previewProxy.port}`);
  }

  /**
   * Resolve the spawn plan for `devScript` (HYP-1160): the package manager
   * (lockfile walk-up via detectPackageManager), the spawn cwd (workspace root
   * for task-runner wrapper scripts), and the command tokens.
   *
   * The FIRST resolution is persisted (devServerSpawnPlan); later starts —
   * including the respawn after a VS Code window reload, whose re-detection
   * was observed flipping bun → npm on a bun+Nx monorepo (conloca) — reuse the
   * persisted plan instead of re-detecting, so the respawn spawns the SAME pm
   * + cwd the previous window resolved. A persisted plan is reused only while
   * its script key still exists in package.json with the same wrapper-ness
   * (devScriptUsesWrapper) AND the live resolution lands on the same branch
   * (wrapper-script-at-root vs pm-run-at-package-dir); an edited dev script
   * re-resolves and overwrites.
   */
  private async _resolveSpawnPlan(
    devScript: string,
    scripts: Record<string, string>,
  ): Promise<SpawnCommand & { packageManager: PackageManager }> {
    const scriptText = scripts[devScript] ?? '';
    const wrapper = devScriptUsesWrapper(scriptText);
    const persisted = readSpawnPlan(this._projectPath, this._spawnPlanBaseDir);
    // A persisted plan survives ABSENT evidence (the transient reload-time
    // detection flip it exists for) but not CONFIDENTLY contradicting
    // evidence: a lock file naming a different package manager means a
    // pm migration, and the plan must re-resolve (PR #692 review).
    const evidence = persisted ? await detectPackageManagerLockfile(this._projectPath) : null;
    const evidenceContradicts = evidence !== null && evidence.manager !== persisted?.packageManager;
    if (
      persisted &&
      !evidenceContradicts &&
      persisted.script === devScript &&
      scripts[devScript] &&
      persisted.wrapper === wrapper
    ) {
      // Rebuild the command tokens from the LIVE script text (deterministic),
      // but keep the persisted pm + cwd — those are the fields whose
      // re-detection proved unstable across a window reload.
      const command = await resolveSpawnCommand(this._projectPath, persisted.packageManager, devScript, scriptText);
      // Reuse the persisted cwd ONLY when the live resolution lands on the same
      // branch (PR #692 review): an edited script that flips shell-safety
      // (`nx run app:dev` → `nx run app:dev && …`) keeps wrapper-ness but moves
      // the correct cwd from the workspace root back to the package dir —
      // inheriting the persisted root cwd would run `<pm> run <script>` at the
      // ROOT and boot the root package's same-named script (wrong app).
      if (command.branch === persisted.branch) {
        return { ...command, cwd: persisted.cwd, packageManager: persisted.packageManager };
      }
    }
    const packageManager = await detectPackageManager(this._projectPath);
    const command = await resolveSpawnCommand(this._projectPath, packageManager, devScript, scriptText);
    writeSpawnPlan(
      {
        version: 2,
        projectPath: this._projectPath,
        script: devScript,
        packageManager,
        cwd: command.cwd,
        wrapper,
        branch: command.branch,
        createdAt: Date.now(),
      },
      this._spawnPlanBaseDir,
    );
    return { ...command, packageManager };
  }

  /**
   * Start the dev server. PUBLIC entry — serializes onto the lifecycle queue so a
   * concurrent stop()/restart() can never interleave with the spawn (HYP-52). The
   * actual work lives in _runStart; internal callers (dependency-repair retry) must
   * call _runStart directly to avoid deadlocking on the chain they are already part of.
   */
  async start(dependencyRepairAttempted = false): Promise<DevServerState> {
    const run = this._lifecycleOp.then(
      () => this._runStart(dependencyRepairAttempted),
      () => this._runStart(dependencyRepairAttempted),
    );
    // Keep the chain alive but swallow rejection so one op's failure does not poison
    // the next op. The public method returns the un-swallowed promise so the caller
    // still sees the real error.
    this._lifecycleOp = run.catch(() => {});
    return run;
  }

  private async _runStart(dependencyRepairAttempted = false): Promise<DevServerState> {
    // Sync the project path FIRST. When the path differs from the workspace folder (an
    // unpinned monorepo/subproject reroot), this runs _applyProjectPath -> _runStop,
    // which bumps _generation. That bump is an INTRA-OP side effect of our own start, not
    // a concurrent stop — so it must NOT count against the supersede epoch (HYP-52
    // regression: capturing gen BEFORE this await made every such start self-supersede at
    // the pre-spawn check and never spawn -> "Server failed to start").
    await this._syncProjectPathWithWorkspace();

    // Layer 2 epoch (defense-in-depth — see the _generation field doc): snapshot AFTER the
    // sync's own bump. Layer 1 (_lifecycleOp) already serializes public start/stop/restart,
    // so the realistic bumper during an await below is an INTRA-OP _runStop (the
    // dependency-repair retry at the bottom of this method). If anything bumps _generation
    // past this snapshot, each await below detects it and bails before spawning/polling.
    const gen = ++this._generation;

    if (this._status === 'running') {
      return this.getState();
    }

    if (this._status === 'starting') {
      return this.getState();
    }

    this.transition('starting');

    // Reset logs and port detection on new start
    this._logs = [];
    this._hasErrors = false;
    this._portDetected = false;
    this._lastExitCode = null;

    // Kick off the (cached, win32-only) OEM code page probe now. Deliberately NOT
    // awaited before spawn (HYP-1140 follow-up, review finding): on a box where `chcp`
    // genuinely hangs, blocking spawn on this would add several seconds to EVERY
    // dev-server start. Instead the stdout/stderr decoders read this box through a
    // LIVE accessor (see their construction below) — chunks that arrive before the
    // probe resolves decode as plain UTF-8 (same as "code page unknown"); chunks after
    // it resolves get the real OEM-aware treatment. Resolves in well under a second in
    // the overwhelmingly common case, so this is rarely even observable.
    const oemCodePageBox: { value: number | null } = { value: null };
    detectWindowsOemCodePage().then((codePage) => {
      oemCodePageBox.value = codePage;
    });
    try {
      // Get project info
      const projectInfo = await getProjectInfo(this._projectPath);
      const scripts = await getPackageScripts(this._projectPath);

      // Patch the user's vite.config (resolve.dedupe + optimizeDeps.include) BEFORE we spawn
      // their dev server. Remix (Vite 6, SSR) previews flakily crash on COLD start with a
      // dual-React hydration error; the fix is to pin a single React identity in vite.config
      // ON DISK. Vite reads resolve.dedupe only at cold boot and never re-reads it without a
      // restart — so PreviewFileManager.ensurePreviewFiles()'s patch (which runs on
      // component-select, AFTER this spawn) lands too late for the first cold start. Patching
      // here, before spawn, is the only place it takes effect on the very first boot.
      //
      // Gated to Remix via the shared detectFramework() (same gate ensurePreviewFiles uses) —
      // no churn of non-Remix users' configs at dev-server start. The patcher is idempotent
      // (writes nothing once the entries are present) and best-effort (never throws). NOTE: if
      // a dev server is ALREADY running we returned early above; re-patching a booted server
      // would not re-read it (a restart would be needed) — out of scope for the cold-start bug.
      await this._patchViteConfigIfRemix();

      // Determine dev command — truthiness check on scripts[devScript] is intentional:
      // getPackageScripts returns Record<string, string>, so truthy ≡ key exists with value
      let devScript = projectInfo.devCommand;
      if (!scripts[devScript]) {
        // Fallback to available scripts
        if (scripts.dev) devScript = 'dev';
        else if (scripts.start) devScript = 'start';
        else {
          throw new Error('No dev or start script found in package.json');
        }
      }

      // Find free port — prefer VS Code setting, fall back to project default
      const configuredPort = vscode.workspace.getConfiguration('hypercanvas.preview').get<number>('defaultPort');
      const startPort = configuredPort ?? projectInfo.defaultPort;

      // HYP-1160 attach-first: when a dev server ALREADY answers HTTP on the
      // expected port, adopt it instead of spawning a competitor that either
      // loses the port race or boots a second instance — but ONLY once its
      // identity is confirmed (P1, PR #692): bare HTTP reachability proves
      // nothing about WHO is listening, and attaching to a different project's
      // dev server (or an unrelated service) would display and edit against the
      // wrong app. The identity proof is the orphan registry: a record WE wrote
      // for THIS projectPath whose pid/process-group is still alive and whose
      // live command line does not positively mismatch the recorded command
      // (findLiveOwnedDevServer mirrors the reaper's ladder). A random service
      // cannot spoof that — only our own spawn writes a record. A content probe
      // (title/HTML markers) was rejected as the signal: any static server can
      // serve a matching page, and framework-specific markers are not universal.
      // When identity can't be confirmed (a stranger's server, or one the user
      // started outside this manager), we fall through to the spawn path, which
      // picks a FREE port — the safe pre-attach-first behavior.
      if (await this._probeHttpServer(startPort)) {
        const owned = findLiveOwnedDevServer(this._projectPath, this._orphanBaseDir);
        if (owned) {
          // Same supersede discipline as the spawn path: a concurrent stop that
          // bumped the generation during the probe abandons this start.
          if (gen !== this._generation) {
            this.transition('stopped');
            return this.getState();
          }
          this._port = startPort;
          this._outputChannel.appendLine(
            `[DevServer] Attaching to dev server already listening on port ${startPort} ` +
              `(pid ${owned.pid}, spawned by a previous session for this project)`,
          );
          // We adopt the recorded orphan instead of reaping it — skip the reap
          // below. We record no NEW owned pid (we spawned nothing this session);
          // the EXISTING record doubles as the adopted server's teardown handle:
          // attach requires this identity proof (we only adopt servers a previous
          // session of this manager spawned), so stop() OWNS the teardown — it
          // kills the adopted process group by this record and clears it, so a
          // restart spawns a FRESH server instead of silently re-attaching to a
          // stale one (PR #692 review).
          await this._startPreviewProxy();
          // Post-proxy supersede check (HYP-52), mirroring the spawn path's
          // re-check: a stop()/reroot that bumped the generation while
          // proxy.start() awaited abandons this attach. Tear down the proxy that
          // was just started and never transition to running; 'stopped' is the
          // coherent resting state (legal edge from 'starting', and no exit
          // handler exists to reset a stranded 'starting'). The adopted server
          // itself is left running — we never took ownership of it here
          // (_adoptedRecord is set only below), and its registry record survives
          // for the next start to re-attach to or reap.
          if (gen !== this._generation) {
            this._stopProxy();
            this.transition('stopped');
            return this.getState();
          }
          this._adoptedRecord = owned;
          this.transition('running');
          return this.getState();
        }
        this._outputChannel.appendLine(
          `[DevServer] Port ${startPort} answers HTTP but is not a dev server we started for this project — spawning on a free port instead`,
        );
      }

      // Reap our own orphaned dev servers from previous sessions BEFORE picking
      // a port (skipped only by the verified-attach return above — reaping the
      // orphan we just adopted would kill the server we mean to use). On a VS
      // Code window reload, deactivate()'s fire-and-forget stop() does not
      // complete before the extension host is torn down, so detached children
      // can survive and keep their ports. A port-ignoring server (Bun hardcodes
      // :3000) then loses the next start to an orphan with EADDRINUSE and the
      // preview never appears. We attribute each kill ONLY via a pid WE recorded
      // for THIS project — never "whoever holds the port" (occupancy is not
      // ownership). See devServerOrphanRegistry (orphan-reap-on-reload).
      this._reapOrphanedDevServer();

      this._port = await this._findFreePort(startPort);

      // Pre-spawn supersede check (HYP-52): a stop()/restart() that bumped _generation
      // while we awaited the async setup means this start is stale. No process exists
      // yet, so just unwind (no proxy to stop) — never spawn a child a concurrent stop
      // has already decided to tear down. (With Layer 1 the stop is queued AFTER us, so
      // this rarely fires; kept as defense.)
      //
      // Transition to 'stopped' (a legal edge from 'starting') BEFORE returning: no
      // child was spawned, so the child.on('exit') handler that normally resets _status
      // never fires. Leaving _status in 'starting' would strand it there forever and the
      // next start() would permanently no-op on the 'starting' guard above. The superseder
      // is a stop/reroot, so 'stopped' is the correct coherent resting state.
      if (gen !== this._generation) {
        this.transition('stopped');
        return this.getState();
      }

      // Start preview proxy for script injection (error detection)
      await this._startPreviewProxy();

      // Pre-spawn supersede check (HYP-52): if a concurrent stop()/restart() bumped the
      // generation while proxy.start() awaited, abandon this start before spawning. A
      // proxy now exists, so tear it down (_stopProxy) first; still no child to orphan
      // because we have not reached spawn yet.
      //
      // Then transition to 'stopped' BEFORE returning (legal edge from 'starting'): with
      // no child spawned, the child.on('exit') handler never runs to reset _status, so a
      // bare return would strand it in 'starting' forever and wedge every later start()
      // on the 'starting' guard. 'stopped' is the coherent terminal state for a start a
      // concurrent stop/reroot superseded.
      if (gen !== this._generation) {
        this._stopProxy();
        this.transition('stopped');
        return this.getState();
      }

      // Decide --port injection. We skip it (relying on stdout port
      // auto-detection, _maybeUpdatePortFromOutput) when:
      //  - the script already pins its own port (`vite dev --port 3000`) — a
      //    second --port is a confusing phantom; or
      //  - the script delegates to a task-runner wrapper (`nx run x:dev`,
      //    `turbo run dev`, …) — our flag would land on `bun run dev`/nx, NOT the
      //    underlying vite/astro, and bind the wrong port (HYP-547).
      // The PORT/VITE_PORT env below stays set but is harmless (Vite ignores it,
      // and an inline PORT= in the script overrides ours).
      const scriptText = scripts[devScript] ?? '';
      const portArgs = portInjectionArgs(projectInfo.type, scriptText, this._port);
      if (portArgs.length > 0) {
        this._outputChannel.appendLine(`[DevServer] Port: ${this._port}`);
      } else if (devScriptUsesWrapper(scriptText)) {
        this._outputChannel.appendLine('[DevServer] Port: wrapper command — auto-detecting from output');
      } else {
        this._outputChannel.appendLine('[DevServer] Port: declared by dev script (auto-detected from output)');
      }

      // Resolve the spawn plan (pm + cwd + command), reusing the persisted plan
      // on respawn (HYP-1160) instead of re-detecting.
      const plan = await this._resolveSpawnPlan(devScript, scripts);

      // HYP-1169 self-healing toolchain, BEFORE the spawn: make sure the plan's
      // package manager actually exists on this machine (auto-installing it with
      // progress when missing), proactively install project dependencies, and
      // rebuild the child PATH from fresh sources so a just-installed tool is
      // visible to the spawn. A fresh machine must get a running preview, not
      // "'bun' is not recognized". buildMissingCommandHint remains as the
      // last-resort explanation if all of this still fails.
      const childPath = await this._prepareToolchain(plan);

      // Post-toolchain supersede check (HYP-52 pattern): installs can take
      // minutes; a stop()/reroot that bumped the generation while
      // _prepareToolchain awaited abandons this start. A proxy exists, so tear
      // it down; no child was spawned, so transition to 'stopped' before
      // returning (the exit handler that normally resets _status never fires).
      if (gen !== this._generation) {
        this._stopProxy();
        this.transition('stopped');
        return this.getState();
      }
      // No copy of plan.args: the plan is a fresh local resolution (nothing
      // else holds the array), and appendScriptCliArgs below mutates it in place.
      const command = { cmd: plan.cmd, args: plan.args };

      this._outputChannel.appendLine(
        `[DevServer] Starting ${command.cmd} ${command.args.join(' ')} (port ${this._port}) in ${plan.cwd}`,
      );
      this._outputChannel.appendLine(`[DevServer] Project: ${this._projectPath}`);
      // HYP-1169 round 2: the exact PATH the child will resolve binaries
      // against — the next "'x' is not recognized" becomes a one-glance
      // diagnosis instead of a log archaeology session.
      this._outputChannel.appendLine(
        `[DevServer] Child PATH: ${truncatePathForLog(buildDevServerChildPath(plan.cwd, childPath))}`,
      );

      // Pass --port via CLI for frameworks that support it.
      // Env vars PORT/VITE_PORT alone are not reliable (Vite ignores them).
      if (portArgs.length > 0) {
        appendScriptCliArgs(command, plan.packageManager, portArgs);
      }

      // Spawn process. Fold args into the command string (no `args` array) so
      // `shell: true` does not trigger DEP0190 (deprecated: args + shell:true).
      const child = spawn(toShellCommandString(command.cmd, command.args), {
        cwd: plan.cwd,
        env: {
          ...process.env,
          // HYP-1169: refreshed toolchain PATH (registry user PATH on win32,
          // well-known per-user bin dirs on unix) instead of the launch-time
          // process.env.PATH snapshot, with the install root's
          // node_modules/.bin prepended so wrapper-script binaries (nx,
          // turbo, …) resolve the way `npm run` would resolve them. Harmless
          // for `<pm> run` commands, which do this themselves.
          PATH: buildDevServerChildPath(plan.cwd, childPath),
          PORT: String(this._port),
          // For Vite
          VITE_PORT: String(this._port),
        },
        detached: process.platform !== 'win32',
        shell: true, // nosemgrep: spawn-shell-true -- dev server requires shell for npm/pnpm/yarn scripts
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this._process = child;

      // Persist an "owned dev server" record so the NEXT start can reap this child
      // if it gets orphaned by a window-reload race (see _reapOrphanedDevServer).
      if (child.pid) {
        recordOwnedDevServer(
          {
            pid: child.pid,
            projectPath: this._projectPath,
            command: `${command.cmd} ${command.args.join(' ')}`.trim(),
            startedAt: Date.now(),
          },
          this._orphanBaseDir,
        );
      }

      const isCurrentProcess = () => this._process === child;

      // One StreamOutputDecoder per physical stream (HYP-1140 follow-up): a raw `data`
      // event is not guaranteed to end on a character boundary, so decoding each chunk
      // independently can misclassify or corrupt output. Each reads oemCodePageBox
      // LIVE (not a snapshot) so the still-pending probe above can resolve mid-stream —
      // see windowsOutputDecoding.ts.
      const stdoutDecoder = new StreamOutputDecoder(process.platform, () => oemCodePageBox.value);
      const stderrDecoder = new StreamOutputDecoder(process.platform, () => oemCodePageBox.value);

      // Handle stdout
      child.stdout?.on('data', (data: Buffer) => {
        if (!isCurrentProcess()) return;
        const text = stdoutDecoder.push(data);
        // Strip ANSI escape codes — Vite 8 (rolldown) wraps output in color
        // codes that pollute the VS Code output channel and split keywords.
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up

        this._maybeUpdatePortFromOutput(clean);

        // Detect when server is ready
        if (this._status === 'starting' && this._isServerReadyMessage(clean)) {
          console.log('[HyperIDE] DevServer ready detected via stdout');
          this.transition('running');
        }

        this._maybeResolveRecompileGate(clean);
        this._maybeRestartOnStaleness(clean);
      });

      // Handle stderr — many servers (Vite 8, Next.js) write to stderr
      child.stderr?.on('data', (data: Buffer) => {
        if (!isCurrentProcess()) return;
        const text = stderrDecoder.push(data);
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up

        this._maybeUpdatePortFromOutput(clean);

        if (this._status === 'starting' && this._isServerReadyMessage(clean)) {
          console.log('[HyperIDE] DevServer ready detected via stderr');
          this.transition('running');
        }

        this._maybeResolveRecompileGate(clean);
        this._maybeRestartOnStaleness(clean);
      });

      // Handle process exit. Deliberately 'exit', NOT 'close' — a prior version of this
      // fix used 'close' (Node guarantees full stdio drain only there) to make
      // buildMissingCommandHint's log-based binary-name extraction more reliable, but
      // review (two independent passes) flagged a worse regression: 'close' only fires
      // once ALL processes holding the stdio pipe FDs close them, so a dev tool whose
      // grandchild inherits stdout/stderr can delay 'close' indefinitely — stranding
      // this manager in 'starting'/'running' and blocking orphan cleanup for a process
      // that already exited. 'exit' firing slightly before full drain is the tracked,
      // accepted tradeoff (HYP-1141) — occasionally losing the binary NAME in the hint
      // is far better than occasionally never detecting the exit at all.
      child.on('exit', (code) => {
        if (!isCurrentProcess()) return;
        // Flush any bytes the stream decoders were still holding back (HYP-1140
        // follow-up): nothing more is coming now that the process exited, so a
        // sequence truncated at the very last `data` chunk is decoded best-effort
        // instead of silently dropped. Must run BEFORE _lastExitCode/buildMissingCommandHint
        // read this._logs below, so a flushed "not recognized" tail line (if any) is
        // already in the buffer.
        //
        // Known, assessed residual gap (review finding): if a DETACHED GRANDCHILD keeps
        // writing to the inherited stdio pipe AFTER this 'exit' fires, that later `data`
        // chunk is already dropped by the `isCurrentProcess()` guard at the top of the
        // stdout/stderr handlers (this._process is nulled a few lines below, in THIS
        // same handler) — a PRE-EXISTING gap, not introduced by the decoders. Flushing
        // here does not make that gap worse: at most it surfaces the same best-effort
        // U+FFFD-style placeholder plain `data.toString()` already produced for a
        // same-boundary split before StreamOutputDecoder existed. A structural fix would
        // flush on each stream's own `end`/`close` instead of the process `exit` — but
        // `end`/`close` on a pipe a grandchild still holds open can itself hang
        // indefinitely, which is exactly the hazard HYP-1141 already chose 'exit' over
        // 'close' to avoid. Not reintroducing that trade for a narrower, rarer edge case.
        this._flushStreamDecoder(stdoutDecoder);
        this._flushStreamDecoder(stderrDecoder);
        console.log(`[HyperIDE] DevServer process exited with code ${code}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        this._outputChannel.appendLine(`[DevServer] Process exited with code ${code}`);
        // Captured for buildMissingCommandHint (HYP-1140): _waitForReady only sees
        // `_status === 'stopped'` after this handler runs and throws a generic "Server
        // failed to start" — the exit code is the locale-independent signal that this
        // was actually a "command not found" (9009/127), so it must survive past this
        // handler into the _runStart catch block below.
        this._lastExitCode = code;
        // The child is gone — drop its orphan record so the next start does not try
        // to reap an already-dead pid (or, worse, a recycled one).
        if (child.pid) {
          clearOwnedDevServer(this._projectPath, child.pid, this._orphanBaseDir);
        }
        this._process = null;
        this._port = null;
        this._stopProxy();
        this._transitionToStoppedUnlessErrorAlready();
      });

      // Handle process error
      child.on('error', (error) => {
        if (!isCurrentProcess()) return;
        console.error('[HyperIDE] DevServer process error:', error.message);
        this._outputChannel.appendLine(`[DevServer] Process error: ${error.message}`);
        this.transition('error', this._describeStartFailure(error.message));
      });

      // Wait for server to be ready (with timeout).
      // 90s: Remix/Next.js cold compile on a loaded Docker shard can take 60s+
      // before the port becomes accessible. 30s was too tight and caused
      // spurious "Server startup timeout" failures in CI.
      // Pass `gen` so the poll bails immediately if a concurrent stop supersedes us —
      // closes the "stop kills the child, start keeps polling for 90s" hole (HYP-52).
      await this._waitForReady(90_000, gen);

      return this.getState();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('[HyperIDE] Dev server failed:', errorMessage);
      this._outputChannel.appendLine(`[DevServer] Failed to start: ${errorMessage}`);

      // Both captured BEFORE the dependency-repair branch below, which internally calls
      // _runStop()/_runStart() and can reset _status/_lastExitCode (HYP-52 retry, and
      // _runStart's own top-of-function reset) — reading either one later would lose
      // the original signal (review finding). `alreadyDescribed` is true only when the
      // child 'error' handler already produced a fully-described message (hint
      // included) that _waitForReady rethrew verbatim: re-describing it here would
      // re-scan the same text via buildMissingCommandHint and could append a duplicate
      // hint. `lastExitCode` is this attempt's own exit code, for the non-already-
      // described case below.
      const alreadyDescribed = this._status === 'error' && errorMessage === this._error;
      const lastExitCode = this._lastExitCode;

      if (!dependencyRepairAttempted && shouldRepairDependencies(errorMessage, this._logs)) {
        try {
          // Call the PRIVATE bodies, not the public queued start()/stop() — this catch
          // runs INSIDE the already-dequeued _runStart, so re-entering the public
          // methods would enqueue behind ourselves and deadlock (HYP-52).
          await this._runStop();
          const packageManager = await detectPackageManager(this._projectPath);
          await this._repairDependencies(packageManager);
          return this._runStart(true);
        } catch (repairError) {
          const repairMessage = repairError instanceof Error ? repairError.message : 'Unknown dependency repair error';
          this._outputChannel.appendLine(`[DevServer] Dependency repair failed: ${repairMessage}`);
        }
      }

      this._stopProxy();
      this.transition(
        'error',
        alreadyDescribed ? errorMessage : this._describeStartFailure(errorMessage, lastExitCode),
      );
      return this.getState();
    }
  }

  /**
   * Turn a raw start failure into an actionable diagnostic (HYP-1140) instead of
   * leaving the user staring at an opaque "Server failed to start". Keeps the raw
   * shell output as-is (it's already in this._logs / the output channel) — this only
   * ADDS a hint line and appends it to the returned error, it never replaces the raw
   * text. Shared by the _runStart catch block (has an exit code via _lastExitCode) and
   * the child 'error' handler (Node-level spawn failure, no exit code — e.g. a bare
   * ENOENT when the shell binary itself is missing).
   *
   * Pushes the hint through BOTH surfaces a user might be watching: the "HyperIDE Dev
   * Server" Output channel AND the log pipeline (_appendLog -> onLogsUpdate -> Hyper
   * Logs panel). The `DevServerState.error` field this method's return value feeds is
   * NOT enough on its own — the auto-start path (extension.ts) never reads it (review
   * finding, HYP-1140), so without also logging it here the hint could go completely
   * unseen on the exact flow the bug was originally reported from.
   */
  private _describeStartFailure(rawMessage: string, exitCode: number | null = null): string {
    const hint = buildMissingCommandHint(rawMessage, this._logs, exitCode);
    if (!hint) return rawMessage;
    this._outputChannel.appendLine(`[DevServer] ${hint}`);
    // forceError: true — this is a synthesized diagnostic, not arbitrary program output;
    // it always represents an error condition regardless of ERROR_PATTERNS wording.
    this._appendLog(`[HyperIDE] ${hint}\n`, true);
    return `${rawMessage} — ${hint}`;
  }

  /**
   * Transition to 'stopped' UNLESS status is already 'error' — preserves a more
   * specific error state a sibling handler (child.on('error')) already set, e.g. the
   * HYP-1140 missing-command hint, rather than clobbering it with the less-informative
   * 'stopped'. Node's docs note 'exit' commonly fires even after 'error' (review
   * finding), so without this guard the hint would be erased the moment the exit
   * handler runs right after the error handler.
   */
  private _transitionToStoppedUnlessErrorAlready(): void {
    if (this._status !== 'error') {
      this.transition('stopped');
    }
  }

  /**
   * Stop the dev server. PUBLIC entry — serializes onto the lifecycle queue so it can
   * never interleave with an in-flight start()'s spawn (HYP-52). Internal callers that
   * already run inside a dequeued op (dependency-repair retry, _applyProjectPath, the
   * _runStart sync) must call _runStop directly to avoid self-deadlock.
   */
  async stop(): Promise<void> {
    const run = this._lifecycleOp.then(
      () => this._runStop(),
      () => this._runStop(),
    );
    this._lifecycleOp = run.catch(() => {});
    return run;
  }

  private async _runStop(): Promise<void> {
    // Bump the epoch: a stop must invalidate any in-flight _runStart's polling so it
    // does not keep waiting on a server we are tearing down (HYP-52, Layer 2).
    ++this._generation;
    // Capture to locals — this._process may be nullified by the exit handler
    // between the guard and the async operations below
    const proc = this._process;
    const adopted = this._adoptedRecord;
    this._adoptedRecord = null;
    if (proc) {
      this._outputChannel.appendLine('[DevServer] Stopping server...');
    } else if (adopted) {
      this._outputChannel.appendLine('[DevServer] Stopping adopted dev server...');
    }

    // Clear this child's orphan record up front: a clean stop() means this child is
    // no longer something the next start should reap. Other recorded generations
    // for the same project may still be real orphans, so clearing is pid-specific.
    if (proc?.pid) {
      clearOwnedDevServer(this._projectPath, proc.pid, this._orphanBaseDir);
    }

    this._process = null;
    this._port = null;
    this._stopProxy();

    // Unblock any awaitRecompile() callers — server is stopping so recompile will never land.
    this._recompileGate?.resolve();
    this._recompileGate = null;

    if (proc) {
      // Wait for process to exit (with timeout)
      await new Promise<void>((resolve) => {
        let exited = false;
        const timeout = setTimeout(() => {
          // Force kill if still running
          if (!exited) {
            this._killProcessTree(proc, 'SIGKILL');
          }
          resolve();
        }, 5000);

        proc.once('exit', () => {
          exited = true;
          clearTimeout(timeout);
          resolve();
        });

        // Try graceful shutdown first
        this._killProcessTree(proc, 'SIGTERM');
      });
    } else if (adopted) {
      // Attached server: no ChildProcess handle exists, so the teardown goes
      // through the registry record's process group (same ladder as the orphan
      // reaper) — otherwise stop() would leave the adopted server alive and a
      // restart would silently re-attach to it (PR #692 review).
      await this._stopAdoptedServer(adopted);
    }

    if (this._process === null) {
      this.transition('stopped');
    }
  }

  /**
   * Restart the dev server. Serialized as ONE atomic queue op (HYP-52) so no other
   * start()/stop() can sneak between the internal stop and start — otherwise a stray
   * start() dequeued in the gap would race the restart's own start.
   */
  async restart(): Promise<DevServerState> {
    const run = this._lifecycleOp.then(
      () => this._runRestart(),
      () => this._runRestart(),
    );
    this._lifecycleOp = run.catch(() => {});
    return run;
  }

  private async _runRestart(): Promise<DevServerState> {
    await this._runStop();
    return this._runStart();
  }

  /**
   * Switch the managed project root.
   *
   * VS Code can reuse the same extension host when a different folder is opened
   * in the current window. In that case the old dev server must not be reused
   * for the new workspace.
   */
  async setProjectPath(projectPath: string): Promise<void> {
    // PUBLIC entry — serialize onto the lifecycle queue (HYP-52). Its work calls
    // _runStop, which mutates shared _process/_port/_previewProxy and bumps _generation;
    // run off-queue it would race a queued _runStart/_runStop (and its ++_generation
    // would supersede an in-flight start). The actual work lives in _runSetProjectPath;
    // internal callers already inside a dequeued op (_syncProjectPathWithWorkspace at the
    // top of _runStart) must reach _applyProjectPath DIRECTLY, never this queued method,
    // or they would await the chain they are part of and self-deadlock.
    const run = this._lifecycleOp.then(
      () => this._runSetProjectPath(projectPath),
      () => this._runSetProjectPath(projectPath),
    );
    this._lifecycleOp = run.catch(() => {});
    return run;
  }

  private async _runSetProjectPath(projectPath: string): Promise<void> {
    // Explicit external set (e.g. monorepo sub-project reroot) pins the path so a later
    // start() won't sync it back to the workspace folder via _syncProjectPathWithWorkspace.
    this._projectPathPinned = true;
    await this._applyProjectPath(projectPath);
  }

  /** Switch the project path and reset project-scoped state. Does not change the pin. */
  private async _applyProjectPath(projectPath: string): Promise<void> {
    if (projectPath === this._projectPath) return;
    // Call _runStop directly, NOT the public queued stop() (HYP-52). _applyProjectPath
    // runs INSIDE a dequeued op from both callers — _runSetProjectPath (the public
    // setProjectPath's queued body) and _syncProjectPathWithWorkspace at the TOP of
    // _runStart — so enqueuing a stop() here would deadlock the op awaiting a stop queued
    // behind itself.
    await this._runStop();
    this._projectPath = projectPath;
    this._logs = [];
    this._hasErrors = false;
    this.setRuntimeError(null);
    for (const cb of this._onLogsUpdateListeners) cb(this._logs, this._hasErrors);
  }

  /**
   * Show output channel
   */
  showOutput(): void {
    this._outputChannel.show();
  }

  /**
   * Dispose resources
   */
  dispose(): void {
    // Chain _outputChannel.dispose() after stop() so the async stop() path
    // (process exit handler, stdout/stderr callbacks) doesn't call appendLine
    // on an already-disposed channel.
    void this.stop().finally(() => this._outputChannel.dispose());
  }

  /**
   * Switch between App Shell and Isolated mode. Delegated from PreviewModeManager.
   */
  setIsolatedMode(isolated: boolean): void {
    this._pendingIsolatedMode = isolated;
    this._previewProxy?.setIsolatedMode(isolated);
  }

  /**
   * Arm the recompile gate (webpack-only). PreviewModeManager calls this BEFORE
   * AST-rewriting the entry file when the framework is webpack/parcel. Subsequent
   * `awaitRecompile()` callers block until a NEW `compiled successfully` line is
   * observed AFTER this call. Calling again replaces the existing gate.
   */
  armRecompileGate(): void {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((r) => {
      resolve = r;
    });
    // If a previous gate was armed and never resolved, drop it — the new patch
    // supersedes the old one. Resolve the old gate so any awaiters unblock; they
    // will read the fresh state after the new patch lands.
    this._recompileGate?.resolve();
    this._recompileGate = { promise, resolve, armedAt: Date.now() };
    console.log('[HyperIDE] DevServer recompile gate armed');
    // HYP-370 Phase 3: surface the recompiling sub-state so consumers react
    // (status stays `running`; only `recompiling` flips to true).
    this._publishState();
  }

  /**
   * Await pending recompile gate, if any. No-op when no gate is armed. Used by
   * preview-side code that must not load the iframe URL until webpack finishes
   * the SECOND compile (the post-patch one).
   */
  async awaitRecompile(timeoutMs = 300_000): Promise<void> {
    if (!this._recompileGate) return;
    let timerId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<void>((resolve) => {
      timerId = setTimeout(resolve, timeoutMs);
    });
    await Promise.race([this._recompileGate.promise, timeoutPromise]);
    clearTimeout(timerId);
  }

  /**
   * Inspect a clean log chunk for a fresh `compiled successfully` line and resolve
   * the armed gate if the line is observed AFTER the gate was armed. Lines that
   * predate the arming timestamp are ignored — they belong to the pre-patch compile.
   *
   * Note: timestamps are checked against Date.now() at the moment the chunk is
   * received, not the line's own timestamp (we don't have one). Since stdout/stderr
   * chunks land within milliseconds of being emitted, this is good enough.
   */
  private _maybeResolveRecompileGate(text: string): void {
    const gate = this._recompileGate;
    if (!gate) return;
    if (Date.now() < gate.armedAt) return; // can't happen with monotonic Date.now, but defensive
    // Match the same set of markers we accept for initial server-ready
    // detection. After PreviewModeManager writes a route/entry file, the dev
    // server recompiles and emits one of these markers — webpack writes
    // "compiled successfully", Remix/Vite writes "page reload" or "hmr
    // update", Next.js writes "Compiled in" or "Ready in". Matching only the
    // webpack phrase missed the Remix/Vite/Next clusters and caused 90s
    // setupPreview hangs on those projects (HYP-363 cluster).
    if (!this._isRecompileReadyMessage(text)) return;
    console.log('[HyperIDE] DevServer recompile gate released');
    this._recompileGate = null;
    gate.resolve();
    // HYP-370 Phase 3: gate cleared — `recompiling` flips back to false.
    this._publishState();
  }

  /**
   * Detect Bun HMR-staleness signatures on a clean output chunk and schedule an
   * automatic restart when one is found.
   *
   * Why auto-restart: Bun's bundler can fall out of HMR sync for a module that is
   * not a dynamic import. Once in this state the dev server keeps running but changes
   * to that module are silently ignored — the only reliable fix is a full server
   * restart. We detect the signature and restart automatically so the user does not
   * have to notice the stale preview and restart manually.
   *
   * Loop protection: the give-up flag (_hmrStalenessGaveUp) is STICKY — once the
   * cap is reached it stays set until the server successfully transitions to `running`
   * (transition() clears it). A purely time-based reset would resume restarts every
   * ~60 s for a persistent structural staleness, causing an infinite loop even after
   * the "reload manually" message. The time window (HMR_STALENESS_EPISODE_WINDOW_MS)
   * still resets the counter for genuinely independent events: if the server was
   * running for a long time and a new staleness event appears well after the last
   * restart, the window resets the counter. This path is only reachable when
   * _hmrStalenessGaveUp is false (cap not yet hit).
   *
   * Only fires when the server is `running` — HMR staleness is a post-boot condition.
   * Restart is enqueued onto the public lifecycle queue (restart()) rather than calling
   * _runRestart() directly, because this callback runs outside a dequeued lifecycle op
   * (it is a Node stream event) and must not interleave with an in-flight stop/start.
   */
  private _maybeRestartOnStaleness(text: string): void {
    if (this._status !== 'running') return;
    if (!isDynamicImportStalenessMessage(text)) return;

    // Sticky give-up: cleared only when the server successfully reaches `running`.
    if (this._hmrStalenessGaveUp) {
      this._outputChannel.appendLine(
        '[DevServer] HMR staleness detected but auto-restart cap already exhausted — reload manually',
      );
      return;
    }

    const now = Date.now();
    // Reset the episode counter for genuinely new events (window elapsed + no give-up yet).
    if (now - this._hmrLastRestartAt > HMR_STALENESS_EPISODE_WINDOW_MS) {
      this._hmsRestartsThisEpisode = 0;
    }

    if (this._hmsRestartsThisEpisode >= HMR_STALENESS_RESTART_CAP) {
      // Mark give-up sticky so the window can't re-arm restarts while the root cause persists.
      this._hmrStalenessGaveUp = true;
      this._outputChannel.appendLine(
        `[DevServer] HMR staleness restart cap (${HMR_STALENESS_RESTART_CAP}) reached — auto-restart disabled until server recovers`,
      );
      return;
    }

    this._hmsRestartsThisEpisode += 1;
    this._hmrLastRestartAt = now;
    const attempt = this._hmsRestartsThisEpisode;
    console.log(
      `[HyperIDE] DevServer HMR staleness detected — auto-restart attempt ${attempt}/${HMR_STALENESS_RESTART_CAP}`,
    ); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    this._outputChannel.appendLine(
      `[DevServer] HMR staleness detected — auto-restarting (attempt ${attempt}/${HMR_STALENESS_RESTART_CAP})`,
    );

    // Fire-and-forget via the public queue so this does not deadlock a concurrent
    // lifecycle op and unhandled rejections are not surfaced to the process.
    void this.restart().catch(() => {});
  }

  private _isRecompileReadyMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('compiled successfully') || // webpack/CRA success
      lower.includes('compiled with') || // webpack/CRA finish with errors/warnings — still done
      lower.includes('compiled in') || // Next.js post-HMR "Compiled in 200ms"
      lower.includes('compiled client') || // Next.js post-HMR
      lower.includes('hmr update') || // Vite "[vite] hmr update"
      lower.includes('page reload') || // Vite/Remix "[vite] page reload"
      lower.includes('rebuilt in') || // esbuild
      /ready in \d+\s*ms/i.test(text) // Vite "ready in N ms" after restart
    );
  }

  private async _syncProjectPathWithWorkspace(): Promise<void> {
    // Respect an explicitly pinned path (monorepo sub-project, HYP-420) — never reset
    // it to the workspace folder, which may lack a runnable dev/start script. Use
    // _applyProjectPath (not setProjectPath) so this automatic sync never sets the pin.
    if (this._projectPathPinned) return;
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot || workspaceRoot === this._projectPath) return;
    await this._applyProjectPath(workspaceRoot);
  }

  /**
   * Stop the preview proxy and clear runtime error state
   */
  private _stopProxy(): void {
    if (this._previewProxy) {
      this._previewProxy.stop();
      this._previewProxy = null;
    }
    // Use setter so the callback fires and webview clears the banner
    if (this._runtimeError !== null) {
      this.setRuntimeError(null);
    }
  }

  /**
   * Find a free port starting from default. Delegates to the shared IPv6-aware
   * net-probe util so the bind and the liveness probe agree on the same surface
   * (127.0.0.1 AND ::1), instead of disagreeing on an IPv6-only bind.
   */
  private _findFreePort(startPort: number): Promise<number> {
    return findFreePort(startPort);
  }

  /**
   * Attach-first probe (HYP-1160): does a dev server already answer HTTP on
   * this port? Instance seam (like _findFreePort/_isPortOpen) so tests stay
   * hermetic when the dev machine happens to have a real listener on the
   * project's default port.
   */
  private _probeHttpServer(port: number): Promise<boolean> {
    return probeHttp(port);
  }

  /**
   * Build command based on package manager
   */
  private _buildCommand(packageManager: PackageManager, script: string): { cmd: string; args: string[] } {
    return pmRunCommand(packageManager, script);
  }

  /**
   * HYP-1169 self-healing toolchain, round 2: a ONE-SHOT pipeline that runs
   * in _runStart AFTER the spawn plan is resolved and BEFORE the child is
   * spawned. Returns the refreshed PATH the child's env must use.
   *
   * The full command chain is analyzed UP FRONT: the global tools the plan's
   * package manager needs (requiredToolsForPackageManager) and the local
   * binaries the normalized spawn command needs from node_modules/.bin
   * (requiredLocalBinaries). Then, in order:
   *   1. GLOBALS — ensureTool per required tool: a cached "available" entry
   *      is trusted only after a live `<tool> --version` probe (a failed probe
   *      invalidates the cache and re-runs the install); every install is
   *      post-verified and its probe-resolved binary dirs are collected for
   *      the child PATH. markToolAvailable never fires on exit code alone.
   *   2. DEPENDENCIES — `<pm> install` in the plan cwd, MANDATORY: a failure
   *      stops the pipeline with a friendly error + Retry action (one retry
   *      inside this phase). The install child sees the verified tool dirs on
   *      PATH — otherwise `bun install` fails with "'bun' is not recognized"
   *      on the very machine that just installed bun (Alex's Windows run).
   *   3. VERIFY — the local binaries the spawn command needs must exist in
   *      <plan.cwd>/node_modules/.bin; a missing one (incomplete install)
   *      stops the pipeline naming the binary + the log location, with a
   *      Retry that force-reinstalls. Never spawn blind into "not recognized".
   *   4. PATH — verified tool dirs prepended (deduped) over the refreshed
   *      PATH. refreshPathForChild (registry query on win32) is SKIPPED when
   *      nothing was installed and no verified dirs exist (review nit: a warm
   *      start must not pay a registry spawn).
   *
   * UX (fix 4): while there is real work (a missing tool or stale deps), one
   * progress notification reports "Step i/N: <phase>…" and a companion
   * notification offers 'Open Logs' (reveals the HyperIDE Dev Server output
   * channel, where installer output streams live).
   */
  private async _prepareToolchain(plan: SpawnCommand & { packageManager: PackageManager }): Promise<string> {
    const pm = plan.packageManager;
    const requiredTools = requiredToolsForPackageManager(pm);
    const localBinaries = requiredLocalBinaries(plan.cmd, plan.args, plan.branch);
    const availability = await this._toolchain.detectAvailableTools();
    const depsStale = await this._toolchain.shouldInstallDependencies(plan.cwd, pm);
    const toolDirs: string[] = [];
    const installRan = { value: requiredTools.some((tool) => !availability[tool]) || depsStale };

    const phases: ToolchainPhase[] = requiredTools.map((tool) => ({
      title: `Checking ${tool}`,
      run: async (progress, token) => {
        const dirs = await this._toolchain.ensureTool(tool, {
          availability,
          output: this._outputChannel,
          confirmSudo: (description) => this._confirmSudoInstall(description),
          exec: { progress, token },
        });
        for (const dir of dirs) {
          if (!toolDirs.some((d) => d.toLowerCase() === dir.toLowerCase())) toolDirs.push(dir);
        }
      },
    }));
    if (depsStale) phases.push(this._depsPhase(plan, toolDirs));
    phases.push(this._verifyPhase(plan, localBinaries, toolDirs, installRan));

    try {
      await this._runToolchainPhases(phases, installRan.value);
    } catch (error) {
      if (error instanceof ToolchainInstallError) {
        const action = await vscode.window.showErrorMessage(error.message, 'Open instructions', 'Open Logs');
        if (action === 'Open instructions') {
          void vscode.env.openExternal(vscode.Uri.parse(error.docsUrl));
        } else if (action === 'Open Logs') {
          this._outputChannel.show();
        }
      }
      throw error;
    }

    const basePath =
      installRan.value || toolDirs.length > 0 ? await this._toolchain.refreshPathForChild() : (process.env.PATH ?? '');
    if (toolDirs.length === 0) return basePath;
    // Verified binary dirs FIRST (they won a live `<tool> --version`), then the
    // refreshed PATH, deduped.
    return mergePathEntries(
      toolDirs.join(delimiter),
      basePath.split(delimiter).filter(Boolean),
      process.platform !== 'linux',
      delimiter,
    );
  }

  /** `<pm> install` in the plan cwd, with the verified tool dirs on the child's PATH. */
  private async _runDepsInstall(
    plan: SpawnCommand & { packageManager: PackageManager },
    toolDirs: readonly string[],
    progress: ToolchainProgress,
    token: { isCancellationRequested: boolean },
    force: boolean,
  ): Promise<void> {
    await this._toolchain.ensureDependencies(plan.cwd, plan.packageManager, {
      output: this._outputChannel,
      force,
      exec: {
        progress,
        token,
        env: { PATH: [...toolDirs, ...(process.env.PATH ?? '').split(delimiter).filter(Boolean)].join(delimiter) },
      },
    });
  }

  /**
   * The dependency-install phase (fix 2): MANDATORY, never blind-continued.
   * A failure stops the pipeline with a friendly error + Retry action; the
   * retry runs once inside the phase, a second failure propagates.
   */
  private _depsPhase(
    plan: SpawnCommand & { packageManager: PackageManager },
    toolDirs: readonly string[],
  ): ToolchainPhase {
    const pm = plan.packageManager;
    return {
      title: `Installing project dependencies (${pm} install)…`,
      run: async (progress, token) => {
        try {
          await this._runDepsInstall(plan, toolDirs, progress, token, false);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this._outputChannel.appendLine(`[DevServer] Dependency install failed: ${message}`);
          const choice = await vscode.window.showErrorMessage(
            `HyperIDE could not install the project dependencies (${pm} install), so the dev server cannot start. ` +
              `The full install log is in the 'HyperIDE Dev Server' output channel.`,
            'Retry',
            'Open Logs',
          );
          if (choice === 'Open Logs') this._outputChannel.show();
          if (choice !== 'Retry') throw error;
          await this._runDepsInstall(plan, toolDirs, progress, token, false);
        }
      },
    };
  }

  /**
   * The verification phase (fix 2): the local binaries the normalized spawn
   * command needs must exist in <plan.cwd>/node_modules/.bin AFTER the
   * install — a missing one stops the start with a friendly error naming the
   * binary and the log location. Retry force-reinstalls (a half-written
   * node_modules can look fresh by mtime) and re-verifies.
   */
  private _verifyPhase(
    plan: SpawnCommand & { packageManager: PackageManager },
    localBinaries: readonly string[],
    toolDirs: readonly string[],
    installRan: { value: boolean },
  ): ToolchainPhase {
    return {
      title: 'Verifying installation…',
      run: async (progress, token) => {
        let missing = await this._toolchain.findMissingLocalBinaries(plan.cwd, localBinaries);
        if (missing.length === 0) return;
        const names = missing.map((binary) => `'${binary}'`).join(', ');
        this._outputChannel.appendLine(
          `[DevServer] Required local binaries missing from ${plan.cwd}/node_modules/.bin: ${names}`,
        );
        const choice = await vscode.window.showErrorMessage(
          `HyperIDE installed the dependencies, but ${names} ${missing.length === 1 ? 'is' : 'are'} still missing ` +
            `from node_modules/.bin — starting now would fail with "'${missing[0]}' is not recognized". ` +
            `The install log is in the 'HyperIDE Dev Server' output channel.`,
          'Retry',
          'Open Logs',
        );
        if (choice === 'Open Logs') this._outputChannel.show();
        if (choice === 'Retry') {
          await this._runDepsInstall(plan, toolDirs, progress, token, true);
          installRan.value = true;
          missing = await this._toolchain.findMissingLocalBinaries(plan.cwd, localBinaries);
        }
        if (missing.length > 0) {
          throw new Error(
            `Dev server cannot start: ${names} missing from node_modules/.bin after ${plan.packageManager} install. ` +
              `See the 'HyperIDE Dev Server' output channel for the install log.`,
          );
        }
      },
    };
  }

  /**
   * Drive the toolchain phases through ONE progress notification (step i/N
   * per phase) plus a companion 'Open Logs' offer — but only when there is
   * real work to show (a missing tool or a dependency install); a warm start
   * runs the same phases silently.
   */
  private async _runToolchainPhases(phases: ToolchainPhase[], notify: boolean): Promise<void> {
    const runAll = async (report: (message: string) => void, token: { isCancellationRequested: boolean }) => {
      for (let i = 0; i < phases.length; i++) {
        const prefix = `Step ${i + 1}/${phases.length}`;
        report(`${prefix}: ${phases[i].title}`);
        await phases[i].run({ report: (message) => report(`${prefix}: ${message}`) }, token);
      }
    };
    if (!notify) {
      await runAll(() => {}, { isCancellationRequested: false });
      return;
    }
    void vscode.window
      .showInformationMessage(
        'HyperIDE is preparing the toolchain for this project (installing missing tools / dependencies).',
        'Open Logs',
      )
      .then((choice) => {
        if (choice === 'Open Logs') this._outputChannel.show();
      });
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'HyperIDE: Preparing the toolchain',
        cancellable: true,
      },
      (progress, token) => runAll((message) => progress.report({ message }), token),
    );
  }

  /**
   * Modal confirmation for the ONE install path that needs administrator
   * rights (linux node via apt). Everything else in the toolchain installer is
   * sudo-free; this dialog is what keeps the no-silent-sudo invariant true.
   */
  private async _confirmSudoInstall(description: string): Promise<boolean> {
    const choice = await vscode.window.showWarningMessage(
      `HyperIDE needs to install ${description}, which requires administrator (sudo) access. Proceed?`,
      { modal: true },
      'Install',
    );
    return choice === 'Install';
  }

  private async _repairDependencies(packageManager: PackageManager): Promise<void> {
    const command = buildInstallCommand(packageManager);
    this._outputChannel.appendLine(`[DevServer] Repairing dependencies with ${command.cmd} ${command.args.join(' ')}`);
    this._appendLog(`[HyperIDE] Repairing dependencies with ${command.cmd} ${command.args.join(' ')}\n`);

    // detectWindowsOemCodePage() (HYP-1140 follow-up) — module-cached, so this costs
    // nothing beyond the first real probe of the extension host session. NOT awaited
    // (review finding, same rationale as _runStart): a hung `chcp` must not add several
    // seconds to every dependency repair. The decoders below read this live.
    const oemCodePageBox: { value: number | null } = { value: null };
    detectWindowsOemCodePage().then((codePage) => {
      oemCodePageBox.value = codePage;
    });

    await new Promise<void>((resolve, reject) => {
      // Fold args into the command string (no `args` array) so `shell: true`
      // does not trigger DEP0190 (deprecated: args + shell:true).
      // nosemgrep: spawn-shell-true -- package-manager commands may resolve through shell shims/corepack
      const child = spawn(toShellCommandString(command.cmd, command.args), {
        cwd: this._projectPath,
        env: {
          ...process.env,
          CI: 'true',
        },
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // One StreamOutputDecoder per stream (HYP-1140 follow-up) — same rationale as the
      // dev-server handlers above: a raw `data` chunk can end mid-character.
      const stdoutDecoder = new StreamOutputDecoder(process.platform, () => oemCodePageBox.value);
      const stderrDecoder = new StreamOutputDecoder(process.platform, () => oemCodePageBox.value);

      child.stdout?.on('data', (data: Buffer) => {
        const text = stdoutDecoder.push(data);
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = stderrDecoder.push(data);
        const clean = text.replace(ANSI_ESCAPE_PATTERN, '');
        this._outputChannel.append(clean);
        this._appendLog(text); // raw ANSI — webview renders via ansi_up
      });

      child.on('error', (error) => reject(error));
      child.on('exit', (code) => {
        this._flushStreamDecoder(stdoutDecoder);
        this._flushStreamDecoder(stderrDecoder);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`${command.cmd} ${command.args.join(' ')} exited with code ${code}`));
      });
    });
  }

  private _killProcessTree(proc: ChildProcess, signal: NodeJS.Signals): void {
    if (process.platform !== 'win32' && proc.pid && this._killPidGroup(proc.pid, signal)) {
      return;
    }
    proc.kill(signal);
  }

  /**
   * Kill a raw pid's process group on POSIX (`process.kill(-pid, signal)`), the
   * same group-kill _killProcessTree uses for the live ChildProcess. Returns true
   * when the group signal was delivered, false when it failed (e.g. the group is
   * already gone, or on Windows where detached groups are not addressable this
   * way) so the caller can fall back. Used by the orphan reaper, which only has a
   * recorded pid (no ChildProcess handle).
   */
  private _killPidGroup(pid: number, signal: NodeJS.Signals): boolean {
    if (process.platform === 'win32') return false;
    try {
      process.kill(-pid, signal);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Terminate an orphaned dev-server process group we recorded in a previous
   * session, using the same SIGTERM→(brief wait)→SIGKILL ladder as stop(). Best
   * effort: each step swallows its own error. Synchronous SIGTERM, then a delayed
   * SIGKILL backstop so a process ignoring SIGTERM is still cleared without us
   * blocking the fresh start that follows.
   */
  private _reapOrphanPid(pid: number): void {
    this._killPidGroup(pid, 'SIGTERM');
    setTimeout(() => {
      this._killPidGroup(pid, 'SIGKILL');
    }, 2000).unref?.();
  }

  /**
   * Terminate an ADOPTED dev server on stop() (PR #692 review). We hold no
   * ChildProcess for an attached server — only the registry record that proved
   * we spawned it — so teardown uses the same process-group ladder as the
   * orphan reaper (_killPidGroup by the recorded pid): SIGTERM, a bounded wait
   * for the group to die, then SIGKILL. The record is cleared FIRST so the next
   * start never re-attaches to the dying server — it spawns fresh.
   */
  private async _stopAdoptedServer(record: OwnedDevServerRecord): Promise<void> {
    clearOwnedDevServer(this._projectPath, record.pid, this._orphanBaseDir);
    // Never signal our own process group: a record whose pid was recycled onto
    // THIS extension host must not turn stop() into suicide.
    if (record.pid === process.pid) return;
    this._killPidGroup(record.pid, 'SIGTERM');
    const deadline = Date.now() + 5000;
    while (isProcessAlive(record.pid) || isProcessGroupAlive(record.pid)) {
      if (Date.now() >= deadline) {
        this._killPidGroup(record.pid, 'SIGKILL');
        return;
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 50)); // executor form: tsconfig lib predates Promise.withResolvers (es2024)
    }
  }

  /**
   * Reap orphaned dev servers from previous sessions for the current project.
   * Delegates ownership/aliveness checks to the registry and the actual termination
   * to _reapOrphanPid (the shared kill ladder).
   * Fully best-effort — reapStaleOwnedDevServer never throws.
   */
  private _reapOrphanedDevServer(): void {
    const reaped = reapStaleOwnedDevServer(this._projectPath, (pid) => this._reapOrphanPid(pid), {
      baseDir: this._orphanBaseDir,
      onLog: (message) => this._outputChannel.appendLine(message),
    });
    if (reaped !== null) {
      // Summary line for the VS Code Output channel (the per-pid detail already
      // went through onLog above) — appendLine only, not console.log: this is a
      // rarely-hit best-effort cleanup path, not a hot loop worth a dev-console
      // trace, and the output channel is what a user/agent actually inspects.
      this._outputChannel.appendLine(`[DevServer] Reaped orphaned pids ${reaped.join(', ')} from previous sessions`);
    }
  }

  /**
   * Public wait-for-ready: resolves once the dev server is `running` AND any armed
   * recompile gate has been released. Use this from preview/iframe loading paths
   * that must not race with a webpack post-patch second compile.
   *
   * If the server is already running and no gate is armed, returns immediately.
   * If a gate is armed (regardless of running state), blocks until release.
   */
  async waitForReady(timeoutMs = 90_000): Promise<void> {
    if (this._status !== 'running') {
      await this._waitForReady(timeoutMs);
    }
    await this.awaitRecompile(timeoutMs);
  }

  /**
   * Wait for server to be ready.
   *
   * `gen` (optional) is the epoch snapshot captured by the calling _runStart. When
   * passed, the poll bails the moment a concurrent _runStop/_runStart bumps
   * _generation past it — this is the symmetric half of the HYP-52 fix: without it a
   * stop could kill the child while this loop kept polling the (now dead) port for the
   * full timeout. The public waitForReady() passes no gen, so that caller is unaffected
   * (it only supersede-checks when a gen is explicitly provided).
   */
  private async _waitForReady(timeout: number, gen?: number): Promise<void> {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (gen !== undefined && gen !== this._generation) {
        throw new Error('Server start superseded');
      }

      if (this._status === 'running') {
        return;
      }

      if (this._status === 'error' || this._status === 'stopped') {
        // `error` (not `stopped`) means a handler upstream (child.on('error')) already
        // set a SPECIFIC, fully-described `_error` — e.g. the HYP-1140 missing-command
        // hint. Rethrow it verbatim so the _runStart catch block below preserves it,
        // instead of clobbering it with this generic fallback. `stopped` (a clean exit
        // with no such handler) has no specific message to preserve.
        throw new Error(this._status === 'error' && this._error ? this._error : 'Server failed to start');
      }

      // Check if port is accepting connections — capture port to a local variable
      // to avoid a race where the exit handler nullifies this._port between the
      // truthiness check and the async _isPortOpen call
      const port = this._port;
      if (port && (await this._isPortOpen(port))) {
        this.transition('running');
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    throw new Error('Server startup timeout');
  }

  /**
   * Check if port is accepting connections. Delegates to the shared net-probe
   * util, which connects to both 127.0.0.1 and ::1 so a dev server bound to
   * either loopback family is detected (previously this connected to
   * 'localhost' while _findFreePort bound '127.0.0.1', disagreeing on an
   * IPv6-only bind).
   */
  private _isPortOpen(port: number): Promise<boolean> {
    return probeOpen(port);
  }

  /**
   * Parse the actual bound port from a dev server startup line and update the
   * proxy target when it differs from the assigned port.
   *
   * Some dev servers (Bun.serve, custom scripts) ignore the PORT env var and
   * bind to a hardcoded port. This method reads the port from output lines like
   * "http://localhost:3000" or "Local: http://127.0.0.1:5173" and silently
   * corrects the proxy target so requests reach the server. Called once per
   * start(), subsequent calls are no-ops once _portDetected is set.
   *
   * Requires the http:// scheme so debugger lines ("Debugger listening on
   * ws://127.0.0.1:9229") are never mistaken for dev-server ports.
   */
  private _maybeUpdatePortFromOutput(text: string): void {
    if (this._portDetected || !this._previewProxy) return;
    const match = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1):(\d{1,5})/);
    if (!match) return;
    const detectedPort = Number(match[1]);
    if (!Number.isFinite(detectedPort) || detectedPort <= 0 || detectedPort > 65535) return;
    this._portDetected = true;
    if (detectedPort === this._port) return;
    const msg = `[DevServer] Port auto-corrected: ${this._port} → ${detectedPort} (server ignored PORT env var)`;
    console.log(`[HyperIDE] DevServer bound to port ${detectedPort} (assigned ${this._port}), correcting proxy target`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    this._outputChannel.appendLine(msg);
    this._port = detectedPort;
    this._previewProxy.setTargetPort(detectedPort);
  }

  /**
   * Check if output text indicates the dev server is ready to accept connections.
   * Covers Vite, Next.js, webpack-dev-server, Remix, CRA, and generic patterns.
   */
  private _isServerReadyMessage(text: string): boolean {
    const lower = text.toLowerCase();
    return (
      lower.includes('ready') || // Vite "ready in", Next.js "Ready in"
      text.includes('Local:') || // Vite "Local: http://..."
      text.includes('localhost:') || // webpack-dev-server "Loopback: http://localhost:"
      text.includes('Started') || // Generic
      lower.includes('compiled successfully') || // webpack/CRA
      lower.includes('compiled client') || // Next.js "Compiled client and server"
      lower.includes('listening on') || // Generic servers
      text.includes('Loopback:') // webpack-dev-server
    );
  }

  /**
   * Flush a StreamOutputDecoder's held-back bytes (HYP-1140 follow-up) and push
   * whatever it decodes through the same output-channel + log-buffer path a normal
   * `data` chunk goes through. A no-op when nothing was held back (the common case).
   */
  private _flushStreamDecoder(decoder: StreamOutputDecoder): void {
    const flushed = decoder.flush();
    if (!flushed) return;
    this._outputChannel.append(flushed.replace(ANSI_ESCAPE_PATTERN, ''));
    this._appendLog(flushed);
  }

  /**
   * Append text to log buffer, split into lines, detect errors.
   *
   * `forceError`: mark every line from this call as an error unconditionally, skipping
   * the ERROR_PATTERNS regex scan. For text this file SYNTHESIZES itself (not arbitrary
   * dev-server program output) where we already KNOW it represents an error — e.g. the
   * HYP-1140 missing-command hint from _describeStartFailure. Without this, that hint
   * line got `isError: false` (none of the shared ERROR_PATTERNS match its wording),
   * so `hasErrors`/the diagnostics UI (Auto Fix, "Errors: yes/no") disagreed with the
   * dev server's actual `error` status (review finding). Does NOT touch ERROR_PATTERNS
   * itself — that shared list also gates `server/services/build-status-wait.ts`, and a
   * broader match there was already reverted once for regressing a false-positive there.
   */
  private _appendLog(text: string, forceError = false): void {
    const now = Date.now();
    const lines = text.split('\n').filter((l) => l.length > 0);
    const newEntries: LogEntry[] = [];

    for (const line of lines) {
      const cleanLine = line.replace(ANSI_ESCAPE_PATTERN, '');
      const isError = forceError || ERROR_PATTERNS.some((pattern) => pattern.test(cleanLine));
      // Both checks are needed independently: isSuccess clears _hasErrors even for non-error lines.
      // Short-circuiting on isError would skip success detection for error-free log lines.
      const isSuccess = SUCCESS_PATTERNS.some((pattern) => pattern.test(cleanLine));
      const entry: LogEntry = { line, timestamp: now, isError };
      this._logs.push(entry);
      newEntries.push(entry);

      if (isError) {
        this._hasErrors = true;
      }
      if (isSuccess) {
        this._hasErrors = false;
      }
    }

    // Trim to max size — slicing a 200-entry array is negligible; threshold-based
    // trimming adds complexity for no measurable gain at this scale
    if (this._logs.length > MAX_LOG_ENTRIES) {
      this._logs = this._logs.slice(-MAX_LOG_ENTRIES);
    }

    if (newEntries.length > 0) {
      for (const cb of this._onLogsUpdateListeners) cb(newEntries, this._hasErrors);

      // Notify about new errors
      const errorEntries = newEntries.filter((e) => e.isError);
      if (errorEntries.length > 0) {
        this._onError?.(errorEntries.map((e) => e.line.replace(ANSI_ESCAPE_PATTERN, '')).join('\n'));
      }
    }
  }

  /**
   * Guarded status transition (HYP-370 Phase 2). Consults LEGAL_TRANSITIONS and
   * applies + publishes the new status only for legal edges. Idempotent self-loops
   * (to === from) are always legal — this preserves today's always-fire behavior
   * (e.g. stop() of a fresh instance re-publishing `stopped`). Illegal cross-state
   * jumps are no-ops: the status is left unchanged and onStatusChange is NOT fired.
   *
   * Returns true if the transition was applied, false if rejected. All status-setting
   * sites route through here; _updateStatus stays the set+notify primitive it calls.
   */
  private transition(to: DevServerStatus, error?: string): boolean {
    const from = this._status;
    if (to !== from && !LEGAL_TRANSITIONS[from].includes(to)) {
      console.warn(`[HyperIDE] DevServer rejected illegal status transition: ${from} -> ${to}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
      return false;
    }
    // A successful boot means the HMR-staleness restart actually resolved the issue.
    // Clear the sticky give-up flag and reset the episode counter so future staleness
    // events get a fresh budget (instead of being permanently blocked by a previous
    // episode's cap).
    if (to === 'running') {
      this._hmrStalenessGaveUp = false;
      this._hmsRestartsThisEpisode = 0;
    }
    this._updateStatus(to, error);
    return true;
  }

  /**
   * Update status and notify listeners
   */
  private _updateStatus(status: DevServerStatus, error?: string): void {
    this._status = status;
    this._error = error;
    this._publishState();
  }
}
