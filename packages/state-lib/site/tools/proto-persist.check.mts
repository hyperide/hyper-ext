/** Persistence driven by patches, filtered by region (§8.5, §4.16). */
import { createStore, storageAdapter, type Patch } from '../src/lib/proto';

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
  );
};
const memory = () => {
  const map = new Map<string, string>();
  return { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => void map.set(k, v) };
};

// --- the region table decides what is written, with nothing spelled out per path ---
{
  const disk = storageAdapter(memory());
  const store = createStore(
    { order: { total: 0 }, ui: { panelOpen: false }, session: { token: 'secret' }, draft: { note: '' } },
    { regions: { '/ui': 'view', '/session': 'session', '/draft': 'draft' } },
  );
  const p = store.persist(disk);

  eq('domain is the default for an unlabelled path', store.regionOf('/order/total'), 'domain');
  eq('a declared prefix wins', store.regionOf('/ui/panelOpen'), 'view');

  store.action('buy', (s) => {
    s.order.total = 100;
  })();
  eq('a domain write reaches the adapter', p.writes, 1);

  store.action('togglePanel', (s) => {
    s.ui.panelOpen = true;
  })();
  eq('a view write does not', p.writes, 1);

  store.action('login', (s) => {
    s.session.token = 'another';
  })();
  eq('a session write does not', p.writes, 1);

  store.action('type', (s) => {
    s.draft.note = 'half a sentence';
  })();
  eq('a draft write does — it is what the user would be angry to lose', p.writes, 2);

  const written = disk.read().map((x: Patch) => x.path);
  eq('and only those paths were stored', written, ['/order/total', '/draft/note']);
}

// --- hydrate replays what was stored, and does not re-record it ---
{
  const backing = memory();
  const disk = storageAdapter(backing);
  const a = createStore({ n: 0, ui: { open: false } }, { regions: { '/ui': 'view' } });
  a.persist(disk);
  a.action('set', (s, v: number) => {
    s.n = v;
  })(7);
  a.action('open', (s) => {
    s.ui.open = true;
  })();

  const b = createStore({ n: 0, ui: { open: false } }, { regions: { '/ui': 'view' } });
  const applied = b.hydrate(disk);
  eq('hydrate applied the stored patches', applied, 1);
  eq('domain state came back', b.raw.n, 7);
  eq('view state did not, because it was never stored', b.raw.ui.open, false);
  eq('and hydration is not itself history', b.log.length, 0);
}

// --- explicit include/exclude still overrides the region default ---
{
  const disk = storageAdapter(memory());
  const store = createStore({ a: 1, b: 2, secretToken: 'x' });
  const p = store.persist(disk, { exclude: ['/secretToken'] });
  store.action('w', (s) => {
    s.a = 9;
    s.secretToken = 'leaked';
  })();
  eq('one commit reached the adapter', p.writes, 1);
  eq(
    'but the excluded path was filtered out of it',
    disk.read().map((x: Patch) => x.path),
    ['/a'],
  );
}

// --- a persister can be disposed ---
{
  const disk = storageAdapter(memory());
  const store = createStore({ n: 0 });
  const p = store.persist(disk);
  store.action('inc', (s) => {
    s.n = 1;
  })();
  p.dispose();
  store.action('inc2', (s) => {
    s.n = 2;
  })();
  eq('nothing is written after dispose', p.writes, 1);
}

for (const options of [{ include: ['/public', '/username'], exclude: ['/user'] }, { exclude: ['/user', '/public'] }]) {
  const disk = storageAdapter(memory());
  const store = createStore({ public: { value: 0 }, publicSecret: 0, user: { name: '' }, username: '' });
  store.persist(disk, options);
  store.action('write', (s) => {
    s.public = { value: 1 };
    s.public.value = 2;
    s.publicSecret = 1;
    s.user = { name: 'private' };
    s.user.name = 'nested private';
    s.username = 'visible';
  })();
  eq(
    'persistence matches complete path segments',
    disk.read().map((patch) => patch.path),
    'include' in options ? ['/public', '/public/value', '/username'] : ['/publicSecret', '/username'],
  );
}

