import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const path = new URL('../adapters/dom/immutable-row-delta.mjs', import.meta.url);
async function load() {
  assert(existsSync(path), 'The shared immutable row delta adapter exists');
  return import(path.href);
}
const key = (row) => row.id;
test('unchanged snapshots do no row work and changed snapshots identify only changed rows', async () => {
  const { immutableRowDelta } = await load();
  const a = Object.freeze({ id: 'a', done: false }),
    b = Object.freeze({ id: 'b', done: false });
  const rows = Object.freeze([a, b]);
  let calls = 0;
  assert.deepEqual(
    immutableRowDelta(rows, rows, () => {
      calls++;
      throw Error('not needed');
    }),
    [],
  );
  assert.equal(calls, 0);
  const changed = Object.freeze({ ...b, done: true });
  assert.deepEqual(immutableRowDelta(rows, [a, changed], key), [{ key: 'b', before: b, after: changed, index: 1 }]);
});
test('reordered, inserted, missing and duplicate identities require a full reset', async () => {
  const { immutableRowDelta } = await load();
  const a = { id: 'a' },
    b = { id: 'b' };
  for (const after of [[b, a], [a], [a, b, { id: 'c' }], [a, { id: 'a' }], [a, { id: '' }], new Array(2)])
    assert.equal(immutableRowDelta([a, b], after, key), null);
});
test('unsupported field changes reject the complete delta before any view work', async () => {
  const { immutableRowDelta } = await load();
  const rows = [
    { id: 'a', done: false, text: 'A' },
    { id: 'b', done: false, text: 'B' },
  ];
  const accept = (a, b) => a.text === b.text;
  assert.equal(
    immutableRowDelta(
      rows,
      [
        { ...rows[0], done: true },
        { ...rows[1], text: 'changed' },
      ],
      key,
      accept,
    ),
    null,
  );
  assert.equal(immutableRowDelta(rows, [{ ...rows[0], done: true }, rows[1]], key, accept).length, 1);
});
