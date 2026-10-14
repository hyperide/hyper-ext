/** R27 — feature-by-feature comparison, grouped by category, most important first.
 *  Hovering a row opens a detail panel: how `state` does it, a code sketch, and why it wins. */

export type Lib = { id: string; name: string; note: string };
export const LIBS: Lib[] = [
  { id: 'state', name: 'state', note: 'this project — see the status tag on each row' },
  { id: 'zustand', name: 'Zustand', note: 'v5' },
  { id: 'rtk', name: 'Redux Toolkit', note: 'v2' },
  { id: 'jotai', name: 'Jotai', note: 'v2' },
  { id: 'valtio', name: 'Valtio', note: 'v2' },
  { id: 'mobx', name: 'MobX', note: 'v7 + keystone' },
  { id: 'legend', name: 'Legend-State', note: 'v3 beta' },
  { id: 'xstate', name: '@xstate/store', note: 'v4' },
];
export type Cell = [number, string];
export type Axis = {
  id: string;
  axis: string;
  status: 'designed' | 'prototyped' | 'planned';
  /** The REPL example that demonstrates this row, for the "see it live" link.
   *  Required on every `prototyped` row: a generic link to the playground lands
   *  the reader on whatever example happened to be showing, which is how
   *  "Mutable writes over immutable state · see it live" opened something else
   *  entirely. If a row is prototyped and has no example, it is not prototyped. */
  demo?: string;
  cells: Record<string, Cell>;
  ours: string;
  code?: string;
  why: string;
};
export type Cat = { name: string; axes: Axis[] };

