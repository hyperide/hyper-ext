/** R63 glossary — feeds the R54 tooltip system. `link` points at a fuller explainer where one exists. */
export type Term = { def: string; link?: string; compare?: string };
export const GLOSSARY: Record<string, Term> = {
  "DAG": { def: "Directed acyclic dependency graph: arrows show imports and cycles are forbidden. Unlike strict layers, optional features may share dependencies.", link: "/concepts/practical#dag" },
  "ALS": { def: "AsyncLocalStorage: host-provided async request context, owned by the SSR adapter, never a browser/core dependency.", link: "/concepts/practical#als" },
  "FSM": { def: "Finite-state machine: explicit valid lifecycle transitions. The proposed fsm slice shares the normal command/patch pipeline; it is not a shipped XState runtime.", link: "/concepts/practical#fsm" },
  "drained in a microtask": { def: "Bus listeners run after the current stack, not necessarily after rendering. Microtasks can starve a frame unless chained work is bounded.", link: "/concepts/practical#microtasks" },
  "double-buffered": { def: "Deliver one fixed current event batch while newly generated events enter a separate next batch. This does not by itself prevent reaction cycles.", link: "/concepts/practical#double-buffering" },
  "caret/IME correctness": { def: "Preserve insertion position and unfinished input-method composition; synchronous echo alone does not implement the complete editing contract.", link: "/concepts/practical#caret-ime" },
  "differential dataflow": { def: "Maintain query results by propagating weighted changes through operators. General differential systems also track logical time; support must be checked for the selected engine version.", link: "/query-research" },

  'push-pull': {
    def: 'The converged reactivity algorithm: writes only mark dependents (push); recomputation happens lazily on read (pull). Glitch-free, minimal work.',
    link: '/concepts',
    compare:
      'vs streams: see "Signals vs streams". vs two-phase batch: the same mechanism, not a second one — push-pull alone already covers one write\'s fan-out; two-phase batch is push-pull applied across a whole transaction instead of per write.',
  },
  'two-phase batch': {
    def: 'Phase 1: writes mark the graph. Phase 2: one lazy pull at batch end; every effect runs at most once, never on intermediate state.',
    link: '/concepts',
    compare:
      "vs push-pull: not an alternative algorithm — the same push (mark) and pull (lazy recompute) steps, reordered so a whole transaction's writes mark first and there is one pull-and-notify for all of them, not one per write.",
  },
  'structural sharing': {
    def: 'A new immutable version shares every untouched subtree with the old one by reference — cheap versions, reference-equality change checks.',
    link: '/concepts',
  },
  COW: {
    def: 'Copy-on-write: copy only the containers you touch plus the path to the root; share the rest (that sharing is structural sharing). How Immer, Mutative, our transactions — and LMDB at page level — work.',
    link: '/concepts',
  },
  HAMT: {
    def: 'Hash array mapped trie — persistent hash map (Immutable.js, Clojure): hash consumed 5 bits/level, ≤32-slot bitmap nodes; O(log32 n) updates independent of container size. Pointer-heavy: great in RAM, bad on disk pages.',
    link: '/concepts',
    compare:
      'vs COW-of-plain-objects: HAMT wins on very large hot maps; COW wins on typical UI containers (no conversion tax).',
  },
  'JSON Patch': {
    def: 'RFC 6902: a change as {op: add|replace|remove|move, path, value} with JSON-Pointer paths. Our transactions emit these.',
  },
  'inverse patches': {
    def: 'For every patch, the patch that undoes it (replace back to the old value; remove for an add). A transaction stores both directions, so undo = apply inverse patches, redo = re-apply forward ones — no snapshots needed. Immer produceWithPatches popularised the pair.',
    compare:
      'vs snapshot undo: patches are O(change) and merge under concurrency; snapshots are simpler but O(state) and only sound for local-only data.',
  },
  'transaction log': {
    def: 'The ordered record of committed transactions: commands (intent: name + args) and/or patches (effect). Feeds undo, devtools time travel, replication, persistence deltas, recordings.',
  },
  'optimistic overlay': {
    def: 'Pending local changes kept apart from synced truth; reads see overlay∘truth; confirmation drops the entry, failure rolls it back, new truth rebases it. TanStack DB / Electric / Zero converged on this.',
  },
  mutator: {
    def: 'A named mutation (name + validated args) executed optimistically on the client and re-run authoritatively on the server (Zero/Replicache model). Ships intent, not diffs.',
  },
  outbox: {
    def: 'Persist a command locally before dispatch; replay FIFO with backoff when connectivity returns; idempotency keys; one tab drains via leader election.',
  },
  shape: {
    def: "ElectricSQL's unit of read sync: a table slice delivered as a resumable append-only HTTP log (offset-based, CDN-cacheable). Realtime without a socket tier.",
    link: '/concepts',
  },
  IVM: {
    def: 'Incremental view maintenance: derived views consume change deltas instead of recomputing from scratch (differential dataflow; TanStack DB db-ivm, Zero).',
  },
  CRDT: {
    def: 'Conflict-free replicated data type: merges concurrent edits deterministically without a central authority (Yjs, Automerge, Loro). The alternative to leader-ordered logs for collaboration.',
  },
  'event sourcing': {
    def: 'State = fold of an append-only event log; the log is the source of truth, state is derived. LiveStore is the purest client-side example.',
    link: '/concepts',
  },
  signal: {
    def: 'A reactive value holding current state; the graph tracks who read it and invalidates precisely. Pull-based.',
    link: '/concepts',
  },
  observable: {
    def: 'A push-based stream of events over time (RxJS). Great for time operators (debounce/retry); no consistency guarantees across a graph.',
    compare: 'Rule of thumb: state in signals, event streams feeding transactions.',
  },
  'operator fusion': {
    def: 'Collapsing operator chains (map∘map → one map) at composition/compile time — most.js did it at runtime; our compiler does it statically for derive chains.',
    link: '/concepts',
  },
  resumability: {
    def: "Qwik's alternative to hydration: serialise the signal graph + handler pointers into HTML so the client executes nothing upfront and 'resumes' on first interaction.",
    link: '/concepts',
  },
  hydration: {
    def: 'After SSR, the client re-executes all components to rebuild state and attach handlers — paying for the app twice.',
    link: '/concepts',
  },
  runes: {
    def: "Svelte 5's compiler macros ($state, $derived, $effect): plain-looking code rewritten into signal operations at build time.",
    link: '/concepts',
  },
  RSC: {
    def: 'React Server Components: components that run only on the server, ship no JS, and pass serialisable props to client components. Stores live strictly on the client side of the boundary; server actions are the mutation channel.',
  },
  SSG: {
    def: 'Static site generation: pages rendered to HTML at build time. With htmx/turbolinks-class enhancement, often the right tool for landings; usually pointless overhead for logged-in web apps.',
  },
  uSES: {
    def: "useSyncExternalStore — React 18's hook for external stores: subscribe + getSnapshot (must return a cached reference). Updates through it render synchronously, never time-sliced.",
  },
  'COOP/COEP': {
    def: 'Cross-Origin-Opener-Policy + Cross-Origin-Embedder-Policy headers. Together they make a page "cross-origin isolated", which is what unlocks SharedArrayBuffer and high-res timers post-Spectre. Deployment friction: every embedded resource must opt in.',
  },
  SharedArrayBuffer: {
    def: 'A buffer of memory shared between threads (main thread, workers, wasm threads) — actual shared mutable memory with Atomics, no copying. Gated behind cross-origin isolation (COOP/COEP) since Spectre.',
  },
  Spectre: {
    def: 'A class of speculative-execution hardware attacks, not a bug that got fixed — the CPU behaviour is still there. Browsers responded by taking away the tools needed to exploit it from ordinary pages: high-resolution timers were made coarse and SharedArrayBuffer (a perfect timer) was withdrawn. Both come back only on a cross-origin-isolated page, because isolation guarantees no other origin\u2019s data shares the process — so there is nothing worth reading. COOP/COEP is that isolation, and it is why shared memory carries a deployment cost.',
  },
  OPFS: {
    def: 'Origin Private File System: a per-origin private filesystem with fast synchronous access handles from workers — the storage under browser SQLite-wasm builds.',
  },
  SharedWorker: {
    def: 'One worker instance shared by all same-origin tabs — a natural single leader for multi-tab state/sync. Missing on Chrome for Android, so a Web-Locks-elected dedicated worker is the fallback.',
  },
  'Web Locks': { def: 'navigator.locks — cross-tab mutual exclusion; the standard way to elect a leader tab.' },
  ByID: {
    def: "statebus's typed id-indexed substate: ByID<T> declares a family of per-id states materialised lazily as separate atoms — the ancestor of our collections' ids+byId with per-item nodes.",
  },
  atom: {
    def: 'The smallest independently-subscribable unit of state (Jotai/Reatom/statebus terminology). An atom holds one value; derived atoms compute from others; components subscribe to exactly the atoms they read.',
  },
  'interest counting': {
    def: "Reference-counting subscribers per key so data sources connect on first interest and disconnect after none remain (statebus substateInterest → our collections' lifecycle).",
  },
  'devtools maps': {
    def: 'Our planned build-time metadata file (like source maps, but for devtools): names and internal structure of slices/nodes so devtools always resolve names with zero runtime cost (R45).',
  },
  nuqs: {
    def: 'Typed URL search-param state for React (Next/React Router/TanStack Router). Our url module keeps parser-API compatibility with it.',
  },
  birpc: {
    def: 'A ~0.5 kB typed RPC layer needing only post/on functions — no MessagePort transfer, which is exactly the constraint VS Code webviews impose. Our transport driver floor.',
  },
  typia: {
    def: 'Compile-time validator generation from TypeScript types (a transformer): validation with zero runtime schema cost. Our adopted validation direction (decision #17).',
  },
  'Standard Schema': {
    def: 'The common interface (standardschema.dev) implemented by zod/valibot/ArkType etc., letting libraries accept any of them interchangeably.',
  },
  'tx()': {
    def: 'An explicit transaction block: writes inside it batch (one mark phase), commit atomically at the end, emit one command + one patch set, and roll back together on error. Actions are named tx() blocks; a bare write is an implicit single-write transaction.',
    link: '/concepts/practical#transactions',
  },
  'signia epochs': {
    def: "signia/@tldraw/state's temporal core: one global integer clock; every signal stamps lastChangedEpoch, computeds also track lastChecked/lastTraversed. Staleness = integer comparisons, and getDiffSince(epoch) returns the diffs since a moment — or RESET_VALUE meaning 'history exhausted, rebuild'.",
    link: '/dive-data',
  },
  'IVM-lite': {
    def: 'Our pure-JS incremental view maintenance tier: derive.collection(filter/sort/map) consumes patch deltas instead of recomputing — the stopgap with the same mental model as the full engine (planned state/query-tanstack adapter / the Datalog query layer).',
  },
  HOX: {
    def: 'High-Order compleX — a reusable feature bundle: slices + collections + derived views + actions + effects + optional UI widgets, mounted as one unit and exposed as one hook. The successor of the Redux-era pattern of bundling reducers+selectors+actions+adapters+widgets per reused UI part.',
    link: '/spec',
  },
  slice: {
    def: 'A named, schema-typed region of the store: fields + collections + actions + per-slice policies (events mode, history, persistence). The unit of composition, migration and enforcement.',
    link: '/spec#s4-2',
  },
  collection: {
    def: 'A keyed set of items stored as ids + byId with a reactive node per item — one item changes, one row re-renders; optionally fed by a source (REST/RPC/GraphQL/sync engine) via the TanStack-DB-compatible contract.',
    link: '/spec',
  },
  derived: {
    def: 'The successor of selectors: lazy computeds over paths, diff-aware collection views (filter/sort/map consuming patches), and — planned — Datalog queries wrapped as functions. Long mapping chains belong here, next to the data, not in components.',
    link: '/concepts',
  },
  Datalog: {
    def: 'A declarative, logic-based query language (Datomic lineage): facts as [entity attribute value], queries as patterns with joins the engine plans for you. Our planned query layer over collections — replacing hand-memoized selector chains.',
    link: '/concepts',
  },
  'migrate subcommands': {
    def: "state migrate from (another library/approach → state, whole or partial) · shape (hooks ↔ many stores ↔ one store) · slice (change one slice's options, e.g. auto-sync → manual handlers) · mode (react/events modes). Each: --analyze recommendation, ≥80% AST-automated, optional --llm finishing pass.",
    link: '/cli',
  },
  'React Compiler': {
    def: "React's opt-in auto-memoization compiler; it assumes components don't mutate objects during render, which is exactly what render-time read tracking (Valtio, MobX, Legend) does — and it breaks silently when that assumption is violated.",
  },
  region: {
    def: 'A state-lib declaration of lifetime/policy defaults: domain, session, view or draft. Prior art includes React component-state lifetime, MST volatile state and persistence inclusion/exclusion; the four labels are our composition. The prototype implements region-aware persistence filtering, not all planned policy enforcement.',
    link: '/learning#h-regions-known-ingredients-explicit-local-policy',
  },
  scope: {
    def: 'A plain object with a lifetime that owns a set of tasks; ending it cancels every task inside, runs their cleanup in reverse order, and reports why — the client-side unit of structured concurrency, usually opened and ended by a route.',
    link: '/concepts#structured-concurrency',
  },
  'structured concurrency': {
    def: 'The rule that a task belongs to a scope, and ending the scope ends every task inside it, so no unit of work can outlive the thing that asked for it (Kotlin, Trio) — applied here to route navigation instead of a server request.',
    link: '/concepts#structured-concurrency',
  },
  'wasm threads': {
    def: 'WebAssembly threads share one linear memory (backed by SharedArrayBuffer) across workers — real shared-memory parallelism, gated by cross-origin isolation.',
  },
  'zero-copy interop': {
    def: 'Passing pointers/lengths into wasm memory and reading via typed-array views instead of serialising objects across the JS↔wasm boundary. Works for binary/columnar data; JS object graphs still must be encoded first.',
  },
};
