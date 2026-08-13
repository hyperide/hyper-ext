/**
 * @file Tests for runAppModeActivation — the stale-guarded AUTO app-mode activation sequence.
 *
 * Accessed via: the extension host's `activateAppModeForEntry` (src/extension.ts) delegates here.
 * These cover the ordering rules that, if wrong, silently clobber the user's current selection:
 *   a stale activation must roll back (and ONLY its own entry, via the caller's identity guard),
 *   never commit; a step failure must roll back and rethrow; a clean run must commit exactly once.
 */
import { describe, expect, it, mock } from 'bun:test';
import { runAppModeActivation } from '../webview-preview-panel/app-mode-activation';

describe('runAppModeActivation', () => {
  it('runs every step in order then commits when never stale', async () => {
    const order: string[] = [];
    const commit = mock(() => order.push('commit'));
    const rollbackIfOwned = mock(() => order.push('rollback'));

    const result = await runAppModeActivation({
      steps: [
        async () => void order.push('step1'),
        async () => void order.push('step2'),
        async () => void order.push('step3'),
      ],
      isStale: () => false,
      commit,
      rollbackIfOwned,
    });

    expect(result).toBe('committed');
    expect(order).toEqual(['step1', 'step2', 'step3', 'commit']);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollbackIfOwned).not.toHaveBeenCalled();
  });

  it('bails and rolls back after the FIRST step when stale, never running later steps or commit', async () => {
    const order: string[] = [];
    const step2 = mock(async () => void order.push('step2'));
    const commit = mock(() => order.push('commit'));
    const rollbackIfOwned = mock(() => order.push('rollback'));

    const result = await runAppModeActivation({
      steps: [async () => void order.push('step1'), step2],
      isStale: () => true, // stale immediately after step1
      commit,
      rollbackIfOwned,
    });

    expect(result).toBe('stale');
    expect(order).toEqual(['step1', 'rollback']);
    expect(step2).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(rollbackIfOwned).toHaveBeenCalledTimes(1);
  });

  it('bails mid-sequence when staleness appears between steps (rapid A→B selection)', async () => {
    // Models: activation A is rebuilding; selection B lands after A's 2nd step. A must stop and
    // roll back ONLY its own entry — the caller's identity-guarded rollbackIfOwned is a no-op here
    // because B already replaced the active entry, so B stays active.
    const order: string[] = [];
    let staleAfter = 2;
    const isStale = () => {
      staleAfter -= 1;
      return staleAfter <= 0;
    };
    const commit = mock(() => order.push('commit'));
    // Simulate the identity guard: by the time A is stale, B owns the entry → A's rollback no-ops.
    const rollbackIfOwned = mock(() => order.push('rollback-noop(B-still-active)'));

    const result = await runAppModeActivation({
      steps: [
        async () => void order.push('rebuild'),
        async () => void order.push('recompile'),
        async () => void order.push('route-scan'),
      ],
      isStale,
      commit,
      rollbackIfOwned,
    });

    expect(result).toBe('stale');
    // rebuild ran (isStale→1, not stale), recompile ran (isStale→0, stale) → bail before route-scan.
    expect(order).toEqual(['rebuild', 'recompile', 'rollback-noop(B-still-active)']);
    expect(commit).not.toHaveBeenCalled();
  });

  it('rolls back and rethrows when a step fails', async () => {
    const rollbackIfOwned = mock(() => {});
    const commit = mock(() => {});
    const boom = new Error('rebuild failed');

    await expect(
      runAppModeActivation({
        steps: [
          async () => {},
          async () => {
            throw boom;
          },
        ],
        isStale: () => false,
        commit,
        rollbackIfOwned,
      }),
    ).rejects.toThrow('rebuild failed');

    expect(rollbackIfOwned).toHaveBeenCalledTimes(1);
    expect(commit).not.toHaveBeenCalled();
  });

  it('commits with zero steps (degenerate) — no rollback', async () => {
    const commit = mock(() => {});
    const rollbackIfOwned = mock(() => {});
    const result = await runAppModeActivation({ steps: [], isStale: () => false, commit, rollbackIfOwned });
    expect(result).toBe('committed');
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollbackIfOwned).not.toHaveBeenCalled();
  });
});
