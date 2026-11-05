import { test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { Runtime } from '../../runtime/src/core';
import { setJsonScalar, beginJsonDraft } from '../2026-09-19-cow/json-draft.mjs';
async function create() {
  const path = new URL('../2026-09-19-cow/document-publication.mjs', import.meta.url);
  expect(existsSync(path)).toBe(true);
  const { createDocumentPublication } = await import('../2026-09-19-cow/document-publication.mjs');
  return createDocumentPublication(new Runtime(), { initial: { title: 'old', rows: [] }, limit: 3 });
}
test('shared publication has stable external shape and atomic document/history', async () => {
  const store = await create(),
    old = store.getSnapshot(),
    seen: ReturnType<typeof store.getSnapshot>[] = [];
  store.subscribe(() => seen.push(store.getSnapshot()));
  store.apply((base, args) => setJsonScalar(base, ['title'], args), 'new');
  expect(seen.length).toBe(1);
  expect(seen[0].canUndo).toBe(true);
  expect(seen[0].document!.title).toBe('new');
  expect(Object.keys(seen[0]).sort()).toEqual(['canRedo', 'canUndo', 'document']);
  expect(old.document!.title).toBe('old');
  expect(store.undo()).toBe(true);
  expect(store.read()!.title).toBe('old');
  expect(store.redo()).toBe(true);
  expect(store.read()!.title).toBe('new');
  store.dispose();
});
test('draft bridge exposes private working state without publishing it', async () => {
  const store = await create(),
    old = store.getSnapshot();
  let count = 0;
  store.subscribe(() => count++);
  store.transact((before, expose) => {
    const tx = beginJsonDraft(before);
    expose(tx.draft);
    tx.draft.title = 'draft';
    expect(store.read()!.title).toBe('draft');
    expect(store.getSnapshot()).toBe(old);
    expect(count).toBe(0);
    return tx.finish();
  });
  expect(count).toBe(1);
  expect(store.read()!.title).toBe('draft');
  store.dispose();
});
test('failed and nested transformations cannot publish partial state', async () => {
  const store = await create(),
    old = store.getSnapshot();
  expect(() => store.apply(() => ({ title: 'foreign' }), null)).toThrow('owned');
  expect(() =>
    store.transact(() => {
      store.clear();
      return old.document;
    }),
  ).toThrow('Nested');
  expect(store.getSnapshot()).toBe(old);
  expect(store.canUndo).toBe(false);
  store.dispose();
});
test('async results are rejected, late failures consumed and cleanup preserved', async () => {
  const store = await create(),
    old = store.getSnapshot();
  expect(() =>
    store.apply(async () => {
      throw Error('late');
    }, null),
  ).toThrow('synchronous');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(store.getSnapshot()).toBe(old);
  store.dispose();
  expect(() => store.read()).toThrow('disposed');
});
test('history is bounded and a successful no-op still records a command', async () => {
  const store = await create();
  for (let n = 0; n < 5; n++) store.apply((base) => setJsonScalar(base, ['title'], 'same'), null);
  let undos = 0;
  while (store.undo()) undos++;
  expect(undos).toBe(3);
  store.clear();
  expect(store.read()).toBe(null);
  expect(store.apply((base) => base, null)).toBe(false);
  store.replace({ title: 'reset', rows: [] });
  expect(store.canUndo).toBe(false);
  store.dispose();
});
test('an expired draft exposure cannot redirect reads in a later transaction', async () => {
  const store = await create();
  let stale!: (value: unknown) => void;
  store.transact((base, expose) => {
    stale = expose;
    return setJsonScalar(base, ['title'], 'first');
  });
  expect(() => stale({ title: 'late' })).toThrow('active transaction');
  store.transact((base) => {
    expect(() => stale({ title: 'wrong' })).toThrow('active transaction');
    expect(store.read()).toBe(base);
    return setJsonScalar(base, ['title'], 'second');
  });
  expect(store.read()!.title).toBe('second');
  store.dispose();
});
