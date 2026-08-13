/**
 * @file Shared, hardened Tamagui design-token extraction — statically, no code execution.
 *
 * Accessed via:
 *   - SaaS: Right sidebar > Props editor token autocomplete — GET /api/tamagui/tokens
 *     (`server/routes/getTamaguiTokens.ts` delegates here).
 *   - VS Code extension: the extension host extracts tokens via this same core and pushes
 *     them to the inspector webview (HYP-709). The host injects a Node-backed `TamaguiFsHost`.
 *
 * Assumptions: Tamagui's compiler writes a static `.tamagui/tamagui.config.json` artifact
 *   containing `tamaguiConfig.themes` (color token names) and `tamaguiConfig.tokens.{size,space}`.
 *   If that artifact is absent, we return empty tokens — we NEVER execute the project's
 *   `tamagui.config.*` to compute them (that would be arbitrary host code execution).
 *
 * Security (preserved from HYP-676 / PR #435 — do NOT weaken):
 *   - The project's `tamagui.config.*` is never executed or `require()`d; we only read the
 *     compiled JSON data artifact.
 *   - `isContainedArtifact` rejects symlinked / out-of-tree candidates via realpath
 *     containment + lstat `isFile` (the final component must be a real regular file).
 *   - The synchronous read + JSON.parse is capped at 64 MB so a hostile/pathological
 *     artifact can't OOM or block the event loop.
 *
 * Why filesystem-INJECTED: the security guards rely on synchronous fs primitives
 *   (realpath, lstat, opendir, stat, readFile). The generic async `FileIO` (lib/ast/file-io)
 *   exposes none of them, so this core takes a narrow `TamaguiFsHost` instead. The default
 *   `nodeTamaguiFsHost` wires it to `node:fs`; both realms inject the same Node host.
 */

import { join, resolve, sep } from 'node:path';

export interface TamaguiTokens {
  color: string[];
  size: string[];
  space: string[];
}

/** A single directory entry, mirroring the subset of `fs.Dirent` we use. */
export interface TamaguiDirEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

/**
 * Narrow, synchronous filesystem surface the extraction needs. Synchronous on purpose:
 * the containment guards (realpath/lstat) only have a correct sync form, and the walk is
 * a tight bounded loop. Implementations MUST preserve the security semantics documented
 * on each method.
 */
export interface TamaguiFsHost {
  /**
   * Read directory entries (non-recursive) as a LAZY iterable. Throw if not a directory.
   * Returning an iterable (not an array) preserves the streaming guard from HYP-676: a single
   * massive / hostile directory is read one entry at a time, never materialized, so the global
   * entry budget (`MAX_WALK_ENTRIES`) can abort mid-directory before OOM. The Node host backs
   * this with `opendirSync`.
   */
  readDir(dirPath: string): Iterable<TamaguiDirEntry>;
  /** Read a UTF-8 file fully. */
  readFile(filePath: string): string;
  /** File size in bytes (follows symlinks, like `fs.statSync`). */
  statSize(filePath: string): number;
  /** True iff the path exists and the FINAL component is a regular file (no symlink follow). */
  lstatIsFile(path: string): boolean;
  /** Canonical absolute path with all symlinks resolved (like `fs.realpathSync`). */
  realpath(path: string): string;
  /** True iff the path exists (any type). */
  exists(path: string): boolean;
}

const EMPTY_TOKENS: TamaguiTokens = { color: [], size: [], space: [] };

// Directories that never contain a relevant artifact and would explode the walk.
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.expo']);

// Bound the filesystem walk so a huge / hostile monorepo can't stall the request.
const MAX_WALK_DEPTH = 6;
const MAX_WALK_ENTRIES = 20_000;

// Path fragment (`.tamagui/`) used to recognise compiler-generated artifacts.
const TAMAGUI_DIR_FRAGMENT = `${sep}.tamagui${sep}`;

const ARTIFACT_FILENAME = 'tamagui.config.json';

// Compiled configs are large (a few MB typical; tens of MB for theme-heavy projects) but
// bounded — cap the synchronous read + JSON.parse so a hostile or pathological artifact can't
// OOM / block the event loop. Residual: artifacts above the cap return empty tokens with an
// info message instead of risking the host. This is a token-autocomplete feature, so a
// degraded-but-safe result is the right tradeoff.
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024; // 64 MB

/**
 * Deterministic locations the Tamagui compiler writes its artifact to, in monorepo layouts.
 * Checked first so traversal order can never pick the "wrong" artifact, and so the common
 * case never reads a giant directory listing.
 */
function knownArtifactLocations(projectPath: string, fs: TamaguiFsHost): string[] {
  const locations = [join(projectPath, '.tamagui', ARTIFACT_FILENAME)];
  for (const workspace of ['apps', 'packages']) {
    const base = join(projectPath, workspace);
    // `readDir` is lazy (generator): a missing/non-dir `base` throws on first iteration,
    // not at the call, so the try/catch must wrap the loop. Absent workspace dir → skip.
    try {
      let seen = 0;
      for (const entry of fs.readDir(base)) {
        if (seen++ >= 200) break;
        if (entry.isDirectory()) {
          locations.push(join(base, entry.name, '.tamagui', ARTIFACT_FILENAME));
        }
      }
    } catch {
      // workspace dir absent — skip
    }
  }
  return locations;
}

