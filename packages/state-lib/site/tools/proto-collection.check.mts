/** A keyed collection: ids + byId, per-item notification, insert/remove/upsert as
 *  ordinary transactions (§4.5). The claim under test is the one on the Compare page —
 *  one item changes, one subscriber wakes. */
import { createStore, deriveCollection } from '../src/lib/proto';

type Row = { id: string; text: string; done: boolean };
let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${label}${ok ? '' : `\n       got  ${JSON.stringify(got)}\n       want ${JSON.stringify(want)}`}`,
  );
};

const byId: Record<string, Row> = {
  a: { id: 'a', text: 'one', done: false },
  b: { id: 'b', text: 'two', done: false },
};
const store = createStore({ todos: { ids: ['a', 'b'], byId } });
const todos = store.collection<Row>('/todos', { key: 'id' });

eq('reads the order', todos.ids, ['a', 'b']);
eq('reads an item', todos.get('a')?.text, 'one');
eq('reports size', todos.size, 2);

// --- per-item notification: the whole reason ids and byId are separate ---
let idsWakes = 0;
let aWakes = 0;
let bWakes = 0;
store.subscribePath('/todos/ids', () => {
  idsWakes++;
});
store.subscribePath('/todos/byId/a', () => {
  aWakes++;
});
store.subscribePath('/todos/byId/b', () => {
  bWakes++;
});

store.action('toggle', (s, id: string) => {
  s.todos.byId[id].done = !s.todos.byId[id].done;
})('a');
eq('changing item a wakes a', aWakes > 0, true);
eq('and does not wake b', bWakes, 0);
eq('and does not wake the list order', idsWakes, 0);

// --- insert and remove are ordinary transactions ---
const beforeLog = store.log.length;
todos.insert({ id: 'c', text: 'three', done: false });
eq('insert appends to the order', todos.ids, ['a', 'b', 'c']);
eq('insert is one transaction', store.log.length, beforeLog + 1);
eq('insert wakes the order', idsWakes > 0, true);

todos.insert({ id: 'z', text: 'first', done: false }, 0);
eq('insert at a position', todos.ids, ['z', 'a', 'b', 'c']);

todos.remove('b');
eq('remove drops it from the order', todos.ids, ['z', 'a', 'c']);
eq('and the item is gone', todos.get('b'), undefined);

// --- undo works, because they are ordinary transactions ---
store.undo();
eq('undo restores the removed item order', todos.ids, ['z', 'a', 'b', 'c']);
eq('and the item itself', todos.get('b')?.text, 'two');

// --- upsert both ways ---
todos.upsert('a', (prev) => ({ ...prev!, text: 'edited' }));
eq('upsert patches an existing item', todos.get('a')?.text, 'edited');
eq('without changing the order', todos.ids, ['z', 'a', 'b', 'c']);
todos.upsert('new', () => ({ id: 'new', text: 'fresh', done: false }));
eq('upsert inserts a missing one', todos.ids.includes('new'), true);

// --- a derived view over the collection repairs from the patches ---
const open = deriveCollection<Row>(store, '/todos/byId', { filter: (r) => !r.done });
const truth = () =>
  Object.entries(store.raw.todos.byId as Record<string, Row | undefined>)
    .filter(([, r]) => r && !r.done)
    .map(([k]) => k)
    .sort();
eq('derived view agrees with a recompute', [...open.ids.peek()].sort(), truth());
todos.upsert('z', (prev) => ({ ...prev!, done: true }));
eq('and after a collection write', [...open.ids.peek()].sort(), truth());

console.log(failed ? `\n${failed} assertion(s) failed` : '\nall assertions passed');
process.exit(failed ? 1 : 0);
