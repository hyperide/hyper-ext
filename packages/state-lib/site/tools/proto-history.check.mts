/** Exercise the prototype's history mechanism outside React. tsx tools/proto-history.check.mts */
import { createStore, watch } from '../src/lib/proto';
import assert from 'node:assert/strict';

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
  );
};

const store = createStore({
  items: { a: { done: false }, b: { done: false } } as Record<string, { done: boolean }>,
  filter: 'all',
});
const toggle = store.action('toggle', (s, id: string) => {
  s.items[id].done = !s.items[id].done;
});
const setFilter = store.action('setFilter', (s, f: string) => {
  s.filter = f;
});

toggle('a');
toggle('b');
setFilter('done');
eq('three writes applied', [store.raw.items.a.done, store.raw.items.b.done, store.raw.filter], [true, true, 'done']);
eq('three transactions logged', store.log.length, 3);

store.undo();
eq('undo reverts the last write only', [store.raw.filter, store.raw.items.b.done], ['all', true]);
store.undo();
store.undo();
eq('undo to the start', [store.raw.items.a.done, store.raw.items.b.done, store.raw.filter], [false, false, 'all']);
eq('cannot undo past the start', store.undo(), false);

store.redo();
store.redo();
store.redo();
eq('redo replays everything', [store.raw.items.a.done, store.raw.items.b.done, store.raw.filter], [true, true, 'done']);
eq('cannot redo past the end', store.redo(), false);

store.jumpTo(0);
eq(
  'jump backwards to the first transaction',
  [store.raw.items.a.done, store.raw.items.b.done, store.raw.filter],
  [true, false, 'all'],
);
store.jumpTo(2);
eq('jump forwards again', [store.raw.items.a.done, store.raw.items.b.done, store.raw.filter], [true, true, 'done']);

// A new write after an undo must discard the redo tail, as an editor does.
store.jumpTo(0);
toggle('b');
eq('writing after undo truncates the redo tail', store.log.length, 2);
eq('and cannot redo into the discarded branch', store.canRedo, false);

// An action that writes several fields is ONE history entry.
const store2 = createStore({ x: 0, y: 0 });
const both = store2.action('both', (s) => {
  s.x = 1;
  s.y = 2;
});
both();
eq('a multi-field action is one transaction', store2.log.length, 1);
eq('with two patches and two inverses', [store2.log[0].patches.length, store2.log[0].inverse.length], [2, 2]);
store2.undo();
eq('undoing it reverts both fields', [store2.raw.x, store2.raw.y], [0, 0]);

// Adding a key inverts to a removal, not to undefined.
const store3 = createStore({ bag: {} as Record<string, number> });
const add = store3.action('add', (s, k: string) => {
  s.bag[k] = 1;
});
add('k');
eq('add produces a remove inverse', store3.log[0].inverse[0].op, 'remove');
store3.undo();
eq('undoing an add removes the key entirely', Object.prototype.hasOwnProperty.call(store3.raw.bag, 'k'), false);

// Undo notifies the exact path, so a subscriber re-renders.
const store4 = createStore({ n: 0 });
let notified = 0;
store4.subscribePath('/n', () => {
  notified++;
});
const inc = store4.action('inc', (s) => {
  s.n = s.n + 1;
});
inc();
const afterWrite = notified;
store4.undo();
eq('undo wakes the path subscriber', notified > afterWrite, true);

