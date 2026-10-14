import { SCREEN_EXAMPLES } from './screen-examples';
import { LEARNING_EXAMPLES } from './learning-examples';
import { OTHER_EXAMPLES } from './examples-other';
import { UI } from './ui-samples';

/** R80/R38 — runnable examples. A sample on a page is a fragment; an example here is the
 *  fragment plus whatever scaffolding makes it run and make sense on its own. The REPL
 *  concatenates `setup` and `code`, so a reader can see and edit both. */
/** Which toolkit an example is written against. The REPL can run any of these
 *  in the reader's browser, so a comparison is executable rather than asserted:
 *  the same task, side by side, both actually running. */
export type Tech = 'state' | 'react' | 'zustand' | 'valtio' | 'immer' | 'vanilla';

export const TECH_LABEL: Record<Tech, string> = {
  state: 'state',
  react: 'useState',
  zustand: 'Zustand',
  valtio: 'Valtio',
  immer: 'Immer',
  vanilla: 'plain JS',
};

/** A task is a job a reader recognises. Several examples can answer it, one per
 *  toolkit, which is what makes the compare view possible. */
export type Task = {
  id: string;
  title: string;
  /** Why this task is worth comparing at all. */
  about: string;
};

export const TASKS: Task[] = [
  {
    id: 'screen',
    title: 'Build a complete React screen',
    about:
      'One checklist, the same interactions, different store APIs. Start with a screen, not individual signal primitives.',
  },
  {
    id: 'basics',
    title: 'A write: snapshot, change record, intent',
    about:
      'Three views of one named action: resulting state, forward/inverse patches, and the action name supplied by the author.',
  },
  {
    id: 'derived',
    title: 'Derived values',
    about: 'A value computed from other values: how much of the memoisation is yours to get right.',
  },
  {
    id: 'lists',
    title: 'Lists and per-item updates',
    about: 'One item changes. How much work does the toolkit do, and how much does the UI redo?',
  },
  {
    id: 'history',
    title: 'Undo and time travel',
    about: 'Walking backwards. Whether it is a mechanism you already have or a library you add.',
  },
  {
    id: 'async',
    title: 'Async, cancellation and races',
    about: 'The request that outlives the screen, and the keystroke that starts six of them.',
  },
  {
    id: 'boundaries',
    title: 'Data at the boundaries',
    about: 'Serialising outward, presenting inward, and not corrupting either on the way.',
  },
  {
    id: 'reactivity',
    title: 'Reactivity and batching',
    about: 'Lazy computations, eager subscribers, intermediate reads and transaction boundaries.',
  },
  {
    id: 'regions',
    title: 'Regions and lifetime',
    about: 'Which data belongs to this view, session, draft or durable domain?',
  },
  {
    id: 'persistence',
    title: 'Persistence',
    about: 'Which representation is retained and restored? Separate from synchronisation and optimism.',
  },
  {
    id: 'optimism',
    title: 'Optimistic state',
    about: 'Pending intent overlays confirmed data; acknowledgement or rejection resolves it.',
  },
  {
    id: 'sync',
    title: 'Read synchronisation',
    about: 'Snapshots, deltas, reconnect and refetch: six interactive models and a real HTTP reader.',
  },
];

export type Example = {
  id: string;
  /** Which task this answers, for the compare view. Optional: some examples are
   *  about a mechanism rather than a job. */
  task?: string;
  /** Which toolkit it is written against. Defaults to `state`. */
  tech?: Tech;
  title: string;
  /** A two-or-three-word label, for a chip that has to distinguish two examples
   *  from the same toolkit under one task. Falls back to the title. */
  short?: string;
  /** Why this example exists — shown above the editor. */
  about: string;
  /** Scaffolding: the store, the data, the helpers. Editable, but usually left alone. */
  setup: string;
  /** The part the page was actually showing. This is where a reader experiments. */
  code: string;
  /**
   * A UI for the example, as JSX that evaluates to a React element (R38). It
   * is transpiled in the browser and mounted next to the output, against the
   * same store the code above printed from — so clicking it changes what the
   * output shows. `React`, the hooks, and everything in `setup`/`code` are in
   * scope. Optional: a mechanism example needs none; a task example should have
   * one, because the reader's question is "what does this look like in a
   * component", and a log line does not answer it.
   */
  ui?: string;
};