/**
 * Walk the project tree (no shell, no glob exec) looking for the first file matching
 * `predicate`. Bounded by both depth and a global entry budget. Symlinked directories are
 * not followed (only real `entry.isDirectory()` dirs recurse).
 */
function findFirstFile(root: string, fs: TamaguiFsHost, predicate: (fullPath: string) => boolean): string | null {
  let visited = 0;
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (stack.length > 0) {
    const { dir, depth } = stack.pop()!;
    // `readDir` is lazy (generator) — opendir errors surface during iteration, so the
    // try/catch wraps the loop. An unreadable dir is skipped, matching the prior behaviour.
    try {
      for (const entry of fs.readDir(dir)) {
        if (++visited > MAX_WALK_ENTRIES) return null;

        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!SKIP_DIRS.has(entry.name) && depth < MAX_WALK_DEPTH) {
            stack.push({ dir: full, depth: depth + 1 });
          }
        } else if (entry.isFile() && predicate(full)) {
          return full;
        }
      }
    } catch {
      // unreadable directory — skip
    }
  }

  return null;
}

/**
 * Accept a candidate artifact only if it is a real (non-symlink) regular file whose
 * realpath stays inside the project root. This blocks a hostile project from symlinking
 * `.tamagui/tamagui.config.json` to an arbitrary host file (e.g. `/etc/passwd`) and having
 * the host read + surface its contents. See HYP-676.
 */
function isContainedArtifact(candidate: string, projectRoot: string, fs: TamaguiFsHost): boolean {
  try {
    // Reject the artifact itself being a symlink (lstat does not follow the final component).
    if (!fs.lstatIsFile(candidate)) return false;
    const realRoot = fs.realpath(resolve(projectRoot));
    const realFile = fs.realpath(candidate);
    return realFile === realRoot || realFile.startsWith(realRoot + sep);
  } catch {
    return false;
  }
}

/**
 * Locate Tamagui's compiled config artifact (`.tamagui/tamagui.config.json`).
 * This file is data only — produced by the Tamagui compiler — so reading it is safe.
 * Tries deterministic known locations first (root + monorepo apps/packages), then falls
 * back to a bounded tree walk. Symlinked or out-of-tree candidates are rejected.
 */
export function findTamaguiConfigArtifact(projectPath: string, fs: TamaguiFsHost): string | null {
  for (const candidate of knownArtifactLocations(projectPath, fs)) {
    if (isContainedArtifact(candidate, projectPath, fs)) return candidate;
  }

  return findFirstFile(
    projectPath,
    fs,
    (full) =>
      full.includes(TAMAGUI_DIR_FRAGMENT) &&
      full.endsWith(ARTIFACT_FILENAME) &&
      isContainedArtifact(full, projectPath, fs),
  );
}

/**
 * Detect whether a project uses Tamagui by locating a `tamagui.config.*` source file
 * or a compiled artifact. Pure filesystem walk — never reads or executes file contents.
 */
export function isTamaguiProject(projectPath: string, fs: TamaguiFsHost): boolean {
  // Cheap deterministic checks first.
  if (fs.exists(join(projectPath, ARTIFACT_FILENAME))) return true;
  for (const ext of ['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs']) {
    if (fs.exists(join(projectPath, `tamagui.config.${ext}`))) return true;
  }

  const match = findFirstFile(projectPath, fs, (full) => {
    if (full.includes(TAMAGUI_DIR_FRAGMENT)) return false; // artifacts handled separately
    return /tamagui\.config\.(ts|tsx|js|jsx|mjs|cjs)$/.test(full.toLowerCase());
  });
  return match !== null || findTamaguiConfigArtifact(projectPath, fs) !== null;
}

/**
 * Normalize a token key to Tamagui's `$`-prefixed form.
 */
function dollarKey(key: string): string {
  return key.startsWith('$') ? key : `$${key}`;
}

function objectKeys(record: unknown): string[] {
  if (!record || typeof record !== 'object') return [];
  return Object.keys(record as Record<string, unknown>);
}

/**
 * Pull token names from a parsed Tamagui config artifact. Pure: input is JSON data,
 * no code is evaluated. Tolerant of missing sections.
 *
 * - color tokens: keys of the first theme (each prefixed with `$`).
 * - size / space tokens: each token entry's `.key` (already `$`-prefixed by the compiler),
 *   falling back to the `$`-prefixed token name.
 */
