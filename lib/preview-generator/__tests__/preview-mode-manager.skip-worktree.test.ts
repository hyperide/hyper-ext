/**
 * Real-git integration test for HYP-945 P1: after a crash-window revert of an
 * ENTRY-file patch, the skip-worktree flag patchEntryFile set must be CLEARED, or git
 * silently hides the user's future edits to their own entry file. Uses a real temp git
 * repo + NodeFileIO because the flag lives in git's index (spawnSync git update-index),
 * invisible to the in-memory FileIO used elsewhere.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FileIO } from '../../ast/file-io';
import { NodeFileIO } from '../../ast/node-file-io';
import { PreviewFileManager } from '../preview-file-manager';
import { clearSkipWorktree, listSkipWorktreeFiles } from '../preview-file-ops';
import { looksLikeEntryInjection, PreviewModeManager } from '../preview-mode-manager';

const noopWatcher = () => () => {};
const ENTRY_SOURCE = `import { createRoot } from 'react-dom/client';

createRoot(document.getElementById('root')!).render(<div>app</div>);
`;
const ROUTER_SOURCE = `import { BrowserRouter, Routes, Route } from 'react-router-dom';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </BrowserRouter>
  );
}
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

/** First char of `git ls-files -v` output: 'H' = normal cached, 'S' = skip-worktree. */
function indexTag(repo: string, relPath: string): string {
  return git(repo, 'ls-files', '-v', relPath).trim().charAt(0);
}

const tmpDirs: string[] = [];
afterEach(() => {
  for (const d of tmpDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function initGit(dir: string): void {
  git(dir, 'init', '-q');
  // Isolate from the machine's global hooks portably: point hooksPath at an empty dir
  // inside the repo (avoids /dev/null, which is not portable to Windows CI).
  const emptyHooks = join(dir, '.nohooks');
  mkdirSync(emptyHooks, { recursive: true });
  git(dir, 'config', 'core.hooksPath', emptyHooks);
  git(dir, 'config', 'commit.gpgsign', 'false');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'init', '--no-verify');
}

/** Router-less bun app → entry-file patching (patchEntryFile sets skip-worktree). */
function makeRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hyp945-')));
  tmpDirs.push(dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }));
  writeFileSync(join(dir, 'bun.lock'), '');
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'index.tsx'), ENTRY_SOURCE);
  initGit(dir);
  return dir;
}

/** Vite + react-router app → router patching (patchRouterConfig never sets skip-worktree). */
function makeRouterRepo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hyp945r-')));
  tmpDirs.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ dependencies: { vite: '^5', 'react-router-dom': '^6' } }),
  );
  mkdirSync(join(dir, 'src'), { recursive: true });
  writeFileSync(join(dir, 'src', 'App.tsx'), ROUTER_SOURCE);
  initGit(dir);
  return dir;
}

