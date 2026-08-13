/**
 * @file The transport-agnostic retarget orchestrator: validate → lock → read → locate → rewrite
 *   → write. Runs over an INJECTED FileStore so the exact same flow executes on the Docker
 *   backend (NodeFileStore) and, in Phase 2, inside NodePod (OpfsFileStore).
 *
 * Accessed via: handler.ts (thin glue), which the Docker route and the future OPFS intercept both
 *   call. The orchestrator owns policy; core.ts owns the AST.
 *
 * Flow (Phase 1 — existing-key only):
 *   1. validate keys (prototype-pollution / structural) — defense in depth with the route gate.
 *   2. resolve the trusted absolute path via ctx (NEVER from the request body downstream).
 *   3. Phase-1 create gate: if newKey is absent from the project's available keys and
 *      createIfMissing is false → 'not-retargetable' (combobox shows "create key" disabled).
 *   4. store.withLock([file]) → read → core.retargetBinding → store.write (only when written).
 *
 * Conflict policy lives in core (key = truth; hash = telemetry only). The observedHash is read
 *   inside the lock purely for telemetry; it never gates the write.
 *
 * Phase 2 (M3.5) scaffold: for a NEW key the flow becomes locale-JSON-first THEN JSX. The
 *   ordering is encoded in the comments + the createIfMissing branch so the future change is a
 *   localized addition, not a rewrite. Phase 1 hard-returns before any locale write.
 */
import type { RetargetErrorCode, RetargetRequest, RetargetResponse } from './contract';
import { retargetBinding } from './core';
import type { FileStore } from './file-store';
import { isValidI18nKey } from './validate-key';

/** Outcome of a locale-dictionary create. localePath is telemetry/diagnostics only. */
export interface CreateLocaleKeyResult {
  ok: boolean;
  /** The locale file written, when known — surfaced for diagnostics, never a gate. */
  localePath?: string;
}

export interface OrchestratorContext {
  /**
   * Map the request's project-relative filePath to the TRUSTED absolute path. The route supplies
   * a closure bound to the verified project root + traversal guard; tests supply a stub. The
   * orchestrator must never construct an absolute path itself from request input.
   */
  resolveAbsolute(filePath: string): string | null;
  /**
   * The keys that already exist in the project's active locale dictionary. A newKey not in this
   * list is created via createLocaleKey when createIfMissing is set (Phase 2); without that hook a
   * missing key stays "not-retargetable" (the Docker Phase-1 behavior). Undefined means "unknown"
   * — treated as not-present (conservative: a missing-key path is taken, not a blind rewrite).
   */
  availableKeys?: string[];
  /**
   * Phase 2 (HYP-746) locale-JSON-first create hook. When createIfMissing is true and newKey is
   * absent from availableKeys, the orchestrator calls this to write the locale dictionary entry
   * BEFORE touching the JSX. On ok:false the orchestrator returns 'locale-write-failed' and never
   * rewrites the JSX (so a failed dictionary write can't leave a JSX call pointing at a key with no
   * translation). When the hook is absent, create is unavailable and a missing key is
   * 'not-retargetable'. The hook owns its own atomic write + lock of the locale file (it runs the
   * same transport's store under the hood).
   */
  createLocaleKey?(req: RetargetRequest): Promise<CreateLocaleKeyResult>;
}

function fail(code: RetargetErrorCode, reason?: string, resultingKey = ''): RetargetResponse {
  return { code, written: false, resultingKey, reason };
}

export async function run(ctx: OrchestratorContext, store: FileStore, req: RetargetRequest): Promise<RetargetResponse> {
  // 1) Validate keys (defense in depth — the route validates too).
  if (!isValidI18nKey(req.oldKey) || !isValidI18nKey(req.newKey)) {
    return fail('invalid-key', 'oldKey or newKey failed validation', req.oldKey);
  }

  // 2) Resolve the trusted absolute path.
  const abs = ctx.resolveAbsolute(req.filePath);
  if (!abs) {
    return fail('unsupported', 'filePath did not resolve within the project', req.oldKey);
  }

  // 3) Create gate. An existing-key retarget requires newKey to already exist. A NEW key is only
  //    creatable when createIfMissing is set AND a createLocaleKey hook is supplied (Phase 2 /
  //    HYP-746 — the NodePod transport and any route that opts in). Without the hook, a missing key
  //    is not-retargetable (the Docker Phase-1 behavior, preserved).
  const newKeyVerified = (ctx.availableKeys ?? []).includes(req.newKey);
  const wantsCreate = !newKeyVerified && req.createIfMissing === true && typeof ctx.createLocaleKey === 'function';
  if (!newKeyVerified && !wantsCreate) {
    const reason = req.createIfMissing
      ? 'createIfMissing was set but no locale-create capability is available in this runtime'
      : `key "${req.newKey}" does not exist yet; enable create to add it`;
    return fail('not-retargetable', reason, req.oldKey);
  }

  // 3b) Locale-JSON-first create (Phase 2). Write the dictionary entry BEFORE locking/rewriting the
  //     JSX, so a failed locale write leaves the JSX untouched (no call site bound to a missing
  //     translation). createLocaleKey owns its own atomic write + lock of the locale file.
  if (wantsCreate) {
    const created = await ctx.createLocaleKey!(req);
    if (!created.ok) {
      return fail('locale-write-failed', `failed to create locale key "${req.newKey}"`, req.oldKey);
    }
  }

  // 4) Lock the JSX file, read, rewrite, write. (The locale write, when any, already happened and
  //    self-locked in 3b — locale-first ordering.)
  return store.withLock([abs], async (): Promise<RetargetResponse> => {
    let source: string;
    try {
      source = await store.read(abs);
    } catch {
      return fail('unsupported', 'source file could not be read', req.oldKey);
    }

    // Telemetry only — never gates the write (key is truth, per the conflict policy in core).
    let observedHash: string | undefined;
    try {
      observedHash = await store.hash(abs);
    } catch {
      observedHash = undefined;
    }

    const result = retargetBinding(source, {
      filePath: req.filePath,
      oldKey: req.oldKey,
      newKey: req.newKey,
      bindingLoc: req.bindingLoc,
      library: req.library,
      namespace: req.namespace,
    });

    if (result.code !== 'ok') {
      return {
        code: result.code,
        written: false,
        resultingKey: result.resultingKey,
        observedHash,
        reason: result.reason,
      };
    }

    if (result.written) {
      await store.write(abs, result.source);
    }

    return {
      code: 'ok',
      written: result.written,
      resultingKey: result.resultingKey,
      observedHash,
    };
  });
}
