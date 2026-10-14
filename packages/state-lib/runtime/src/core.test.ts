import assert from 'node:assert/strict';
import { NotificationError, Runtime, StateError } from './core';

{
  const runtime = new Runtime();
  const a = runtime.signal(1);
  const b = runtime.signal(2);
  const sum = runtime.derive(() => a.get() + b.get());
  const seen: Array<[number, number]> = [];
  const dispose = sum.subscribe((value, previous) => seen.push([value, previous]));

  runtime.transaction(() => {
    a.set(10);
    b.set(20);
    assert.equal(sum.get(), 30);
    assert.deepEqual(seen, []);
  });

  assert.equal(sum.get(), 30);
  assert.deepEqual(seen, [[30, 3]]);
  assert.equal(runtime.version, 1);
  dispose();
  sum.dispose();
  runtime.dispose();
}

{
  const runtime = new Runtime();
  const value = runtime.signal(1);
  assert.throws(
    () =>
      runtime.transaction(() => {
        value.set(2);
        throw new Error('abort');
      }),
    /abort/,
  );
  assert.equal(value.get(), 1);
  assert.equal(runtime.version, 0);
  runtime.dispose();
}

{
  const runtime = new Runtime();
  const a = runtime.signal(0);
  const b = runtime.signal(0);
  runtime.transaction(() => {
    a.set(1);
    try {
      runtime.transaction(() => {
        a.set(2);
        b.set(2);
        throw new Error('nested abort');
      });
    } catch {}
    assert.equal(a.get(), 1);
    assert.equal(b.get(), 0);
    b.set(3);
  });
  assert.equal(a.get(), 1);
  assert.equal(b.get(), 3);
  assert.equal(runtime.version, 1);
  runtime.dispose();
}

{
  const runtime = new Runtime();
  const value = runtime.signal(1);
  const dispose = value.subscribe(() => {
    throw new Error('listener failed');
  });
  let error: unknown;
  try {
    value.set(2);
  } catch (caught) {
    error = caught;
  }
  assert.ok(error instanceof NotificationError);
  assert.equal(error.committed, true);
  assert.equal(value.get(), 2);
  assert.equal(runtime.version, 1);
  dispose();
  runtime.dispose();
}

{
  const runtime = new Runtime();
  const value = runtime.signal(1);
  assert.throws(
    () => runtime.transaction(() => Promise.resolve(value.set(2)) as never),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_ASYNC_TRANSACTION',
  );
  assert.equal(value.get(), 1);
  assert.equal(runtime.version, 0);
  runtime.dispose();
}

{
  const runtime = new Runtime();
  const source = runtime.signal(1);
  const bad = runtime.derive(() => {
    source.set(2);
    return source.get();
  });
  assert.throws(
    () => bad.get(),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_IMPURE_DERIVE',
  );
  assert.equal(source.get(), 1);
  bad.dispose();
  runtime.dispose();
}

{
  const runtime = new Runtime();
  const cycle: { get(): number; dispose(): void } = runtime.derive(() => cycle.get() + 1);
  assert.throws(
    () => cycle.get(),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_CYCLE',
  );
  cycle.dispose();
  runtime.dispose();
}

console.info('state runtime invariants passed');
