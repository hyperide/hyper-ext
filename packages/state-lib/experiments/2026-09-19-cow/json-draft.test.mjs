import test from 'node:test';
import assert from 'node:assert/strict';
import { ownJson, beginJsonDraft, beginCopiedJson } from './json-draft.mjs';
const fixture = () => ({
  name: 'Board',
  columns: [
    { id: 'a', items: [{ id: '1', text: 'hello', done: false }] },
    { id: 'b', items: [] },
  ],
});
const change = (base, fn) => {
  const tx = beginJsonDraft(base);
  try {
    fn(tx.draft);
    return tx.finish();
  } catch (error) {
    tx.abort();
    throw error;
  }
};
test('only touched containers change identity', () => {
  const before = ownJson(fixture()),
    tx = beginJsonDraft(before);
  tx.draft.columns[0].items[0].done = true;
  const after = tx.finish();
  assert.equal(before.columns[0].items[0].done, false);
  assert.equal(after.columns[0].items[0].done, true);
  assert.equal(before.columns[1], after.columns[1]);
  assert.notEqual(before.columns[0], after.columns[0]);
  assert.equal(tx.copiedContainers, 5);
});
test('escaped root and child remain detached after commit', () => {
  const tx = beginJsonDraft(ownJson(fixture()));
  const child = tx.draft.columns[0].items[0];
  child.text = 'sent';
  const after = tx.finish();
  tx.draft.name = 'late';
  child.text = 'later';
  assert.equal(after.name, 'Board');
  assert.equal(after.columns[0].items[0].text, 'sent');
});
test('external ownership and transient invalid values match copy', () => {
  const inserted = { id: '2', text: 'new', done: false };
  const after = change(ownJson(fixture()), (d) => {
    d.columns[0].items.push(inserted);
    inserted.text = 'current';
    d.temporary = undefined;
    delete d.temporary;
  });
  inserted.text = 'outside';
  assert.equal(after.columns[0].items[1].text, 'current');
});
test('moves, array helpers and detached item edits keep current identity', () => {
  const after = change(ownJson(fixture()), (d) => {
    const [item] = d.columns[0].items.splice(0, 1);
    d.columns[1].items.push(item);
    item.text = 'moved';
  });
  assert.equal(after.columns[0].items.length, 0);
  assert.equal(after.columns[1].items[0].text, 'moved');
});
test('same transaction and subsequent aliases stay coherent', () => {
  let after = change(ownJson(fixture()), (d) => {
    d.other = d.columns[0].items[0];
    d.other.text = 'shared';
  });
  assert.equal(after.other, after.columns[0].items[0]);
  const tx = beginJsonDraft(after);
  assert.equal(tx.strategy, 'copy');
  tx.draft.other.text = 'next';
  after = tx.finish();
  assert.equal(after.columns[0].items[0].text, 'next');
});
test('cycles and non-JSON writes fail without touching the old snapshot', () => {
  const before = ownJson(fixture());
  for (const value of [undefined, NaN, Infinity, new Map(), new Date()])
    assert.throws(
      () =>
        change(before, (d) => {
          d.invalid = value;
        }),
      /acyclic JSON/,
    );
  assert.throws(
    () =>
      change(before, (d) => {
        d.self = d;
      }),
    /acyclic JSON/,
  );
  assert.equal(before.name, 'Board');
});
test('input aliases use full copy rather than breaking identity', () => {
  const child = { v: 1 },
    before = ownJson({ left: child, right: child }),
    tx = beginJsonDraft(before);
  assert.equal(tx.strategy, 'copy');
  tx.draft.right.v = 2;
  const after = tx.finish();
  assert.equal(after.left, after.right);
  assert.equal(after.left.v, 2);
  assert.equal(before.left.v, 1);
});
test('no-op preserves command publication but shares children', () => {
  const before = ownJson(fixture()),
    after = change(before, () => {});
  assert.notEqual(before, after);
  assert.equal(before.columns, after.columns);
});
test('rollback and late async-style writes cannot affect source', () => {
  const before = ownJson(fixture()),
    tx = beginJsonDraft(before);
  tx.draft.name = 'early';
  tx.abort();
  tx.draft.columns[0].items[0].text = 'late';
  assert.equal(before.name, 'Board');
  assert.equal(before.columns[0].items[0].text, 'hello');
});
test('enumeration, in, spread, map and array length agree', () => {
  for (const factory of [beginCopiedJson, beginJsonDraft]) {
    const tx = factory(ownJson(fixture()));
    assert.deepEqual(Object.keys(tx.draft), ['name', 'columns']);
    assert('name' in tx.draft);
    tx.draft.columns.reverse();
    tx.draft.columns[1].items.push({ id: '3', text: 'new', done: false });
    tx.draft.columns[1].items.length = 1;
    assert.deepEqual(
      tx.draft.columns.map((c) => c.id),
      ['b', 'a'],
    );
    assert.equal({ ...tx.draft }.name, 'Board');
    assert.equal(tx.finish().columns[1].items.length, 1);
  }
});
test('300 deterministic mixed commands match reference after every step', () => {
  let a = ownJson(fixture()),
    b = ownJson(fixture());
  for (let i = 0; i < 300; i++) {
    const mutate = (d) => {
      d.name = `Edit ${i}`;
      if (i % 3 === 0) {
        const from = d.columns.find((c) => c.items.length);
        d.columns.find((c) => c !== from).items.push(from.items.pop());
      } else {
        const item = d.columns.flatMap((c) => c.items)[0];
        item.done = !item.done;
        item.text = `Task ${i}`;
      }
      if (i % 11 === 0) d.columns.reverse();
    };
    const ref = beginCopiedJson(a);
    mutate(ref.draft);
    a = ref.finish();
    b = change(b, mutate);
    assert.deepEqual(b, a);
  }
});

