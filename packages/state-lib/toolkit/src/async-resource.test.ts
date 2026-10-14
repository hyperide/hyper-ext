import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, NotificationError, StateError } from '../../runtime/src/index.js';
import { createAsyncResource } from './async-resource.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test('idle -> initial loading -> success keeps a stable snapshot between transitions', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => gate.promise,
  });
  assert.equal(resource.getSnapshot().status, 'idle');
  const first = resource.getSnapshot();
  const pending = resource.run('a');
  assert.equal(resource.getSnapshot().status, 'loading');
  const loading = resource.getSnapshot();
  assert.equal(loading.status, 'loading');
  const prior = 'data' in loading ? loading.data : undefined;
  assert.equal(prior, undefined);
  assert.strictEqual(resource.getSnapshot(), resource.getSnapshot());
  assert.notStrictEqual(resource.getSnapshot(), first);
  gate.resolve('ok');
  await pending;
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'ok' });
  resource.dispose();
  runtime.dispose();
});

test('truthy and falsy results succeed; empty is explicit via isEmpty only', async () => {
  const runtime = new Runtime();
  const falsy = createAsyncResource<number, number>(runtime, { load: (n) => n });
  await falsy.run(0);
  assert.deepEqual(falsy.getSnapshot(), { status: 'success', data: 0 });
  const texts = createAsyncResource<string, string>(runtime, {
    load: (s) => s,
    isEmpty: (value) => value.length === 0,
  });
  await texts.run('');
  assert.deepEqual(texts.getSnapshot(), { status: 'empty', data: '' });
  await texts.run('hi');
  assert.deepEqual(texts.getSnapshot(), { status: 'success', data: 'hi' });
  falsy.dispose();
  texts.dispose();
  runtime.dispose();
});

test('current failure -> retry -> success; retry without input throws', async () => {
  const runtime = new Runtime();
  let attempts = 0;
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => (attempts++ === 0 ? Promise.reject(new Error('boom')) : Promise.resolve('fixed')),
  });
  assert.throws(() => resource.retry(), /No input to retry/);
  await assert.rejects(resource.run('same-input'), /boom/);
  assert.equal(resource.getSnapshot().status, 'error');
  const failed = resource.getSnapshot();
  assert.ok(failed.status === 'error', `expected error, received ${failed.status}`);
  assert.ok(failed.error instanceof Error);
  await resource.retry();
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'fixed' });
  resource.dispose();
  runtime.dispose();
});

test('refreshing retains the prior result with loading status', async () => {
  const runtime = new Runtime();
  const gates = [deferred<string>(), deferred<string>()];
  let calls = 0;
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => gates[calls++ % gates.length]!.promise,
  });
  const first = resource.run('one');
  gates[0]!.resolve('first');
  await first;
  const second = resource.run('two');
  assert.deepEqual(resource.getSnapshot(), { status: 'loading', data: 'first', hasData: true });
  gates[1]!.resolve('second');
  await second;
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'second' });
  resource.dispose();
  runtime.dispose();
});

test('cancel settles promptly; a non-cooperative loader cannot publish afterwards', async () => {
  const runtime = new Runtime();
  const pending = deferred<string>();
  let signal!: AbortSignal;
  const resource = createAsyncResource<string, string>(runtime, {
    load: (_input, s) => {
      signal = s;
      return pending.promise;
    },
  });
  const run = resource.run('a');
  resource.cancel();
  assert.equal(signal.aborted, true);
  assert.deepEqual(resource.getSnapshot(), { status: 'cancelled', data: undefined, hasData: false });
  pending.resolve('late');
  assert.equal(await run, 'cancelled');
  assert.deepEqual(resource.getSnapshot(), { status: 'cancelled', data: undefined, hasData: false });
  resource.dispose();
  runtime.dispose();
});

test('old success and old rejection cannot override the latest request', async () => {
  const runtime = new Runtime();
  const old = deferred<string>();
  const next = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input) => (input === 'old' ? old.promise : next.promise),
  });
  const first = resource.run('old');
  const second = resource.run('new');
  next.resolve('new-value');
  assert.equal(await second, 'committed');
  old.resolve('stale-value');
  assert.equal(await first, 'superseded');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'new-value' });

  const slowFail = deferred<string>();
  const fastOk = deferred<string>();
  const mixed = createAsyncResource<string, string>(runtime, {
    load: (input) => (input === 'slow' ? slowFail.promise : fastOk.promise),
  });
  const slow = mixed.run('slow');
  slow.catch(() => {});
  const fast = mixed.run('fast');
  fastOk.resolve('fast-value');
  await fast;
  slowFail.reject(new Error('stale failure'));
  assert.equal(await slow, 'superseded');
  assert.deepEqual(mixed.getSnapshot(), { status: 'success', data: 'fast-value' });
  resource.dispose();
  mixed.dispose();
  runtime.dispose();
});

