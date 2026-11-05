import test from 'node:test';
import assert from 'node:assert/strict';
import * as json from '../2026-09-19-cow/json-draft.mjs';
const seed = () => ({
  title: 'old',
  columns: [
    {
      id: 'a',
      items: [
        { id: '1', text: 'one', done: false },
        { id: '2', text: 'two', done: true },
      ],
    },
    { id: 'b', items: [] },
  ],
});
const begin = (base) => {
  assert.equal(typeof json.beginJsonCommand, 'function', 'Shared private command builder is implemented');
  return json.beginJsonCommand(base);
};
const update = (base, run) => {
  const tx = begin(base);
  try {
    run(tx);
    return tx.finish();
  } catch (error) {
    tx.abort();
    throw error;
  }
};
test('point and dense commands preserve immutable history and share untouched nodes', () => {
  const base = json.ownJson(seed()),
    tx = begin(base);
  tx.set(['columns', 0, 'items', 0, 'text'], 'new');
  tx.toggle(['columns', 0, 'items', 0, 'done']);
  const next = tx.finish();
  assert.equal(next.columns[0].items[0].text, 'new');
  assert.equal(next.columns[0].items[0].done, true);
  assert.equal(base.columns[0].items[0].text, 'one');
  assert.equal(next.columns[1], base.columns[1]);
  assert.equal(next.columns[0].items[1], base.columns[0].items[1]);
  assert.equal(tx.copiedContainers, 5);
  assert(Object.isFrozen(next.columns[0].items[0]));
});
test('bulk writes copy each touched row once and support a sparse stride', () => {
  const base = json.ownJson(seed()),
    tx = begin(base);
  tx.assignEach(['columns', 0, 'items'], 'text', 'bulk');
  tx.assignEach(['columns', 0, 'items'], 'done', false, 2);
  const next = tx.finish();
  assert.deepEqual(
    next.columns[0].items.map((x) => x.text),
    ['bulk', 'bulk'],
  );
  assert.deepEqual(
    next.columns[0].items.map((x) => x.done),
    [false, true],
  );
  assert.equal(tx.copiedContainers, 6);
});
test('moves reuse row payload and subsequent edits target its new location', () => {
  const base = json.ownJson(seed()),
    tx = begin(base);
  tx.move(['columns', 0, 'items'], 0, ['columns', 1, 'items'], 0);
  tx.set(['columns', 1, 'items', 0, 'text'], 'moved');
  const next = tx.finish();
  assert.equal(next.columns[0].items[0], base.columns[0].items[1]);
  assert.equal(next.columns[1].items[0].text, 'moved');
  assert.equal(base.columns[1].items.length, 0);
  assert.equal(base.columns[0].items[0].text, 'one');
});
test('same-array move uses destination index after removal and can be undone on an old root', () => {
  const base = json.ownJson(seed()),
    next = update(base, (tx) => tx.move(['columns', 0, 'items'], 0, ['columns', 0, 'items'], 1));
  assert.deepEqual(
    next.columns[0].items.map((x) => x.id),
    ['2', '1'],
  );
  assert.equal(next.columns[0].items[1], base.columns[0].items[0]);
  const other = update(base, (tx) => tx.set(['title'], 'branch'));
  assert.equal(other.columns, base.columns);
});
test('successful no-op publishes a new root without copying unchanged children', () => {
  const base = json.ownJson(seed()),
    tx = begin(base);
  tx.set(['title'], 'old');
  const next = tx.finish();
  assert.notEqual(next, base);
  assert.equal(next.columns, base.columns);
  assert.equal(tx.copiedContainers, 1);
});
test('command output re-enters ordinary COW without import or alias loss', () => {
  const base = json.ownJson(seed()),
    next = update(base, (tx) => tx.set(['title'], 'command'));
  const draft = json.beginJsonDraft(next);
  assert.equal(draft.strategy, 'cow');
  draft.draft.columns[0].items[0].done = true;
  const after = draft.finish();
  assert.equal(next.columns[0].items[0].done, false);
  assert.equal(after.columns[0].items[0].done, true);
  const last = update(after, (tx) => tx.set(['title'], 'back'));
  assert.equal(last.columns, after.columns);
});
test('aliased and external inputs use the full-copy path and preserve alias semantics', () => {
  const row = { v: 1 },
    base = json.ownJson({ a: row, b: row }),
    tx = begin(base);
  assert.equal(tx.strategy, 'copy');
  tx.set(['a', 'v'], 2);
  const next = tx.finish();
  assert.equal(next.a, next.b);
  assert.equal(next.b.v, 2);
  assert.equal(base.b.v, 1);
  const raw = seed(),
    imported = begin(raw);
  assert.equal(imported.strategy, 'copy');
  imported.set(['title'], 'safe');
  const after = imported.finish();
  raw.columns[0].items[0].text = 'outside';
  assert.equal(after.columns[0].items[0].text, 'one');
});
test('failed operations cannot publish earlier private edits or modify the source', () => {
  const base = json.ownJson(seed());
  for (const fail of [
    (tx) => tx.set(['title'], NaN),
    (tx) => tx.set(['missing'], 1),
    (tx) => tx.toggle(['title']),
    (tx) => tx.move(['columns', 0, 'items'], 9, ['columns', 1, 'items'], 0),
    (tx) => tx.assignEach(['columns', 0, 'items'], 'text', 'x', 0),
  ]) {
    const tx = begin(base);
    tx.set(['title'], 'private');
    assert.throws(() => fail(tx));
    assert.throws(() => tx.finish());
    assert.equal(base.title, 'old');
  }
});
test('dense nested groups share untouched columns and retain empty arrays', () => {
  const base = json.ownJson(seed()),
    tx = begin(base);
  tx.assignGroups(['columns'], 'items', 'text', 'same');
  const next = tx.finish();
  assert.equal(next.columns[1], base.columns[1]);
  assert.equal(next.columns[0].items[1].text, 'same');
});
test('prototype names remain own data and invalid paths cannot mutate prototypes', () => {
  const base = json.ownJson(JSON.parse('{"__proto__":{"v":1},"constructor":0}'));
  const next = update(base, (tx) => {
    tx.set(['__proto__', 'v'], 2);
    tx.set(['constructor'], 3);
  });
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
  assert.equal(next.__proto__.v, 2);
  assert.equal(base.__proto__.v, 1);
  assert.throws(() => update(json.ownJson({}), (tx) => tx.set(['__proto__', 'polluted'], 1)));
  assert.equal({}.polluted, undefined);
});
test('closed builders expose no mutable draft and cannot mutate published results', () => {
  const tx = begin(json.ownJson(seed()));
  assert.equal(tx.draft, undefined);
  tx.set(['title'], 'done');
  const next = tx.finish();
  assert.throws(() => tx.set(['title'], 'late'));
  assert.throws(() => tx.finish());
  assert.equal(next.title, 'done');
});
test('overlapping structural moves are rejected instead of creating cycles', () => {
  const base = json.ownJson({ rows: [{ children: [] }] });
  assert.throws(() => update(base, (tx) => tx.move(['rows'], 0, ['rows', 0, 'children'], 0)));
  assert.equal(base.rows.length, 1);
});
test('300 mixed declared commands match a full-copy reference after every step', () => {
  let actual = json.ownJson(seed()),
    expected = structuredClone(actual);
  for (let i = 0; i < 300; i++) {
    const tx = begin(actual),
      ref = structuredClone(expected);
    if (i % 3 === 0) {
      const from = ref.columns[0].items.length ? 0 : 1,
        to = 1 - from;
      tx.move(['columns', from, 'items'], 0, ['columns', to, 'items'], 0);
      ref.columns[to].items.splice(0, 0, ref.columns[from].items.splice(0, 1)[0]);
    } else if (i % 3 === 1) {
      tx.assignGroups(['columns'], 'items', 'text', `edit${i}`);
      for (const col of ref.columns) for (const item of col.items) item.text = `edit${i}`;
    } else {
      tx.set(['title'], `title${i}`);
      ref.title = `title${i}`;
    }
    const old = actual;
    actual = tx.finish();
    assert.deepEqual(actual, ref);
    assert.deepEqual(old, expected);
    expected = ref;
  }
});
test('declared factories share the private builder and abort an asynchronous recipe', async () => {
  assert.equal(typeof json.defineJsonCommand, 'function');
  const change = json.defineJsonCommand((tx, args) => tx.set(['title'], args.title));
  const base = json.ownJson(seed());
  assert.equal(change(base, { title: 'new' }).title, 'new');
  assert.equal(base.title, 'old');
  let escaped;
  const bad = json.defineJsonCommand(async (tx) => {
    escaped = tx;
    tx.set(['title'], 'partial');
    await Promise.resolve();
    tx.set(['title'], 'late');
  });
  assert.throws(() => bad(base, {}), /synchronous/);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.throws(() => escaped.finish());
  assert.equal(base.title, 'old');
});
test('single-operation helpers preserve the general builder contract for trees and aliases', () => {
  for (const own of [(value) => value, json.ownJson]) {
    const shared = { text: 'old', done: false };
    for (const raw of [
      {
        rows: [
          { text: 'a', done: false },
          { text: 'b', done: true },
        ],
      },
      { rows: [shared, shared] },
    ]) {
      const base = own(raw),
        saved = structuredClone(base);
      const direct = json.setJsonEach(base, ['rows'], 'text', 'next');
      const expected = update(base, (tx) => tx.assignEach(['rows'], 'text', 'next'));
      assert.deepEqual(direct, expected);
      assert.deepEqual(base, saved);
      assert(Object.isFrozen(direct.rows));
      if (raw.rows[0] === raw.rows[1]) assert.equal(direct.rows[0], direct.rows[1]);
      const one = json.toggleJsonScalar(direct, ['rows', 0, 'done']);
      assert.equal(one.rows[0].done, true);
      assert.equal(direct.rows[0].done, false);
    }
  }
});
test('direct moves copy the common ancestor once and preserve branch identities', () => {
  const raw = {
      left: { list: [{ id: 1 }, { id: 2 }], keep: { x: 1 } },
      right: { list: [], keep: { x: 2 } },
      keep: { x: 3 },
    },
    base = json.ownJson(raw);
  const next = json.moveJsonItem(base, ['left', 'list'], 1, ['right', 'list'], 0);
  assert.equal(next.left.keep, base.left.keep);
  assert.equal(next.right.keep, base.right.keep);
  assert.equal(next.keep, base.keep);
  assert.equal(next.right.list[0], base.left.list[1]);
  assert.equal(base.right.list.length, 0);
  assert.deepEqual(
    next,
    update(base, (tx) => tx.move(['left', 'list'], 1, ['right', 'list'], 0)),
  );
});
test('direct empty and invalid commands preserve source and publication ownership', () => {
  const base = json.ownJson({ columns: [{ items: [] }], flag: false });
  const next = json.setJsonGroups(base, ['columns'], 'items', 'text', 'x');
  assert.notEqual(next, base);
  assert.equal(next.columns, base.columns);
  assert(json.isOwnedJsonSnapshot(next));
  assert.throws(() => json.setJsonEach(base, ['columns'], 'missing', 'x'));
  assert.equal(base.columns.length, 1);
  assert.throws(() => json.setJsonScalar(base, ['flag'], {}));
  assert.equal(base.flag, false);
});
test('instruction paths reject holes instead of interpreting them as a field named undefined', () => {
  const base = json.ownJson({ undefined: 1 });
  const hole = new Array(1);
  assert.throws(() => json.setJsonScalar(base, hole, 2));
  assert.equal(base.undefined, 1);
  assert.throws(() => update(base, (tx) => tx.set(hole, 2)));
});
test('direct same-array moves and data-like prototype keys preserve the ordinary contract', () => {
  const base = json.ownJson({ rows: [{ v: 1 }, { v: 2 }, { v: 3 }] });
  for (const [from, to] of [
    [0, 2],
    [2, 0],
    [1, 1],
  ]) {
    const direct = json.moveJsonItem(base, ['rows'], from, ['rows'], to);
    assert.deepEqual(
      direct,
      update(base, (tx) => tx.move(['rows'], from, ['rows'], to)),
    );
    assert.equal(base.rows[0].v, 1);
  }
  const proto = json.ownJson(JSON.parse('{"__proto__":1}'));
  const next = json.setJsonScalar(proto, ['__proto__'], 2);
  assert.equal(Object.getPrototypeOf(next), Object.prototype);
  assert.equal(next.__proto__, 2);
});
