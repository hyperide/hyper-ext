import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NotificationError, Runtime, StateError } from '../../runtime/src/index.js';
import { createAsyncResource } from './async-resource.js';
import { matchAsyncState } from './match-async-state.js';

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

// Finding 1: a rejected start inside an outer transaction must not commit
// loading state or change the remembered input and active job.
test('a boundary-rejected run caught inside an outer transaction changes nothing', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  const pending = resource.run('a');
  pending.catch(() => {});
  const before = resource.getSnapshot();
  assert.equal(resource.lastInput, 'a');
  let code: string | undefined;
  runtime.transaction(() => {
    try {
      resource.run('must-not-start');
    } catch (error) {
      code = (error as StateError).code;
    }
  });
  assert.equal(code, 'STATE_TASK_BOUNDARY');
  assert.strictEqual(resource.getSnapshot(), before);
  assert.equal(resource.lastInput, 'a');
  gate.resolve('kept');
  assert.equal(await pending, 'committed');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'kept' });
  resource.dispose();
  runtime.dispose();
});

// Finding 2a: an abort listener that synchronously starts a replacement run
// must win over the cancelling caller's unconditional cancelled publication.
test('cancel during an abort-driven replacement keeps the replacement loading', async () => {
  const runtime = new Runtime();
  const replacementGate = deferred<string>();
  let replacement: Promise<string> | undefined;
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input, signal) => {
      if (input === 'old') {
        signal.addEventListener('abort', () => {
          replacement = resource.run('replacement');
          replacement.catch(() => {});
        });
        return new Promise<string>(() => {});
      }
      return replacementGate.promise;
    },
  });
  const first = resource.run('old');
  first.catch(() => {});
  resource.cancel();
  assert.ok(replacement !== undefined, 'the abort listener must have started a replacement');
  assert.equal(resource.getSnapshot().status, 'loading');
  assert.equal(resource.lastInput, 'replacement');
  assert.equal(await first, 'cancelled');
  replacementGate.resolve('new-value');
  assert.equal(await replacement, 'committed');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'new-value' });
  resource.dispose();
  runtime.dispose();
});

// Finding 2b: the same reentrancy with a failing replacement must surface the
// loader error, not a cancelled snapshot.
test('cancel during an abort-driven failing replacement keeps the loader error', async () => {
  const runtime = new Runtime();
  const failure = new Error('replacement failed');
  let replacement: Promise<string> | undefined;
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input, signal) => {
      if (input === 'old') {
        signal.addEventListener('abort', () => {
          replacement = resource.run('replacement');
          replacement.catch(() => {});
        });
        return new Promise<string>(() => {});
      }
      return Promise.reject(failure);
    },
  });
  const first = resource.run('old');
  first.catch(() => {});
  resource.cancel();
  assert.ok(replacement !== undefined, 'the abort listener must have started a replacement');
  assert.equal(resource.getSnapshot().status, 'loading');
  await assert.rejects(replacement, (error: unknown) => error === failure);
  assert.equal(resource.getSnapshot().status, 'error');
  assert.equal(await first, 'cancelled');
  resource.dispose();
  runtime.dispose();
});

// Finding 2c: cancelling after a success publication but before the promise
// .then cleanup must not relabel the committed success as cancelled. The
// wake-up is event-based (a success subscriber resolves a deferred), not a
// hardcoded microtask count, so loader-side scheduling changes cannot move
// the cancel past the run-result settlement.
test('cancel after a committed success is a claim release, not a relabel', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  const committedSignal = deferred<void>();
  const unsubscribe = resource.subscribe(() => {
    if (resource.getSnapshot().status === 'success') committedSignal.resolve();
  });
  const pending = resource.run('a');
  pending.catch(() => {});
  let settled: string | undefined;
  void pending.then((outcome) => {
    settled = outcome;
  });
  gate.resolve('v');
  await committedSignal.promise;
  assert.equal(resource.getSnapshot().status, 'success');
  assert.equal(settled, undefined);
  resource.cancel();
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'v' });
  assert.equal(await pending, 'committed');
  unsubscribe();
  resource.dispose();
  runtime.dispose();
});

