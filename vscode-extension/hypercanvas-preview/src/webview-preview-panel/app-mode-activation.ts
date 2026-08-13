/**
 * @file Pure, testable orchestration for AUTO app-mode activation.
 *
 * Accessed via: the extension host's `activateAppModeForEntry` closure (src/extension.ts) delegates
 *   its stale-guarded await sequence here so the ordering rules can be unit-tested without standing
 *   up the whole `activate()` graph (PreviewFileManager / DevServerManager / PreviewPanel).
 *
 * Why this exists: app-mode activation has multiple async boundaries (rebuild → recompile → route
 *   scan), and a newer component selection can land mid-flight. Each await must be followed by a
 *   staleness check, and a stale rollback must NOT clear a NEWER activation's state. Getting that
 *   ordering wrong silently clobbers the user's current selection — exactly the class of bug a unit
 *   test should pin. The extension closure supplies the real side-effecting steps; this module only
 *   sequences them and decides commit-vs-rollback.
 */

/** One async step in the activation pipeline (rebuild, recompile, route scan, …). */
type AppModeStep = () => Promise<void>;

export interface RunAppModeActivationArgs {
  /** Async steps to run in order. `isStale` is checked AFTER each one resolves. */
  steps: AppModeStep[];
  /** True when a newer selection has superseded this activation — stop and roll back. */
  isStale: () => boolean;
  /**
   * Apply the final activation effect (post `appMode` message + reload iframe with `&app=1`).
   * Only called when every step ran and the activation was never stale.
   */
  commit: () => void;
  /**
   * Undo this activation's marks IF it still owns the active state. Implemented by the caller as an
   * identity-guarded clear (only clears when `activeAppModeEntry === thisEntry`) so a stale rollback
   * never tears down a newer activation. Called on staleness and rethrown step failures.
   */
  rollbackIfOwned: () => void;
}

/**
 * Run the stale-guarded app-mode activation sequence.
 *
 * - Runs each step in order; after each, bails (rolling back) if `isStale()`.
 * - On full success (never stale), calls `commit()`.
 * - If a step throws, rolls back and rethrows so the caller can log/surface it.
 *
 * @returns `'committed'` when activation applied, `'stale'` when a newer selection cancelled it.
 */
export async function runAppModeActivation({
  steps,
  isStale,
  commit,
  rollbackIfOwned,
}: RunAppModeActivationArgs): Promise<'committed' | 'stale'> {
  try {
    for (const step of steps) {
      await step();
      if (isStale()) {
        rollbackIfOwned();
        return 'stale';
      }
    }
    commit();
    return 'committed';
  } catch (err) {
    rollbackIfOwned();
    throw err;
  }
}
