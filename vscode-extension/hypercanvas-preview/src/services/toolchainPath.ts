/**
 * @file toolchainPath — HYP-1169: rebuild the child PATH after a fresh tool
 * install. The extension host snapshots PATH at VS Code launch; a package
 * manager installed mid-session (winget, brew, the bun install script) is
 * invisible to `process.env.PATH` until the dev-server child's env is rebuilt
 * from FRESH sources:
 *
 *  - win32: the user PATH lives in the registry (HKCU\Environment\Path, often
 *    REG_EXPAND_SZ with unexpanded %VARS%) — read it via `reg query`, expand
 *    the variables, and merge with the process PATH. Plus the well-known
 *    install dirs winget/bun drop binaries into.
 *  - unix: append the well-known per-user bin dirs (~/.bun/bin, ~/.local/bin,
 *    ~/bin, the nvm "current" bin) when they exist on disk.
 *
 * All platform primitives (registry query, dir existence, env, home) are
 * injected — tests never touch the real registry or spawn anything.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, win32 as win32path } from 'node:path';
import type { ToolchainTool } from './toolchainDetector';

export interface PathRefreshDeps {
  platform?: NodeJS.Platform;
  /** Environment to base the merge on and to expand %VARS% from — default process.env. */
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Sync or async dir-existence probe (default: async fs.stat — never blocks the extension host's sync fs on the _runStart path). */
  dirExists?: (path: string) => boolean | Promise<boolean>;
  /** Raw `reg query "HKCU\Environment" /v Path` output, or null when absent/failed. */
  queryWindowsUserPath?: () => Promise<string | null>;
}

/**
 * Pull the `Path` value out of `reg query "HKCU\Environment" /v Path` output.
 * Handles both REG_SZ and REG_EXPAND_SZ (the user Path is usually the latter —
 * its value still contains unexpanded %USERPROFILE%-style variables, which the
 * caller expands). Returns null when the value is absent (fresh profiles have
 * no user Path — reg prints an ERROR line instead).
 */
export function parseWindowsRegistryPath(regOutput: string): string | null {
  const match = /^\s*Path\s+REG(?:_EXPAND)?_SZ\s+(\S.*)$/im.exec(regOutput);
  return match ? match[1].trim() : null;
}

/**
 * Merge PATH strings entry-wise: keep the base order, append only entries not
 * already present (case-insensitively when the platform's filesystem is). The
 * delimiter is inferred from the base (`;` for Windows-style input, `:` for
 * POSIX) so the helper stays platform-agnostic and unit-testable.
 */
export function mergePathEntries(
  base: string,
  extra: readonly string[],
  caseInsensitive: boolean,
  separator?: string,
): string {
  const sep = separator ?? (base.includes(';') ? ';' : ':');
  const fold = (entry: string) => (caseInsensitive ? entry.toLowerCase() : entry);
  const seen = new Set(base.split(sep).filter(Boolean).map(fold));
  const merged = base.split(sep).filter(Boolean);
  for (const entry of extra) {
    if (!entry || seen.has(fold(entry))) continue;
    seen.add(fold(entry));
    merged.push(entry);
  }
  return merged.join(sep);
}

/** Expand %VAR% references using the given env (variable names are case-insensitive on Windows). */
function expandWindowsVars(value: string, env: NodeJS.ProcessEnv): string {
  // Precomputed once per call (review nit): the .replace callback used to run
  // Object.keys(env).find(...) per %VAR% match — O(vars × matches) on every
  // registry PATH expansion.
  const byLowerName = new Map<string, string>();
  for (const [key, envValue] of Object.entries(env)) {
    if (typeof envValue === 'string') byLowerName.set(key.toLowerCase(), envValue);
  }
  return value.replace(/%([^%]+)%/g, (original, name: string) => byLowerName.get(name.toLowerCase()) ?? original);
}

const REG_QUERY_TIMEOUT_MS = 5_000;

