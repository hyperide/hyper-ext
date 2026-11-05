/** @file Real Runtime regressions for operation publication authority and diagnostic bounds. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotificationError, Runtime, StateError } from '../../runtime/src/index.js';
import { createOperationScope } from './operation-scope.js';

const stateError = (code: string) => (error: unknown) => error instanceof StateError && error.code === code;

test('current commit publishes related fields in one real Runtime transaction', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const width = runtime.signal(120);
  const status = runtime.signal('idle');
  const snapshots: unknown[] = [];
  const stop = runtime.watch(
    () => [width.get(), status.get()],
    (value) => snapshots.push(value),
  );
  const operation = scope.begin('width');
  const result = operation.commit(() => {
    width.set(130);
    status.set('saved');
    return 130;
  });
  assert.deepEqual(result, { status: 'applied', value: 130 });
  assert.deepEqual(snapshots, [[130, 'saved']]);
  assert.equal(runtime.version, 1);
  stop();
  scope.dispose();
  runtime.dispose();
});

test('a newer operation rejects old state writes and old error feedback', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 16 });
  const width = runtime.signal(120);
  const errors: string[] = [];
  const old = scope.begin('width');
  const next = scope.begin('width');
  next.commit(() => width.set(140));
  assert.deepEqual(
    old.commit(() => width.set(130)),
    { status: 'dropped', reason: 'superseded' },
  );
  assert.deepEqual(
    old.notify(() => errors.push('old error')),
    { status: 'dropped', reason: 'superseded' },
  );
  assert.equal(width.get(), 140);
  assert.deepEqual(errors, []);
  assert.equal(next.current, true);
  assert.deepEqual(
    scope
      .diagnostics()
      .trace.slice(-2)
      .map((event) => event.kind),
    ['drop-commit', 'drop-notify'],
  );
  scope.dispose();
  runtime.dispose();
});

test('A to B to A never restores the first A generation', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const firstA = scope.begin('element-A');
  scope.advance();
  scope.begin('element-B');
  scope.advance();
  const secondA = scope.begin('element-A');
  let calls = 0;
  assert.deepEqual(
    firstA.notify(() => calls++),
    { status: 'dropped', reason: 'scope-changed' },
  );
  assert.equal(secondA.generation, firstA.generation + 2);
  secondA.notify(() => calls++);
  assert.equal(calls, 1);
  scope.dispose();
  runtime.dispose();
});

test('disposing a view prevents late feedback without touching a new scope on the same Runtime', () => {
  const runtime = new Runtime();
  const oldScope = createOperationScope(runtime);
  const operation = oldScope.begin('width');
  oldScope.dispose();
  oldScope.dispose();
  const newScope = createOperationScope(runtime);
  const next = newScope.begin('width');
  assert.deepEqual(
    operation.notify(() => assert.fail('old feedback ran')),
    { status: 'dropped', reason: 'scope-disposed' },
  );
  assert.equal(next.current, true);
  assert.throws(() => oldScope.begin('width'), /disposed/i);
  newScope.dispose();
  runtime.dispose();
});

test('independent lanes and symbols do not supersede one another', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const width = scope.begin('width');
  const color = scope.begin('__proto__');
  const one = scope.begin(Symbol('same'));
  const two = scope.begin(Symbol('same'));
  scope.begin('width');
  assert.equal(width.current, false);
  for (const operation of [color, one, two]) assert.equal(operation.current, true);
  assert.equal(scope.diagnostics().activeOperations, 4);
  scope.dispose();
  runtime.dispose();
});

test('delayed finish or cancel never releases the replacement operation', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const old = scope.begin('width');
  const next = scope.begin('width');
  old.finish();
  old.cancel();
  assert.equal(scope.diagnostics().activeOperations, 1);
  assert.equal(next.current, true);
  next.finish();
  next.finish();
  next.cancel();
  assert.equal(scope.diagnostics().activeOperations, 0);
  assert.deepEqual(
    next.notify(() => assert.fail('finished callback ran')),
    { status: 'dropped', reason: 'finished' },
  );
  scope.dispose();
  runtime.dispose();
});

test('a current failure stays visible and a throwing feedback handler is not swallowed', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 8 });
  const operation = scope.begin('width');
  const errors: string[] = [];
  operation.notify(() => errors.push('real current failure'));
  const failure = new Error('feedback failed');
  assert.throws(
    () =>
      operation.notify(() => {
        throw failure;
      }),
    (error) => error === failure,
  );
  assert.deepEqual(errors, ['real current failure']);
  assert.equal(scope.diagnostics().trace.at(-1)?.kind, 'notify-failed');
  scope.dispose();
  runtime.dispose();
});

test('cancellation records its reason and releases its own lane', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  operation.cancel();
  operation.cancel();
  assert.equal(operation.current, false);
  assert.equal(scope.diagnostics().activeOperations, 0);
  assert.deepEqual(
    operation.commit(() => assert.fail('cancelled callback ran')),
    { status: 'dropped', reason: 'cancelled' },
  );
  scope.dispose();
  runtime.dispose();
});

for (const capacity of [-1, 0.5, Number.NaN, Number.POSITIVE_INFINITY, 4097, null]) {
  test(`rejects invalid trace capacity ${capacity} rather than retaining unbounded history`, () => {
    const runtime = new Runtime();
    assert.throws(
      () => Reflect.apply(createOperationScope, undefined, [runtime, { traceCapacity: capacity }]),
      RangeError,
    );
    runtime.dispose();
  });
}

test('invalid JavaScript lane does not supersede an active operation', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const active = scope.begin('width');
  assert.throws(() => Reflect.apply(scope.begin, undefined, [42]), TypeError);
  assert.equal(active.current, true);
  assert.equal(scope.diagnostics().activeOperations, 1);
  scope.dispose();
  runtime.dispose();
});

test('trace is bounded, ordered, immutable and excludes keys, values and error text', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 4 });
  const secret = 'PRIVATE-FIELD-CONTENT';
  for (let i = 0; i < 100; i++) scope.begin(`${secret}-${i}`).finish();
  const before = scope.diagnostics();
  assert.equal(before.activeOperations, 0);
  assert.equal(before.trace.length, 4);
  assert.equal(before.droppedEvents, 196);
  assert.deepEqual(
    before.trace.map((event) => event.sequence),
    [197, 198, 199, 200],
  );
  assert.equal(JSON.stringify(before).includes(secret), false);
  assert.equal(Object.isFrozen(before), true);
  assert.equal(Object.isFrozen(before.trace), true);
  for (const entry of before.trace) assert.equal(Object.isFrozen(entry), true);
  const operation = scope.begin(secret);
  assert.throws(
    () =>
      operation.notify(() => {
        throw new Error(secret);
      }),
    new RegExp(secret),
  );
  assert.equal(JSON.stringify(scope.diagnostics()).includes(secret), false);
  assert.deepEqual(
    before.trace.map((event) => event.sequence),
    [197, 198, 199, 200],
  );
  scope.dispose();
  runtime.dispose();
});

test('default trace is disabled and a long-lived scope retains only live slots', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  for (let i = 0; i < 10_000; i++) scope.begin(`lane-${i}`).finish();
  assert.equal(scope.diagnostics().activeOperations, 0);
  assert.equal(scope.diagnostics().droppedEvents, 0);
  assert.deepEqual(scope.diagnostics().trace, []);
  scope.dispose();
  runtime.dispose();
});

test('transaction boundary refusal preserves authority and diagnostics', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 16 });
  const operation = scope.begin('width');
  const before = scope.diagnostics();
  for (const action of [
    () => scope.begin('width'),
    () => scope.advance(),
    () => scope.dispose(),
    () => operation.finish(),
    () => operation.cancel(),
  ]) {
    assert.throws(() => runtime.transaction(action), stateError('STATE_OPERATION_BOUNDARY'));
    assert.deepEqual(scope.diagnostics(), before);
    assert.equal(operation.current, true);
  }
  scope.dispose();
  runtime.dispose();
});

test('pure derivations cannot revoke authority or append dropped feedback to trace', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 16 });
  const old = scope.begin('width');
  const current = scope.begin('width');
  const before = scope.diagnostics();
  for (const action of [() => scope.advance(), () => current.notify(() => 'current')]) {
    const derived = runtime.derive(action);
    assert.throws(() => derived.get(), stateError('STATE_IMPURE_DERIVE'));
    assert.deepEqual(scope.diagnostics(), before);
    derived.dispose();
  }
  const staleRead = runtime.derive(() => old.notify(() => 'must not run'));
  assert.deepEqual(staleRead.get(), { status: 'dropped', reason: 'superseded' });
  assert.deepEqual(scope.diagnostics(), before, 'read-only drop adds no trace in a pure phase');
  staleRead.dispose();
  scope.dispose();
  runtime.dispose();
});

test('runtime notification cannot mutate operation ownership after publication', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 16 });
  const operation = scope.begin('width');
  const value = runtime.signal(0);
  const before = scope.diagnostics();
  const stop = value.subscribe(() => scope.advance());
  assert.throws(
    () => value.set(1),
    (error) => error instanceof NotificationError,
  );
  assert.equal(value.get(), 1);
  assert.equal(operation.current, true);
  assert.deepEqual(scope.diagnostics(), before);
  stop();
  scope.dispose();
  runtime.dispose();
});

test('trace distinguishes domain NotificationError before commit from observer failure after publication', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 16 });
  const operation = scope.begin('width');
  const value = runtime.signal(0);
  const domainError = new NotificationError([new Error('domain error before publish')]);
  assert.throws(
    () =>
      operation.commit(() => {
        value.set(1);
        throw domainError;
      }),
    (error) => error === domainError,
  );
  assert.equal(value.get(), 0);
  assert.equal(scope.diagnostics().trace.at(-1)?.published, false);
  const stop = value.subscribe(() => {
    throw new Error('observer after publication');
  });
  assert.throws(
    () => operation.commit(() => value.set(2)),
    (error) => error instanceof NotificationError,
  );
  assert.equal(value.get(), 2);
  assert.equal(scope.diagnostics().trace.at(-1)?.published, true);
  stop();
  scope.dispose();
  runtime.dispose();
});

test('authority change attempted inside commit rolls back the state write', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  const value = runtime.signal(0);
  assert.throws(
    () =>
      operation.commit(() => {
        value.set(1);
        scope.advance();
      }),
    stateError('STATE_OPERATION_BOUNDARY'),
  );
  assert.equal(value.get(), 0);
  assert.equal(operation.current, true);
  scope.dispose();
  runtime.dispose();
});

test('notify rechecks authority independently of a prior successful commit', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  operation.commit(() => 42);
  scope.advance();
  assert.deepEqual(
    operation.notify(() => assert.fail('old feedback invoked')),
    { status: 'dropped', reason: 'scope-changed' },
  );
  scope.dispose();
  runtime.dispose();
});

test('reentrant feedback can replace itself without old finish clearing the replacement', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  operation.notify(() => {
    scope.advance();
    scope.begin('width');
  });
  operation.finish();
  assert.equal(scope.diagnostics().activeOperations, 1);
  assert.equal(scope.diagnostics().generation, 1);
  scope.dispose();
  runtime.dispose();
});

test('async JavaScript commit is rejected and synchronous writes are rolled back', async () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  const value = runtime.signal(0);
  assert.throws(
    () =>
      Reflect.apply(operation.commit, undefined, [
        () => {
          value.set(1);
          return Promise.resolve();
        },
      ]),
    stateError('STATE_ASYNC_TRANSACTION'),
  );
  await Promise.resolve();
  assert.equal(value.get(), 0);
  scope.dispose();
  runtime.dispose();
});

test('async JavaScript feedback fails loudly and drains its returned rejection', async () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 8 });
  const operation = scope.begin('width');
  assert.throws(
    () => Reflect.apply(operation.notify, undefined, [() => Promise.reject(new Error('async feedback'))]),
    stateError('STATE_ASYNC_FEEDBACK'),
  );
  await Promise.resolve();
  assert.equal(scope.diagnostics().trace.at(-1)?.kind, 'notify-failed');
  scope.dispose();
  runtime.dispose();
});

test('a prematurely disposed Runtime refuses publication before calling user code', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  runtime.dispose();
  assert.throws(
    () => operation.notify(() => assert.fail('callback ran after Runtime disposal')),
    stateError('STATE_DISPOSED'),
  );
});

test('throw undefined remains a real feedback failure with a diagnostic event', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 4 });
  const operation = scope.begin('width');
  let caught = false;
  try {
    operation.notify(() => {
      throw undefined;
    });
  } catch (error) {
    caught = true;
    assert.equal(error, undefined);
  }
  assert.equal(caught, true);
  assert.equal(scope.diagnostics().trace.at(-1)?.kind, 'notify-failed');
  scope.dispose();
  runtime.dispose();
});

test('late callbacks after ordered scope and Runtime teardown drop without manufacturing errors', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 8 });
  const operation = scope.begin('width');
  scope.dispose();
  const before = scope.diagnostics();
  runtime.dispose();
  assert.deepEqual(
    operation.notify(() => assert.fail('closed owner feedback ran')),
    { status: 'dropped', reason: 'scope-disposed' },
  );
  assert.deepEqual(
    operation.commit(() => assert.fail('closed owner commit ran')),
    { status: 'dropped', reason: 'scope-disposed' },
  );
  assert.deepEqual(scope.diagnostics(), before);
});

test('async feedback reads a lazy then getter once and preserves its receiver while draining failure', async () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const lease = scope.begin('width');
  let reads = 0;
  let calls = 0;
  let receiver: unknown;
  const thenable = {
    get then() {
      reads++;
      return function (this: unknown, _resolve: (value: unknown) => void, reject: (error: unknown) => void) {
        receiver = this;
        calls++;
        reject(new Error('rejected lazy feedback'));
      };
    },
  };
  assert.throws(
    () => lease.notify(() => thenable as never),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_ASYNC_FEEDBACK',
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(reads, 1, 'a getter is part of the effect and must not be read twice');
  assert.equal(calls, 1);
  assert.strictEqual(receiver, thenable);
  scope.dispose();
  runtime.dispose();
});

test('bound feedback preserves arguments and gates each invocation, not the binding moment', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 8 });
  const old = scope.begin('width');
  assert.equal(typeof old.bind, 'function', 'feedback binding is provided by the library');
  const seen: string[] = [];
  const report = old.bind((value: number, unit: string) => {
    seen.push(`${value}${unit}`);
    return value + 1;
  });
  assert.deepEqual(report(130, 'px'), { status: 'applied', value: 131 });
  const next = scope.begin('width');
  assert.deepEqual(report(140, 'px'), { status: 'dropped', reason: 'superseded' });
  assert.deepEqual(seen, ['130px']);
  assert.equal(next.current, true);
  scope.dispose();
  runtime.dispose();
});

test('bound current feedback keeps error identity and never reports a stale error', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const operation = scope.begin('width');
  assert.equal(typeof operation.bind, 'function');
  const failure = new Error('current feedback failed');
  const report = operation.bind(() => {
    throw failure;
  });
  assert.throws(report, (error) => error === failure);
  scope.advance();
  assert.deepEqual(report(), { status: 'dropped', reason: 'scope-changed' });
  scope.dispose();
  runtime.dispose();
});

test('disposed late feedback inside a Runtime subscriber is a read-only drop, not a publication failure', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 8 });
  const lease = scope.begin('width');
  scope.dispose();
  const before = scope.diagnostics();
  const source = runtime.signal(0);
  let result: unknown;
  let invoked = false;
  const unsubscribe = source.subscribe(() => {
    result = lease.notify(() => {
      invoked = true;
    });
  });
  assert.doesNotThrow(() => source.set(1));
  assert.deepEqual(result, { status: 'dropped', reason: 'scope-disposed' });
  assert.equal(invoked, false);
  assert.deepEqual(scope.diagnostics(), before, 'a forbidden phase cannot append trace');
  unsubscribe();
  runtime.dispose();
});

test('a rejecting async commit is drained by the existing Runtime and never publishes', async () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime);
  const lease = scope.begin('width');
  const value = runtime.signal(0);
  assert.throws(
    () =>
      lease.commit(() => {
        value.set(1);
        return Promise.reject(new Error('invalid async commit')) as never;
      }),
    (error: unknown) => error instanceof StateError && error.code === 'STATE_ASYNC_TRANSACTION',
  );
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(value.peek(), 0);
  scope.dispose();
  runtime.dispose();
});

test('explicit zero trace capacity is the same opt-out as omission', () => {
  const runtime = new Runtime();
  const scope = createOperationScope(runtime, { traceCapacity: 0 });
  scope.begin('width').finish();
  assert.deepEqual(scope.diagnostics().trace, []);
  assert.equal(scope.diagnostics().droppedEvents, 0);
  scope.dispose();
  runtime.dispose();
});
