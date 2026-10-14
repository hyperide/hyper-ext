import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NormalizedStore } from './normalized.mjs';
import { compileAccess } from './compile-access.mjs';
// Fixture validators; production injects typia.createAssert<T>() generated in its build.
const schema = {
  customers: {
    idType: 'number',
    fields: ['id', 'name'],
    validate: (r) => {
      if (typeof r.name !== 'string' || !r.name.length) throw Error('Invalid name');
    },
  },
  invoices: {
    idType: 'number',
    fields: ['id', 'customerId', 'amount'],
    relations: { customer: { table: 'customers', key: 'customerId' } },
    validate: (r) => {
      if (!Number.isSafeInteger(r.amount) || r.amount < 0) throw Error('Invalid amount');
    },
  },
};
const data = () => ({
  customers: [
    { id: 7, name: 'Acme' },
    { id: 8, name: 'Other' },
  ],
  invoices: [
    { id: 1, customerId: 7, amount: 100 },
    { id: 2, customerId: 7, amount: 200 },
  ],
});
const make = (options) => new NormalizedStore(schema, data(), options);
test('exact requested syntax writes one authoritative customer row', () => {
  const s = make();
  s.state.invoices[1].customer.name = 'New';
  assert.equal(s.state.invoices[2].customer.name, 'New');
  assert.equal(s.state.invoices[1].customer, s.state.customers[7]);
  assert.equal(s.inspect().invoices[1].customer, undefined);
  assert.equal(s.log[0].patches[0].table, 'customers');
});
test('one action = one commit and no intermediate notifications', () => {
  const s = make(),
    seen = [];
  s.observe(() => seen.push([s.state.invoices[1].customer.name, s.state.invoices[1].amount]));
  s.$commit('edit', () => {
    s.state.invoices[1].customer.name = 'X';
    s.state.invoices[1].amount = 300;
    assert.equal(s.state.invoices[2].customer.name, 'X');
  });
  assert.deepEqual(seen, [
    ['Acme', 100],
    ['X', 300],
  ]);
  assert.equal(s.log.length, 1);
});
test('validation and exceptions roll back the entire action', () => {
  const s = make();
  assert.throws(() =>
    s.$commit('bad', () => {
      s.state.customers[7].name = 'X';
      s.state.invoices[1].amount = -1;
    }),
  );
  assert.equal(s.state.customers[7].name, 'Acme');
  assert.equal(s.version, 0);
  assert.throws(() =>
    s.$commit('fail', () => {
      s.state.customers[7].name = 'X';
      throw Error('stop');
    }),
  );
  assert.equal(s.version, 0);
});
test('relation changes retrack dependencies', () => {
  const s = make(),
    seen = [];
  s.observe(() => seen.push(s.state.invoices[1].customer.name));
  s.state.invoices[1].customer = s.state.customers[8];
  s.state.customers[7].name = 'Unrelated';
  s.state.customers[8].name = 'Related';
  assert.deepEqual(seen, ['Acme', 'Other', 'Related']);
});
test('FK validation and immutable identity', () => {
  const s = make();
  assert.throws(() => {
    s.state.invoices[1].customerId = 999;
  });
  assert.throws(() => s.remove('customers', 7));
  assert.throws(() => {
    s.state.customers[7].id = 11;
  });
  assert.equal(s.version, 0);
});
test('stale facade cannot address recycled ID', () => {
  const s = make();
  const held = s.state.customers[8];
  s.remove('customers', 8);
  s.put('customers', { id: 8, name: 'Reborn' });
  assert.throws(() => held.name, /Stale/);
  assert.equal(s.state.customers[8].name, 'Reborn');
});
test('no-op writes do not commit; unobserved fields do not notify', () => {
  const s = make();
  let count = 0;
  const stop = s.observe(() => {
    assert.equal(s.state.customers[7].name, 'Acme');
    count++;
  });
  s.state.invoices[1].amount = 101;
  s.state.customers[7].name = 'Acme';
  assert.equal(s.version, 1);
  assert.equal(count, 1);
  stop();
  s.state.customers[7].name = 'B';
  assert.equal(count, 1);
});
test('async and nested action declarations are refused', () => {
  const s = make();
  assert.throws(() => s.$commit('async', async () => {}));
  assert.throws(() => s.$commit('outer', () => s.$commit('inner', () => {})));
  assert.equal(s.version, 0);
});
test('compiler supports the public syntax without registering table properties', async () => {
  globalThis.__fixture = make({ compiled: true });
  const source = `const store=globalThis.__fixture; store.state.invoices[1].customer.name='Compiled'; export const result=store.state.invoices[2].customer.name;`;
  const output = compileAccess(source);
  assert(!output.includes('store.state'));
  const m = await import(`data:text/javascript,${encodeURIComponent(output)}`);
  assert.equal(m.result, 'Compiled');
  assert.throws(() => globalThis.__fixture.state, /requires compile/);
  delete globalThis.__fixture;
});
test('compiler resolves assignment target before RHS mutates a relation', async () => {
  const s = make({ compiled: true });
  globalThis.__fixture = s;
  const source = `const store=globalThis.__fixture;store.$commit('rhs',()=>{store.state.invoices[1].customer.name=(store.state.invoices[1].customerId=8,'Old target');});export const values=[store.state.customers[7].name,store.state.customers[8].name];`;
  const m = await import(`data:text/javascript,${encodeURIComponent(compileAccess(source))}`);
  assert.deepEqual(m.values, ['Old target', 'Other']);
  delete globalThis.__fixture;
});
test('compiler preserves compound assignment and index evaluation exactly once', async () => {
  globalThis.__fixture = make({ compiled: true });
  const src = `const store=globalThis.__fixture;let calls=0;const index=()=>{calls++;return 1;};const old=store.state.invoices[index()].amount++;store.state.invoices[1].amount+=2;export const values=[calls,old,store.state.invoices[1].amount];`;
  const m = await import(`data:text/javascript,${encodeURIComponent(compileAccess(src))}`);
  assert.deepEqual(m.values, [1, 100, 103]);
  delete globalThis.__fixture;
});
test('compiler does not rewrite a shadowed variable with the same name', async () => {
  globalThis.__fixture = make({ compiled: true });
  const src = `const store=globalThis.__fixture;function f(store){return store.state.invoices[1].name;}export const values=[store.state.invoices[1].customer.name,f({state:{invoices:{1:{name:'Not a store'}}}})];`;
  const m = await import(`data:text/javascript,${encodeURIComponent(compileAccess(src))}`);
  assert.deepEqual(m.values, ['Acme', 'Not a store']);
  delete globalThis.__fixture;
});

test('public action is a callable factory; assignments remain ordinary syntax', () => {
  const s = make();
  const rename = s.action('rename', (name) => {
    s.state.invoices[1].customer.name = name;
  });
  assert.equal(s.state.customers[7].name, 'Acme');
  rename('New');
  assert.equal(s.state.customers[7].name, 'New');
});
