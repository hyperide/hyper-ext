/** Optimistic overlay: apply now, confirm or roll back with the same inverse patches undo uses. */
import { createStore, deriveCollection, watch, type Patch } from '../src/lib/proto';

type Row = { id: string; open: boolean; prio: number };
let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
  );
};

// --- confirmed path ---
{
  const store = createStore({ n: 0 });
  const bump = store.optimistic(
    'bump',
    (s) => {
      s.n = s.n + 1;
    },
    async () => 'server ok',
  );
  const p = bump();
  eq('the write is visible immediately', store.raw.n, 1);
  eq('and marked pending', store.pending.length, 1);
  await p;
  eq('confirmation clears pending', store.pending.length, 0);
  eq('and leaves the value in place', store.raw.n, 1);
  eq('with no rollback transaction', store.log.length, 1);
}

// --- rejected path ---
{
  const store = createStore({ n: 0, other: 'untouched' });
  const bump = store.optimistic(
    'bump',
    (s) => {
      s.n = 41;
    },
    async () => {
      throw new Error('rejected');
    },
  );
  const p = bump().catch(() => {});
  eq('optimistic value is visible while in flight', store.raw.n, 41);
  await p;
  eq('rejection restores the previous value', store.raw.n, 0);
  eq('pending is cleared', store.pending.length, 0);
  eq('the rollback is itself logged, so the log tells the truth', store.log.length, 2);
  eq('and names itself', store.log[1].name.includes('rolled back'), true);
  eq('unrelated state is untouched', store.raw.other, 'untouched');
}

// --- a rejected write that a derived view had already picked up ---
{
  const seed: Record<string, Row> = { a: { id: 'a', open: false, prio: 1 }, b: { id: 'b', open: true, prio: 2 } };
  const store = createStore({ rows: seed });
  const view = deriveCollection<Row>(store, '/rows', { filter: (r) => r.open, sort: (x, y) => x.prio - y.prio });
  eq('view starts with one member', view.ids.peek(), ['b']);
  const openIt = store.optimistic<[string]>(
    'open',
    (s, id: string) => {
      s.rows[id].open = true;
    },
    async () => {
      throw new Error('nope');
    },
  );
  const p = openIt('a').catch(() => {});
  eq('the view shows the optimistic member', view.ids.peek(), ['a', 'b']);
  await p;
  eq('and the rollback removes it again', view.ids.peek(), ['b']);
}

// --- a multi-field optimistic action rolls back entirely ---
{
  const store = createStore({ x: 0, y: 0 });
  const both = store.optimistic(
    'both',
    (s) => {
      s.x = 1;
      s.y = 2;
    },
    async () => {
      throw new Error('no');
    },
  );
  await both().catch(() => {});
  eq('both fields are restored', [store.raw.x, store.raw.y], [0, 0]);
}

// --- rollback does not corrupt undo ---
{
  const store = createStore({ n: 0 });
  const set = store.action('set', (s, v: number) => {
    s.n = v;
  });
  set(5);
  const bad = store.optimistic(
    'bad',
    (s) => {
      s.n = 99;
    },
    async () => {
      throw new Error('x');
    },
  );
  await bad().catch(() => {});
  eq('value is back to the confirmed one', store.raw.n, 5);
  store.undo();
  eq('undo now steps over the rollback entry', store.raw.n, 99);
  store.undo();
  eq('and then over the optimistic write', store.raw.n, 5);
  store.undo();
  eq('and then over the real action', store.raw.n, 0);
}

const sparse = [1, 0, 2];
delete sparse[1];
for (const initial of [[1, 2], sparse]) {
  const store = createStore({ rows: initial });
  const seen: (number | undefined)[][] = [];
  const stop = watch(() => {
    seen.push([...store.state.rows]);
  });
  const expected = initial.slice();
  expected.push(3, 4);
  await store
    .optimistic(
      'append',
      (s) => {
        s.rows.push(3, 4);
      },
      async () => {
        throw new Error('rejected');
      },
    )()
    .catch(() => {});
  eq('array rejection restores initial values', store.raw.rows, initial);
  eq('optimistic observers see only complete states', seen, [initial, expected, initial]);
  stop();
  for (let cycle = 0; cycle < 2; cycle++) {
    store.undo();
    eq('undo rollback restores every appended element', store.raw.rows, expected);
    eq('undo rollback preserves sparse own keys', Object.keys(store.raw.rows), Object.keys(expected));
    store.undo();
    eq('undo optimistic append restores initial array', store.raw.rows, initial);
    store.redo();
    eq('redo optimistic append restores full array', store.raw.rows, expected);
    store.redo();
    eq('redo rollback restores initial array', store.raw.rows, initial);
  }
}

