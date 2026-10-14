import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, NotificationError, StateError } from './core';
import { latestTask } from './latest-task';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('Cal.com-derived: older availability cannot overwrite the newer selected date', async () => {
  const runtime = new Runtime(),
    old = deferred<string[]>(),
    next = deferred<string[]>();
  const date = runtime.signal(''),
    slots = runtime.signal<string[]>([]),
    seen: string[] = [];
  runtime.derive(() => `${date.get()}:${slots.get().join(',')}`).subscribe((v) => seen.push(v));
  const load = latestTask(
    runtime,
    (input: string) => (input === 'old' ? old.promise : next.promise),
    (result, input) => {
      date.set(input);
      slots.set(result);
    },
  );
  const first = load.run('old'),
    second = load.run('new');
  next.resolve(['10:00']);
  assert.equal(await second, 'committed');
  old.resolve(['09:00']);
  assert.equal(await first, 'superseded');
  assert.deepEqual(seen, ['new:10:00']);
  assert.equal(runtime.version, 1);
  load.dispose();
  runtime.dispose();
});
test('cancel invalidates commit authority even when the provider ignores AbortSignal', async () => {
  const runtime = new Runtime(),
    pending = deferred<number>(),
    value = runtime.signal(0);
  let signal!: AbortSignal;
  const task = latestTask(
    runtime,
    (_: number, s) => {
      signal = s;
      return pending.promise;
    },
    (v) => value.set(v),
  );
  const run = task.run(1);
  task.cancel();
  assert(signal.aborted);
  pending.resolve(3);
  assert.equal(await run, 'cancelled');
  assert.equal(value.get(), 0);
  task.dispose();
  runtime.dispose();
});
test('current failures are reported; stale failures are consumed without undoing newer state', async () => {
  const runtime = new Runtime(),
    old = deferred<number>(),
    next = deferred<number>();
  const value = runtime.signal(0),
    task = latestTask(
      runtime,
      (n: number) => (n ? next.promise : old.promise),
      (v) => value.set(v),
    );
  const first = task.run(0),
    second = task.run(1);
  old.reject(Error('obsolete response'));
  assert.equal(await first, 'superseded');
  next.reject(Error('current failure'));
  await assert.rejects(second, /current failure/);
  assert.equal(value.get(), 0);
  task.dispose();
  runtime.dispose();
});
test('commit validation failure rolls back all result fields', async () => {
  const runtime = new Runtime(),
    left = runtime.signal(0),
    right = runtime.signal(0);
  const task = latestTask(
    runtime,
    () => 1,
    (v) => {
      left.set(v);
      right.set(v);
      throw Error('rejected');
    },
  );
  await assert.rejects(task.run(undefined), /rejected/);
  assert.deepEqual([left.get(), right.get(), runtime.version], [0, 0, 0]);
  task.dispose();
  runtime.dispose();
});
test('observer failure is reported as committed, not retried or rolled back', async () => {
  const runtime = new Runtime(),
    value = runtime.signal(0);
  value.subscribe(() => {
    throw Error('view failed');
  });
  const task = latestTask(
    runtime,
    () => 7,
    (v) => value.set(v),
  );
  await assert.rejects(task.run(undefined), (e) => e instanceof NotificationError && e.committed);
  assert.equal(value.get(), 7);
  assert.equal(runtime.version, 1);
  task.dispose();
  runtime.dispose();
});
test('owner disposal cancels outstanding work and refuses subsequent starts', async () => {
  const runtime = new Runtime(),
    pending = deferred<number>(),
    value = runtime.signal(0);
  const task = latestTask(
    runtime,
    () => pending.promise,
    (v) => value.set(v),
  );
  const result = task.run(undefined);
  task.dispose();
  task.dispose();
  pending.resolve(2);
  assert.equal(await result, 'cancelled');
  assert.throws(
    () => task.run(undefined),
    (e) => e instanceof StateError && e.code === 'STATE_TASK_DISPOSED',
  );
  assert.equal(value.get(), 0);
  runtime.dispose();
});
test('an illegal start cannot abort an existing legal request', async () => {
  const runtime = new Runtime(),
    pending = deferred<number>(),
    value = runtime.signal(0);
  let calls = 0,
    signal!: AbortSignal;
  const task = latestTask(
    runtime,
    (_: number, s) => {
      calls++;
      signal = s;
      return pending.promise;
    },
    (v) => value.set(v),
  );
  const result = task.run(1);
  assert.throws(
    () =>
      runtime.transaction(() => {
        task.run(2);
      }),
    (e) => e instanceof StateError && e.code === 'STATE_TASK_BOUNDARY',
  );
  assert.equal(calls, 1);
  assert.equal(signal.aborted, false);
  pending.resolve(3);
  assert.equal(await result, 'committed');
  task.dispose();
  runtime.dispose();
});
test('abort callbacks that start a newer task cannot restore displaced commit authority', async () => {
  const runtime = new Runtime(),
    value = runtime.signal(0),
    old = deferred<number>();
  const calls: number[] = [];
  let nested!: Promise<string>;
  const task = latestTask(
    runtime,
    (n: number, signal) => {
      calls.push(n);
      if (n === 1)
        signal.addEventListener('abort', () => {
          nested = task.run(3);
        });
      return n === 1 ? old.promise : Promise.resolve(n);
    },
    (v) => value.set(v),
  );
  const first = task.run(1),
    second = task.run(2);
  assert.equal(await second, 'superseded');
  assert.equal(await nested, 'committed');
  old.resolve(1);
  assert.equal(await first, 'superseded');
  assert.equal(value.get(), 3);
  assert.deepEqual(calls, [1, 3]);
  task.dispose();
  runtime.dispose();
});
for (const order of [
  [0, 1, 2],
  [0, 2, 1],
  [1, 0, 2],
  [1, 2, 0],
  [2, 0, 1],
  [2, 1, 0],
]) {
  test(`latest commit is stable for completion order ${order.join('→')}`, async () => {
    const runtime = new Runtime(),
      value = runtime.signal(-1),
      work = [deferred<number>(), deferred<number>(), deferred<number>()];
    const task = latestTask(
      runtime,
      (n: number) => work[n].promise,
      (v) => value.set(v),
    );
    const requests = [task.run(0), task.run(1), task.run(2)];
    for (const id of order) {
      work[id].resolve(id);
      await Promise.resolve();
    }
    assert.deepEqual(await Promise.all(requests), ['superseded', 'superseded', 'committed']);
    assert.equal(value.get(), 2);
    assert.equal(runtime.version, 1);
    task.dispose();
    runtime.dispose();
  });
}
test('a disposed runtime cannot accept late output', async () => {
  const runtime = new Runtime(),
    value = runtime.signal(0),
    pending = deferred<number>();
  const task = latestTask(
    runtime,
    () => pending.promise,
    (v) => value.set(v),
  );
  const result = task.run(undefined);
  runtime.dispose();
  pending.resolve(4);
  await assert.rejects(result, (e) => e instanceof StateError && e.code === 'STATE_DISPOSED');
  task.dispose();
});
test('cancellation settles the caller even when a non-cooperative loader never finishes', async () => {
  const runtime = new Runtime(),
    pending = deferred<number>(),
    value = runtime.signal(0);
  const task = latestTask(
    runtime,
    () => pending.promise,
    (v) => value.set(v),
  );
  let result: string | undefined;
  const running = task.run(undefined).then((v) => {
    result = v;
  });
  task.cancel();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(result, 'cancelled', 'Cancelled UI work must not leave its caller awaiting the network');
  pending.resolve(4);
  await running;
  assert.equal(value.get(), 0);
  task.dispose();
  runtime.dispose();
});
test('disposal during publication must not mask an observer failure as cancellation', async () => {
  const runtime = new Runtime(),
    value = runtime.signal(0);
  const task = latestTask(
    runtime,
    () => 9,
    (v) => value.set(v),
  );
  value.subscribe(() => {
    task.dispose();
    throw Error('view failed after commit');
  });
  await assert.rejects(task.run(undefined), (e) => e instanceof NotificationError && e.committed);
  assert.equal(value.get(), 9);
  runtime.dispose();
});
test('pure readers cannot start a task or call its loader', () => {
  const runtime = new Runtime();
  let calls = 0;
  const task = latestTask(
    runtime,
    () => {
      calls++;
      return 1;
    },
    () => undefined,
  );
  const read = runtime.derive(() => {
    task.run(undefined);
    return 0;
  });
  assert.throws(
    () => read.get(),
    (e) => e instanceof StateError && e.code === 'STATE_IMPURE_DERIVE',
  );
  assert.equal(calls, 0);
  task.dispose();
  runtime.dispose();
});

