import { spawnSync } from 'node:child_process';
import { dirname, join, relative } from 'node:path';
import type { FileIO } from '../ast/file-io';

const GIT_EXCLUDE_ENTRIES = [
  '# HyperIDE — generated preview files',
  '__canvas_preview__.tsx',
  '__canvas_preview_standalone__.tsx',
  '__canvas_samples__.tsx',
  '*.samples.tsx',
  '.hyperide/',
  '**/test-preview/',
  '**/test-preview.tsx',
  '**/test-preview.astro',
];

export async function ensureGitExclude(
  io: FileIO,
  projectRoot: string,
  findGitRoot: (dir: string) => Promise<string | null>,
): Promise<void> {
  const gitRoot = await findGitRoot(projectRoot);
  if (!gitRoot) return;

  const excludePath = join(gitRoot, '.git/info/exclude');

  let existing = '';
  try {
    existing = await io.readFile(excludePath);
  } catch {
    // .git/info/exclude may not exist yet — we'll create it
  }

  const toAdd = GIT_EXCLUDE_ENTRIES.filter((line) => !existing.includes(line));
  if (toAdd.length === 0) return;

  const separator = existing && !existing.endsWith('\n') ? '\n' : '';
  try {
    await io.writeFile(excludePath, `${existing}${separator}${toAdd.join('\n')}\n`);
  } catch {
    // .git is a file in linked worktrees — silently skip
  }
}

/**
 * Mark a tracked entry file as skip-worktree so the @hyperide-managed injection
 * no longer pollutes `git status` (HYP-35). The flag is purely local — it is
 * never committed and has no effect on CI or other developers. No-op if the
 * file is not in a git repo, if git is unavailable, or if the flag is already set.
 *
 * Uses a repo-relative path so the path matches what git holds in its index.
 * Precondition: both absoluteFilePath and gitRoot must be in the same symlink
 * resolution form (callers should ensure findGitRoot uses the same base as
 * absoluteFilePath to avoid a mismatch from path.relative).
 */
export function ensureSkipWorktree(absoluteFilePath: string, gitRoot: string): void {
  const relPath = relative(gitRoot, absoluteFilePath);
  spawnSync('git', ['update-index', '--skip-worktree', relPath], {
    cwd: gitRoot,
    stdio: 'ignore',
  });
}

/**
 * Remove the skip-worktree flag added by ensureSkipWorktree after the
 * @hyperide-managed injection is reverted so git tracks the file again.
 *
 * Same path-form precondition as ensureSkipWorktree.
 * Returns whether the `git update-index --no-skip-worktree` call SUCCEEDED (exit 0, no
 * spawn error) so callers can surface a failed clear — a dangling skip-worktree flag is the
 * one failure mode of the HYP-945 crash-revert and must be observable, not silent. A false
 * return is best-effort recoverable (the next revert call retries) but should be logged.
 */
export function clearSkipWorktree(absoluteFilePath: string, gitRoot: string): boolean {
  const relPath = relative(gitRoot, absoluteFilePath);
  const res = spawnSync('git', ['update-index', '--no-skip-worktree', relPath], {
    cwd: gitRoot,
    stdio: 'ignore',
  });
  return !res.error && res.status === 0;
}

/**
 * Every tracked file currently marked skip-worktree, as repo-relative paths (the 'S' tag in
 * `git ls-files -v`). Empty on any git failure. Used by the HYP-945 crash-recovery sweep to
 * find files HyperIDE flagged regardless of entry detection (which can drift, or never covered
 * a custom entry name). The caller marker-gates before reverting, so a user's own skip-worktree
 * flag on an unmarked file is never touched.
 */
