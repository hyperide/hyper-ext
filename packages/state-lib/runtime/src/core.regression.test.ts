/** Regression coverage for cache isolation, graph lifecycle and synchronous boundaries. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { type Derived, NotificationError, Runtime, StateError } from './core';

// Resolve the declared test loader independently of the caller's working directory.
const testLoader = pathToFileURL(
  createRequire(new URL('../../site/package.json', import.meta.url)).resolve('tsx'),
).href;

for (const mutual of [false, true]) {
  test(`conditional ${mutual ? 'mutual' : 'self'} cycle recovers and replaces dynamic edges`, () => {
    const runtime = new Runtime();
    const flag = runtime.signal(true);
    const source = runtime.signal(42);
    let calls = 0;
    const first: Derived<number> = runtime.derive((): number => {
      calls++;
      return flag.get() ? (mutual ? second.get() : first.get()) : source.get();
    });
    const second = runtime.derive((): number => first.get());
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.throws(() => first.get(), { code: 'STATE_CYCLE' });
      flag.set(false);
      assert.equal(first.get(), 42);
      assert.equal(second.get(), 42);
      flag.set(true);
    }
    assert.throws(() => first.get(), { code: 'STATE_CYCLE' });
    const before = calls;
    source.set(43);
    assert.throws(() => first.get(), { code: 'STATE_CYCLE' });
    assert.equal(calls, before);
    flag.set(false);
    assert.equal(first.get(), 43);
    runtime.dispose();
  });
}

for (const throws of [false, true]) {
  for (const kind of ['observer', 'derive'] as const) {
    test(`self-disposed ${kind} detaches old and new reads when evaluation ${throws ? 'throws' : 'returns'}`, () => {
      const runtime = new Runtime();
      const trigger = runtime.signal(false);
      const old = runtime.derive(() => 1);
      const next = runtime.derive(() => 2);
      let stop = () => {};
      let reads = 0;
      let deliveries = 0;
      const read = () => {
        reads++;
        if (!trigger.get()) return old.get();
        stop();
        const result = next.get();
        if (throws) throw new Error('disposed read failed');
        return result;
      };
      if (kind === 'observer') {
        stop = runtime.watch(read, () => deliveries++);
        if (throws) assert.throws(() => trigger.set(true), NotificationError);
        else trigger.set(true);
      } else {
        const derived = runtime.derive(read);
        stop = () => derived.dispose();
        assert.equal(derived.get(), 1);
        trigger.set(true);
        if (throws) assert.throws(() => derived.get(), /disposed read failed/);
        else assert.equal(derived.get(), 2);
        assert.throws(() => derived.get(), { code: 'STATE_DISPOSED' });
      }
      stop();
      assert.doesNotThrow(() => old.dispose());
      assert.doesNotThrow(() => next.dispose());
      trigger.set(false);
      assert.equal(reads, 2);
      assert.equal(deliveries, 0);
      runtime.dispose();
    });
  }
}

test('a staged cycle leaves the committed graph and observed-disposal guard intact', () => {
  const runtime = new Runtime();
  const cyclic = runtime.signal(false);
  const source = runtime.signal(42);
  const derived: Derived<number> = runtime.derive((): number => (cyclic.get() ? derived.get() : source.get()));
  const seen: number[] = [];
  const stop = derived.subscribe((value) => seen.push(value));
  assert.throws(() => derived.dispose(), { code: 'STATE_OBSERVED_DISPOSE' });
  assert.throws(
    () =>
      runtime.transaction(() => {
        cyclic.set(true);
        derived.get();
      }),
    { code: 'STATE_CYCLE' },
  );
  assert.equal(cyclic.get(), false);
  assert.equal(derived.get(), 42);
  source.set(43);
  assert.deepEqual(seen, [43]);
  stop();
  derived.dispose();
  runtime.dispose();
});

for (const boundary of ['transaction', 'derive', 'watch', 'equality']) {
  test(`rejected Promise at ${boundary} boundary has no unhandled rejection`, () => {
    // Run JavaScript under Node's fatal rejection policy without a rejection listener.
    const child = spawnSync(
      'node',
      [
        '--import',
        testLoader,
        '--unhandled-rejections=strict',
        '--input-type=module',
        '-e',
        `
      import assert from 'node:assert/strict';
      import { Runtime } from ${JSON.stringify(new URL('./core.ts', import.meta.url).href)};
      for (const reject of [
        () => Promise.reject(new Error('original rejection')),
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('delayed rejection')), 0)),
        () => ({ then(_resolve, reject) { reject(new Error('thenable rejection')); } }),
      ]) {
      const runtime = new Runtime();
      const source = runtime.signal(0);
      const invoke = {
        transaction: () => runtime.transaction(() => { source.set(1); return reject(); }),
        derive: () => runtime.derive(reject).get(),
        watch: () => runtime.watch(reject, () => {}),
        equality: () => runtime.signal(0, reject).set(1),
      }[${JSON.stringify(boundary)}];
      assert.throws(invoke, { code: ${JSON.stringify(boundary === 'transaction' ? 'STATE_ASYNC_TRANSACTION' : 'STATE_ASYNC_DERIVE')} });
      assert.equal(source.get(), 0);
      assert.equal(runtime.version, 0);
      runtime.dispose();
      }
      setTimeout(() => console.info('rejection drained'), 0);
    `,
      ],
      { encoding: 'utf8', timeout: 10_000 },
    );
    assert.ifError(child.error);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stderr, '');
    assert.match(child.stdout, /rejection drained/);
  });
}

test('failed equality preflight cannot poison a committed derivation cache', () => {
  const runtime = new Runtime();
  const source = runtime.signal(1);
  const doubled = runtime.derive(() => source.get() * 2);
  const gate = runtime.signal(0, () => {
    assert.equal(doubled.get(), 4);
    throw new Error('preflight rejected');
  });
  assert.throws(
    () =>
      runtime.transaction(() => {
        source.set(2);
        gate.set(1);
      }),
    /preflight rejected/,
  );
  assert.equal(source.get(), 1);
  assert.equal(doubled.get(), 2);
  assert.equal(runtime.version, 0);
  runtime.dispose();
});

test('preflight reads the staged snapshot even when committed caches are warm', () => {
  const runtime = new Runtime();
  const source = runtime.signal(1);
  const doubled = runtime.derive(() => source.get() * 2);
  assert.equal(doubled.get(), 2);
  const gate = runtime.signal(0, () => {
    assert.equal(doubled.get(), source.get() * 2);
    return false;
  });
  runtime.transaction(() => {
    source.set(2);
    gate.set(1);
  });
  assert.equal(doubled.get(), 4);
  runtime.dispose();
});

test('root disposal does not depend on derivation creation order', () => {
  const runtime = new Runtime();
  const source = runtime.signal(1);
  const earlier = runtime.derive(() => later.get() + 1);
  const later = runtime.derive(() => source.get() * 2);
  assert.equal(earlier.get(), 3);
  assert.doesNotThrow(() => runtime.dispose());
  assert.throws(
    () => source.get(),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_DISPOSED',
  );
  runtime.dispose();
});

test('update checks write permissions before executing user code', () => {
  const runtime = new Runtime();
  const source = runtime.signal(1);
  let calls = 0;
  const bad = runtime.derive(() => {
    source.update((value) => {
      calls++;
      return value + 1;
    });
    return 0;
  });
  assert.throws(
    () => bad.get(),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_IMPURE_DERIVE',
  );
  assert.equal(calls, 0);
  assert.equal(source.get(), 1);
  runtime.dispose();
});

test('large fan-out does not exceed the JavaScript argument stack', () => {
  const runtime = new Runtime();
  const source = runtime.signal(0);
  const derived = Array.from({ length: 150_000 }, () => runtime.derive(() => source.get()));
  for (const item of derived) assert.equal(item.get(), 0);
  source.set(1);
  for (const item of derived) assert.equal(item.get(), 1);
  runtime.dispose();
});

test('errors and unsubscriptions cannot prevent other queued deliveries', () => {
  const runtime = new Runtime();
  const source = runtime.signal(0);
  const seen: number[] = [];
  const stop = source.subscribe(() => {
    throw new Error('listener failed');
  });
  const stopSecond = source.subscribe((value) => seen.push(value));
  assert.throws(() => source.set(1), NotificationError);
  assert.deepEqual(seen, [1]);
  stop();
  stopSecond();
  // Delivery order is intentionally unspecified. Whichever listener runs first
  // removes the other listener from the already prepared wave.
  const delivered: string[] = [];
  const stopThird = source.subscribe(() => {
    delivered.push('third');
    stopFourth();
  });
  const stopFourth = source.subscribe(() => {
    delivered.push('fourth');
    stopThird();
  });
  source.set(2);
  assert.equal(delivered.length, 1);
  stopThird();
  stopFourth();
  runtime.dispose();
});

test('seeded transactions agree with a from-scratch reference and one delivery per change', () => {
  for (let seed = 1; seed <= 32; seed++) {
    const runtime = new Runtime();
    const cells = Array.from({ length: 8 }, () => runtime.signal(0));
    let model = Array<number>(8).fill(0);
    const total = runtime.derive(() => cells.reduce((n, cell) => n + cell.get(), 0));
    const seen: number[] = [];
    const expected: number[] = [];
    const stop = total.subscribe((value) => seen.push(value));
    let random = seed;
    const next = () => (random = (Math.imul(random, 1664525) + 1013904223) >>> 0);
    for (let event = 0; event < 250; event++) {
      const draft = model.slice();
      const abort = next() % 5 === 0;
      const before = model.reduce((a, b) => a + b, 0);
      try {
        runtime.transaction(() => {
          for (let i = 0; i < 4; i++) {
            const index = next() % cells.length;
            const value = next() % 31;
            cells[index]!.set(value);
            draft[index] = value;
            assert.equal(
              total.get(),
              draft.reduce((a, b) => a + b, 0),
            );
          }
          assert.throws(
            () =>
              runtime.transaction(() => {
                cells[0]!.set(-999);
                throw new Error('savepoint');
              }),
            /savepoint/,
          );
          assert.equal(cells[0]!.get(), draft[0]);
          if (abort) throw new Error('abort');
        });
        model = draft;
        const after = model.reduce((a, b) => a + b, 0);
        if (after !== before) expected.push(after);
      } catch (error) {
        if (!(error instanceof Error) || error.message !== 'abort') throw error;
      }
      assert.deepEqual(
        cells.map((cell) => cell.get()),
        model,
      );
      assert.equal(
        total.get(),
        model.reduce((a, b) => a + b, 0),
      );
      assert.deepEqual(seen, expected);
    }
    stop();
    runtime.dispose();
  }
});