// Finding 3a: dispose inside a real subscriber must be refused before any
// authority or subscription loss.
test('dispose inside a subscriber is refused without losing authority', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  let calls = 0;
  let disposeThrew = false;
  const unsubscribe = resource.subscribe(() => {
    calls++;
    if (calls === 1) {
      try {
        resource.dispose();
      } catch {
        disposeThrew = true;
      }
    }
  });
  const pending = resource.run('a');
  pending.catch(() => {});
  assert.equal(disposeThrew, true);
  gate.resolve('v');
  assert.equal(await pending, 'committed');
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'v' });
  assert.equal(calls, 2);
  await resource.run('b');
  assert.equal(resource.getSnapshot().status, 'success');
  unsubscribe();
  resource.dispose();
  runtime.dispose();
});

// Finding 3b: a loader-owned abort callback reentering run during disposal is
// refused; disposal succeeds, freezes the snapshot and is repeatable.
test('an abort callback reentering run during disposal is refused', async () => {
  const runtime = new Runtime();
  let reentryCode: string | undefined;
  const resource = createAsyncResource<string, string>(runtime, {
    load: (_input, signal) => {
      signal.addEventListener('abort', () => {
        try {
          void resource.run('reentry');
        } catch (error) {
          reentryCode = (error as StateError).code;
        }
      });
      return new Promise<string>(() => {});
    },
  });
  const pending = resource.run('x');
  pending.then(
    () => {},
    () => {},
  );
  assert.equal(resource.lastInput, 'x');
  resource.dispose();
  assert.equal(reentryCode, 'STATE_TASK_DISPOSED');
  assert.equal(resource.lastInput, 'x');
  assert.equal(resource.getSnapshot().status, 'loading');
  resource.dispose();
  assert.throws(() => resource.run('y'), /disposed/i);
  assert.equal(await pending, 'cancelled');
  runtime.dispose();
});

// Finding 4: a throwing loading subscriber keeps committed NotificationError
// semantics, but the request must still start instead of hanging as orphan loading.
test('a throwing loading subscriber still starts the request', async () => {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  resource.subscribe(() => {
    if (resource.getSnapshot().status === 'loading') throw new Error('loading observer blew up');
  });
  let thrown: unknown;
  try {
    resource.run('a');
  } catch (error) {
    thrown = error;
  }
  assert.equal(thrown instanceof NotificationError, true);
  assert.equal(resource.getSnapshot().status, 'loading');
  gate.resolve('late-value');
  for (let i = 0; i < 100 && resource.getSnapshot().status === 'loading'; i++) {
    await Promise.resolve();
  }
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: 'late-value' });
  resource.dispose();
  runtime.dispose();
});

// Finding 5: undefined is a valid result; refresh after undefined carries
// explicit prior-data metadata instead of reusing data === undefined.
test('refresh after an undefined success is marked with prior-data metadata', async () => {
  const runtime = new Runtime();
  const firstGate = deferred<undefined>();
  const secondGate = deferred<undefined>();
  let calls = 0;
  const resource = createAsyncResource<string, undefined>(runtime, {
    load: () => (calls++ === 0 ? firstGate.promise : secondGate.promise),
  });
  const first = resource.run('one');
  assert.deepEqual(resource.getSnapshot(), { status: 'loading', data: undefined, hasData: false });
  firstGate.resolve(undefined);
  await first;
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: undefined });
  const second = resource.run('two');
  assert.deepEqual(resource.getSnapshot(), { status: 'loading', data: undefined, hasData: true });
  secondGate.resolve(undefined);
  await second;
  assert.deepEqual(resource.getSnapshot(), { status: 'success', data: undefined });
  resource.dispose();
  runtime.dispose();
});