const deferred = () => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

{
  const store = createStore<{ row?: { x?: number; y?: number } }>({});
  const a = deferred();
  const first = store
    .optimistic(
      'insert parent',
      (s) => {
        s.row = { x: 1, y: 1 };
      },
      () => a.promise,
    )()
    .catch(() => {});
  await store.optimistic(
    'confirm child',
    (s) => {
      s.row!.x = 2;
    },
    async () => {},
  )();
  a.reject(new Error('parent rejected'));
  await first;
  eq('confirmed descendants survive a rejected parent insertion', store.raw, { row: { x: 2 } });
  eq('parent insertion rejection is recorded', store.log.at(-1)?.name, 'insert parent (rolled back)');
}

for (const order of ['older-first', 'newer-first']) {
  for (const rejectNewer of [false, true]) {
    const store = createStore({ x: 0, y: 0, nested: { x: 0, y: 0 } });
    const a = deferred();
    const b = deferred();
    const first = store
      .optimistic(
        'A',
        (s) => {
          s.x = 1;
          s.y = 1;
          s.nested = { x: 1, y: 1 };
        },
        () => a.promise,
      )()
      .catch(() => {});
    const second = store
      .optimistic(
        'B',
        (s) => {
          s.x = 2;
          s.nested.x = 2;
        },
        () => b.promise,
      )()
      .catch(() => {});
    store.state.nested.y = 3;
    const settleA = async () => {
      a.reject(new Error('A'));
      await first;
    };
    const settleB = async () => {
      if (rejectNewer) b.reject(new Error('B'));
      else b.resolve();
      await second;
    };
    if (order === 'older-first') {
      await settleA();
      await settleB();
    } else {
      await settleB();
      await settleA();
    }
    eq(`${order}/${rejectNewer}: overlapping, disjoint and nested settlement`, store.raw, {
      x: rejectNewer ? 0 : 2,
      y: 0,
      nested: { x: rejectNewer ? 0 : 2, y: 3 },
    });
    eq(`${order}/${rejectNewer}: pending cleared`, store.pending, []);
    const settled = structuredClone(store.raw);
    store.undo();
    store.redo();
    eq(`${order}/${rejectNewer}: rollback history round trip`, store.raw, settled);
    const count = store.log.length;
    for (let i = 0; i < count; i++) store.undo();
    eq(`${order}/${rejectNewer}: undo all history`, store.raw, { x: 0, y: 0, nested: { x: 0, y: 0 } });
    for (let i = 0; i < count; i++) store.redo();
    eq(`${order}/${rejectNewer}: redo all history`, store.raw, settled);
  }
}
{
  const store = createStore({ x: 0 });
  const gate = deferred();
  const result = store
    .optimistic(
      'A',
      (s) => {
        s.x = 1;
      },
      () => gate.promise,
    )()
    .catch(() => {});
  for (let value = 2; value < 205; value++) store.state.x = value;
  gate.reject(new Error('A'));
  await result;
  eq('later ordinary writes survive beyond the history cap', store.raw.x, 204);
}
{
  const store = createStore({ x: 0 });
  const failure = new Error('synchronous send');
  let result: Promise<unknown> | undefined;
  let thrown = false;
  try {
    result = store.optimistic(
      'sync',
      (s) => {
        s.x = 1;
      },
      () => {
        throw failure;
      },
    )();
  } catch {
    thrown = true;
  }
  eq('send exceptions return a promise instead of throwing', thrown, false);
  eq(
    'send exception promise rejects with the original error',
    (await result?.catch((error: unknown) => error)) === failure,
    true,
  );
  eq('send exception rolls back', store.raw.x, 0);
  eq('send exception clears pending', store.pending, []);
}

