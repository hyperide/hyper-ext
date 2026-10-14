import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NormalizedStore } from '../2026-09-08/normalized.mjs';

// Original reduced workloads, not a copied implementation or a full Plane installation.
// Upstream provenance and stronger counterfactual expectations live in sources.json.
const schema = {
  people: {
    idType: 'string',
    fields: ['id', 'name'],
    validate: (r) => {
      if (typeof r.name !== 'string') throw Error('Invalid person');
    },
  },
  issues: {
    idType: 'string',
    fields: ['id', 'title', 'state', 'parentId', 'assigneeId'],
    relations: { assignee: { table: 'people', key: 'assigneeId' } },
    validate: (r) => {
      if (!['todo', 'done'].includes(r.state) || !r.title) throw Error('Invalid issue');
    },
  },
};
const issue = (id, state = 'todo', parentId = 'epic') => ({
  id,
  state,
  parentId,
  title: `Task ${id}`,
  assigneeId: 'ana',
});
const make = () =>
  new NormalizedStore(schema, {
    people: [
      { id: 'ana', name: 'Ana' },
      { id: 'ben', name: 'Ben' },
    ],
    issues: [issue('a')],
  });
const board = (issues) => {
  const rows = Object.values(issues).filter((r) => r.parentId === 'epic');
  return {
    todo: rows.filter((r) => r.state === 'todo').map((r) => r.id),
    done: rows.filter((r) => r.state === 'done').map((r) => r.id),
  };
};

test('Plane: normalized card move and grouped board agree immediately', () => {
  const store = make(),
    seen = [];
  store.observe(() => seen.push(board(store.state.issues)));
  store.action('move', () => {
    store.state.issues.a.state = 'done';
    store.state.issues.a.title = 'Moved';
  })();
  assert.deepEqual(seen, [
    { todo: ['a'], done: [] },
    { todo: [], done: ['a'] },
  ]);
  assert.equal(store.log.length, 1);
  assert.equal(store.inspect().issues.a.title, 'Moved');
});
test('Plane: a retained table reference observes additions and removals', () => {
  const store = make(),
    rows = store.state.issues,
    seen = [];
  store.observe(() => seen.push(board(rows)));
  store.put('issues', issue('b'));
  store.remove('issues', 'a');
  assert.deepEqual(seen, [
    { todo: ['a'], done: [] },
    { todo: ['a', 'b'], done: [] },
    { todo: ['b'], done: [] },
  ]);
  assert.equal(rows, store.state.issues, 'table handles remain live, not detached membership snapshots');
});
test('Plane: empty filtered lists wake up on first matching insertion', () => {
  const store = make(),
    counts = [];
  store.remove('issues', 'a');
  store.observe(() => counts.push(board(store.state.issues).todo.length));
  store.put('issues', issue('outside', 'todo', 'other'));
  store.put('issues', issue('b'));
  assert.equal(counts.at(-1), 1);
});
test('Plane: multi-row creation reads its own staged membership and emits one board', () => {
  const store = make(),
    seen = [];
  store.observe(() => seen.push(board(store.state.issues)));
  store.action('create-and-move', () => {
    store.put('issues', issue('b'));
    assert.equal(store.state.issues.b.title, 'Task b');
    store.state.issues.b.state = 'done';
    store.remove('issues', 'a');
    assert.deepEqual(Object.keys(store.state.issues), ['b']);
  })();
  assert.deepEqual(seen, [
    { todo: ['a'], done: [] },
    { todo: [], done: ['b'] },
  ]);
});
test('Plane: missing entity lookup subscribes to its eventual arrival', () => {
  const store = make(),
    seen = [];
  store.observe(() => seen.push(store.state.issues.later?.title ?? 'loading'));
  store.put('issues', issue('later'));
  assert.deepEqual(seen, ['loading', 'Task later']);
});
test('Plane: validation rollback preserves both the board and the shared assignee', () => {
  const store = make(),
    rows = store.state.issues,
    seen = [];
  store.observe(() => seen.push(board(rows)));
  assert.throws(
    store.action('invalid', () => {
      store.state.issues.a.assignee.name = 'Changed';
      store.put('issues', issue('bad', 'not-a-state'));
    }),
    /Invalid issue/,
  );
  assert.equal(store.state.people.ana.name, 'Ana');
  assert.deepEqual(Object.keys(rows), ['a']);
  assert.equal(store.version, 0);
  assert.equal(seen.length, 1);
});
test('Plane: rebinding a relation drops the old dependency, preserves identity', () => {
  const store = make(),
    names = [];
  store.observe(() => names.push(store.state.issues.a.assignee.name));
  store.state.issues.a.assignee = store.state.people.ben;
  store.state.people.ana.name = 'Unrelated';
  store.state.people.ben.name = 'Benjamin';
  assert.deepEqual(names, ['Ana', 'Ben', 'Benjamin']);
  assert.equal(store.state.issues.a.assignee, store.state.people.ben);
});

