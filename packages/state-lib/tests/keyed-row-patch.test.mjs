import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
const path = new URL('../adapters/dom/keyed-row-patch.mjs', import.meta.url);
const deltaPath = new URL('../adapters/dom/immutable-row-delta.mjs', import.meta.url);
async function load() {
  assert(existsSync(path) && existsSync(deltaPath), 'The shared keyed row patch boundary and its planner exist');
  return { ...(await import(path.href)), ...(await import(deltaPath.href)) };
}
const key = (row) => row.id;

test('a missing target rejects the whole plan before any callback writes', async () => {
  const { patchKeyedRows } = await load();
  const log = [];
  const changes = [{ key: 'a' }, { key: 'b' }, { key: 'c' }];
  const ok = patchKeyedRows(changes, {
    locate: (change) => (change.key === 'c' ? null : change.key),
    apply: (change) => log.push(`apply:${change.key}`),
    beforeApply: () => log.push('before'),
  });
  assert.equal(ok, false);
  assert.deepEqual(log, []);
});
test('a throwing locator leaves no writes and propagates', async () => {
  const { patchKeyedRows } = await load();
  const log = [];
  assert.throws(
    () =>
      patchKeyedRows([{ key: 'a' }, { key: 'b' }], {
        locate: (change) => {
          if (change.key === 'b') throw Error('locate failed');
          return change.key;
        },
        apply: (change) => log.push(change.key),
        beforeApply: () => log.push('before'),
      }),
    /locate failed/,
  );
  assert.deepEqual(log, []);
});
test('a null plan reports false and calls nothing', async () => {
  const { patchKeyedRows } = await load();
  let calls = 0;
  const bump = () => calls++;
  assert.equal(patchKeyedRows(null, { locate: bump, apply: bump, beforeApply: bump }), false);
  assert.equal(calls, 0);
});
test('an accepted empty plan runs only beforeApply, so the original cleanup ordering is preserved', async () => {
  const { patchKeyedRows } = await load();
  const log = [];
  assert.equal(
    patchKeyedRows([], {
      locate: () => log.push('locate'),
      apply: () => log.push('apply'),
      beforeApply: () => log.push('before'),
    }),
    true,
  );
  assert.deepEqual(log, ['before']);
});
test('beforeApply runs once after every locate and before the first apply; apply receives its located target in order', async () => {
  const { patchKeyedRows } = await load();
  const log = [];
  const changes = [{ key: 'x' }, { key: 'y' }];
  assert.equal(
    patchKeyedRows(changes, {
      locate: (change) => (log.push(`locate:${change.key}`), { node: change.key.toUpperCase() }),
      apply: (change, target) => log.push(`apply:${change.key}:${target.node}`),
      beforeApply: () => log.push('before'),
    }),
    true,
  );
  assert.deepEqual(log, ['locate:x', 'locate:y', 'before', 'apply:x:X', 'apply:y:Y']);
});
test('beforeApply is optional', async () => {
  const { patchKeyedRows } = await load();
  const seen = [];
  assert.equal(patchKeyedRows([{ key: 'a' }], { locate: () => 1, apply: (c) => seen.push(c.key) }), true);
  assert.deepEqual(seen, ['a']);
});

// Seeded independent model: planner + boundary writes must reach exactly the changed rows,
// and every non-field difference must be refused before apply is reached.
function rng(seed) {
  let s = seed;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}
