import test from 'node:test';
import assert from 'node:assert/strict';
// Counterexamples to specific claims in source S2; the original is preserved.
test('Object.keys does not invoke ownKeys on a proxy in the prototype chain', () => {
  let calls = 0;
  const prototype = new Proxy(
    {},
    {
      ownKeys() {
        calls++;
        return ['virtual'];
      },
      getOwnPropertyDescriptor() {
        return { enumerable: true, configurable: true, value: 9 };
      },
    },
  );
  const object = Object.create(prototype);
  assert.deepEqual(Object.keys(object), []);
  assert.equal(calls, 0);
  assert.deepEqual(Reflect.ownKeys(object), []);
  assert.equal(calls, 0);
});
test('a prototype has trap can affect in without changing own-property enumeration', () => {
  const object = Object.create(new Proxy({}, { has: () => true }));
  assert.equal('virtual' in object, true);
  assert.deepEqual(Object.keys(object), []);
});
test('deleting an existing own accessor does not call a prototype delete trap', () => {
  let deletions = 0;
  const object = Object.create(
    new Proxy(
      {},
      {
        deleteProperty() {
          deletions++;
          return true;
        },
      },
    ),
  );
  Object.defineProperty(object, 'value', { get: () => 5, configurable: true, enumerable: true });
  assert.equal(delete object.value, true);
  assert.equal(deletions, 0);
  assert.deepEqual(Object.keys(object), []);
});
test('first-read accessor promotion is an observable semantic change', () => {
  const object = Object.create(
    new Proxy(
      {},
      {
        get(_target, key, receiver) {
          Object.defineProperty(receiver, key, {
            value: undefined,
            enumerable: true,
            configurable: true,
            writable: true,
          });
          return undefined;
        },
      },
    ),
  );
  assert.deepEqual(Object.keys(object), []);
  void object.missing;
  assert.deepEqual(Object.keys(object), ['missing']);
});
test('lowering a computed method access to a free call changes its receiver', () => {
  const object = {
    value: 7,
    read() {
      return this?.value;
    },
  };
  const key = 'read';
  const get = (base, name) => base[name];
  assert.equal(object[key](), 7);
  assert.equal(get(object, key)(), undefined);
});