/** Real `reg query` for the user PATH — win32 only; null on any failure. */
function queryWindowsUserPathReal(): Promise<string | null> {
  if (process.platform !== 'win32') return Promise.resolve(null);
  // `new Promise` (not Promise.withResolvers): the extension tsconfig targets ES2022.
  return new Promise<string | null>((resolve) => {
    let output = '';
    // nosemgrep: spawn-shell-true -- fixed command string, no user input
    const child = spawn('reg query "HKCU\\Environment" /v Path', { shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        // already gone
      }
      resolve(null);
    }, REG_QUERY_TIMEOUT_MS);
    timer.unref?.();
    child.stdout?.on('data', (data: Buffer) => {
      output += data.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? output : null);
    });
  });
}

function win32WellKnownDirs(env: NodeJS.ProcessEnv): string[] {
  // path.win32.join: this runs on the user's Windows box, but the unit tests
  // exercise it from POSIX — backslash separators must not depend on the host.
  const dirs: string[] = [];
  const userProfile = env.USERPROFILE;
  if (userProfile) dirs.push(win32path.join(userProfile, '.bun', 'bin'));
  const localAppData = env.LOCALAPPDATA;
  if (localAppData) dirs.push(win32path.join(localAppData, 'Microsoft', 'WinGet', 'Links'));
  return dirs;
}

function unixWellKnownDirs(homeDir: string, env: NodeJS.ProcessEnv): string[] {
  const nvmDir = env.NVM_DIR ?? join(homeDir, '.nvm');
  return [
    join(homeDir, '.bun', 'bin'),
    join(homeDir, '.local', 'bin'),
    join(homeDir, 'bin'),
    join(nvmDir, 'current', 'bin'),
  ];
}

/**
 * The PATH a dev-server child should see: the process PATH merged with fresh
 * post-launch install locations (registry user PATH on win32, well-known
 * per-user bin dirs everywhere). Never throws — worst case it returns the
 * process PATH unchanged.
 */
export async function refreshPathForChild(deps: PathRefreshDeps = {}): Promise<string> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? homedir();
  // Async default (review nit): refreshPathForChild runs on the _runStart
  // path, so the existence probe must not block the extension host on sync fs.
  const dirExists =
    deps.dirExists ??
    (async (path: string) =>
      stat(path).then(
        () => true,
        () => false,
      ));
  const existingDirs = async (dirs: readonly string[]): Promise<string[]> => {
    const kept: string[] = [];
    for (const dir of dirs) {
      if (await dirExists(dir)) kept.push(dir);
    }
    return kept;
  };
  const basePath = env.PATH ?? env.Path ?? '';
  const caseInsensitive = platform !== 'linux';

  try {
    if (platform === 'win32') {
      const query = deps.queryWindowsUserPath ?? queryWindowsUserPathReal;
      const raw = await query();
      const registryPath = raw ? parseWindowsRegistryPath(raw) : null;
      const registryEntries = registryPath ? expandWindowsVars(registryPath, env).split(';').filter(Boolean) : [];
      const wellKnown = await existingDirs(win32WellKnownDirs(env));
      return mergePathEntries(basePath, [...registryEntries, ...wellKnown], caseInsensitive, ';');
    }
    const wellKnown = await existingDirs(unixWellKnownDirs(homeDir, env));
    return mergePathEntries(basePath, wellKnown, caseInsensitive, ':');
  } catch {
    return basePath;
  }
}

/* --------------------------------------------------------------------------
 * Post-install binary-dir resolution (HYP-1169 round 2): WHERE did the tool
 * actually land? Resolved by PROBE — a dir is returned only when the tool's
 * binary file verifiably exists inside it, never by assuming the installer's
 * documented location. Ground truth: Alex's Windows run installed bun via
 * winget (aliases bunx/bun created) yet neither was on the child PATH.
 * ------------------------------------------------------------------------ */

export interface ToolBinaryProbeDeps {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
  /** Sync file-existence probe (defaults to existsSync). */
  fileExists?: (path: string) => boolean;
  queryWindowsUserPath?: () => Promise<string | null>;
}

/** Binary file names a dir must contain (any one) to count as the tool's home. */
const TOOL_BINARY_NAMES: Record<ToolchainTool, readonly string[]> = {
  bun: ['bun', 'bunx'],
  node: ['node'],
  npm: ['npm'],
  pnpm: ['pnpm'],
  yarn: ['yarn'],
};

/** Executable shim extensions on Windows (winget/npm/bun all differ). */
const WIN_BINARY_EXTENSIONS: readonly string[] = ['.exe', '.cmd', '.bat'];

