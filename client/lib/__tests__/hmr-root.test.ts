import { describe, expect, mock, test } from 'bun:test';
import type { Root } from 'react-dom/client';
import { getOrCreateHmrRoot } from '../hmr-root';

// Regression coverage for HYP-1380 (PR #764): client/App.tsx guards createRoot() against Bun
// HMR double-mount by reusing a root stashed on import.meta.hot.data across re-evaluations. The
// PR that landed the fix cited `bun test client/__tests__/browser-bundle-safety.test.ts` as its
// test-plan evidence, but that test is HYP-855's unrelated `import.meta.env` tripwire — nothing
// in this repo's own suite actually exercised the reuse-vs-recreate logic before this file.
// getOrCreateHmrRoot is the extracted, side-effect-free core of that logic (see App.tsx); this
// tests it directly rather than importing App.tsx, which mounts a real app on import.

describe('getOrCreateHmrRoot (HYP-1380)', () => {
  test('creates a root on the first call and stores it on hotData', () => {
    const fakeRoot = { render: mock(() => undefined), unmount: mock(() => undefined) } as unknown as Root;
    const createRoot = mock(() => fakeRoot);
    const hotData: { root?: Root } = {};

    const root = getOrCreateHmrRoot(hotData, createRoot);

    expect(root).toBe(fakeRoot);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(hotData.root).toBe(fakeRoot);
  });

  test('reuses the stored root on a later call — never calls createRoot again', () => {
    const fakeRoot = { render: mock(() => undefined), unmount: mock(() => undefined) } as unknown as Root;
    const createRoot = mock(() => fakeRoot);
    const hotData: { root?: Root } = { root: fakeRoot };

    const root = getOrCreateHmrRoot(hotData, createRoot);

    expect(root).toBe(fakeRoot);
    expect(createRoot).not.toHaveBeenCalled();
  });

  test('simulated HMR cycle: two calls sharing one hotData object return the SAME root', () => {
    // This is the actual double-mount scenario: Bun re-executes the module (a fresh
    // getOrCreateHmrRoot call) on every hot-reload cycle, but import.meta.hot.data survives
    // across cycles — modeled here by reusing the same hotData object for both calls.
    const roots: Root[] = [];
    const createRoot = mock(() => {
      const r = { render: mock(() => undefined), unmount: mock(() => undefined) } as unknown as Root;
      roots.push(r);
      return r;
    });
    const hotData: { root?: Root } = {};

    const first = getOrCreateHmrRoot(hotData, createRoot);
    const second = getOrCreateHmrRoot(hotData, createRoot);

    expect(first).toBe(second);
    expect(createRoot).toHaveBeenCalledTimes(1);
    expect(roots).toHaveLength(1);
  });
});
