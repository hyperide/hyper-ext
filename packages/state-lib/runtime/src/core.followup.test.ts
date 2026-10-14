/** Runtime boundary and savepoint regressions for composed synchronous actions. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NotificationError, Runtime, StateError } from './core';

// Resolve the declared test loader independently of the caller's working directory.
const testLoader = pathToFileURL(
  createRequire(new URL('../../site/package.json', import.meta.url)).resolve('tsx'),
).href;

for (const reread of [false, true]) {
  for (const fails of [false, true]) {
    test(`self-disposal immediately releases previous derivation edges, reread=${reread}, fails=${fails}`, () => {
      const runtime = new Runtime();
      const trigger = runtime.signal(false);
      const child = runtime.derive(() => 1);
      const failure = new Error('evaluation failed');
      const parent = runtime.derive((): number => {
        if (!trigger.get()) return child.get();
        if (reread) child.get();
        parent.dispose();
        child.dispose();
        if (fails) throw failure;
        return 0;
      });
      assert.equal(parent.get(), 1);
      trigger.set(true);
      if (fails)
        assert.throws(
          () => parent.get(),
          (error) => error === failure,
        );
      else assert.equal(parent.get(), 0);
      assert.throws(() => parent.get(), { code: 'STATE_DISPOSED' });
      assert.throws(() => child.get(), { code: 'STATE_DISPOSED' });
      runtime.dispose();
    });
  }
}

test('self-disposal preserves another live derivation dependency', () => {
  const runtime = new Runtime();
  const trigger = runtime.signal(false);
  const child = runtime.derive(() => 1);
  const live = runtime.derive(() => child.get());
  assert.equal(live.get(), 1);
  const parent = runtime.derive((): number => {
    if (!trigger.get()) return child.get();
    parent.dispose();
    assert.throws(() => child.dispose(), { code: 'STATE_OBSERVED_DISPOSE' });
    live.dispose();
    child.dispose();
    return 0;
  });
  assert.equal(parent.get(), 1);
  trigger.set(true);
  assert.equal(parent.get(), 0);
  runtime.dispose();
});

for (const reread of [false, true]) {
  test(`unsubscribing during a watch read immediately releases old edges, reread=${reread}`, () => {
    const runtime = new Runtime();
    const trigger = runtime.signal(false);
    const child = runtime.derive(() => 1);
    let stop = () => {};
    let reads = 0;
    stop = runtime.watch(
      () => {
        reads++;
        if (!trigger.get()) return child.get();
        if (reread) child.get();
        stop();
        child.dispose();
        return 0;
      },
      () => assert.fail('disposed watch notified'),
    );
    assert.doesNotThrow(() => trigger.set(true));
    assert.throws(() => child.get(), { code: 'STATE_DISPOSED' });
    trigger.set(false);
    assert.equal(reads, 2);
    runtime.dispose();
  });
}

test('unsubscribing one watch preserves a live observer dependency', () => {
  const runtime = new Runtime();
  const trigger = runtime.signal(false);
  const child = runtime.derive(() => 1);
  const live = child.subscribe(() => {});
  let stop = () => {};
  stop = runtime.watch(
    () => {
      if (!trigger.get()) return child.get();
      stop();
      assert.throws(() => child.dispose(), { code: 'STATE_OBSERVED_DISPOSE' });
      return 0;
    },
    () => assert.fail('disposed watch notified'),
  );
  trigger.set(true);
  live();
  child.dispose();
  runtime.dispose();
});

for (const kind of ['parent', 'watch', 'indirect', 'self', 'untracked self'] as const) {
  test(`disposal rejects an in-flight ${kind} consumer before its edges are installed`, () => {
    const runtime = new Runtime();
    const source = runtime.signal(1);
    const child = runtime.derive((): number => {
      const value = source.get();
      if (kind === 'self') child.dispose();
      if (kind === 'untracked self') runtime.untrack(() => child.dispose());
      return value;
    });
    const middle = runtime.derive(() => {
      const value = child.get();
      child.dispose();
      return value;
    });
    const read = () => {
      if (kind === 'indirect') return middle.get();
      const value = child.get();
      if (kind === 'parent' || kind === 'watch') child.dispose();
      return value;
    };
    const parent = runtime.derive(read);
    assert.throws(() => (kind === 'watch' ? runtime.watch(read, () => {}) : parent.get()), {
      code: 'STATE_OBSERVED_DISPOSE',
    });
    runtime.dispose();
  });
}

for (const context of ['read-only transaction', 'staged transaction', 'equality preflight'] as const) {
  test(`shared DAG evaluates each node once per pure evaluation in ${context}`, () => {
    const runtime = new Runtime();
    const source = runtime.signal(1);
    let calls = 0;
    let top = runtime.derive(() => {
      calls++;
      return source.get();
    });
    for (let index = 1; index < 25; index++) {
      const previous = top;
      top = runtime.derive(() => {
        calls++;
        return previous.get() + previous.get();
      });
    }
    const trigger = runtime.signal(0, () => {
      assert.equal(top.get() + top.get(), 2 ** 25);
      return false;
    });
    if (context === 'equality preflight') trigger.set(1);
    else
      runtime.transaction(() => {
        if (context === 'staged transaction') source.set(1);
        assert.equal(top.get(), 2 ** 24);
      });
    assert.equal(calls, 25);
    runtime.dispose();
  });
}

test('disposal rejection preserves recovery and releases failed initial watch reads', () => {
  const runtime = new Runtime();
  const source = runtime.signal(1);
  const child = runtime.derive(() => source.get());
  const parent = runtime.derive(() => {
    const value = child.get();
    assert.throws(() => runtime.untrack(() => child.dispose()), { code: 'STATE_OBSERVED_DISPOSE' });
    return value;
  });
  const seen: number[] = [];
  const stop = parent.subscribe((value) => seen.push(value));
  source.set(2);
  assert.equal(parent.get(), 2);
  assert.deepEqual(seen, [2]);
  stop();
  parent.dispose();
  assert.throws(
    () =>
      runtime.watch(
        () => {
          child.get();
          child.dispose();
        },
        () => {},
      ),
    { code: 'STATE_OBSERVED_DISPOSE' },
  );
  child.dispose();
  runtime.dispose();
});

for (const staged of [false, true]) {
  test(`self-disposal respects tracked callers and unobserved snapshots (staged=${staged})`, () => {
    const runtime = new Runtime();
    const self = runtime.derive((): number => {
      runtime.untrack(() => self.dispose());
      return 7;
    });
    const parent = runtime.derive(() => self.get());
    const read = () => assert.throws(() => parent.get(), { code: 'STATE_OBSERVED_DISPOSE' });
    if (staged) runtime.transaction(read);
    else read();
    parent.dispose();
    // The failed committed read remains cached until disposal; use a cold snapshot.
    const snapshot = runtime.derive((): number => {
      runtime.untrack(() => snapshot.dispose());
      return 8;
    });
    const unobserved = runtime.derive(() => snapshot.peek());
    if (staged) runtime.transaction(() => assert.equal(unobserved.get(), 8));
    else assert.equal(unobserved.get(), 8);
    assert.throws(() => snapshot.get(), { code: 'STATE_DISPOSED' });
    runtime.dispose();
  });
}

test('listener unsubscribe permits dependent teardown during delivery', () => {
  const runtime = new Runtime();
  const source = runtime.signal(0);
  const child = runtime.derive(() => source.get());
  let deliveries = 0;
  const stop = child.subscribe(() => {
    deliveries++;
    stop();
    child.dispose();
  });
  source.set(1);
  source.set(2);
  assert.equal(deliveries, 1);
  runtime.dispose();
});

test('an unobserved staged derive may dispose itself after catching its own cycle', () => {
  const runtime = new Runtime();
  const self = runtime.derive((): number => {
    assert.throws(() => self.get(), { code: 'STATE_CYCLE' });
    runtime.untrack(() => self.dispose());
    return 1;
  });
  runtime.transaction(() => assert.equal(self.get(), 1));
  assert.throws(() => self.get(), { code: 'STATE_DISPOSED' });
  runtime.dispose();
});

test('staged memo ends at each read and follows branches through nested savepoints', () => {
  const runtime = new Runtime();
  const branch = runtime.signal(true);
  const left = runtime.signal(1);
  const right = runtime.signal(10);
  let calls = 0;
  const selected = runtime.derive(() => {
    calls++;
    return branch.get() ? left.get() : right.get();
  });
  const twice = runtime.derive(() => selected.get() + selected.get());
  assert.equal(twice.get(), 2);
  runtime.transaction(() => {
    const check = (value: number) => {
      const before = calls;
      assert.equal(twice.get(), value);
      assert.equal(calls, before + 1);
    };
    check(2);
    check(2);
    left.set(2);
    check(4);
    assert.throws(
      () =>
        runtime.transaction(() => {
          branch.set(false);
          check(20);
          runtime.transaction(() => right.set(12));
          check(24);
          throw new Error('inner rollback');
        }),
      /inner rollback/,
    );
    check(4);
    runtime.transaction(() => {
      branch.set(false);
      check(20);
    });
    check(20);
    branch.set(true);
    left.set(1);
  });
  const before = calls;
  assert.equal(twice.get(), 2);
  assert.equal(calls, before);
  right.set(11);
  assert.equal(twice.get(), 2);
  assert.equal(calls, before);
  left.set(3);
  assert.equal(twice.get(), 6);
  assert.equal(calls, before + 1);
  runtime.dispose();
});

for (const failure of ['error', 'self cycle', 'mutual cycle'] as const) {
  test(`staged memo reuses ${failure} outcomes only within one evaluation`, () => {
    const runtime = new Runtime();
    const fail = runtime.signal(true);
    const expected = new Error('read failure');
    let calls = 0;
    const first = runtime.derive((): number => {
      calls++;
      if (!fail.get()) return 3;
      if (failure === 'error') throw expected;
      return failure === 'self cycle' ? first.get() : second.get();
    });
    const second = runtime.derive((): number => first.get());
    const caught = runtime.derive(() => {
      const errors: unknown[] = [];
      for (let index = 0; index < 2; index++) {
        try {
          first.get();
        } catch (error) {
          errors.push(error);
        }
      }
      assert.equal(errors.length, 2);
      assert.equal(errors[0], errors[1]);
      if (failure === 'error') assert.equal(errors[0], expected);
      else assert.ok(errors[0] instanceof StateError && errors[0].code === 'STATE_CYCLE');
      return 0;
    });
    runtime.transaction(() => {
      assert.equal(caught.get(), 0);
      assert.equal(calls, 1);
      assert.equal(caught.get(), 0);
      assert.equal(calls, 2);
      fail.set(false);
      assert.equal(first.get(), 3);
      assert.equal(calls, 3);
      fail.set(true);
      assert.equal(caught.get(), 0);
      assert.equal(calls, 4);
    });
    assert.throws(() => first.get());
    assert.equal(calls, 5);
    fail.set(false);
    assert.equal(first.get(), 3);
    runtime.dispose();
  });
}

test('failed preflights discard memo outcomes without committing values or dynamic edges', () => {
  const runtime = new Runtime();
  const branch = runtime.signal(true);
  const left = runtime.signal(1);
  const right = runtime.signal(10);
  let calls = 0;
  let reject = true;
  const selected = runtime.derive(() => {
    calls++;
    return branch.get() ? left.get() : right.get();
  });
  const trigger = runtime.signal(0, () => {
    const before = calls;
    assert.equal(selected.get() + selected.get(), 20);
    assert.equal(calls, before + 1);
    if (reject) throw new Error('reject preflight');
    return false;
  });
  assert.equal(selected.get(), 1);
  const commit = () =>
    runtime.transaction(() => {
      branch.set(false);
      trigger.set(1);
    });
  for (let index = 0; index < 2; index++) {
    assert.throws(commit, /reject preflight/);
    const before = calls;
    assert.equal(selected.get(), 1);
    assert.equal(calls, before);
    assert.equal(branch.get(), true);
    assert.equal(trigger.get(), 0);
    assert.equal(runtime.version, 0);
  }
  right.set(12);
  const before = calls;
  assert.equal(selected.get(), 1);
  assert.equal(calls, before);
  right.set(10);
  reject = false;
  commit();
  assert.equal(selected.get(), 10);
  assert.equal(calls, before + 2);
  runtime.dispose();
});

test('cold staged memo entries install no edges and stay isolated across runtimes', () => {
  const runtime = new Runtime();
  const foreign = new Runtime();
  const source = runtime.derive(() => 1);
  const other = foreign.signal(10);
  let calls = 0;
  const snapshot = foreign.derive(() => {
    calls++;
    return other.get();
  });
  const parent = runtime.derive(() => {
    assert.throws(() => other.set(11), { code: 'STATE_IMPURE_DERIVE' });
    const value = snapshot.peek();
    assert.throws(() => snapshot.get(), { code: 'STATE_CROSS_RUNTIME_READ' });
    return source.get() + source.get() + value;
  });
  runtime.transaction(() => {
    assert.equal(parent.get(), 12);
    assert.equal(parent.get(), 12);
  });
  assert.equal(calls, 1);
  // A staged parent must not make this cold source permanently observed.
  source.dispose();
  assert.throws(() => parent.get(), { code: 'STATE_DISPOSED' });
  runtime.dispose();
  other.set(12);
  assert.equal(snapshot.get(), 12);
  assert.equal(calls, 2);
  foreign.dispose();
});

test('staged memo consumers protect indirect dependencies until the pure boundary exits', () => {
  const runtime = new Runtime();
  const child = runtime.derive(() => 1);
  const middle = runtime.derive(() => child.get());
  const parent = runtime.derive(() => {
    const value = middle.get();
    assert.throws(() => runtime.untrack(() => child.dispose()), { code: 'STATE_OBSERVED_DISPOSE' });
    return value + middle.get();
  });
  runtime.transaction(() => assert.equal(parent.get(), 2));
  child.dispose();
  assert.throws(() => runtime.transaction(() => parent.get()), { code: 'STATE_DISPOSED' });
  runtime.dispose();
});

test('graph allocation rejects transactions and pure callbacks before ownership changes', () => {
  const runtime = new Runtime();
  const foreign = new Runtime();
  const source = runtime.signal(0);
  for (const allocate of [() => runtime.derive(() => source.get()), () => runtime.signal(1)]) {
    assert.throws(
      () =>
        runtime.transaction(() => {
          source.set(1);
          allocate();
          throw new Error('later failure');
        }),
      { code: 'STATE_GRAPH_BOUNDARY' },
    );
    assert.equal(source.get(), 0);
    assert.equal(runtime.version, 0);
    const read = runtime.derive(() => {
      allocate();
      return 1;
    });
    assert.throws(() => read.get(), { code: 'STATE_GRAPH_BOUNDARY' });
    read.dispose();
  }
  const read = runtime.derive(() => foreign.derive(() => 1).get());
  assert.throws(() => read.get(), { code: 'STATE_GRAPH_BOUNDARY' });
  assert.throws(
    () =>
      runtime.watch(
        () =>
          foreign.watch(
            () => 1,
            () => {},
          ),
        () => {},
      ),
    { code: 'STATE_OBSERVER_BOUNDARY' },
  );
  const good = runtime.derive(() => source.get());
  const seen: number[] = [];
  good.subscribe((value) => seen.push(value));
  source.set(2);
  assert.deepEqual(seen, [2]);
  runtime.dispose();
  foreign.dispose();
});

for (const kind of ['signal', 'cold derive', 'warm derive'] as const) {
  test(`foreign ${kind} tracked reads fail in derive/watch and recover on local changes`, () => {
    const a = new Runtime();
    const b = new Runtime();
    const local = a.signal(false);
    const source = b.signal(10);
    const foreign = kind === 'signal' ? source : b.derive(() => source.get());
    if (kind === 'warm derive') assert.equal(foreign.get(), 10);
    const read = () => (local.get() ? 1 : foreign.get());
    const derived = a.derive(read);
    assert.throws(() => derived.get(), { code: 'STATE_CROSS_RUNTIME_READ' });
    assert.throws(() => a.watch(read, () => {}), { code: 'STATE_CROSS_RUNTIME_READ' });
    assert.throws(() => a.transaction(() => derived.get()), { code: 'STATE_CROSS_RUNTIME_READ' });
    local.set(true);
    assert.equal(derived.get(), 1);
    const seen: number[] = [];
    derived.subscribe((value) => seen.push(value));
    assert.throws(
      () => local.set(false),
      (error) =>
        error instanceof NotificationError &&
        error.errors.some((cause) => cause instanceof StateError && cause.code === 'STATE_CROSS_RUNTIME_READ'),
    );
    local.set(true);
    source.set(11);
    assert.throws(() => local.set(false), NotificationError);
    local.set(true);
    assert.deepEqual(seen, []);
    a.dispose();
    assert.equal(foreign.get(), 11);
    b.dispose();
  });
}

test('peek and either runtime untrack permit snapshots without foreign subscriptions', () => {
  const a = new Runtime();
  const b = new Runtime();
  const local = a.signal(1);
  const foreign = b.signal(10);
  const doubled = b.derive(() => foreign.get() * 2);
  const snapshot = a.derive(
    () =>
      local.get() + foreign.peek() + doubled.peek() + a.untrack(() => foreign.get()) + b.untrack(() => foreign.get()),
  );
  const seen: number[] = [];
  snapshot.subscribe((value) => seen.push(value));
  assert.equal(snapshot.get(), 51);
  foreign.set(20);
  assert.equal(snapshot.get(), 51);
  assert.deepEqual(seen, []);
  local.set(2);
  assert.deepEqual(seen, [102]);
  assert.throws(
    () =>
      a.untrack(() => {
        throw new Error('untrack failed');
      }),
    /untrack failed/,
  );
  const bad = a.derive(() => foreign.get());
  assert.throws(() => bad.get(), { code: 'STATE_CROSS_RUNTIME_READ' });
  a.dispose();
  foreign.set(21);
  assert.equal(doubled.get(), 42);
  b.dispose();
});

for (const boundary of ['derive', 'watch', 'signal equality', 'watch equality'] as const) {
  for (const operation of ['set', 'update', 'transaction'] as const) {
    test(`${boundary} rejects foreign ${operation} even through untrack`, () => {
      const a = new Runtime();
      const b = new Runtime();
      const source = b.signal(0);
      let callbacks = 0;
      const write = () =>
        b.untrack(() => {
          if (operation === 'set') source.set(1);
          else if (operation === 'update')
            source.update((value) => {
              callbacks++;
              return value + 1;
            });
          else
            b.transaction(() => {
              callbacks++;
              source.set(1);
            });
          return false;
        });
      let invoke: () => void;
      if (boundary === 'derive')
        invoke = () => {
          a.derive(write).get();
        };
      else if (boundary === 'watch')
        invoke = () => {
          a.watch(write, () => {});
        };
      else if (boundary === 'signal equality') {
        const local = a.signal(0, write);
        invoke = () => local.set(1);
      } else {
        const local = a.signal(0);
        a.watch(
          () => local.get(),
          () => {},
          write,
        );
        invoke = () => local.set(1);
      }
      if (boundary === 'watch equality')
        assert.throws(
          invoke,
          (error) =>
            error instanceof NotificationError &&
            error.errors.some((cause) => cause instanceof StateError && cause.code === 'STATE_IMPURE_DERIVE'),
        );
      else assert.throws(invoke, { code: 'STATE_IMPURE_DERIVE' });
      assert.equal(callbacks, 0);
      assert.equal(source.get(), 0);
      assert.equal(b.version, 0);
      source.set(2);
      assert.equal(source.get(), 2);
      a.dispose();
      b.dispose();
    });
  }
}

test('journal restores repeated, introduced and successful descendant writes at each savepoint', () => {
  const runtime = new Runtime();
  const first = runtime.signal<number | undefined>(undefined);
  const second = runtime.signal(0);
  const sum = runtime.derive(() => (first.get() ?? 0) + second.get());
  const seen: number[] = [];
  sum.subscribe((value) => seen.push(value));
  runtime.transaction(() => {
    first.set(1);
    assert.throws(
      () =>
        runtime.transaction(() => {
          first.set(2);
          first.set(undefined);
          runtime.transaction(() => {
            first.set(3);
            second.set(4);
          });
          assert.equal(sum.get(), 7);
          throw new Error('middle abort');
        }),
      /middle abort/,
    );
    assert.equal(first.get(), 1);
    assert.equal(second.get(), 0);
    runtime.transaction(() => {
      second.set(5);
    });
    assert.equal(sum.get(), 6);
  });
  assert.deepEqual(seen, [6]);
  assert.throws(
    () =>
      runtime.transaction(() => {
        runtime.transaction(() => {
          first.set(undefined);
          second.set(9);
        });
        throw new Error('outer abort');
      }),
    /outer abort/,
  );
  assert.equal(sum.get(), 6);
  assert.equal(runtime.version, 1);
  second.set(6);
  assert.deepEqual(seen, [6, 7]);
  runtime.dispose();
});

test('watch read failures retain local recovery edges and never attach foreign edges', () => {
  const a = new Runtime();
  const b = new Runtime();
  const local = a.signal(1);
  const foreign = b.derive(() => 10);
  const seen: number[] = [];
  a.watch(
    () => (local.get() < 0 ? foreign.get() : local.get()),
    (value) => seen.push(value),
  );
  assert.throws(
    () => local.set(-1),
    (error) =>
      error instanceof NotificationError &&
      error.errors.some((cause) => cause instanceof StateError && cause.code === 'STATE_CROSS_RUNTIME_READ'),
  );
  foreign.dispose();
  local.set(2);
  assert.deepEqual(seen, [2]);
  a.dispose();
  b.dispose();
});

test('interleaved requests retain independent values, revisions, notifications and disposal', async () => {
  const request = async (initial: number) => {
    const runtime = new Runtime();
    const source = runtime.signal(initial);
    const doubled = runtime.derive(() => source.get() * 2);
    const seen: number[] = [];
    doubled.subscribe((value) => seen.push(value));
    await Promise.resolve();
    runtime.transaction(() => {
      source.set(initial + 1);
      assert.throws(
        () =>
          runtime.transaction(() => {
            source.set(999);
            throw new Error('request abort');
          }),
        /request abort/,
      );
      assert.equal(doubled.get(), (initial + 1) * 2);
    });
    await Promise.resolve();
    assert.equal(doubled.get(), (initial + 1) * 2);
    assert.equal(runtime.version, 1);
    assert.deepEqual(seen, [(initial + 1) * 2]);
    runtime.dispose();
  };
  await Promise.all([request(1), request(100), request(1000)]);
});

test('nested equality rejection publishes nothing and notification reentrancy cannot stage writes', () => {
  const runtime = new Runtime();
  const first = runtime.signal(0);
  let reject = true;
  const second = runtime.signal(0, (left, right) => {
    assert.equal(first.get(), right);
    if (reject) throw new Error('preflight');
    return left === right;
  });
  const seen: number[] = [];
  first.subscribe((value) => {
    assert.equal(second.get(), value);
    assert.throws(() => runtime.transaction(() => first.set(999)), { code: 'STATE_REENTRANT_WRITE' });
    seen.push(value);
  });
  const commit = (value: number) =>
    runtime.transaction(() => {
      runtime.transaction(() => first.set(value));
      runtime.transaction(() => second.set(value));
    });
  assert.throws(() => commit(1), /preflight/);
  assert.equal(first.get(), 0);
  assert.equal(second.get(), 0);
  assert.equal(runtime.version, 0);
  assert.deepEqual(seen, []);
  reject = false;
  commit(2);
  commit(2);
  assert.equal(runtime.version, 1);
  commit(3);
  assert.deepEqual(seen, [2, 3]);
  runtime.dispose();
});

test('composed action savepoints have linear map work', () => {
  const child = spawnSync(
    'node',
    ['--import', testLoader, fileURLToPath(new URL('./savepoint-scale.mjs', import.meta.url)), '--assert-linear'],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);
  assert.equal(child.stderr, '');
});
