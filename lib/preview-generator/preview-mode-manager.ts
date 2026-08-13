/**
 * @file Orchestrates App Shell ↔ Isolated mode transitions.
 *
 * Accessed via: VS Code extension preview panel — component selected in explorer;
 *               SaaS canvas — component selected, triggers onComponentSelected
 * Assumptions: coalescing guard on _updateMode prevents concurrent transitions
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import fs from 'node:fs';
import { join } from 'node:path';
import type { FileIO } from '../ast/file-io';
import { detectFramework, detectHtmlModuleEntry } from './framework-routing';
import { PreviewFileManager } from './preview-file-manager';

export type PreviewMode = 'app-shell' | 'isolated';

/**
 * Watches projectRoot for .hyperide/preview.tsx create/delete.
 * Calls onChange when the file appears or disappears.
 * Returns a dispose function to stop watching.
 *
 * Extension: use fsWatchFactory (node:fs, debounce 200ms)
 * SaaS:      use chokidarWatchFactory (awaitWriteFinish, handles NFS/Docker volumes)
 */
export type WatcherFactory = (projectRoot: string, onChange: () => void) => () => void;

export interface PreviewModeManagerOptions {
  projectRoot: string;
  io: FileIO;
  /** Called when mode changes — PreviewProxy uses this to toggle HTML script swap. */
  onModeChange?: (isolated: boolean) => void;
  /**
   * Injectable watcher factory. Defaults to fsWatchFactory.
   * Pass chokidarWatchFactory on SaaS (handles Docker volumes reliably).
   */
  watcherFactory?: WatcherFactory;
  /**
   * Called BEFORE a preview route or entry file write that requires dev-server HMR.
   * Wire this to `DevServerManager.armRecompileGate()` so the iframe doesn't
   * race the dev-server update and navigate to stale routing state.
   */
  onBeforeWebpackEntryPatch?: () => void;
  /**
   * Called after Vite SPA router/entry patches. Vite often applies HMR without a
   * reliable stdout marker, so extension-side navigation waits on this short barrier
   * instead of arming the long recompile gate.
   */
  waitForPreviewRouteUpdate?: () => Promise<void> | void;
}

const DEFAULT_PREVIEW_ROUTE_UPDATE_DELAY_MS = 4000;

/**
 * True when `content` looks like one of OUR ENTRY injections — used by the crash-recovery
 * sweep to decide, from content alone (no durable provenance record), whether a skip-worktree
 * file was patched by HyperIDE. Two independent signals BOTH required to minimise a
 * false-positive that would mutate + unflag a user file:
 *   1. a STANDALONE `// @hyperide-managed` line — patchEntryFile writes the marker as a leading
 *      line-comment above the conditional import; a ROUTER patch instead puts it as a TRAILING
 *      comment on an import line, so a user's own flag on a router file is never swept; AND
 *   2. the `test-preview` route guard the entry injection always emits — a bare marker comment
 *      alone (e.g. a user's note) does not qualify.
 * This is a heuristic, not provenance; the residual false-positive (a user file that reproduces
 * BOTH signals) is an accepted compromise vs. a durable flagged-path record (HYP-945 review).
 */
export function looksLikeEntryInjection(content: string): boolean {
  const hasStandaloneMarker = content.split('\n').some((line) => line.trim() === '// @hyperide-managed');
  return hasStandaloneMarker && content.includes('test-preview');
}

/** Default: node:fs.watch with debounce. Suitable for local extension use. */
function fsWatchFactory(projectRoot: string, onChange: () => void): () => void {
  const hyperideDir = join(projectRoot, '.hyperide');

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounced = (): void => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(onChange, 200);
  };

  let hyperideWatcher: ReturnType<typeof fs.watch> | null = null;

  const attachHyperideWatcher = (): void => {
    if (hyperideWatcher) return;
    try {
      hyperideWatcher = fs.watch(hyperideDir, (_event: string, filename: string | null) => {
        if (filename === 'preview.tsx' || filename === 'preview.ts') debounced();
      });
      hyperideWatcher.on('error', () => {
        hyperideWatcher = null; // Directory removed — re-attach on next root event
      });
    } catch {
      // .hyperide doesn't exist yet
    }
  };

  const rootWatcher = fs.watch(projectRoot, (_event: string, filename: string | null) => {
    if (filename === '.hyperide') {
      debounced();
      attachHyperideWatcher(); // Re-attach watcher when .hyperide dir appears
    }
  });
  rootWatcher.on('error', (err: Error) => {
    console.error('[ModeManager] Root watcher error:', err.message);
  });

  attachHyperideWatcher(); // Try immediately (may already exist)

  return () => {
    rootWatcher.close();
    hyperideWatcher?.close();
    if (debounceTimer) clearTimeout(debounceTimer);
  };
}

