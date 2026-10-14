import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Runtime, NotificationError } from './core';

// Excalidraw-inspired publication contracts. This does not implement Excalidraw's history.
// Pin and scope: experiments/real-apps/sources.json and docs/api/REAL-APP-CORPUS.md.
test('Excalidraw-derived: group transform publishes a coherent scene once', () => {
  const runtime = new Runtime();
  const ax = runtime.signal(0),
    ay = runtime.signal(0),
    bx = runtime.signal(10),
    by = runtime.signal(20);
  const preview = runtime.derive(() => [ax.get(), ay.get(), bx.get(), by.get()]);
  const seen: number[][] = [];
  preview.subscribe((scene) => seen.push(scene));
  runtime.transaction(() => {
    ax.set(5);
    ay.set(7);
    bx.set(15);
    by.set(27);
  });
  assert.deepEqual(seen, [[5, 7, 15, 27]]);
  assert.equal(runtime.version, 1);
  runtime.dispose();
});
test('Excalidraw-derived: rejected group operation leaves no partial transform', () => {
  const runtime = new Runtime(),
    x = runtime.signal(0),
    y = runtime.signal(0),
    seen: number[] = [];
  x.subscribe((v) => seen.push(v));
  assert.throws(
    () =>
      runtime.transaction(() => {
        x.set(5);
        y.set(9);
        throw Error('locked shape');
      }),
    /locked shape/,
  );
  assert.deepEqual([x.get(), y.get(), runtime.version], [0, 0, 0]);
  assert.deepEqual(seen, []);
  runtime.dispose();
});
test('Excalidraw-derived: rejecting one nested operation preserves allowed siblings', () => {
  const runtime = new Runtime(),
    x = runtime.signal(0),
    style = runtime.signal('black');
  runtime.transaction(() => {
    x.set(4);
    assert.throws(() =>
      runtime.transaction(() => {
        style.set('red');
        throw Error('locked style');
      }),
    );
    x.set(8);
  });
  assert.equal(x.get(), 8);
  assert.equal(style.get(), 'black');
  assert.equal(runtime.version, 1);
  runtime.dispose();
});
test('Excalidraw-derived: a broken view is not a failed edit and cannot undo publication', () => {
  const runtime = new Runtime(),
    x = runtime.signal(0),
    y = runtime.signal(0),
    seen: number[] = [];
  x.subscribe(() => {
    throw Error('view failed');
  });
  y.subscribe((v) => seen.push(v));
  assert.throws(
    () =>
      runtime.transaction(() => {
        x.set(4);
        y.set(6);
      }),
    (e) => e instanceof NotificationError && e.committed,
  );
  assert.deepEqual([x.get(), y.get(), runtime.version], [4, 6, 1]);
  assert.deepEqual(seen, [6]);
  runtime.dispose();
});
