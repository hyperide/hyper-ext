/**
 * @file The ONE four-way CAS classification (master spec §9.1 step 5 / §9.1.0 invariant 3, T1a)
 *
 * Accessed via: WriteTransaction.rollback — and, in later tasks, B3 compensation and crash-recovery
 *   replay — so all sites share ONE rule and cannot drift (the spec's explicit requirement).
 * Assumptions: pure. Given an inverse patch's recorded before/after hashes and the CURRENT on-disk
 *   content hash of the target span, classify into exactly one of four branches. `rollback_failed`
 *   is the FOURTH branch ONLY — never unconditional (invariant 3).
 *
 * The system NEVER force-applies an inverse over content it cannot account for: a span mutated by
 * something outside our journal classifies `revert-failed`, surfaced to the user, never silent debris.
 */
import type { ContentHash, InversePatch } from './types';

/**
 * The outcome of classifying one inverse patch against current content.
 *   - `apply`      — current == after-hash: our value is still there → apply the inverse (normal revert).
 *   - `skip-not-landed` — current == before-hash: the forward never landed (or was already reverted);
 *                    nothing to undo. Hunk resolves `reverted`.
 *   - `superseded` — current == a LATER committed writeId's after-hash (caller proves ownership via
 *                    `isSupersededByLaterCommit`): skip as Superseded, NOT a failure. Hunk
 *                    `superseded-skipped`.
 *   - `failed`     — none of the above: a foreign mutation we cannot account for → `rollback_failed`.
 */
export type CasOutcome = 'apply' | 'skip-not-landed' | 'superseded' | 'failed';

/**
 * Classify one inverse patch by comparing `currentHash` (the target's current on-disk content hash)
 * against the journal. `isSupersededByLaterCommit` answers the third branch: "is `currentHash` the
 * after-hash of a LATER committed writeId that owns this span?" — a journal lookup the caller owns.
 */
export function classifyInverse(
  patch: InversePatch,
  currentHash: ContentHash,
  isSupersededByLaterCommit: (filePath: string, currentHash: ContentHash) => boolean,
): CasOutcome {
  if (patch.afterHash !== null && currentHash === patch.afterHash) {
    return 'apply';
  }
  if (currentHash === patch.beforeHash) {
    return 'skip-not-landed';
  }
  if (isSupersededByLaterCommit(patch.filePath, currentHash)) {
    return 'superseded';
  }
  return 'failed';
}
