/**
 * @file NodePod (serverless SaaS) transport for the i18n key-retarget + scan + locale-key-list,
 *   running the SAME shared handler/orchestrator the Docker backend runs — only the injected
 *   FileStore/FileIO differ (OPFS instead of node:fs). HYP-372 Phase 2 / HYP-746.
 *
 * Why this exists: in NodePod mode the project's source of truth is the in-browser OPFS tree
 *   (hyper-nodepod/<projectId>/), not a remote container. A retarget that hit the Docker route
 *   would mutate the wrong (stale or absent) files and split-brain. So when the active runtime is
 *   NodePod, the platform AstOperations seam routes the retarget HERE — one call site, the runtime
 *   decides Docker-HTTP vs OPFS-local. The orchestrator code is byte-identical across both (proven
 *   by the shared retarget parity test).
 *
 * What each function does:
 *   - runNodePodRetarget: validate → (new-key: locale-JSON-first create) → lock+rewrite JSX, all
 *     over OpfsFileStore. availableKeys + createLocaleKey are resolved from OPFS via the shared
 *     listKeysForBinding / writeI18nResource (no server round-trip).
 *   - scanNodePodBindings: read the source from OPFS and run the shared scanBindings — the browser
 *     READ path's serverless equivalent of /api/scan-i18n-bindings.
 *   - listNodePodLocaleKeys: the FULL locale dictionary keys for the combobox candidate set (item 4
 *     — not just in-file retargetable ones), via the shared listKeysForBinding over OPFS.
 *
 * Project mismatch guard: the caller passes the ACTIVE NodePod projectId. There is no Docker
 *   project context here, so a Docker→NodePod mismatch cannot silently operate on the wrong tree —
 *   the transport only ever touches hyper-nodepod/<activeProjectId>/. A missing/blank projectId is
 *   a clean 'unsupported' error, never a guess.
 */
import { listKeysForBinding } from '@shared/i18n-text/adapters/registry';
import type { RetargetRequest, RetargetResponse } from '@shared/i18n-text/retarget/contract';
import { scanBindings, type ScannedBinding } from '@shared/i18n-text/retarget/core';
import { handleRetarget } from '@shared/i18n-text/retarget/handler';
import { OpfsFileStore } from '@shared/i18n-text/retarget/opfs-file-store';
import type { CreateLocaleKeyResult, OrchestratorContext } from '@shared/i18n-text/retarget/orchestrator';
import { isValidI18nKey } from '@shared/i18n-text/retarget/validate-key';
import { discoverLayout, resolveI18nResource } from '@shared/i18n-text/resolve-i18n-resource';
import type { I18nLibrary } from '@shared/i18n-text/types';
import { writeI18nResource } from '@shared/i18n-text/write-i18n-resource';
import { OpfsFileIO } from './opfsFileIO';

/** Shared-code projectRoot for OPFS: '' so every built path is `/<rel>` (OpfsFileIO strips the /). */
const OPFS_PROJECT_ROOT = '';

export interface NodePodTransportDeps {
  /** The active NodePod project id — the ONLY tree this transport touches. */
  projectId: string;
  /** OPFS root resolver override (tests). Defaults to navigator.storage.getDirectory(). */
  getRoot?: () => Promise<FileSystemDirectoryHandle>;
  /** Web Locks manager override (tests). Defaults to navigator.locks. */
  locks?: LockManager;
  /**
   * Mirror a project-relative file into the RUNNING pod FS (the live dev server's separate
   * filesystem), to fire Vite HMR. Supplied by the runtime store from useNodePodRuntime — a no-op
   * when no pod is running. The retarget persists to the OPFS tree the pod was SEEDED from, not the
   * pod's live FS, so without this mirror a successful retarget would persist but the preview would
   * not update (no HMR). Omitted in unit tests that don't assert the HMR path.
   */
  writeToPod?: (path: string, content: string) => Promise<void>;
}

function fail(reason: string): RetargetResponse {
  return { code: 'unsupported', written: false, resultingKey: '', reason };
}