describe('PreviewModeManager — skip-worktree lifecycle (HYP-945 P1)', () => {
  it('clears the skip-worktree flag AND restores byte-identical after a crash revert', async () => {
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    expect(indexTag(repo, rel)).toBe('H'); // baseline: normally tracked

    const m = new PreviewModeManager({
      projectRoot: repo,
      io: new NodeFileIO(),
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    // Entry patched + skip-worktree set so the injection doesn't pollute git status.
    const entryAbs = join(repo, rel);
    expect(await new NodeFileIO().readFile(entryAbs)).toContain('@hyperide-managed');
    expect(indexTag(repo, rel)).toBe('S');

    // Crash-window revert.
    await m.revertManagedInjections();

    // Flag cleared (git tracks the file again) AND content byte-identical to pre-injection.
    expect(indexTag(repo, rel)).toBe('H');
    expect(await new NodeFileIO().readFile(entryAbs)).toBe(ENTRY_SOURCE);
  });

  it('clears the flag via the AST-revert branch when the user edited on top (marker retained)', async () => {
    // Snapshot restore is skipped (current !== after), so revertEntryFile hits its
    // marker-PRESENT AST-revert branch — which must ALSO clear the flag. Covers the branch
    // the crash-restore test above does not (that one hits the clean branch).
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    const io = new NodeFileIO();
    const m = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    expect(indexTag(repo, rel)).toBe('S');

    // User adds their own top-level statement on top of the live injection (marker stays).
    const injected = await io.readFile(join(repo, rel));
    await io.writeFile(join(repo, rel), `${injected}\nconst _userEdit = 1;\n`);

    await m.revertManagedInjections();

    const result = await io.readFile(join(repo, rel));
    expect(indexTag(repo, rel)).toBe('H'); // AST-revert branch cleared the flag
    expect(result).not.toContain('@hyperide-managed'); // injection stripped
    expect(result).toContain('_userEdit'); // user edit preserved
  });

  it('clears skip-worktree on the ACTUAL patched entry even when entry detection drifts before revert', async () => {
    // Codex review: _restoreSnapshots restores by exact patched path, but the marker-based
    // revert re-detects the entry. If index.html starts pointing at a DIFFERENT entry between
    // patch and revert, the flag on the real patched file would be left dangling unless we
    // clear it by the snapshotted path.
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    const io = new NodeFileIO();
    const m = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected(); // patches + flags src/index.tsx
    expect(indexTag(repo, rel)).toBe('S');

    // Drift the entry detection: index.html now points at a different module entry.
    writeFileSync(join(repo, 'index.html'), '<script type="module" src="/src/main.tsx"></script>\n');
    writeFileSync(join(repo, 'src', 'main.tsx'), ENTRY_SOURCE);
    expect(await m.getEntryFilePath()).toBe(join(repo, 'src', 'main.tsx')); // drift confirmed

    await m.revertManagedInjections();

    // The REAL patched file's flag is cleared despite detection now resolving elsewhere.
    expect(indexTag(repo, rel)).toBe('H');
  });

  it('clears the flag even when the byte-restore write itself fails', async () => {
    // Codex review: clearing skip-worktree must not be gated by a successful restore write.
    // If the restore write throws (disk full, etc.), the injected entry MUST still become
    // visible in git (flag cleared) — a dangling flag over injected content is the worst case.
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    const real = new NodeFileIO();
    let failWrites = false;
    const io: FileIO = {
      readFile: (p) => real.readFile(p),
      writeFile: (p, c) => {
        if (failWrites && p === join(repo, rel)) throw new Error('disk full');
        return real.writeFile(p, c);
      },
      access: (p) => real.access(p),
      deleteFile: (p) => real.deleteFile(p),
      mkdir: (p) => real.mkdir(p),
      listFiles: (p, e) => real.listFiles(p, e),
    };
    const m = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.onComponentSelected();
    expect(indexTag(repo, rel)).toBe('S');

    failWrites = true; // the crash-restore write to the entry will now throw
    await m.revertManagedInjections();

    // Flag cleared despite the failed restore write — so the injection, which is STILL on
    // disk (every write to this file threw), is now VISIBLE in git rather than hidden. That
    // is the intended worst-acceptable outcome: a visible dirty tree beats a silent one.
    expect(indexTag(repo, rel)).toBe('H');
    expect(await new NodeFileIO().readFile(join(repo, rel))).toContain('@hyperide-managed');
  });

  it('clears a dangling flag on cross-process crash recovery with EMPTY in-memory snapshots', async () => {
    // The PRIMARY HYP-945 scenario: a prior process crashed leaving the marker + skip-worktree
    // flag persisted in git, and the new process starts with an EMPTY _patchSnapshots map. The
    // flag must still be cleared — here via revertEntryFile's marker branch, not _restoreSnapshots.
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    const io = new NodeFileIO();

    // Session 1 patches (marker + flag), then hard-crashes: its in-memory snapshots die with it.
    const crashed = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await crashed.onComponentSelected();
    expect(indexTag(repo, rel)).toBe('S');
    expect(await io.readFile(join(repo, rel))).toContain('@hyperide-managed');

    // Session 2: a FRESH manager owns no snapshots — the true cross-process case.
    const fresh = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await fresh.revertManagedInjections();

    expect(indexTag(repo, rel)).toBe('H'); // dangling flag cleared
    expect(await io.readFile(join(repo, rel))).not.toContain('@hyperide-managed'); // injection reverted
  });

  it('clears a dangling flag on cross-process recovery EVEN when entry detection drifted', async () => {
    // The worst HYP-945 case: hard crash (empty snapshots) AND the entry drifted (index.html
    // re-pointed) between crash and restart. The fresh manager scans ALL entry candidates for
    // the marker, so it still finds + clears the flag on the real patched file (src/index.tsx)
    // even though detection now resolves elsewhere (src/main.tsx).
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    const io = new NodeFileIO();

    const s1 = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await s1.onComponentSelected(); // patches src/index.tsx
    expect(indexTag(repo, rel)).toBe('S');

    // Crash + drift: a fresh manager (empty snapshots) and index.html now points elsewhere.
    writeFileSync(join(repo, 'index.html'), '<script type="module" src="/src/main.tsx"></script>\n');
    writeFileSync(join(repo, 'src', 'main.tsx'), ENTRY_SOURCE);
    const s2 = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    expect(await s2.getEntryFilePath()).toBe(join(repo, 'src', 'main.tsx')); // drift confirmed

    await s2.revertManagedInjections();

    expect(indexTag(repo, rel)).toBe('H'); // real patched file's flag cleared despite drift
    expect(await io.readFile(join(repo, rel))).not.toContain('@hyperide-managed'); // injection reverted
  });

  it('clears a dangling flag on cross-process recovery for a CUSTOM-named entry after drift', async () => {
    // The compound Codex flagged: HyperIDE patched a custom html entry (src/frontend.tsx),
    // hard-crashed, then index.html was re-pointed to a different entry before restart. The
    // name-based candidate scan (index/main) misses frontend.tsx, but the git-flagged sweep
    // finds it by its skip-worktree flag + entry-injection signature.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hyp945c-')));
    tmpDirs.push(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }));
    writeFileSync(join(dir, 'bun.lock'), '');
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/src/frontend.tsx"></script>\n');
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'frontend.tsx'), ENTRY_SOURCE);
    initGit(dir);

    const rel = 'src/frontend.tsx';
    const io = new NodeFileIO();
    const s1 = new PreviewModeManager({
      projectRoot: dir,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await s1.onComponentSelected(); // patches the custom entry src/frontend.tsx
    expect(indexTag(dir, rel)).toBe('S');
    expect(await io.readFile(join(dir, rel))).toContain('@hyperide-managed');

    // Crash + drift: fresh manager (empty snapshots), index.html now points elsewhere.
    writeFileSync(join(dir, 'index.html'), '<script type="module" src="/src/main.tsx"></script>\n');
    writeFileSync(join(dir, 'src', 'main.tsx'), ENTRY_SOURCE);
    const s2 = new PreviewModeManager({
      projectRoot: dir,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await s2.revertManagedInjections();

    expect(indexTag(dir, rel)).toBe('H'); // custom entry's dangling flag cleared
    expect(await io.readFile(join(dir, rel))).not.toContain('@hyperide-managed');
  });

  it('real patchEntryFile output satisfies looksLikeEntryInjection (format-coupling guard)', async () => {
    // The layer-3 sweep matches injections by content signature. Pin the writer↔predicate
    // contract: if patchEntryFile ever changes the marker/condition shape, this fails loudly
    // instead of the sweep silently ceasing to find files.
    const repo = makeRepo();
    const io = new NodeFileIO();
    const m = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await m.onComponentSelected();
    const injected = await io.readFile(join(repo, 'src', 'index.tsx'));
    expect(injected).toContain('@hyperide-managed');
    expect(looksLikeEntryInjection(injected)).toBe(true);
  });

  it('sweep is scoped to projectRoot — never touches a sibling package (monorepo isolation)', async () => {
    // Fable review: the git-flagged sweep must not revert/unflag an entry in a SIBLING package
    // that another HyperIDE instance is actively previewing (its live injection passes the
    // content gate). Scoping the listing to projectRoot enforces the ownership boundary.
    const repo = realpathSync(mkdtempSync(join(tmpdir(), 'hyp945m-')));
    tmpDirs.push(repo);
    mkdirSync(join(repo, 'packages', 'a', 'src'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'b', 'src'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'a', 'package.json'), JSON.stringify({ dependencies: { react: '^18' } }));
    writeFileSync(join(repo, 'packages', 'a', 'bun.lock'), '');
    writeFileSync(join(repo, 'packages', 'a', 'src', 'index.tsx'), ENTRY_SOURCE);
    // Package B carries a live, valid entry injection (standalone marker + test-preview guard).
    const bRel = 'packages/b/src/index.tsx';
    writeFileSync(
      join(repo, bRel),
      "// @hyperide-managed\nif (new URLSearchParams(location.search).get('component') && location.pathname.includes('test-preview')) { import('./x'); }\n",
    );
    initGit(repo);
    git(repo, 'update-index', '--skip-worktree', bRel);
    expect(indexTag(repo, bRel)).toBe('S');

    const m = new PreviewModeManager({
      projectRoot: join(repo, 'packages', 'a'),
      io: new NodeFileIO(),
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await m.revertManagedInjections(); // scoped to packages/a

    expect(indexTag(repo, bRel)).toBe('S'); // sibling package B untouched
  });

  it('preserves a user-owned skip-worktree flag on a ROUTER file it patched', async () => {
    // Router patches never set skip-worktree, so a flag on the router file is the user's own
    // and must survive the revert (ownership boundary; Codex review).
    const repo = makeRouterRepo();
    const rel = 'src/App.tsx';
    git(repo, 'update-index', '--skip-worktree', rel); // the user's own local-only flag
    expect(indexTag(repo, rel)).toBe('S');

    const m = new PreviewModeManager({
      projectRoot: repo,
      io: new NodeFileIO(),
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await m.onComponentSelected(); // patches the router (records a snapshot, sets NO flag)
    await m.revertManagedInjections();

    expect(indexTag(repo, rel)).toBe('S'); // user's own flag untouched
  });

  it('does NOT sweep a user-flagged file that merely mentions the marker (no test-preview signature)', async () => {
    // The ownership gate needs BOTH a standalone `// @hyperide-managed` line AND the
    // `test-preview` guard. A user file carrying only the bare marker comment (e.g. a note)
    // must keep its own skip-worktree flag.
    const repo = makeRepo();
    const rel = 'src/notes.tsx';
    writeFileSync(join(repo, 'src', 'notes.tsx'), `// @hyperide-managed\nexport const note = 1;\n`);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'notes', '--no-verify');
    git(repo, 'update-index', '--skip-worktree', rel); // the user's own flag
    expect(indexTag(repo, rel)).toBe('S');

    const m = new PreviewModeManager({
      projectRoot: repo,
      io: new NodeFileIO(),
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await m.revertManagedInjections(); // fresh manager → cross-process sweep runs

    expect(indexTag(repo, rel)).toBe('S'); // user's flag preserved (no test-preview signature)
  });

  it('layer 2 still reverts an OLD-format injection lacking the test-preview signature (back-compat)', async () => {
    // A cross-process injection left by an older extension version (marker present, but not the
    // exact strict signature) must still be reverted + unflagged by layer 2's SOFT gate on a
    // detected entry candidate — the strict layer-3 gate alone would leave it dangling.
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    const io = new NodeFileIO();
    // Simulate a legacy injection: standalone marker, but no `test-preview` guard string.
    await io.writeFile(
      join(repo, rel),
      `// @hyperide-managed\nif (new URLSearchParams(location.search).get('component')) { import('./x'); }\n`,
    );
    // Flag it as a prior session would have.
    git(repo, 'update-index', '--skip-worktree', rel);
    expect(indexTag(repo, rel)).toBe('S');

    const m = new PreviewModeManager({
      projectRoot: repo,
      io,
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });
    await m.revertManagedInjections(); // fresh manager: layer 2 detects the entry candidate

    expect(indexTag(repo, rel)).toBe('H'); // legacy injection's dangling flag cleared
  });

  it('does not false-warn (clearSkipWorktreeFor returns true) for an untracked entry', async () => {
    // A project not yet committed: the entry is untracked, so it was never flagged and there is
    // nothing to clear — clearSkipWorktreeFor must report success, not a spurious failure.
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'hyp945u-')));
    tmpDirs.push(dir);
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'src', 'index.tsx'), ENTRY_SOURCE);
    git(dir, 'init', '-q');
    git(dir, 'config', 'core.hooksPath', join(dir, '.nohooks'));
    mkdirSync(join(dir, '.nohooks'), { recursive: true });
    // NOTE: deliberately NOT committed — src/index.tsx is untracked.

    const fm = new PreviewFileManager({ projectRoot: dir, io: new NodeFileIO() });
    expect(await fm.clearSkipWorktreeFor(join(dir, 'src', 'index.tsx'))).toBe(true);
  });

  it('is a content no-op and leaves the flag clear when nothing was ever patched', async () => {
    // With no snapshot and no marker, revertEntryFile is not called: prove the never-patched
    // entry is untouched — index stays H (never flagged) and content is byte-identical.
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    expect(indexTag(repo, rel)).toBe('H');

    const m = new PreviewModeManager({
      projectRoot: repo,
      io: new NodeFileIO(),
      watcherFactory: noopWatcher,
      waitForPreviewRouteUpdate: mock(() => {}),
    });

    await m.revertManagedInjections();

    expect(indexTag(repo, rel)).toBe('H');
    expect(await new NodeFileIO().readFile(join(repo, rel))).toBe(ENTRY_SOURCE);
  });
});

describe('clearSkipWorktree — observable status (HYP-945 review)', () => {
  it('returns true on a real repo and actually clears the flag', () => {
    const repo = makeRepo();
    const rel = 'src/index.tsx';
    git(repo, 'update-index', '--skip-worktree', rel);
    expect(indexTag(repo, rel)).toBe('S');

    expect(clearSkipWorktree(join(repo, rel), repo)).toBe(true);
    expect(indexTag(repo, rel)).toBe('H');
  });

  it('returns false when the git call fails (so callers can log a dangling flag)', () => {
    // A non-existent git root makes `git update-index` fail — the status must surface, not
    // be swallowed, so _restoreSnapshots' warn is a live path, not dead code.
    expect(clearSkipWorktree('/no/such/file.tsx', '/no/such/git/root')).toBe(false);
  });
});

describe('listSkipWorktreeFiles (HYP-945 review)', () => {
  it('handles non-ASCII / spaced paths (-z, no C-quoting)', () => {
    const repo = makeRepo();
    const weird = 'src/café component.tsx';
    writeFileSync(join(repo, 'src', 'café component.tsx'), ENTRY_SOURCE);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-qm', 'add-weird', '--no-verify');
    git(repo, 'update-index', '--skip-worktree', weird);

    // Old `git ls-files -v` (line-based) would return the C-quoted "src/caf\303\251 …" and drop
    // the file; the -z path returns the raw path so recovery can actually read + revert it.
    expect(listSkipWorktreeFiles(repo)).toContain(weird);
  });
});
