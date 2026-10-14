import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeValues, inspectPath } from '../src/lib/repl-inspection';

test('inspection reports omitted fields rather than presenting them as absent', () => {
  const fields = Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`v${index}`, index]));
  const snapshot = scopeValues({ fields });
  assert.match(JSON.stringify(snapshot), /inspection limit/);
  const root = scopeValues(Object.fromEntries(Array.from({ length: 105 }, (_, index) => [`v${index}`, index])));
  assert.match(JSON.stringify(root), /inspection limit/);
});
test('large sparse arrays do not turn a one-entry inspection into an enormous JSON value', () => {
  const sparse: number[] = [];
  sparse[100_000] = 7;
  const snapshot = scopeValues({ sparse });
  const value = inspectPath(snapshot, 'sparse');
  const encoded = JSON.stringify(value.value);
  assert(encoded.length < 5000, `Inspection materialized ${encoded.length} bytes`);
  assert.match(encoded, /inspection limit/);
});
test('small values are preserved exactly, with no truncation notice', () => {
  const snapshot = scopeValues({ state: { list: [{ done: false }], missing: undefined } });
  assert.equal(JSON.stringify(snapshot), JSON.stringify({ state: { list: [{ done: false }] } }));
  assert(!JSON.stringify(snapshot).includes('inspection limit'));
  assert(Array.isArray((snapshot.state as Record<string, unknown>).list));
  assert.deepEqual(inspectPath(snapshot, 'state.list[0].done'), { found: true, value: false });
});
test('an omitted field reports the limit; a truly absent field does not', () => {
  const fields = Object.fromEntries(Array.from({ length: 205 }, (_, index) => [`v${index}`, index]));
  const snapshot = scopeValues({ fields });
  const omitted = inspectPath(snapshot, 'fields.v204');
  assert.equal(omitted.found, false);
  assert.match(omitted.error ?? '', /inspection limit/);
  // Under a truncated parent an absent key cannot be told apart from an omitted
  // one, so it carries the same notice rather than a bare miss.
  const absentUnderTruncated = inspectPath(snapshot, 'fields.absent');
  assert.equal(absentUnderTruncated.found, false);
  assert.match(absentUnderTruncated.error ?? '', /inspection limit/);
  const small = scopeValues({ a: 1 });
  assert.deepEqual(inspectPath(small, 'a.missing'), { found: false });
});
test('a user key that matches the truncation notice survives alongside the renamed marker', () => {
  const snapshot = scopeValues({
    fields: Object.fromEntries([
      ['… inspection limit', 'user data, not a notice'],
      ...Array.from({ length: 205 }, (_, index) => [`v${index}`, index]),
    ]),
  });
  const fields = snapshot.fields as Record<string, unknown>;
  assert.equal(fields['… inspection limit'], 'user data, not a notice');
  const markers = Object.keys(fields).filter(
    (key) => key.startsWith('… inspection limit ') && key !== '… inspection limit',
  );
  assert.equal(markers.length, 1);
  assert.match(String(fields[markers[0]]), /inspection limit/);
});
test('holey small arrays keep their length; holes stay holes', () => {
  const a: unknown[] = [];
  a.length = 5;
  const b: unknown[] = [7];
  b.length = 5;
  const snapshot = scopeValues({ a, b });
  const sa = inspectPath(snapshot, 'a').value as unknown[];
  const sb = inspectPath(snapshot, 'b').value as unknown[];
  assert(Array.isArray(sa) && Array.isArray(sb));
  assert.equal(sa.length, 5);
  assert.equal(sb.length, 5);
  assert.equal(sb[0], 7);
  assert(!Object.prototype.hasOwnProperty.call(sa, '0'), 'holes must not become fabricated values');
  assert(!JSON.stringify(snapshot).includes('inspection limit'));
});
test('a user value that looks like the notice never becomes a truncation error', () => {
  const snapshot = scopeValues({ obj: { '… inspection limit': 'user value', x: 1 } });
  assert.deepEqual(inspectPath(snapshot, 'obj.absent'), { found: false });
  assert.deepEqual(inspectPath(snapshot, 'obj.x'), { found: true, value: 1 });
});
test('truncation never invokes functions or getters in the dropped fields', () => {
  let calls = 0;
  const fields: Record<string, unknown> = Object.fromEntries(
    Array.from({ length: 205 }, (_, index) => [`v${index}`, index]),
  );
  Object.defineProperty(fields, 'sneaky', {
    enumerable: true,
    get() {
      calls++;
      return 1;
    },
  });
  fields.action = () => {
    calls++;
  };
  const snapshot = scopeValues({ fields });
  assert.match(JSON.stringify(snapshot), /inspection limit/);
  assert.match(
    String(inspectPath(snapshot, 'fields.sneaky').value ?? inspectPath(snapshot, 'fields.sneaky').error),
    /not evaluated|inspection limit/,
  );
  assert.equal(calls, 0);
});