for (const overlap of [false, true]) {
  const initial = { x: 0, a: Array.from({ length: 150000 }, (_, index) => index) };
  const store = createStore(initial);
  const disk = storageAdapter(memory());
  store.persist(disk);
  let reject!: (error: Error) => void;
  const gate = new Promise<void>((_resolve, no) => {
    reject = no;
  });
  const failure = new Error('large truncation');
  const result = store
    .optimistic(
      'flag',
      (s) => {
        s.x = 1;
        if (overlap) s.a[0] = -1;
      },
      () => gate,
    )()
    .catch((error: unknown) => error);
  const id = store.pending[0];
  store.action('truncate', (s) => {
    s.a.length = 0;
  })();
  reject(failure);
  eq('large truncation retains original rejection', (await result) === failure, true);
  eq('large truncation records rejection', store.rejectionFor(id) === failure, true);
  const restored = createStore(initial);
  restored.hydrate(disk);
  eq('large truncation live state', store.raw, { x: 0, a: [] });
  eq('large truncation persistence matches live', restored.raw, store.raw);
}

{
  const originalFrame = globalThis.requestAnimationFrame;
  let frame: FrameRequestCallback | undefined;
  globalThis.requestAnimationFrame = (callback) => {
    frame = callback;
    return 1;
  };
  try {
    const disk = storageAdapter(memory());
    const store = createStore<{ rows?: number[]; sibling: number }>({ sibling: 0 });
    store.persist(disk);
    let reject!: (error: Error) => void;
    const gate = new Promise<void>((_resolve, no) => {
      reject = no;
    });
    const result = store
      .optimistic(
        'create rows',
        (s) => {
          s.rows = [1];
        },
        () => gate,
      )()
      .catch(() => {});
    store.setTransient('/rows/0', 2);
    store.setTransient('/sibling', 3);
    frame?.(0);
    reject(new Error('create rows'));
    await result;
    eq('transient survivor retains array type', Array.isArray(store.raw.rows), true);
    eq('transient survivor retains array value', store.raw.rows, [2]);
    eq('transient sibling survives', store.raw.sibling, 3);
    const restored = createStore<{ rows?: number[]; sibling: number }>({ sibling: 0 });
    restored.hydrate(disk);
    eq('transient hydration retains array type', Array.isArray(restored.raw.rows), true);
    eq('transient hydration retains array value', restored.raw.rows, [2]);
    eq('transient hydration retains sibling', restored.raw.sibling, 3);
  } finally {
    if (originalFrame) globalThis.requestAnimationFrame = originalFrame;
    else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  }
}

