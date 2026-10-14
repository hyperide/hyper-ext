/** Correctness of the patch-driven derived collection: it must agree with a full recompute,
 *  always, including after undo. tsx tools/proto-derive.check.mts */
import { createStore, deriveCollection } from '../src/lib/proto';

type Row = { id: string; open: boolean; prio: number };
let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
  );
};

const N = 400;
const seed: Record<string, Row> = {};
for (let i = 0; i < N; i++) seed[`r${i}`] = { id: `r${i}`, open: i % 3 !== 0, prio: (i * 37) % 100 };

const store = createStore({ rows: seed });
const byPrio = (a: Row, b: Row) => a.prio - b.prio;
const view = deriveCollection<Row>(store, '/rows', { filter: (r) => r.open, sort: byPrio });

/** The answer the view must always equal. */
const truth = () =>
  Object.values(store.raw.rows as Record<string, Row>)
    .filter((r) => r.open)
    .sort((a, b) => byPrio(a, b) || (a.id < b.id ? -1 : 1))
    .map((r) => r.id);

eq('initial view equals a full recompute', view.ids.peek(), truth());

const flip = store.action('flip', (s, id: string) => {
  s.rows[id].open = !s.rows[id].open;
});
const reprio = store.action('reprio', (s, id: string, p: number) => {
  s.rows[id].prio = p;
});

for (let k = 0; k < 200; k++) flip(`r${(k * 97) % N}`);
eq('after 200 membership flips', view.ids.peek(), truth());

for (let k = 0; k < 200; k++) reprio(`r${(k * 53) % N}`, (k * 71) % 100);
eq('after 200 re-sorts', view.ids.peek(), truth());

eq('it repaired rather than recomputed', view.repairs, 400);

// Undo must move the view too — a history write is a real change.
const before = view.ids.peek().slice();
flip('r7');
const afterFlip = view.ids.peek().slice();
eq('a flip moved the view', JSON.stringify(before) !== JSON.stringify(afterFlip), true);
store.undo();
eq('undo puts the view back', view.ids.peek(), before);
eq('and it still agrees with a recompute', view.ids.peek(), truth());

// A write to an unrelated path must not touch the view at all.
const store2 = createStore({ rows: { a: { id: 'a', open: true, prio: 1 } }, other: 0 });
const v2 = deriveCollection<Row>(store2, '/rows', { filter: (r) => r.open });
store2.action('bump', (s) => {
  s.other = s.other + 1;
})();
eq('an unrelated write causes no repair', v2.repairs, 0);

// Adding and removing members.
const add = store.action('add', (s, id: string, prio: number) => {
  s.rows[id] = { id, open: true, prio };
});
add('zz', 50);
eq('an inserted row appears in sort position', view.ids.peek(), truth());

// Primitive property access must preserve the receiver observed by inherited getters.
const property = '__stateLintRecords';
const original = Object.getOwnPropertyDescriptor(String.prototype, property);
const originalFrame = globalThis.requestAnimationFrame;
let receiverType = '';
let setterObservation: { receiver: unknown; value: unknown } | undefined;
Object.defineProperty(String.prototype, property, {
  configurable: true,
  get() {
    receiverType = typeof this;
    return { a: { n: 1 } };
  },
  set(value: unknown) {
    setterObservation = { receiver: this, value };
  },
});
globalThis.requestAnimationFrame = (callback) => {
  callback(0);
  return 0;
};
try {
  const textStore = createStore({ text: 'hello' });
  const primitiveView = deriveCollection<{ n: number }>(textStore, `/text/${property}`, {
    filter: (row) => row.n === 1,
  });
  eq('a primitive receiver remains primitive inside an inherited getter', receiverType, 'string');
  eq('a primitive inherited property still supplies the derived collection', primitiveView.ids.peek(), ['a']);
  primitiveView.dispose();
  textStore.setTransient(`/text/${property}`, 42);
  eq('a primitive receiver remains primitive inside an inherited setter', setterObservation?.receiver, 'hello');
  eq('the inherited setter receives the transient value', setterObservation?.value, 42);
} finally {
  if (originalFrame) globalThis.requestAnimationFrame = originalFrame;
  else Reflect.deleteProperty(globalThis, 'requestAnimationFrame');
  if (original) Object.defineProperty(String.prototype, property, original);
  else Reflect.deleteProperty(String.prototype, property);
}

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall assertions passed');
process.exit(failed ? 1 : 0);
