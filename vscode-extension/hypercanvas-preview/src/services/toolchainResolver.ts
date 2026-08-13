/**
 * @file toolchainResolver — HYP-1169 round 4: WHERE is the tool's binary?
 * Resolve the absolute path to a working `<tool>` through an ordered chain of
 * sources, each candidate live-verified (`<path> --version`) before use:
 *
 *   1. OVERRIDE — the `hypercanvas.tools.<tool>` setting (absolute path), for
 *      users whose install lives somewhere no heuristic reaches.
 *   2. CACHE — `<project>/.hyperide/toolchain.json`, written after every
 *      successful verification. An entry older than
 *      TOOLCHAIN_CACHE_MAX_AGE_DAYS, pointing at a deleted file, or failing a
 *      live re-probe is discarded and re-resolved.
 *   3. PATH — the extension host's process env (snapshotted at VS Code
 *      launch; misses anything installed into shell profiles afterwards).
 *   4. SHELL PROFILE — the user's login shell asked directly
 *      (`$SHELL -ilc 'command -v <tool>'`). This is the "~/.zshrc has it but
 *      GUI-launched VS Code doesn't" case (the colleague scenario). Skipped
 *      on win32 — the registry user PATH is already covered by
 *      probeToolBinaryDirs.
 *   5. WELL-KNOWN DIRS — probeToolBinaryDirs (HYP-1169 R2/R3): ~/.bun/bin,
 *      WinGet Links shims, registry user-PATH mentions, per-user bin dirs.
 *
 * Accessed via: DevServerManager._prepareToolchain (through the `_toolchain`
 * seam) BEFORE any install decision — a resolved tool is never reinstalled,
 * and its directory is prepended to the dev-server child's PATH.
 *
 * Invariants:
 *  - NEVER trusts a path without a live `--version` probe (a stale cache or
 *    half-finished uninstall must not spawn a ghost binary).
 *  - NEVER throws — worst case it returns null and the caller falls back to
 *    the installer. Cache-write failures (read-only project) are swallowed.
 *  - All platform primitives (verify spawn, shell capture, fs, clock) are
 *    injected — unit tests never spawn or touch the real fs.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { delimiter, join, win32 as win32path } from 'node:path';
import type { ToolchainTool } from './toolchainDetector';
import { probeToolBinaryDirs } from './toolchainPath';

type ToolResolutionSource = 'override' | 'cache' | 'path' | 'shellProfile' | 'wellKnown';

export interface ToolResolution {
  tool: ToolchainTool;
  /** Absolute path to the live-verified binary. */
  path: string;
  source: ToolResolutionSource;
}

export interface ToolchainResolverDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Settings override reader (hypercanvas.tools.<tool>) — undefined when unset. */
  getOverride?: (tool: ToolchainTool) => string | undefined;
  /** Sync file-existence probe (default existsSync). */
  fileExists?: (path: string) => boolean;
  /** Live verification: does `<path> --version` exit 0 within the timeout? */
  verify?: (absPath: string) => Promise<boolean>;
  /** Ask the user's login shell for the tool path (unix only; default spawns `$SHELL -ilc`). */
  resolveViaShellProfile?: (tool: ToolchainTool) => Promise<string | null>;
  /** Well-known install dirs verifiably containing the tool (default probeToolBinaryDirs). */
  probeWellKnownDirs?: (tool: ToolchainTool) => Promise<string[]>;
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
  mkdir?: (path: string) => Promise<void>;
  now?: () => number;
  onLog?: (message: string) => void;
}

/** Cache entries older than this are re-resolved instead of trusted. */
export const TOOLCHAIN_CACHE_MAX_AGE_DAYS = 7;

const VERIFY_TIMEOUT_MS = 5_000;
const SHELL_CAPTURE_TIMEOUT_MS = 8_000;
const CACHE_FILE_VERSION = 1;

interface ToolchainCacheFile {
  version: number;
  tools: Partial<Record<ToolchainTool, { path: string; source: ToolResolutionSource; verifiedAt: string }>>;
}

