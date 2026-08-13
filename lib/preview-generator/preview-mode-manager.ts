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
import { detectFramework } from './framework-routing';
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
}

/** Default: node:fs.watch with debounce. Suitable for local extension use. */
export function fsWatchFactory(projectRoot: string, onChange: () => void): () => void {
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

  private _watcherDispose: (() => void) | null = null;
  private _modeUpdateInProgress = false;
  private _modeUpdatePending = false;

  constructor({ projectRoot, io, onModeChange, watcherFactory }: PreviewModeManagerOptions) {
    this._projectRoot = projectRoot;
    this._io = io;
    this._onModeChange = onModeChange;
    this._watcherFactory = watcherFactory ?? fsWatchFactory;
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
      case 'vite-spa-file-based':
        return this._fileManager.ensurePreviewFiles();
      case 'vite-spa-jsx-router': {
        const routerFile = await this.detectRouterFile();
        if (routerFile) {
          await this._fileManager.patchRouterConfig(routerFile);
          return 'ok';
        }
        // No JSX router found — patch entry file (same as webpack/parcel).
        // Plain Vite SPA projects without React Router.
        return this._patchEntryFile();
      }
      case 'webpack':
      case 'parcel':
        return this._patchEntryFile();
      case 'unknown':
        return 'unsupported';
      default:
        return this._fileManager.ensurePreviewFiles();
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

  /** Override in tests to inject a known router file path. */
  async detectRouterFile(): Promise<string | null> {
    const candidates = [
      'src/App.tsx',
      'src/app.tsx',
      'App.tsx',
      'src/main.tsx',
      'src/main.ts',
      'src/router.tsx',
      'src/router.ts',
      'src/routes.tsx',
      'src/routes.ts',
    ];
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
    const candidates = ['src/index.tsx', 'src/index.ts', 'src/main.tsx', 'src/main.ts'];
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

  private async _patchEntryFile(): Promise<'ok'> {
    const entryFile = await this._detectEntryFile();
    if (entryFile) await this._fileManager.patchEntryFile(entryFile);
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

  private async _revertEntryPatchIfPresent(): Promise<void> {
    const entryFile = await this._detectEntryFile();
    if (!entryFile) return;
    try {
      const content = await this._io.readFile(entryFile);
      if (content.includes('@hyperide-managed')) await this._fileManager.revertEntryFile(entryFile);
    } catch {
      /* not accessible */
    }
  }

  private async _applyPatchIfNeeded(): Promise<void> {
    const detection = await detectFramework(this._projectRoot, this._io);
    if (detection.framework === 'vite-spa-jsx-router') {
      const routerFile = await this.detectRouterFile();
      if (routerFile) {
        await this._fileManager.patchRouterConfig(routerFile);
        return;
      }
      // No JSX router — patch entry file (same as webpack/parcel)
      await this._patchEntryFile();
    } else if (detection.framework === 'webpack' || detection.framework === 'parcel') {
      await this._patchEntryFile();
    }
  }
}
