/**
 * @file Shared directory exclusion lists for project filesystem scanning.
 *
 * Accessed via: VSCodeFileIO.listFiles, ComponentScanner (directory-tree + scanner),
 *   getFileTree route, detectPublicDir, getProjectFiles, content-first i18n grep.
 * Assumptions: entries are bare directory NAMES only (no globs, no path separators).
 *   Consumers match a single path segment against these sets — never a full path.
 */

/**
 * Hard core — skip in ALL scanning contexts.
 * Every consumer that walks a user project must skip these.
 */
export const SCAN_EXCLUDE_CORE: ReadonlySet<string> = new Set(['node_modules', '.git', 'dist', '.next']);

/**
 * Standard build/tooling artifacts — skip in most scanning contexts.
 * Use this for server routes, AI tree generation, file-tree UI, content grep.
 */
export const SCAN_EXCLUDE_DIRS: ReadonlySet<string> = new Set([
  ...SCAN_EXCLUDE_CORE,
  'build',
  'out',
  '.cache',
  '.turbo',
  'coverage',
  '.vscode',
  '.idea',
  '.vercel',
  '.parcel-cache',
  'tmp',
  'temp',
  'logs',
  '__pycache__',
  '.husky',
  '.vite',
]);

/**
 * Extended set for ComponentScanner — adds project-specific runtime dirs
 * (.hyperide, project-preview), static-asset dirs (public, assets), and test
 * dirs that contain no renderable components.
 *
 * NOTE: `public` and `assets` are scanner-only. They must NOT leak into
 * SCAN_EXCLUDE_DIRS — the content-first i18n grep relies on scanning
 * `public/locales/**` (next-i18next), and the file-tree UI shows `public`.
 */
export const SCAN_EXCLUDE_SCANNER: ReadonlySet<string> = new Set([
  ...SCAN_EXCLUDE_DIRS,
  '.remix',
  '.hyperide',
  'project-preview',
  'public',
  'assets',
  '__tests__',
  'test',
  'tests',
]);

/**
 * True when any path segment of `filePath` is in `excludes`.
 *
 * For consumers that enumerate a flat list of absolute/relative paths (e.g. a
 * content grep over `listFiles` output) rather than walking dir-by-dir. Splits on
 * both `/` and `\` so it works for POSIX and Windows paths. Empty segments
 * (leading slash, doubled separators) are ignored.
 */
export function isExcludedScanPath(filePath: string, excludes: ReadonlySet<string> = SCAN_EXCLUDE_DIRS): boolean {
  for (const segment of filePath.split(/[/\\]/)) {
    if (segment && excludes.has(segment)) return true;
  }
  return false;
}