for (const push of [false, true]) {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const store = createStore<{ rows?: number[] }>({});
    const persisted: Patch[] = [];
    const disk = {
      read: () => persisted,
      write: (batch: Patch[]) => {
        for (const patch of structuredClone(batch)) persisted.push(patch);
      },
    };
    store.persist(disk);
    const gates = [deferred(), deferred()];
    const first = store
      .optimistic(
        'insert',
        (s) => {
          s.rows = push ? [] : [1];
        },
        () => gates[0].promise,
      )()
      .catch(() => {});
    await store.optimistic(
      'keep',
      (s) => {
        if (push) s.rows!.push(2);
        else s.rows![0] = 2;
      },
      async () => {},
    )();
    const last = store
      .optimistic(
        'delete',
        (s) => {
          delete s.rows;
        },
        () => gates[1].promise,
      )()
      .catch(() => {});
    const results = [first, last];
    for (const index of order) {
      gates[index].reject(new Error('rejected'));
      await results[index];
    }
    eq(`hidden array ${push}/${order}: container type`, Array.isArray(store.raw.rows), true);
    eq(`hidden array ${push}/${order}: confirmed value`, store.raw.rows, [2]);
    const hydrated = createStore<{ rows?: number[] }>({});
    hydrated.hydrate(disk);
    eq(`hidden array ${push}/${order}: persistence`, hydrated.raw.rows, [2]);
    eq(`hidden array ${push}/${order}: persisted container type`, Array.isArray(hydrated.raw.rows), true);
    store.undo();
    store.redo();
    eq(`hidden array ${push}/${order}: history round trip`, store.raw.rows, [2]);
  }
}

for (const order of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]) {
  for (const keepB of [false, true]) {
    for (const keepC of [false, true]) {
      const store = createStore({ x: 0, y: 0, z: 0, xy: 0 });
      const gates = [deferred(), deferred(), deferred()];
      let callbacks = 0;
      const mutations = [
        (s: typeof store.state) => {
          s.x = 1;
        },
        (s: typeof store.state) => {
          s.x = 2;
          s.y = 2;
        },
        (s: typeof store.state) => {
          s.y = 3;
          s.z = 3;
        },
      ];
      const results = gates.map((gate, index) =>
        store
          .optimistic(
            String(index),
            (s) => {
              callbacks++;
              mutations[index](s);
            },
            () => gate.promise,
          )()
          .catch(() => {}),
      );
      store.action('ordinary', (s) => {
        s.xy = 4;
      })();
      const keep = [false, keepB, keepC];
      for (const index of order) {
        if (keep[index]) gates[index].resolve();
        else gates[index].reject(new Error('rejected'));
        await results[index];
      }
      const expected = { x: keepB ? 2 : 0, y: keepC ? 3 : keepB ? 2 : 0, z: keepC ? 3 : 0, xy: 4 };
      eq(`transitive ${order}/${keep}: state`, store.raw, expected);
      eq(`transitive ${order}/${keep}: callbacks`, callbacks, 3);
      const count = store.log.length;
      for (let index = 0; index < count; index++) store.undo();
      eq(`transitive ${order}/${keep}: undo`, store.raw, { x: 0, y: 0, z: 0, xy: 0 });
      for (let index = 0; index < count; index++) store.redo();
      eq(`transitive ${order}/${keep}: redo`, store.raw, expected);
    }
  }
}

for (const sibling of [1, 5]) {
  const store = createStore({ rows: [] as number[], other: [] as number[] });
  const rows = store.raw.rows;
  const other = store.raw.other;
  const gate = deferred();
  const result = store
    .optimistic(
      'grow',
      (s) => {
        s.rows[3] = 1;
      },
      () => gate.promise,
    )()
    .catch(() => {});
  store.state.rows[sibling] = 2;
  store.state.other[0] = 9;
  gate.reject(new Error('grow'));
  await result;
  const expected: number[] = [];
  expected[sibling] = 2;
  eq(`length overlap ${sibling}: survivor`, store.raw.rows, expected);
  eq(`length overlap ${sibling}: sparse keys`, Object.keys(store.raw.rows), [String(sibling)]);
  eq(`length overlap ${sibling}: array identity`, store.raw.rows === rows, true);
  eq(`length overlap ${sibling}: disjoint identity`, store.raw.other === other, true);
  eq(`length overlap ${sibling}: disjoint value`, store.raw.other, [9]);
  if (sibling === 1) {
    eq('length overlap: exact rollback patch order', store.log.at(-1)?.patches, [
      { op: 'remove', path: '/rows/1' },
      { op: 'remove', path: '/rows/3' },
      { op: 'replace', path: '/rows/length', value: 0 },
      { op: 'replace', path: '/rows/length', value: 2 },
      { op: 'add', path: '/rows/1', value: 2 },
    ]);
  }
  eq(
    `length overlap ${sibling}: disjoint write excluded`,
    store.log.at(-1)?.patches.some((p) => p.path.startsWith('/other/')),
    false,
  );
}

