import { createDocumentStore } from './fixture/src/core/document-store.mjs';
import { root } from './fixture/measure-root.mjs';
import { item } from './fixture/measure-item.mjs';
import { sparse } from './fixture/measure-sparse.mjs';
import { all } from './fixture/measure-all.mjs';
import { move } from './fixture/measure-move.mjs';
import { noop } from './fixture/measure-noop.mjs';
const generated = { root, item, sparse, all, move, noop };
const mutations = {
  root: (d, a) => {
    d.name = a.text;
  },
  item: (d, a) => {
    const row = d.boards[0].columns[a.column].items[0];
    row.done = !row.done;
  },
  sparse: (d, a) => {
    for (const col of d.boards[0].columns) for (let i = 0; i < col.items.length; i += 10) col.items[i].text = a.text;
  },
  all: (d, a) => {
    for (const col of d.boards[0].columns) for (const row of col.items) row.text = a.text;
  },
  move: (d, a) => {
    const from = d.boards[0].columns[a.column].items;
    if (!from.length) throw new RangeError('Missing source item');
    d.boards[0].columns[a.target].items.unshift(from.shift());
  },
  noop: () => {},
};
const fixture = (n) => ({
  schemaVersion: 1,
  name: 'Document',
  boards: [
    {
      id: 'b',
      columns: [
        {
          id: 'a',
          items: Array.from({ length: n }, (_, i) => ({
            id: String(i),
            text: 'Task ' + i,
            done: false,
            assignees: [],
          })),
        },
        { id: 'b', items: [] },
      ],
    },
  ],
});
const backends = ['baseline', 'state-lib', 'state-lib-cow', 'generated'];
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
export async function run() {
  const raw = [];
  let comparisons = 0;
  for (const count of [0, 1, 30, 1200, 10000])
    for (const operation of [...Object.keys(generated), 'history']) {
      const samples = Object.fromEntries(backends.map((name) => [name, []]));
      const iterations = count >= 10000 ? 4 : count >= 1200 ? 12 : count >= 30 ? 128 : 512;
      for (let trial = -3; trial < 9; trial++) {
        const outcomes = [];
        for (const backend of trial % 2 ? [...backends].reverse() : backends) {
          const store = createDocumentStore({
            backend: backend === 'generated' ? 'state-lib-cow' : backend,
            initial: fixture(count),
            limit: 40,
          });
          if (operation === 'history')
            store.change((d) => {
              d.name = 'History';
            });
          let failures = 0;
          const start = performance.now();
          for (let i = 0; i < iterations; i++) {
            if (operation === 'history') {
              if (!store.undo() || !store.redo()) throw Error('History failed');
              continue;
            }
            const column = store.read().boards[0].columns[0].items.length ? 0 : 1,
              args = { text: 'Edit ' + i, column, target: 1 - column };
            try {
              if (backend === 'generated') store.apply(generated[operation], args);
              else store.change((d) => mutations[operation](d, args));
            } catch (error) {
              if (count === 0 && (operation === 'item' || operation === 'move')) failures++;
              else throw error;
            }
          }
          const elapsed = (performance.now() - start) / iterations;
          if (failures !== (count === 0 && (operation === 'item' || operation === 'move') ? iterations : 0))
            throw Error('Unexpected failure count');
          if (trial >= 0) samples[backend].push(elapsed);
          outcomes.push(JSON.stringify(store.read()));
          store.dispose();
        }
        for (const output of outcomes.slice(1)) {
          if (output !== outcomes[0]) throw Error('State mismatch');
          comparisons++;
        }
      }
      for (const backend of backends)
        raw.push({
          count,
          operation,
          backend,
          iterations,
          samples: samples[backend],
          medianMs: median(samples[backend]),
        });
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  return {
    userAgent: navigator.userAgent,
    comparisons,
    raw,
    method:
      'Actual browser document-controller/Runtime/history; native-generated command functions. Nine alternating batches after three warmups. No DOM, network or initial import in operation timing; means within batches are not event percentiles.',
    limits: [
      'One page/engine exploratory run, not independent physical-device replications.',
      'Timer-limited zero values do not establish free work.',
      'A generated function is measured independently of automatic admission; unqualified cases are not silently selected in a release.',
    ],
  };
}