import {
  saveWorkbenchDraft,
  flushWorkbenchDraft,
  clearWorkbenchDraft,
  readWorkbenchDraft,
  WORKBENCH_DRAFT_LIMIT,
} from '../src/lib/workbench-draft';
import { observeLiveInspection } from '../src/lib/live-inspection';
import { registerInspection } from '../src/lib/repl-inspection';

test('draft persistence coalesces typing and removes stale disk content when saving fails', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  const disk = new Map<string, string>();
  let writes = 0,
    fail = false;
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => disk.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (fail) throw Error('quota');
        writes++;
        disk.set(key, value);
      },
      removeItem: (key: string) => disk.delete(key),
    },
  });
  const id = 'review-draft',
    example = { id, title: 'Test', about: '', setup: '', code: '', ui: '' };
  try {
    for (let index = 0; index < 50; index++)
      saveWorkbenchDraft(id, { setup: '', ui: '', command: '', source: `edit-${index}` });
    assert.equal(writes, 0);
    assert.equal(readWorkbenchDraft(example, '').source, 'edit-49');
    assert.equal(flushWorkbenchDraft(id), 'saved');
    assert.equal(writes, 1);
    fail = true;
    saveWorkbenchDraft(id, { setup: '', ui: '', command: '', source: 'new unsaved source' });
    assert.equal(flushWorkbenchDraft(id), 'memory');
    assert.equal(disk.get(`state.workbench.v1:${id}`), undefined);
    assert.equal(readWorkbenchDraft(example, '').source, 'new unsaved source');
    fail = false;
    saveWorkbenchDraft(id, { setup: '', ui: '', command: '', source: 'x'.repeat(WORKBENCH_DRAFT_LIMIT + 1) });
    assert.equal(flushWorkbenchDraft(id), 'memory');
    assert.equal(writes, 1);
  } finally {
    clearWorkbenchDraft(id);
    if (descriptor) Object.defineProperty(globalThis, 'sessionStorage', descriptor);
    else Reflect.deleteProperty(globalThis, 'sessionStorage');
  }
});
test('checkpoint scope replacement preserves live inspection revision and reconciles subscriptions', async () => {
  const events = new Set<() => void>(),
    updates: { revision: number; paths: string[] }[] = [];
  let state = 0;
  const store = registerInspection(
    {},
    {
      read: () => ({ count: state }),
      subscribe: (notify) => {
        events.add(notify);
        return () => {
          events.delete(notify);
        };
      },
    },
  );
  const checkpoints = new Set<() => void>();
  const session = {
    scope: { store },
    subscribe: (notify: () => void) => {
      checkpoints.add(notify);
      return () => {
        checkpoints.delete(notify);
      };
    },
  };
  const stop = observeLiveInspection(session, (update) => updates.push(update));
  state = 1;
  events.forEach((notify) => notify());
  session.scope = { store };
  checkpoints.forEach((notify) => notify());
  await Promise.resolve();
  state = 2;
  events.forEach((notify) => notify());
  session.scope = { store };
  checkpoints.forEach((notify) => notify());
  await Promise.resolve();
  assert.deepEqual(
    updates.map((update) => update.revision),
    [0, 1, 2],
  );
  assert.deepEqual(updates.at(-1)?.paths, ['store.count']);
  stop();
  assert.equal(events.size, 0);
  assert.equal(checkpoints.size, 0);
});
