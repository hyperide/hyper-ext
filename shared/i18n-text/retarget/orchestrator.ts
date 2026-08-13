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

export interface OrchestratorContext {
  /**
   * Map the request's project-relative filePath to the TRUSTED absolute path. The route supplies
   * a closure bound to the verified project root + traversal guard; tests supply a stub. The
   * orchestrator must never construct an absolute path itself from request input.
   */
  resolveAbsolute(filePath: string): string | null;
  /**
   * The keys that already exist in the project's active locale dictionary. Drives the Phase-1
   * create gate: a newKey not in this list is "not-retargetable" until Phase 2 enables creation.
   * Undefined means "unknown" — treated as not-present (conservative: gate stays closed).
   */
  availableKeys?: string[];
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

  // 3) Phase-1 create gate. An existing-key retarget requires newKey to already exist.
  //    Phase 2 (createIfMissing=true) will instead take the locale-JSON-first branch:
  //      a. write the new key into the active locale dictionary (store.write(localeFile)),
  //      b. on success, fall through to the JSX rewrite below,
  //      c. on locale write failure → 'locale-write-failed' (reserved code) before touching JSX.
  const newKeyVerified = (ctx.availableKeys ?? []).includes(req.newKey);
  if (!newKeyVerified) {
    // Both flag values are deferred in Phase 1; the reason differs so the combobox can show the
    // right disabled-with-reason text. createIfMissing=true is the Phase-2 locale-first branch.
    const reason = req.createIfMissing
      ? 'createIfMissing (new-key creation) is deferred to Phase 2'
      : `key "${req.newKey}" does not exist yet; creating keys is not available in this phase`;
    return fail('not-retargetable', reason, req.oldKey);
  }

  // 4) Lock the file (Phase 2 will also lock the localeFile), read, rewrite, write.
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
