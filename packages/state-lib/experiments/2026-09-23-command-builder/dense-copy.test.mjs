import test from 'node:test';
import assert from 'node:assert/strict';
import * as json from '../2026-09-19-cow/json-draft.mjs';

function copy(value) {
  assert.equal(typeof json.copyJsonArrayForCommand, 'function');
  return json.copyJsonArrayForCommand(value);
}
test('command array copying creates a private array but shares immutable payloads', () => {
  const base = json.ownJson(Array.from({ length: 32 }, (_, i) => ({ value: i })));
  const next = copy(base);
  assert.notEqual(next, base);
  assert.deepEqual(next, base);
  assert.equal(next[0], base[0]);
  assert.equal(Object.isFrozen(next), false);
  next.pop();
  assert.equal(base.length, 32);
});
test('sparse array copying preserves holes, length and present references', () => {
  const input = new Array(4);
  input[2] = { value: 2 };
  const base = json.ownJson(input),
    next = copy(base);
  assert.equal(next.length, 4);
  assert.equal(0 in next, false);
  assert.equal(3 in next, false);
  assert.equal(next[2], base[2]);
  assert.equal(Object.keys(next).length, 1);
});
test('untrusted iterables retain indexed array copying semantics', () => {
  const input = [{ value: 1 }];
  input[Symbol.iterator] = function* () {
    yield { value: 999 };
  };
  const next = copy(input);
  assert.equal(next[0], input[0]);
  assert.equal(next[0].value, 1);
});
test('an untrusted array cannot replace the indexed-copy operation with its own method', () => {
  const input = [{ value: 1 }];
  input.slice = () => input;
  const next = copy(input);
  assert.notEqual(next, input);
  assert.equal(next[0], input[0]);
  next.pop();
  assert.equal(input.length, 1);
});
