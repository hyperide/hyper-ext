/**
 * @file HYP-945 startup stale-injection sweep — the guarded revert-then-watch sequence.
 *
 * Accessed via: extension.ts activation and rerootPreviewPipeline. Extracted here so the
 * supersession guard (the P2 fix) is unit-testable without a live VS Code host.
 *
 * Why the guard exists: `revertManagedInjections()` is async. A monorepo reroot can swap
 * in a NEW PreviewModeManager while a prior sweep is still awaiting its revert. When the
 * stale sweep's continuation finally runs, it must NOT start the abandoned root's watchers
 * — that would clobber the new manager's watchers (they share the extension's single
 * `entryWatcherDisposables` array) and revive a root nothing owns anymore.
 */

export interface StartupSweepManager {
  revertManagedInjections(): Promise<void>;
  startWatching(): void;
}

/**
 * Build the liveness predicate shared by the startup sweep, the async watcher setup, and the
 * git-discard re-patch debounce (HYP-945). A candidate is live only while it is STILL the
 * active value (identity vs a module-level ref that a reroot / reactivation replaces) AND the
 * host is not shutting down. Keyed on the module-level ref — NOT an activation-local binding —
 * so a stale continuation from a prior activation fails the check after a deactivate→reactivate
 * cycle in the same host, and the shutting-down half covers the early-teardown window before
 * that ref is nulled.
 */
export function createLivenessGuard<T>(
  getActive: () => T | null,
  isShuttingDown: () => boolean,
): (candidate: T) => boolean {
  return (candidate: T): boolean => candidate === getActive() && !isShuttingDown();
}

/**
 * Revert any stale @hyperide-managed injection this manager left behind, THEN — only if
 * `isCurrent()` still reports this manager as the active one — start its FSWatch and wire
 * its re-patch watcher (`startWatchers`). Watchers are started strictly after the revert so
 * none is live during the sweep (else the sweep's own revert write reads as a git-discard
 * and gets re-injected). The revert is best-effort: a rejection never blocks the guard.
 */
export function runGuardedStartupSweep(
  manager: StartupSweepManager,
  isCurrent: () => boolean,
  startWatchers: () => void | Promise<void>,
): Promise<void> {
  return manager
    .revertManagedInjections()
    .catch(() => {})
    .finally(async () => {
      // Best-effort: neither a synchronous throw nor an ASYNC rejection from the guard or
      // watcher-start may surface as an unhandled rejection (the caller void-s this promise).
      // startWatchers is the production caller's async setupEntryFileWatcher, which can reject
      // after its first await (e.g. watcher construction) — awaiting it here catches that too.
      try {
        // A reroot superseded this manager mid-sweep — abandon the watcher (re)start.
        if (!isCurrent()) return;
        manager.startWatching();
        await startWatchers();
      } catch {
        /* swallow — sweep is best-effort */
      }
    });
}