for (const size of [100, 1000]) {
  const store = createStore({ rows: Array.from({ length: size }, () => 0) });
  let patches = 0;
  let callbacks = 0;
  store.persist({
    read: () => [],
    write: (batch) => {
      patches += batch.length;
    },
  });
  const gates = Array.from({ length: size }, deferred);
  const results = gates.map((gate, index) =>
    store
      .optimistic(
        'indexed',
        (s) => {
          callbacks++;
          s.rows[index] = 1;
        },
        () => gate.promise,
      )()
      .catch(() => {}),
  );
  for (let index = 0; index < size; index++) {
    gates[index].reject(new Error('indexed'));
    await results[index];
  }
  eq(`${size} disjoint writes: persistence patch count`, patches, size * 2);
  eq(`${size} disjoint writes: callbacks run once`, callbacks, size);
  eq(
    `${size} disjoint writes: restored indices`,
    store.raw.rows.every((value) => value === 0),
    true,
  );
}

for (const overlap of [false, true]) {
  const count = 10000;
  const store = createStore({ x: 0, y: 0 });
  const gate = deferred();
  const result = store
    .optimistic(
      'original',
      (s) => {
        s.x = 1;
      },
      () => gate.promise,
    )()
    .catch(() => {});
  for (let index = 1; index <= count; index++) store.state[overlap ? 'x' : 'y'] = index;
  const iterator = Set.prototype[Symbol.iterator];
  let visits = 0;
  Set.prototype[Symbol.iterator] = function* (): Generator<unknown, undefined, unknown> {
    for (const value of iterator.call(this)) {
      visits++;
      yield value;
    }
    return undefined;
  };
  try {
    gate.reject(new Error('original'));
    await result;
  } finally {
    Set.prototype[Symbol.iterator] = iterator;
  }
  eq(`10000 writes overlap=${overlap}: final state`, store.raw, overlap ? { x: count, y: 0 } : { x: 0, y: count });
  eq(`10000 writes overlap=${overlap}: linear set visits (${visits})`, visits < count * 20, true);
}

