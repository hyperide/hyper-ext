/** Compare method receiver and evaluation behavior before and after access compilation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileAccess } from './compile-access.mjs';
import { NormalizedStore } from './normalized.mjs';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../site/package.json', import.meta.url));
const ts = require('typescript');

const lower = (source) =>
  ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

function run(source, compiled) {
  const calls = [];
  const fixture = new NormalizedStore(
    {
      rows: {
        idType: 'number',
        fields: ['id', 'name', 'count'],
        validate: (row) => {
          assert.equal(typeof row.name, 'string');
          assert.equal(typeof row.count, 'number');
        },
      },
    },
    { rows: [{ id: 1, name: 'hello', count: 2 }] },
    { compiled },
  );
  const result = new Function('fixture', 'index', 'argument', compiled ? compileAccess(source) : lower(source))(
    fixture,
    () => {
      calls.push('index');
      return 1;
    },
    () => {
      calls.push('argument');
      return 1;
    },
  );
  return { result, calls, state: fixture.inspect(), version: fixture.version, log: fixture.log };
}

const wrappers = [
  ['parenthesized', (value) => `(${value})`],
  ['as', (value) => `(${value} as any)`],
  ['type assertion', (value) => `(<any>${value})`],
  ['non-null', (value) => `${value}!`],
  ['satisfies', (value) => `(${value} satisfies Function)`],
  ['nested', (value) => `((<any>(${value} as any))! satisfies any)`],
];

for (const [name, wrap] of wrappers) {
  for (const [base, rest] of [
    ['store', '.state.rows[index()].name'],
    ['store.state', '.rows[index()].name'],
    ['store.state.rows', '[index()].name'],
    ['store.state.rows[index()]', '.name'],
  ]) {
    for (const suffix of ['', '.toUpperCase()', '.slice(argument())']) {
      test(`${name} interior chain ${base}${suffix}`, () => {
        const source = `const store = fixture; return ${wrap(base)}${rest}${suffix};`;
        assert.deepEqual(run(source, true), run(source, false));
      });
    }
    test(`${name} interior chain shadowing ${base}`, () => {
      const source = `const store = fixture; return ((store) => ${wrap(base)}${rest})({ state: { rows: { 1: { name: 'shadow' } } } });`;
      assert.deepEqual(run(source, true), run(source, false));
    });
  }
  for (const suffix of ['()', '?.()', '`ignored`']) {
    test(`${name} receiver ${suffix}`, () => {
      const source = `const store = fixture; return ${wrap('store.state.rows[index()].name.toUpperCase')}${suffix};`;
      assert.deepEqual(run(source, true), run(source, false));
    });
  }
  test(`${name} optional call skips arguments`, () => {
    const source = `const store = fixture; return ${wrap('store.state.rows[index()].name.missing')}?.(argument());`;
    assert.deepEqual(run(source, true), run(source, false));
  });
  for (const statement of [
    `${wrap('store.state.rows[1].name')} = "world";`,
    `${wrap('store.state.rows[index()].count')} += argument();`,
    `const previous = ${wrap('store.state.rows[index()].count')}++;`,
    `const next = --${wrap('store.state.rows[index()].count')};`,
  ]) {
    test(`${name} target: ${statement}`, () => {
      const source = `const store = fixture; ${statement} return [store.state.rows[1].name, store.state.rows[1].count, typeof previous === 'undefined' ? null : previous, typeof next === 'undefined' ? null : next];`;
      const original = run(source, false);
      assert.deepEqual(run(source, true), original);
    });
  }
  for (const statement of [
    `delete ${wrap('store.state.rows[1].name')};`,
    `for (${wrap('store.state.rows[1].name')} in { world: 1 }) {}`,
    `for (${wrap('store.state.rows[1].name')} of ['world']) {}`,
  ]) {
    test(`${name} rejects unsupported target: ${statement}`, () => {
      assert.throws(
        () => compileAccess(`const store = fixture; ${statement}`),
        /Use store.remove|Loop assignment targets are not supported/,
      );
    });
  }
  test(`${name} plain read remains a read`, () => {
    const source = `const store = fixture; return ${wrap('store.state.rows[index()].name')};`;
    assert.match(compileAccess(source), /\$read\("rows", index\(\), \["name"\]\)/);
    assert.deepEqual(run(source, true), run(source, false));
  });
}

for (const expression of [
  'store.state.rows[index()].name.toUpperCase()',
  '(store.state.rows[index()].name.toUpperCase)()',
  'store.state.rows[index()].name.toUpperCase?.()',
  'store.state.rows[index()].name.slice(argument())',
  'store.state.rows[index()].name.toUpperCase.call("other")',
  'store.state.rows[index()].name.toUpperCase`ignored`',
  'store.state.rows[index()].name.missing?.(argument())',
]) {
  test(`preserves receiver: ${expression}`, () => {
    const source = `const store = fixture;
      const result = ${expression}; return result;`;
    assert.deepEqual(run(source, true), run(source, false));
  });
}