/** The binary inside `dir`, or null when no candidate name exists there. */
function binaryInDir(
  dir: string,
  tool: ToolchainTool,
  platform: NodeJS.Platform,
  fileExists: (path: string) => boolean,
): string | null {
  // win32 shims come in .exe/.cmd/.bat flavors (winget/npm/bun all differ),
  // and win32 paths must join with backslashes even when tests run on POSIX.
  const names = platform === 'win32' ? [`${tool}.exe`, `${tool}.cmd`, `${tool}.bat`] : [tool];
  const joinDir = platform === 'win32' ? win32path.join : join;
  for (const name of names) {
    const candidate = joinDir(dir, name);
    if (fileExists(candidate)) return candidate;
  }
  return null;
}

/**
 * Default live verification: `<path> --version`, bounded. POSIX uses the argv
 * form (no shell) so an attacker-influenced path string can never reach shell
 * command substitution (`$()`, backticks); win32 keeps `shell: true` because
 * `.cmd`/`.bat` shims only execute through cmd.exe.
 */
function defaultVerify(absPath: string, platform: NodeJS.Platform): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(ok);
    };
    const child =
      platform === 'win32'
        ? // nosemgrep: spawn-shell-true -- quoted absolute path + fixed flag; shell:true is required for win32 .cmd shims
          spawn(`"${absPath}" --version`, { shell: true, stdio: ['ignore', 'ignore', 'ignore'] })
        : spawn(absPath, ['--version'], { stdio: ['ignore', 'ignore', 'ignore'] });
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

/**
 * Default shell-profile capture: spawn the user's login shell INTERACTIVE
 * (`-ilc`) so rc files run (zsh reads .zshrc only for interactive shells;
 * bash reads .bashrc likewise) and ask it where the tool lives. Interactive
 * shells without a tty may print job-control warnings — stderr is discarded
 * and only stdout lines that look like an absolute existing path are kept.
 */
function defaultResolveViaShellProfile(
  tool: ToolchainTool,
  env: NodeJS.ProcessEnv,
  fileExists: (path: string) => boolean,
): Promise<string | null> {
  const shells: string[] = [];
  for (const candidate of [env.SHELL, '/bin/zsh', '/bin/bash']) {
    if (candidate && !shells.includes(candidate) && fileExists(candidate)) shells.push(candidate);
  }
  if (shells.length === 0) return Promise.resolve(null);
  const tryShell = (index: number): Promise<string | null> => {
    const shell = shells[index];
    if (!shell) return Promise.resolve(null);
    return new Promise<string | null>((resolve) => {
      let output = '';
      let settled = false;
      const finish = (value: string | null) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      // `command -v` is POSIX-builtin (no which/whereis portability trap).
      // nosemgrep: spawn-shell-true -- argv form, no shell string interpolation of user input
      const child = spawn(shell, ['-ilc', `command -v ${tool}`], {
        stdio: ['ignore', 'pipe', 'ignore'],
        env,
      });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // already gone
        }
        finish(null);
      }, SHELL_CAPTURE_TIMEOUT_MS);
      timer.unref?.();
      child.stdout?.on('data', (data: Buffer) => {
        output += data.toString('utf8');
      });
      child.on('error', () => finish(null));
      // 'close', not 'exit': Node guarantees stdio flush only at 'close' —
      // reading the buffered stdout at 'exit' can miss the final chunk and
      // silently drop the shell-profile path.
      child.on('close', async (code) => {
        if (code !== 0) {
          finish(null);
          return;
        }
        // Interactive rc files can print banners — only absolute paths count.
        for (const line of output.split('\n')) {
          const candidate = line.trim();
          if (candidate.startsWith('/') && fileExists(candidate)) {
            finish(candidate);
            return;
          }
        }
        finish(null);
      });
    }).then((found) => found ?? tryShell(index + 1));
  };
  return tryShell(0);
}

