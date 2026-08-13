import { describe, expect, it, mock } from 'bun:test';
import { createLivenessGuard, runGuardedStartupSweep } from '../startup-sweep';

describe('createLivenessGuard (HYP-945)', () => {
  it('is true only when the candidate is the active ref AND not shutting down', () => {
    const a = {};
    const b = {};
    let active: object | null = a;
    let shuttingDown = false;
    const live = createLivenessGuard(() => active, () => shuttingDown);

    expect(live(a)).toBe(true);
    expect(live(b)).toBe(false); // not the active ref

    active = b; // a reroot/reactivation installed a new active ref
    expect(live(a)).toBe(false); // the prior candidate is now stale
    expect(live(b)).toBe(true);

    shuttingDown = true;
    expect(live(b)).toBe(false); // teardown blocks even the active ref

    shuttingDown = false;
    active = null; // the deactivate window nulls the ref before reactivation
    expect(live(b)).toBe(false);
  });
});

function makeManager(revert: () => Promise<void>) {
  const startWatching = mock(() => {});
  return {
    manager: { revertManagedInjections: revert, startWatching },
    startWatching,
  };
}

describe('runGuardedStartupSweep (HYP-945 P2)', () => {
  it('reverts, then starts watching + wires watchers when still the current manager', async () => {
    const { manager, startWatching } = makeManager(() => Promise.resolve());
    const startWatchers = mock(() => {});

    await runGuardedStartupSweep(manager, () => true, startWatchers);

    expect(startWatching).toHaveBeenCalledTimes(1);
    expect(startWatchers).toHaveBeenCalledTimes(1);
  });

  it('does NOT (re)start watchers when a reroot superseded this manager mid-sweep', async () => {
    // The revert resolves only after the guard reports this manager is no longer current.
    let current = true;
    const { manager, startWatching } = makeManager(async () => {
      current = false; // a reroot swapped in a new manager while the revert was in flight
    });
    const startWatchers = mock(() => {});

    await runGuardedStartupSweep(manager, () => current, startWatchers);

    expect(startWatching).not.toHaveBeenCalled();
    expect(startWatchers).not.toHaveBeenCalled();
  });

  it('still starts watchers when the revert rejects (best-effort sweep)', async () => {
    const { manager, startWatching } = makeManager(() => Promise.reject(new Error('boom')));
    const startWatchers = mock(() => {});

    await runGuardedStartupSweep(manager, () => true, startWatchers);

    expect(startWatching).toHaveBeenCalledTimes(1);
    expect(startWatchers).toHaveBeenCalledTimes(1);
  });

  it('does not start watchers for a manager displaced by a later activation/reroot (module-identity guard)', async () => {
    // Models the deactivate→reactivate (or reroot) case: the active-manager reference is
    // swapped to a NEW manager while this sweep awaits its revert. A guard keyed on the
    // module-level active ref (not the stale activation-local binding) must then bail.
    const newManager = {};
    // `activeRef` stands in for the module-level activeModeManagerRef.
    const revert = () =>
      Promise.resolve().then(() => {
        activeRef = newManager; // a later activation/reroot installed a new manager
      });
    const { manager, startWatching } = makeManager(revert);
    let activeRef: unknown = manager; // starts as the current active manager
    const startWatchers = mock(() => {});

    await runGuardedStartupSweep(manager, () => manager === activeRef, startWatchers);

    expect(startWatching).not.toHaveBeenCalled();
    expect(startWatchers).not.toHaveBeenCalled();
  });

  it('swallows a synchronous throw from startWatchers (never surfaces an unhandled rejection)', async () => {
    const { manager } = makeManager(() => Promise.resolve());
    const startWatchers = mock(() => {
      throw new Error('boom');
    });

    // Must resolve, not reject — the caller void-s this promise.
    await expect(runGuardedStartupSweep(manager, () => true, startWatchers)).resolves.toBeUndefined();
  });

  it('swallows an ASYNC rejection from startWatchers (production setupEntryFileWatcher is async)', async () => {
    const { manager } = makeManager(() => Promise.resolve());
    const startWatchers = mock(() => Promise.reject(new Error('watcher construction failed')));

    await expect(runGuardedStartupSweep(manager, () => true, startWatchers)).resolves.toBeUndefined();
  });
});
