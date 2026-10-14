/**
 * The same tasks, written against the other toolkits (R27, R38).
 *
 * These are not strawmen and must not become them: each is the idiomatic
 * version a competent user of that library would write, and each actually runs
 * in the reader's browser next to ours — Zustand, Valtio and Immer are real
 * dependencies of this site, not mocks. A comparison you can execute is worth
 * more than a table cell, because the reader can change it and watch the claim
 * survive or fail.
 *
 * Where a toolkit genuinely has no answer for a task, the example says so in
 * code rather than being omitted: the amount of hand-written machinery *is*
 * the comparison.
 */
import type { Example } from './examples';
import { UI } from './ui-samples';

export const OTHER_EXAMPLES: Example[] = [
  {
    id: 'react-basics',
    task: 'basics',
    tech: 'react',
    title: 'The same list, held in useState',
    about:
      'The baseline the front page promises: no library at all. The list lives in one useState at the top and is passed down, so a toggle replaces the array and every row re-renders — the counters show it. This is not a bad way to write a small list. It is the thing the per-row subscription in the state pane is measured against.',
    setup: `const seed = () => ({
  1: { id: 1, text: 'buy milk',   done: false },
  2: { id: 2, text: 'call Danny', done: false },
})`,
    code: `// There is no store: the component IS the state. Nothing to log until
// it mounts — press run, then click the checkboxes and watch the counters.
log('note', 'no snapshot, no patch, no command — a toggle produces a new array and a re-render')
log('note', 'with per-row subscriptions (the state pane) a toggle re-renders one row; here it re-renders all of them')`,
    ui: UI['react-basics'],
  },
  {
    id: 'zustand-basics',
    task: 'basics',
    tech: 'zustand',
    title: 'One write, and what you get',
    about:
      'The same toggle in Zustand. The write is explicit and immutable by hand, and it produces exactly one thing: a new state object. A patch, an inverse and a named command are all available in principle — through middleware you add, configure and keep in sync.',
    setup: `const store = zustand.createStore((set) => ({
  items: { 1: { id: 1, text: 'buy milk', done: false },
           2: { id: 2, text: 'call Danny', done: false } },
  toggle: (id) => set((s) => ({
    items: { ...s.items, [id]: { ...s.items[id], done: !s.items[id].done } },
  })),
}))`,
    code: `// read — a selector, and you own the equality argument
const left = () => Object.values(store.getState().items)
  .filter(i => !i.done).length
log('left', left())

// write
store.getState().toggle(1)

// what that produced:
log('snapshot', store.getState().items)
log('patch', 'none — you would add a middleware for that')
log('inverse', 'none — undo is a separate library (zundo)')
log('command', 'none — the action name is not recorded anywhere')
log('left', left())`,
    ui: `// The same list. Every row selects its own item — the idiomatic version —
// and the list selects the ids. Toggle one and count what re-rendered.
let listRenders = 0
const rowRenders = {}

function Row({ id }) {
  rowRenders[id] = (rowRenders[id] ?? 0) + 1
  const item = zustand.useStore(store, (s) => s.items[id])
  const toggle = zustand.useStore(store, (s) => s.toggle)
  return (
    <label className="rowd">
      <input type="checkbox" checked={item.done} onChange={() => toggle(id)} />
      {item.text} <span className="rc">{rowRenders[id]}</span>
    </label>
  )
}

function List() {
  listRenders++
  // Object.keys makes a new array on every call. Without useShallow that is
  // an infinite render loop (React #185), not merely an extra render — the
  // equality is yours to remember, every time.
  const ids = zustand.useStore(store, zustand.useShallow((s) => Object.keys(s.items)))
  return (
    <div>
      <div className="demo-head">list <span className="rc">{listRenders}</span></div>
      {ids.map((id) => <Row key={id} id={id} />)}
    </div>
  )
}
return <List />`,
  },
  {
    id: 'valtio-basics',
    task: 'basics',
    tech: 'valtio',
    title: 'A proxy, and a subscription',
    about:
      'Valtio is the closest ergonomic relative: you mutate a proxy and reads are tracked. What it does not give you is the record — the write leaves no patch, no inverse and no name, so undo, replication and a replayable session are each somebody else’s problem.',
    setup: `const state = valtio.proxy({
  items: { 1: { id: 1, text: 'buy milk', done: false },
           2: { id: 2, text: 'call Danny', done: false } },
})
const seen = []
valtio.subscribe(state, () => seen.push(valtio.snapshot(state)))`,
    code: `// read — snapshot() for a stable value, the proxy for tracking
const left = () => Object.values(valtio.snapshot(state).items)
  .filter(i => !i.done).length
log('left', left())

// write — mutable, like ours
state.items[1].done = !state.items[1].done
await sleep(0)   // valtio notifies on a microtask

log('snapshot', valtio.snapshot(state).items)
log('notifications', seen.length)
log('patch', 'none — subscribe tells you THAT it changed, not what to')
log('command', 'none')
log('left', left())`,
    ui: `// useSnapshot tracks which properties a render read, so a row that reads
// only its own item re-renders only for it — the closest relative of ours.
let listRenders = 0
const rowRenders = {}

function Row({ id }) {
  rowRenders[id] = (rowRenders[id] ?? 0) + 1
  const item = valtio.useSnapshot(state.items[id])
  return (
    <label className="rowd">
      <input type="checkbox" checked={item.done}
        onChange={() => { state.items[id].done = !state.items[id].done }} />
      {item.text} <span className="rc">{rowRenders[id]}</span>
    </label>
  )
}

function List() {
  listRenders++
  const snap = valtio.useSnapshot(state)
  return (
    <div>
      <div className="demo-head">list <span className="rc">{listRenders}</span></div>
      {Object.keys(snap.items).map((id) => <Row key={id} id={id} />)}
    </div>
  )
}
return <List />`,
  },
  {
    id: 'immer-basics',
    task: 'basics',
    tech: 'immer',
    title: 'Patches, if you ask for them',
    about:
      'Immer is where the patch half of our transaction comes from, and it is worth seeing on its own: produceWithPatches gives you the forward and inverse patches for a mutation. What it is not is a store — there is no subscription, no path-level reactivity and no log; wiring those together is the work.',
    setup: `immer.enablePatches()
let items = { 1: { id: 1, text: 'buy milk', done: false },
              2: { id: 2, text: 'call Danny', done: false } }`,
    code: `const [next, patches, inverse] = immer.produceWithPatches(items, (d) => {
  d[1].done = !d[1].done
})
items = next

log('snapshot', items)
log('patch', patches)
log('inverse', inverse)
log('command', 'none — produce does not know why you called it')

// undo, by hand:
items = immer.applyPatches(items, inverse)
log('after undo', items)`,
  },
  {
    id: 'zustand-derived',
    task: 'derived',
    tech: 'zustand',
    title: 'Derived values, memoised by you',
    about:
      'A derived value in Zustand is a selector, and a selector that returns a new object re-renders every subscriber on every change unless you supply an equality function or memoise it yourself. The counter below shows how often the computation actually ran.',
    setup: `let computed = 0
const store = zustand.createStore((set) => ({
  items: [{ id: 1, done: false }, { id: 2, done: true }, { id: 3, done: false }],
  other: 'untouched',
  toggle: (i) => set((s) => ({
    items: s.items.map((it, n) => n === i ? { ...it, done: !it.done } : it),
  })),
  touch: () => set({ other: String(Math.random()) }),
}))
const openCount = () => { computed++
  return store.getState().items.filter(i => !i.done).length }`,
    code: `log('open', openCount(), '· computed', computed, 'time(s)')

store.getState().touch()      // an unrelated write
log('open', openCount(), '· computed', computed, 'time(s)')
log('note', 'it recomputed, though nothing it reads had changed —')
log('    ', 'the selector has no idea which paths it depends on')

store.getState().toggle(0)
log('open', openCount(), '· computed', computed, 'time(s)')`,
  },
  {
    id: 'vanilla-async',
    task: 'async',
    tech: 'vanilla',
    title: 'Cancelling by hand',
    about:
      'What every application writes when the toolkit has nothing to say about async: an AbortController per request, threaded by hand, remembered on every path out. This is the version the cancellation example replaces — count the lines that exist only to clean up.',
    setup: `const request = (name, ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(() => res(name), ms)
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')) })
})`,
    code: `// you own the controller, its lifetime, and every teardown path
const ac = new AbortController()
const inflight = []

for (const [name, ms] of [['facets', 300], ['rows', 400], ['banner', 500]]) {
  inflight.push(
    request(name, ms, ac.signal)
      .then(n => log('finished', n))
      .catch(e => log('stopped', name, '·', e.message)),
  )
}

// the user navigates away 100 ms in
await sleep(100)
ac.abort()
await Promise.all(inflight)

log('note', 'this works — and it is three lines of bookkeeping per screen,')
log('    ', 'repeated in every component, forgotten in one of them')`,
  },
  {
    id: 'zustand-history',
    task: 'history',
    tech: 'zustand',
    title: 'Undo by keeping copies',
    about:
      'Undo without patches means undo by snapshot: keep the previous states and swap one back. It is simple and it works, and its cost is the size of the state rather than the size of the change — which is exactly the trade the patch log exists to avoid.',
    setup: `const past = []
const store = zustand.createStore((set, get) => ({
  n: 0, label: 'start',
  set: (patch) => { past.push({ ...get() }); set(patch) },
  undo: () => { const p = past.pop(); if (p) set(p) },
}))`,
    code: `const s = store.getState()
s.set({ n: 1 }); s.set({ n: 2 }); s.set({ label: 'after' })
log('now', { n: store.getState().n, label: store.getState().label })
log('kept', past.length, 'full copies of the state')

store.getState().undo()
log('one undo', { n: store.getState().n, label: store.getState().label })
log('note', 'each entry is the whole state, not the change —')
log('    ', 'a 10k-row list costs a 10k-row copy per keystroke')`,
  },
];
