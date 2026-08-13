/**
 * @file nodepodRuntimeStore — the seam that tells the transport-agnostic AstOperations + i18n
 *   scan path WHICH runtime is active (Docker vs NodePod) and, for NodePod, the project id whose
 *   OPFS tree to operate on. HYP-372 Phase 2 / HYP-746.
 *
 * Why a store (not prop-drilling): createBrowserAstOperations() and useBrowserI18nText() are deep
 *   in the platform layer; threading runtime.mode through every intermediate component would touch
 *   a lot of unrelated code. CanvasEditor already owns useProjectRuntime() — it publishes the
 *   active runtime here once, and the platform layer reads it. The single fetch in the AstOperations
 *   seam then routes serverless (OPFS-local) vs Docker (HTTP) by reading this — the "one call site,
 *   the runtime decides" contract from the task.
 *
 * Mismatch safety: when mode is 'nodepod' the projectId is the ACTIVE NodePod project; the transport
 *   only ever touches hyper-nodepod/<that id>/. A null projectId in nodepod mode means "not ready"
 *   and the transport returns a clean error rather than guessing a tree.
 */
import { create } from 'zustand';

export type ActiveRuntimeMode = 'docker' | 'nodepod';

/** Mirror a project-relative file into the running pod FS for HMR. No-op when no pod runs. */
export type WriteToPod = (path: string, content: string) => Promise<void>;

const NO_POD_WRITE: WriteToPod = async () => {};

interface NodePodRuntimeState {
  /** Active project runtime. Docker → retarget goes over HTTP; NodePod → over local OPFS. */
  mode: ActiveRuntimeMode;
  /** The NodePod project id whose OPFS tree the transport operates on (null until known). */
  projectId: string | null;
  /**
   * The running runtime's pod-FS mirror writer (HMR). The retarget persists to OPFS itself but the
   * LIVE dev server runs from a separate pod FS — the transport calls this to push the change into
   * the pod so HMR fires. Defaults to a no-op (no pod / Docker).
   */
  writeToPod: WriteToPod;
  setRuntime: (mode: ActiveRuntimeMode, projectId: string | null, writeToPod?: WriteToPod) => void;
}

export const useNodePodRuntimeStore = create<NodePodRuntimeState>((set) => ({
  mode: 'docker',
  projectId: null,
  writeToPod: NO_POD_WRITE,
  setRuntime: (mode, projectId, writeToPod) => set({ mode, projectId, writeToPod: writeToPod ?? NO_POD_WRITE }),
}));

/** Non-React read for the AstOperations seam (which is a plain factory, not a hook). */
export function getActiveRuntime(): { mode: ActiveRuntimeMode; projectId: string | null; writeToPod: WriteToPod } {
  const { mode, projectId, writeToPod } = useNodePodRuntimeStore.getState();
  return { mode, projectId, writeToPod };
}
