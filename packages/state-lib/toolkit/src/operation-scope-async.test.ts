/**
 * @file Composition with unchanged latestTask and real Runtime (HYP-1507/HYP-1536).
 * Deferred writers model response order, not live AST/HMR or visible UI acceptance.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { latestTask, Runtime } from '../../runtime/src/index.js';
import { createOperationScope, type OperationLease } from './operation-scope.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function fixture() {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 32 });
  const confirmedDocument = runtime.signal('initial');
  const feedback: unknown[] = [];
  const writerOutcomes: unknown[] = [];
  const task = latestTask<{ lease: OperationLease; write: Promise<string> }, string, void>(
    runtime,
    async ({ lease, write }) => {
      try {
        const value = await write;
        writerOutcomes.push({ status: 'success', value });
        return value;
      } catch (error) {
        // A loader catch is outside latestTask's commit protection. Record the
        // external outcome independently; only the view's feedback is gated.
        writerOutcomes.push({ status: 'error', error });
        lease.notify(() => feedback.push(error));
        throw error;
      }
    },
    (value) => confirmedDocument.set(value),
  );
  return {
    runtime,
    scope,
    task,
    feedback,
    writerOutcomes,
    confirmedDocument,
    dispose() {
      task.dispose();
      scope.dispose();
      runtime.dispose();
    },
  };
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test('late failure after a newer write is suppressed for UI but retained in writer outcomes', async () => {
  const f = fixture();
  const oldWrite = deferred<string>();
  const newWrite = deferred<string>();
  const old = f.scope.begin('width');
  const first = f.task.run({ lease: old, write: oldWrite.promise }).finally(() => old.finish());
  const next = f.scope.begin('width');
  const second = f.task.run({ lease: next, write: newWrite.promise });
  assert.equal(await first, 'superseded');
  assert.equal(next.current, true);
  newWrite.resolve('140px');
  assert.equal(await second, 'committed');
  const failure = new Error('old write failed');
  oldWrite.reject(failure);
  await turn();
  assert.equal(f.confirmedDocument.get(), '140px');
  assert.deepEqual(f.feedback, []);
  assert.deepEqual(f.writerOutcomes, [
    { status: 'success', value: '140px' },
    { status: 'error', error: failure },
  ]);
  assert.ok(f.scope.diagnostics().trace.some((event) => event.kind === 'drop-notify' && event.reason === 'superseded'));
  f.dispose();
});

for (const transition of ['selection', 'unmount'] as const) {
  test(`late failure after ${transition} cannot emit stale UI feedback`, async () => {
    const f = fixture();
    const writer = deferred<string>();
    const operation = f.scope.begin('width');
    const pending = f.task.run({ lease: operation, write: writer.promise });
    const failure = new Error('actual external failure');
    const settled = assert.rejects(pending, (error) => error === failure);
    if (transition === 'selection') f.scope.advance();
    else f.scope.dispose();
    writer.reject(failure);
    await settled;
    assert.deepEqual(f.feedback, []);
    assert.deepEqual(f.writerOutcomes, [{ status: 'error', error: failure }]);
    assert.ok(
      f.scope
        .diagnostics()
        .trace.some(
          (event) =>
            event.kind === 'drop-notify' &&
            event.reason === (transition === 'selection' ? 'scope-changed' : 'scope-disposed'),
        ),
    );
    f.dispose();
  });
}

test('current external failure reaches both feedback and task caller exactly once', async () => {
  const f = fixture();
  const writer = deferred<string>();
  const operation = f.scope.begin('width');
  const pending = f.task.run({ lease: operation, write: writer.promise });
  const failure = new Error('current write failed');
  const settled = assert.rejects(pending, (error) => error === failure);
  writer.reject(failure);
  await settled;
  assert.deepEqual(f.feedback, [failure]);
  assert.deepEqual(f.writerOutcomes, [{ status: 'error', error: failure }]);
  assert.equal(f.scope.diagnostics().trace.filter((event) => event.kind === 'notify').length, 1);
  f.dispose();
});

test('ending UI authority does not pretend to cancel or roll back a document write', async () => {
  const f = fixture();
  const writer = deferred<string>();
  const operation = f.scope.begin('width');
  const pending = f.task.run({ lease: operation, write: writer.promise });
  f.scope.dispose();
  writer.resolve('130px');
  assert.equal(await pending, 'committed');
  assert.equal(f.confirmedDocument.get(), '130px');
  assert.deepEqual(f.writerOutcomes, [{ status: 'success', value: '130px' }]);
  assert.deepEqual(
    operation.notify(() => f.feedback.push('old view success')),
    { status: 'dropped', reason: 'scope-disposed' },
  );
  assert.deepEqual(f.feedback, []);
  f.dispose();
});

test('latestTask cancellation settles promptly even when the writer ignores AbortSignal', async () => {
  const f = fixture();
  const writer = deferred<string>();
  const operation = f.scope.begin('width');
  const pending = f.task.run({ lease: operation, write: writer.promise });
  operation.cancel();
  f.task.cancel();
  assert.equal(await pending, 'cancelled');
  writer.resolve('late external write still happened');
  await turn();
  assert.equal(f.confirmedDocument.get(), 'initial');
  assert.deepEqual(f.writerOutcomes, [{ status: 'success', value: 'late external write still happened' }]);
  assert.deepEqual(f.feedback, []);
  f.dispose();
});

test('queued continuation loses feedback authority when context changes after commit', async () => {
  const f = fixture();
  const operation = f.scope.begin('width');
  await f.task.run({ lease: operation, write: Promise.resolve('130px') });
  const oldContinuation = Promise.resolve().then(() => operation.notify(() => f.feedback.push('stale saved banner')));
  f.scope.advance();
  const next = f.scope.begin('width');
  assert.deepEqual(await oldContinuation, { status: 'dropped', reason: 'scope-changed' });
  operation.finish();
  assert.equal(next.current, true);
  assert.deepEqual(f.feedback, []);
  f.dispose();
});