export function extractTamaguiTokensFromArtifact(parsed: unknown): TamaguiTokens {
  if (!parsed || typeof parsed !== 'object') return { ...EMPTY_TOKENS };

  const root = parsed as Record<string, unknown>;
  // The compiler nests the resolved config under `tamaguiConfig`; some artifacts expose it at top level.
  const config = (root.tamaguiConfig ?? root) as Record<string, unknown>;

  const themes = config.themes as Record<string, unknown> | undefined;
  const firstThemeKey = themes ? Object.keys(themes)[0] : undefined;
  const firstTheme = firstThemeKey ? (themes as Record<string, unknown>)[firstThemeKey] : undefined;
  const color = objectKeys(firstTheme).map(dollarKey);

  const tokens = config.tokens as Record<string, unknown> | undefined;

  const tokenCategory = (name: 'size' | 'space'): string[] => {
    const cat = tokens?.[name];
    if (!cat || typeof cat !== 'object') return [];
    return Object.entries(cat as Record<string, unknown>).map(([k, v]) => {
      if (v && typeof v === 'object' && typeof (v as { key?: unknown }).key === 'string') {
        return (v as { key: string }).key;
      }
      return dollarKey(k);
    });
  };

  return {
    color,
    size: tokenCategory('size'),
    space: tokenCategory('space'),
  };
}

/**
 * Read + parse the compiled artifact safely and return its tokens. Returns empty tokens on
 * any failure (missing artifact, malformed JSON, oversize file). NEVER executes project code.
 *
 * This is the single entry point both realms call. `fs` defaults to the Node-backed host so
 * the SaaS server and most callers need not pass one; the ext host injects its own Node host.
 */
export function extractTamaguiTokens(
  projectPath: string,
  fs: TamaguiFsHost = nodeTamaguiFsHost,
): { tokens: TamaguiTokens; info?: string } {
  const artifactPath = findTamaguiConfigArtifact(projectPath, fs);
  if (!artifactPath) {
    return {
      tokens: { ...EMPTY_TOKENS },
      info: 'No compiled .tamagui/tamagui.config.json found. Run the project to generate it.',
    };
  }

  // The Tamagui compiler rewrites the artifact while the dev server starts, so a
  // concurrent read can catch a truncated file (JSON SyntaxError at some mid-file
  // offset). Re-read once before giving up; a persistently malformed artifact still
  // degrades to empty tokens, but neither case is user-actionable, so neither logs
  // at error level (HYP-1173 — an Extension Host console.error here tripped the e2e
  // iframe/diagnostic error gate on every Tamagui project).
  const MAX_READ_ATTEMPTS = 2;
  for (let attempt = 0; attempt < MAX_READ_ATTEMPTS; attempt++) {
    try {
      const size = fs.statSize(artifactPath);
      if (size > MAX_ARTIFACT_BYTES) {
        return { tokens: { ...EMPTY_TOKENS }, info: 'Tamagui config artifact too large to parse.' };
      }
      const raw = fs.readFile(artifactPath);
      const parsed = JSON.parse(raw);
      return { tokens: extractTamaguiTokensFromArtifact(parsed) };
    } catch (error) {
      // Transient mid-write states: truncated JSON (truncate+write) or the file
      // vanishing between discovery and read (unlink+rename rewrite). Both self-heal
      // once the compiler finishes — retry once, then degrade quietly.
      const code = (error as NodeJS.ErrnoException)?.code;
      const transient = error instanceof SyntaxError || code === 'ENOENT' || code === 'EBUSY' || code === 'EPERM';
      if (!transient) {
        console.error('[extractTamaguiTokens] Failed to read/parse artifact:', error);
        return { tokens: { ...EMPTY_TOKENS }, info: 'Failed to parse Tamagui config artifact.' };
      }
    }
  }
  // The race self-healed or the artifact is genuinely corrupt — either way the caller
  // gets the empty-token fallback with an explanatory info string; no console output
  // (the e2e unexpected-console gate counts any console.* as a failure, and this
  // degraded path is expected during compiler rewrites).
  return { tokens: { ...EMPTY_TOKENS }, info: 'Failed to parse Tamagui config artifact.' };
}

/**
 * Node-backed `TamaguiFsHost`. Used by the SaaS server and the VS Code extension host (both
 * run in Node). Defined here, after the consumers, so the security primitives live next to
 * the logic that depends on them.
 */
import { existsSync, lstatSync, opendirSync, readFileSync, realpathSync, statSync } from 'node:fs';

export const nodeTamaguiFsHost: TamaguiFsHost = {
  // Stream entries via opendirSync so a single massive directory is never materialized —
  // the consumer's global entry budget can abort mid-directory. The handle is always closed.
  *readDir(dirPath: string): Generator<TamaguiDirEntry> {
    const handle = opendirSync(dirPath);
    try {
      let entry = handle.readSync();
      while (entry) {
        yield entry;
        entry = handle.readSync();
      }
    } finally {
      handle.closeSync();
    }
  },
  readFile(filePath: string): string {
    return readFileSync(filePath, 'utf-8');
  },
  statSize(filePath: string): number {
    return statSync(filePath).size;
  },
  lstatIsFile(path: string): boolean {
    return lstatSync(path).isFile();
  },
  realpath(path: string): string {
    return realpathSync(path);
  },
  exists(path: string): boolean {
    return existsSync(path);
  },
};