async function readCache(
  projectPath: string,
  read: (path: string) => Promise<string>,
): Promise<ToolchainCacheFile | null> {
  try {
    const parsed = JSON.parse(await read(join(projectPath, '.hyperide', 'toolchain.json'))) as ToolchainCacheFile;
    if (!parsed || typeof parsed !== 'object' || !parsed.tools || typeof parsed.tools !== 'object') return null;
    // A cache written by an incompatible future schema degrades to a miss,
    // never a bad hit.
    if (parsed.version !== CACHE_FILE_VERSION) return null;
    return parsed;
  } catch {
    return null; // missing or corrupt — treated as a cache miss
  }
}

/** Best-effort cache write: merges into any existing file, never throws. */
async function writeCacheEntry(
  projectPath: string,
  resolution: ToolResolution,
  deps: Required<Pick<ToolchainResolverDeps, 'readFile' | 'writeFile' | 'mkdir' | 'now'>>,
  onLog: (message: string) => void,
): Promise<void> {
  try {
    const existing = (await readCache(projectPath, deps.readFile)) ?? { version: CACHE_FILE_VERSION, tools: {} };
    existing.tools[resolution.tool] = {
      path: resolution.path,
      source: resolution.source,
      verifiedAt: new Date(deps.now()).toISOString(),
    };
    await deps.mkdir(join(projectPath, '.hyperide'));
    await deps.writeFile(join(projectPath, '.hyperide', 'toolchain.json'), `${JSON.stringify(existing, null, 2)}\n`);
    await ensureCacheGitExcluded(projectPath, deps);
  } catch (error) {
    onLog(`[toolchain] cache write failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * The cache holds absolute, machine-local binary paths — it must never show
 * up in the user's `git status` (and a committed copy would be wrong on every
 * other machine). Best-effort: append `.hyperide/toolchain.json` to the repo's
 * `.git/info/exclude` (local, unpushed — unlike .gitignore it can't clobber
 * the project's tracked files). Skipped silently for worktrees/submodules
 * (`.git` is a file there, so `info/exclude` has no fixed home) and for
 * non-git projects.
 */
async function ensureCacheGitExcluded(
  projectPath: string,
  deps: Required<Pick<ToolchainResolverDeps, 'readFile' | 'writeFile'>>,
): Promise<void> {
  const excludePath = join(projectPath, '.git', 'info', 'exclude');
  const EXCLUDE_LINE = '.hyperide/toolchain.json';
  try {
    const current = await deps.readFile(excludePath);
    if (current.split('\n').some((line) => line.trim() === EXCLUDE_LINE)) return;
    const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
    await deps.writeFile(excludePath, `${current}${separator}${EXCLUDE_LINE}\n`);
  } catch {
    // no readable exclude file (not a repo, worktree, permissions) — skip
  }
}

/**
 * Resolve the absolute path to a working `tool` binary for `projectPath`,
 * walking override → cache → PATH → shell profile → well-known dirs. Returns
 * null when nothing verifies (the caller then falls back to the installer).
 * A verified non-cache result is persisted to the project cache file.
 *
 * NEVER throws (documented invariant): any internal failure — a throwing
 * override reader, a rejecting well-known-dir probe — degrades to null so the
 * caller falls back to the installer instead of aborting start().
 */
export async function resolveToolBinary(
  tool: ToolchainTool,
  projectPath: string,
  deps: ToolchainResolverDeps = {},
): Promise<ToolResolution | null> {
  try {
    return await resolveToolBinaryUnchecked(tool, projectPath, deps);
  } catch (error) {
    const onLog = deps.onLog ?? (() => {});
    onLog(
      `[toolchain] ${tool} resolution failed, falling back to installer: ` +
        (error instanceof Error ? error.message : String(error)),
    );
    return null;
  }
}

async function resolveToolBinaryUnchecked(
  tool: ToolchainTool,
  projectPath: string,
  deps: ToolchainResolverDeps,
): Promise<ToolResolution | null> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const fileExists = deps.fileExists ?? existsSync;
  const verify = deps.verify ?? ((absPath: string) => defaultVerify(absPath, platform));
  const read = deps.readFile ?? ((p: string) => readFile(p, 'utf8'));
  const write = deps.writeFile ?? ((p: string, c: string) => writeFile(p, c, 'utf8'));
  const makeDir = deps.mkdir ?? ((p: string) => mkdir(p, { recursive: true }).then(() => undefined));
  const now = deps.now ?? Date.now;
  const onLog = deps.onLog ?? (() => {});

  const accept = (path: string, source: ToolResolutionSource): ToolResolution => {
    onLog(`[toolchain] ${tool} resolved via ${source}: ${path}`);
    return { tool, path, source };
  };

  // 1. Manual settings override — the user's explicit statement wins.
  const override = deps.getOverride?.(tool)?.trim();
  if (override) {
    if (await verify(override)) {
      const resolution = accept(override, 'override');
      await writeCacheEntry(projectPath, resolution, { readFile: read, writeFile: write, mkdir: makeDir, now }, onLog);
      return resolution;
    }
    onLog(`[toolchain] ${tool} override failed verification (--version): ${override}`);
  }

  // 2. Project cache — fresh entries still get a live re-probe.
  const cache = await readCache(projectPath, read);
  const entry = cache?.tools?.[tool];
  if (entry?.path) {
    const ageMs = now() - Date.parse(entry.verifiedAt);
    const fresh = Number.isFinite(ageMs) && ageMs <= TOOLCHAIN_CACHE_MAX_AGE_DAYS * 86_400_000;
    if (!fresh) {
      onLog(`[toolchain] ${tool} cache entry stale (>${TOOLCHAIN_CACHE_MAX_AGE_DAYS}d), re-resolving: ${entry.path}`);
    } else if (!fileExists(entry.path)) {
      onLog(`[toolchain] ${tool} cache entry points at a deleted file, re-resolving: ${entry.path}`);
    } else if (await verify(entry.path)) {
      return accept(entry.path, 'cache');
    } else {
      onLog(`[toolchain] ${tool} cache entry failed re-probe, re-resolving: ${entry.path}`);
    }
  }

  // 3. Process PATH. The delimiter follows the INJECTED platform (win32 `;`),
  // not the host's — binaryInDir already works the same way.
  const pathValue = env.PATH ?? env.Path ?? '';
  const pathDelimiter = platform === 'win32' ? ';' : delimiter;
  for (const dir of pathValue.split(pathDelimiter).filter(Boolean)) {
    const candidate = binaryInDir(dir, tool, platform, fileExists);
    if (candidate && (await verify(candidate))) {
      const resolution = accept(candidate, 'path');
      await writeCacheEntry(projectPath, resolution, { readFile: read, writeFile: write, mkdir: makeDir, now }, onLog);
      return resolution;
    }
  }

  // 4. Login-shell PATH (unix only — win32 registry is covered below).
  if (platform !== 'win32') {
    const fromShell = deps.resolveViaShellProfile
      ? await deps.resolveViaShellProfile(tool)
      : await defaultResolveViaShellProfile(tool, env, fileExists);
    if (fromShell && fileExists(fromShell) && (await verify(fromShell))) {
      const resolution = accept(fromShell, 'shellProfile');
      await writeCacheEntry(projectPath, resolution, { readFile: read, writeFile: write, mkdir: makeDir, now }, onLog);
      return resolution;
    }
  }

  // 5. Well-known install dirs.
  const probeDirs = deps.probeWellKnownDirs ?? ((t: ToolchainTool) => probeToolBinaryDirs(t, { platform, env }));
  for (const dir of await probeDirs(tool)) {
    const candidate = binaryInDir(dir, tool, platform, fileExists);
    if (candidate && (await verify(candidate))) {
      const resolution = accept(candidate, 'wellKnown');
      await writeCacheEntry(projectPath, resolution, { readFile: read, writeFile: write, mkdir: makeDir, now }, onLog);
      return resolution;
    }
  }

  onLog(`[toolchain] ${tool} not found in any resolution source`);
  return null;
}