export const CATS: Cat[] = [
  {
    name: 'Core ergonomics',
    axes: [
      {
        id: 'reads',
        demo: 'derive',
        axis: 'Reads without selectors or memoization',
        status: 'prototyped',
        cells: {
          state: [3, 'read = subscribe, precisely; derive() is lazy and cached — running'],
          zustand: [1, 'selectors + useShallow; stable refs are on you'],
          rtk: [0, 'reselect chains everywhere'],
          jotai: [2, 'per-atom reads'],
          valtio: [3, 'useSnapshot (React Compiler conflict)'],
          mobx: [3, 'observer (same conflict)'],
          legend: [3, 'use$ (same conflict)'],
          xstate: [1, 'store.select'],
        },
        ours: 'A component just reads values — `const t = useSlice(todos); t.filter` — and is subscribed to exactly the paths it read. No selector functions, no useMemo, no equality arguments. Under React Compiler the hook is designed to switch to returning stable snapshot references automatically, so nothing breaks (decision #12) — the prototype has the one tracked path and no mode detection yet.',
        code: `const t = useSlice(todos)\nreturn <span>{t.items.ids.length} left</span>\n// subscribed to /items/ids only — nothing else re-renders this`,
        why: 'Everyone else makes you choose: write selectors by hand (Zustand/RTK — busywork, easy stale-ref bugs) or track reads at render time and break under React Compiler (Valtio/MobX/Legend). We track reads but hand React stable snapshots — both halves, no trade.',
      },
      {
        id: 'writes',
        demo: 'read-write',
        axis: 'Mutable writes over immutable state',
        status: 'prototyped',
        cells: {
          state: [3, 'proxy writes in actions'],
          zustand: [1, 'immer middleware opt-in'],
          rtk: [2, 'immer in createSlice'],
          jotai: [1, 'produce() by hand'],
          valtio: [3, 'native'],
          mobx: [2, 'mutable; snapshots via keystone'],
          legend: [2, 'set()/assign'],
          xstate: [2, 'producer transitions'],
        },
        ours: "Write like it's mutable — `s.items[id].done = !s.items[id].done` — get immutable, structurally shared snapshots and an exact change record out.",
        code: `const toggle = store.action('todos.toggle',\n  (s, id) => { s.items[id].done = !s.items[id].done })`,
        why: 'Valtio proved the ergonomics; Immer proved the change tracking; nobody shipped both plus a named command log. One write gives you the snapshot, the patch, and the event — three things other stacks assemble from three libraries.',
      },
      {
        id: 'keystroke',
        demo: 'transient',
        axis: 'All state global — even per keystroke',
        status: 'prototyped',
        cells: {
          state: [3, 'transient nodes, coalesced, free'],
          zustand: [1, 'possible, all-log noise'],
          rtk: [0, 'the redux-form disaster'],
          jotai: [2, 'cheap atoms'],
          valtio: [2, 'cheap writes'],
          mobx: [2, 'cheap writes'],
          legend: [3, 'fine-grained'],
          xstate: [1, 'event per keystroke'],
        },
        ours: 'Every input, hover and drag lives in the store — visible to devtools, tests and recordings — but tagged transient: one subscriber re-renders, changes coalesce per frame, nothing pollutes the command log or persistence.',
        why: 'Global-everything failed before (redux-form) because the mechanism was wrong, not the idea — transient nodes borrow the name from Zustand’s "transient updates" and the coalescing semantics from Yjs, Loro and LiveStore. Per-path subscriptions + that coalescing make it free, and suddenly "reproduce the user’s exact session" includes every keystroke.',
      },
      {
        id: 'lists',
        demo: 'collection',
        axis: 'One item changes → one row re-renders',
        status: 'prototyped',
        cells: {
          state: [3, 'collections: ids + per-item nodes — running; insert/remove/upsert are ordinary transactions'],
          zustand: [1, 'careful per-row selectors'],
          rtk: [1, 'entityAdapter + memoized selectors'],
          jotai: [2, 'atomFamily'],
          valtio: [2, 'per-key proxies'],
          mobx: [2, 'observer rows'],
          legend: [3, '<For>'],
          xstate: [1, 'select per row'],
        },
        ours: 'Collections are ids + byId with a reactive node per item. The list renders from ids; each row subscribes to its own node. Click a checkbox in a 10 000-row table: one component reconciles.',
        why: 'Measurable on the Playground page right now — render counters show 1 row vs 6 components (useState) per click. Derived views consume diffs (enter/update/exit), never re-run the whole map.',
      },
      {
        id: 'binding',
        axis: 'Two-way control binding, zero glue',
        status: 'planned',
        cells: {
          state: [3, 'compiler-generated per control'],
          zustand: [0, 'value/onChange by hand'],
          rtk: [0, 'by hand'],
          jotai: [1, 'atom helpers'],
          valtio: [1, 'by hand'],
          mobx: [1, 'by hand'],
          legend: [2, '$-props on reactive components'],
          xstate: [0, 'by hand'],
        },
        ours: "Bind a store path to a control like Vue's v-model — `<input bind={s.query}/>` — for native inputs and custom components alike. The compiler knows each control's convention ((e), (value), (value, e)…) and generates the exact fast glue, no runtime branching.",
        why: 'value/onChange pairs are the most-typed boilerplate in form UIs. Vue solved it inside one framework; the compiler lets us solve it per control library, without the runtime cost generic solutions pay.',
      },
      {
        id: 'agnostic',
        axis: 'Works outside React, and on the server',
        status: 'designed',
        cells: {
          state: [3, 'agnostic core; adapters for React, Vue, Solid, Svelte, Angular, web components; SSR/RSC'],
          zustand: [3, 'zustand/vanilla is a real core'],
          rtk: [2, 'agnostic Redux with a React binding'],
          jotai: [1, 'React-first by design'],
          valtio: [2, 'valtio/vanilla'],
          mobx: [3, 'genuinely framework-agnostic'],
          legend: [1, 'React-only, and has been for two years'],
          xstate: [3, 'five framework adapters'],
        },
        ours: 'The core knows nothing about any framework: adapters are thin, and each one is the place its framework’s conventions live. On the server there are no module-level singletons — a store is created per request and carried in AsyncLocalStorage — which is the thing that decides whether a library can be used in SSR at all rather than merely claimed to be.',
        why: 'This is a row we do not win outright, and it is here for that reason. MobX, Zustand and @xstate/store have genuinely agnostic cores and score the same as us; a comparison page whose first column wins every single row reads as marketing, and one honest near-tie is what buys the other twenty-nine their credibility. Where we differ is the server half: no singletons is a constraint on the whole design, not a helper anyone can add later.',
      },
      {
        id: 'colocation',
        axis: 'A feature ships as one unit, and can appear twice on a page',
        status: 'designed',
        cells: {
          state: [3, 'state, logic and UI packaged together; instantiable more than once'],
          zustand: [2, 'the slices pattern, by convention'],
          rtk: [2, 'createSlice plus feature folders'],
          jotai: [2, 'atoms colocated with their component'],
          valtio: [1, 'by convention'],
          mobx: [2, 'a store class per feature'],
          legend: [1, 'by convention'],
          xstate: [1, 'one store, by convention'],
        },
        ours: 'A complex packages a feature’s state, its logic and its UI so the whole thing moves as one and can be instantiated more than once on a page, each instance with its own state. It is deliberately a unit of code reuse and nothing else — in particular it is not an undo scope, because what a person thinks of as "the thing I am editing" routinely spans several complexes and a single complex routinely contains view state that belongs in no undo stack at all.',
        why: 'Everyone in this column can organise code by feature; the difference is what happens when the same feature appears twice. Two instances of one widget sharing state by accident is the bug this exists to make unwritable, and it is the bug that a module-level store and a convention cannot prevent. The separation of code-reuse unit from undo scope is a distinction the design got wrong once and corrected — worth stating, because collapsing them looks tidy and breaks in both directions.',
      },
    ],
  },
  {
    name: 'Async, cancellation and lifecycle',
    axes: [
      {
        id: 'async-status',
        demo: 'cancellation',
        axis: 'Loading / error / progress is state, not booleans you maintain',
        status: 'prototyped',
        cells: {
          state: [3, 'status, progress, error read out of the store — running'],
          zustand: [0, 'an isLoading flag per store, by hand'],
          rtk: [2, 'createAsyncThunk / RTK Query give you the three states'],
          jotai: [1, 'loadable() or Suspense'],
          valtio: [0, 'by hand'],
          mobx: [1, 'mobx-utils fromPromise'],
          legend: [2, 'synced observables carry isLoading / error'],
          xstate: [1, 'model it as states yourself'],
        },
        ours: 'Every command has a status machine attached: pending → loading → success | error | cancelled, with progress carried during loading. You read `search.status()` the way you read any other value; nothing is reconstructed from hand-kept booleans, and the machine is specified as the same fsm() primitive the rest of the toolkit uses, so devtools will already know how to draw it — in the prototype it is hand-rolled inside the scope, which is the one sentence here a reader could go and check.',
        code: `const search = route.run('search', async ctx => {
  ctx.progress(0.5)
  return api.search(q, { signal: ctx.signal })
})

search.status()    // 'loading'
search.progress()  // 0.5
route.pending()    // true while this route
                   //   still has work in flight`,
        why: 'Three booleans per request, kept in sync by hand, is the most-repeated bug in application code — and the one nobody writes a test for. Making it a status the store owns means the "we forgot to clear isLoading on the error path" bug cannot be written.',
      },
      {
        id: 'cancellation',
        demo: 'cancellation',
        axis: 'Cancelling actually stops the work',
        status: 'prototyped',
        cells: {
          state: [3, 'scopes + AbortSignal, cascading — running'],
          zustand: [0, 'nothing; you thread your own AbortController'],
          rtk: [2, 'thunkAPI.signal and abort(); RTK Query aborts on unmount'],
          jotai: [1, 'async atoms abort on re-evaluation'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [0, 'nothing'],
          xstate: [0, 'no actors in @xstate/store'],
        },
        ours: 'Tasks live in scopes, and ending a scope cancels everything under it. The route scope is the one that earns its keep: nearly every real cancellation on the client is "the user navigated away", so the router adapter opens a scope per route and ends it on leave. Cancelling aborts the request and tears down the subscription — it does not let the work finish and throw the answer away. Rolling the cancelled task’s optimistic writes back is specified and not yet in the prototype; the scopes, the cascade and the typed reasons are.',
        code: `const route = createScope('route:/products')
const rows = route.run('rows',
  (ctx) => fetch(url, { signal: ctx.signal }))

route.end()      // the user navigated away
rows.status()    // 'cancelled'
rows.error()
    .reason      // 'scope-ended'
                 // — why, not just whether`,
        why: 'Every library here can be made to cancel if you thread an AbortController through by hand. None of them make the common case — a route change abandoning six in-flight requests — free, and an abandoned request that still resolves is how stale data lands in a view the user already left.',
      },
      {
        id: 'task-trees',
        demo: 'cancellation',
        axis: 'One intent fans out, and cancels as one',
        status: 'prototyped',
        cells: {
          state: [3, 'spawn / all / race / shield, cancel cascades — running'],
          zustand: [0, 'nothing'],
          rtk: [0, 'thunks do not compose into trees'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [0, 'nothing'],
          xstate: [0, 'the full XState has actor hierarchies; the store package does not'],
        },
        ours: 'A task can spawn children, group them fail-fast with all(), race them, or hold a region that cancellation may not interrupt with shield(). Cancelling the parent cancels the subtree. Siblings, though, fail independently by default — the inverse of the server-side rule, because one widget\u2019s failed request must not kill the other five on the page. This is Kotlin\u2019s SupervisorJob made the default instead of the opt-in, the lesson Android learned the hard way.',
        code: `route.run('checkout', async (ctx) => {
  const stock = ctx.spawn('stock', checkStock)
  const price = ctx.spawn('price', quote)
  await ctx.all([stock, price])   // one fails,
                                  // the sibling cancels
  await ctx.shield(() => submit())  // uninterruptible
})`,
        why: 'This is redux-saga\u2019s best idea — task trees with cancellation — without a generator runtime, a middleware or a second control-flow language to learn. And because it is declared rather than woven, the compiler drops the parent-pointer bookkeeping entirely in a project that never spawns.',
      },
      {
        id: 'rate-control',
        axis: 'Debounce and latest-wins are separate, declared, and compiled',
        status: 'designed',
        cells: {
          state: [3, 'debounce is timing, policy is concurrency — both declared'],
          zustand: [0, 'a userland debounce and your own in-flight flag'],
          rtk: [1, 'listener middleware has takeLatest-ish cancellation'],
          jotai: [0, 'userland'],
          valtio: [0, 'userland'],
          mobx: [1, 'reaction({ delay })'],
          legend: [1, 'debounce option on synced'],
          xstate: [1, 'delayed transitions'],
        },
        ours: 'An effect declares `debounce: 300` and `policy: latest` as two separate lines, because they are two different mechanisms. Debounce decides whether a task starts at all — pure timing, no task exists yet, and it compiles to a timer at the trigger site. Policy decides what happens when a run begins while a previous one is in flight. A search box wants both.',
        code: `effect({
  on: query, debounce: 300, policy: 'latest',
  run: (ctx, q) =>
    api.search(q, { signal: ctx.signal }),
})
// wait 300 ms after typing stops, then
// abandon any request still in flight`,
        why: 'Libraries that merge the two produce exactly two bug reports, forever: "why does my debounce cancel my requests" and "why does my latest-wins delay my typing". Keeping them separate costs one extra line of declaration and removes a whole class of confusion.',
      },
    ],
  },
  {
    name: 'Events, history, debugging',
    axes: [
      {
        id: 'events',
        demo: 'read-write',
        axis: 'Every change is an event — when you want it',
        status: 'prototyped',
        cells: {
          state: [3, 'commands + patches, per-slice, compiled away'],
          zustand: [0, 'none'],
          rtk: [2, 'actions, no patches'],
          jotai: [0, 'none'],
          valtio: [1, 'ops opt-in'],
          mobx: [2, 'keystone actions+patches'],
          legend: [1, 'change arrays'],
          xstate: [3, 'typed inspect()'],
        },
        ours: 'Every transaction can record its command (intent: name + args) and its patches (effect: exact JSON Patch diff + inverse). Per-slice modes; slices that log nothing compile to plain signal updates — zero cost. The commands, patches and inverses run today; the per-slice modes and the compiling-away are the compiler’s half and are planned, so the prototype logs unconditionally.',
        code: `// one click in the Playground produces:\n{ name: 'todos.toggle',\n  patches: [{op:'replace', path:'/items/3/done', value:true}] }`,
        why: 'Redux showed the value of an action log and charged everyone the full price forever. XState-store has the log but not the ergonomics. We generate events only while something consumes them — undo, devtools, sync, recordings — pay-for-what-you-log.',
      },
      {
        id: 'undo',
        demo: 'undo',
        axis: 'Undo/redo that survives collaboration',
        status: 'designed',
        cells: {
          state: [3, 'inverse patches — undo/redo running on the Playground; origin scoping still designed'],
          zustand: [2, 'zundo snapshots'],
          rtk: [1, 'DIY'],
          jotai: [1, 'jotai-history'],
          valtio: [1, 'history snapshots'],
          mobx: [3, 'keystone UndoManager'],
          legend: [1, 'helper'],
          xstate: [2, '.with(undoRedo())'],
        },
        ours: "Undo applies inverse patches — O(change), not O(state) — scoped by origin (undo your changes, not your collaborator's), grouped by time window, per-slice stacks, or a named domain the slices opt into — deliberately never scoped to a complex, which is a unit of code reuse rather than of user intent, optionally persisted across reload. The inverse-patch half of this is live: the Playground's log has working undo, redo and click-any-row time travel, all from the patches, with no snapshots stored. Origin scoping and persisted stacks are still spec.",
        why: 'Snapshot-based undo (most of the column) breaks the moment a second writer exists. Patch-based, origin-scoped undo is what Yjs/Loro do for CRDTs — we give the same guarantee to ordinary app state.',
      },
      {
        id: 'recordings',
        axis: "Replay a user's exact session",
        status: 'designed',
        cells: {
          state: [3, 'transaction stream → replay anywhere'],
          zustand: [0, 'nothing'],
          rtk: [1, 'replays actions through today’s reducers'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [1, 'keystone action replay'],
          legend: [0, 'nothing'],
          xstate: [2, 'event replay'],
        },
        ours: 'A recording is the transaction stream plus sync acks, schema-redacted: both halves of every transaction, the intent (the command) and the effect (the patches). Replay it into a fresh store in a test, a Storybook story, or devtools time travel — the bug report becomes executable.',
        why: 'Replaying actions is the closest thing anyone else offers and it is fragile for four separate reasons, only one of which is the obvious one. (1) Local UI state is not in the store: keystrokes, open popups, scroll and form drafts live in components by convention, because putting them in Redux costs a root dispatch each — so the replayed store is right and the screen is not. (2) Actions are intent, so replay re-runs reducers: any Date.now(), random id or version check inside one diverges, and yesterday’s actions through today’s reducers silently produce today’s answer rather than what the user saw. (3) Thunks and sagas talked to the network — replaying a dispatch re-issues the request unless the recording captured the resolved actions instead. (4) A plain action log does not record interleaving, and for anything async the order is the bug. Recording the patches as well as the commands answers 2 and 3 outright: the effect can be replayed exactly, independent of the code that produced it. Keystrokes being cheap enough to keep in the store (see the keystroke row) answers 1. Acks in the stream answer 4.',
      },
      {
        id: 'devtools',
        axis: 'Devtools that never freeze, names always resolve',
        status: 'designed',
        cells: {
          state: [3, 'patch stream + devtools maps'],
          zustand: [1, 'Redux bridge, freezes'],
          rtk: [2, 'Redux DevTools, perf limits'],
          jotai: [3, 'jotai-devtools'],
          valtio: [1, 'Redux bridge'],
          mobx: [1, 'stale'],
          legend: [0, 'none'],
          xstate: [3, 'Stately Inspector'],
        },
        ours: 'Devtools consume the patch stream — never a full-state serialisation — inspect state lazily by path, diff in a worker, cap history by bytes. A build-time "devtools maps" file (like source maps) resolves every slice/field name with zero runtime cost.',
        why: "The build-time name map's identity scheme is Effector's SID plugin's; its chunked sections shape is borrowed, literally, from source maps v3. Redux DevTools freezes are structural; React DevTools can't even show hook names — both are designed out, not patched around.",
      },
      {
        id: 'capture',
        axis: 'Turn the screen you are looking at into a test fixture',
        status: 'planned',
        cells: {
          state: [3, 'browser extension → a story whose fixture is the captured state'],
          zustand: [0, 'nothing'],
          rtk: [0, 'nothing'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [0, 'nothing'],
          xstate: [0, 'nothing'],
        },
        ours: 'Point a browser extension at a running application, capture the screen and the state behind it, and get a Storybook story whose fixture is that capture. What travels is chosen by state selectors — the same include/exclude path vocabulary persistence uses, plus the schema-driven redaction recordings already apply — so a story carries what its component needs and neither the whole store nor anything secret.',
        why: 'The honest limit first: this only works on an application that already ships this toolkit, and it is planned rather than built. What it is worth is the gap between "reproduce the exact screen I am looking at" and what anyone can do today, which is describe it in a ticket and hope. No state library has ever offered this, so there is no column to lose to — the row is here because a reader recognises the problem, not because it wins.',
      },
    ],
  },
  {
    name: 'Data & sync',
    axes: [
      {
        id: 'optimistic',
        demo: 'optimistic',
        axis: 'Optimistic updates with automatic rollback',
        status: 'prototyped',
        cells: {
          state: [3, 'overlay + rebase — apply/confirm/roll back running on the Playground; rebase still designed'],
          zustand: [0, 'BYO'],
          rtk: [2, 'RTK Query patches'],
          jotai: [1, 'async atoms'],
          valtio: [0, 'BYO'],
          mobx: [1, 'DIY'],
          legend: [2, 'synced() beta'],
          xstate: [0, 'BYO'],
        },
        ours: 'Pending changes live in an overlay above synced truth: confirmed → dropped, failed → rolled back via inverse patches, new server truth → rebased on top. Same behaviour whether the source is REST, RPC, GraphQL or a sync engine. Live on the Playground: press the reject button and watch the value appear, the transaction sit in flight, and the rollback apply the very same inverse patches undo uses — there is no second rollback mechanism and no snapshot is taken.',
        why: "Every transport layer surveyed (tRPC, oRPC, OpenAPI stacks) delegates optimistic state to manual cache surgery — it is the ecosystem's weakest point and our sharpest edge.",
      },
      {
        id: 'sources',
        axis: 'Any backend as a plug-in source',
        status: 'designed',
        cells: {
          state: [3, 'one collection contract, adapters plug into it'],
          zustand: [0, 'nothing'],
          rtk: [2, 'RTK Query endpoints'],
          jotai: [1, 'async atoms'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [2, 'sync plugins'],
          xstate: [0, 'nothing'],
        },
        ours: 'A source is a small adapter (sync + write handlers) feeding a collection. REST, typed RPC, GraphQL, WebSocket/SSE, RxJS streams, CRDTs, Electric/PowerSync — one contract, deliberately compatible with TanStack DB so its adapter ecosystem plugs straight in.',
        why: "Your app already speaks several transports — that is normal. The store shouldn't care: swap a polling REST source for a sync engine without touching a component.",
      },
      {
        id: 'queries',
        demo: 'queries',
        axis: 'Declarative queries instead of selector chains',
        status: 'planned',
        cells: {
          state: [3, 'live queries; Datalog engine planned'],
          zustand: [0, 'nothing'],
          rtk: [0, 'reselect chains'],
          jotai: [1, 'derived atoms'],
          valtio: [0, 'nothing'],
          mobx: [2, 'computeds'],
          legend: [1, 'computeds'],
          xstate: [0, 'nothing'],
        },
        ours: 'Filtered/sorted/joined views are declared, incrementally maintained (they consume diffs, not snapshots), and — with the planned Datalog-style engine (Rust→wasm) — complex derived data becomes a query, not a hand-memoized selector pyramid.',
        why: 'The gnarliest code in Redux apps is always the selector graph: hand-ordered, hand-memoized, untested. Databases solved this decades ago as incremental view maintenance — TanStack DB brings it to the client, applying enter/update/exit deltas instead of recomputing, with signia\u2019s RESET_VALUE as the fallback when a delta cannot apply.',
      },
      {
        id: 'persist',
        demo: 'regions',
        axis: 'Persistence & URL state as policies',
        status: 'designed',
        cells: {
          state: [3, 'patch-driven, region-filtered — running on the REPL; URL module still designed'],
          zustand: [2, 'persist middleware'],
          rtk: [1, 'redux-persist'],
          jotai: [2, 'atomWithStorage'],
          valtio: [0, 'nothing'],
          mobx: [1, 'DIY'],
          legend: [3, 'persist plugins'],
          xstate: [2, '.with(persist)'],
        },
        ours: 'What persists, where (localStorage/IndexedDB/SQLite), transformed how, versioned and migrated — declared per slice. URL search params are just another persister, parser-compatible with nuqs. Transient state never leaks into either.',
        why: 'Persistence bugs are always "something persisted that shouldn’t" or "migration forgot a field". Policies are data: lintable, diffable, migratable.',
      },
      {
        id: 'rotation',
        axis: 'Store never grows without bound',
        status: 'planned',
        cells: {
          state: [3, 'GC middleware: interest + age eviction'],
          zustand: [0, 'nothing'],
          rtk: [1, 'RTK Query gcTime per cache'],
          jotai: [2, 'atomFamily GC in v3'],
          valtio: [0, 'nothing'],
          mobx: [1, 'computed GC only'],
          legend: [0, 'nothing'],
          xstate: [0, 'nothing'],
        },
        ours: 'Walk through 500 posts and keep instant back-navigation — while an eviction middleware retires nodes nobody subscribes to, by reference count and last-read age, with explicit decorators for "clear when this unmounts".',
        why: "Long-lived tabs are the norm now — TanStack Query's gcTime (refcounted observers) and Relay's retain/dispose lease pair (gcReleaseBufferSize as the grace window) already solved eviction for server caches; client stores mostly pretend the problem doesn't exist.",
      },
      {
        id: 'conversion',
        demo: 'conversion',
        axis: 'Conversions declared once, at both boundaries',
        status: 'prototyped',
        cells: {
          state: [3, 'one declaration, two contracts: codec for the wire, presenter for the view'],
          zustand: [0, 'a partialize/merge pair for persistence; nothing for the view'],
          rtk: [1, 'transformResponse in RTK Query; serializableCheck nags about Dates'],
          jotai: [0, 'per-atom, by hand'],
          valtio: [0, 'by hand'],
          mobx: [1, 'mobx-state-tree types have snapshot conversion; plain MobX does not'],
          legend: [1, 'transform on synced observables — wire side only'],
          xstate: [0, 'by hand'],
        },
        ours: 'A value has three representations — what the store holds, what the wire carries, what a person reads — and they are declared in one place with two deliberately different contracts. The codec is total, pure and takes no locale: decode(encode(v)) equals v. The presenter is reactive and lossy on purpose, and its inward half can fail while the user is mid-keystroke, so that failure is state rather than an exception.',
        code: `const Money = customType('Money', {
  codec:   { encode: m => \`\${m.minor}:\${m.currency}\`, decode: parseMoney },
  present: { format: (m, { locale }) => intl(locale).format(m.minor / 100),
             parse:  (text, { locale }) => parseLocaleMoney(text, locale) },
})`,
        why: 'Merge the two and you corrupt data: a German user\u2019s persisted record holds "1.234,56" where an English user\u2019s holds "1,234.56" — and it survives a reload. Every system that has met this split it the same way (Rails cast/serialize, Django model-vs-form field, and Intl shipping formatters with no parser at all). Nothing else here even has a name for the view boundary.',
      },
      {
        id: 'idempotency',
        axis: 'Replay after a reconnect cannot double-charge',
        status: 'designed',
        cells: {
          state: [3, 'a per-invocation wire key, plus a separate local double-click guard'],
          zustand: [0, 'no outbox; the whole problem is yours'],
          rtk: [1, 'RTK Query retries, but the key is yours to invent'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [1, 'synced retries; no idempotency contract'],
          xstate: [0, 'nothing'],
        },
        ours: 'An offline queue that replays after a reconnect will eventually deliver something twice — a request that reached the server before the connection dropped is indistinguishable from one that did not. Two mechanisms, deliberately separate and separately named. The idempotencyKey is a ULID generated once at the call site, stable across every retry of that invocation, persisted with the outbox record and replayed unchanged from a recording. The submitGuard is a content hash with a 500 ms window that swallows a double-clicked button, is local, and never travels.',
        code: `const transfer = action('transfer', …, {
  // wire: is this the same delivery?
  idempotencyKey: 'per-invocation',
  // local: was this the same click?
  submitGuard: 500,
})`,
        why: 'The distinction is the whole point, and merging them loses money. A key derived from the command\u2019s contents cannot tell two deliberate identical transfers apart, so the second is silently dropped — and silently dropping a real payment is worse than delivering a duplicate the server can reject. A per-invocation key cannot make that mistake; a content hash cannot avoid it. Nothing else here has a name for either half.',
      },
      {
        id: 'regions',
        demo: 'regions',
        axis: 'Which state persists, which is undoable, which is safe to lose',
        status: 'prototyped',
        cells: {
          state: [3, 'one word sets six policies — running'],
          zustand: [1, 'persist({ partialize }), then zundo separately, then nothing for eviction'],
          rtk: [1, 'redux-persist whitelist + a separate undo library'],
          jotai: [1, 'atomWithStorage, per atom'],
          valtio: [0, 'by hand'],
          mobx: [0, 'by hand'],
          legend: [2, 'per-observable persist config'],
          xstate: [1, '.with(persist)'],
        },
        ours: 'Answer one question — what IS this value — and six policies follow: persistence, sync, the command log, undo participation, eviction and whether it may appear in a bug report. Four answers cover it: domain (the server knows it), session (dies at logout, never in undo), view (delete it and the app is still correct) and draft (no server has taken it, and the user would be furious to lose it). Declaring nothing changes nothing, so it is adoptable one slice at a time.',
        code: `createStore(initial, { regions: {
  '/orders':      'domain',   // persisted, synced, undoable
  '/session':     'session',  // its own store, never in undo
  '/ui':          'view',     // evict freely
  '/compose':     'draft',    // crash-safe, never evicted
}})`,
        why: 'These six settings do not vary independently in real projects — they cluster, and the clusters are the regions — so naming one replaces several option lines rather than adding one. Everything else here makes you set them one at a time, in different places, per module: which is how session data ends up in an undo stack, a draft gets evicted under memory pressure, and something private turns up in a bug report.',
      },
      {
        id: 'offline',
        axis: 'Writes made offline replay when the connection returns',
        status: 'designed',
        cells: {
          state: [3, 'durable outbox + overlay + idempotency key'],
          zustand: [0, 'persist stores state, not pending writes'],
          rtk: [1, 'RTK Query retries; nothing survives a reload'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [2, 'synced() persists and retries — the closest real answer here'],
          xstate: [0, 'nothing'],
        },
        ours: 'The command is persisted before it is dispatched, so it survives a reload, not just a dropped request. On reconnect the outbox drains in order with backoff, one tab elected to do it through Web Locks; the optimistic overlay keeps the UI right meanwhile, and each entry carries the idempotency key that makes the replay safe to repeat.',
        why: 'Everything else here persists state and calls it offline support. State is the easy half — what a user loses on a train is the write they made, and a store that reloaded its last snapshot has still dropped it. Note the ordering on this page: the idempotency row sells the consequence, and this row is the capability that creates the reconnect it protects.',
      },
      {
        id: 'drafts',
        demo: 'regions',
        axis: 'A half-written form survives a crash',
        status: 'prototyped',
        cells: {
          state: [3, 'the draft region: persisted crash-safe, never evicted'],
          zustand: [1, 'persist + partialize, bent into shape by hand'],
          rtk: [0, 'nothing'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [1, 'persist the observable and hope'],
          xstate: [0, 'nothing'],
        },
        ours: 'Typed-but-uncommitted input is its own kind of state and gets its own policy: written to storage as it is typed, never evicted under memory pressure, never in an undo stack, never in a bug report. One word on the slice turns it on. The inward half of the two-way binding is built for the same reason — a parse failure keeps the raw text and the last good value at once, so a half-typed entry is never silently discarded.',
        why: 'This is the most legible consequence of the regions row and it deserves its own line, because "the tab crashed and my comment is gone" is a product complaint rather than an architecture argument. Everywhere else it is a thing each team builds once per form, usually after the first complaint, and usually forgetting one direction of it.',
      },
    ],
  },
  {
    name: 'Engineering & tooling',
    axes: [
      {
        id: 'compiler',
        axis: 'A compiler that makes the framework disappear',
        status: 'designed',
        cells: {
          state: [3, 'per-project specialisation'],
          zustand: [0, 'nothing'],
          rtk: [0, 'nothing'],
          jotai: [1, 'SWC/babel debug labels'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [0, 'nothing'],
          xstate: [0, 'nothing'],
        },
        ours: 'The compiler reads how your project uses the toolkit and emits only that: unused modules stripped, proxy reads rewritten to direct signal reads on hot paths, the right React integration mode per component, validators generated from your TS types (typia-style), deoptimization-safe output.',
        why: "Svelte proved compile-time reactivity; React Compiler proved auto-memoization; Qwik proved usage-driven code splitting. Nobody applied the idea to the state layer, where the wins are largest — the bundle contains your app's state machine, not a framework.",
      },
      {
        id: 'invariants',
        axis: 'One approach per project, enforced',
        status: 'designed',
        cells: {
          state: [3, 'config invariants + lint + migrate --fix'],
          zustand: [0, 'team convention'],
          rtk: [1, 'eslint-plugin partially'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [1, 'enforceActions'],
          legend: [0, 'nothing'],
          xstate: [0, 'nothing'],
        },
        ours: 'state init records your choices (react mode, event modes, allowed sources…) in state.config.yaml. state lint fails CI on conflicting mixes — a stray second store library, ad-hoc fetch+useState where collections are mandated. state migrate is the --fix.',
        why: 'Every team has unwritten state conventions; every codebase drifts from them. Written, enforced invariants are why the "many modes" flexibility doesn’t decay into chaos.',
      },
      {
        id: 'migrate',
        axis: 'Codemods for adoption and evolution',
        status: 'designed',
        cells: {
          state: [3, 'AST+LSP codemods, ≥80% automated, optional LLM pass'],
          zustand: [0, 'nothing'],
          rtk: [1, 'RTK codemods for its own versions'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [0, 'nothing'],
          xstate: [1, 'v4→v5 codemods'],
        },
        ours: "state migrate is codemods for everything: from (Zustand/RTK/React Query/raw hooks → state, whole or piece by piece), shape (hooks ↔ many stores ↔ one store), slice (e.g. auto-synced → manual handlers), mode (react/events modes). Repo analysis recommends the target; an optional LLM pass finishes what AST rules can't.",
        why: 'Useful on adoption day and every day after — architecture decisions stay reversible instead of fossilising. No state library treats migration as a product.',
      },
      {
        id: 'testing',
        axis: 'Tests, Storybook, SSR: isolated by construction',
        status: 'designed',
        cells: {
          state: [3, 'factories + scopes only'],
          zustand: [2, 'vanilla mode (default idiom needs resets)'],
          rtk: [2, 'configureStore per test'],
          jotai: [3, 'Provider'],
          valtio: [2, 'instances'],
          mobx: [2, 'instances'],
          legend: [1, 'globals common'],
          xstate: [3, 'factories'],
        },
        ours: 'No module-level singletons exist in the toolkit. A test, a story, a server request each get a store from a factory; mock sources per collection; assert on emitted commands, not implementation details.',
        why: 'The Effector fork() idea, made the only way to hold a store. Dumb components + injected stores = the unit-testing story Redux promised and hooks broke.',
      },
      {
        id: 'agents',
        axis: 'Built for AI agents, not just humans',
        status: 'designed',
        cells: {
          state: [3, 'MCP: search/edit/dump/mock/replay'],
          zustand: [0, 'nothing'],
          rtk: [0, 'nothing'],
          jotai: [0, 'nothing'],
          valtio: [0, 'nothing'],
          mobx: [0, 'nothing'],
          legend: [0, 'nothing'],
          xstate: [0, 'nothing'],
        },
        ours: 'An MCP server over the same analyzer the compiler uses: agents search and edit state definitions as AST operations, dump backend state into typed fixtures, generate dev-server mocks from recordings, replay sessions headlessly. CLI runs as a TUI for humans and JSON for machines.',
        why: 'Codebases are increasingly edited by agents. A state layer whose definitions are declarative data — not scattered imperative wiring — is the one agents can actually reason about and refactor safely.',
      },
      {
        id: 'no-useeffect',
        axis: 'The lint forbids useEffect, and names the replacement',
        status: 'designed',
        cells: {
          state: [3, 'two rules + codemods; a renamed import as the escape hatch'],
          zustand: [0, 'nothing — effects are how you use it'],
          rtk: [1, 'RTK Query removes the fetching effect; the rest stay'],
          jotai: [1, 'atomEffect exists; nothing forbids the React one'],
          valtio: [0, 'nothing'],
          mobx: [1, 'reaction/autorun are the idiom, but not enforced'],
          legend: [1, 'observer-driven; not enforced'],
          xstate: [1, 'statecharts absorb some of it, by convention'],
        },
        ours: 'Two rules rather than one blanket ban, because a blanket ban is a rule people switch off. no-effect-for-state is an error when a body reads state and writes state, or reads state and writes the non-DOM outside world. effect-must-be-dom warns on every survivor and ratchets to an error per directory. Fourteen reasons an effect gets written were surveyed: eight are rewritten by a codemod, three are flagged for a human, one depends on its body, two legitimately stay.',
        code: `$ state lint
✖ src/cart/Total.tsx:14  no-effect-for-state
    reads /cart/items, writes /cart/total
    → a derived value
    fix: state migrate from useeffect
         src/cart/Total.tsx
⚠ src/Row.tsx:31  effect-must-be-dom
    (1 remaining, was 46)

// the survivor says why in its name,
// and grep can count it
useDomEffect(rowRef,
  el => el.scrollIntoView(), [selectedId])`,
        why: 'The distinction nobody else draws is scheduling, not taste: a declared reaction runs post-commit, before React has rendered the state that triggered it, so an effect whose body needs the DOM to reflect the last render genuinely cannot become one. Naming that line is what makes the ban enforceable instead of aspirational — and the escape hatch being a renamed import rather than a suppression comment means grep counts it.',
      },
      {
        id: 'validation',
        axis: 'Data crossing a boundary is checked, with no schema to hand-maintain',
        status: 'designed',
        cells: {
          state: [3, 'validators generated from your TS types at build time'],
          zustand: [0, 'bolt on zod yourself'],
          rtk: [0, 'bolt on zod yourself'],
          jotai: [0, 'bolt on zod yourself'],
          valtio: [0, 'bolt on zod yourself'],
          mobx: [0, 'bolt on zod yourself'],
          legend: [0, 'bolt on zod yourself'],
          xstate: [0, 'bolt on zod yourself'],
        },
        ours: 'The compiler reads the TypeScript types you already wrote and generates the runtime checks from them, typia-style, at the boundaries where untrusted data actually arrives: a source response, a hydrated payload, a replayed recording. Nothing is validated in the middle of your application, because nothing needs to be. Projects already invested in zod, valibot or ArkType keep them — they satisfy Standard Schema and plug in unchanged.',
        why: 'Every project in this column writes its types twice: once for the compiler and once as a schema object for the runtime, and then keeps the two in agreement by hand forever. The second copy is derivable from the first, which is what a compiler is for. This is the only row where all seven score zero and the reader still recognises the problem instantly — because the duplicate schema is sitting in their editor right now.',
      },
      {
        id: 'automations',
        axis: 'Reactions are data you can list, draw and edit',
        status: 'designed',
        cells: {
          state: [3, 'trigger + filter + action, declared as data'],
          zustand: [0, 'subscribe, in code'],
          rtk: [1, 'listener middleware'],
          jotai: [0, 'in code'],
          valtio: [0, 'subscribe, in code'],
          mobx: [1, 'autorun / reaction — real, but ordinary code'],
          legend: [0, 'in code'],
          xstate: [2, 'statecharts absorb much of it'],
        },
        ours: 'A reaction is declared as three pieces of data — what triggers it, what narrows it, what it does — rather than as a function somewhere that happens to subscribe. Because it is data, the analyser can list every reaction in a project, devtools can draw the graph of what causes what, and a user-facing automation builder becomes a UI over the same structure rather than a second engine. Lineage: this is redux-saga’s effects-as-descriptors, minus the generator runtime.',
        why: 'The question "what happens when this field changes" has no answer in any of the other columns except by reading every file — XState comes closest, since a statechart is declarative and data, drawn and edited in Stately, and we take that loop exactly, just not the statechart as the app-wide automation unit. That is the same failure the useEffect row describes at the component level, one layer up: logic scattered as subscriptions is logic nobody can enumerate. And an application whose own automations are data gets the user-facing version almost free.',
      },
    ],
  },
  {
    name: 'Performance & size',
    axes: [
      {
        id: 'bundle',
        axis: 'Bundle: pay only for what you use',
        status: 'designed',
        cells: {
          state: [3, 'core ≤4 kB; +≤3 kB if you use collections — a budget CI enforces, not a measurement'],
          zustand: [3, '3.5 kB'],
          rtk: [1, '15.1 kB'],
          jotai: [2, '7.2 kB'],
          valtio: [2, '5.8 kB'],
          mobx: [1, '15.5–64.5 kB'],
          legend: [2, '11 kB'],
          xstate: [3, '3.5 kB'],
        },
        ours: 'Every other number in this row is that library measured, minified and gzipped — the figures on the Landscape page, each with its version and date. Ours are two budgets: at most 4 kB for the core, and at most 3 kB more if a project uses collections — you pay for the second only by importing it. They are commitments a CI gate enforces by failing the build when a module crosses its byte budget, not sizes anyone has weighed, because there is nothing to weigh yet. Zero dependencies, a subpath export per module, sideEffects:false, and a compiler that strips below what hand tree-shaking can reach: a slice declaring events:none contains no event code at all',
        why: 'Budgets are commitments, not marketing: the CI gate fails the build when a module exceeds its byte budget. Honest caveat: ours are targets until the spike lands; every other number in this row is measured.',
      },
      {
        id: 'perf',
        demo: 'collection',
        axis: 'Fast by invalidation, not by memoization',
        status: 'prototyped',
        cells: {
          state: [3, 'per-path signals; compiler removes proxy tax'],
          zustand: [2, 'fast store, selector cost on you'],
          rtk: [1, 'reselect + immer freeze costs'],
          jotai: [2, 'fine atom graph'],
          valtio: [2, 'proxy cost at render'],
          mobx: [2, 'fast, heavier memory'],
          legend: [3, 'krausest near-vanilla claims'],
          xstate: [2, 'small & simple'],
        },
        ours: 'Precise invalidation beats caching: no memo tables to allocate, no equality sweeps to run. V8’s Proxy `get` costs about 13x a direct property read — a published characteristic of the engine, not a measurement of ours (§13). The compiler removes that cost on hot paths by rewriting proxy reads into direct signal reads, fuses derive chains and keeps the output monomorphic — and that half is planned. What runs today is the per-path signal graph the Playground and the benches use.',
        why: 'Memoization spends RAM (caches) and CPU (comparisons) to recover from imprecise invalidation. Fine-grained subscriptions make the work proportional to the change — run the Bench page on your own hardware.',
      },
    ],
  },
];