// Only "text" is a field-only edit the boundary must write; every other scenario must be refused.
const scenarios = {
  text: ({ rand, before, after, model, round }) => {
    for (let i = 0; i < before.length; i++)
      if (rand() < 0.4) {
        after[i] = { ...after[i], text: `N${round}${i}` };
        model.set(after[i].id, after[i].text);
      }
  },
  swap: ({ after }) => {
    [after[0], after[1]] = [after[1], after[0]];
  },
  tag: ({ after }) => {
    after[0] = { ...after[0], tag: 'x' };
  },
  duplicate: ({ before, after }) => {
    // Both snapshots carry the duplicate, so only the planner's duplicate-key check can refuse it.
    before[before.length - 1] = after[after.length - 1] = { id: 'r0', text: 'dup', tag: '' };
  },
  rename: ({ after }) => {
    after[0] = { ...after[0], id: 'renamed' };
  },
  hole: ({ after }) => {
    delete after[0];
  },
};
function pickScenario(kind, n) {
  if (kind < 0.55) return 'text';
  if (kind < 0.65 && n > 1) return 'swap';
  if (kind < 0.75) return 'tag';
  if (kind < 0.85 && n > 1) return 'duplicate';
  if (kind < 0.92) return 'rename';
  return 'hole';
}
test('planner plus boundary equal an independent model for random edits and refuse structural change', async () => {
  const { patchKeyedRows, immutableRowDelta } = await load();
  const rand = rng(1740);
  for (let round = 0; round < 300; round++) {
    const n = 1 + Math.floor(rand() * 8);
    const before = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, text: `T${i}`, tag: '' }));
    const after = before.slice();
    const model = new Map(before.map((r) => [r.id, r.text]));
    const scenario = pickScenario(rand(), n);
    scenarios[scenario]({ rand, before, after, model, round });
    const expectRefuse = scenario !== 'text';
    const dom = new Map(before.map((r) => [r.id, r.text]));
    const writes = [];
    // Only the projection field is checked here, so key, duplicate and sparse refusals must come from the planner itself.
    const accepts = (a, b) => a.tag === b.tag;
    const plan = immutableRowDelta(before, after, key, accepts);
    const ok = patchKeyedRows(plan, {
      locate: (change) => (dom.has(change.key) ? change.key : null),
      apply: (change) => (writes.push(change.key), dom.set(change.key, change.after.text)),
    });
    if (expectRefuse) {
      assert.equal(ok, false, `round ${round}`);
      assert.deepEqual(writes, []);
    } else {
      assert.equal(ok, true);
      assert.deepEqual([...dom], [...model]);
      assert.deepEqual(
        writes,
        before.filter((r, i) => after[i] !== r).map((r) => r.id),
      );
    }
  }
});
test('a plan the planner accepts is refused, with no writes, when the view lacks a changed row', async () => {
  const { patchKeyedRows, immutableRowDelta } = await load();
  const before = [
    { id: 'a', text: 'A' },
    { id: 'b', text: 'B' },
  ];
  const after = [before[0], { id: 'b', text: 'B2' }];
  const dom = new Map([['a', 'A']]);
  const writes = [];
  const plan = immutableRowDelta(before, after, key);
  assert.equal(plan.length, 1);
  const ok = patchKeyedRows(plan, {
    locate: (change) => (dom.has(change.key) ? change.key : null),
    apply: (change) => writes.push(change.key),
  });
  assert.equal(ok, false);
  assert.deepEqual(writes, []);
});
test('unchanged snapshot identity is an empty plan and writes nothing', async () => {
  const { patchKeyedRows, immutableRowDelta } = await load();
  const rows = [{ id: 'a' }];
  const writes = [];
  assert.equal(
    patchKeyedRows(immutableRowDelta(rows, rows, key), { locate: () => 1, apply: () => writes.push(1) }),
    true,
  );
  assert.deepEqual(writes, []);
});
test('a falsy but real target (index 0, empty key) is accepted; only null, undefined and false reject', async () => {
  const { patchKeyedRows } = await load();
  const seen = [];
  assert.equal(
    patchKeyedRows([{ key: 'a' }, { key: 'b' }], {
      locate: (c) => (c.key === 'a' ? 0 : ''),
      apply: (c, t) => seen.push([c.key, t]),
    }),
    true,
  );
  assert.deepEqual(seen, [
    ['a', 0],
    ['b', ''],
  ]);
  for (const bad of [null, undefined, false])
    assert.equal(patchKeyedRows([{ key: 'a' }], { locate: () => bad, apply: () => seen.push('x') }), false);
  assert.equal(seen.length, 2);
});
test('an exception from apply propagates; earlier rows stay written (documented dirty-view contract)', async () => {
  const { patchKeyedRows } = await load();
  const written = [];
  assert.throws(
    () =>
      patchKeyedRows([{ key: 'a' }, { key: 'b' }, { key: 'c' }], {
        locate: (c) => c.key,
        apply: (c) => {
          if (c.key === 'b') throw Error('apply failed');
          written.push(c.key);
        },
      }),
    /apply failed/,
  );
  assert.deepEqual(written, ['a']);
});
test('an exception from beforeApply propagates before any row is written', async () => {
  const { patchKeyedRows } = await load();
  const written = [];
  assert.throws(
    () =>
      patchKeyedRows([{ key: 'a' }], {
        locate: () => 1,
        beforeApply: () => {
          throw Error('cleanup failed');
        },
        apply: (c) => written.push(c.key),
      }),
    /cleanup failed/,
  );
  assert.deepEqual(written, []);
});
