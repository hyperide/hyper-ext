/**
 * @file Saga terminal from the per-hunk ledger (master spec §9.1 "per-hunk ledger" table, T1a)
 *
 * Accessed via: WriteTransaction.rollback, to derive the saga terminal from the resolved hunk
 *   statuses rather than maintaining a parallel hand-set flag.
 * Assumptions: pure. The terminal is a function of the hunk-status MULTISET; `revert-failed`
 *   dominates (any one forces `rollback_failed`), then the table is read top to bottom.
 */
import type { HunkStatus, SagaState } from './types';

/**
 * Derive the saga terminal from the per-file (per-hunk) statuses of a rollback. Only the statuses a
 * rollback can produce are handled here — `committed` is the commit-path terminal, derived separately.
 *   - any `revert-failed`            → `rollback_failed` (dominates, stop-the-line)
 *   - all `reverted`                 → `rolled_back`
 *   - any `superseded-skipped`, no failure → `superseded`
 *   - mix of `committed` + `reverted` → `partially_committed`
 */
export function deriveRollbackTerminal(statuses: HunkStatus[]): SagaState {
  if (statuses.some((status) => status === 'revert-failed')) {
    return 'rollback_failed';
  }
  if (statuses.some((status) => status === 'superseded-skipped')) {
    return 'superseded';
  }
  const hasCommitted = statuses.some((status) => status === 'committed');
  const hasReverted = statuses.some((status) => status === 'reverted');
  if (hasCommitted && hasReverted) {
    return 'partially_committed';
  }
  return 'rolled_back';
}
