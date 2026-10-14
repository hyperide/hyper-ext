import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime } from './core.js';
import { toExternalStore, selectExternalStore } from './external-store.js';

test('selector snapshots are stable and unrelated fields do not notify', () => {
  const runtime = new Runtime(),
    value = runtime.signal({ theme: 'dark', open: false });
  const source = toExternalStore(value);
  const selected = selectExternalStore(
    source,
    (s) => ({ theme: s.theme }),
    (a, b) => a.theme === b.theme,
  );
  const first = selected.getSnapshot();
  let calls = 0;
  const stop = selected.subscribe(() => {
    calls++;
  });
  assert.equal(selected.getSnapshot(), first);
  value.set({ theme: 'dark', open: true });
  assert.equal(selected.getSnapshot(), first);
  assert.equal(calls, 0);
  value.set({ theme: 'light', open: true });
  assert.equal(calls, 1);
  assert.equal(selected.getSnapshot().theme, 'light');
  stop();
  value.set({ theme: 'dark', open: false });
  assert.equal(calls, 1);
  runtime.dispose();
});
test('one transaction presents one coherent external snapshot', () => {
  const runtime = new Runtime(),
    a = runtime.signal(0),
    b = runtime.signal(0);
  const combined = runtime.derive(() => ({ a: a.get(), b: b.get() }));
  const source = toExternalStore(combined),
    seen: unknown[] = [];
  const stop = source.subscribe(() => seen.push(source.getSnapshot()));
  runtime.transaction(() => {
    a.set(1);
    b.set(2);
  });
  assert.deepEqual(seen, [{ a: 1, b: 2 }]);
  stop();
  runtime.dispose();
});