// Finding 5 controls: falsy results succeed and frozen records stay shallow.
test('falsy results succeed and state records freeze shallowly only', async () => {
  const runtime = new Runtime();
  for (const value of [0, false, null] as const) {
    const resource = createAsyncResource<string, typeof value>(runtime, { load: () => value });
    await resource.run('v');
    assert.equal(resource.getSnapshot().status, 'success');
    const snap = resource.getSnapshot();
    assert.ok(snap.status === 'success', `expected success, received ${snap.status}`);
    assert.strictEqual(snap.data, value);
    resource.dispose();
  }
  const payload = { count: 1 };
  const objects = createAsyncResource<string, { count: number }>(runtime, { load: () => payload });
  await objects.run('v');
  assert.equal(Object.isFrozen(objects.getSnapshot()), true);
  const settled = objects.getSnapshot();
  assert.ok(settled.status === 'success', `expected success, received ${settled.status}`);
  assert.equal(Object.isFrozen(settled.data), false);
  payload.count = 2;
  assert.equal(settled.data.count, 2);
  objects.dispose();
  runtime.dispose();
});

// Error origin: a NotificationError thrown BY THE LOADER is a loader
// rejection, not a committed publication. Same identity is preserved outward,
// but the snapshot must settle to error — exactly like an ordinary Error.
test('a loader NotificationError settles to error with the original identity', async () => {
  for (const mode of ['sync-throw', 'async-reject'] as const) {
    const failures: Array<{ failure: unknown; name: string }> = [
      { failure: new Error('loader plain failure'), name: 'ordinary-error' },
      {
        failure: new NotificationError([new Error('loader side-effect notification')]),
        name: 'loader-notification',
      },
    ];
    for (const { failure } of failures) {
      const runtime = new Runtime();
      const resource = createAsyncResource<string, string>(runtime, {
        load: () => {
          if (mode === 'sync-throw') throw failure;
          return Promise.reject(failure);
        },
      });
      await assert.rejects(resource.run('request'), (error: unknown) => error === failure);
      const snapshot = resource.getSnapshot();
      assert.equal(snapshot.status, 'error');
      assert.strictEqual(snapshot.error, failure);
      assert.equal(snapshot.hasData, false);
      resource.dispose();
      runtime.dispose();
    }
  }
});

// Error origin: isEmpty throwing the same class before any success
// publication is a domain failure, not a committed notification.
test('an isEmpty NotificationError before publication settles to error', async () => {
  const failure = new NotificationError([new Error('domain empty-check notification')]);
  const runtime = new Runtime();
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input) => input,
    isEmpty: () => {
      throw failure;
    },
  });
  await assert.rejects(resource.run('request'), (error: unknown) => error === failure);
  const snapshot = resource.getSnapshot();
  assert.equal(snapshot.status, 'error');
  assert.strictEqual(snapshot.error, failure);
  assert.equal(snapshot.hasData, false);
  resource.dispose();
  runtime.dispose();
});

// Finding 6 runtime controls: loader rejections keep their identity and the
// exhaustive dispatcher rejects unknown statuses loudly.
test('loader errors keep identity and unknown statuses fail loudly', async () => {
  const runtime = new Runtime();
  const boom = new TypeError('boom');
  const resource = createAsyncResource<string, string>(runtime, {
    load: () => Promise.reject(boom),
  });
  await assert.rejects(resource.run('x'), (error: unknown) => error === boom);
  assert.equal(resource.getSnapshot().status, 'error');
  const complete = {
    idle: () => 'idle',
    loading: () => 'loading',
    success: () => 'success',
    empty: () => 'empty',
    error: () => 'error',
    cancelled: () => 'cancelled',
  };
  assert.throws(
    () => matchAsyncState({ status: 'bogus' } as never, complete),
    (error: unknown) => error instanceof StateError,
  );
  resource.dispose();
  runtime.dispose();
});
