/* oxlint-disable unicorn/no-thenable -- the then-key regression test needs plain data shaped like a thenable */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, NotificationError } from './core';
import { createRecord } from './record';
const validate = (raw: unknown) => {
  const x = raw as { panel: { size: number }; title: string };
  if (!x || typeof x.title !== 'string' || !Number.isFinite(x.panel?.size) || x.panel.size < 1)
    throw new Error('Invalid record');
  return x;
};
test('caller references cannot silently mutate committed record data', () => {
  const r = new Runtime(),
    source = { title: 'a', panel: { size: 30 } },
    s = createRecord(r, source, validate);
  source.panel.size = 1;
  assert.equal(s.get().panel.size, 30);
  assert.throws(() => {
    s.get().panel.size = 3;
  });
  r.dispose();
});
test('nested outer abort retains old value and sends no notifications', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  let count = 0;
  s.subscribe(() => count++);
  assert.throws(() =>
    r.transaction(() => {
      s.update((d) => (d.panel.size = 50));
      throw new Error('abort');
    }),
  );
  assert.equal(s.get().panel.size, 30);
  assert.equal(count, 0);
  r.dispose();
});
test('validator failure never publishes a partially edited record', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  assert.throws(() =>
    s.update((d) => {
      d.title = 'b';
      d.panel.size = -1;
    }),
  );
  assert.equal(s.get().title, 'a');
  r.dispose();
});
test('record changes join one outer notification wave', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  const seen: unknown[] = [];
  s.subscribe((v) => seen.push(v));
  r.transaction(() => {
    s.update((d) => (d.title = 'b'));
    s.update((d) => (d.panel.size = 50));
  });
  assert.equal(seen.length, 1);
  assert.deepEqual(s.get(), { title: 'b', panel: { size: 50 } });
  r.dispose();
});
test('observer error remains post-commit, not a rollback claim', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  s.subscribe(() => {
    throw new Error('observer');
  });
  assert.throws(() => s.update((d) => (d.title = 'b')), NotificationError);
  assert.equal(s.get().title, 'b');
  r.dispose();
});
test('reentrant writes cannot silently overwrite an inner committed edit', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  assert.throws(
    () =>
      s.update((d) => {
        s.update((inner) => (inner.title = 'inner'));
        d.panel.size = 50;
      }),
    /reentrant/,
  );
  assert.deepEqual(s.get(), { title: 'a', panel: { size: 30 } });
  r.dispose();
});
test('set validates and isolates caller input, and a failed set leaves the record untouched', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  const next = { title: 'b', panel: { size: 40 } };
  s.set(next);
  next.panel.size = 1;
  assert.equal(s.get().panel.size, 40);
  assert.throws(() => s.set({ title: 'c', panel: { size: 0 } }), /Invalid record/);
  assert.equal(s.get().title, 'b');
  r.dispose();
});
test('asynchronous recipes are rejected and their later failure is absorbed', async () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    assert.throws(
      () =>
        s.update((async () => {
          await Promise.resolve();
          throw new Error('late failure');
        }) as unknown as (d: { title: string }) => void),
      { code: 'STATE_RECORD_ASYNC' },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
    assert.equal(s.get().title, 'a');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    r.dispose();
  }
});
test('plain data that merely has a then key is not mistaken for a promise', () => {
  const r = new Runtime(),
    s = createRecord(
      r,
      { title: 'a', rule: { when: 'x', then: 'y' } },
      (raw) => raw as { title: string; rule: object },
    );
  s.update((d) => (d.rule = { when: 'dark', then: 'light' }));
  assert.deepEqual(s.get().rule, { when: 'dark', then: 'light' });
  r.dispose();
});
test('values the freeze cannot make immutable are rejected instead of leaking mutable state', () => {
  const r = new Runtime();
  assert.throws(() => createRecord(r, { tags: new Set(['a']) }, (raw) => raw as { tags: Set<string> }), {
    code: 'STATE_RECORD_UNSUPPORTED',
  });
  assert.throws(() => createRecord(r, { buf: new Uint8Array(2) }, (raw) => raw as { buf: Uint8Array }), {
    code: 'STATE_RECORD_UNSUPPORTED',
  });
  r.dispose();
});
test('Date and ArrayBuffer values are rejected because freezing cannot protect them', () => {
  const r = new Runtime();
  for (const bad of [{ at: new Date(0) }, { buf: new ArrayBuffer(2) }])
    assert.throws(() => createRecord(r, bad, (raw) => raw as object), { code: 'STATE_RECORD_UNSUPPORTED' });
  r.dispose();
});
test('asynchronous validators are rejected and their later failure is absorbed', async () => {
  const r = new Runtime();
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    assert.throws(
      () =>
        createRecord(r, { title: 'a' }, (async () => {
          await Promise.resolve();
          throw new Error('late');
        }) as unknown as (value: unknown) => { title: string }),
      { code: 'STATE_RECORD_ASYNC' },
    );
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, []);
  } finally {
    process.off('unhandledRejection', onUnhandled);
    r.dispose();
  }
});
test('functions are rejected with the adapter error, not a raw DataCloneError', () => {
  const r = new Runtime();
  assert.throws(() => createRecord(r, { onChange() {} }, (raw) => raw as object), { code: 'STATE_RECORD_UNSUPPORTED' });
  r.dispose();
});
test('update validates an isolated copy, so a getter or caller-owned object cannot bypass the validator', () => {
  const r = new Runtime(),
    s = createRecord(r, { title: 'a', panel: { size: 30 } }, validate);
  let reads = 0;
  s.update((d) => {
    Object.defineProperty(d.panel, 'size', { enumerable: true, get: () => (reads++ === 0 ? 30 : -1) });
  });
  assert.equal(s.get().panel.size, 30);
  assert.equal(reads, 1);
  const owned = { size: 5 };
  const normalizing = createRecord(r, { title: 'a', panel: { size: 30 } }, (raw) => {
    const x = validate(raw);
    x.panel.size = Math.max(1, x.panel.size + 1);
    return x;
  });
  normalizing.update((d) => {
    d.panel = owned;
  });
  assert.equal(owned.size, 5);
  r.dispose();
});