test('a view leaked by rejected creation never aliases a later entity with the same ID', () => {
  const store = make();
  let leaked;
  assert.throws(
    store.action('abort-create', () => {
      store.put('issues', issue('new'));
      leaked = store.state.issues.new;
      throw Error('abort');
    }),
    /abort/,
  );
  store.put('issues', issue('new', 'done'));
  assert.throws(() => leaked.title, /Stale/);
  assert.notEqual(leaked, store.state.issues.new);
});
test('create then remove in one action does not leak live phantom identity', () => {
  const store = make();
  let leaked;
  store.action('net-zero', () => {
    store.put('issues', issue('new'));
    leaked = store.state.issues.new;
    store.remove('issues', 'new');
  })();
  assert.equal(store.version, 0);
  store.put('issues', issue('new'));
  assert.throws(() => leaked.title, /Stale/);
});
test('table enumeration preserves JavaScript integer-key ordering and rejects structural writes', () => {
  const store = make();
  store.put('issues', issue('20'));
  store.put('issues', issue('2'));
  assert.deepEqual(Object.keys(store.state.issues), ['2', '20', 'a']);
  assert.throws(() => {
    store.state.issues.extra = issue('extra');
  }, /put\/remove/);
  assert.throws(() => Object.freeze(store.state.issues), /put\/remove/);
});

test('Plane: 1200 deterministic mixed edits agree with an independent reference board', () => {
  const store = make(),
    handle = store.state.issues,
    reference = new Map([['a', issue('a')]]);
  let seed = 1464,
    observed;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0);
  const stop = store.observe(() => {
    observed = board(handle);
  });
  const expected = () => {
    const rows = [...reference.values()].filter((row) => row.parentId === 'epic');
    return {
      todo: rows.filter((row) => row.state === 'todo').map((row) => row.id),
      done: rows.filter((row) => row.state === 'done').map((row) => row.id),
    };
  };
  for (let n = 0; n < 1200; n++) {
    const id = `i${random() % 29}`,
      operation = random() % 5;
    const row = issue(id, random() & 1 ? 'todo' : 'done', random() % 3 ? 'epic' : 'other');
    if (operation <= 1) {
      store.put('issues', row);
      reference.set(id, row);
    } else if (operation === 2) {
      store.remove('issues', id);
      reference.delete(id);
    } else if (operation === 3 && reference.has(id)) {
      store.state.issues[id].state = row.state;
      reference.set(id, { ...reference.get(id), state: row.state });
    } else if (operation === 4) {
      const version = store.version;
      assert.throws(
        store.action('abort-mixed', () => {
          store.put('issues', row);
          store.remove('issues', 'a');
          throw Error('cancel');
        }),
        /cancel/,
      );
      assert.equal(store.version, version);
    }
    assert.deepEqual(observed, expected(), `step ${n}`);
    assert.equal(handle, store.state.issues);
  }
  stop();
});

test('field-only board changes reuse the committed key inventory', () => {
  const data = Array.from({ length: 500 }, (_, i) => issue(`row${i}`));
  const store = new NormalizedStore(schema, { people: [{ id: 'ana', name: 'Ana' }], issues: data });
  const rows = store.state.issues;
  const stop = store.observe(() => Object.values(rows).filter((r) => r.state === 'todo').length);
  const original = Map.prototype.keys;
  let fullKeyScans = 0;
  Map.prototype.keys = function () {
    if (this.size === 500) fullKeyScans++;
    return original.call(this);
  };
  try {
    for (let i = 0; i < 40; i++) rows.row0.state = i & 1 ? 'todo' : 'done';
    assert.equal(fullKeyScans, 0, 'Unchanged membership must not rematerialize the table key inventory');
  } finally {
    Map.prototype.keys = original;
    stop();
  }
});