/**
 * A registry user-PATH entry is a candidate only when it newly MENTIONS the
 * tool (e.g. `...\.bun\bin`, `...\nodejs`) — the post-install registry diff
 * is how a winget install becomes visible to a shell started later.
 */
const TOOL_PATH_MENTION: Record<ToolchainTool, RegExp> = {
  bun: /bun/i,
  node: /node/i,
  npm: /node|npm/i,
  pnpm: /pnpm/i,
  yarn: /yarn/i,
};

function win32ToolCandidateDirs(tool: ToolchainTool, env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = [];
  const userProfile = env.USERPROFILE;
  const localAppData = env.LOCALAPPDATA;
  const programFiles = env.ProgramFiles ?? env['ProgramFiles(x86)'];
  if (tool === 'bun' && userProfile) dirs.push(win32path.join(userProfile, '.bun', 'bin'));
  if (tool !== 'bun' && programFiles) {
    // winget OpenJS.NodeJS lands here; corepack shims (pnpm/yarn) live beside node.
    dirs.push(win32path.join(programFiles, 'nodejs'));
  }
  if (tool === 'pnpm' && localAppData) dirs.push(win32path.join(localAppData, 'pnpm'));
  // winget per-user installs drop shim links here (Alex's run: bunx.exe/bun.exe).
  if (localAppData) dirs.push(win32path.join(localAppData, 'Microsoft', 'WinGet', 'Links'));
  return dirs;
}

function unixToolCandidateDirs(tool: ToolchainTool, homeDir: string, platform: NodeJS.Platform): string[] {
  const dirs: string[] = [];
  if (tool === 'bun') dirs.push(join(homeDir, '.bun', 'bin'));
  if (tool === 'pnpm') {
    dirs.push(join(homeDir, '.local', 'share', 'pnpm'));
    if (platform === 'darwin') dirs.push(join(homeDir, 'Library', 'pnpm'));
  }
  if (tool !== 'bun') {
    dirs.push('/usr/local/bin', '/usr/bin');
    if (platform === 'darwin') dirs.push('/opt/homebrew/bin');
  }
  dirs.push(join(homeDir, '.local', 'bin'), join(homeDir, 'bin'));
  return dirs;
}

/**
 * Directories that verifiably contain `tool`'s binary right now, in priority
 * order (well-known install dirs first, then registry user-PATH mentions),
 * deduped. Used after EVERY successful install: the dirs get prepended to the
 * child PATH and the `<tool> --version` verification runs against them.
 * Never throws — worst case it returns [].
 */
export async function probeToolBinaryDirs(tool: ToolchainTool, deps: ToolBinaryProbeDeps = {}): Promise<string[]> {
  const platform = deps.platform ?? process.platform;
  const env = deps.env ?? process.env;
  const homeDir = deps.homeDir ?? homedir();
  const fileExists = deps.fileExists ?? existsSync;
  const names = TOOL_BINARY_NAMES[tool];

  const containsBinary = (dir: string): boolean => {
    if (platform === 'win32') {
      return names.some((name) =>
        WIN_BINARY_EXTENSIONS.some((ext) => fileExists(win32path.join(dir, `${name}${ext}`))),
      );
    }
    return names.some((name) => fileExists(join(dir, name)));
  };

  try {
    const candidates: string[] = [];
    if (platform === 'win32') {
      candidates.push(...win32ToolCandidateDirs(tool, env));
      const query = deps.queryWindowsUserPath ?? queryWindowsUserPathReal;
      const raw = await query();
      const registryPath = raw ? parseWindowsRegistryPath(raw) : null;
      if (registryPath) {
        const mention = TOOL_PATH_MENTION[tool];
        for (const entry of expandWindowsVars(registryPath, env).split(';').filter(Boolean)) {
          if (mention.test(entry)) candidates.push(entry);
        }
      }
    } else {
      candidates.push(...unixToolCandidateDirs(tool, homeDir, platform));
    }
    const seen = new Set<string>();
    const found: string[] = [];
    for (const dir of candidates) {
      const key = platform === 'linux' ? dir : dir.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      if (containsBinary(dir)) found.push(dir);
    }
    return found;
  } catch {
    return [];
  }
}