// Compare own keys as well as values: JSON alone conflates holes with undefined.
const arrayCases: [string, (rows: number[]) => void][] = [
  [
    'push',
    (rows) => {
      rows.push(3);
    },
  ],
  [
    'pop',
    (rows) => {
      rows.pop();
    },
  ],
  [
    'unshift',
    (rows) => {
      rows.unshift(0);
    },
  ],
  [
    'shift',
    (rows) => {
      rows.shift();
    },
  ],
  [
    'splice insert',
    (rows) => {
      rows.splice(1, 0, 3, 4);
    },
  ],
  [
    'splice remove',
    (rows) => {
      rows.splice(0, 1);
    },
  ],
  [
    'splice replace',
    (rows) => {
      rows.splice(0, 1, 3, 4);
    },
  ],
  [
    'truncate',
    (rows) => {
      rows.length = 1;
    },
  ],
  [
    'clear',
    (rows) => {
      rows.length = 0;
    },
  ],
  [
    'extend length',
    (rows) => {
      rows.length = 5;
    },
  ],
  [
    'assign beyond end',
    (rows) => {
      rows[4] = 5;
    },
  ],
  [
    'delete index',
    (rows) => {
      delete rows[0];
    },
  ],
  [
    'multiple operations',
    (rows) => {
      rows.push(3);
      rows.shift();
      rows.length = 1;
      rows.unshift(4);
    },
  ],
];
const sparse = [1, 0, 2];
delete sparse[1];
for (const [name, mutate] of arrayCases) {
  for (const initial of [[1, 2], [], sparse]) {
    const expected = initial.slice();
    mutate(expected);
    const arrayStore = createStore({ rows: initial.slice() });
    arrayStore.action(name, (s) => mutate(s.rows))();
    try {
      assert.deepEqual(arrayStore.raw.rows, expected, `${name}: action`);
      assert.equal(arrayStore.log.length, 1);
      for (let cycle = 0; cycle < 2; cycle++) {
        assert.equal(arrayStore.undo(), true);
        assert.deepEqual(arrayStore.raw.rows, initial, `${name}: undo`);
        assert.equal(arrayStore.redo(), true);
        assert.deepEqual(arrayStore.raw.rows, expected, `${name}: redo`);
      }
      arrayStore.jumpTo(-1);
      assert.deepEqual(arrayStore.raw.rows, initial, `${name}: jump to start`);
      arrayStore.jumpTo(0);
      assert.deepEqual(arrayStore.raw.rows, expected, `${name}: jump to end`);
      console.log(`ok   array ${name} action/undo/redo twice`);
    } catch (error) {
      failed++;
      console.error(error);
    }
  }
}

// Count visited keys and ownership probes so repeated pops cannot hide a full-array scan.
for (const size of [2048, 4096]) {
  try {
    const initial = Array.from({ length: size }, (_, i) => i);
    const dense = createStore({ rows: initial });
    const getOwnPropertyNames = Object.getOwnPropertyNames;
    const hasOwn = Object.hasOwn;
    let operations = 0;
    Object.getOwnPropertyNames = (object) => {
      const keys = getOwnPropertyNames(object);
      if (object === dense.raw.rows) operations += keys.length;
      return keys;
    };
    Object.hasOwn = (object, key) => {
      if (object === dense.raw.rows) operations++;
      return hasOwn(object, key);
    };
    try {
      dense.action('pop all', (s) => {
        for (let i = 0; i < size; i++) assert.equal(s.rows.pop(), size - i - 1);
      })();
    } finally {
      Object.getOwnPropertyNames = getOwnPropertyNames;
      Object.hasOwn = hasOwn;
    }
    console.log(`dense pops size=${size} operations=${operations} budget=${size * 8}`);
    assert.ok(operations <= size * 8, `dense pop traversal operations: ${operations}`);
    assert.deepEqual(dense.raw.rows, []);
    assert.equal(dense.log.length, 1);
    assert.deepEqual(dense.log[0].patches.slice(0, 2), [
      { op: 'remove', path: `/rows/${size - 1}` },
      { op: 'replace', path: '/rows/length', value: size - 1 },
    ]);
    assert.deepEqual(dense.log[0].inverse.slice(0, 2), [
      { op: 'add', path: `/rows/${size - 1}`, value: size - 1 },
      { op: 'replace', path: '/rows/length', value: size },
    ]);
    dense.undo();
    assert.deepEqual(dense.raw.rows, initial);
    dense.redo();
    assert.deepEqual(dense.raw.rows, []);
    console.log(`ok   repeated dense pops scale linearly: ${size}`);
  } catch (error) {
    failed++;
    console.error(error);
  }
}