export const STATE_EXAMPLES: Example[] = [
  // Not first anymore: EXAMPLES prepends SCREEN_EXAMPLES, so bare /repl lands
  // on task-screen and the front page opens with that claim. Kept order below
  // is the suggested reading order within the state basics.
  {
    id: 'read-write',
    short: 'one write',
    task: 'basics',
    tech: 'state',
    title: 'A write: snapshot, change record, intent',
    about:
      'One named action has three useful views: a detached snapshot, a change record (forward + inverse patches), and the command name explicitly supplied by you. These are three categories, not three log lines or three writes. This prototype copies snapshots; it does not demonstrate production structural sharing.',
    setup: `const store = createStore({
  items: { 1: { id: 1, text: 'buy milk', done: false },
           2: { id: 2, text: 'call Danny', done: false } },
})`,
    code: `// read — a derived value subscribes to exactly the paths it read,
// and to nothing else. Writing elsewhere will not recompute it.
// (read store.state, not store.snapshot(): the proxy is what records the read.
//  A snapshot is a plain object and tells the graph nothing.)
const left = derive(() =>
  Object.values(store.state.items).filter(i => !i.done).length)
log('left', left())

// write — mutable to type, immutable underneath
const toggle = store.action('todos.toggle',
  (s, id) => { s.items[id].done = !s.items[id].done })

toggle(1)

// Three views of the action; its name was declared above:
log('snapshot', store.snapshot())   // detached copy; previous snapshots stay valid
log('patch', store.log.at(-1).patches)   // and its inverse, which is undo
log('inverse', store.log.at(-1).inverse)
log('command', store.log.at(-1).name)    // the intent, not just the effect
log('left', left())                      // recomputed, because this path did change
// The prototype demonstrates undo/history. Sync/outbox integration is separate.`,
    ui: `// The same store, as a component. Each row reads its own item, so a
// toggle re-renders that row and nothing else — the counters prove it.
let listRenders = 0
const rowRenders = {}

function Row({ id }) {
  rowRenders[id] = (rowRenders[id] ?? 0) + 1
  const done = store.usePath('/items/' + id + '/done')
  const text = store.usePath('/items/' + id + '/text')
  return (
    <label className="rowd">
      <input type="checkbox" checked={done} onChange={() => toggle(id)} />
      {text} <span className="rc">{rowRenders[id]}</span>
    </label>
  )
}

function List() {
  listRenders++
  const items = store.usePath('/items')
  return (
    <div>
      <div className="demo-head">list <span className="rc">{listRenders}</span></div>
      {Object.keys(items).map((id) => <Row key={id} id={id} />)}
    </div>
  )
}
return <List />`,
  },
  {
    id: 'queries',
    short: 'query vs pyramid',
    task: 'derived',
    tech: 'state',
    title: 'A selector pyramid, and the query that replaces it',
    about:
      'The gnarliest code in a Redux-era application is the derived-data layer: chains of hand-memoised selectors, each depending on the last, each needing its own tests and its own equality reasoning. Below, the same filter-sort-group written both ways against the same data, with counters showing how much each recomputes. The declarative query layer (R32) is designed and not built — the Datalog form is printed rather than run, and clearly labelled. What DOES run is the incremental primitive underneath it.',
    setup: `// A hundred rows, three slices worth of state, one question:
// "open tasks, by assignee's team, newest first".
const rows = {}
const ids = []
const teams = { u1: 'core', u2: 'core', u3: 'infra' }
for (let i = 0; i < 100; i++) {
  const id = 'r' + i
  ids.push(id)
  rows[id] = { id, done: i % 3 === 0, assignee: 'u' + ((i % 3) + 1), at: i }
}
const store = createStore({ tasks: { ids, byId: rows }, filter: 'open' })
const setDone = store.action('tasks.setDone', (s, id, v) => { s.tasks.byId[id].done = v })

// how often each approach actually did the work
let selectorRuns = 0`,
    code: `// --- the pyramid: three memoised layers, recomputed as a unit
const pyramid = () => {
  selectorRuns++
  const all = Object.values(store.snapshot().tasks.byId)
  const visible = all.filter(t => !t.done)                 // layer 1
  const sorted = [...visible].sort((a, b) => b.at - a.at)  // layer 2
  const grouped = {}                                       // layer 3
  for (const t of sorted) (grouped[teams[t.assignee]] ??= []).push(t.id)
  return grouped
}
const grouped = pyramid()
log('pyramid', Object.entries(grouped).map(([k, v]) => k + '=' + v.length).join(' '))
log('the whole chain ran', selectorRuns, 'time(s) — and re-runs on any write to the slice')

// --- the incremental primitive: built once, then repaired from patches
const open = deriveCollection(store, '/tasks/byId', {
  filter: t => !t.done,
  sort: (a, b) => b.at - a.at,
})
log('incremental', open.ids.get().length, 'open · repairs so far:', open.repairs)

setDone('r1', true)          // one item changes
log('after one write  ', open.ids.get().length, 'open · repairs:', open.repairs)
store.action('touch', s => { s.filter = 'open' })()   // an unrelated write
log('after unrelated  ', open.ids.get().length, 'open · repairs:', open.repairs)
log('note', 'the unrelated write cost nothing; the pyramid would have re-run all three layers')

// --- and the shape it is heading for (R32 — designed, not running here)
log('planned', \`[:find ?team (count ?t)
 :where [?t :task/done false]
        [?t :task/assignee ?u]
        [?u :user/team ?team]]\`)`,
  },
  {
    id: 'cancellation',
    short: 'cancel a scope',
    task: 'async',
    tech: 'state',
    title: 'Cancel a scope, and the work actually stops',
    about:
      'A transaction is instantaneous and has nothing to cancel; a task is the asynchronous thing that has a status, a duration, children and a cancel button. Here a route scope holds three requests, one of which spawned a child of its own. Ending the scope — what happens when the user navigates away — aborts every one of them, runs their cleanup in reverse order, and reports why. Try changing `route.end()` to `search.cancel()` and watch only that subtree go. A scope is not tied to any router: it is a plain object with a lifetime, and an adapter opens one per route and ends it on leave — the same twelve lines against React Router, TanStack Router, Vue Router or a hand-rolled one, because all any of them has to do is call scope.end(). The ctx a task body receives carries signal (hand it to fetch), reason() for why it was cancelled, progress(), spawn(), all(), race(), shield() and onCancel(). Hover any of them in the editor.',
    setup: `// Stands in for fetch: a wait that honours the signal it is given.
const request = (name, ms) => async (ctx) => {
  ctx.onCancel(() => log('cleanup', name))
  await delay(ms, ctx.signal)
  log('finished', name)
  return name
}`,
    code: `const route = createScope('route:/products')

const search = route.run('search', async (ctx) => {
  // One intent can fan out. The children are cancelled with the parent.
  const facets = ctx.spawn('facets', request('facets', 300))
  const rows = ctx.spawn('rows', request('rows', 400))
  return ctx.all([facets, rows])
})
const banner = route.run('banner', request('banner', 500))

log('pending?', route.pending())

// The user navigates away 100 ms in.
await delay(100)
route.end()
await Promise.all([search.settled, banner.settled])

log('search', search.status(), '·', search.error()?.reason)
log('banner', banner.status(), '·', banner.error()?.reason)
log('still pending?', route.pending())
log('note', 'no "finished" line above — the work stopped, the results were not merely discarded')`,
  },
  {
    id: 'latest',
    short: 'latest wins',
    task: 'async',
    tech: 'state',
    title: 'takeLatest, without the saga',
    about:
      'Two different mechanisms that a search box needs together and that must not be merged. Debounce decides whether a task starts at all — pure timing, no task exists yet. `policy: latest` decides what happens when a new run begins while a previous one is still in flight. Unify them and you get both bug reports: "why does my debounce cancel my requests" and "why does my latest-wins delay my typing".',
    setup: `const scope = createScope('route:/search')
const search = (q, ms) =>
  scope.run('search', async (ctx) => {
    await delay(ms, ctx.signal)
    log('resolved', q)
    return q
  }, { policy: 'latest' })`,
    code: `// Three keystrokes. The first two are still in flight when the next arrives.
const a = search('ca', 200)
await delay(20)
const b = search('cat', 200)
await delay(20)
const c = search('cats', 50)

await Promise.all([a.settled, b.settled, c.settled])

log('ca  ', a.status(), '·', a.error()?.reason)
log('cat ', b.status(), '·', b.error()?.reason)
log('cats', c.status(), '·', c.result())
log('note', 'only the last request resolved — the earlier two were aborted, not ignored on arrival')`,
  },
  {
    id: 'conversion',
    short: 'conversion',
    task: 'boundaries',
    tech: 'state',
    title: 'One value, three representations',
    about:
      'Boundary conversion applies to dates, money, units, enums and structured documents. This example uses a Date in the store, an ISO string on the wire, and a locale-dependent string in the view. The temptation is one encode/decode pair for both boundaries. Take it and a German user\u2019s saved record holds "1.234,56" where an English user\u2019s holds "1,234.56" — not a formatting bug but corruption that survives a reload. So: one declaration site, two contracts. The codec is total and takes no locale; the presenter is reactive and takes nothing else seriously. Change the locale below and watch only the presented string move.',
    setup: `const locale = signal('en-GB')
const placedAt = signal(new Date('2026-09-04T11:22:33Z'))
const ctx = () => ({ locale: locale.get(), timeZone: 'UTC' })`,
    code: `// --- the wire boundary: fidelity. decode(encode(v)) === v, no ambient input.
const wire = DateType.codec.encode(placedAt.get())
log('on the wire', wire)
log('round-trips exactly', DateType.codec.decode(wire).getTime() === placedAt.peek().getTime())

// --- the view boundary: lossy on purpose, and reactive.
const shown = presented(() => placedAt.get(), DateType, ctx)
log('en-GB', shown())
locale.set('de-DE')
log('de-DE', shown(), '— same value, the string recomputed')
log('the wire did not move', DateType.codec.encode(placedAt.peek()) === wire)

// --- and inward: a parse failure is state, because the person is still typing.
const f = field(placedAt.peek(), DateType, ctx)
f.input('2026-09-0')
log('typed', f.text(), '| error:', f.error(), '| last good value survived:', f.value().toISOString())
f.input('2026-12-25')
log('valid now', f.text(), '| error:', f.error())
f.commit()
log('committed and canonicalised', f.text())`,
  },
  {
    id: 'undo',
    short: 'undo',
    task: 'history',
    tech: 'state',
    title: 'Undo is applying the inverse',
    about:
      'No snapshots are stored. Undo walks one transaction backwards by applying the patches that reverse it, which is why it costs the size of the change and not the size of the state. Try adding more writes before the undo.',
    setup: `const store = createStore({ n: 0, label: 'start' })
const setN = store.action('setN', (s, v) => { s.n = v })
const setLabel = store.action('setLabel', (s, v) => { s.label = v })`,
    code: `setN(1); setN(2); setLabel('after')
log('now', store.snapshot())

store.undo()
log('one undo', store.snapshot())

store.undo(); store.undo()
log('back to the start', store.snapshot())

store.redo()
log('and forward again', store.snapshot())`,
    ui: UI.undo,
  },
  {
    id: 'derived',
    short: 'derived view',
    task: 'lists',
    tech: 'state',
    title: 'A derived view maintained from patches',
    about:
      'The view is built once. After that a write does not re-run filter or sort — it reads the patches of the committed transaction and repairs only the items they touched. `repairs` counts how many times that happened; note it does not grow when you write somewhere else.',
    setup: `const rows = {}
for (let i = 0; i < 8; i++) rows['r' + i] = { id: 'r' + i, open: i % 3 !== 0, prio: (i * 37) % 100 }
const store = createStore({ rows, unrelated: 0 })
const flip = store.action('flip', (s, id) => { s.rows[id].open = !s.rows[id].open })
const bump = store.action('bump', (s) => { s.unrelated = s.unrelated + 1 })`,
    code: `const view = deriveCollection(store, '/rows', {
  filter: (r) => r.open,
  sort: (a, b) => a.prio - b.prio,
})
log('open rows, by priority', view.ids.peek())

flip('r0')
log('after opening r0', view.ids.peek(), 'repairs:', view.repairs)

bump()
log('an unrelated write repairs nothing —', 'repairs:', view.repairs)`,
  },
  {
    id: 'optimistic',
    short: 'optimistic',
    task: 'optimism',
    tech: 'state',
    title: 'Optimistic write, and a server that says no',
    about:
      'The write lands immediately and is marked in flight. When the server rejects it, the rollback applies the very same inverse patches undo applies — there is no second mechanism. The log keeps both transactions, so it still says what the user actually saw.',
    setup: `const store = createStore({ title: 'original' })
const rename = store.optimistic(
  'rename',
  (s, v) => { s.title = v },
  () => new Promise((_ok, no) => setTimeout(() => no(new Error('server said no')), 400)),
)`,
    code: `log('before', store.snapshot().title)

rename('optimistic value').catch(() => {})

// The UI already shows the new value — no await, no spinner state to invent.
log('immediately', store.snapshot().title, '· in flight:', store.pending)

await sleep(600)   // the server takes 400ms to say no

log('after the rejection', store.snapshot().title, '· in flight:', store.pending)
log('rolled back by', store.log.at(-1).patches)
log('which is exactly the inverse of', store.log.at(-2).patches)
log('and the log kept both', store.log.map((t) => t.name))
log('note', 'no refetch, no reload — the write recorded its own undo when it happened')`,
  },
  {
    id: 'derive',
    short: 'derived values',
    task: 'derived',
    tech: 'state',
    title: 'Where selectors went',
    about:
      'A derivation is lazy and cached: the body does not run until something reads it, and it re-runs only after a signal it actually read has changed. The dependency list is discovered, not written — which is the whole difference from a memoised selector, where a person writes the list and can therefore get it wrong. Watch the run counter: writing something the derivation did not read costs nothing.',
    setup: `const price = signal(100)
const qty   = signal(2)
const unrelated = signal('nothing to do with the total')

let runs = 0
const total = derive(() => { runs++; return price.get() * qty.get() })`,
    code: `log('declared, not yet run. runs =', runs)

log('read →', total(), '· runs =', runs)
log('read again →', total(), '· runs =', runs, '(cached)')

unrelated.set('still nothing')
log('')
log('wrote something it never read → runs =', runs)

qty.set(3)
log('wrote qty — marked, but not recomputed → runs =', runs)
log('now read →', total(), '· runs =', runs)

// A dependency it stops reading stops mattering.
const useQty = signal(true)
const smart = derive(() => (useQty.get() ? qty.get() : 0))
log('')
log('branching derivation →', smart())
useQty.set(false)
log('branch switched →', smart(), '— it no longer tracks qty at all')`,
  },
  {
    id: 'collection',
    short: 'collections',
    task: 'lists',
    tech: 'state',
    title: 'One item changes, one row wakes',
    about:
      'A collection is ids + byId, and that split is the whole mechanism: the list reads the order, each row reads its own item, so changing one row does not touch the list or its siblings. The counters below are real subscriptions, not a diagram. Try toggling a different row, or inserting one, and watch which counters move.',
    setup: `const store = createStore({
  todos: {
    ids: ['a', 'b', 'c'],
    byId: {
      a: { id: 'a', text: 'buy milk',   done: false },
      b: { id: 'b', text: 'call Danny', done: false },
      c: { id: 'c', text: 'ship it',    done: true
  },
    },
  },
})
const todos = store.collection('/todos', { key: 'id' })

// count what each subscription actually receives
const wakes = { ids: 0, a: 0, b: 0, c: 0 }
store.subscribePath('/todos/ids', () => { wakes.ids++ })
for (const id of ['a', 'b', 'c']) store.subscribePath('/todos/byId/' + id, () => { wakes[id]++ })`,
    code: `const toggle = store.action('todos.toggle', (s, id) => {
  s.todos.byId[id].done = !s.todos.byId[id].done
})

toggle('a')
log('after toggling a:', wakes)
log('→ only a woke. b, c and the list order did not.')

todos.insert({ id: 'd', text: 'a new one', done: false })
log('')
log('after inserting d:', wakes)
log('→ the order woke, because the order changed. The rows did not.')
log('ids now:', todos.ids)`,
    ui: `// Every row subscribes to its own item. Toggle one and watch which
// counters move: the list does not re-render, the siblings do not either.
let listRenders = 0
const rowRenders = {}

function Row({ id }) {
  rowRenders[id] = (rowRenders[id] ?? 0) + 1
  const done = store.usePath('/todos/byId/' + id + '/done')
  const text = store.usePath('/todos/byId/' + id + '/text')
  return (
    <label className="rowd">
      <input type="checkbox" checked={done} onChange={() => toggle(id)} />
      {text} <span className="rc">{rowRenders[id]}</span>
    </label>
  )
}

function List() {
  listRenders++
  const ids = store.usePath('/todos/ids')
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
    id: 'regions',
    short: 'regions',
    task: 'regions',
    tech: 'state',
    title: 'Declare lifetime next to the data',
    about:
      'region.view/session/draft/domain attach policy defaults next to the initial data. The markers are stripped from the stored values. Here persistence reads those defaults; tags alone do not enable storage or sync. See the Concepts and Learning prior-art links; the four labels are our composition, not a claimed invention of state lifetime.',
    setup: `const disk = storageAdapter(memoryStorage())

const store = createStore(
  { order: region.domain({ total: 0 }),
    ui: region.view({ panelOpen: false }),
    session: region.session({ token: 'example-only' }),
    draft: region.draft({ note: '' }) },
)
const buy    = store.action('buy',    (s) => { s.order.total = 100 })
const toggle = store.action('toggle', (s) => { s.ui.panelOpen = true })
const login  = store.action('login',  (s) => { s.session.token = 'rotated' })
const type   = store.action('type',   (s) => { s.draft.note = 'half a sentence' })`,
    code: `const saved = store.persist(disk)   // no include, no exclude — the regions decide

buy(); toggle(); login(); type()

log('four writes, but only these paths were stored:')
log(disk.read().map((p) => p.path))
log('commits that reached the disk:', saved.writes, 'of 4')

log('')
log('why: the region each path belongs to')
for (const path of ['/order/total', '/ui/panelOpen', '/session/token', '/draft/note']) {
  const region = store.regionOf(path)
  log(path, '→', region, '·', REGION_POLICY[region].note)
}`,
  },
  {
    id: 'transient',
    short: 'keystrokes',
    task: 'lists',
    tech: 'state',
    title: 'Every keystroke is state, and it is still free',
    about:
      'A transient write updates its subscriber immediately but coalesces into one patch per animation frame, and never enters the command log. This is the mechanism that makes "all state is global" affordable — the thing redux-form got wrong.',
    setup: `const store = createStore({ query: '' })`,
    code: `for (const ch of 'hello') store.setTransient('/query', store.raw.query + ch)
log('value is current immediately:', store.raw.query)

await sleep(50)   // let the frame close
log('but the log holds one coalesced entry, not five:')
log(store.log.map((t) => t.name + ' · ' + t.patches.length + ' patch(es)'))`,
    ui: `// The input writes on every keystroke, and only its own subscriber
// re-renders. Type, then look at the transaction log: one coalesced entry.
let renders = 0
function Search() {
  renders++
  const q = store.usePath('/query')
  return (
    <div>
      <input className="pg-input" value={q ?? ''} placeholder="type here…"
        onChange={(e) => store.setTransient('/query', e.target.value)} />
      <div className="lnote">value: “{q}” · renders <span className="rc">{renders}</span></div>
    </div>
  )
}
return <Search />`,
  },
  {
    id: 'adapter-react',
    task: 'basics',
    title: 'React native hook versus prototype path hook',
    short: 'adapter ownership',
    tech: 'state',
    about:
      'useSyncExternalStore is native React. signal/createStore/store.usePath are the site prototype. Both buttons update the same named store action. No planned useSlice package is implied.',
    setup: `const store = createStore({count:0})
const count = signal(0)
const increment = store.action('counter.increment', s => { s.count++ })
const stop = store.subscribePath('/count', () => count.set(store.state.count))`,
    code: `// The UI below labels native React and prototype-owned APIs.
// A scalar getter is stable; store.snapshot() clones and is NOT a cached object getter.
increment()
log('count', count.get())
log('command', store.log.at(-1).name)`,
    ui: `function NativeCounter() {
  const value = React.useSyncExternalStore(
    notify => count.subscribe(notify),
    () => count.get(),
    () => 0
  )
  return <button onClick={increment}>Native React useSyncExternalStore: {value}</button>
}
function PrototypeCounter() {
  const value = store.usePath('/count')
  return <button onClick={increment}>Prototype store.usePath: {value}</button>
}
return <div><NativeCounter /><PrototypeCounter /></div>`,
  },

  {
    id: 'lifecycle',
    task: 'async',
    tech: 'state',
    short: 'unsubscribe',
    title: 'Disconnect a subscription on purpose',
    about:
      'Watch the source keep changing after its reader disconnects. This is the prototype watch unsubscribe function, not a claim that every dispose signature shares this API.',
    setup: `const source = signal(0)
const observed = signal(0)
const connected = signal(false)
let stop = () => {}
const disconnect = () => { stop(); connected.set(false) }
const connect = () => {
  disconnect()
  stop = watch(() => observed.set(source.get()))
  connected.set(true)
}
const increment = () => source.set(source.get() + 1)`,
    code: `// Connect a reader to the source. Its value follows while the watcher is active.
connect()
// Use Disconnect in the UI, then increment again. The source continues; the reader stays put.
log('connected reader', observed.get())`,
    ui: `function useValue(value) {
  return React.useSyncExternalStore(listener => value.subscribe(listener), () => value.get(), () => value.get())
}
function LifecycleDemo() {
  const count = useValue(source)
  const lastSeen = useValue(observed)
  const listening = useValue(connected)
  React.useEffect(() => () => disconnect(), [])
  return <div className="lifecycle-demo">
    <div className="lifecycle-values"><div>Source<strong data-lifecycle-source>{count}</strong></div><span aria-hidden="true">{listening ? '→' : '×'}</span><div>Reader<strong data-lifecycle-reader>{lastSeen}</strong></div></div>
    <p role="status">{listening ? 'Connected: the reader follows the source.' : 'Disconnected: only the source changes.'}</p>
    <button onClick={increment}>Increment source</button>
    <button onClick={listening ? disconnect : connect}>{listening ? 'Disconnect reader' : 'Reconnect reader'}</button>
  </div>
}
return <LifecycleDemo />`,
  },
];

export const exampleById = (id: string) => EXAMPLES.find((e) => e.id === id);

/** Everything the REPL can run: ours, plus the same tasks written against the
 *  other toolkits so the comparison is executable rather than asserted. */
export const EXAMPLES: Example[] = [...SCREEN_EXAMPLES, ...STATE_EXAMPLES, ...LEARNING_EXAMPLES, ...OTHER_EXAMPLES];

export const techOf = (e: Example): Tech => e.tech ?? 'state';

/** The examples answering one task, ours always first. */
export function examplesForTask(task: string): Example[] {
  return EXAMPLES.filter((e) => e.task === task).sort((a, b) =>
    techOf(a) === 'state' ? -1 : techOf(b) === 'state' ? 1 : 0,
  );
}

/** Tasks that have something to compare — more than one toolkit answers them. */
export const COMPARABLE = new Set(
  TASKS.filter((t) => new Set(examplesForTask(t.id).map(techOf)).size > 1).map((t) => t.id),
);