test('pure readers cannot dispose a task or revoke an active request', async () => {
  const runtime = new Runtime(),
    pending = deferred<number>(),
    value = runtime.signal(0);
  const task = latestTask(
    runtime,
    () => pending.promise,
    (v) => value.set(v),
  );
  const running = task.run(undefined);
  const read = runtime.derive(() => {
    task.dispose();
    return 0;
  });
  assert.throws(
    () => read.get(),
    (e) => e instanceof StateError && e.code === 'STATE_IMPURE_DERIVE',
  );
  pending.resolve(3);
  assert.equal(await running, 'committed');
  assert.equal(value.get(), 3);
  task.dispose();
  runtime.dispose();
});
test('rejected transactional cancellation leaves the existing request intact and rolls back UI writes', async () => {
  const runtime = new Runtime(),
    pending = deferred<number>(),
    value = runtime.signal(0);
  const task = latestTask(
    runtime,
    () => pending.promise,
    (v) => value.set(v),
  );
  const running = task.run(undefined);
  assert.throws(
    () =>
      runtime.transaction(() => {
        value.set(-1);
        task.cancel();
      }),
    (e) => e instanceof StateError && e.code === 'STATE_TASK_BOUNDARY',
  );
  assert.equal(value.get(), 0);
  assert.throws(
    () => runtime.transaction(() => task.dispose()),
    (e) => e instanceof StateError && e.code === 'STATE_TASK_BOUNDARY',
  );
  pending.resolve(8);
  assert.equal(await running, 'committed');
  assert.equal(value.get(), 8);
  task.dispose();
  runtime.dispose();
});
