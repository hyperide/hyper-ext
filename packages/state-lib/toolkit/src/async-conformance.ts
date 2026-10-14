import { NotificationError, Runtime } from '../../runtime/src/index.js';
import type { AsyncResourceOptions } from './async-resource.js';
import { createAsyncResource } from './async-resource.js';
import { matchAsyncState } from './match-async-state.js';

/** Minimal assertion surface so the scenarios run under node:test, bun test,
 * or a future browser harness without importing node:assert in this module. */
export interface ConformanceAssert {
  equal(actual: unknown, expected: unknown, message?: string): void;
  ok(value: unknown, message?: string): void;
  throws(fn: () => unknown, expected?: RegExp, message?: string): void;
  rejects(prone: Promise<unknown>, expected?: RegExp, message?: string): Promise<void>;
}

export type ConformanceFactory = <Input, Result>(
  runtime: Runtime,
  options: AsyncResourceOptions<Input, Result>,
) => {
  getSnapshot(): { status: string; data?: unknown; error?: unknown };
  subscribe(listener: () => void): () => void;
  run(input: Input): Promise<unknown>;
  retry(): Promise<unknown>;
  cancel(): void;
  dispose(): void;
};

export interface ConformanceScenario {
  id: string;
  title: string;
  requirement: string;
}

export const CONFORMANCE_SCENARIOS: ConformanceScenario[] = [
  { id: 'AR-01', title: 'idle -> loading -> success', requirement: 'R71' },
  { id: 'AR-02', title: 'falsy results succeed', requirement: 'R71' },
  { id: 'AR-03', title: 'empty is explicit via isEmpty', requirement: 'R71' },
  { id: 'AR-04', title: 'failure -> retry -> success', requirement: 'R71' },
  { id: 'AR-05', title: 'refresh retains prior data', requirement: 'R71' },
  { id: 'AR-06', title: 'cancel settles promptly', requirement: 'R72' },
  { id: 'AR-07', title: 'stale settlement is dropped', requirement: 'R72' },
  { id: 'AR-08', title: 'boundary rejection preserves authority', requirement: 'spec §4.15.1' },
  { id: 'AR-09', title: 'dispose freezes without late publication', requirement: 'R15' },
  { id: 'AR-10', title: 'instances are isolated', requirement: 'R15' },
];