// Both traversal branches preserve ascending patch order, non-enumerable indices, and holes.
for (const removed of [1024, 1025]) {
  try {
    const ordered = createStore({ rows: [0, 1] });
    ordered.raw.rows.length = removed + 2;
    ordered.raw.rows[removed + 1] = 9;
    Object.defineProperty(ordered.raw.rows, '2', { value: 2, configurable: true, writable: true });
    ordered.action('truncate', (s) => {
      s.rows.length = 2;
    })();
    assert.deepEqual(ordered.log[0].patches, [
      { op: 'remove', path: '/rows/2' },
      { op: 'remove', path: `/rows/${removed + 1}` },
      { op: 'replace', path: '/rows/length', value: 2 },
    ]);
    assert.deepEqual(ordered.log[0].inverse, [
      { op: 'add', path: '/rows/2', value: 2 },
      { op: 'add', path: `/rows/${removed + 1}`, value: 9 },
      { op: 'replace', path: '/rows/length', value: removed + 2 },
    ]);
    ordered.undo();
    assert.equal(ordered.raw.rows.length, removed + 2);
    assert.equal(ordered.raw.rows[2], 2);
    assert.equal(ordered.raw.rows[removed + 1], 9);
    assert.equal(Object.hasOwn(ordered.raw.rows, 3), false);
    ordered.redo();
    assert.deepEqual(ordered.raw.rows, [0, 1]);
    console.log(`ok   truncation patch/inverse order and holes: ${removed}`);
  } catch (error) {
    failed++;
    console.error(error);
  }
}

// Large patch batches must remain undoable without hitting call argument limits.
try {
  const initial = Array.from({ length: 200_000 }, (_, i) => i);
  const bulk = createStore({ rows: initial, done: false });
  bulk.action('clear', (s) => {
    s.rows.length = 0;
    s.done = true;
  })();
  assert.equal(bulk.raw.done, true);
  assert.equal(bulk.log[0].patches.length, initial.length + 2);
  bulk.undo();
  assert.deepEqual(bulk.raw.rows, initial);
  assert.equal(bulk.raw.done, false);
  bulk.redo();
  assert.deepEqual(bulk.raw.rows, []);
  console.log('ok   bulk truncation preserves complete history');
} catch (error) {
  failed++;
  console.error(error);
}

// Count ownership probes instead of measuring machine-dependent elapsed time.
try {
  const sparseStore = createStore({ rows: [] as number[] });
  sparseStore.state.rows[999_999] = 7;
  Object.defineProperty(sparseStore.raw.rows, '500000', { value: 8, configurable: true, writable: true });
  Object.defineProperty(sparseStore.raw.rows, '01', { value: 9, configurable: true });
  const hasOwn = Object.hasOwn;
  let probes = 0;
  Object.hasOwn = (object, key) => {
    probes++;
    return hasOwn(object, key);
  };
  try {
    sparseStore.action('clear', (s) => {
      s.rows.length = 0;
    })();
  } finally {
    Object.hasOwn = hasOwn;
  }
  assert.ok(probes < 20, `sparse truncation ownership probes: ${probes}`);
  assert.equal(sparseStore.log[1].patches.length, 3);
  sparseStore.undo();
  assert.equal(sparseStore.raw.rows.length, 1_000_000);
  assert.equal(sparseStore.raw.rows[999_999], 7);
  assert.equal(sparseStore.raw.rows[500_000], 8);
  assert.equal(Object.hasOwn(sparseStore.raw.rows, 1), false);
  assert.equal(Reflect.get(sparseStore.raw.rows, '01'), 9);
  sparseStore.redo();
  assert.equal(sparseStore.raw.rows.length, 0);
  console.log(`ok   sparse truncation ownership probes: ${probes}`);
} catch (error) {
  failed++;
  console.error(error);
}

try {
  const initial = Array.from({ length: 1600 }, (_, i) => i);
  const observed = createStore({ rows: initial });
  observed.action('clear', (s) => {
    s.rows.length = 0;
  })();
  const seen: number[][] = [];
  const stop = watch(() => {
    seen.push([...observed.state.rows]);
  });
  try {
    seen.length = 0;
    observed.undo();
    assert.equal(seen.length, 1, `undo observer executions: ${seen.length}`);
    assert.deepEqual(seen[0], initial);
    seen.length = 0;
    observed.redo();
    assert.deepEqual(seen, [[]]);
    observed.action('append', (s) => {
      s.rows.push(4, 5);
    })();
    seen.length = 0;
    observed.jumpTo(-1);
    assert.deepEqual(seen, [initial]);
    seen.length = 0;
    observed.jumpTo(1);
    assert.deepEqual(seen, [[4, 5]]);
    console.log('ok   undo/redo/jump publish one complete observer state');
  } finally {
    stop();
  }
} catch (error) {
  failed++;
  console.error(error);
}

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall assertions passed');
process.exit(failed ? 1 : 0);