export class PreviewModeManager {
  private _mode: PreviewMode = 'app-shell';
  private _fileManager: PreviewFileManager;
  private readonly _projectRoot: string;
  private readonly _io: FileIO;
  private readonly _onModeChange?: (isolated: boolean) => void;
  private readonly _watcherFactory: WatcherFactory;
  private readonly _onBeforeWebpackEntryPatch?: () => void;
  private readonly _waitForPreviewRouteUpdate: () => Promise<void> | void;

  private _watcherDispose: (() => void) | null = null;
  private _modeUpdateInProgress = false;
  private _modeUpdatePending = false;

  /**
   * Byte snapshots of the target app's own tracked source files this manager has an
   * OUTSTANDING @hyperide-managed patch on (router file's /test-preview <Route> +
   * import, or an entry file's conditional-import wrapper). Each entry keeps BOTH the
   * pristine pre-injection `before` and the exact `after` we wrote.
   *
   * This is the "capture `contentBeforeWrite`" mechanism (mirrors AstService's snapshot
   * pattern) that lets {@link revertManagedInjections} restore a file BYTE-IDENTICAL to
   * pre-injection on a crash. `after` is the safety interlock: the byte-restore fires
   * ONLY when the file on disk is still exactly what we wrote — if the user edited on
   * top of the injection, or already removed our marker (git discard), the restore is
   * skipped so we never clobber their work or resurrect stale bytes; the surgical AST
   * revert handles those. The AST revert is also the backstop for a hard process kill
   * where this in-memory map is gone (HYP-945).
   *
   * `skipWorktreeManaged` records whether HyperIDE set a git skip-worktree flag on this
   * file when patching it — true for ENTRY patches (patchEntryFile calls _skipWorktreeEntry),
   * false for ROUTER patches (patchRouterConfig never flags). Only a managed flag may be
   * cleared on revert; a user's own skip-worktree flag on a router file is left alone.
   */
  private readonly _patchSnapshots = new Map<
    string,
    { before: string; after: string; skipWorktreeManaged: boolean }
  >();

  constructor({
    projectRoot,
    io,
    onModeChange,
    watcherFactory,
    onBeforeWebpackEntryPatch,
    waitForPreviewRouteUpdate,
  }: PreviewModeManagerOptions) {
    this._projectRoot = projectRoot;
    this._io = io;
    this._onModeChange = onModeChange;
    this._watcherFactory = watcherFactory ?? fsWatchFactory;
    this._onBeforeWebpackEntryPatch = onBeforeWebpackEntryPatch;
    this._waitForPreviewRouteUpdate =
      waitForPreviewRouteUpdate ??
      (() => new Promise((resolve) => setTimeout(resolve, DEFAULT_PREVIEW_ROUTE_UPDATE_DELAY_MS)));
    this._fileManager = new PreviewFileManager({ projectRoot, io });
  }

  get mode(): PreviewMode {
    return this._mode;
  }

  startWatching(): void {
    this._watcherDispose = this._watcherFactory(this._projectRoot, () => {
      void this._updateMode();
    });
    void this._updateMode();
  }

  stopWatching(): void {
    this._watcherDispose?.();
    this._watcherDispose = null;
  }

