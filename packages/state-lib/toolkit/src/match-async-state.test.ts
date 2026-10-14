import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from '../../runtime/src/index.js';
import { createAsyncResource } from './async-resource.js';
import { matchAsyncState } from './match-async-state.js';

test('every status dispatches to its narrowed handler with a generic return', async () => {
  const runtime = new Runtime();
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input) => Promise.resolve(input),
    isEmpty: (value) => value === '',
  });
  const render = () =>
    matchAsyncState(resource.getSnapshot(), {
      idle: () => 'is-idle',
      loading: (s) => `is-loading:${String(s.data)}`,
      success: (s) => `is-success:${s.data}`,
      empty: () => 'is-empty',
      error: (s) => `is-error:${String(s.error)}`,
      cancelled: () => 'is-cancelled',
    });
  assert.equal(render(), 'is-idle');
  const pending = resource.run('');
  assert.equal(render(), 'is-loading:undefined');
  await pending;
  assert.equal(render(), 'is-empty');
  resource.dispose();
  runtime.dispose();
});

test('incomplete handlers fail loudly, even for a state that is not current', () => {
  const runtime = new Runtime();
  const resource = createAsyncResource<string, string>(runtime, { load: (s) => s });
  const snapshot = resource.getSnapshot();
  assert.equal(snapshot.status, 'idle');
  assert.throws(
    () =>
      matchAsyncState(snapshot, {
        idle: () => 1,
        loading: () => 1,
        success: () => 1,
        empty: () => 1,
        // @ts-expect-error testing the JS runtime guard for a missing case.
        error: undefined,
        cancelled: () => 1,
      }),
    /missing handler for "error"/,
  );
  resource.dispose();
  runtime.dispose();
});

test('matching starts no work and observes the frozen snapshot', async () => {
  const runtime = new Runtime();
  let loads = 0;
  const resource = createAsyncResource<string, string>(runtime, {
    load: (input) => {
      loads++;
      return input;
    },
  });
  await resource.run('v');
  const seen: string[] = [];
  const snapshot = resource.getSnapshot();
  for (let i = 0; i < 3; i++) {
    seen.push(
      matchAsyncState(snapshot, {
        idle: () => 'idle',
        loading: () => 'loading',
        success: (s) => s.data,
        empty: (s) => s.data,
        error: () => 'error',
        cancelled: () => 'cancelled',
      }),
    );
  }
  assert.deepEqual(seen, ['v', 'v', 'v']);
  assert.equal(loads, 1);
  resource.dispose();
  runtime.dispose();
});
