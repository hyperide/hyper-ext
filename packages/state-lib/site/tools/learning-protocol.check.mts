import assert from 'node:assert/strict';
import { createShapeLab } from '../src/lib/shape-lab';
import { createElectricReader } from '../src/lib/electric-reader';
const lab = createShapeLab('resume');
lab.start();
lab.pull(100);
lab.pull();
assert.equal(lab.inspect().client.length, 4);
lab.disconnect();
lab.remove('2');
lab.write('3', { value: 999 });
lab.reconnect();
lab.pull();
assert.ok(!lab.inspect().client.some((r) => r.id === '2'));
assert.equal(lab.inspect().client.find((r) => r.id === '3')?.value, 999);
const before = lab.inspect().client;
lab.retry();
assert.deepEqual(lab.inspect().client, before);
lab.expire();
lab.pull();
assert.equal(lab.inspect().phase, 'must-refetch');
assert.equal(lab.inspect().client.length, 0);
lab.start();
lab.pull(100);
lab.pull();
assert.equal(lab.inspect().phase, 'up-to-date');
const snap = createShapeLab();
snap.start();
snap.write('2', { value: 555 });
snap.pull(2);
assert.equal(snap.inspect().client.length, 0);
snap.pull(100);
snap.pull();
assert.equal(snap.inspect().client.find((r) => r.id === '2')?.value, 555);
snap.write('2', { project: 'other' });
snap.pull();
assert.ok(!snap.inspect().client.some((r) => r.id === '2'));
const original = globalThis.fetch;
const urls: string[] = [];
let n = 0;
globalThis.fetch = new Proxy(original, {
  async apply(_target, _receiver, [url]) {
    urls.push(String(url));
    return n++ === 0
      ? new Response(
          JSON.stringify([
            { key: '"public"."items"/"2"', value: { id: 2, value: 10 }, headers: { operation: 'insert' } },
            { headers: { control: 'up-to-date' } },
          ]),
          { headers: { 'Content-Type': 'application/json', 'electric-offset': '0_5', 'electric-handle': 'shape1' } },
        )
      : new Response('', { status: 409 });
  },
});
try {
  const reader = createElectricReader();
  reader.configure('https://example.invalid/v1/shape', 'items');
  await reader.pull();
  assert.equal(reader.inspect().offset, '0_5');
  assert.equal(reader.inspect().rows.length, 1);
  await reader.pull();
  assert.ok(urls[1].includes('offset=0_5') && urls[1].includes('handle=shape1'));
  assert.equal(reader.inspect().phase, 'must-refetch');
  assert.equal(reader.inspect().rows.length, 0);
} finally {
  globalThis.fetch = original;
}
console.log(
  'PASS: snapshot/delta boundary, offline delete, idempotent keyed retry, membership removal, must-refetch; mocked HTTP headers and 409',
);
