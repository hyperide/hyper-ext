/** Deterministic map-work probe; run in its own Node process with --import tsx. */
import assert from 'node:assert/strict';
import { Runtime } from './core.ts';

// Instrument real Map operations, retaining their behavior. Never import this
// probe into a shared test process: its counters cover the synchronous workload.
const originalSet = Map.prototype.set;
const originalIterator = Map.prototype[Symbol.iterator];
const rows = [];
for (const size of [256, 512, 1024, 2048]) {
  const runtime = new Runtime();
  const signals = Array.from({ length: size }, () => runtime.signal(0));
  let sets = 0;
  let copiedEntries = 0;
  Map.prototype.set = function (key, value) {
    sets++;
    return originalSet.call(this, key, value);
  };
  Map.prototype[Symbol.iterator] = function* () {
    for (const entry of originalIterator.call(this)) {
      copiedEntries++;
      yield entry;
    }
  };
  try {
    runtime.transaction(() => {
      for (const signal of signals) runtime.transaction(() => signal.set(1));
    });
  } finally {
    Map.prototype.set = originalSet;
    Map.prototype[Symbol.iterator] = originalIterator;
  }
  assert.equal(runtime.version, 1);
  assert.ok(signals.every((signal) => signal.get() === 1));
  rows.push({ size, sets, copiedEntries, mapWork: sets + copiedEntries });
  runtime.dispose();
}
console.info(JSON.stringify(rows, null, 2));
if (process.argv.includes('--assert-linear')) {
  for (const row of rows)
    assert.ok(row.mapWork <= row.size * 3, `nested actions visited ${row.mapWork} map entries for ${row.size} writes`);
}