/** Library for the shared resolver: 'custom' and unknown → null (no structural gating). */
function resolverLibrary(library: I18nLibrary): I18nLibrary | null {
  return library === 'custom' ? null : library;
}

/**
 * Resolve the full set of existing keys for the request's active locale, from OPFS. Used both for
 * the orchestrator's create gate (existing key → plain retarget) and as the combobox candidate set.
 */
async function resolveAvailableKeys(fileIO: OpfsFileIO, req: RetargetRequest): Promise<string[]> {
  if (!req.activeLocale) return [];
  try {
    return await listKeysForBinding(req.activeLocale, {
      projectRoot: OPFS_PROJECT_ROOT,
      fileIO,
      library: resolverLibrary(req.library),
      namespace: req.namespace,
    });
  } catch {
    return [];
  }
}

/**
 * Seed value for a newly-created key: the OLD key's resolved translation (so the call site keeps
 * showing the same text after the retarget), falling back to the newKey string when the old key
 * can't be resolved (a fresh placeholder beats a blank).
 */
async function resolveOldKeyValue(fileIO: OpfsFileIO, req: RetargetRequest, locale: string): Promise<string> {
  try {
    const resolved = await resolveI18nResource({
      projectRoot: OPFS_PROJECT_ROOT,
      library: req.library,
      key: req.oldKey,
      namespace: req.namespace,
      activeLocale: locale,
      fileIO,
    });
    if (resolved.resolvedText) return resolved.resolvedText;
  } catch {
    // fall through to the placeholder
  }
  return req.newKey;
}

export async function runNodePodRetarget(req: RetargetRequest, deps: NodePodTransportDeps): Promise<RetargetResponse> {
  if (!deps.projectId) return fail('no active NodePod project');
  // Defense in depth — the orchestrator validates too, but a blank/forged key shouldn't reach OPFS.
  if (!isValidI18nKey(req.oldKey) || !isValidI18nKey(req.newKey)) {
    return { code: 'invalid-key', written: false, resultingKey: req.oldKey, reason: 'invalid key' };
  }

  const fileIO = new OpfsFileIO({ projectId: deps.projectId, getRoot: deps.getRoot });
  const store = new OpfsFileStore({ projectId: deps.projectId, getRoot: deps.getRoot, locks: deps.locks });
  const availableKeys = await resolveAvailableKeys(fileIO, req);

  // The locale file a new-key create touched, captured so we can also mirror it into the pod FS for
  // HMR (the JSX path is always req.filePath; the locale path is only known after discovery).
  let createdLocalePath: string | undefined;

  const ctx: OrchestratorContext = {
    // OpfsFileStore keys on project-relative paths; the request filePath already IS one.
    resolveAbsolute: (filePath) => filePath || null,
    availableKeys,
    // Locale-JSON-first create: write the new key into the active locale dictionary BEFORE the
    // orchestrator rewrites the JSX. createValue = the resolved oldKey text when available, else
    // the newKey itself as a placeholder (so the call site renders something, not a blank).
    async createLocaleKey(r): Promise<CreateLocaleKeyResult> {
      const locale = r.activeLocale ?? 'en';
      const createValue = await resolveOldKeyValue(fileIO, r, locale);
      // writeI18nResource does a read-modify-write of the WHOLE locale JSON. Run it under the same
      // OpfsFileStore Web Lock the JSX write uses, keyed on the locale file path, so two same-origin
      // tabs creating different keys in the same locale can't both read the old JSON and lose a write
      // (last-write-wins). Resolve the locale path up front to name the lock; on a missing layout we
      // skip the lock — writeI18nResource will just return 'missing-locale-file' anyway.
      const write = () =>
        writeI18nResource({
          projectRoot: OPFS_PROJECT_ROOT,
          library: r.library,
          key: r.newKey,
          namespace: r.namespace,
          activeLocale: locale,
          newText: createValue,
          fileIO,
        });
      const layout = await discoverLayout(OPFS_PROJECT_ROOT, r.namespace, locale, fileIO);
      const localePath = layout?.getLocaleFilePath(locale);
      const result = localePath ? await store.withLock([localePath], write) : await write();
      if (result.success) createdLocalePath = result.filePath ?? undefined;
      return { ok: result.success, localePath: result.filePath ?? undefined };
    },
  };

  const response = await handleRetarget(ctx, store, req);

  // Mirror the persisted change into the RUNNING pod FS so Vite HMR fires. The retarget wrote to the
  // OPFS tree the pod was SEEDED from, NOT the pod's live FS — without this the change persists but
  // the preview never updates. Read the freshly-written bytes back from OPFS (source of truth after
  // the write) and push them to the pod. We mirror the LOCALE JSON whenever a key was created (even
  // if the JSX rewrite later failed) — its absence from the pod is what poisons a retry: OPFS already
  // holds the key, so the retry treats it as existing and would mirror only JSX, leaving the pod
  // bound to a missing translation. The JSX is mirrored only on the overall 'ok'. A pod-write failure
  // must not fail the retarget (the persist already succeeded).
  if (deps.writeToPod) {
    await mirrorToPod(fileIO, deps.writeToPod, response.code === 'ok' ? req.filePath : undefined, createdLocalePath);
  }

  return response;
}