test('cancel with no active latest request is a no-op, even with a stale unsettled run', async () => {
  const runtime = new Runtime();
  const stale = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input) => (input === 'stale' ? stale.promise : Promise.resolve('fresh')),
  });
  const first = resource.run('stale');
  first.catch(() => {});
  const second = resource.run('fresh');
  assert.equal(await second, 'committed');
  resource.cancel();
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'fresh' });
  stale.resolve('too-late');
  assert.equal(await first, 'superseded');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'fresh' });
  resource.dispose();
  runtime.dispose();
});
test('a rejected boundary start preserves the existing request and snapshot', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  const pending = resource.run('a');
  pending.catch(() => {});
  const before = resource.getSnapshot();
  assert.throws(
    () =>
      runtime.transaction(() => {
        resource.run('illegal');
      }),
    (error: unknown) => error instanceof StateError,
  );
  assert.strictEqual(resource.getSnapshot(), before);
  gate.resolve('kept');
  await pending;
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'kept' });
  resource.dispose();
  runtime.dispose();
});

test('disposal is idempotent, freezes the snapshot and drops late settlement', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  const ready = resource.run('ready');
  ready.catch(() => {});
  gate.resolve('done');
  await ready;
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'done' });
  resource.dispose();
  resource.dispose();
  const frozen = resource.getSnapshot();
  assert.throws(() => resource.run('again'), /disposed/i);
  assert.throws(() => resource.retry(), /disposed/i);
  assert.throws(() => resource.cancel(), /disposed/i);
  assert.strictEqual(resource.getSnapshot(), frozen);

  const runtime2 = new Runtime();
  const late = deferred<string>();
  const inflight = createAsyncResource<string, string>(runtime2, { load: () => late.promise });
  const pending = inflight.run('x');
  pending.then(
    () => {},
    () => {},
  );
  inflight.dispose();
  late.resolve('too-late');
  assert.equal(await pending, 'cancelled');
  assert.equal(inflight.getSnapshot().status, 'loading');
  runtime.dispose();
  runtime2.dispose();
});

test('sibling notifications keep working; a committed observer failure rejects run distinctly', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const seen: string[] = [];
  const sibling = runtime.signal('');
  sibling.subscribe((value) => seen.push(value));
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => gate.promise,
  });
  const pending = resource.run('a');
  runtime.transaction(() => sibling.set('sibling-write'));
  gate.resolve('value');
  await pending;
  assert.deepEqual(seen, ['sibling-write']);
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'value' });

  const runtime2 = new Runtime();
  const gate2 = deferred<string>();
  const doomed = createAsyncResource<string, string>(runtime2, { load: () => gate2.promise });
  doomed.subscribe(() => {
    if (doomed.getSnapshot().status === 'success') throw new Error('observer blew up');
  });
  const failing = doomed.run('b');
  gate2.resolve('committed-anyway');
  await assert.rejects(failing, (error: unknown) => error instanceof NotificationError);
  assert.deepEqual(doomed.getSnapshot(), { status: 'success', data: 'committed-anyway' });
  resource.dispose();
  doomed.dispose();
  runtime.dispose();
  runtime2.dispose();
});

test('two resources share nothing; bounded lifecycle notifications are exact', async () => {
  const runtime = new Runtime();
  const left = createAsyncResource<string, string>(runtime, { load: (s) => `L${s}` });
  const right = createAsyncResource<string, string>(runtime, { load: (s) => `R${s}` });
  let leftCount = 0;
  let rightCount = 0;
  const unLeft = left.subscribe(() => leftCount++);
  const unRight = right.subscribe(() => rightCount++);
  for (let round = 0; round < 3; round++) {
    await left.run(`l${round}`);
    await right.run(`r${round}`);
  }
  assert.deepEqual(left.getSnapshot(), { status: 'success', data: 'Ll2' });
  assert.deepEqual(right.getSnapshot(), { status: 'success', data: 'Rr2' });
  assert.equal(leftCount, 6);
  assert.equal(rightCount, 6);
  unLeft();
  unRight();
  await left.run('l3');
  assert.equal(leftCount, 6);
  left.dispose();
  right.dispose();
  runtime.dispose();
});
