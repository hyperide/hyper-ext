/**
 * @file Single source of truth for the i18n key-retarget mutation contract.
 *
 * Accessed via: imported by both the Docker backend (server/routes/retargetI18nKey.ts,
 *   mounted at RETARGET_ROUTE) and the shared orchestrator/handler, and (Phase 2) by the
 *   NodePod service-worker intercept. NO logic lives here — only the route constant, the
 *   request/response shapes, and the closed error-code set. Keeping it logic-free lets the
 *   client, the Docker transport, and the future OPFS transport all agree on one wire shape.
 * Assumptions: keys and locations are validated downstream (orchestrator + route security
 *   gate); this module makes no trust decisions.
 * Invariant: RetargetErrorCode is a CLOSED union — adding a failure mode means adding a code
 *   here first, so every transport surfaces it uniformly.
 */
import type { I18nLibrary } from '../types';

/** HTTP route the Docker backend mounts the retarget handler at. */
export const RETARGET_ROUTE = '/__hyp/mut/i18n/retarget';

/**
 * Closed set of retarget outcomes.
 *
 * - `ok`                 — write applied (old→new) or idempotent noop (new→new).
 * - `ambiguous-binding`  — the bindingLoc miss fell back to a file-wide search that matched
 *                          MORE than one `t(oldKey)`; we never guess which one to rewrite.
 * - `hard-conflict`      — the located node's CURRENT key is neither oldKey nor newKey, i.e.
 *                          someone else moved it out from under us. Key (not hash) is truth.
 * - `not-retargetable`   — the binding is dynamic / a template / a non-string id, OR the
 *                          requested newKey does not exist yet and createIfMissing=false
 *                          (Phase 1 create-key is disabled-with-reason in the combobox).
 * - `invalid-key`        — oldKey/newKey failed validation (empty, too long, control chars,
 *                          JSX-structural chars, or a prototype-pollution segment).
 * - `locale-write-failed`— Phase 2 only: the locale-JSON-first write failed before the JSX
 *                          rewrite. Reserved so the ordering scaffold has an honest code.
 * - `unsupported`        — the source could not be parsed, or the file/binding shape is
 *                          outside what the one shared parser understands.
 */
export type RetargetErrorCode =
  | 'ok'
  | 'ambiguous-binding'
  | 'hard-conflict'
  | 'not-retargetable'
  | 'invalid-key'
  | 'locale-write-failed'
  | 'unsupported';

/** A source location, Babel convention: 1-based line, 0-based column. Matches detect-i18n-binding. */
export interface BindingLocation {
  line: number;
  column: number;
}

export interface RetargetRequest {
  /**
   * Project-relative path of the source file that contains the binding. The TRUSTED absolute
   * path is derived server-side from the verified project context — never from this field
   * directly (the route canonicalizes + guards it against traversal).
   */
  filePath: string;
  /** The key currently bound at the call site (what the inspector read). */
  oldKey: string;
  /** The existing key to retarget the call site onto. */
  newKey: string;
  /**
   * Location of the `t(...)` call expression that scanBindings marked retargetable. Used as the
   * PRIMARY locator. When the source has shifted and this misses, the orchestrator falls back to
   * the unique `t(oldKey)` in the file; multiple matches → 'ambiguous-binding'.
   */
  bindingLoc: BindingLocation;
  /** i18n library hint (drives callee-name acceptance in the shared parser). */
  library: I18nLibrary;
  /** Optional namespace, used as a tie-breaker / for the Phase 2 locale-JSON-first write. */
  namespace?: string;
  /** Active locale — telemetry + Phase 2 locale write target. */
  activeLocale?: string;
  /**
   * Phase 1: always false. When false and newKey is absent from the locale dictionary, the
   * outcome is 'not-retargetable'. Phase 2 (M3.5) flips the locale-JSON-first create flow on.
   */
  createIfMissing?: boolean;
}

export interface RetargetResponse {
  code: RetargetErrorCode;
  /** True only when a durable write actually happened (false for an idempotent noop). */
  written: boolean;
  /** The key now bound at the call site after the operation (newKey on success/noop). */
  resultingKey: string;
  /**
   * Telemetry, NOT a gate. The pre-write content hash of the source file as the orchestrator
   * saw it. Surfaced so callers/observability can detect drift; it never blocks a write —
   * the key is the only truth (see hard-conflict).
   */
  observedHash?: string;
  /** Human-readable detail for non-ok outcomes (combobox "create key" disabled-reason, etc.). */
  reason?: string;
}