/**
 * Push the just-persisted files into the running pod FS (HMR). Paths handed to writeToPod are
 * project-relative (the runtime prefixes `/app/`). createdLocalePath is OPFS-absolute ('/locales/…')
 * — strip the leading slash to a relative path. Best-effort: a failed mirror is logged, never thrown,
 * so it can't turn a successful persisted retarget into a user-visible error.
 *
 * Order matters: the LOCALE dictionary is mirrored BEFORE the JSX, mirroring the orchestrator's
 * locale-first invariant. Otherwise there is a live HMR window where the pod source references a key
 * the pod dictionary does not yet have.
 */
async function mirrorToPod(
  fileIO: OpfsFileIO,
  writeToPod: (path: string, content: string) => Promise<void>,
  jsxPath: string | undefined,
  createdLocalePath: string | undefined,
): Promise<void> {
  try {
    if (createdLocalePath) {
      const localeRel = createdLocalePath.replace(/^\/+/, '');
      const localeContent = await fileIO.readFile(`/${localeRel}`);
      await writeToPod(localeRel, localeContent);
    }
    if (jsxPath) {
      const jsx = await fileIO.readFile(`/${jsxPath}`);
      await writeToPod(jsxPath, jsx);
    }
  } catch (err) {
    console.warn('[nodepod] failed to mirror retarget into the running pod FS (HMR skipped)', err);
  }
}

export interface ScanNodePodResult {
  success: boolean;
  bindings: ScannedBinding[];
  library: I18nLibrary | null;
  error?: string;
}

export async function scanNodePodBindings(
  params: { filePath: string; library: I18nLibrary | null },
  deps: NodePodTransportDeps,
): Promise<ScanNodePodResult> {
  if (!deps.projectId) return { success: false, bindings: [], library: null, error: 'no active NodePod project' };
  const fileIO = new OpfsFileIO({ projectId: deps.projectId, getRoot: deps.getRoot });
  let source: string;
  try {
    source = await fileIO.readFile(`/${params.filePath}`);
  } catch {
    return { success: false, bindings: [], library: params.library, error: 'file not found in OPFS' };
  }
  const bindings = scanBindings(source, { library: params.library });
  return { success: true, bindings, library: params.library };
}

/**
 * Item 4 — the FULL locale dictionary keys for the combobox. Returns every key in the active
 * locale, not just the in-file retargetable ones, so the browser combobox offers all keys to
 * retarget onto (and, with create, any new one the user types).
 */
export async function listNodePodLocaleKeys(
  params: { library: I18nLibrary | null; namespace?: string; activeLocale: string },
  deps: NodePodTransportDeps,
): Promise<string[]> {
  if (!deps.projectId) return [];
  const fileIO = new OpfsFileIO({ projectId: deps.projectId, getRoot: deps.getRoot });
  try {
    return await listKeysForBinding(params.activeLocale, {
      projectRoot: OPFS_PROJECT_ROOT,
      fileIO,
      library: params.library,
      namespace: params.namespace,
    });
  } catch {
    return [];
  }
}
