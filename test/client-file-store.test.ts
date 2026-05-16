import { beforeEach, expect, test } from 'bun:test';
import { makeStore } from '../client/lib/client-file-store/opfs';

let store: ReturnType<typeof makeStore>;
beforeEach(() => {
  store = makeStore();
});

test('writeFile and readFiles round-trip', async () => {
  await store.writeFile('proj1', 'src/App.tsx', 'export default function App() {}');
  const files = await store.readFiles('proj1');
  expect(files['src/App.tsx']).toBe('export default function App() {}');
});

test('readFiles returns empty object when project not seeded', async () => {
  const files = await store.readFiles('unknown-proj');
  expect(files).toEqual({});
});

test('seedFiles bulk-writes and readFiles returns all', async () => {
  await store.seedFiles('proj2', {
    'package.json': '{"name":"test"}',
    'src/main.tsx': 'import React from "react"',
  });
  const files = await store.readFiles('proj2');
  expect(Object.keys(files)).toHaveLength(2);
  expect(files['package.json']).toBe('{"name":"test"}');
});

test('writeFile overwrites existing file', async () => {
  await store.seedFiles('proj3', { 'a.ts': 'v1' });
  await store.writeFile('proj3', 'a.ts', 'v2');
  const files = await store.readFiles('proj3');
  expect(files['a.ts']).toBe('v2');
});

test('clearProject removes all files for a project', async () => {
  await store.seedFiles('proj4', { 'a.ts': 'x', 'b.ts': 'y' });
  await store.clearProject('proj4');
  const files = await store.readFiles('proj4');
  expect(files).toEqual({});
});