// Hold the browser frame across transaction entry and settlement boundaries.
for (const order of [
  [0, 1],
  [1, 0],
]) {
  for (const timing of ['before-delete', 'after-delete', 'between-settlements', 'after-settlements']) {
    const originalFrame = globalThis.requestAnimationFrame;
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    const flush = () => {
      for (const frame of frames.splice(0)) frame(0);
    };
    try {
      const store = createStore<{ rows?: number[]; untouched: number[] }>({ untouched: [9] });
      const untouched = store.raw.untouched;
      const gates = [deferred(), deferred()];
      const errors = [new Error('create'), new Error('delete')];
      let callbacks = 0;
      let sends = 0;
      const a = store
        .optimistic(
          'create',
          (s) => {
            callbacks++;
            s.rows = [1];
          },
          () => {
            sends++;
            return gates[0].promise;
          },
        )()
        .catch((error: unknown) => error);
      const aId = store.pending[0];
      store.setTransient('/rows/0', 2);
      if (timing === 'before-delete') flush();
      const b = store
        .optimistic(
          'delete',
          (s) => {
            callbacks++;
            delete s.rows;
          },
          () => {
            sends++;
            return gates[1].promise;
          },
        )()
        .catch((error: unknown) => error);
      const ids = [aId, store.pending.at(-1)!];
      const results = [a, b];
      if (timing === 'after-delete') flush();
      for (const [step, index] of order.entries()) {
        gates[index].reject(errors[index]);
        eq(`delayed ${order}/${timing}: rejection ${index}`, (await results[index]) === errors[index], true);
        eq(`delayed ${order}/${timing}: recorded ${index}`, store.rejectionFor(ids[index]) === errors[index], true);
        if (step === 0 && timing === 'between-settlements') flush();
      }
      const settledRows = store.raw.rows;
      flush();
      eq(`delayed ${order}/${timing}: state`, store.raw.rows, [2]);
      eq(`delayed ${order}/${timing}: array`, Array.isArray(store.raw.rows), true);
      eq(`delayed ${order}/${timing}: frame preserves identity`, store.raw.rows === settledRows, true);
      eq(`delayed ${order}/${timing}: disjoint identity`, store.raw.untouched === untouched, true);
      eq(`delayed ${order}/${timing}: callbacks and sends once`, [callbacks, sends], [2, 2]);
      eq(`delayed ${order}/${timing}: pending`, store.pending, []);
      eq(
        `delayed ${order}/${timing}: transient committed once`,
        store.log.filter((entry) => entry.name.startsWith('transient')).length,
        1,
      );
    } finally {
      if (originalFrame) globalThis.requestAnimationFrame = originalFrame;
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
  }
}

// Count actual Set entry traversal only during settlement, independently of wall time.
for (const size of [100, 10000]) {
  for (const overlap of [false, true]) {
    const store = createStore({ x: 0, other: 0 });
    const gate = deferred();
    const result = store
      .optimistic(
        'first',
        (s) => {
          s.x = 1;
        },
        () => gate.promise,
      )()
      .catch(() => {});
    for (let index = 1; index <= size; index++) {
      if (overlap) store.state.x = index + 1;
      else store.state.other = index;
    }
    const iterate = Set.prototype[Symbol.iterator];
    let visits = 0;
    Set.prototype[Symbol.iterator] = function* (): Generator<unknown, undefined, unknown> {
      for (const value of iterate.call(this)) {
        visits++;
        yield value;
      }
      return undefined;
    };
    try {
      gate.reject(new Error('first'));
      await result;
    } finally {
      Set.prototype[Symbol.iterator] = iterate;
    }
    eq(`bucket visits ${size}/${overlap}: bounded (${visits})`, visits <= (overlap ? 12 * (size + 1) : 20), true);
    eq(`bucket visits ${size}/${overlap}: state`, store.raw, { x: overlap ? size + 1 : 0, other: overlap ? 0 : size });
  }
}

// Release regressions: implicit transient mutations and repeated settlement work.
for (const delayed of [false, true]) {
  const original = globalThis.requestAnimationFrame;
  const frames: FrameRequestCallback[] = [];
  globalThis.requestAnimationFrame = (callback) => {
    frames.push(callback);
    return frames.length;
  };
  try {
    const store = createStore({ rows: [0, 0] });
    const gate = deferred();
    const result = store
      .optimistic(
        'index',
        (s) => {
          s.rows[0] = 1;
        },
        () => gate.promise,
      )()
      .catch(() => {});
    store.setTransient('/rows/length', 0);
    if (!delayed) frames.splice(0).forEach((callback) => callback(0));
    gate.reject(new Error('index'));
    await result;
    frames.splice(0).forEach((callback) => callback(0));
    eq(`transient truncation delayed=${delayed}`, store.raw.rows, []);
  } finally {
    if (original) globalThis.requestAnimationFrame = original;
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  }
}
{
  const size = 1000;
  const store = createStore({ rows: [0] });
  const gates = Array.from({ length: size }, deferred);
  let patches = 0;
  let callbacks = 0;
  store.persist({
    read: () => [],
    write: (batch) => {
      patches += batch.length;
    },
  });
  const results = gates.map((gate, index) =>
    store
      .optimistic(
        'overlap',
        (s) => {
          callbacks++;
          s.rows[0] = index + 1;
        },
        () => gate.promise,
      )()
      .catch(() => {}),
  );
  patches = 0;
  const clone = globalThis.structuredClone;
  let clonedTransactions = 0;
  globalThis.structuredClone = (value, options) => {
    if (value && typeof value === 'object' && 'patches' in value) clonedTransactions++;
    return clone(value, options);
  };
  try {
    for (let index = 0; index < size; index++) {
      gates[index].reject(new Error('overlap'));
      await results[index];
    }
  } finally {
    globalThis.structuredClone = clone;
  }
  eq('1000 overlapping oldest-first: final state', store.raw.rows, [0]);
  eq('1000 overlapping oldest-first: callbacks once', callbacks, size);
  eq(`1000 overlapping oldest-first: linear persistence (${patches})`, patches <= size * 2, true);
  eq(
    `1000 overlapping oldest-first: no suffix reconstruction (${clonedTransactions})`,
    clonedTransactions <= size * 2,
    true,
  );
}

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall assertions passed');
process.exit(failed ? 1 : 0);