for (const timing of ['immediate', 'after deletion', 'after settlement']) {
  for (const order of [
    [0, 1],
    [1, 0],
  ]) {
    const originalFrame = globalThis.requestAnimationFrame;
    let frame: FrameRequestCallback | undefined;
    globalThis.requestAnimationFrame = (callback) => {
      frame = callback;
      return 1;
    };
    try {
      const store = createStore<{ rows?: number[] }>({});
      const disk = storageAdapter(memory());
      store.persist(disk);
      const gates = [0, 1].map(() => {
        let reject!: (error: Error) => void;
        const promise = new Promise<void>((_yes, no) => {
          reject = no;
        });
        return { promise, reject };
      });
      const errors = [new Error('insert'), new Error('delete')];
      const a = store
        .optimistic(
          'insert',
          (s) => {
            s.rows = [1];
          },
          () => gates[0].promise,
        )()
        .catch((error: unknown) => error);
      const ids = [store.pending[0]];
      store.setTransient('/rows/0', 2);
      if (timing === 'immediate') frame?.(0);
      const b = store
        .optimistic(
          'delete',
          (s) => {
            delete s.rows;
          },
          () => gates[1].promise,
        )()
        .catch((error: unknown) => error);
      ids.push(store.pending[1]);
      if (timing === 'after deletion') frame?.(0);
      const results = [a, b];
      const label = `frame ${timing} rejection order=${order}`;
      for (const index of order) {
        gates[index].reject(errors[index]);
        eq(`${label}: original error ${index}`, (await results[index]) === errors[index], true);
        eq(`${label}: rejection record ${index}`, store.rejectionFor(ids[index]) === errors[index], true);
      }
      eq(`${label}: transient survives`, store.raw, { rows: [2] });
      eq(`${label}: pending cleared`, store.pending, []);
      const historyLength = store.log.length;
      frame?.(0);
      eq(`${label}: drained frame adds no history`, store.log.length, historyLength);
      try {
        const restored = createStore<{ rows?: number[] }>({});
        restored.hydrate(disk);
        eq(`${label}: persisted state`, restored.raw, { rows: [2] });
        const count = store.log.length;
        for (let index = 0; index < count; index++) store.undo();
        eq(`${label}: undo`, store.raw, {});
        for (let index = 0; index < count; index++) store.redo();
        eq(`${label}: redo`, store.raw, { rows: [2] });
      } catch (error) {
        eq(`${label}: history/persistence error`, String(error), undefined);
      }
    } finally {
      if (originalFrame) globalThis.requestAnimationFrame = originalFrame;
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
  }
}

// A frame boundary must precede the next mutation, including unwrapped writes.
for (const entry of ['direct', 'action', 'optimistic']) {
  for (const reverse of [false, true]) {
    const originalFrame = globalThis.requestAnimationFrame;
    const frames: FrameRequestCallback[] = [];
    globalThis.requestAnimationFrame = (callback) => {
      frames.push(callback);
      return frames.length;
    };
    try {
      const initial: { rows?: number[]; other: number[] } = { other: [9] };
      const store = createStore(initial);
      const disk = storageAdapter(memory());
      store.persist(disk);
      const rejects: ((error: Error) => void)[] = [];
      const gate = () =>
        new Promise<void>((_resolve, reject) => {
          rejects.push(reject);
        });
      let callbacks = 0;
      const first = store
        .optimistic(
          'create',
          (s) => {
            callbacks++;
            s.rows = [1];
          },
          gate,
        )()
        .catch((error: unknown) => error);
      store.setTransient('/rows/0', 2);
      const remove = (s: typeof initial) => {
        callbacks++;
        delete s.rows;
      };
      const results = [first];
      if (entry === 'direct') delete store.state.rows;
      else if (entry === 'action') store.action('delete', remove)();
      else
        results.push(
          store
            .optimistic('delete', remove, gate)()
            .catch((error: unknown) => error),
        );
      const order = results.map((_result, index) => index);
      if (reverse) order.reverse();
      for (const index of order) {
        const error = new Error(`reject ${index}`);
        rejects[index](error);
        eq(`boundary ${entry}/${reverse}: rejection`, (await results[index]) === error, true);
      }
      const rows = store.raw.rows;
      for (const frame of frames.splice(0)) frame(0);
      eq(
        `boundary ${entry}/${reverse}: final`,
        store.raw,
        entry === 'optimistic' ? { other: [9], rows: [2] } : initial,
      );
      eq(`boundary ${entry}/${reverse}: identity after frame`, store.raw.rows === rows, true);
      eq(`boundary ${entry}/${reverse}: callback count`, callbacks, entry === 'direct' ? 1 : 2);
      const restored = createStore(initial);
      try {
        restored.hydrate(disk);
        eq(`boundary ${entry}/${reverse}: persisted state`, restored.raw, store.raw);
        eq(`boundary ${entry}/${reverse}: persisted array`, Array.isArray(restored.raw.rows), entry === 'optimistic');
      } catch (error) {
        eq(`boundary ${entry}/${reverse}: hydration error`, String(error), undefined);
      }
    } finally {
      if (originalFrame) globalThis.requestAnimationFrame = originalFrame;
      else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
    }
  }
}

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall assertions passed');
process.exit(failed ? 1 : 0);