  /** Called when a component is selected in the explorer. */
  async onComponentSelected(): Promise<'ok' | 'unsupported' | 'needs-patch'> {
    if (this._mode === 'isolated') {
      // Isolated mode: no routing changes, but standalone entry must stay in sync
      await this._fileManager.ensureStandaloneEntry();
      return 'ok';
    }

    const detection = await detectFramework(this._projectRoot, this._io);
    const { framework } = detection;

    switch (framework) {
      case 'nextjs-app-router':
      case 'nextjs-pages-router':
      case 'remix':
      case 'astro':
      case 'vite-spa-file-based': {
        // ensurePreviewFiles() is idempotent — returns 'ok-files-written' only when
        // route files are freshly created or updated. ALL of these file-routed
        // frameworks use the short route-update barrier (not the webpack recompile
        // gate) because none emits a reliable webpack-style "compiled successfully"
        // stdout marker after a route file is written: Vite/Remix/Astro apply route
        // changes via HMR with no stable marker, and Next (15+) defaults to Turbopack,
        // which compiles routes lazily (on first request) and writes NO compile marker
        // on the route-file write — only a per-request access log ("GET /test-preview
        // 200 in Nms"). Arming the recompile gate for Next made the extension's
        // awaitRecompile() block until its full timeout, so navigation to /test-preview
        // never fired and the preview never materialized (GitHub #81, nextjs-tw-sample:
        // hasPreviewAppFrame=false through every recovery cycle). The route itself
        // serves 200 on first hit, so the barrier + the proxy's /test-preview retry
        // budget is the correct wait. The decision is intentionally version-agnostic:
        // older webpack-era Next merely gets a slightly shorter wait than it strictly
        // needs, which is harmless.
        // On 2nd+ selections the same files already exist (content identical) →
        // _writeIfSafe skips writing → 'ok' returned → barrier is a no-op.
        const fileResult = await this._fileManager.ensurePreviewFiles();
        if (fileResult === 'ok-files-written') {
          await this._waitForPreviewRouteUpdate();
        }
        return fileResult === 'ok-files-written' ? 'ok' : fileResult;
      }
      case 'vite-spa-jsx-router':
      case 'bun': {
        // Bun apps are assumed router-less by default (framework-routing.ts), but that's a
        // classification default, not a guarantee — a Bun-classified app (e.g. a CMS with its
        // own React Router) still gets real router-aware patching when one is actually found,
        // exactly like vite-spa-jsx-router. Only a genuinely router-less app falls through to
        // entry-file patching below.
        const routerFile = await this.detectRouterFile();
        if (routerFile && (await this._tryPatchRouterFile(routerFile))) {
          // We patched the router. If a PRIOR data-router selection had fallen back to entry-file
          // patching (e.g. the user just converted createBrowserRouter([...]) into a literal
          // <Routes>), that entry patch is now stale and still severs the routed app shell — drop
          // it so the two strategies never stay managed at once (HYP-934 review). _applyPatchIfNeeded
          // does not need this: it pre-reverts both patches before repatching.
          // That revert is a LATER entry-file write than the router patch, so wait for HMR to
          // settle it before the extension navigates — the router patch's own barrier already
          // fired inside _tryPatchRouterFile but no longer covers this final write.
          if (await this._revertEntryPatchIfPresent()) await this._waitForPreviewRouteUpdate();
          return 'ok';
        }
        // No JSX router found, OR a matched router file that patchRouterConfig could not patch
        // (a react-router v6.4+ data router: createBrowserRouter([...]) + <RouterProvider>, no
        // literal <Routes> — HYP-934). Fall back to entry-file patching. First drop any stale
        // router patch from a prior JSX-<Routes> selection so both strategies never stay managed
        // at once, then wait for HMR before navigation instead of reporting a false success.
        await this._revertJsxPatchIfPresent();
        return this._patchEntryFile({ armRecompileGate: false, waitForPreviewRouteUpdate: true });
      }
      case 'webpack':
        return this._patchEntryFile();
      case 'parcel':
        return this._patchEntryFile();
      case 'unknown':
        return 'unsupported';
      default: {
        const r = await this._fileManager.ensurePreviewFiles();
        return r === 'ok-files-written' ? 'ok' : r;
      }
    }
  }

  /** Called by FSWatch when .hyperide/preview.tsx appears. */
  async onWrapperCreated(): Promise<void> {
    await this._revertJsxPatchIfPresent();
    await this._revertEntryPatchIfPresent();

    const detection = await detectFramework(this._projectRoot, this._io);
    const { framework } = detection;

    if (framework === 'nextjs-app-router' || framework === 'nextjs-pages-router') {
      // Tier 3: reuse file-based routing, but layout.tsx imports PreviewWrapper.
      // Cleanup first — _writeIfSafe skips existing @hyperide-managed files, so the
      // blank App Shell layout must be removed before the isolated layout can be written.
      await this._fileManager.cleanupPreviewFiles();
      await this._fileManager.ensureIsolatedNextJsLayout(detection);
    } else if (framework === 'astro') {
      // Astro does NOT support Isolated mode (HYP-466). Two things matter here:
      //   1. Do NOT cleanupPreviewFiles — Astro 404s a deleted route (no SPA fallback,
      //      unlike the Tier-1 proxy-script-swap frameworks below), leaving the proxy with
      //      no HTML entry. ensurePreviewFiles is idempotent — re-asserts the route, no delete.
      //   2. Do NOT transition to isolated mode / fire onModeChange(true). The proxy's
      //      Tier-1 script swap is gated solely on isolated mode and would rewrite the first
      //      module script on /test-preview to __canvas_preview_standalone__.tsx — which
      //      doesn't exist for Astro and would clobber the island's runtime script. Staying
      //      in app-shell keeps the route rendering correctly.
      //
      // LIMITATION: the user's PreviewWrapper from .hyperide/preview.tsx is NOT applied in
      // Astro previews. Full isolated support needs PreviewProxy taught to skip its
      // script-swap for Astro (route-based isolation, not proxy-swap). Deferred — NEEDS LINEAR.
      await this._fileManager.ensurePreviewFiles();
      return; // stay in app-shell — do not fall through to _mode='isolated' / onModeChange(true)
    } else if (framework === 'webpack') {
      // Tier 2: patch entry to load standalone entry (which has createRoot + PreviewWrapper)
      await this._fileManager.ensureStandaloneEntry();
      const entryFile = await this._detectEntryFile();
      if (entryFile) await this._applyEntryPatch(entryFile, './__canvas_preview_standalone__');
    } else {
      // Tier 1: proxy script swap (Vite, Parcel, Remix, file-based Vite SPA)
      await this._fileManager.cleanupPreviewFiles();
      await this._fileManager.ensureStandaloneEntry();
    }

    this._mode = 'isolated';
    this._onModeChange?.(true);
  }

