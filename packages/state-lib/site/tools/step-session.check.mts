import assert from 'node:assert/strict';
import { createStepSession, freezeAll } from '../src/lib/step-session';
const seen: string[] = [];
const api = (log: (...args: unknown[]) => void) => ({ log, seen, queueMicrotask });
const session = await createStepSession(
  '',
  `const a: number = 1;\nseen.push('one');\nqueueMicrotask(() => seen.push('microtask'));\nseen.push('two');`,
  'return null;',
  api,
);
assert.deepEqual([...seen], []);
await session.step();
assert.equal(session.frames.length, 1);
assert.deepEqual([...seen], []);
await session.step();
assert.deepEqual([...seen], ['one']);
await session.run();
assert.deepEqual([...seen], ['one', 'two', 'microtask']);
assert.equal(session.done, true);
assert.equal(session.frames[0].vars.a, 1);
session.cancel();
const two = await createStepSession(
  '',
  `const {x,y:[z]} = {x:2,y:[3]}; // comment\nconst sum = x+z; log(sum);`,
  'return null;',
  api,
);
await two.run();
assert.equal(two.scope.sum, 5);
assert.equal(two.frames.length, 3);
assert.equal(two.lines[0].text, '5');
two.cancel();
const stop = await createStepSession('', `seen.push('cancelled');`, 'return null;', api);
stop.cancel();
await new Promise((r) => setTimeout(r, 0));
assert.ok(!seen.includes('cancelled'));
console.log('PASS: actual statement pause; uninterrupted Run; TS/destructuring; immutable frames; cancellation');

const virtualSignal = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'peek') return () => 7;
      return undefined;
    },
  },
);
const virtualInspector = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'inspect') return () => ({ status: 'ready' });
      return undefined;
    },
  },
);
assert.equal('peek' in virtualSignal, false);
assert.equal('inspect' in virtualInspector, false);
assert.deepEqual(freezeAll({ virtualSignal, virtualInspector }), {
  virtualSignal: { '⟨signal⟩': 7 },
  virtualInspector: { status: 'ready' },
});

const virtualStore = new Proxy(
  {},
  {
    get(_target, key) {
      if (key === 'snapshot') return () => ({ count: 4 });
      if (key === 'log') return [{ name: 'increment' }];
      if (key === 'inspect') return () => 'inspect must not replace store recording';
      return undefined;
    },
  },
);
assert.equal('log' in virtualStore, false);
assert.deepEqual(freezeAll({ virtualStore }), {
  virtualStore: { '⟨store⟩': { count: 4 }, log: [{ name: 'increment' }] },
});
