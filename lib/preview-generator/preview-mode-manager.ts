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
      if (entryFile) await this._fileManager.patchEntryFile(entryFile, './__canvas_preview_standalone__');
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
    const htmlEntry = await this._detectHtmlEntryFile();
    if (htmlEntry) return htmlEntry;

    const frontendRoot = await this._detectFrontendRoot();
    // Check the detected frontend root first, then fall back to src/
    const rootPrefixes = frontendRoot !== 'src' ? [frontendRoot, 'src'] : ['src'];
    const suffixes = ['index.tsx', 'index.ts', 'main.tsx', 'main.ts'];
    const candidates = rootPrefixes.flatMap((r) => suffixes.map((s) => `${r}/${s}`));
    for (const rel of candidates) {
      const abs = join(this._projectRoot, rel);
      try {
        await this._io.readFile(abs);
        return abs;
      } catch {
        /* not found */
      }
    }
    return null;
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
    const wrote = await this._fileManager.patchEntryFile(entryFile, './__canvas_preview__', onBeforeWrite);
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

  private async _revertJsxPatchIfPresent(): Promise<void> {
    const routerFile = await this.detectRouterFile();
    if (!routerFile) return;
    try {
      const content = await this._io.readFile(routerFile);
      if (content.includes('@hyperide-managed')) await this._fileManager.revertRouterPatch(routerFile);
    } catch {
      /* not accessible */
    }
  }

  /** @returns true when a managed entry patch was actually reverted (a file write happened). */
  private async _revertEntryPatchIfPresent(): Promise<boolean> {
    const entryFile = await this._detectEntryFile();
    if (!entryFile) return false;
    try {
      const content = await this._io.readFile(entryFile);
      if (content.includes('@hyperide-managed')) {
        await this._fileManager.revertEntryFile(entryFile);
        return true;
      }
    } catch {
      /* not accessible */
    }
    return false;
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
   */
  private async _tryPatchRouterFile(routerFile: string): Promise<boolean> {
    const outcome = await this._fileManager.patchRouterConfig(routerFile);
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
