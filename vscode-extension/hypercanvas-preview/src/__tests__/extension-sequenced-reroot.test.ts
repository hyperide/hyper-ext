/**
 * @file Unit tests for createSequencedReroot — guards the monorepo preview
 * re-root against stale resolveActiveProjectRoot callbacks.
 *
 * Accessed via: extension.ts activate() → stateHub.onChange currentComponent
 *               selection handler (HYP-420 monorepo sub-project reroot).
 * Assumptions: resolveActiveProjectRoot is async (filesystem walk), so an
 *              earlier selection's resolve can finish AFTER a newer one.
 * Past bugs: P2 #277 (codex) — stale callback re-rooted previewManager /
 *            modeManager / devServerManager to the OLD sub-project before the
 *            freshness check, so preview generation / dev-server start ran in
 *            the wrong package.
 */
import { describe, expect, it } from 'bun:test';
import { createSequencedReroot } from '../extension-utils';

/** A promise whose resolution is controlled manually by the test. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('createSequencedReroot', () => {
  it('reroots on the single (happy-path) selection', async () => {
    const rerooted: string[] = [];
    const run = createSequencedReroot({
      resolveRoot: async (c) => `/repo/packages/${c}`,
      reroot: (root) => rerooted.push(root),
    });

    const result = await run('app-a');

    expect(result).toEqual({ root: '/repo/packages/app-a', stale: false });
    expect(rerooted).toEqual(['/repo/packages/app-a']);
  });

  it('does NOT reroot when a newer selection landed before the stale resolve finished', async () => {
    const rerooted: string[] = [];
    const dA = deferred<string>();
    const dB = deferred<string>();
    const resolvers: Record<string, Promise<string>> = {
      'app-a': dA.promise,
      'app-b': dB.promise,
    };

    const run = createSequencedReroot({
      resolveRoot: (c) => resolvers[c],
      reroot: (root) => rerooted.push(root),
    });

    // Selection A starts first (seq 1), then selection B (seq 2) — both in flight.
    const pA = run('app-a');
    const pB = run('app-b');

    // B resolves first and reroots to its sub-project.
    dB.resolve('/repo/packages/app-b');
    const rB = await pB;
    expect(rB).toEqual({ root: '/repo/packages/app-b', stale: false });

    // A resolves LAST — it is stale and must NOT reroot back to app-a.
    dA.resolve('/repo/packages/app-a');
    const rA = await pA;
    expect(rA).toEqual({ root: '/repo/packages/app-a', stale: true });

    // The pipeline ends up rooted at B only — A never touched it.
    expect(rerooted).toEqual(['/repo/packages/app-b']);
  });

  it('keeps the newest selection even across three rapid selections (A→B→C, resolving out of order)', async () => {
    const rerooted: string[] = [];
    const dA = deferred<string>();
    const dB = deferred<string>();
    const dC = deferred<string>();
    const resolvers: Record<string, Promise<string>> = {
      'app-a': dA.promise,
      'app-b': dB.promise,
      'app-c': dC.promise,
    };

    const run = createSequencedReroot({
      resolveRoot: (c) => resolvers[c],
      reroot: (root) => rerooted.push(root),
    });

    const pA = run('app-a');
    const pB = run('app-b');
    const pC = run('app-c');

    // Resolve in scrambled order: A, C, B.
    dA.resolve('/repo/packages/app-a');
    dC.resolve('/repo/packages/app-c');
    dB.resolve('/repo/packages/app-b');

    const [rA, rB, rC] = await Promise.all([pA, pB, pC]);

    expect(rA.stale).toBe(true);
    expect(rB.stale).toBe(true);
    expect(rC.stale).toBe(false);
    // Only C — the latest selection — ever reroots the pipeline.
    expect(rerooted).toEqual(['/repo/packages/app-c']);
  });
});