test('edits after moves and aliases do not lose previous changes', () => {
  const after = change(ownJson(fixture()), (d) => {
    const first = d.columns[0].items[0];
    first.text = 'early';
    d.columns[1].items.push(d.columns[0].items.pop());
    first.done = true;
  });
  assert.equal(after.columns[1].items[0].text, 'early');
  assert.equal(after.columns[1].items[0].done, true);
});
test('repeated escaped writes detach ancestor and descendant only from the committed graph', () => {
  const tx = beginJsonDraft(ownJson(fixture()));
  const child = tx.draft.columns[0].items[0];
  child.text = 'committed';
  const after = tx.finish();
  child.text = 'late1';
  child.done = true;
  tx.draft.columns[0].items.push({ id: '2', text: 'late2', done: false });
  assert.equal(after.columns[0].items.length, 1);
  assert.equal(after.columns[0].items[0].text, 'committed');
  assert.equal(after.columns[0].items[0].done, false);
});
test('symbol properties are omitted as in the copy reference', () => {
  const symbol = Symbol('private'),
    after = change(ownJson(fixture()), (d) => {
      d[symbol] = new Map();
      d.name = 'Kept';
    });
  assert.deepEqual(Object.getOwnPropertySymbols(after), []);
  assert.equal(after.name, 'Kept');
});

test('prototype mutation is rejected but a JSON own __proto__ field is data', () => {
  const before = ownJson(fixture());
  assert.throws(
    () =>
      change(before, (d) => {
        d.__proto__ = { polluted: true };
      }),
    /prototype mutation/,
  );
  const initial = ownJson(JSON.parse('{"__proto__":{"safe":true},"value":1}'));
  const after = change(initial, (d) => {
    d.__proto__.safe = false;
  });
  assert.equal(Object.getPrototypeOf(after), Object.prototype);
  assert.equal(after.__proto__.safe, false);
  assert.equal({}.polluted, undefined);
});

test('inserting a prior committed snapshot retains its old values, not the live draft', () => {
  const before = ownJson(fixture());
  const after = change(before, (d) => {
    d.name = 'new';
    d.previous = before;
    assert.equal(d.previous.name, 'Board');
  });
  assert.equal(after.name, 'new');
  assert.equal(after.previous.name, 'Board');
  assert.equal(before.previous, undefined);
});
test('raw snapshot edges preserve their sharing and are not rebound to old draft handles', () => {
  const before = ownJson(fixture());
  const after = change(before, (d) => {
    const child = d.columns[0].items[0];
    d.one = before.columns[0].items[0];
    d.two = before;
    child.text = 'new';
  });
  assert.equal(after.one, after.two.columns[0].items[0]);
  assert.equal(after.one.text, 'hello');
  assert.equal(after.columns[0].items[0].text, 'new');
});


test('restoring an existing item from the prior snapshot cancels its transient draft edit', () => {
  const before = ownJson(fixture());
  const after = change(before, (draft) => {
    draft.columns[0].items[0].text = 'transient';
    draft.columns[0].items[0] = before.columns[0].items[0];
  });
  assert.equal(after.columns[0].items[0].text, 'hello');
  assert.equal(before.columns[0].items[0].text, 'hello');
});


test('assigning an unchanged historical child still preserves its frozen identity', () => {
  const before = ownJson(fixture());
  for (const factory of [beginCopiedJson, beginJsonDraft]) {
    const tx = factory(before);
    tx.draft.columns[0].items[0] = before.columns[0].items[0];
    assert.equal(tx.draft.columns[0].items[0], before.columns[0].items[0]);
    assert.throws(() => { tx.draft.columns[0].items[0].text = 'forbidden'; }, TypeError);
    assert.equal(tx.finish().columns[0].items[0].text, 'hello');
  }
});

test('a historical slot reattached to a live draft follows subsequent draft writes', () => {
  const before = ownJson(fixture());
  for (const factory of [beginCopiedJson, beginJsonDraft]) {
    const tx = factory(before);
    const live = tx.draft.columns[0].items[0];
    tx.draft.other = before.columns[0].items[0];
    tx.draft.other = live;
    live.text = 'tracked';
    const after = tx.finish();
    assert.equal(after.other, after.columns[0].items[0]);
    assert.equal(after.other.text, 'tracked');
    assert.equal(before.columns[0].items[0].text, 'hello');
  }
});

test('historical references nested in an inserted object do not resolve as active nodes', () => {
  const before = ownJson(fixture());
  for (const factory of [beginCopiedJson, beginJsonDraft]) {
    const tx = factory(before);
    tx.draft.columns[0].items[0].text = 'current';
    tx.draft.archive = { old: before, item: before.columns[0].items[0] };
    const after = tx.finish();
    assert.equal(after.archive.old.columns[0].items[0], after.archive.item);
    assert.equal(after.archive.item.text, 'hello');
    assert.equal(after.columns[0].items[0].text, 'current');
  }
});