export function listSkipWorktreeFiles(gitRoot: string, pathspec?: string): string[] {
  // -z: NUL-separated AND raw (no C-quoting), so non-ASCII / spaced / newlined paths parse
  // correctly — otherwise git C-quotes them (core.quotePath default true) and the file is
  // silently dropped from recovery, exactly the case this sweep is meant to catch.
  // pathspec scopes the listing to a subtree (the active project in a monorepo) — both an
  // OWNERSHIP boundary (never touch a sibling package another instance is previewing) and a
  // perf bound (don't walk the whole monorepo index on every revert).
  const args = ['ls-files', '-v', '-z'];
  if (pathspec) args.push('--', pathspec);
  const res = spawnSync('git', args, { cwd: gitRoot, encoding: 'utf8' });
  if (res.error || res.status !== 0 || typeof res.stdout !== 'string') return [];
  const out: string[] = [];
  for (const entry of res.stdout.split('\0')) {
    if (!entry) continue;
    // Format per entry: "<tag> <path>". 'S' = skip-worktree. The lowercase 's' is accepted
    // defensively (git lowercases tags when the assume-unchanged bit is also set); it is rare
    // and the ownership marker-gate downstream makes accepting it harmless.
    const tag = entry.charAt(0);
    if (tag === 'S' || tag === 's') out.push(entry.slice(2));
  }
  return out;
}

export async function ensureStandaloneEntry(
  io: FileIO,
  projectRoot: string,
  previewPath: string,
  ensureGitExcludeFn: () => Promise<void>,
): Promise<void> {
  const previewDir = dirname(previewPath);
  const standaloneEntryPath = join(previewDir, '__canvas_preview_standalone__.tsx');

  let baseContent: string;
  try {
    baseContent = await io.readFile(previewPath);
  } catch {
    return; // __canvas_preview__.tsx not generated yet
  }

  // Relative path from src/__canvas_preview_standalone__.tsx to .hyperide/preview
  const wrapperImportPath = join(relative(previewDir, projectRoot), '.hyperide/preview').replace(/\\/g, '/');

  // Detect the app's root element ID from index.html. Many projects use 'app-root',
  // 'main', or similar instead of the React default 'root'. Fall back to 'root' if
  // index.html is absent or doesn't contain a recognizable mount point.
  let rootElementId = 'root';
  try {
    const indexHtml = await io.readFile(join(projectRoot, 'index.html'));
    const divMatch = indexHtml.match(/<div\s+id="([^"]+)"/);
    if (divMatch?.[1]) rootElementId = divMatch[1];
  } catch {
    // index.html not present — keep 'root'
  }

  const bootstrap = [
    '',
    '// @hyperide-managed',
    "import { createRoot } from 'react-dom/client';",
    `import { PreviewWrapper } from '${wrapperImportPath}';`,
    '',
    `const _rootEl = document.getElementById('${rootElementId}');`,
    'if (_rootEl) {',
    '  // Reuse root across HMR to avoid calling createRoot on the same container twice.',
    '  // Cast to any so TypeScript in Webpack/Parcel projects (no Vite types) does not error.',
    '  const _hot = (import.meta as any).hot as { data: Record<string, unknown>; accept: () => void } | undefined;',
    '  const _existingRoot = _hot?.data?.root as ReturnType<typeof createRoot> | undefined;',
    '  const _root = _existingRoot ?? createRoot(_rootEl);',
    '  if (_hot) {',
    '    _hot.data.root = _root;',
    '    _hot.accept();',
    '  }',
    '  _root.render(',
    '    <PreviewWrapper>',
    '      <CanvasPreview />',
    '    </PreviewWrapper>',
    '  );',
    '}',
    '',
  ].join('\n');

  const newContent = `${baseContent.trimEnd()}\n${bootstrap}`;

  // Skip write if content is identical — prevents unnecessary HMR full-reload
  // (this file has side effects: createRoot().render(), so Vite always does a
  // full page reload when it changes, killing iframe state).
  try {
    const existing = await io.readFile(standaloneEntryPath);
    if (existing === newContent) return;
  } catch {
    // File doesn't exist yet — proceed with write
  }

  await io.mkdir?.(previewDir);
  await io.writeFile(standaloneEntryPath, newContent);
  // Ensure __canvas_preview_standalone__.tsx is git-excluded for all frameworks.
  await ensureGitExcludeFn();
}
