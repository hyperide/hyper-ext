import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationError, Runtime } from '../../runtime/src/index.js';
import { createAsyncResource } from './async-resource.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

// A lazy thenable runs its body on every .then subscription. The resource must
// assimilate the loader result exactly once: one extra side observation would
// run the body twice and could duplicate actual work.
test('a lazy success thenable is consumed exactly once', async () => {
  const runtime = new Runtime();
  let count = 0;
  const lazy = {
    // eslint-disable-next-line unicorn/no-thenable -- intentional lazy-thenable regression fixture: the body must run exactly once per assimilation.
    then(resolve: (value: string) => void, reject: (error: unknown) => void) {
      count++;
      return Promise.resolve('ok').then(resolve, reject);
    },
  };
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => lazy as unknown as PromiseLike<string>,
  });
  await resource.run('a');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'ok' });
  assert.equal(count, 1);
  resource.dispose();
  runtime.dispose();
});

test('a lazy failing thenable is consumed once with error identity preserved', async () => {
  const runtime = new Runtime();
  const failure = new Error('lazy boom');
  let count = 0;
  const lazy = {
    // eslint-disable-next-line unicorn/no-thenable -- intentional lazy-thenable regression fixture: the rejection must be consumed once with identity preserved.
    then(resolve: (value: string) => void, reject: (error: unknown) => void) {
      count++;
      return Promise.reject(failure).then(resolve, reject);
    },
  };
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => lazy as unknown as PromiseLike<string>,
  });
  await assert.rejects(resource.run('a'), (error: unknown) => error === failure);
  const snapshot = resource.getSnapshot();
  assert.equal(snapshot.status, 'error');
  assert.strictEqual(snapshot.error, failure);
  assert.equal(count, 1);
  resource.dispose();
  runtime.dispose();
});

// An obsolete late rejection must not publish and must not surface as an
// unhandled rejection, even when it carries the NotificationError class.
test('a late obsolete NotificationError neither publishes nor rejects unhandled', async () => {
  const runtime = new Runtime();
  const old = deferred<string>();
  const next = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input) => (input === 'old' ? old.promise : next.promise),
  });
  const first = resource.run('old');
  first.catch(() => {});
  const second = resource.run('new');
  next.resolve('new-value');
  assert.equal(await second, 'committed');
  old.reject(new NotificationError([new Error('obsolete side-effect notification')]));
  assert.equal(await first, 'superseded');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'new-value' });
  resource.dispose();
  runtime.dispose();
});
