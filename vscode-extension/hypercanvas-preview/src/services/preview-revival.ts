/**
 * Preview revival after window reload (HYP-1164).
 *
 * Accessed via: extension.ts `deserializeWebviewPanel` — after VS Code revives the
 *   preview webview panel post-`workbench.action.reloadWindow`, the extension host
 *   calls `revivePreviewAfterReload` once activation wiring is up.
 * Assumptions: the dev server from the pre-reload session may still be alive
 *   (detached spawn survives the extension-host teardown); `startDevServer`
 *   (DevServerManager.start) adopts it via the HYP-1160 identity-verified
 *   attach-first path, or spawns a fresh one when it died. This module is
 *   deliberately vscode-free so the revival decision is unit-testable; the
 *   memento seam matches the `vscode.Memento` subset extension.ts passes in.
 * Invariants: the snapshot is only ever written while a dev server is running
 *   with a selected component (extension.ts guards), so its presence means
 *   "a preview was materialized before the reload". A user-initiated stop
 *   clears it — revival never resurrects a server the user killed.
 * Past bugs: HYP-1164 — pre-fix, the revived panel rebuilt only the webview
 *   shell: StateHub was empty (pure in-memory), `_devServerRunning` was false,
 *   and nothing called DevServerManager.start(), so the iframe never received
 *   an `updateUrl` and the canvas stayed blank until a manual re-open.
 */

/** Component identity as StateHub carries it (path repo-relative, name display). */
interface PreviewRevivalComponent {
  name: string;
  path: string;
}

/**
 * Everything the post-reload revival needs that died with the extension host.
 * `projectPath` is the dev-server target dir (monorepo sub-project or repo
 * root) — without it the re-attach would probe the repo root and miss the
 * identity-verified registry record a sub-project server was spawned under.
 */
export interface PreviewRevivalSnapshot {
  component: PreviewRevivalComponent;
  projectPath: string;
  /** Last URL the iframe used — informational; attach-first re-resolves its own. */
  url: string;
  savedAt: number;
}

export const PREVIEW_REVIVAL_STATE_KEY = 'hypercanvas.previewRevival';

/** Structural subset of vscode.Memento this module needs (keeps it vscode-free). */
export interface RevivalMemento {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

function isRevivalComponent(value: unknown): value is PreviewRevivalComponent {
  if (typeof value !== 'object' || value === null) return false;
  const component = value as Partial<PreviewRevivalComponent>;
  return typeof component.path === 'string' && component.path.length > 0 && typeof component.name === 'string';
}

/** Read and shape-validate the persisted snapshot; garbage reads as absent. */
export function readPreviewRevivalSnapshot(memento: RevivalMemento): PreviewRevivalSnapshot | undefined {
  const raw = memento.get<unknown>(PREVIEW_REVIVAL_STATE_KEY);
  if (typeof raw !== 'object' || raw === null) return undefined;
  const snapshot = raw as Partial<PreviewRevivalSnapshot>;
  if (!isRevivalComponent(snapshot.component)) return undefined;
  if (typeof snapshot.projectPath !== 'string' || snapshot.projectPath.length === 0) return undefined;
  if (typeof snapshot.url !== 'string') return undefined;
  return {
    component: { name: snapshot.component.name, path: snapshot.component.path },
    projectPath: snapshot.projectPath,
    url: snapshot.url,
    savedAt: typeof snapshot.savedAt === 'number' ? snapshot.savedAt : 0,
  };
}

export function persistPreviewRevivalSnapshot(memento: RevivalMemento, snapshot: PreviewRevivalSnapshot): void {
  void memento.update(PREVIEW_REVIVAL_STATE_KEY, snapshot);
}

export function clearPreviewRevivalSnapshot(memento: RevivalMemento): void {
  void memento.update(PREVIEW_REVIVAL_STATE_KEY, undefined);
}

export interface PreviewRevivalDeps {
  memento: RevivalMemento;
  /** Current dev-server target root (repo root right after re-activation). */
  getActiveProjectRoot(): string;
  /** Re-root the preview/dev axis to a monorepo sub-project (no-op when equal). */
  rerootPreviewPipeline(targetRoot: string): Promise<void> | void;
  /** DevServerManager.start — attach-first adopts a surviving identity-verified server. */
  startDevServer(): Promise<{ status: string; url?: string | null }>;
  /** PreviewPanel.setPreviewUrl — flips _devServerRunning and posts the iframe URL. */
  setPreviewUrl(url: string): void;
  /** Re-apply the selection to StateHub; the full pipeline (reroot, ensureComponent,
   * setComponentParam) re-runs off that edge. StateHub's same-path guard makes it a
   * no-op when the revived panel already derived the same component from the editor. */
  reselectComponent(component: PreviewRevivalComponent): void;
}

export type PreviewRevivalOutcome = 'no-snapshot' | 'restored' | 'server-failed';

/**
 * Re-materialize the preview after a window reload:
 * re-select the persisted component (pipeline re-runs, panel regains its
 * previewPath) → re-root the dev axis to the recorded sub-project → start the
 * dev server (attach-first adopts the survivor; a dead server respawns) → push
 * the iframe URL. A failed start degrades to the pre-fix manual-start state —
 * the selection is already re-applied so a manual start lands correctly.
 */
export async function revivePreviewAfterReload(deps: PreviewRevivalDeps): Promise<PreviewRevivalOutcome> {
  const snapshot = readPreviewRevivalSnapshot(deps.memento);
  if (!snapshot) return 'no-snapshot';

  // Selection first: the pipeline's own re-root runs concurrently with the
  // dev-server start below, and setComponentParam restores the panel's
  // monorepo previewPath before the URL push needs it.
  deps.reselectComponent(snapshot.component);

  if (snapshot.projectPath !== deps.getActiveProjectRoot()) {
    await deps.rerootPreviewPipeline(snapshot.projectPath);
  }

  let state: { status: string; url?: string | null };
  try {
    state = await deps.startDevServer();
  } catch {
    return 'server-failed';
  }
  if (state.status !== 'running' || !state.url) return 'server-failed';
  deps.setPreviewUrl(state.url);
  return 'restored';
}
