import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeValues, inspectPath, registerInspection, changedValuePaths } from '../src/lib/repl-inspection';

test('value inspection does not evaluate functions, getters or toJSON', () => {
  let calls = 0;
  const data = {
    n: 7,
    action: () => {
      calls++;
    },
    toJSON() {
      calls++;
    },
    get computed() {
      calls++;
      return 9;
    },
  };
  const snapshot = scopeValues({ data });
  assert.equal(calls, 0);
  assert.deepEqual(inspectPath(snapshot, 'data.n'), { found: true, value: 7 });
  assert.match(String(inspectPath(snapshot, 'data.computed').value), /not evaluated/);
  assert.match(inspectPath(snapshot, 'data.action()').error!, /data path/);
  assert.equal(calls, 0);
});
test('inspector reads only own data and reports missing, arrays, undefined correctly', () => {
  const data = scopeValues({ state: { list: [{ done: false }], missing: undefined } });
  assert.deepEqual(inspectPath(data, 'state.list[0].done'), { found: true, value: false });
  assert.deepEqual(inspectPath(data, 'state.missing'), { found: true, value: undefined });
  assert.deepEqual(inspectPath(data, 'state.absent'), { found: false });
  assert(inspectPath(data, 'state.__proto__').error);
});
test('only explicitly registered stores are read, and cyclic data remains bounded', () => {
  let reads = 0;
  const store = registerInspection(
    {},
    {
      read: () => {
        reads++;
        return { n: 4 };
      },
      subscribe: () => () => {},
    },
  );
  const cycle: { self?: unknown } = {};
  cycle.self = cycle;
  assert.equal(inspectPath(scopeValues({ store, cycle }), 'store.n').value, 4);
  assert.equal(reads, 1);
  assert.match(String(inspectPath(scopeValues({ cycle }), 'cycle.self').value), /circular/);
});
test('length-only array growth is reported as a change', () => {
  const before = scopeValues({ items: [] as unknown[] });
  const grown: unknown[] = [];
  grown.length = 5;
  assert.deepEqual(changedValuePaths(before, scopeValues({ items: grown })), ['items.length']);
});
test('throwing Proxy traps degrade to unavailable instead of breaking the snapshot', () => {
  const hostile = new Proxy(
    {},
    {
      ownKeys() {
        throw new Error('proxy boom');
      },
    },
  );
  const hostileList = new Proxy([] as unknown[], {
    ownKeys() {
      throw new Error('proxy boom');
    },
  });
  const data = scopeValues({ value: hostile, list: hostileList, ok: 1 });
  assert.equal(data.ok, 1);
  assert.deepEqual(inspectPath(data, 'value'), { found: true, value: '[unavailable]' });
  assert.deepEqual(inspectPath(data, 'list'), { found: true, value: '[unavailable]' });
});