  /** Called by FSWatch when .hyperide/preview.tsx is deleted. */
  async onWrapperDeleted(): Promise<void> {
    // Revert any entry/router patches from isolated mode before re-applying App Shell patches.
    // Without this, _applyPatchIfNeeded() skips re-patching because @hyperide-managed is present.
    await this._revertJsxPatchIfPresent();
    await this._revertEntryPatchIfPresent();
    // Cleanup isolated files first — necessary for Tier 3 (Next.js) where layout.tsx
    // imported PreviewWrapper and must be replaced with a blank layout.
    // _writeIfSafe is idempotent and won't overwrite existing files, so cleanup is required.
    await this._fileManager.cleanupPreviewFiles();
    await this._fileManager.ensurePreviewFiles();
    await this._applyPatchIfNeeded();
    this._mode = 'app-shell';
    this._onModeChange?.(false);
  }

  /**
   * Detect the frontend root directory ('src', 'client', etc.) from index.html.
   * Falls back to 'src' if index.html is absent or doesn't specify a different root.
   */
  private async _detectFrontendRoot(): Promise<string> {
    try {
      const html = await this._io.readFile(join(this._projectRoot, 'index.html'));
      // HTML tag names are case-insensitive — match `<SCRIPT>`/`<Script>` too
      // (CodeQL js/bad-tag-filter). Regex HTML parsing is a smell; this is a
      // best-effort entry-script sniff over project HTML, not a sanitizer.
      for (const tag of html.matchAll(/<script\b[^>]*>/gi)) {
        if (!/\btype=["']module["']/i.test(tag[0])) continue;
        const src = tag[0].match(/\bsrc=["']\/([^/"']+)\/main\.[jt]sx?["']/i)?.[1];
        if (src && src !== 'src') return src;
      }
    } catch {
      /* no index.html */
    }
    return 'src';
  }

  async getEntryFilePath(): Promise<string | null> {
    return this._detectEntryFile();
  }

  /** Override in tests to inject a known router file path. */
  async detectRouterFile(): Promise<string | null> {
    const frontendRoot = await this._detectFrontendRoot();
    // Check the detected frontend root first, then fall back to src/
    const rootPrefixes = frontendRoot !== 'src' ? [frontendRoot, 'src'] : ['src'];
    const suffixes = [
      'App.tsx',
      'app.tsx',
      'main.tsx',
      'main.ts',
      'router.tsx',
      'router.ts',
      'routes.tsx',
      'routes.ts',
    ];
    const candidates = [...rootPrefixes.flatMap((r) => suffixes.map((s) => `${r}/${s}`)), 'App.tsx'];
    for (const rel of candidates) {
      const abs = join(this._projectRoot, rel);
      try {
        const content = await this._io.readFile(abs);
        if (
          content.includes('<Routes>') ||
          content.includes('<BrowserRouter>') ||
          content.includes('createBrowserRouter') ||
          content.includes('createHashRouter') ||
          content.includes('createMemoryRouter')
        )
          return abs;
      } catch {
        /* not found */
      }
    }
    return null;
  }

  private async _detectEntryFile(): Promise<string | null> {
    const candidates = await this._detectEntryCandidates();
    return candidates[0] ?? null;
  }

  /**
   * Every existing entry-file candidate (html-module entry first, then the static
   * index/main candidates under the frontend root + src/), deduped. `_detectEntryFile`
   * returns the first; the crash-revert sweep scans them ALL so a cross-process recovery
   * still finds a marker on a file the entry detection has since DRIFTED away from
   * (index.html re-pointed between the crashed patch and this restart) — HYP-945 review.
   */
  private async _detectEntryCandidates(): Promise<string[]> {
    const found: string[] = [];
    const push = (abs: string): void => {
      if (!found.includes(abs)) found.push(abs);
    };

    // _detectHtmlEntryFile returns an ABSOLUTE path (detectHtmlModuleEntry joins projectRoot),
    // which the dedup below and readFile in the revert loop both rely on.
    const htmlEntry = await this._detectHtmlEntryFile();
    if (htmlEntry) push(htmlEntry);

    const frontendRoot = await this._detectFrontendRoot();
    const rootPrefixes = frontendRoot !== 'src' ? [frontendRoot, 'src'] : ['src'];
    const suffixes = ['index.tsx', 'index.ts', 'main.tsx', 'main.ts'];
    for (const rel of rootPrefixes.flatMap((r) => suffixes.map((s) => `${r}/${s}`))) {
      const abs = join(this._projectRoot, rel);
      try {
        await this._io.readFile(abs);
        push(abs);
      } catch {
        /* not found */
      }
    }
    return found;
  }

  private async _detectHtmlEntryFile(): Promise<string | null> {
    // Delegates to the shared probe in framework-routing so the SPA entry patcher and the
    // Bun-app classifier use exactly one candidate list + module-script heuristic (HYP-885).
    return detectHtmlModuleEntry(this._projectRoot, this._io);
  }

  private async _patchEntryFile(options?: {
    armRecompileGate?: boolean;
    waitForPreviewRouteUpdate?: boolean;
  }): Promise<'ok' | 'needs-patch'> {
    const entryFile = await this._detectEntryFile();
    if (!entryFile) return 'needs-patch';
    const onBeforeWrite = options?.armRecompileGate === false ? undefined : this._onBeforeWebpackEntryPatch;
    const wrote = await this._applyEntryPatch(entryFile, './__canvas_preview__', onBeforeWrite);
    if (wrote && options?.waitForPreviewRouteUpdate) await this._waitForPreviewRouteUpdate();
    return 'ok';
  }

  /** Coalescing guard: re-runs after current execution if state changed mid-flight. */
  private async _updateMode(): Promise<void> {
    if (this._modeUpdateInProgress) {
      this._modeUpdatePending = true;
      return;
    }
    this._modeUpdateInProgress = true;
    try {
      const wrapperPath = join(this._projectRoot, '.hyperide/preview.tsx');
      try {
        await this._io.access(wrapperPath);
        const wasIsolated = this._mode === 'isolated';
        if (!wasIsolated) await this.onWrapperCreated();
      } catch {
        const wasAppShell = this._mode === 'app-shell';
        if (!wasAppShell) await this.onWrapperDeleted();
      }
    } finally {
      this._modeUpdateInProgress = false;
      if (this._modeUpdatePending) {
        this._modeUpdatePending = false;
        void this._updateMode();
      }
    }
  }

  /**
   * Definitive cross-process crash-recovery: scan git's ACTUAL skip-worktree set and revert
   * every file bearing an ENTRY injection, regardless of entry detection. This closes the
   * custom-entry-drift hole the name-based candidate scan cannot (a patched `src/bootstrap.tsx`
   * whose index.html was re-pointed before restart) — it reads git's index, not detection or
   * the in-memory snapshots a hard crash destroys.
   *
   * Ownership-safe by construction: because it scans EVERY skip-worktree file under the
   * project (not a known entry-candidate set), it reverts ONLY files matching the STRICT
   * {@link looksLikeEntryInjection} (a standalone `// @hyperide-managed` line AND the
   * `test-preview` guard). A ROUTER patch's marker is a trailing import comment, so a router
   * file the USER flagged skip-worktree (we never flag routers) is skipped, preserving the
   * user's own flag — as is any unrelated user-flagged file. (Layers 1–2 operate on files we
   * own / a small entry-candidate set, so they can afford a softer gate; this layer cannot.)
   */
  private async _sweepFlaggedEntryInjections(): Promise<void> {
    let flagged: string[];
    try {
      flagged = await this._fileManager.listSkipWorktreePathsInProject();
    } catch {
      return; // not in git / git unavailable — nothing to sweep
    }
    for (const abs of flagged) {
      try {
        const content = await this._io.readFile(abs);
        if (looksLikeEntryInjection(content)) await this._fileManager.revertEntryFile(abs);
      } catch {
        /* unreadable — skip */
      }
    }
  }

  private async _revertJsxPatchIfPresent(): Promise<void> {
    const routerFile = await this.detectRouterFile();
    if (!routerFile) return;
    try {
      const content = await this._io.readFile(routerFile);
      if (content.includes('@hyperide-managed')) await this._fileManager.revertRouterPatch(routerFile);
    } catch {
      /* not accessible */
    } finally {
      this._patchSnapshots.delete(routerFile);
    }
  }

  /** @returns true when a managed entry patch was actually reverted (a file write happened). */
  private async _revertEntryPatchIfPresent(): Promise<boolean> {
    // Scan EVERY entry candidate, not just the currently-detected one. revertEntryFile is
    // called ONLY when OUR marker is present — it AST-reverts the injection AND clears the
    // skip-worktree flag on that file. The marker gate keeps us off any entry we never
    // patched (preserving a user's own flag), while scanning all candidates handles the
    // CROSS-PROCESS crash-recovery worst case: after a hard kill the in-memory snapshots are
    // gone AND the entry may have drifted (index.html re-pointed), so the real patched file
    // is no longer the detected entry — but it still carries the marker, so this finds and
    // clears its dangling flag regardless of drift. (Same-process reverts clear the flag
    // earlier, by exact path, in _restoreSnapshots.) HYP-945 review.
    const candidates = await this._detectEntryCandidates();
    let reverted = false;
    for (const entryFile of candidates) {
      try {
        const content = await this._io.readFile(entryFile);
        // SOFT gate here (marker substring), deliberately unlike the layer-3 sweep's strict
        // looksLikeEntryInjection. Layer 2 only visits detected ENTRY candidates (index/main +
        // the html entry) — a small, already-entry-limited set — so the false-positive risk is
        // low, and the soft gate stays BACKWARD-COMPATIBLE: an injection left by an OLDER
        // extension version (or a user-nudged marker) that lacks the exact `test-preview`
        // signature is still reverted here, closing the dangling flag the strict gate would
        // miss. The strict gate is reserved for layer 3, which scans arbitrary flagged files
        // where ownership must be proven from content. HYP-945 review (Opus).
        if (content.includes('@hyperide-managed')) {
          await this._fileManager.revertEntryFile(entryFile);
          reverted = true; // main's HYP-934 caller waits for HMR only when a stale patch was dropped
        }
      } catch {
        /* not accessible */
      } finally {
        // NOT dead code: this method is also called from onWrapperCreated/onWrapperDeleted
        // (mode transitions) WITHOUT _restoreSnapshots running first (which would clear the
        // whole map), so the per-entry delete is load-bearing there.
        this._patchSnapshots.delete(entryFile);
      }
    }
    return reverted;
  }

  // NOTE (HYP-945): every patch to the target app's own source MUST route through one of the
  // snapshotting wrappers — _tryPatchRouterFile (router) and _applyEntryPatch (entry) — they are
  // the sole capture point for the crash-revert snapshot. A direct
  // `this._fileManager.patchRouterConfig()/patchEntryFile()` call would silently skip
  // snapshotting and leave that injection unrecoverable on crash. (The snapshot lives here, not
  // in PreviewFileManager, to keep the shared file manager's SaaS behavior untouched; the file
  // manager only emits the bytes it wrote.)

  /**
   * Route an entry-file patch through a before/after snapshot so a later crash can restore the
   * target's own source byte-identical. `after` is the authoritative bytes the file manager
   * wrote (not a re-read), closing the TOCTOU where a concurrent edit could poison the interlock.
   */
  private async _applyEntryPatch(
    entryFile: string,
    importTarget: string,
    onBeforeWrite?: () => void,
  ): Promise<boolean> {
    const before = await this._readPristineBaseline(entryFile);
    let after: string | undefined;
    const wrote = await this._fileManager.patchEntryFile(entryFile, importTarget, onBeforeWrite, (w) => {
      after = w;
    });
    if (wrote && before !== null && after !== undefined) {
      // Entry patches set skip-worktree (patchEntryFile → _skipWorktreeEntry) — so the flag
      // is HyperIDE-managed and cleared on revert. NOTE (by design): if the user had ALREADY
      // set skip-worktree on their entry before we patched, revert still clears it — we do not
      // capture the prior index state. This matches revertEntryFile's long-standing behavior;
      // preserving a user's pre-existing flag on the ENTRY is a deferred nicety. (Router files
      // are protected via skipWorktreeManaged:false since we never flag them.)
      this._patchSnapshots.set(entryFile, { before, after, skipWorktreeManaged: true });
    }
    return wrote;
  }

  /**
   * The pristine, pre-injection bytes to snapshot, or null when there is no clean
   * baseline to capture: the file already carries our marker (a re-patch no-op, or a
   * baseline we already hold), or it is unreadable. Never records injected content as
   * the "original".
   */
  private async _readPristineBaseline(filePath: string): Promise<string | null> {
    if (this._patchSnapshots.has(filePath)) return null; // keep the earliest pristine baseline
    try {
      const content = await this._io.readFile(filePath);
      return content.includes('@hyperide-managed') ? null : content;
    } catch {
      return null;
    }
  }

  /**
   * Best-effort revert of EVERY @hyperide-managed injection this manager may have
   * applied to the target app's own tracked source. One contract for two callers —
   * leave the user's working tree byte-identical to pre-injection (HYP-945):
   *   - Teardown (extension deactivate / workspace reroot): revert before the host
   *     drops the session so a graceful close never leaves the client repo dirty.
   *   - Startup sweep (fresh activation): a marker still on disk with NO snapshot is
   *     stale from a prior session that crashed between patch-injection and the
   *     canvas-preview swap; no live session owns it, so revert it. This is the
   *     backstop for a hard crash/kill where no teardown revert ran.
   *
   * Snapshot restore (byte-identical) is preferred; the AST-based revert runs after
   * as the no-snapshot fallback. Never throws — a revert failure must not break
   * activation or deactivation.
   *
   * Layers, in order (order is load-bearing — do not reorder):
   *   1. _restoreSnapshots — same-process: byte-restore + clear the flag by the EXACT patched
   *      path (drift-proof), for files this live manager patched.
   *   2. _revertJsxPatchIfPresent / _revertEntryPatchIfPresent — detection-based revert of the
   *      injection CONTENT (router + entry candidates), incl. the cross-process no-snapshot case.
   *   3. _sweepFlaggedEntryInjections — definitive cross-process flag recovery: reverts every
   *      git-flagged file bearing the entry-injection signature, closing custom-entry-name drift
   *      that (2)'s name-based candidates miss. Ownership-safe (standalone-marker gate).
   *
   * The only accepted residual is by design (see _applyEntryPatch): a user's PRE-EXISTING
   * skip-worktree flag on an ENTRY file HyperIDE then patches is not preserved on revert.
   */
  async revertManagedInjections(): Promise<void> {
    try {
      await this._restoreSnapshots();
      await this._revertJsxPatchIfPresent();
      await this._revertEntryPatchIfPresent();
      // Layer 3: cross-process recovery for a stale flag from a prior crashed session (custom /
      // drifted entry the name-based candidates miss). Always runs — the git listing is scoped
      // to projectRoot (listSkipWorktreePathsInProject), so it stays cheap even in a monorepo,
      // and unconditional means a stale flag is caught regardless of whether THIS manager also
      // patched something this session (no reliance on call-order invariants). HYP-945 review.
      await this._sweepFlaggedEntryInjections();
    } catch (err) {
      console.warn('[ModeManager] revertManagedInjections (best-effort) failed:', err);
    }
  }

  /**
   * Restore every snapshotted file to its pristine pre-injection bytes — but ONLY when
   * the file on disk is still EXACTLY the injection we wrote (`current === after`),
   * i.e. untouched since. If the user edited on top of the injection, or already
   * removed our marker (git discard), the byte-restore is skipped so we never clobber
   * their work or resurrect stale bytes; the AST revert that runs afterward strips just
   * our lines and preserves the user's edits. Then drop the snapshots.
   */
  private async _restoreSnapshots(): Promise<void> {
    for (const [filePath, snap] of this._patchSnapshots) {
      try {
        const current = await this._io.readFile(filePath).catch(() => null);
        if (current !== null && current === snap.after && current !== snap.before) {
          await this._io.writeFile(filePath, snap.before);
        }
      } catch {
        /* best-effort restore — a failure on one must not block the others */
      } finally {
        // Clear skip-worktree on the EXACT patched path when the flag is HyperIDE-managed
        // (entry patches only), ALWAYS — even if the byte-restore above threw, because that
        // is precisely the file whose flag must not be left set (git would then silently
        // hide the user's future edits). By the exact snapshotted path, never the re-detected
        // entry, which can drift (index.html re-pointed between patch and revert). Skipped
        // for router snapshots so a user's own flag on a router file is preserved. This is
        // the flag-clear for the SAME-process crash path; the cross-process no-snapshot case
        // is handled by revertEntryFile (marker branch) in _revertEntryPatchIfPresent below
        // (HYP-945 review).
        if (snap.skipWorktreeManaged) {
          // A failed clear is the one failure mode of this fix (dangling flag) — never
          // swallow it silently, or the next HYP-945 incident is indistinguishable from
          // "the fix didn't run". clearSkipWorktreeFor reports git failure via its return.
          // (A benign false-negative is possible for an UNTRACKED entry — a project not yet
          // committed: git can't have flagged it, so there was no dangling flag to begin with.)
          // Best-effort per file still (don't block the others).
          const cleared = await this._fileManager.clearSkipWorktreeFor(filePath).catch(() => false);
          if (!cleared) console.warn('[ModeManager] failed to clear skip-worktree flag on', filePath);
        }
      }
    }
    this._patchSnapshots.clear();
  }

  /**
   * Inject the /test-preview route into an app's react-router <Routes> and wait for the route
   * to go live. Returns true only when a route was actually written. Returns false when
   * patchRouterConfig no-ops — a matched router file that patchRouterConfig cannot patch, i.e. a
   * react-router v6.4+ data router (createBrowserRouter([...]) + <RouterProvider>, no literal
   * <Routes>) — so the caller falls back to entry-file patching instead of reporting a false
   * success and leaving the app with no /test-preview route (HYP-934). Awaiting the route-update
   * barrier here (not only in onComponentSelected) closes the second HYP-934 gap: _applyPatchIfNeeded
   * runs on the isolated→app-shell round trip immediately before onModeChange(false) + an iframe
   * refresh, which previously could navigate before the newly-patched route was live.
   *
   * Also captures a before/after crash-revert snapshot of the router file (HYP-945) — this is the
   * router-patch snapshot capture point (skipWorktreeManaged:false: router patches never flag).
   */
  private async _tryPatchRouterFile(routerFile: string): Promise<boolean> {
    const before = await this._readPristineBaseline(routerFile);
    let after: string | undefined;
    const outcome = await this._fileManager.patchRouterConfig(routerFile, undefined, (w) => {
      after = w;
    });
    if (outcome === 'written' && before !== null && after !== undefined) {
      this._patchSnapshots.set(routerFile, { before, after, skipWorktreeManaged: false });
    }
    // Only a genuinely unpatchable file ('no-routes') triggers the entry-file fallback. An
    // 'already-present' result means the router is already patched (idempotent re-run, e.g. the
    // extension's file watcher re-firing on our own patch write) — treat it as success and do
    // NOT fall back, or the entry file would get managed too and bypass the routed app shell.
    if (outcome === 'no-routes') return false;
    // Wait for the route to go live only when we actually wrote it; an already-present route
    // is already live, so there is no HMR to wait for.
    if (outcome === 'written') await this._waitForPreviewRouteUpdate();
    return true;
  }

  private async _applyPatchIfNeeded(): Promise<void> {
  const detection = await detectFramework(this._projectRoot, this._io);
  if (detection.framework === 'vite-spa-jsx-router' || detection.framework === 'astro') {
    const routerFile = detection.framework === 'vite-spa-jsx-router' ? await this.detectRouterFile() : null;
    if (routerFile && (await this._tryPatchRouterFile(routerFile))) return;
    // No JSX router, or a data router patchRouterConfig could not patch (HYP-934) — entry file.
    // Match onComponentSelected's Vite/bun options: a Vite app must NOT arm the webpack
    // recompile gate (it emits no webpack marker) and MUST await the HMR route-update barrier
    // before onModeChange(false) triggers the iframe refresh, or the preview navigates before
    // the freshly-patched entry is live.
    await this._patchEntryFile({ armRecompileGate: false, waitForPreviewRouteUpdate: true });
  } else if (detection.framework === 'webpack' || detection.framework === 'parcel') {
    await this._patchEntryFile();
  } else if (detection.framework === 'bun') {
    // Same router-vs-entry-only distinction as onComponentSelected's bun case above —
    // this runs on the isolated→app-shell round trip, so it must restore router-based
    // patching for a bun-with-router app instead of regressing to entry-only patching.
    const routerFile = await this.detectRouterFile();
    if (routerFile && (await this._tryPatchRouterFile(routerFile))) return;
    await this._patchEntryFile({ armRecompileGate: false, waitForPreviewRouteUpdate: true });
  }
}
}
