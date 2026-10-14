import assert from 'node:assert/strict';
import { FIXTURE, type Variant } from '../src/data/query-comparison';
import { runQueryFixture } from '../src/lib/run-query-fixture';
const variant = (code: string): Variant => ({ code, lines: [], status: 'executable', note: '', lang: 'js' });

await assert.rejects(runQueryFixture(variant(`
  const plan = view.from(rows);
  plan.run = () => { rows[0].amount = 999; return rows; };
  return plan;
`)), /mutated the input fixture/);

// A result field named run is ordinary data unless the result is an actual View.
const ordinary = await runQueryFixture(variant(`return { run() { throw new Error('not a query'); }, value: 3 };`)) as {value: number; run(): unknown};
assert.equal(ordinary.value, 3);
assert.equal(typeof ordinary.run, 'function');
assert.deepEqual(await runQueryFixture(variant('return view.from(rows).take(1);')), FIXTURE.rows.slice(0, 1));
assert.equal(FIXTURE.rows[0].amount, 2);
console.log('query materialization checks mutation after execution and does not invoke ordinary run fields');