const deferred = <T>() => {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

/** Shared invariant scenarios. Future renderer and source adapters reuse these
 * by supplying their own factory over the same headless contract; this pilot
 * runs them against createAsyncResource directly. */
export async function runConformanceScenario(
  id: string,
  create: ConformanceFactory,
  runtime: Runtime,
  check: ConformanceAssert,
): Promise<void> {
  const make = <Input, Result>(options: AsyncResourceOptions<Input, Result>) => create<Input, Result>(runtime, options);
  switch (id) {
    case 'AR-01': {
      const gate = deferred<string>();
      const resource = make({ load: () => gate.promise });
      check.equal(resource.getSnapshot().status, 'idle');
      const pending = resource.run('a');
      check.equal(resource.getSnapshot().status, 'loading');
      gate.resolve('ok');
      await pending;
      check.equal(resource.getSnapshot().status, 'success');
      resource.dispose();
      return;
    }
    case 'AR-02': {
      const resource = make<number, number>({ load: (n) => n });
      await resource.run(0);
      check.equal(resource.getSnapshot().status, 'success');
      check.equal(resource.getSnapshot().data, 0);
      resource.dispose();
      return;
    }
    case 'AR-03': {
      const resource = make<string, string>({ load: (s) => s, isEmpty: (v) => v === '' });
      await resource.run('');
      check.equal(resource.getSnapshot().status, 'empty');
      await resource.run('x');
      check.equal(resource.getSnapshot().status, 'success');
      resource.dispose();
      return;
    }
    case 'AR-04': {
      let attempts = 0;
      const resource = make<string, string>({
        load: () => (attempts++ === 0 ? Promise.reject(new Error('bad')) : Promise.resolve('good')),
      });
      await check.rejects(resource.run('same-input'), /bad/);
      check.equal(resource.getSnapshot().status, 'error');
      await resource.retry();
      check.equal(resource.getSnapshot().status, 'success');
      resource.dispose();
      return;
    }
    case 'AR-05': {
      const first = deferred<string>();
      const second = deferred<string>();
      let calls = 0;
      const gates = [first, second];
      const resource = make<string, string>({ load: () => gates[calls++ % gates.length]!.promise });
      const one = resource.run('one');
      first.resolve('first');
      await one;
      const two = resource.run('two');
      check.equal(resource.getSnapshot().status, 'loading');
      check.equal(resource.getSnapshot().data, 'first');
      second.resolve('second');
      await two;
      check.equal(resource.getSnapshot().data, 'second');
      resource.dispose();
      return;
    }
    case 'AR-06': {
      const pending = deferred<string>();
      const resource = make<string, string>({ load: () => pending.promise });
      const run = resource.run('a');
      resource.cancel();
      check.equal(resource.getSnapshot().status, 'cancelled');
      pending.resolve('late');
      await run;
      check.equal(resource.getSnapshot().status, 'cancelled');
      resource.dispose();
      return;
    }
    case 'AR-07': {
      const old = deferred<string>();
      const next = deferred<string>();
      const resource = make<string, string>({
        load: (input) => (input === 'old' ? old.promise : next.promise),
      });
      const first = resource.run('old');
      const latest = resource.run('new');
      next.resolve('new-value');
      await latest;
      old.resolve('stale');
      await first;
      check.equal(resource.getSnapshot().data, 'new-value');
      resource.dispose();
      return;
    }
    case 'AR-08': {
      const gate = deferred<string>();
      const resource = make<string, string>({ load: () => gate.promise });
      const pending = resource.run('a');
      pending.catch(() => {});
      const before = resource.getSnapshot();
      check.throws(() =>
        runtime.transaction(() => {
          void resource.run('illegal');
        }),
      );
      check.equal(resource.getSnapshot(), before);
      gate.resolve('kept');
      await pending;
      resource.dispose();
      return;
    }
    case 'AR-09': {
      const gate = deferred<string>();
      const resource = make<string, string>({ load: () => gate.promise });
      const pending = resource.run('a');
      pending.catch(() => {});
      resource.dispose();
      resource.dispose();
      gate.resolve('late');
      await pending;
      check.equal(resource.getSnapshot().status, 'loading');
      return;
    }
    case 'AR-10': {
      const left = make<string, string>({ load: (s) => `L${s}` });
      const right = make<string, string>({ load: (s) => `R${s}` });
      await left.run('a');
      await right.run('b');
      check.equal(left.getSnapshot().data, 'La');
      check.equal(right.getSnapshot().data, 'Rb');
      left.dispose();
      right.dispose();
      return;
    }
    default:
      throw new Error(`unknown conformance scenario ${id}`);
  }
}

export async function runFullConformance(runtime: Runtime, check: ConformanceAssert): Promise<void> {
  const create: ConformanceFactory = (inner, options) => createAsyncResource(inner, options);
  for (const scenario of CONFORMANCE_SCENARIOS) {
    await runConformanceScenario(scenario.id, create, runtime, check);
  }
}

export function checkExhaustiveMatch(check: ConformanceAssert): void {
  const runtime = new Runtime();
  const resource = createAsyncResource<string, string>(runtime, { load: (s) => s });
  const label = matchAsyncState(resource.getSnapshot(), {
    idle: () => 'idle',
    loading: () => 'loading',
    success: (s) => s.data,
    empty: (s) => s.data,
    error: () => 'error',
    cancelled: () => 'cancelled',
  });
  check.equal(label, 'idle');
  resource.dispose();
  runtime.dispose();
}

export function checkCommittedErrorDistinct(check: ConformanceAssert): Promise<void> {
  const runtime = new Runtime();
  const gate = deferred<string>();
  const resource = createAsyncResource<string, string>(runtime, { load: () => gate.promise });
  resource.subscribe(() => {
    throw new Error('observer failure');
  });
  const pending = resource.run('a');
  gate.resolve('published');
  return pending.then(
    () => {
      throw new Error('expected a committed NotificationError');
    },
    (error: unknown) => {
      check.equal(error instanceof NotificationError, true);
      check.equal(resource.getSnapshot().status, 'success');
      resource.dispose();
      runtime.dispose();
    },
  );
}
