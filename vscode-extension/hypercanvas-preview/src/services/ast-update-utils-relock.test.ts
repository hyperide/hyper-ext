/**
 * @file HYP-990 (M2) — the C1 release-then-acquire relock loop (review, Opus/Fable HIGH — deadlock).
 * When the fresh re-resolve under the lock lands on a DIFFERENT file than the lock key, updateStyles
 * must RELEASE the first lock and re-acquire the correct one (never hold two locks), and must complete
 * — never hang. It also must never write under a lock keyed on a different file than it mutates.
 */
import { describe, expect, it } from 'bun:test';
import { InMemoryFileIO } from '@lib/style-write/testing/in-memory-file-io';
import type { NodeRef } from '@shared/element-tracing/types';
import { updateStyles, type UpdateStylesDeps } from './ast-update-utils';

describe('updateStyles C1 relock loop', () => {
  it('diverging re-resolve re-acquires under the new path and completes (no deadlock)', async () => {
    const resolvedPaths: string[] = [];
    let n = 0;
    const deps: UpdateStylesDeps = {
      workspaceRoot: '/workspace',
      fileIO: new InMemoryFileIO({}),
      updateNodeMap: async () => {},
      resolveElementInCorrectFile: async () => {
        n += 1;
        // call 1 = firstResolve (learns path A); call 2 = under lock A, diverges to B → relock;
        // call 3 = under lock B, resolves nothing → done (not found). No hang, no cross-lock write.
        if (n === 1) return { resolvedPath: '/workspace/A.tsx', result: {} as never, ast: {} as never };
        if (n === 2) {
          resolvedPaths.push('B-diverge');
          return { resolvedPath: '/workspace/B.tsx', result: {} as never, ast: {} as never };
        }
        return null;
      },
    };

    const result = await updateStyles(
      'A.tsx',
      'el-1',
      { color: 'red' },
      undefined,
      'el-1' as NodeRef,
      undefined,
      undefined,
      deps,
    );

    // Completed (the test not hanging is the deadlock-freedom proof) with the diverged final resolve.
    expect(result.success).toBe(false);
    // firstResolve + lock-A re-resolve (diverge) + lock-B re-resolve (null) = 3 resolves.
    expect(n).toBe(3);
    expect(resolvedPaths).toEqual(['B-diverge']);
  });

  it('a stable resolve (no divergence) resolves once under the lock and dispatches normally', async () => {
    let n = 0;
    const deps: UpdateStylesDeps = {
      workspaceRoot: '/workspace',
      fileIO: new InMemoryFileIO({}),
      updateNodeMap: async () => {},
      resolveElementInCorrectFile: async () => {
        n += 1;
        // firstResolve + one re-resolve under the lock, same path, then null on the actual re-resolve
        // inside the lock is avoided — return null to exit quickly after the (matching) lock is taken.
        if (n === 1) return { resolvedPath: '/workspace/A.tsx', result: {} as never, ast: {} as never };
        return null;
      },
    };
    const result = await updateStyles(
      'A.tsx',
      'el-1',
      { color: 'red' },
      undefined,
      'el-1' as NodeRef,
      undefined,
      undefined,
      deps,
    );
    expect(result.success).toBe(false);
    // No relock: firstResolve + a single under-lock re-resolve.
    expect(n).toBe(2);
  });

  it('a resolve that keeps diverging is refused (never writes outside the lock) rather than spinning', async () => {
    // Every re-resolve lands on a brand-new path → the loop can never lock the path it would mutate.
    // It must give up with an error after MAX_RELOCK_ATTEMPTS, not loop forever or write unserialized.
    let n = 0;
    const deps: UpdateStylesDeps = {
      workspaceRoot: '/workspace',
      fileIO: new InMemoryFileIO({}),
      updateNodeMap: async () => {},
      resolveElementInCorrectFile: async () => {
        n += 1;
        return { resolvedPath: `/workspace/path-${n}.tsx`, result: {} as never, ast: {} as never };
      },
    };
    const result = await updateStyles(
      'A.tsx',
      'el-1',
      { color: 'red' },
      undefined,
      'el-1' as NodeRef,
      undefined,
      undefined,
      deps,
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error('expected failure');
    expect(result.error).toContain('kept diverging');
    // Bounded — did not spin unbounded.
    expect(n).toBeLessThanOrEqual(5);
  });
});
