# Master Spec — Universal State Toolkit (working name: `state`)

**Status:** draft v0.6 for review (Mextner, Danny). v0.2: 43 review findings folded in (Appendix D). v0.3: `state lint` + `state.config.yaml` invariants (R26). v0.4: tracked mode opt-out by default (decision #12), Danny-DB query layer (R32), migrate LLM step + repo analysis (R30), Python TUI CLI + docs search (R36-R37). v0.4.1: `state migrate` split into subcommands per decision #16 (R40), Service Worker verdict recorded in §8.5 (R70, decision #22), and the §2 traceability table extended to R27–R70 with an explicit home for every requirement. v0.4.2: the compiler is Rust with a TypeScript sidecar for type-driven features (decision #23, superseding #14). v0.5: six requirements became sections — §4.13 data modelling (R56), §4.14 layers and automations (R59), §4.15 tasks/async lifecycle/cancellation (R71–R74), §8.9 retention and eviction (R57), §12.5 two-way control binding (R67, R74 timing half), and §4.12 now records compiled validation (R49). Research lives in `docs/research/` and is summarised here with a link (decision #24). v0.6: §4.16 regions (R76, R77), §5.7 declared component dependencies (R79), §8.7 idempotency (R78), §12.6 capture (R75), §13.1 the benchmark harness (R28), §14.1 the reactivity package split (R41), §20 the standalone compiler (R31, R42, R46), §5.6 output optimisation (R44), §10.6 devtools maps (R45). **Every requirement R1–R101 now names a destination.** R32's integration is specified from our side in §8.10, with the six questions that are genuinely Danny's listed rather than left as TBD. Requirement IDs now live in packages/state-lib/REQUIREMENTS.md. Follows the research brief `2026-09-01-state-management-research-brief.md`; requirement ids R1–R22 are defined there, R23–R25 are added here.
**Date:** 2026-09-01.

---

## 1. Vision and positioning

A **universal state toolkit for any project's state** — not a Hyper-internal library. Three properties define it:

1. **One small core** (signals + proxy store + patch-emitting transactions + keyed collections) that is framework-agnostic and runs in a browser tab, a Web Worker, a VS Code extension host, Node/Bun on the server, or an edge runtime.
2. **A disappearing framework.** A compiler (`state build`, shipped as a Vite/Rollup/esbuild/Babel/SWC plugin) analyses how the project uses the toolkit and emits only what is used: the React integration mode per component, the event-logging mode per slice, only the middlewares that are referenced, no runtime feature-detection. Without the compiler everything still works via plain runtime imports — the compiler is an optimisation and an ergonomics layer, never a requirement.
3. **A toolkit, not a monolith.** Sync, persistence, history, optimistic updates, URL state, remote replication, devtools, workers are subpath exports with one shared contract each; every one can be omitted or replaced by something the project already uses (TanStack Query/DB, Electric, PowerSync, RxDB, Yjs, nuqs, Redux DevTools).

Two audiences, one API: Hyper itself (VS Code extension + SaaS sharing React code) and every app scaffolded by Hyper (Next.js, Remix/React Router, Vite, Bun, later Vue/Solid/Svelte). Hyper is the first customer and the acceptance test, not the design centre.

**Non-goals (v1):** a CRDT implementation (plug Yjs/Automerge/Loro); a database (plug SQLite-wasm/IndexedDB via persisters); a router (integrate with TanStack Router/React Router/Next); a form library (forms are a recipe on top of slices, see §12.4); Qwik resumability; browsers without Proxy/ES2022.

---

## 2. Requirements and traceability

R1–R22 from the brief, plus:

- **R23 Compiler (disappearing framework).** Per-project specialisation of the library; bundle contains only used features; all three React integration modes available and selected per component; event-logging mode per slice.
- **R24 CLI.** `state init` (interactive scaffolding), `state migrate` — a family of subcommands, not one flag-heavy command (`from`, `shape`, `slice`, `mode`; decision #16, R40) for AST + LSP-driven refactors, e.g. auto-DB-sync → manual control, `state build` (compiler), plus `state doctor` and `state bench`.
- **R25 Agent tooling.** MCP server exposing: search/edit of state definitions, dumping states from a backend into fixtures, generating dev-server mocks from snapshots and recorded event logs.
- **R26 Invariant enforcement.** `state.config.yaml` records the approach chosen at `state init`; `state lint` guarantees the project uses that one approach (no conflicting or bundle-bloating mixes); `state migrate` is the fix that normalises violations.

Traceability matrix (which section satisfies which requirement):

| Requirement                           | Sections           |
| ------------------------------------- | ------------------ |
| R1 no selectors                       | §4.3, §5.3, §6.1   |
| R2 proxy writes / immutable snapshots | §4.2, §4.4         |
| R3 colocation / HOX                   | §4.8, §17.3        |
| R4 per-item lists                     | §4.5, §6.1.4       |
| R5 familiar/invisible                 | §5, §6             |
| R6 all state global                   | §4.9, §12.4, §17.2 |
| R7 events for everything              | §4.6               |
| R8 signals                            | §4.1               |
| R9 structural sharing                 | §4.4               |
| R10 undo / optimistic                 | §4.10, §4.11       |
| R11 pluggable sync                    | §8                 |
| R12 persistence filtering             | §8.5               |
| R13 URL/routing                       | §8.6               |
| R14 workers/wasm                      | §9.3, §8.7, §8.8   |
| R15 tests                             | §12.1              |
| R16 debug user problems               | §4.6, §10, §11.4   |
| R17 Storybook                         | §12.2              |
| R18 UI/logic separation               | §4.8, §17          |
| R19 agnostic + adapters + SSR         | §6, §7             |
| R20 size/ESM/tree-shaking             | §13, §14           |
| R21 devtools                          | §10                |
| R22 modern browsers only              | §13                |
| R23 compiler                          | §5                 |
| R24 CLI, R25 agent tools              | §11                |
| R26 invariants/lint                   | §5.1, §11.2        |

**Where every requirement lives (decision #24).** R1–R26 are spec sections already. For
everything added later this table gives the destination, not a vague status, because the
owner settled the structure: **all design work belongs in this master spec** — it is the
master document, and the narrower implementation specs are derived from it before building.
**Research does not**: each research topic gets its own document under `docs/research/`, and
the master spec carries only a short summary and a link. Vocabulary below:

- `§n` — already written here.
- **pending design** — design work still requiring a section of this spec; tracked under HYP-1457.
- **research doc** — belongs in its own `docs/research/` document; this spec gets a summary + link.
- `site …` / `adopter doc` — content whose home is the docs site or the adopter's repo, not the spec.

| Requirement                                   | Destination                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R27 cross-library comparison                  | site `/compare` + per-library `/lib/<id>` pages                                                                                                                                                   |
| R28 benchmark suite                           | §13.1 (site `/bench` runs the in-browser subset)                                                                                                                                                  |
| R29 validation survey                         | **research doc** → summarised at §4.12                                                                                                                                                            |
| R30 migrate from other libs                   | §11.2                                                                                                                                                                                             |
| R31 React→Solid/Qwik utility                  | §20 (`statec`)                                                                                                                                                                                    |
| R32 Danny-DB query layer                      | §8.10 — our half specified; six questions are Danny's                                                                                                                                             |
| R33 Hyper-side benefits                       | adopter doc `docs/specs/2026-09-03-hyper-state-adoption.md`                                                                                                                                       |
| R34 illustrations + comprehension protocol    | site `/concepts`; harness `site/tools/render-figures.mts`, results in `docs/research/2026-09-04-r34-illustration-comprehension.md`; 5 concepts still unillustrated                                |
| R35 state-lib home + interactive site         | this package, `site/`                                                                                                                                                                             |
| R36 CLI docs search, TUI + machine mode       | §11.2                                                                                                                                                                                             |
| R37 CLI in Python, rig style                  | §11.2 (decision #23)                                                                                                                                                                              |
| R38 REPL examples                             | Implemented: site `/playground`, named `/repl/<id>` examples and exact-source `/repl/snippet` Try links; supported JS/TS runs on request, unloaded runtimes remain editable references (HYP-1457) |
| R39 devtools comparison                       | site `/devtools`                                                                                                                                                                                  |
| R40 migrate subcommands                       | §11.2                                                                                                                                                                                             |
| R41 standalone reactivity package             | §14.1                                                                                                                                                                                             |
| R42 our TS/React compiler, V8 deopt avoidance | §20.7 + §5.6                                                                                                                                                                                      |
| R43 wasm state research                       | **research doc** (with R62)                                                                                                                                                                       |
| R44 `state build` optimisations + perf hints  | §5.6                                                                                                                                                                                              |
| R45 devtools maps                             | §10.6                                                                                                                                                                                             |
| R46 js/wasm compile targets                   | §20.8                                                                                                                                                                                             |
| R47 offline-first collaboration               | §8.7 is the mechanism; comparison is a **research doc**                                                                                                                                           |
| R48 redux-form post-mortem                    | **research doc** → site `/concepts`                                                                                                                                                               |
| R49 typia default validation                  | §4.12                                                                                                                                                                                             |
| R50 ElectricSQL beyond state                  | **research doc**                                                                                                                                                                                  |
| R51 matrix conventions                        | site `src/data/landscape.ts`                                                                                                                                                                      |
| R52 Immutable.js / structura ideas            | site `/landscape` verdicts                                                                                                                                                                        |
| R53 Postgres-of-client-state ambition         | §1, site `/`                                                                                                                                                                                      |
| R54 reference/tooltip system                  | site `src/lib/linkify.ts`, `T.tsx`                                                                                                                                                                |
| R55 OSS positioning                           | site voice + adopter doc                                                                                                                                                                          |
| R56 data modeling layer                       | §4.13                                                                                                                                                                                             |
| R57 store GC / rotation                       | §8.9 + §4.6.1 (standard commands)                                                                                                                                                                 |
| R58 backend normalization                     | §4.13.6 — answered: no wire standard, an ingest mapping instead                                                                                                                                   |
| R59 automations / triggers-as-data            | §4.14                                                                                                                                                                                             |
| R60 mobile local-state survey                 | **research doc**                                                                                                                                                                                  |
| R61 VS Code transport beyond postMessage      | adopter doc §2.5                                                                                                                                                                                  |
| R62 deep wasm study                           | **research doc** → summarised at §8.8/§9.3                                                                                                                                                        |
| R63 glossary                                  | site `src/data/glossary.ts`                                                                                                                                                                       |
| R64 single source for the landscape           | site `src/data/landscape.ts`                                                                                                                                                                      |
| R65 prior-art lineage                         | §4.2, §4.3, §4.7, §4.8, §5 + site                                                                                                                                                                 |
| R66 Datalog-vs-selectors showcase             | §13.1.7; first run measured, `docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md`                                                                                                         |
| R67 two-way control binding                   | §12.5                                                                                                                                                                                             |
| R68 site information architecture             | site                                                                                                                                                                                              |
| R69 site delivery (routing, direct URLs)      | site `src/lib/router.ts` + `vercel.json`                                                                                                                                                          |
| R70 service workers                           | §8.5                                                                                                                                                                                              |
| R71 async status lifecycle                    | §4.15                                                                                                                                                                                             |
| R72 cancellation + task trees                 | §4.15                                                                                                                                                                                             |
| R73 page-transitions bridge                   | §4.15.6                                                                                                                                                                                           |
| R74 keystroke throttling                      | §4.15.3 + §12.5                                                                                                                                                                                   |
| R75 capture to Storybook                      | §12.6                                                                                                                                                                                             |
| R76 state regions                             | §4.16 (research: `2026-09-04-state-regions-brainstorm.md`)                                                                                                                                        |
| R77 never lose user input                     | §4.16.5                                                                                                                                                                                           |
| R78 idempotency keys on actions               | §8.7                                                                                                                                                                                              |
| R79 component↔state binding metadata          | §5.7 + §10.6                                                                                                                                                                                      |
| R80 highlighted code + run-it button          | **site** — `site/src/lib/highlight.ts`, `Code.tsx`, `/repl`                                                                                                                                       |
| R81 hover values in the REPL                  | **site** — `site/src/pages/Repl.tsx`                                                                                                                                                              |
| R82 sidebar table of contents                 | **site** — `site/src/lib/Toc.tsx`                                                                                                                                                                 |
| R83 converters at boundaries                  | §4.13.5                                                                                                                                                                                           |
| R84 lint against `useEffect`                  | §11.2 (rules) + research doc `2026-09-04-useeffect-patterns-and-declarative-equivalents.md`                                                                                                       |
| R93 practical examples and adapter ownership  | [Practical concepts](/concepts/practical), [adapters](/adapters), §4.6, §6                                                                                                                        |
| R94 full corpus and syntax comparisons        | [Query workbench](/selectors-vs-datalog), research `2026-09-08-query-syntax-and-tanstack-db.md`                                                                                                   |
| R95 exact-source Try and complete API index   | Site `/repl/snippet`, `/api`; generated signatures and source-transfer tests                                                                                                                      |
| R96 usable nav edges and lens                 | Site `useDragScroll.ts`, `nav-motion.ts`; dwell/leave/accessibility tests                                                                                                                         |
| R97 exact concepts and reference destinations | Glossary deep links; anchor-integrity and docs refresh tests                                                                                                                                      |
| R98 SVG specification primitives              | `packages/vector-cli/src/diagram.ts`, `vecli diagram`, SVG/ASCII tests                                                                                                                            |

---

### 2.1 Documentation review follow-through (2026-09-08)

These are additional requirements, not a renumbering of the original corpus.

| Requirement                                           | Destination                                                                                       |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| R85 narrow details and TOC                            | Site Compare bottom sheet; shared header/TOC ribbon; browser interaction tests                    |
| R86 static and agent-readable pages                   | Site served prerender, per-page Markdown, llms.txt/full text, Copy page menu; no-JS tests         |
| R87 reactive consistency                              | `/learning`; REPL lazy-ui, diamond, writes-unbatched, writes-batched; prototype graph regressions |
| R88 Electric explanations and laboratories            | `/learning`; six sync-\* teaching examples and explicitly separate electric-http reader           |
| R89 diagram explorer                                  | Site DiagramViewer, popup/fullscreen fallbacks, browser interaction tests                         |
| R90 artefacts, region lineage and inline declarations | `/learning`; read-write and regions examples; region-input.ts; §4.16 clarification below          |
| R91 general boundary conversion                       | `/learning`; conversion example (Date), explicitly labelled design examples for other types       |
| R92 actual Step, UI and JSX help                      | Site step-session.ts, per-example UI/shared workbench, JSX CodeMirror hover; execution tests      |

Research and implementation boundaries: [reactivity, synchronisation and reading](research/2026-09-08-reactivity-sync-and-reading.md), published on the site as `/learning`. The served output is generated HTML plus browser enhancements, not an empty SPA response. The single-file disk build remains an interactive SPA for local review.

## 3. Architecture overview

Reading aids: [DAG](/concepts/practical#dag), [ALS](/concepts/practical#als), [transactions](/concepts/practical#transactions), [microtask draining](/concepts/practical#microtasks), [double buffering](/concepts/practical#double-buffering), [caret/IME correctness](/concepts/practical#caret-ime). The diagram is explanatory; the imports below define the dependency graph.

```ascii
┌──────────────────────────────── build time ────────────────────────────────┐
│  state-cli:  init · migrate · build · doctor · bench          agent MCP     │
│                    └──────── shared analyzer (TS program + AST + LSP) ──────┤
│  compiler plugin (vite/rollup/esbuild/babel/swc): specialises runtime       │
└─────────────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────── run time ──────────────────────────────────┐
│  adapters/react · vue · solid · svelte · angular · lit · (qwik constraints) │
│  ─────────────────────────────────────────────────────────────────────────  │
│  toolkit: history · optimistic · persist · url · remote · worker · devtools │
│           collections/* (REST, GraphQL, RPC, WS/SSE, RxJS, Electric, …)     │
│  ─────────────────────────────────────────────────────────────────────────  │
│  core: signals graph · store (proxy) · transactions/patches · collections   │
│        scopes · schema · event bus                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

This figure is generated in place by vecli from the editable text source. Borders are repaired before drawing; labels remain SVG text. Open the figure to inspect it at full size.

Layering is a DAG, not strict layers: `core` imports nothing and has no environment assumptions (no ALS, no Web Locks, no `window`); `collections` → core; `optimistic` → collections; `outbox` → optimistic + persist; `persist/opfs` → persist + worker; `url` → core (+ optional `history`); `remote` → core; `worker` → remote; adapters → core (+ framework as peer; `@vue/devtools-api` is an optional peer); `ssr` → core (+ `node:async_hooks` where available); sources → collections (+ third-party SDK as peer). The compiler and CLI never ship in the runtime bundle; devtools are stripped in production by the compiler and are a no-op export otherwise.

---

## 4. Core model

### 4.1 Reactivity graph

- Algorithm: push-pull, three-state (clean / check / dirty), lazy computeds, dynamic dependency tracking, glitch-free, batched — the design shared by alien-signals, Preact, Svelte 5, Solid 2, Vue 3.6 and the TC39 proposal. Implementation: vendor alien-signals' `createReactiveSystem` (MIT, ~600 lines) behind an internal interface `{ signal, computed, effect, batch, untrack, scope }` so it can be replaced by a native `Signal` or another runtime without touching the rest of the core.
- **Scheduling (one pipeline, no exceptions):** every write belongs to a transaction (explicit `tx()`/action, or an implicit single-write transaction). At commit of the outermost transaction, synchronously and in this order: (1) computeds are marked, (2) low-level `watch()` subscriptions run, (3) framework subscribers are notified (uSES `subscribe` callbacks, Vue `triggerRef`, Solid signals, Svelte `update`), (4) bus listeners (§4.6) are enqueued and drained in a microtask, double-buffered. Reads are always consistent: `store.count` reflects the last write in the same tick. Synchronous notification is required for controlled inputs (caret/IME correctness, §4.9) and by uSES's consistent-`getSnapshot` contract. This is the Preact/Vue split, chosen over Solid 2/Svelte 5 microtask-batched _reads_ because it "feels like `useState`" (R5).
- **uSES constraint (React):** updates observed through `useSyncExternalStore` are rendered synchronously and never time-sliced, even inside `startTransition` (RFC 0214). Consequences are designed around, not hidden: large `<For>` lists rely on per-item subscriptions so a write touches one component; 60 fps transients coalesce per frame (§4.9); `useOptimisticSlice` (§6.1) is a thin bridge because React's `useOptimistic` is transition-scoped while our overlay (§4.11) is ack-scoped.
- Effects: owned by a scope and disposed with it; `effect.pre`/`effect.post` hints let adapters run before/after framework notification.
- **Async actions:** an action's transaction ends at its first `await`; writes after `await` start new transactions whose `cause` is the closure-captured action context (so cause chains survive without `AsyncContext`); in `strict` mode a write after `await` outside an explicit `tx()` is an error.
- Async: computeds may return promises; the core tracks `pending`/`latest`/`error` per async node (Solid 2 style) but v1 keeps this behind `computed.async()` — plain `computed` stays sync.
- Equality: default `Object.is`; per-node `equals` for structural compare; collections use key identity.

### 4.2 Store and slices

```ts
const app = createStore({ scope }); // never a module singleton (R15, R19)
const todos = defineSlice('todos', {
  fields: { filter: z.enum(['all', 'done']) }, // any Standard Schema
  collections: { items: collection(Todo, { key: 'id' }) }, // collections are declared beside fields, not inside the schema
  initial: { filter: 'all', items: [] }, // arrays are accepted as initial collection data
  actions: (s) => ({
    add: (text: string) => s.items.insert({ id: uid(), text, done: false }),
    toggle: (id: string) => {
      s.items.get(id).done = !s.items.get(id).done;
    },
  }),
  // optional, declarative, statically analysable (see §5 and §11.2):
  history: { domain: 'slice', mergeInterval: 500 },
  persist: { where: 'indexeddb', include: ['items'] },
  sync: rest({ url: '/api/todos' }),
});
app.use(todos);
```

- **Schema-first, declarative definition.** Every option of `defineSlice` is data (Standard Schema for types, plain objects for policies). This is what makes the compiler, `state migrate`, the LSP plugin and the agent tools possible from one analyser (§11.1). Runtime-only imperative middleware wrapping remains possible (`app.use(plugin)`) but is outside what the tooling can reason about.
- _Lineage (R65):_ deep lazy per-property proxies — Vue `reactive`/Svelte `$state`/Solid `createStore`; declarative-options-as-data — Zustand middleware configs and TanStack DB collection options; Standard Schema — the zod/valibot/ArkType shared interface.
- **Proxy store.** `s.items.get(id).done = true` inside an action goes through a lazily created per-property signal graph: an object node creates child signals on first tracked read/write; untouched subtrees cost nothing (Svelte/Solid/Vue model). Handler objects are shared and monomorphic; proxies are cached per target in a `WeakMap`; `ownKeys`/spread on proxies is discouraged by lint and never used internally on hot paths (Proxy cost numbers in the brief §3.4).
- **Definitions vs instances.** `defineSlice` returns a _definition_ (data + types). Actions are invoked on an _instance_ bound to a store: in UI code via `useActions(todos)` (React), `injectActions` (Angular) etc.; outside UI via `store.actions(todos).add(...)` or `store.run(() => …)`. Calling an action on the definition object is a `doctor` error — this is what keeps "no singletons" true in event handlers.
- **Escape hatches:** `snapshot(x)` → plain structural-sharing copy (frozen in dev builds only); `raw(x)` → underlying object without tracking; `ref(x)` → opaque non-reactive value (Monaco models, DOM nodes, class instances); `state.map/set` for reactive collections; `Date`/`URL`/class instances are `ref` by default (no deep proxying of non-plain objects).

### 4.3 Reads: no selectors by default

Three read paths, all equivalent in semantics; the first is the default, the others are chosen per call site by the developer and validated by the compiler (§5.3):

1. `useSlice(todos)` — returns an **immutable snapshot**; during render it is a thin tracking proxy that records which paths were read (proxy-compare style); the set of read paths is a **monotonic union over the component's lifetime** (never re-narrowed — under React Compiler a memoised subtree may skip reads in a given render, so re-narrowing would drop subscriptions); on change the hook returns a _new_ snapshot reference (compiler-safe, uSES-based). Proxy `get` cost is paid only for reads during render; the compiler removes it where it can prove shapes (§5.2). This is the default in React.
2. `todos.$.items` — a signal accessor; reading `.value` inside a tracked context (Solid/Svelte/Vue adapter, or React tracked mode) subscribes fine-grained.
3. `useSlice(todos, s => s.items.length)` — explicit selector for the cases where a derived primitive is wanted; equality `Object.is` by default, `shallow` opt-in.

_Lineage (R65):_ read-path tracking — Valtio `useSnapshot` + `proxy-compare`; the monotonic-read-set fix is ours (forced by React Compiler memoisation); snapshot-reference contract — `useSyncExternalStore`; render-tracking mode — Preact `useSignals` / MobX `observer`.

Derived state: `derive(() => ...)` (lazy computed, cached, owned by the slice scope). For collections, `derive.collection(source, { filter, sort, map })` is **diff-aware** (§4.5) — it consumes patches, not snapshots.

### 4.4 Writes, transactions, patches

- All writes happen inside a **transaction**. Actions are transactions; a bare write outside an action is an implicit transaction with command `{ name: 'set', args: [path, value] }` (mode `loose`, the default everywhere), or rejected (mode `strict`, a per-slice flag, MobX `enforceActions`), or allowed but flagged by `state doctor` (mode `warn`).
- A transaction produces `{ id, ts, cause, command?, patches, inversePatches, meta }`. Patches are RFC 6902 JSON Patch operations (`add/replace/remove/move`) with **string JSON-Pointer paths** (interop with Immer/Mutative tooling, Redux DevTools bridge and any JSON Patch library); array-path helpers are provided for hot paths. They are generated by the draft proxy during the write (Mutative-style: copy-on-write of touched containers, no auto-freeze; freeze in dev only). **Patch generation is enabled only when a consumer is attached** (history, remote, delta persist, devtools, recorder — derived by the compiler from the manifest, or at runtime by subscription count); without consumers a write is a plain signal update. `cause` links to the transaction/effect/adapter that triggered it (Reatom-style cause chain, R16).
- **Structural sharing:** the committed snapshot shares every untouched subtree with the previous one; equality checks by reference are valid on snapshots. Memory budget: one extra object per touched container per transaction, nothing for untouched ones.
- Nested transactions merge into the outermost; `tx.rollback()` applies inverse patches; a thrown error in an action rolls back automatically.

### 4.5 Collections

`collection(Item, { key })` is a first-class node: `ids: string[]` (ordered, stable identity per change) + `byId: Map<id, node>`. Semantics:

- `get(id)` returns a per-item node with its own signal subtree; a change in one item notifies only that item's subscribers and the `ids` signal only on insert/remove/reorder (R4).
- Patches for collections are item-scoped (`/items/byId/<id>/done`) so remote replication, persistence and history stay O(changed items).
- `derive.collection` maintains filtered/sorted/mapped views **incrementally**: it subscribes to the source patch stream and applies enter/update/exit deltas (`ChangeMessage[]`, TanStack DB / IVM style) instead of recomputing; a `RESET` fallback re-runs the full function when a delta cannot be applied (signia's `RESET_VALUE`). Complexity target: O(log n) per update for sorted views (B-tree/skip list), O(1) for filter/map.
- `collection.query({ where, orderBy, limit, offset })`, indexes, `relations`/`include` and joins live in `state/query-tanstack` (§8.2), not in the core budget; the core ships `ids/byId`, per-item nodes and diff-aware `derive.collection` (filter/sort/map) only.
- **Query-layer endgame (R32):** complex derived state is intended to move out of hand-written selectors into declarative queries against **Danny's Datomic-like database** (Rust → wasm, powerful query language, history first-class) mounted through the worker host as a query engine over collections; `state/query-tanstack` is the pure-JS stopgap with the same query surface, so slices can migrate query-by-query. Specified in §8.10 — our half of the contract, plus the six questions that are Danny's.
- **Source lifecycle** (for collections with a source, §8): connect on first subscriber (`interest` ref-counting, the statebus `substateInterest` idea), disconnect after `gcTime` (default 5 min) with no subscribers, `staleTime` 0 by default, pagination via `loadSubset({ cursor | offset, limit, where, orderBy })` with `hasMore`; `refetch()` and `invalidate()` on the collection handle.

### 4.6 Event bus: commands and patches

Two logs, both optional, both configurable per slice (briefing decision on Q2 "what do we log": any sensible variant, selected per slice, compiled away when unused):

- **Command log** — intent: `{ name: 'todos.add', args, actorId, ts, txId }`. Produced by actions. Serialisable by construction (args validated by the action's schema if declared). This is what sync mutators (§8.3), replay (§11.4) and audit consume.
- **Patch log** — effect: the transaction's patches/inverse patches. This is what history (§4.10), remote replication (§9), persistence deltas (§8.5) and devtools time travel consume.
- Modes: `events: 'commands' | 'patches' | 'both' | 'none'` control which logs are **retained** (default `both` in dev, `commands` in production unless a consumer needs patches); `none` compiles the bus away (§5.2) and is incompatible with `history`, `remote`, delta `persist`, `record` — `doctor` reports the conflict. Patch _generation_ is governed separately by consumers (§4.4). `transient` transactions (§4.9) are excluded from the command log and coalesced in the patch log.
- Listeners: `app.on('todos.add', handler)`, `app.on(patch => …)`, `app.on.tx(tx => …)`; listeners run after the transaction commits, may start new transactions (queued, double-buffered — statebus phase ordering: all reducers, then all listeners, then next iteration).
- **FSM (R7; planned API, not a prototype export):** `fsm({ states, on })` defines legal lifecycle transitions for a named slice. The proposed callback `(ctx, ev, enq) => next` is inspired by `@xstate/store`: current context + typed event → synchronous next context, with optional work enqueued after commit. Our `states` transition graph is **not** native `@xstate/store` syntax. Accepted transitions enter the ordinary command/transaction/patch pipeline; there is no second scheduler, history store or actor interpreter. This does not imply zero transition-validation machinery.
- **When to use it:** saving/upload flows with illegal transitions worth rejecting and visualizing. A plain `status` field + actions remains appropriate for simpler logic; use full statecharts when hierarchy/parallel actors are required. Async results carry attempt identity and arrive as separate events. Undo/replay does not repeat network effects.
- **Migration is assisted, not inferred business truth:** `state migrate` may propose a state graph from status assignments; developers review legal events, stale-response rules and persisted-state conversion before enabling it. [Complete examples, transition trace and alternatives](/concepts/practical#fsm).

#### 4.6.1 Standard commands: the typical cases the toolkit names itself (R57, R71)

The store commits transactions of its own — a lease expiring, a task changing status, a rejected mutation rolling back — and those transactions need names. If the toolkit leaves them anonymous, the log fills with unlabelled patches; if every project names them, no two logs read alike and nothing generic can be built on top. So the toolkit ships a **fixed vocabulary of standard command names**, reserved under a `state.` prefix that application commands may not use.

This is the second half of R57's ask. Its first half — a middleware with eviction policies, and the typical cases exposed as explicit decorators rather than magic — is §8.9. Its second half is that those typical cases should be _transactions with standard names_, so that "the component unmounted and its node was cleared" is one recognisable entry in every project's log rather than a bespoke action each team invents. The same argument applies to R71's lifecycle: `loading → success` should not be three hand-written writes.

| Command                | Committed when                                          | Carries                         |
| ---------------------- | ------------------------------------------------------- | ------------------------------- |
| `state.lease.release`  | the last lease on a unit is released (§8.9)             | the unit, the grace deadline    |
| `state.evict`          | a unit is evicted, to a tombstone or fully              | the unit, the level, the reason |
| `state.task.start`     | a task enters `loading` (§4.15.4)                       | the command id it belongs to    |
| `state.task.progress`  | `ctx.progress()` is called                              | the fraction, any payload       |
| `state.task.settle`    | a task reaches `success` or `error`                     | the status, the error if any    |
| `state.task.cancel`    | a task is cancelled                                     | the typed `CancelReason`        |
| `state.sync.confirm`   | the server accepts an optimistic transaction (§4.11)    | the transaction id              |
| `state.sync.rollback`  | it rejects one, or a dependency was cancelled           | the reason, the dropped ops     |
| `state.sync.rebase`    | pending overlay patches are re-applied over new truth   | the transaction ids rebased     |
| `state.outbox.enqueue` | a mutation is queued offline (§8.7)                     | the idempotency key             |
| `state.hydrate`        | a persister or an SSR payload restores state (§8.5, §7) | the source, the paths           |
| `state.binding.commit` | a two-way binding commits a draft to its target (§12.5) | the path                        |

Four properties make this worth fixing rather than leaving to convention.

- **The log reads without a legend.** A reader — or an agent, or a bug report — sees `state.task.cancel` and `state.evict` instead of unnamed patch groups, in every project that uses the toolkit.
- **Undo has something to group by.** §4.10 groups by command id; standard commands mean the toolkit's own writes are grouped correctly by default, and `state.*` commands are excluded from user-facing undo unless a project opts one in — cancelling a task is not something Ctrl+Z should reverse.
- **Devtools and lint can special-case them safely,** because the names are reserved rather than guessed. `state doctor` can say "this slice evicted 400 units in one epoch" without a heuristic.
- **They compile away with their feature.** A project with no `retain` policy never emits `state.lease.release`, so the vocabulary costs nothing where it is unused — the same rule §8.9 and §4.15.7 already follow.

**Reserved, not magic:** `state.` is a reserved prefix, `state lint` rejects an application command that uses it, and every standard command is an ordinary transaction in every other respect — it appears in the patch log, it has inverse patches, and a listener can observe it.

### 4.7 Scopes

- `createScope()` owns signals, effects, slices, subscriptions, and can be disposed. `createStore({ scope })` per app instance; per request on the server (§7.1); per test (§12.1); per Storybook story (§12.2).
- No module-level singletons anywhere in the toolkit; every export that needs a store takes it explicitly or reads it from the framework context (React Provider, Vue `provide`, Solid context, Svelte context, Angular DI, Lit Context Protocol).
- _Lineage (R65):_ scopes — Effector `fork()`/Scope (values _and_ handlers overridable) and Solid `createRoot` ownership; per-request isolation doctrine — Zustand/Jotai SSR guides.
- `state/ssr` (not core) provides an `AsyncLocalStorage`-based `currentScope()` for Node/Bun/edge so server code can call `useStore()` without threading it. In browsers there is no ALS: the scope comes from framework context, and async actions carry their scope by closure (§4.1). The single sanctioned client-only exception to "no singletons" is the Astro-islands registry (§7.2).

### 4.8 Composition unit: `complex` (HOX)

`defineComplex(name, { slices, collections, derived, actions, effects, history, persist, events, widgets })` bundles a reusable feature. The parts, and where the Redux-era roles went:

- `slices` — named, schema-typed regions of state (fields + policies): the "shape" half of what reducers used to define.
- `collections` — keyed item sets (`ids` + `byId`, per-item nodes, optional source): what entity adapters approximated, and what normalizr did before it stopped being maintained.
- `actions` — named transactions with mutable drafts. **This is where reducers went**: a reducer was "(state, action) → state" with hand-written immutability; an action here is the same transition, written mutably, with the immutable snapshot, the patches and the command all derived from it. Nothing is lost — the event is still first-class (§4.6) — but the transition and its intent are declared in one place.
- `derived` — **where selectors went**: lazy computeds over paths, diff-aware collection views (`derive.collection` consuming patches — filter/sort/map without re-running the loop), and, with the query layer (§4.5, R32), Datalog queries wrapped as ordinary functions. Long mapping chains belong here — versioned, testable, colocated with the data they derive from — not scattered through components or memoized ad hoc. A selector-as-function is still just a function: complexes can export them for reuse exactly like the old selectors, minus the manual memoization.
- `effects` — declared reactions (the sanctioned home for what thunks/sagas did imperatively; triggers-as-data per R59).
- `widgets` — optional framework-specific UI fragments living beside the complex and importing only it.

A complex is mounted into a store (`app.use(complex)`) and exposed as one hook (`useComplex(cart)`); a complex may declare a default `history.domain` for its slices, which is a convenience of authoring and not an undo scope of its own (§4.10 explains why a complex is the wrong unit for one). The compiler splits `useComplex` reads into per-slice subscriptions (§5.2). This is the HOX pattern with the `_.get(state, 'a.b.c')` tax removed by types and per-path signals. Complexes can be nested and parameterised (`defineComplex.family(key => …)` for per-page/per-entity instances). This is the formalisation of Mextner's HOX with the `_.get(state, 'a.b.c')` problem removed by proxies and types.

### 4.9 All state global, including transient UI state

The rule "no local state" holds for **ownership**, not for **cost**:

- Any `useState` candidate becomes `useLocal(slice, key?)` → a slice node scoped to the component instance but registered in the store under `/ui/<component>/<instanceId>` (`instanceId` derives from React `useId()` — stable across SSR and StrictMode double-mount — or an explicit `key` for replayable stories); visible to devtools, tests, Storybook, remote replication (opt-in), but flagged `transient` by default: not persisted, not synced, not in the command log, coalesced in the patch log (one patch per animation frame), grouped in history by `mergeInterval` (500 ms default).
- Per-keystroke: the write is synchronous inside the event (controlled inputs in React 18 need this for caret/IME correctness); only the one `<Input>` subscriber re-renders; the event log sees one coalesced patch per frame. This is why the redux-form failure (top-level re-render + serialisation per keystroke) does not recur.
- **Prior art for `transient`:** the concept is assembled, not invented here — Zustand's "transient updates" (subscribe without re-render) supplied the name; Yjs transaction origins and `captureTimeout`, Loro's `mergeInterval`, and LiveStore's `clientOnly` events supplied the semantics (coalesce rapid changes, keep them out of shared logs); our addition is wiring all of that to one per-node flag with defaults. Every mechanism in this spec should cite its lineage like this (R65).
- High-frequency transients (canvas drag at 60 fps) use `transient: 'frame'` (patches coalesced per frame, history disabled until `commit()`); the compiler can lower a `useLocal` with no external readers back to a plain signal that never touches the patch log (§5.2).

### 4.10 History (undo/redo)

Patch-based, in the `history` toolkit module.

**An undo stack is a `domain`, and a domain is declared, not inferred from how the code is packaged.** A slice joins a domain by naming one: `history: { domain: 'editor' }`. Two conveniences exist because they are almost always what is meant — `domain: 'slice'` gives a slice its own stack (the default) and `domain: 'app'` puts everything in one.

There is deliberately **no `complex` scope**, and the reason is worth stating because the earlier draft had one. A complex (§4.8) is a unit of _code reuse_ — state, logic and UI packaged so a feature can be dropped in more than once. An undo domain is a unit of _user intent_ — what the person at the keyboard thinks of as "the thing I am editing". These coincide often enough to be mistaken for each other and are different axes, and the mistake breaks in two directions. A complex can be instantiated many times (`defineComplex.family`), so "the complex's stack" is ambiguous: shared across instances it lets an undo in one instance reach into another, and per-instance it is not the complex that is the scope but the instance, which is a different thing. And a user's undo domain routinely spans several complexes — a canvas editor composed of selection, layers and properties complexes still has one Ctrl+Z — while a single complex routinely contains view state that belongs in no undo stack at all.

What a complex legitimately does is supply a **default**: it may declare the domain its slices join, so composing it does not require wiring each slice by hand. That is a convenience of authoring, and the domain remains the thing that defines the stack. Each entry stores inverse patches + forward patches + command reference. Origin-scoped (`origin: actorId`) so collaborative sessions undo only their own changes (Yjs/Loro model); `mergeInterval` groups rapid transactions; `capture()` captures selection/cursor for restore (`onPush/onPop` hooks). Under sync, undo is committed as a **new inverse transaction** (never a rewind) so it stays correct with concurrent remote edits (LiveStore compensating-event rule). Persistable (`history.persist: true` stores inverse patches in the persister) so undo survives reload.

### 4.11 Optimistic overlay

Two-store model (TanStack DB / Electric / Zero): a slice with a `sync` adapter keeps **synced truth** (immutable, written only by the adapter) and an **optimistic overlay** of pending transactions. Reads see `overlay ∘ truth`; each row exposes `$synced`, `$origin`, `$pending`. Confirmation drops the overlay entry; failure rolls it back (inverse patches) and emits `sync.failed`; a truth change rebases pending overlay patches (re-applied on top of the new truth). **Conflict policy:** operations that no longer apply (target removed, `test` precondition failed) are dropped, the rest of the transaction is kept, the transaction is marked `conflicted` and `sync.conflict` is emitted with the dropped ops; actions that cannot tolerate partial application declare `optimistic: false` and wait for confirmation. This module is what React's `useOptimistic` maps onto in the React adapter (§6.1).

### 4.12 Schema and types

- Any Standard Schema library (zod, valibot, arktype, effect/schema) for slice/collection/action schemas; types are inferred end-to-end (`Infer<typeof todos>`).
- Schema drives: validation in dev, `persist` migrations (`version` + `migrate`), serialisation (`dehydrate/hydrate`, non-JSON types via codecs), devtools labels, `state migrate` refactors, agent tooling introspection, and mock generation (§11.5).
- **Validation is compiled, not interpreted (R49, decision #17).** The default story is typia-style: validators are **generated from the TypeScript types at build time** by the compiler, so a project pays no runtime schema-parsing cost and ships no schema interpreter. Runtime schema libraries remain fully supported through Standard Schema for interop — a project already invested in zod, valibot, ArkType or effect/schema keeps them, and a schema authored at runtime (a form built from server-supplied metadata) can only be interpreted, so that path stays. The compiled path is what `state init` chooses by default; `state.config.yaml` records which, and `state lint` keeps a project from silently running both. This is the disappearing-framework thesis (F2) applied to validation: the schema is a build-time artefact wherever the types are known at build time.
- **Where validation actually runs.** Three doors are always checked because a value can arrive through them unverified: hydration, sync-in from a source, and replay of a recording. Ordinary writes are checked in dev and, for constrained types, at the boundaries defined in §4.13.3. Nothing is validated twice on a path where the compiler can prove the value already passed.

### 4.13 Data modelling: tiers, models and custom types

The Redux-era answer to "where does derived data live?" was _elsewhere_ — selectors in one folder, the raw data in another, the two joined by convention and kept honest by hand-written tests. §4.8 already moved selectors into `derived`. This section takes the next step and says how a **model** is shaped: what is true, what is computed, and what a value's type is allowed to guarantee. It is the layer between "the store holds JSON" and "the application has a domain".

#### 4.13.1 Three tiers, declared not remembered

Every field in a slice belongs to exactly one of three tiers, and the tier is written down rather than inferred from where the code happens to live:

- **`source`** — the source of truth. Consistent, non-contradictory, and the only tier a transaction may write directly. It is what persists (§8.5), what replicates (§9), and what a recording replays. If two `source` fields can disagree, one of them is not `source`.
- **`prepared`** — preprocessing done _at write time_, inside the action, and stored. A normalised phone number, a lowercased search key, a parsed date. It is written by actions like `source` is, but it is a **function of `source`** and is declared as such, which is what lets `state doctor` catch the case where it has drifted and lets a migration recompute it. This is the tier Redux users approximated by "preprocess in the action creator".
- **`derived`** — computed on read, never stored, never written: computeds, diff-aware collection views, Datalog queries (§4.5). Recomputed from `source` + `prepared` on demand.

```ts
const order = defineSlice('order', {
  fields: {
    lines: collection(Line, { key: 'id' }), // source (default tier)
    currency: tier.source(Currency),
    searchKey: tier.prepared(z.string(), {
      // written in actions, but declared derivable…
      from: ['customer.name'],
      compute: (s) => s.customer.name.toLowerCase(), // …so doctor can verify and migrate can rebuild
    }),
  },
  derived: (s) => ({
    subtotal: () => s.lines.reduce((n, l) => n.plus(l.total), Money.zero(s.currency)),
  }),
});
```

Why bother, when `prepared` could just be another `source` field: because the difference is what makes three otherwise-hard things mechanical. `persist` can default to `source` only and recompute the rest on hydration, shrinking what is written and removing a whole class of stale-cache bugs. A migration that changes a preprocessing rule can rebuild every `prepared` field instead of asking the developer to write a data patch. And `state doctor` can flag the classic defect — a `prepared` field that some code path writes without going through its rule — which is invisible when everything is just a field.

_Lineage (R65):_ the tier split is the explicit form of what Datomic separates as asserted facts versus rules, of the "computed columns" distinction in SQL (stored versus virtual generated columns — the same two answers to the same question), and of MobX's `observable` versus `computed`, which is the same idea with only two tiers and no name for the middle one. What we add is naming the middle tier and making it declarative enough to be verified and migrated.

#### 4.13.2 Models: derived fields next to the data, without classes

A **model** is the schema of a collection item plus the derived fields that belong to it. The point is proximity: `line.total` should be readable from the line, not fetched from a selector module that happens to know about lines.

```ts
const Line = model('Line', {
  fields: { id: Id, sku: Sku, qty: PositiveInt, unit: Money },
  derived: { total: (l) => l.unit.times(l.qty) }, // reads like data, computed like a computed
  invariants: { qtyPositive: (l) => l.qty > 0 }, // checked in dev, on hydrate, on sync-in
});
```

`line.total` is a per-item computed on the item's own node, so it participates in the reactivity graph exactly like a field: reading it inside a component subscribes to `unit` and `qty` and nothing else, and a list of a thousand lines recomputes only the ones that changed (§4.5). It is not a method and not a getter on a class instance — the item is still a plain, structurally-shared, serialisable object; `derived` is compiled into a computed keyed by the item's path.

**No inheritance.** Composition and interfaces only. Shared field groups compose (`model('Invoice', { fields: { ...Timestamped, ...Owned, … } })`), shared behaviour is a free function taking the model, and a model may declare that it satisfies an interface so code can be written against the interface rather than the concrete model. The single tolerated exception the requirement allows — one level of inheritance from a library base class, the React-class-component and MVC-controller shape — does not arise here because we ship no base class to inherit from; if an adapter ever needs one, it stays one level and is named as the exception.

_Lineage (R65):_ the "derived field beside the raw field" ergonomics is what MobX class models and Vue computed properties give and what plain Redux state deliberately gave up; Ember's computed properties were the same idea a decade earlier and were undone by their invalidation model, not by the shape. Rails' ActiveRecord and Django models are the reference for _proximity_ and the counter-reference for _encapsulation_: we take the first and refuse the second. Datomic entities — attributes as data, behaviour as functions outside them — are the closest ancestor of what is specified here.

#### 4.13.3 Custom types: guarantees without encapsulation

A custom type exists to make a wrong value unrepresentable — a currency amount that cannot be silently added to a plain number, an identifier that cannot be passed where a different identifier is expected. What it must _not_ drag in is behaviour-as-encapsulation: the utilities stay outside, as free functions, in the functional style.

A custom type declares exactly three things:

```ts
const Money = customType('Money', {
  schema: z.object({ minor: z.number().int(), currency: Currency }), // its shape
  codec: {
    // serialise / deserialise
    encode: (m) => `${m.minor}:${m.currency}`,
    decode: (s) => {
      const [minor, currency] = s.split(':');
      return { minor: +minor, currency };
    },
  },
  invariants: { finite: (m) => Number.isFinite(m.minor) }, // what must always hold
});
```

Nothing else. No methods on the value. Operations are free functions (`Money.plus(a, b)`) and are grouped in a namespace object purely for discoverability — which is the honest form of what a class is actually being used for in this case.

The three guarantees the type gives, and they are the whole point:

1. **Nominal typing at compile time.** `Money` is not `number` and not `Distance`, so the type checker rejects the confusion that a plain-number representation invites. This needs branded types in TypeScript; the schema library supplies the brand.
2. **A codec, so the value survives the boundaries.** `dehydrate`/`hydrate` for SSR, `persist` for disk, the wire protocol for replication (§9) and the patch log all traverse JSON. A custom type without a codec is a value that silently degrades on the way through one of them, which is the failure this closes. Encoding is declared once and used by every boundary.
3. **Invariants checked where values enter.** In dev on every write, and always at the three doors a value can arrive through unvalidated: hydration, sync-in from a source, and replay of a recording.

**Constrained strings** are the case that matters most in practice, because most strings in most applications are not arbitrary strings — they are emails, slugs, ISO dates, non-empty names, bounded identifiers. A constrained string is an ordinary custom type whose schema carries the constraint, and it is declared once and then honoured everywhere: the compiler narrows the type, the runtime checks it at the doors above, and — the part that pays for itself — §12.5 derives the native HTML validation attributes from the same declaration, so the constraint reaches the input element without being restated in the form.

```ts
const Email = constrainedString('Email', { pattern: /^[^@\s]+@[^@\s]+$/, maxLength: 254 });
// one declaration → nominal type · runtime check at the doors · required/pattern/maxlength on the input
```

#### 4.13.4 Chaining over open data

Chaining is the one genuinely pleasant thing about the object-oriented style, and it does not require encapsulation to have. Two mechanisms cover it without closing the data:

- **Free-function pipelines** for values: `pipe(order.lines, filterBy(unshipped), sumBy('total'))`. The data stays plain; the compiler fuses consecutive `map`/`filter` links into a single pass (the operator-fusion idea taken from most.js, D-rxjs), so the ergonomics cost nothing.
- **A thin chaining wrapper** where a fluent read genuinely reads better: `chain(order).lines.unshipped.total`, which is a proxy over the same open data that unwraps with `.value`. It holds no state, adds no methods to the underlying object, and is erased by the compiler where the chain is statically resolvable.

Classes conflate three things this spec keeps apart: a custom type (§4.13.3), a group of utilities with pre-bound context (a namespace object or a closure), and a framework component contract (the adapters' business, not the store's). Naming the three is what makes it obvious that none of them requires inheritance.

#### 4.13.5 Conversion at the two boundaries (R83, R58)

A value has three representations and they are not interchangeable: what the store holds, what the wire carries, and what a person reads. The brief was to declare the conversions between them **once, clearly, rather than scattered**. The design below does that — one declaration site — while keeping two contracts, and the reason for the split is not taste.

**Merging them corrupts data.** Give a value one `encode`/`decode` pair serving both boundaries and one of two things happens: presentation goes locale-blind, or the wire format goes locale-dependent. In the second case a German user's persisted record holds `1.234,56` where an English user's holds `1,234.56`. That is not a formatting bug, it is corruption written to disk and surviving a reload. Every system that has met this problem split it the same way — Rails separates `cast`, `serialize` and `deserialize`; Django splits the model field from the form field; and `Intl` ships formatters with **no parser at all**, deliberately and repeatedly, because a locale-aware parser is not the mirror of a formatter.

So the two boundaries obey different laws:

|               | store ↔ outside world             | store ↔ components                                              |
| ------------- | --------------------------------- | --------------------------------------------------------------- |
| the problem   | **fidelity**                      | **presentation and input**                                      |
| the law       | `decode(encode(v))` equals `v`    | lossy on purpose                                                |
| depends on    | the value alone                   | ambient state — locale, timezone, density                       |
| failure means | corruption that survives a reload | a person is halfway through typing                              |
| reactive?     | never                             | **necessarily** — change the locale and every string recomputes |

Two consequences fall out. Presentation depends on ambient state that is _itself store state_, so the outward half must be reactive, which a codec can never be. And parse failure needs **both** representations at once — the raw string and the last good value — which is exactly what R77 describes, and which a codec never holds.

**The declaration, one site and two contracts:**

```ts
const Money = customType('Money', {
  schema: z.object({ minor: z.number().int(), currency: Currency }),
  // outward and inward across the WIRE. Total, pure, no ambient input, round-trip equal.
  // Used by persist, dehydrate/hydrate, the replication protocol, the transport edge.
  codec: { encode: (m) => `${m.minor}:${m.currency}`, decode: (s) => parseMoney(s) },
  // outward and inward across the VIEW. Reactive outward, partial inward.
  present: {
    // a derived field (§4.13.1): reads locale from the store, so it recomputes when locale does
    format: (m, { locale }) =>
      new Intl.NumberFormat(locale, { style: 'currency', currency: m.currency }).format(m.minor / 100),
    // the inward half is R67's binding: partial, and its failure is R77's business
    parse: (text, { locale }) => parseLocaleMoney(text, locale), // may fail; failure is state
  },
});
```

The type system is what keeps a locale out of the wire: `codec` takes no context parameter and `present` requires one.

**How little of this is new.** The brief asked for normalisation "when editing" and "when using data in components", and both already have homes: write-time normalisation is the **`prepared` tier** (§4.13.1) and read-time shaping is the **`derived` tier**. Much of R83 is routing the ask onto tiers that exist rather than inventing a mechanism.

**Cost, measured rather than assumed** (Node 26.7.0, Apple M4 Pro, 10 000 rows with two `Date` fields; indicative, not a §13.1 result):

|                                                | per payload | per row  |
| ---------------------------------------------- | ----------- | -------- |
| JSON round trip + reviving two `Date` fields   | 5.29 ms     | 0.53 µs  |
| `structuredClone` (dates preserved)            | 5.96 ms     | 0.60 µs  |
| `Intl.DateTimeFormat` **constructed per row**  | 254.46 ms   | 25.45 µs |
| `Intl.DateTimeFormat` constructed once, reused | 4.58 ms     | 0.46 µs  |

At a sync boundary conversion runs once per payload against a network round trip in tens of milliseconds: it is free, and the concern in the brief is more generous to the objection than the measurement is. In a render the cost is real but the dominant term is **constructing the formatter, at 55× reusing one** — a `formatDate()` helper that news up an `Intl.DateTimeFormat` per call is the actual defect in most codebases that have one, and the compiler hoists that construction to module scope keyed by its options. **Conversion on every read of a store path is refused outright**: it runs once per subscriber per read, and a `decode` returning a fresh object destroys referential stability, turning every equality check into a re-render. Conversion belongs at boundaries because boundaries are countable and reads are not.

**Placement.** A codec runs at the _transport_ edge. The in-memory patch log behind undo holds live values and encodes nothing.

#### 4.13.6 Ingest: normalising a payload that is not normalised (R58)

R58 asked whether the toolkit should promote a normalised wire format. **No.** Recommending JSON:API asks a team to change the backend they have just said they cannot change, which contradicts the transitional premise the requirement was raised under. Storage here is already normalised — §4.5's `ids` + `byId` is what `createEntityAdapter` and normalizr's output shape both converge on. What is missing is not a wire contract but an **ingest mapping**.

An ingest shape is attached to a source and maps a denormalised payload into one or more collections. It is normalizr's idea — the schema is _data_, and the same declaration drives both directions — rebuilt as compiled code rather than a runtime tree-walk, which was the part that cost. _(normalizr itself is archived, last published 2022-03-19, and still downloaded around 587 000 times a week: the problem outlived the library.)_

```ts
const posts = collection(Post, {
  key: 'id',
  source: rest({ url: '/api/feed' }),
  ingest: {
    // one payload, three collections; identity comes from getKey, never from a guess
    posts: { from: '$.items[*]', into: posts },
    authors: { from: '$.items[*].author', into: authors, merge: 'fields' },
    comments: { from: '$.items[*].comments[*]', into: comments },
  },
});
```

**Normalisation is opt-in per collection.** Not automatic, because automatic requires guessing identity and every failure below lives inside the guess. Not migration-only either, which undersells it: a denormalised REST API is a permanent condition for many projects, not a phase they pass through.

**Identity, and what happens when it fails.** Three decisions, taken from where the GraphQL caches diverge:

- **A composite key must produce a stable string**, because patch paths embed it (`/items/byId/<id>/done`). A key whose serialisation varies corrupts the patch log rather than merely missing a cache hit — a sharper constraint than Apollo or RTK face.
- **An unidentifiable entity is keyed by its path**, not inlined into its parent. Apollo embeds such objects in the parent and overwrites them wholesale on the next write, losing the earlier query's fields behind a dev-only warning; urql and Relay synthesise a key from the path so two payloads selecting different fields merge without loss. We take the second: an unidentifiable entity degrades to "reachable only through its parent" rather than to silent data loss, and it costs one synthesised key.
- **The same entity in two shapes** — a list endpoint returning `{id, name}` and a detail endpoint returning the full record — merges at field level, last write wins per field. The honest consequence is that the merged record may satisfy no declared type: it is a partial, and "a `User` missing some fields" is a type nobody wrote. This is the one place a compile-time-typed toolkit is worse off than a runtime one, and it is open (§19).

**Provisional ids.** An optimistic insert needs a key before the server issues one; §8.7 already mints a ULID at the call site for `idempotencyKey` and that value serves. What must **not** happen is a silent swap to the server id on acknowledgement — Apollo can do that safely, we cannot, because our ids live _inside patch paths_ and rewriting them behind the log's back corrupts undo and replication replay. The client id is kept permanently and the server id becomes an ordinary field. Duller, and correct.

Full landscape, with versions and maintenance status verified on 2026-09-04: `docs/research/2026-09-04-normalisation-and-conversion-landscape.md`.

#### 4.13.7 What survives from MVC, MVVM and friends

A brief and honest audit, because the question "did the older architectures know something we forgot?" deserves an answer rather than a shrug.

- **MVC** contributed the separation of presentation from domain, which survives intact and is §4.13's whole purpose. Its "controller" is the part that dissolved: on the client it became either an event handler (our `actions`) or a router, and nothing is lost by not naming it.
- **MVVM** contributed the _view-model_ — a shape prepared specifically for one view rather than for the domain — and two-way binding. The view-model survives as `derived` scoped to a complex (§4.8): a projection of the domain shaped for one screen, colocated with it, and cheap because it is incremental. Two-way binding survives too, and is specified in §12.5, but only because a compiler can generate the exact glue — the reason the industry recoiled from Knockout-era two-way binding was the untraceable update cycles it created at runtime, and a statically generated binding does not create them.
- **MVP and its passive view** contributed the idea that a view should be dumb enough to test without a DOM. That is R15, and it is delivered by dumb components plus per-test store instances (§12.1) rather than by a presenter object.
- **The Elm architecture** is the ancestor Redux copied, and its surviving insight is that state transitions should be enumerable and inspectable — which is exactly our command log and `fsm()` (§4.6), kept as an option rather than imposed as the only way to write a transition.

The pattern in all four: the _separation_ they proposed survives, and the _object_ they proposed to carry it does not. This section keeps the separations and declares them as data instead of instantiating them as classes.

#### Open

- **Whether `prepared` earns its place as a first-class tier** or is better expressed as a `derived` field with `persist: true`. The two are equivalent in what they compute and differ in who writes them; the argument for the tier is that it makes the drift detectable, and the argument against is a third concept to teach. Decide before the spike.
- **How far invariant checking goes in production.** Dev-only is cheap and useless in the field; always-on is honest and costs on every write. The likely answer is always-on at the three doors (hydrate, sync-in, replay) and dev-only on ordinary writes, but this needs measuring against §13's budgets rather than asserting.
- **Whether models get identity beyond their collection key** — an equality contract for value-typed models that are not collection items. Deferred until a real case appears.

### 4.14 Layers: business logic, automations, utilities, UI

Four layers, in dependency order. Layer is a property of the **mechanism** a piece of code is written in, not of the folder it sits in, so the analyser (§11.1) can label every node in the manifest and `state doctor` can report a violation instead of a style guide asking politely.

| Layer                                                | Home in this spec                                                                                                       | The test                                                                                                                                | Explicitly not here                                                                                                                                                                                                                            |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Business logic** — what the data means             | `slices`, `collections`, `actions`, `derived`, `fsm()` (§4.2, §4.5, §4.6, §4.8)                                         | True regardless of which screen shows it and regardless of which customer runs it. Removing it changes what a correct state _is_.       | Reactions to other state (that is an automation); work that outlives the transaction — a transaction ends at the first `await` (§4.1), and what follows is a task, so a task that reacts to state belongs in an effect; formatting; transport. |
| **Automations** — what happens next, configurably    | `effects` (developer-authored) and **automation rules** (user-authored), both defined below                             | Deleting it changes what the app _does next_, not what the data _means_ — and a customer could plausibly want it to behave differently. | Invariants. "An issue in a closed project cannot be reopened" is business logic; enforce it in the action, where it cannot be switched off. An automation a product cannot disable is misfiled.                                                |
| **Utilities** — pure functions and drivers           | codecs, formatters, validators, id generation, collection sources and transport drivers (§8.1, §9.2)                    | Takes arguments, returns values, holds no store reference and no state of its own.                                                      | Business rules wearing a utility's clothes — a `formatPrice` that applies the discount policy is the pricing rule hidden where no test will find it. Sources belong here: they move bytes, they do not decide meaning.                         |
| **UI logic** — what exists because there is a screen | `widgets` (§4.8), `useLocal` nodes (§4.9), adapters and hooks (§6), `derived` views that exist only to shape one screen | Delete the screen and it goes with it.                                                                                                  | Anything a second screen would need. The moment two widgets want it, it is `derived` in the complex.                                                                                                                                           |

Dependencies point one way: UI → automations → business logic → utilities. `doctor` errors on a store read inside a utility module and on a business rule reachable only from a widget.

**The redux-saga verdict.** Survives: effects and triggers **declared as data** rather than as arbitrary code buried in actions and selectors — saga was right that "start this work when that happens" deserves its own named, inspectable artefact, and right that a side effect described as a value (`call(api.fetch, id)`) is testable without touching the network. Does not survive: generator choreography — a second, non-standard control flow that TypeScript could not type properly for years, with no `async/await` interop and a runtime interpreter that cannot be compiled away, which is fatal for a disappearing framework (§5). The sharp part is subtler than "generators are awkward": saga's yielded effects _looked_ like data, but the **sequence** of them was decided by a Turing-complete generator body. Effects-as-data was true per instruction and false per program, so the effect tree could never be drawn statically — the one thing the declarativeness was supposed to buy. We draw the boundary one level up: **an effect body is a single opaque leaf; what is data is its inputs and outputs.** `on` declares triggers, `writes` declares the paths it may write; sequencing between effects happens only through state, never inside a body, so the analyser derives the whole graph from `on × writes` without executing anything. No `fork`/`take` in a body. R72's task tree (cancelling a parent cancels its children) is a lifetime concern on `ctx` (§4.15), not a control-flow language.

**One runtime, two authoring surfaces.** Developer `effects` and user automation rules are the **same mechanism with different authorship**, not two systems: both are bus listeners in §4.6 phase 4 (post-commit, drained in a microtask, double-buffered), both produce ordinary transactions, both appear in the same graph and the same devtools panel. They differ only in where the declaration lives and how free the body is — a developer effect's `run` is compiled application code, a user rule's action is a call into a registered allowlist. Terminology warning: these are **not** §4.1 `watch()` signal subscriptions (phase 2), and must not be wired there — a phase-2 effect cannot start a transaction without re-entrancy.

**A user-authored automation is state, not code.** It is stored in a `collection(AutomationRule, { key: 'id' })` inside a slice the developer declares, which is what makes it cheap: `persist`, `sync`, `history`/undo, scopes, replication (§9) and the optimistic overlay all apply unchanged, and the product's own "Automations" settings screen is a `derive.collection` over it. A complex gains one option key beside `effects` (§4.8):

```ts
automations: {
  rules: issues.automationRules,          // where user rules live (a normal collection)
  triggers: [                             // the published trigger vocabulary
    { id: 'issue.status', path: '/issues/byId/*/status', label: 'Issue status changes' },
    { id: 'issue.created', command: 'issues.create', label: 'An issue is created' },
  ],
  actions: {                              // the allowlist: only these may be invoked by a rule
    assign: { args: z.object({ id: z.string(), userId: z.string() }), label: 'Assign to…' },
    // an automatable action is a pure transaction: this inserts a row, a developer effect delivers it
    notify: { args: z.object({ to: z.string(), text: z.string() }), label: 'Send a notification' },
  },
}
```

A rule is `{ id, name, when, where?, then, enabled, author, version, ts }`.

- **`when` — the trigger.** A published trigger id plus, for path triggers, a **patch pattern**: `{ op: 'add' | 'replace' | 'remove' | 'move' | 'any', path, oldValue?, value? }` matched against the patch log (§4.6), where `path` is a JSON Pointer with `*` for one segment. Bounded on purpose: no `**`, no regex. Developer effects may additionally trigger on commands (intent) and on signals — a signal `on` is lowered to a patch trigger on that node's path, so every trigger form fires post-commit in phase 4 and none of them is a phase-2 signal effect. User rules trigger on **published** triggers only, because raw command names are developer vocabulary and are not stable product surface.
- **`where` — the guard.** A serialisable, bounded predicate tree: `and`/`or`/`not` over `eq`/`neq`/`in`/`gt`/`gte`/`lt`/`lte`/`changed`/`matches`, whose operands are literals, `{ $path }` reads of the committed snapshot, or `{ $patch: 'value' | 'oldValue' | 'key' }`. `{key}` inside a `$path` interpolates the segment the trigger's `*` matched. Every operand is typed against the schema (§4.12), so the editor offers only valid comparisons and a rule is validated before it is stored. Data scoping ("only in project P") lives here — it is a filter, deliberately **not** a §4.7 scope, which is a lifetime.
- **`then` — the actions.** `{ action: '<registered id>', args }`, where `args` is a template of literals, `$path`/`$patch` references and `$template` strings with named bindings, validated against the action's declared arg schema. An end user never ships JavaScript; the developer's allowlist is the entire attack surface, and it is reviewable in one place.
- **`author`** — `{ kind: 'developer' | 'user', actorId? }`, plus `enabled`. Ownership matters at runtime, not only for display: user rules run with the authoring actor's identity for audit and sync attribution.

Each firing produces one transaction whose command is `automations.run` with `{ ruleId }` and whose `cause` (§4.4) is the triggering transaction — so a rule's writes are undoable, attributable, replayable in a recording (§11.4) and visible in the cause chain. Matching is not a scan: the module maintains a diff-aware index from trigger path prefix to rule ids over the rule collection.

**Visualisation and visual editing.** The runtime exposes one shape for both authorships, which is what makes a canvas possible:

- `app.automations.list()` / `.explain(id)` → `{ trigger, guard, actions, reads, writes, enabled, author, lastRun, runCount, lastError }`.
- `app.automations.graph()` → nodes for triggers, rules, effects and state paths; edges derived from `on × writes` (developer effects contribute theirs from the manifest, §5.1). This is drawable without running anything — the property saga could not offer.
- `app.automations.vocabulary()` → published triggers, predicate operators and automatable actions with their arg schemas and labels. **The rule editor is generated from this**, so a product gets a Zapier-style builder over its own schema rather than a hand-maintained catalogue.
- `app.automations.setEnabled(id, boolean)` is an ordinary transaction (so toggling is undoable and syncs); `.dryRun(id, tx)` evaluates the guard and returns the patches a rule _would_ produce without committing them — the preview an editor needs, and the basis of contract tests (§12.3).

**Loops and safety.** Statically, `doctor` reports any cycle in the `on × writes` graph among developer effects and published trigger/action pairs; a genuine feedback loop must be declared (`allowCycle: true`, with a guard). At runtime, two caps, both counted along the `cause` chain within a bus drain: **depth** (default 16 hops) and **firings per drain** (default 256, to catch fan-out, which cycle detection alone misses). On trip, the offending hop's transaction is **not started**; already-committed transactions are not rolled back (they were atomic and may have had external effects); `automations.loop` is emitted with the full chain; and the last user rule in the chain is set `enabled: false` — a transaction, so it is visible in the settings UI, syncs, and can be undone. Developer effects are never auto-disabled; that is a build-time bug and `doctor` says so. Rule actions are always queued into the next §4.6 iteration, never re-entered synchronously.

**What compiles away.** A project with no `automations` block ships none of `state/automations` — no patch matcher, no predicate evaluator, no vocabulary export, no editor metadata (≤ 2 kB, §13's per-module bar; linked only when a rule collection is declared). Developer effects with a static `on` compile to direct listener registration at the specific path or command with no matcher at all, so a project that uses `effects` but exposes no user-facing rules pays nothing for the interpreter. With neither, nothing exists beyond §4.6's ordinary listener path. The devtools automations panel is stripped in production like the rest of §10.

```ts
// Developer-authored: an effect. Opaque body, declared inputs and outputs.
const syncAssignee = effect({
  on: 'issues.assign', // a command name (§4.6); a signal or a patch path is also accepted
  policy: 'latest',
  scope: 'route',
  writes: [issues.items], // declared outputs — this is the half the graph is drawn from
  run: async (ctx, { id, userId }) => {
    const res = await api.assign(id, userId, { signal: ctx.signal });
    issues.items.get(id).syncedAt = res.ts; // a normal synchronous transaction
  },
});

// User-authored: a row in a collection. No code, only data.
const rule: AutomationRule = {
  id: 'r_7f2',
  name: 'Notify me when a bug in Checkout goes to In Review',
  when: { trigger: 'issue.status', op: 'replace', value: 'in_review' },
  where: [
    'and',
    ['eq', { $path: '/issues/byId/{key}/projectId' }, 'proj_checkout'],
    ['in', 'bug', { $path: '/issues/byId/{key}/labels' }],
  ],
  then: [
    {
      action: 'notify',
      args: {
        to: 'u_31',
        text: { $template: '{title} is in review', bind: { title: { $path: '/issues/byId/{key}/title' } } },
      },
    },
  ],
  enabled: true,
  author: { kind: 'user', actorId: 'u_31' },
  version: 1,
  ts: 1756900000000,
};
```

_Lineage (R65):_ **redux-saga** — `take`/`fork`/`takeLatest` supplied effects-as-descriptors and declared triggers; we keep the descriptor, drop the generator that made the program undrawable. **redux-observable** epics — honest about stream-in/stream-out, but arbitrary RxJS in the middle is equally opaque to an analyser. **XState** — the strongest precedent: declarative transitions and guards, a machine that is data, a picture generated from it and edited visually (Stately). We take that loop exactly; we do not take the statechart as the app-wide automation unit, because our triggers are cross-slice patch patterns and per-entity machines are already `fsm()` (§4.6). **Effector** — units and links as a declarative graph with an inspector; the graph-first devtools posture is theirs. **Reatom** — cause chains, which is how both the depth cap and "why did this run" work here (§4.4). **Temporal / durable execution** — relevant only to time and durability, deliberately out of v1 (below). **Zapier / IFTTT / Linear / Notion rule builders** — the trigger + filter + action triple, the per-rule toggle and the run history are theirs, and are what end users already know; what we change is that the vocabulary is generated from the project's own schema (§4.12) instead of a hand-maintained integration catalogue.

**Open.** (a) **Time-based triggers** ("30 days after X, do Y") need a durable timer store that survives reload and clock changes; durable-execution systems are the honest reference and none of it exists in v1 — path triggers only. (b) Whether a registered action may perform external I/O, or must be a pure transaction: allowing `run` bodies turns a rule back into a program, and the allowlist stops being a bound. Current position: transactions only, external work happens in a developer effect the rule's write triggers. (c) Per-actor **permissions** on rules under sync — who may read, edit, disable or run whose rule — is a §9 authorisation question this section does not answer.

### 4.15 Tasks: async lifecycle, cancellation and scopes

Everything in §4.4 is synchronous by construction: a transaction begins, applies, emits patches and commits, all in one turn. That is deliberate and it is why undo, replication and the patch log are simple. But almost nothing a user asks for is synchronous, and the asynchronous part has until now had no home. This section gives it one, and settles R71–R74. The design review behind it is `docs/research/2026-09-04-structured-concurrency-and-cancellation.md`; the conclusions are restated here, the reasoning is there.

#### 4.15.1 A transaction is not a task

The distinction the whole section rests on. A **transaction** is instantaneous and already committed the moment it exists — there is nothing in it to cancel, and it must stay that way. A **task** is the asynchronous thing that commits zero, one or many transactions over its lifetime, and is the thing that has a status, a duration, children and a cancel button.

Making a transaction span a request — open on dispatch, commit on response — would turn it into a distributed transaction with optimistic reads inside it, which is the optimistic overlay (§4.11) reinvented badly. It is not on the table.

**The command is the task root.** A command (§4.6) already denotes one user intent, already has an identity in the command log, and already brackets the work that intent caused. Task identity is command identity; the log entry gains a status, a parent pointer and a progress value, and the store gains a live registry of everything in flight without a new concept being invented for it.

#### 4.15.2 Scopes

A task belongs to a scope, and when the scope ends every task under it is cancelled. The scope hierarchy is:

```
app scope  ⊃  route scope  ⊃  component scope (adapter-provided)  ⊃  command (task root)  ⊃  spawned children
```

- **Route scope** is the useful one in practice: nearly every genuine cancellation on the client is "the user navigated away". The router adapter opens one per route and cancels it on leave with reason `scope-ended`. This is also the whole of R73's cancellation half.
- **Component scope** is what the framework adapters contribute (`useTaskScope()` in React, `onDestroy` in Svelte), as a child of the active route scope. Components are ephemeral and framework-specific; they nest under scopes, they do not define them.
- **App scope** is the explicit "this must survive navigation" escape hatch — an upload that should finish after the user moves on. It is deliberately something you have to ask for.
- **Slices and query subscriptions never own task scopes.** A slice is a partition of data with no lifetime; a live query already has subscribe/teardown handled by the reactivity graph, and re-expressing it as a task tree would be a second vocabulary for signal disposal.

**Children fail independently by default.** This is the inverse of the server-side default and is the most common mistake when porting structured concurrency to a UI: one widget's failed request must not kill the other five on the page. Fail-fast exists but is opt-in, as an explicit `all` or `race` group. _Lineage (R65):_ this is Kotlin's `SupervisorJob`, made the default rather than the opt-in, because Android spent years learning to always opt in.

#### 4.15.3 The declaration surface

An effect (§4.8) gains the task vocabulary. Everything on it except `run` is data, which is what lets the analyser see it, the compiler specialise it, and devtools draw it.

```ts
const searchProducts = effect({
  on: products.query, // trigger: a signal, a command, or an event
  debounce: 300, // input scheduling — compiles to a setTimeout (§12.5)
  policy: 'latest', // 'latest' | 'leading' | 'queue' | 'every'  (supersession)
  scope: 'route', // 'route' | 'app' | an explicit Scope
  timeout: 10_000, // a cancel scope over the whole body
  writes: [products.results], // declared outputs — for the analyser, not enforced at runtime
  run: async (ctx, query) => {
    const res = await api.search(query, { signal: ctx.signal });
    ctx.progress(0.5);
    products.results.set(res); // an ordinary synchronous transaction
  },
});
```

`debounce` and `policy` are **different mechanisms and are deliberately not unified**. Debounce decides _whether and when a task starts_ from a stream of input events; no task exists yet, it is pure timing, and it compiles to a timer. `policy: 'latest'` decides what happens _when a new run begins while a previous one is still in flight_; that is concurrency, and it is saga's `takeLatest`. A search box wants both — wait 300 ms, then abandon any earlier request — and they compose. Unifying them produces the two bug reports that follow inevitably: "why does my debounce cancel my requests" and "why does my latest-wins delay my typing".

The context object is where the capability surface deliberately lives, so that reading its type is enough to discover what the toolkit can do — including for an agent (R72):

```ts
interface TaskContext {
  signal: AbortSignal; // the leaf wire format
  reason: () => CancelReason | null; // 'user' | 'scope-ended' | 'superseded' | 'timeout' | 'dependency-cancelled'
  progress: (fraction: number, info?: unknown) => void;
  spawn: <T>(fn: (child: TaskContext) => Promise<T>, opts?: { detached?: boolean }) => Task<T>;
  all: <T>(tasks: Task<T>[]) => Promise<T[]>; // fail-fast group: one fails, siblings cancel
  race: <T>(tasks: Task<T>[]) => Promise<T>; // first settles, the rest cancel
  shield: <T>(fn: () => Promise<T>) => Promise<T>; // a region cancellation may not interrupt
  onCancel: (fn: () => void) => void; // finalisers, run last-in-first-out
}
```

#### 4.15.4 Status is state (R71)

The lifecycle is `pending → loading → success | error | cancelled`, with `progress` a value carried during `loading`, not a status of its own. It is read out of the store like anything else, so no component reconstructs it from hand-written booleans:

```ts
command.status    // Signal<'pending' | 'loading' | 'success' | 'error' | 'cancelled'>
command.progress  // Signal<number | null>
command.error     // Signal<unknown | null>
command.settled   // Promise<void> — resolves after every finaliser has run
command.cancel(reason?: CancelReason): void
scope.pending     // Signal<boolean> — any task still running in this scope
```

The status machine **is an `fsm()` instance** (§4.6), not a hand-rolled parallel one: devtools then visualises task lifecycles with the machinery it already has, and the primitive gets exercised by a first-party consumer.

#### 4.15.5 Cancellation semantics

The rules, stated once, because every one of them is a decision that could plausibly have gone the other way:

- **Cancelling stops real work.** The request is aborted, the subscription torn down, the worker call abandoned — not "the result is discarded on arrival". `AbortSignal` is the substrate everywhere, with `AbortSignal.any` linking a child to its parents, because every cancellable browser primitive already speaks it and a bespoke token would need converting at every boundary.
- **Cancellation is a status transition, not a new command and not an undo.** The cancelled command keeps its log entry and reaches a terminal `cancelled` status. Undo reverses the _completed_ effects of a _finished_ command and has a redo; cancel stops _in-progress_ work and has none — you re-issue the command. Merging them would produce a history cursor that can point at a running task.
- **Compensation is inverse patches attributed to the same command.** If the task wrote optimistically, rollback emits the inverses under its command id; if it wrote nothing, cancellation emits no patches at all. Patches are therefore **grouped by command id** in the patch log — which undo grouping needs regardless.
- **Undo may not target a running task.** The answer to "undo this" while it is `loading` is "cancel it", and the UI should present exactly that.
- **A cancelled optimistic write that a later independent command depended on** is the one case that is not fully solvable on the client, and the spec says so rather than pretending. Rollback rebases the dependent writes against state without the cancelled ones; if a rebase cannot apply, the failure surfaces on the **later** command — the one whose intent is now unfulfillable — as `error` with reason `dependency-cancelled`, and its own optimistic patches roll back. This is the same path §4.11 already runs for a server-rejected mutation, with a different reason code, not a second rollback mechanism.
- **Cancelled while queued in the outbox** (§8.7) is clean: drop it, roll back its overlay, mark it cancelled. **Cancelled while in flight** is not: the request may have reached the server. The default is to mark it cancelled locally and let the next sync reconcile; a mutation that cannot tolerate that ambiguity carries an idempotency key and issues a compensating request. Both are documented; neither is disguised.
- **`AbortSignal` is not sufficient on its own** and the runtime adds four things it lacks: a settled promise (the signal says cancellation was _requested_, not that it _finished_), last-in-first-out finalisers (`addEventListener` fires in registration order, which is the wrong order for cleanup), `shield()` for a non-interruptible region, and a typed `CancelReason` (`signal.reason` is `any`, and the visualiser and the agent both need to know _why_). Abort errors are swallowed at the task boundary so they never surface as `error` status and no `catch` block in application code has to distinguish them.

#### 4.15.6 The page-transitions bridge (R73)

R73 is two things and only one of them belongs in the store.

**Ours:** the route scope ends, its tasks cancel with reason `scope-ended`, their optimistic residue rolls back, and `scope.pending` reports whether the incoming route still has work in flight. **The adapter's:** driving `startTransition`, `useTransition`'s `isPending`, and the browser View Transition API from that signal. Render scheduling is a framework concern and React's transition model does not belong inside a framework-agnostic store; the store exposes the signal and the adapter wires it.

#### 4.15.7 Cost, and what compiles away

The irreducible runtime, once a project has any asynchronous effect at all: the task registry, the status machine (shared with `fsm()`), an `AbortController` per task, the finaliser stack, `shield`, and the abort-error filter. **Estimated 1.5–3 kB minified**, to be measured against §13's budgets rather than asserted.

What the compiler removes: `debounce`/`throttle` inline as timers at the trigger site; `policy: 'latest'` inlines to a single cancel-the-previous check and `policy: 'every'` to nothing; route scopes emit open/close calls at known route boundaries with no generic tree walk; and — the important one — **if no effect in the project declares that it spawns, the parent-pointer bookkeeping and the `AbortSignal.any` linking are dead code and are dropped.** That is why task trees can be first-class in the API and still cost nothing in a project that never builds one, which is the resolution of the tension in R72: deep trees are rare on the client, but the two-level case (a scope ends, its fetches cancel) is common and is the same code.

Making this an optional import instead would put it out of an agent's sight, and R72 requires the opposite: the capability must be discoverable through the MCP server (§11.3) and `state docs` (§11.2). Declared in the type, linked when used.

#### Open

- **The default scope.** `route` is safer against the orphan bug; nearest-enclosing-else-app is less surprising for library code running outside any route. The lean is nearest-enclosing with a `state lint` rule flagging effects that silently resolve to app scope, but this depends on how much of the router the analyser can see.
- **Whether `progress` should carry structured information** (steps completed, bytes) rather than a fraction plus an opaque payload. Deferred until a real consumer exists.
- **Whether an explicit user cancel gesture is itself a command.** Recording "cancel" as a command of its own makes replay ambiguous; not recording it loses a real user intent from the log. The current position is that the gesture is a command whose only effect is to transition another command's status, which keeps both properties, but it has not been tested against replay.

### 4.16 Regions: what a piece of state _is_ (R76, R77)

§4.14 partitions **code** into layers. This section partitions **data**, and the two must not be conflated — one slice is written by business logic and read by UI logic, so a layer cannot tell you how the data should be treated. A region can.

The design brief was explicit and constrains everything below: this must be a **benefit, never a tax**. A project must be able to ignore regions entirely while the split buys nothing, and adopt them incrementally the moment it does. The full brainstorm, including the alternatives rejected, is `docs/research/2026-09-04-state-regions-brainstorm.md`.

#### 4.16.1 A region is a name for a bundle of defaults that already exist

This is the whole anti-tax argument, so it comes first. `persist`, `sync`, `events`, `history`, `transient` and `retain` do not vary independently in real projects — they cluster, and the clusters are the regions. Declaring a region therefore **replaces** several option lines rather than adding one.

**Four regions.** Decided in this draft; overturn by editing the spec, not in chat.

| Region      | What it holds                                                                                                                    | The test                                                                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **domain**  | Entities and business truth — orders, documents, the automation rules of §4.14.                                                  | The server also knows it, or would want to.                                                  |
| **session** | Identity, permissions, feature flags, current workspace, connection status.                                                      | Survives navigation, dies at logout, and must never appear in an undo stack or a bug report. |
| **view**    | What is open, selected, scrolled, hovered, dragged, expanded.                                                                    | Delete it and the application is still correct; the user only loses their place.             |
| **draft**   | Work in progress that is not domain yet: binding shadows (§12.5), the optimistic overlay (§4.11), queued outbox commands (§8.7). | The user would be angry if it vanished, but no server has accepted it.                       |

|             | persist                      | sync                | command log | undo                  | evictable                  | loss-protected |
| ----------- | ---------------------------- | ------------------- | ----------- | --------------------- | -------------------------- | -------------- |
| **domain**  | yes                          | yes                 | yes         | yes                   | only to a tombstone (§8.9) | —              |
| **session** | separately, in its own store | no                  | no          | **never**             | no                         | —              |
| **view**    | no                           | no                  | no          | grouped and coalesced | freely                     | no             |
| **draft**   | **yes, crash-safe**          | not until committed | no          | one entry on commit   | **never**                  | **yes**        |

**Two regions from the original brief were folded in, with reasons.** _Automations_ were proposed as a region; they are not one, because their policy profile is domain's exactly — user-authored configuration that persists, syncs, undoes and replicates. They already have a home as data in §4.14, and giving them a region would add a word without adding a rule. _Cache_ was considered and rejected for the same test: "server said so, discardable, evict first" is fully described by a collection being source-backed plus its `retain` policy (§8.9), both of which already exist. A region must earn its place by changing at least one default that nothing else expresses.

**The rule that stops a region from doing damage:** a region supplies defaults **only for mechanisms the project has already configured, and never introduces an I/O target**. Labelling a slice `domain` does not start syncing it — there is no source to sync to. It sets what happens _if_ one is configured. Without this rule, adding a label could silently start writing to disk or the network, and the feature would be unadoptable.

#### 4.16.2 The region is a property of a node, never a place in the tree

If a region were a location, changing a policy would require moving data, and colocation — the entire point of a complex (§4.8) — would be in permanent tension with policy. So the region is a tag, and placement is free:

```ts
const order = defineComplex('order', {
  region: 'domain', // the slice-level default
  slices: {
    lines: collection(Line), // domain, inherited
    selectedId: field(Id, { region: 'view' }), // sits beside the data it selects
    draftNote: field(Text, { region: 'draft' }), // loss-protected, not synced
  },
});
```

The other reading — "UI state in its own subtree" — is available at the same time, as a **projection** rather than a second copy:

```ts
store.region('view'); // every view-region node in the store, wherever it physically lives
store.region('draft'); // exactly what would be lost if the tab closed right now
order.$view.selectedId; // the same node, read through the region-filtered chain alias
order.selectedId; // the same node, read in place
```

A projection is a derived index over node metadata, so the two readings cannot diverge — there is one node. This also demotes §4.9's `/ui/<component>/<instanceId>` placement from a rule to a **default location**: a `useLocal` node is `view`-region wherever it sits.

#### 4.16.3 Inference, so the label is optional in practice

The region is derived where it is derivable, and only ambiguous cases are ever worth writing down:

| Signal                                                                          | Inferred region |
| ------------------------------------------------------------------------------- | --------------- |
| The slice or collection has a `sync` source                                     | `domain`        |
| Created by `useLocal` (§4.9), or `transient`                                    | `view`          |
| A `bind()` shadow (§12.5), an optimistic overlay entry, a queued outbox command | `draft`         |
| Reached through `state/session`                                                 | `session`       |
| Anything else                                                                   | `domain`        |

`domain` is the unlabelled default deliberately: over-persisting view state is an untidiness, whereas under-persisting real data is data loss, and defaults should fail in the recoverable direction. Combined with §4.16.1's no-new-I/O rule, defaulting to `domain` costs nothing in a project that configured no persistence.

**`state doctor` reports two things and nothing else**, so this never becomes nagging: a node whose declared region contradicts its own options (a `view` slice that persists), and a set of options that exactly match a region preset — reported with the diff that shrinks the configuration, because a recommendation to adopt a label is only credible when it deletes lines.

#### 4.16.4 Derived data is a third axis, and inherits

A node carries two orthogonal annotations, at deliberately different granularity so the common case needs one word:

- **Tier** (§4.13) — `source` / `prepared` / `derived`. Per **field**, because a slice genuinely mixes them.
- **Region** (this section) — per **slice or complex**, overridable per field, because a slice is rarely half view and half domain.

A derived node declares no region. It **inherits from its inputs, and the strictest wins**: `session > draft > view > domain`.

The adversarial pass narrowed what inheritance actually governs, and the narrowing matters. A derived node is never stored anyway (§4.13), so inheritance cannot be about persistence. **It governs exposure**: what may leave this machine, appear in a recording, or be attached to a bug report. So a computed over `domain` and `view` data is `view`-region — not because it should not be persisted (it is never persisted), but because it embeds a UI decision and must not be replicated to another client as though it were truth. A computed touching `session` never leaves the machine at all.

The graph already knows a computed's inputs, so this is derived rather than declared, and it closes a leak class that is currently found in production: the derived value that quietly carries session or view data into a payload because nobody traced where it came from.

#### 4.16.5 Never lose user input (R77)

R77 asks how to mark what counts as user input. It needs no new marking, because two existing mechanisms already _are_ that marking: a binding shadow is by construction typed-and-not-committed, and the optimistic overlay plus the outbox are accepted-locally-but-not-remotely. Both are the `draft` region, so R77 is a policy on one region rather than a feature with its own vocabulary:

```ts
persist: { region: 'draft', where: 'indexeddb', debounce: 250, crashSafe: true }
retain:  { region: 'draft', evict: 'never' }        // §8.9 already forbids evicting unsynced work
```

Three behaviours follow. A `beforeunload` guard fires **only** when the draft region is non-empty — which is what stops it degenerating into the dialog everybody clicks through. On reload, drafts are restored and the user is _told what was recovered_, rather than silently handed text they do not remember typing. And a crash report carries the draft region, because that is the part the user cannot reproduce.

**The privacy hazard, named rather than discovered later:** persisting drafts writes half-typed content to disk. A field whose schema carries `sensitive: true` (§4.12) is excluded, and the exclusion is **automatic for anything bound to an `input[type=password]`** — the compiler knows the control from the JSX (§12.5.2) and applies it without being asked. A draft persister that has to be told about passwords is a draft persister that will leak one.

#### 4.16.6 What compiles away

A project that declares no regions and calls no projection ships nothing: regions are build-time metadata that resolve into the same per-slice options the project would otherwise have written by hand, and `store.region()` is linked only where it is called. The node metadata itself is one small integer per slice, alongside the retention flags §8.9 already allocates.

#### Open

- Whether `state/session` should be a distinct store instance rather than a region — it is the only region with a different _persistence target_ (a token store, not IndexedDB), and a separate instance would make "never leaves" structural instead of policed.
- Whether a projection should be materialised for large stores or always computed. It is a filter over node metadata, so it is cheap to compute and awkward to keep fresh; measurement decides.

---

## 5. Compiler (disappearing framework)

### 5.1 Contract

- Input: the project's TS program + `state.config.yaml`.
  _Lineage (R65): compiler-injected reactivity — Svelte runes; usage-driven specialisation — Qwik `$` optimizer and Google Closure-style dead-code elimination; auto-memoisation baseline we compare against — React Compiler; SID injection — Effector babel plugin._ Output: rewritten modules plus a generated `state.manifest.json` (slices, modes, adapters, budgets) used by devtools, `doctor`, `lint`, `bench`, and agent tools.
- **`state.config.yaml` is the invariants file**, written by `state init` and changed only by explicit edits or `state migrate`: chosen framework(s) and React mode policy, allowed toolkit modules and sources, event/history/persist defaults, strictness level, budgets. It is declarative and diffable (YAML, schema-validated) precisely so that `lint` can enforce it and a PR reviewer can see an invariant change as a one-line diff. Per-file/per-slice overrides live in code (directives, slice options) but must stay within what the config allows.
- Zero semantic change: everything the compiler emits is expressible with runtime imports; the compiled and uncompiled builds must pass the same test suite (this is a CI gate). This is the invariant that makes "opt-in compiler" true and keeps Storybook/tests/SSR working without it. Two documented, observable exceptions: `useLocal` lowering (§5.2, disabled when `record` is in the manifest) and devtools stripping. The compiler never inserts framework directives (`"use client"`) or moves module boundaries — `doctor` reports what a human must change.
- Ships as `@state/compiler` with entry points for Vite/Rollup (`vite-plugin`), esbuild, Babel, SWC (Next.js/Turbopack), and `state build` (standalone). The analysis is shared with the CLI (§11.1); only the emit step differs per bundler.

### 5.2 What it specialises

| Analysis                                                                                | Emit                                                                                                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Which toolkit modules are referenced                                                    | Only those imports remain; `events: 'none'` slices get no bus; unused adapters are dropped even if installed            |
| Per-slice `events`/`history`/`persist`/`sync` options                                   | Static plugin wiring instead of runtime option parsing; dead branches removed                                           |
| `useLocal` nodes with no external readers (no devtools/remote/`record` in the manifest) | Lowered to plain signals (no patch log, no store registration)                                                          |
| `useComplex(x)` reads                                                                   | Split into per-slice/per-collection subscriptions so a complex-level hook costs the same as individual `useSlice` calls |
| Proxy reads on known-shape objects in hot paths (loops, `derive.collection` mappers)    | Rewritten to direct signal reads (`s.items.byId[id].done` → `sig_done.value`), removing Proxy traps                     |
| Per-item render bodies inside `map`/`For`                                               | Extracted into keyed item components subscribing to their own node (§6.1.4) when the framework lacks `mapArray`         |
| React integration mode per component (§5.3)                                             | Snapshot hook, tracked component, or signal-in-JSX                                                                      |
| Framework detection                                                                     | Only the matching adapter is linked; SSR-only code (`dehydrate`) stripped from client bundles and vice versa            |
| Devtools                                                                                | Stripped in production unless `devtools: 'production'`                                                                  |

### 5.3 React mode selection

Per component, decided in this order (explicit annotation > config > inference):

1. **The default is a config invariant, and out of the box it is `tracked` (opt-out)** — decision #12: our compiler + fine-grained subscriptions position tracked mode as the _recommended alternative to React Compiler_, not a guest in its world. `state init` records the choice in `state.config.yaml`; projects that prefer the compiler-safe conservative profile set `react.mode: snapshot`.
2. **Where React Compiler is detected and active** (`babel-plugin-react-compiler`, or `reactCompiler: true` in Next config), tracked and signals modes are automatically demoted to **snapshot** for the components RC will memoise (those not marked `"use no memo"`) — `lint` reports the demotions, and running both RC and default-tracked is flagged as a conflicting mix (R26). Because snapshot mode emits ordinary hook outputs (stable references), ordering relative to RC's own pass (uncontrollable under Next/Turbopack) does not matter; this resolves the Preact #652 class of conflicts by construction. `'use state:tracked'` / `'use state:signals'` / `'use state:snapshot'` directives pin single components either way.
3. **Signals-in-JSX** is `experimental` in v1: it requires runtime support for text-node binding, is unavailable under React Compiler and under SSR hydration, and is only emitted with the explicit directive.
4. The chosen mode is reported in the manifest and by `state doctor --explain <Component>`.

### 5.4 Non-React frameworks

Vue/Solid/Svelte/Angular already have compilers or fine-grained runtimes; our plugin only (a) links the adapter, (b) strips unused toolkit code, (c) rewrites proxy reads to signal reads where it can prove shapes. No render-mode selection needed.

### 5.5 Dev mode

In dev the compiler keeps everything (no lowering, no stripping) and injects source-map-accurate labels, `cause` capture with stack frames, and `devtoolsFormatters`. Production is where it disappears.

### 5.6 Output optimisation and performance hints

R44 asks `state build` to optimise, not merely specialise, and R42 asks the compiler to avoid V8 deoptimisations in its output. This section decides which engine behaviours we design for, what the compiler emits for each, where the hints go, what `state migrate` picks up, and how anything here earns the word "optimisation".

#### 5.6.1 Which engine behaviours we design for

Each row is load-bearing (we shape the emit around it and assert it in the harness), changed (guidance that was true and is not, listed so nobody re-adds the rule), or out of scope.

| Behaviour                                                                                                                                                                            | Status                                                                                                                                                   | How it is checked                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Hidden-class (map) stability: every field initialised in one place, in one order, never added conditionally                                                                          | Load-bearing                                                                                                                                             | `%HaveSameMap(a, b)` under `--allow-natives-syntax`; `--trace-maps` for transition chains |
| `delete` on a hot object, or a plain object used as an unbounded keyed map, forcing dictionary mode                                                                                  | Load-bearing                                                                                                                                             | `%HasFastProperties`; heap snapshot                                                       |
| Inline caches: V8 caches up to four maps per access site, then goes megamorphic (stub-cache lookup, no inlining). The number four is the whole design constraint                     | Load-bearing                                                                                                                                             | `--trace-ic` on the sites the manifest marks hot                                          |
| Elements kinds: `PACKED_SMI` → `PACKED_DOUBLE` → `PACKED_ELEMENTS`, and `PACKED` → `HOLEY` is one-way. Applies to `ids` arrays and the transaction ring buffer, not to state objects | Load-bearing (narrow)                                                                                                                                    | `%DebugPrint` on those two structures                                                     |
| `with` and direct `eval` defeating scope analysis                                                                                                                                    | Structurally excluded: `with` is a `SyntaxError` under strict mode and §14 is ESM-only. `lint` only needs a rule for `eval`                              | —                                                                                         |
| `arguments`, `try`/`catch`, `try`/`finally` blocking optimisation                                                                                                                    | **Changed.** True under Crankshaft, untrue since TurboFan (2017). Do not restructure §4.15's cancellation paths around it                                | Not checked; rule retired                                                                 |
| Rope strings and concatenation cost                                                                                                                                                  | Out of scope. The one case that would have mattered — patch path strings built per write inside a loop — is removed by construction in §5.6.2, not tuned | —                                                                                         |
| Closure allocation per render                                                                                                                                                        | Real, but an allocation cost and a React concern, not a deopt                                                                                            | Allocation profiler, not `--trace-deopt`                                                  |
| JSC structures, SpiderMonkey shapes                                                                                                                                                  | The discipline is portable; the diagnostics are not. Only V8 gets trace-based assertions; the other two are held to `state bench` numbers alone          | §5.6.5                                                                                    |

Two hazards are specific to this product rather than generic advice, and they are why the section exists.

**Patch records.** RFC 6902 is a wire format: `add` and `replace` carry `value`, `remove` does not, `move` and `copy` carry `from`. Emitting that shape as the in-memory record gives the patch log — the hottest allocation path in the library (§4.4) — three or four hidden classes, and every consumer inherits a polymorphic read site. The in-memory record is therefore fixed-shape, and the JSON pointer is assembled only at the RFC 6902 boundary (devtools, `remote`, delta persistence):

```js
function Patch(op, tpl, key, value, from) {
  this.op = op; // small integer, not a string
  this.tpl = tpl; // interned path template id, e.g. `todos.byId.*.done`
  this.key = key; // runtime item key, or undefined for a static path
  this.value = value; // undefined on remove — the field still exists
  this.from = from; // undefined unless move/copy
}
```

Splitting the path into an interned template plus a runtime key is what makes interning possible at all: collection item paths (§4.5) contain a runtime id and cannot be interned whole. The same discipline governs the inverse-patch record and the per-property lazy signal node — all fields declared in the constructor, `null` where not yet materialised, never `delete`, never a conditional `.deps`.

**The megamorphic shared helper.** One generic `readPath(target, key)` fed every slice's differently-shaped object is a single access site seeing dozens of maps; the store's central read path goes megamorphic on a large project and stays there. This is §5.2's "proxy reads on known-shape objects → direct signal reads" row generalised: wherever the analyser knows the shape it emits a per-slice accessor, so each site sees one map, and the generic helper survives only for paths it could not resolve.

#### 5.6.2 What the compiler emits

| Hazard                                                                                    | Transform                                                                                                                                                                                                                         | Engine (decision #23)                       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Incremental object construction in a slice initialiser                                    | `shape-stable-factory`: one emitted constructor per slice/item type, every field in declaration order                                                                                                                             | Rust core                                   |
| Generic path helper on a hot read                                                         | `direct-node-read`: specialise to a signal read at known paths (§5.2)                                                                                                                                                             | Rust core                                   |
| Per-write path string construction                                                        | `intern-paths`: templates become integer ids in a build-time table, reconstructed only by devtools (§10.6) and the wire boundary                                                                                                  | Rust core                                   |
| Handler closure rebuilt per render                                                        | `hoist-handler`: applied only where the closure captures nothing but the store, and emitted as a per-store cached bound function (`store.$h[n] ??= …`) — one allocation per store, never module scope, which §4.7 and §7.1 forbid | Rust core                                   |
| Subscription bookkeeping keyed by object identity in a growing plain object               | `indexed-subscription-cache`: flat integer-indexed array, React Compiler's `$` cache shape                                                                                                                                        | Rust core                                   |
| A collection whose items are a heterogeneous union, so every per-item site is polymorphic | Split or normalise — requires enumerating the union                                                                                                                                                                               | TypeScript sidecar → `migrate`, not `build` |

The split follows decision #23: anything answerable from syntax and usage is a `build` transform in the Rust core; anything needing the type checker cannot run inside the bundler pass and surfaces as a hint whose fix is a source refactor.

#### 5.6.3 The hints channel

`state build` always writes `state.hints.json` beside `state.manifest.json`, versioned and stamped with the same build hash.

```jsonc
{
  "version": 1,
  "buildHash": "sha256:…",
  "hints": [
    {
      "rule": "shape/conditional-field",
      "severity": "warn",
      "node": "todos.error",
      "location": { "file": "src/state/todos.ts", "line": 42, "col": 5 },
      "message": "`error` is added only on the failure branch; the slice has two shapes.",
      "transform": "shape-stable-factory",
      "applied": false,
      "blockedBy": "conditional-initialiser",
      "fix": { "kind": "migrate", "command": "state migrate perf shape/conditional-field --slice todos" },
    },
  ],
}
```

Every hint names the transform that would fix it — a hint that only describes a smell is not a hint. Severities: `info` (a transform was applied; recorded so `doctor --explain` can show it) and `warn` (a transform was blocked, and `fix` says what to run). `error` is reserved and never emitted by default; a project opts in through `hints.failOn` in `state.config.yaml`.

Hints are the performance channel only. §11.2's rule of thumb still divides the other two (`lint` = "this violates what this project chose", `doctor` = "this is probably a mistake anywhere"); hints are never a gate by default and are enforced, if at all, through §5.6.5's bench regression. One entry moves: §11.2's `doctor` check "proxies in hot loops" becomes the hint `ic/megamorphic-path-read`, and `doctor` cross-references it rather than keeping a copy. Surfaces: `state build --hints` prints them, `state lsp` maps `warn` to a hint-severity diagnostic whose code action is the `migrate` command, and MCP gains `state.hints({ severity, node })` alongside §11.3's tools.

#### 5.6.4 The `migrate` handoff

Migrations are a subcommand family (decision #16), so hints' `--fix` is `state migrate perf <rule>`. Three real members:

- `shape/conditional-field` — an initialiser or action that introduces a field on one branch only. The codemod hoists the field into the slice's declared initial state with an explicit `null` and rewrites presence tests to null checks. Syntax-level, but it rewrites user source, which is why it is a migration and not an emit.
- `shape/delete-keyed-record` — a hand-rolled `Record<string, T>` mutated with `delete`: dictionary mode plus unbounded shape churn. The codemod replaces it with `collection()` (§4.5) — Map-backed, per-item nodes, removal as a collection op — and rewrites call sites.
- `ic/heterogeneous-collection` — one collection holding a union whose members have different property sets. The codemod either splits it into two collections or normalises to the full shape with explicit nulls, on the developer's choice. It needs the checker to enumerate the union, so it runs through the TypeScript sidecar and can never be a `build` transform.

#### 5.6.5 Verification: how a hypothesis becomes a default

Every optimisation is a named compiler flag with a status recorded in the manifest: `hypothesis` (off, available as `--perf-opt <name>` in dev), `enabled`, `retired`. Promotion requires all four of:

1. §5.1's zero-semantic-change gate green with the flag on, across the full conformance suite.
2. An isolating `state bench` scenario that moves when the flag flips and does not move otherwise.
3. A zero-deopt assertion on the hot path, derived from `--trace-deopt` / `--trace-ic` output and asserted by a test, not read once by a human and believed.
4. A win outside the noise band (median of N runs, ±2 median absolute deviations; N and the reference machine pinned under `bench` in `state.config.yaml`), written up in `docs/research/`.

This is not ceremony. The first time the rule was applied to our own prototype it rejected the change: replacing a linear scan in the derived-collection repair path with a maintained position index — the obvious optimisation, named in the write-up as the next thing to do — made the 10 000-row case 3.8× slower, because a splice into a sorted array invalidates every index after it. Recorded in `docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md`.

A regression is any §13 row outside its noise band on the reference machine; `state bench` already fails CI on that. A flag whose isolating scenario stops discriminating is retired rather than left enabled — an optimisation nobody can measure is dead weight in the compiler and a lie in the manifest. No figure in this section is ours; §13's "V8 Proxy get ≈ 13× a direct read" is a reference point from the brief, not a measurement of this library (R66).

_Lineage (R65):_ Closure Compiler advanced mode — type-informed property renaming and collapsing, the proof that whole-program property-level rewriting works; its externs burden is what we avoid by owning both the declaration form and the emit. Svelte — flat, allocation-light output driven by build-time knowledge instead of runtime bookkeeping. Solid — per-node effects, which is what our specialised reads land on. Prepack — whole-program partial evaluation over an open world; it bloated output, could not stay sound, and died; the lesson taken is that only local, provable transforms are allowed. `optimize-js` — paren-wrapped IIFEs for eager parse, correct then and obsolete once V8 changed its lazy-parse heuristics: the cautionary case for engine-version-specific tricks, and the reason §5.6.1 has a "changed" row. React Compiler — the flat integer-indexed `$` memo cache is shape-stable and monomorphic, mirrored here for subscription caches. asm.js and typed arrays — borrowed only for the ring buffer, id maps and version counters, never for state objects.

**Open:**

1. Whether hints may ever gate CI (`hints.failOn`) or stay permanently advisory. Gating a performance heuristic is how a lint rule becomes a ritual.
2. Whether the reference machine is a pinned physical box or a CI runner class. Shared-runner variance is plausibly wider than the effects being chased, which would make criterion 4 unmeetable in CI and push promotion to a manual bench with a signed-off write-up.
3. Whether the fixed-shape trade actually pays at real sizes: the patch record carries `value`, `key` and `from` always, and the typed-array ring buffer adds complexity for an effect that may sit inside the noise band. Both are measurable and neither has been measured.

### 5.7 Declared component dependencies (R79)

Every existing way of connecting a component to a store has a defect, and the requirement is a refusal to pretend otherwise:

- **Hooks in the component body** — the dependency is invisible from outside. You cannot see what a component needs without reading it, and you cannot render it in a test or a story without standing up a store.
- **`mapStateToProps`** — the declaration is separated from the use, so the two drift; and in Redux it re-ran on every dispatch, which is R1's original complaint.
- **Container components** — the dependency graph is real but scattered across a parallel tree of files nobody reads.
- **Prop drilling** — honest and explicit, and it churns intermediate components that do not care.

The practice this project already follows in application code is better than it sounds: **group props into named objects by data slice and drill those**. One prop instead of seven, and the dependency stays visible at every level it passes through. That is already almost a declaration — it is simply written by hand. So the design is to generate it.

```tsx
const Row = component(
  { needs: { line: order.lines.item, ui: order.$view } }, // data the analyser reads
  ({ line, ui }) => <tr className={ui.selectedId === line.id ? 'on' : ''}>{line.sku}</tr>,
);
```

`needs` is a literal path map, so the Rust analyser resolves it without types. From it the compiler emits **either** a subscription at this component **or** a grouped prop the parent passes down — the choice is a per-project invariant in `state.config.yaml`, not a per-component decision, because mixing the two is exactly the "containers scattered everywhere" failure. Switching a project between them is `state migrate shape`.

**What the declaration buys beyond ergonomics**, and this is what R79 is actually asking for. The manifest gains a component → paths map (surfaced as §10.6's `components.subscribes`), and three things become possible that are not possible today:

- **Blast radius** — "which components does changing this field affect" becomes a query over a codebase rather than a guess. This is a build-time answer, which is why it needs the declaration and cannot come from runtime read tracking.
- **A conformance lint** — a component's declared `needs` must cover its actual reads. A read outside the declaration is an error, which is what keeps the map from silently becoming fiction.
- **A migration off direct wiring** — `state migrate shape --to declared` rewrites hook calls in component bodies into `needs` entries, which is the migration path the requirement asks for.

**System-level state is the exception, and gets the global-variable treatment.** A handful of values are needed by nearly every component — current user, permissions, theme, connection status — and declaring them everywhere is noise. Application code reads what looks like a plain global (`session.user.name`) and the compiler rewrites it into a precise subscription. This is Svelte's `$store` auto-subscription and Qwik's `useContext` erasure, and it is deliberately confined to values declared `global: true` in the session slice: **a global read is invisible in a component's signature, which is the first defect on the list above.** Tolerable for five well-known values, corrosive as a general mechanism, and `state lint` enforces the boundary.

**Uncompiled**, `component()` is an ordinary higher-order function that subscribes at mount — same behaviour, no build step, per §5.1.

**Open:** whether `needs` should be inferable from the component body rather than written, with the declaration generated on first build and thereafter checked. That is strictly nicer when it works and confusing when the inference is wrong, and it depends on how often a component's reads are statically bounded.

---

## 6. Framework adapters

**Ownership and implementation status (R93):** `state/react`, `state/vue`, `state/solid`, `state/svelte`, `state/angular` and `state/lit` below are proposed adapters. Names such as `useSlice`, `useActions`, `definePiniaStore`, `injectSlice` and `StateController` belong to that proposal; they are not native framework exports. Native names retain their native imports. [The adapter guide](/adapters) gives explicit imports, complete explanatory wrappers, disposal/SSR constraints and Try links, including a runnable React/prototype example. Targets and conformance suites are design goals, not measured bundle sizes or published dependencies.

Every adapter is built on the same four core primitives — `subscribe(node|selector, cb)`, `getSnapshot(node)` (cached reference), `signal(node)` (accessor), `scope` — so each is small (target ≤ 1.5 kB gz; React includes the uSES shim for 18) and testable against one conformance suite (`@state/adapter-tests`: subscription, batching, unmount cleanup, SSR hydration, StrictMode double-render, keyed lists).

### 6.1 React (18.3+ and 19)

1. **Snapshot mode (selected when React Compiler is active; otherwise an explicit option, decision #12):** `useSlice(node)` = `useSyncExternalStore(subscribeToReadPaths, getSnapshot, getServerSnapshot)`; the snapshot records read paths during render, the read set is a monotonic union (§4.3), and the _value_ is a new reference on change, so React Compiler and `memo` see it. Tearing-safe, concurrent-safe, StrictMode-safe. Actions via `useActions(slice)`, bound to the provider store.
2. **Tracked mode (default/recommended without React Compiler, decision #12):** `'use state:tracked'` → `useTracked()` opens an effect around render; any signal read subscribes; version-counter store via uSES. Same mechanics as `@preact/signals-react` `useSignals`. Rejected under React Compiler unless `"use no memo"`.
3. **Signals-in-JSX (experimental, opt-in):** `{todos.$.count}` as a JSX child binds a text node (no component re-render); `<Show when={sig}>`. Not available under React Compiler or SSR hydration in v1.
4. **Keyed lists:** `<For each={todos.items}>{(item) => <Card item={item}/>}</For>` renders one memoised `Card` per key subscribed to its own node; the parent subscribes to `ids` only. Works with TanStack Virtual/react-window (`ids.slice(range)` + per-key subscription). Without the compiler, `useItems(coll)` returns stable `ids` and `useItem(coll, id)` per row.
5. React 19: `useOptimistic` bridges to §4.11 (`useOptimisticSlice`), `use(promise)` works on `computed.async` nodes because promises are cached per node, `<Activity>` hidden subtrees keep subscriptions (the store never assumes subscribed = visible), server actions are a `sync` adapter (§8.4).
6. Provider: `<StateProvider store={store}>`; `createStore` in `useState` initialiser or router loader — never at module scope.

### 6.2 Vue 3.5 / 3.6

`useSlice` returns `shallowRef` updated by subscription (`triggerRef` for in-place); `toSignal` bridges signals to `computed`. Pinia coexistence: a slice can be exposed as a Pinia store (`definePiniaStore(slice)`) for teams already on Pinia; devtools timeline integration via `@vue/devtools-api`. Built against public APIs only (3.6 changed internals).

### 6.3 Solid 1.9 / 2.0

Signals map 1:1 (`from(node)`); object graphs via `setStore(reconcile(snapshot, { key }))` or, better, direct node signals — Solid's `<For>` consumes our `ids` directly. Solid 2 `createOptimistic`/`action` map onto §4.11.

### 6.4 Svelte 5

`createSubscriber` bridge (`svelte/reactivity`); store contract (`subscribe`) for legacy; `$state.raw` snapshots. Module-level `$state` export limitation is documented; slices live in context (`setContext`) in SvelteKit.

### 6.5 Angular 20+

A proposed state-node bridge plus `injectSlice(slice)` via DI; native Angular `toSignal` accepts an Observable, not a state node (see the explicit RxJS wrapper in the adapter guide); `@ngrx/signals` `signalStoreFeature` adapter for teams on NgRx; zoneless-safe.

### 6.6 Web Components / Lit

`state/lit` (planned): `StateController` (ReactiveController) + `watch()` directive for pinpoint updates; store discovery across shadow roots via the Context Community Protocol (`context-request`), never `window`. We do not depend on `signal-polyfill`; if a page also uses `@lit-labs/signals`, a bridge exposes our signals through its `Signal` interface.

### 6.7 Qwik

Not a v1 adapter. Constraint documented: only serialisable data crosses `$` boundaries — a snapshot + id-based re-attach recipe is provided.

---

## 7. Rendering modes: SSR, RSC, streaming, islands

### 7.1 Universal rules

- One store per request (`createStore` inside the request handler / loader / `cache()`), disposed after render; `currentScope()` via `AsyncLocalStorage` on Node/Bun/edge with ALS support.
- `dehydrate(store, { include, exclude, serializer })` → JSON (or superjson/devalue codec) of **raw values only**; derived nodes are recomputed on the client; async nodes serialise as pending promises where the framework supports streaming (React 19 RSC/TanStack Start) or as resolved values otherwise.
- Hydration is **per boundary**: `<Hydrate payload>` (React) / equivalent applies its payload before its subtree renders, so streamed routes hydrate independently; `getServerSnapshot` reads from the boundary's dehydrated payload, which is what makes uSES's `getSnapshot === getServerSnapshot` check pass on the first client render. Subscriptions are never queued; a subscription created inside an un-hydrated boundary reads the payload synchronously.
- No `window`/`localStorage`/`BroadcastChannel` at module init; persisters and remote drivers attach on `mount()` only.

### 7.2 Framework recipes (shipped as templates in `state init`)

- **Next.js App Router:** Provider in a client component created per tree; RSC pass initial payload as props; server actions as `sync` mutators; `"use client"` boundaries are the developer's (the compiler never inserts them; `doctor` flags a tracked-mode component imported from a server component); Turbopack via the SWC plugin.
- **Remix / React Router 7:** loader returns `dehydrate()` (promises returned directly for streaming — `defer` no longer exists in RR7); `<StateProvider initial={useLoaderData()}>`; actions as mutators.
- **TanStack Start:** router context holds the store; `HydrationBoundary`-style per-route hydration.
- **Vite SPA / Bun:** single client store; optional SSR via `renderToString` + `dehydrate`.
- **SolidStart / SvelteKit / Nuxt:** per-request store in `event.locals` / `load` / `useState`-payload; same dehydrate/hydrate pair.
- **Astro islands:** slices exported from a shared module create their store lazily on the client only through an in-page registry — the one sanctioned module-level singleton (client-only, documented as such).

### 7.3 Streaming

The store never mutates during render on the server; on the client, per-boundary hydration (§7.1) means later-streamed boundaries hydrate their own slices without touching already-live ones.

---

## 8. Data layer

**Package correction and research (R94):** the earlier `@state/db-ivm` name was a placeholder, not an installed dependency. The actual upstream package is `@tanstack/db-ivm`; its public collection/query layer is `@tanstack/db`. The path **`state/query-tanstack` throughout this spec is a planned adapter**, not an existing package or a claim of drop-in compatibility. The site tests values against `@tanstack/db` 0.8.7 (IVM dependency 0.1.19). [Research, comparison with the intended Rust/WASM engine, differential-dataflow explanation and syntax proposal](/query-research). No benchmark win or unverified capability of the intended engine is inferred from this comparison.

### 8.1 Collection source contract (TanStack DB compatible)

A **source** is `{ sync, onInsert?, onUpdate?, onDelete?, utils?, getKey }` where `sync({ begin, write, commit, markReady, markError })` pushes batches into the collection's synced truth. This is intentionally the TanStack DB _collection options creator_ contract so that:

- their adapters (`queryCollectionOptions`, `electricCollectionOptions`, `powerSyncCollectionOptions`, `rxdbCollectionOptions`, `trailBaseCollectionOptions`) plug into our collections through a thin shim (`fromTanStack(options)`) that synthesises the objects their handlers expect — `{ transaction: { mutations: PendingMutation[] }, collection }` with row-level `original/modified/changes`, `utils.awaitTxId/refetch`, and the `SyncConfig` params incl. `truncate` — by lowering our mutator's patches into `PendingMutation`s per row; and
- our collections can be handed to TanStack DB as a source (`toTanStack(coll)`), so a project already on TanStack DB can adopt our store for UI state without migrating its data layer.
- The targeted TanStack DB contract version is pinned in our manifest (initially 0.8.x); a breaking change upstream means a new shim version, never a change to our own contract.

Rules enforced by the base implementation: subscribe to the live channel **before** the initial fetch and buffer; dedupe by key + version; chunk provider batch limits; `markReady` gates `suspense`/`isReady`.

### 8.2 Live queries and interop

`collection.query(...)` compiles to §4.5's incremental engine. Joins, relation includes and advanced aggregates belong to the optional planned `state/query-tanstack` boundary, not the small core (§4.5). The first integration should use the public TanStack DB query API; `@tanstack/db-ivm` is its lower-level engine, not a drop-in implementation of our store API. Supported operators, indices, batching, optimistic reconciliation and ownership must be verified at the boundary.

### 8.3 Mutations and sync-back

- Actions on a synced collection become **mutators**: `name + validated args` are sent (not diffs), executed optimistically locally (§4.11), re-executed by the server (which may diverge), and confirmed by an ack carrying a monotonic version/txid. The overlay entry is dropped only on ack (`awaitTxId`/`awaitMatch`/refetch) — the flicker-free invariant.
- Handlers `onInsert/onUpdate/onDelete` are the escape for REST-style per-row writes; `optimistic: false` waits.
- Retry policy is a per-source option (`retry: { attempts, backoff, jitter, nonRetriable }`); default: no retry (explicit is better than surprising). When the `outbox` (§8.7) is enabled it owns retry and the source's `retry` is ignored (`doctor` warns if both are set).

### 8.4 Built-in sources (`@state/collections/*`)

**Missing, and blocking a lint rule (R84).** There is no source for the browser environment — viewport size, media queries, online/offline, page visibility, storage events. Today each of those is a `useEffect` in every component that wants it, which means _n_ listeners and _n_ copies of one global, observable, serialisable fact. `browserEnv([...])` is the target the `effect-must-be-dom` rule needs before it can forbid that pattern; forbidding a pattern while offering nowhere to put it is how a lint loses its authority.

`rest` (fetch + polling/ETag; pagination `loadSubset`), `query` (wraps TanStack Query for teams on it), `graphql` (queries + `graphql-ws` subscriptions), `rpc` (typed contract over a transport — tRPC/oRPC/custom; serves SaaS over HTTP/SSE and VS Code over MessagePort with the same contract), `ws`/`sse` (raw streams), `rx` (any `Observable<ChangeBatch>`), `server-actions` (Next/Remix actions as mutators), `electric`, `powersync`, `rxdb` (via their TanStack adapters), `crdt` (Yjs/Automerge/Loro doc → collection with `origin` mapping for history), `local` (in-memory), `storage` (localStorage/IndexedDB cross-tab, no server).

### 8.5 Persistence

`persist` is a per-slice/collection **policy**: `{ where: 'memory'|'localStorage'|'indexeddb'|'opfs-sqlite'|'vscode'|custom persister, include, exclude, transform, version, migrate, ttl, buster, debounce, skipHydration }`. Persisters implement `{ load, save(patches|snapshot), subscribe? }`; delta persisters receive patches, snapshot persisters receive `snapshot()`. Multi-tab: IndexedDB persister is multi-tab safe; OPFS-SQLite requires the worker host (§9.3) and leader election. `transient` nodes never persist unless `include`d explicitly.

**Service Workers are not part of v1 (R70, decision #22).** The Cache API adds little over the ordinary HTTP cache plus a persister, and Background Sync — the one genuine win, replaying the offline outbox (§8.7) after the tab is gone — ships only in Chromium, so depending on it would make the outbox behave differently per browser. The outbox therefore stays in IndexedDB with in-app retry. A `persist/cache-api` module may land later as an explicitly experimental extra for the GET layer of `rest` collections.

### 8.6 URL and routing

`url` module: typed search-param parsers (nuqs-compatible parser API), `push|replace` policy, throttling, `updateFromSource` to avoid cycles; router bindings for TanStack Router (`validateSearch` schema shared with the slice), React Router/Remix, Next App Router, Vue Router, SvelteKit. Browser history entries can carry a `historyKey` so back/forward maps onto §4.10 history groups when desired (opt-in).

### 8.7 Offline outbox

`outbox` module (port of `@tanstack/offline-transactions` semantics): persist the command before dispatch (IndexedDB, localStorage fallback), FIFO replay on reconnect, exponential backoff + jitter, `NonRetriableError`, idempotency keys, leader election via Web Locks so one tab drains; `workbox-background-sync` integration as progressive enhancement only (Chromium-only API).

**Idempotency, and the two mechanisms that must not be confused (R78).** A queue that replays after a reconnect will, sooner or later, deliver something twice — a request that reached the server before the connection dropped looks identical to one that did not. Two separate mechanisms address two separate problems, and they are given separate names precisely so they cannot be merged into one field later.

- **`idempotencyKey` — the wire-level key.** A ULID (or UUIDv7) generated **once, at the call site, when the command is created**, and stable across every retry of _that invocation_. It is part of the persisted outbox record, so it survives a reload, and it is replayed unchanged from a recording, so replay cannot manufacture duplicates. The server contract is the usual one: remember the key for a stated window and return the original result for a repeat.

  **It is deliberately not derived from the command's contents.** The shorthand this requirement arrived with — "some kind of action meaning hash" — has a failure mode that points the wrong way: two genuinely distinct actions with identical arguments, "transfer £10 to Bob" issued twice on purpose, hash the same, and the second is silently discarded. In the banking case that motivated the requirement, silently dropping a real transfer is worse than delivering a duplicate the server can reject. A per-invocation key cannot make that mistake; a content hash cannot avoid it.

- **`submitGuard` — the client-side double-submit guard.** A content hash (command name plus canonicalised arguments) with a short window, default 500 ms, that swallows the second of two identical commands issued by one user gesture — the double-clicked button, the form submitted twice by an over-eager `onKeyDown`. It is local, time-bounded, allowed to be wrong in the safe direction, and **never travels**. Opt-in per action, because "the same command twice quickly" is legitimate for an increment button and a bug for a payment.

The distinction restated, because it is the part worth remembering: the key answers _"is this the same delivery?"_ and the guard answers _"was this the same click?"_. A system that answers the first with a content hash is a system that loses money.

### 8.8 wasm and workers in the data layer

The core and every toolkit module are pure single-threaded JS. wasm appears only inside plugins that need it — `crdt` (Automerge/Loro wasm; Yjs is JS), `persist/opfs-sqlite` (SQLite wasm) — and those plugins run in the `worker` host (§9.3) so wasm instantiation and I/O never block the main thread. No SharedArrayBuffer/COOP/COEP requirement anywhere in the toolkit (brief §3.4).

### 8.9 Retention and eviction

`retain` is a per-slice / per-collection **policy** and `state/retain` the middleware that enforces it — deliberately the same shape as `persist` (§8.5), so the analyser lifts it into the manifest as data. It answers R57: a tab left open for a day must not grow without bound, while walking back through already-seen posts must remain a revalidation, not a cold fetch.

**Nothing evicts unless a policy says so.** There is no global sweep and no default `gcTime` on plain slices; omitting `retain` means the unit lives until its scope is disposed (§4.7). This is what makes the honest floor in "what compiles away" achievable, and it makes eviction an opt-in behaviour a reviewer can find by grepping.

**Eviction units.** The unit is a collection item node, a slice root, or a subtree explicitly marked `retain` — never a property signal. Per-property lazy signals are the thing we cannot afford to annotate: a store with 10 000 items has hundreds of thousands of signals and nine bytes each is already the whole budget.

**Metadata, and what it costs.** Per unit: `lastRead`, `lastWrite` (`Uint32Array` epoch stamps), and a `Uint8Array` flag byte (`sourceBacked`, `localOnly`, `pinned`, `evicted`, `transient`). Subscriber count is **not** duplicated — it is §4.5's existing `interest` refcount, and pending-mutation state is §4.11's `$pending`. For collection items the slot index rides the existing `byId` node, so the marginal cost is nine bytes per item; for path-keyed units a `Map<JSONPointer, slot>` adds ~64–96 B each in V8. Ten thousand retained items ≈ 90 kB of counters. **`lastRead` is not stamped on tracked property reads.** §13 promises zero Proxy traps on the hot path after compilation, so a stamp in the `get` trap would vanish precisely when the compiler is on. It is stamped when `interest` drops to zero (last observer released) and on untracked imperative reads (`getSnapshot`, `store.get`, `peek`), quantised to a coarse epoch counter (default 1 s) so the write is one compare-and-store per unit per epoch. "Last read" therefore means "last released", which is TanStack Query's semantics stated plainly rather than implied.

**Policy vocabulary.**

```ts
type RetainPolicy =
  | 'forever'
  | {
      keep?: 'while-subscribed' | 'forever'; // default 'while-subscribed'
      grace?: number; // ms after interest → 0; defaults to the collection's gcTime (§4.5), else 5 min
      ttl?: number; // ms since last read (epoch-quantised)
      ttlAfterWrite?: number;
      max?: number; // hard cap in units — the reliable one
      maxBytes?: number; // soft cap, estimated from the schema (§4.12), never measured
      policy?: 'lru' | 'lfu' | 'fifo'; // default 'lru'
      evict?: 'value' | 'identity'; // default 'value' if source-backed, else 'identity'
      onRead?: 'revalidate' | 'refetch' | 'undefined'; // default 'revalidate' if source-backed
      pin?: readonly string[]; // ids / JSON Pointers never evicted
      interval?: number; // sweep cadence, default 30 s, idle-scheduled
      duringRecording?: 'off' | 'record'; // default 'off' (§11.4)
      store?: RetentionStore; // pluggable backing map (SWR's cache-provider escape hatch)
    };

const posts = collection(Post, {
  key: 'id',
  source: rest({ url: '/api/posts', etag: true }),
  gcTime: 5 * 60_000,
  retain: { keep: 'while-subscribed', grace: 5 * 60_000, ttl: 30 * 60_000, max: 500, evict: 'value' },
});
```

`gcTime` and `retain` are not duplicates: `gcTime` governs the **source lifecycle** (when the live channel disconnects), `retain` governs **data lifetime**. For a source-backed collection `grace` defaults to `gcTime`, so a project that sets only `gcTime` gets TanStack's behaviour and nothing else changes.

**What eviction does to a node — the whole point.** `evict: 'value'` drops the unit's data and leaves a **tombstone**: the id stays in `ids` at its position, `byId` keeps a node with `$evicted === true`, and the tombstone retains the last known `version`/ETag — three fields in place of a row. A read of a tombstone returns `undefined` for fields and, under `onRead: 'revalidate'`, issues a conditional request; the list re-renders in known order with skeletons and settles on a 304 or a small delta. That is the "walk back without refetch" benefit, preserved as a revalidation rather than a cold start. `evict: 'identity'` removes the id from `ids` and `byId` entirely — the collection forgets the item existed and the next access is a cold fetch. **Identity eviction requires the collection's `ids` node to have zero subscribers and the unit to appear in no live `derive.collection` view**, otherwise a mounted list would visibly shrink; it is the mode for `max`-capped ephemeral collections, not for feeds. Neither level is a domain delete: `remove()` emits patches and is undoable, eviction is a cache operation and is neither.

**Source contract amendment (§8.1).** Revalidate-only needs a capability the TanStack-compatible contract does not have. Sources may implement `revalidate?(keys: { id: string; version?: string }[]): Promise<void>`; the fallback order is `loadSubset({ where: id ∈ keys })` → `refetch()`. A source without either degrades to a collection refetch — the walk-back still avoids a cold _render_ because the ids and their order survived, but it is not a conditional request. `rest` implements it with `If-None-Match`; `query` maps it onto the underlying query's refetch.

**Hard interlocks — nothing with unsynced local work is ever evictable.** Eligibility is not re-derived at sweep time; the owning module holds a pin and the sweeper only reads it. Pinned by: a non-empty optimistic overlay entry (§4.11, `$pending > 0`); a queued or in-flight outbox command referencing the unit (§8.7); an unflushed `persist` debounce window (§8.5); a live history entry whose forward **or** inverse patches target the unit (§4.10). Local-only units (no source) may only be evicted to `value` when a persister owns them — then eviction is a page-out, not a loss, and a re-read hydrates from disk (synchronously for `localStorage`, as a resolving tombstone for IndexedDB/OPFS). Evicted from memory but present on disk is the desirable steady state, not a degenerate one; `retain` + `persist` compose into a two-tier cache where each tier revalidates the one below.

**Decorators — the lifetime at the call site.** The primitive is a **lease**: `const l = store.retain(node, { grace })` / `l.release()`, plus `store.evict(node, { level })` and `store.sweep(def)`. Everything else is sugar over it, so projects never write bespoke eviction actions.

```tsx
export default withRetention(PostPageView, {
  lease: (p: Props) => [posts.item(p.postId), comments.forPost(p.postId)],
  keep: 'mounted',                              // 'mounted' | 'route' | 'session'
  grace: '5m',                                  // TTL after the last lease releases
  evictOn: ['posts.publish', 'auth.logout'],    // command names: its data changed → drop to tombstone
})

useRetained(posts.item(postId), { keep: 'mounted', grace: '5m' })   // hook form
<Retain of={posts.item(postId)} keep="route" grace="5m">…</Retain>  // boundary form
```

`evictOn` is the non-magical spelling of cache invalidation on mutation: static command names the analyser reads, no interceptor, no convention. The analyser resolves _which collections_ a decorator leases (syntactically, from the `lease` body) but not _which items_ — the item selector is a runtime closure, and the manifest records it as dynamic. The React shape is shown; every adapter exposes the same lease in its idiom (Vue composable, Solid `onCleanup`, Svelte `$effect`, Angular `DestroyRef`).

**Patches, replay, SSR.** Eviction emits **no patches**. Emitting `remove` ops would replicate one tab's memory pressure to every replica (§9) and instruct the persister to wipe the disk copy — the exact inversion of what eviction is for. It is published on the bus as a `retention` event (`{ type: 'evict' | 'rehydrate', path, level, reason }`) outside both logs: not retained, not replicated, not undoable. Rehydration is the opposite case and _does_ patch: it writes through `sync.write/commit` as ordinary `origin: 'sync'` transactions, idempotent for persisters and replicas alike. Eviction is time- and pressure-driven and therefore non-deterministic, so `record` (§11.4) disables it by default (`duringRecording: 'off'`, the same precedent as disabled `useLocal` lowering in §4.9); `'record'` drives sweeps off the recorded logical clock and stores eviction events on the environment track, for reproducing memory bugs. On the server the middleware is a no-op — a request scope is disposed wholesale — and on the client sweeps are suspended until hydration settles, or a unit the server rendered could be evicted before the client subscribes.

**`doctor` checks:** `evict: 'value'` on a local-only unit with no persister (data loss); `retain` with `events: 'none'` where `evictOn` needs the command log; `max` on a collection whose `ids` are permanently subscribed (the cap can never be reached).

**What compiles away.** With no `retain` policy and no retention decorator anywhere, `state/retain` is never imported (0 B), no side table is allocated, and the manifest carries no retention entry. Uncompiled, the honest floor is a single monomorphic `store.retention !== undefined` branch on the lease-release path — not zero, but off the tracked read path entirely, and inside noise on the React microbench. With a policy declared: keep-while-subscribed + TTL ≈ 1.5 kB min+gz; LRU/`max` adds an intrusive list, ≈ +0.7 kB; `lfu` and `maxBytes` estimation are separate entry points. Within §13's ≤ 2 kB per-toolkit-module bar for the common configuration.

_Lineage (R65):_ grace-after-last-observer-unmount is TanStack Query's `gcTime` and its refcounted observers, moved from query-key granularity to per-item nodes and given a tombstone so the return trip is a revalidation rather than a refetch (TanStack keeps the whole entry or nothing); `keepUnusedDataFor` + subscription counting is RTK Query's, same shape at endpoint level. The lease pair is Relay's `retain`/`dispose` near-verbatim, and `grace` is specifically Relay's `gcReleaseBufferSize` — an LRU buffer of recently released queries — expressed as time rather than count; we bind leases to component/route boundaries by decorator instead of acquiring them per query by hand. Apollo supplies the imperative `cache.evict` primitive, which we keep; we reject its `cache.gc()` reachability tracing as a default, because tracing costs O(store) while eviction should cost O(evicted), and a proxied tree with opaque `ref()` values has no root set worth walking. SWR's pluggable cache provider is right that the backing map should be replaceable (`retain.store`) and wrong that this is the whole answer — pushing policy into userland is precisely the "every project invents its own eviction" failure R57 names. LRU is the default because back-navigation is recency-shaped and a single epoch stamp pays for it; LFU resists the scan pollution LRU suffers but needs frequency counters and decay, so it is opt-in, and W-TinyLFU (Caffeine) is the implementation to copy if it ever becomes the default. Pure TTL is refused as a default — it bounds age, not memory. From GC literature only the generational clock earns its place: epoch stamping is card-marking, and the nursery/tenured split (units surviving N epochs swept at a coarser cadence) is a cheap sweep-cost reduction we have left out of v1. `WeakRef`/`FinalizationRegistry` are **not** a solution: collection timing is unobservable and never prompt, callbacks may never run, and a node reachable from the store's own `byId` map is by construction never collectible unless the map itself is weak — which forfeits `ids` ordering and iteration. They appear in devtools only, as a leak detector that reports units outliving their declared lifetime.

**Open decisions (§19 candidates).**

1. Whether undo may become asynchronous to rehydrate an evicted unit. Today a live history entry pins its targets, which means `history.limit` silently bounds retention; the alternative (`history.rehydrateOnUndo`) makes undo await a revalidation and is not decided.
2. Whether derived views and live queries (§8.2) are eviction units at all. "Recomputable, therefore free" is false for a large incremental view whose IVM state is the expensive part; a per-view cap may be needed.
3. Whether schema-weight estimation is accurate enough for `maxBytes` to be worth shipping, or whether it should wait for an opt-in measurement pass. `max` in units is unaffected either way.
4. Whether `keep: 'route'` belongs here or with the task scopes in §4.15 — it is the same route scope object, and only one of the two sections should own its lifetime.

---

### 8.10 The query layer (R32)

Complex derived state is intended to move out of hand-written selectors and into declarative queries against a Datomic-like database written in Rust and compiled to wasm — Danny's, and the reason R32 exists. This section specifies **everything decidable from our side** and names, at the end, the small number of things that are his to answer. It is not marked TBD any longer, because most of the contract is a property of our store rather than of his engine.

#### 8.10.1 What it replaces, and the measured size of the problem

The gnarliest code in a Redux-era application is the derived-data layer: chains of hand-memoised selectors, each depending on the last, each needing its own tests and its own equality reasoning. §4.13's `derived` already removes the memoisation tax for a chain of computeds. What it does not remove is the _shape_ of the work — a filter, a sort and a group written as three functions that must be composed by hand and re-derived whenever the question changes.

The measurement that motivates going further is in `docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md`: for one filter-sort-group over 10 000 rows, recomputing on every change costs 110 ms per 200 single-item updates against 1.8 ms maintained by `derive.collection` — the real primitive, paying the full store path — for a ratio of about 61×. Two honesty notes travel with that number and must keep travelling with it (R66). It is **one query shape on one machine in a prototype**, so it is a direction rather than a product figure. And it is a measurement of _our own_ incremental primitive, not of a Datalog engine: R32 adds query planning on top of what `derive.collection` already pays, and nothing here predicts what that costs. What the number establishes is that the incremental direction is worth an engine.

#### 8.10.2 What a query layer does not replace, from a corpus of real selectors

Before the contract, the boundary — because a survey of production code moved it. `docs/research/2026-09-04-selector-corpus-and-datalog-mapping.md` reads twenty-two selector chains from seven real applications (Signal-Desktop, Mattermost, Gutenberg, Zulip, Mastodon, Radarr, Grafana), classifies them, and maps each shape onto Datalog. Four of its findings change what this section may claim.

- **Sorting is in six of the twenty-two chains, and it has to be maintained, not applied.** Sorting sits behind filtering (twelve) and joining (seven), level with aggregation, and three of the six sort on a locale-aware collation. Datomic's dialect returns unordered sets — no `order-by`, `limit` or `offset` — but that is a property of one dialect, not of Datalog: LogicBlox, Soufflé and Differential Datalog all order, and an engine can add an ordering clause. The finding that survives regardless of dialect is about _where the sort runs_: sorting a returned set on the client afterwards discards exactly the incrementality §8.10.1 measured. So **ordering must be an incrementally maintained part of the view**, either as a clause the engine maintains (which is now one of §8.10.7's questions for Danny) or in §4.5's `derive.collection`, which already maintains a sorted view from patches, with the query feeding it. Radarr, which hand-rolled its own query interpreter, built ordering in with primary and secondary keys for the same reason.
- **Two shapes do not map at all, and one of them is ordinary.** A sequential scan that emits synthetic rows — a chat timeline inserting date separators and a "new messages" marker — and run-length collapsing of consecutive rows both need a notion of a tuple's neighbours, which Datalog does not have (SQL needs window functions; Datomic has no equivalent). These stay imperative, and the spec says so rather than discovering it during implementation.
- **The strongest argument for the query layer is not speed.** Roughly half of one 61-line Mattermost selector is memoisation plumbing — per-category selector instances, a `lastCategories` cache, a `shallowEquals` pass — and three other chains end in a line whose only job is to return the previous array unchanged. That code has no Datalog counterpart because it ceases to exist. Its own authors documented the remaining problem in a source comment: every unrelated preference change reorders and re-filters the whole list.
- **Time-dependent derivation is unsolved on both sides.** Signal and Mastodon independently compare entity timestamps against "now" inside a memoised selector, and Signal's own comment concedes the result goes stale. Passing `?now` as a query input makes the predicate expressible and does nothing about _when_ the view recomputes. Not a selector problem, and not one the query layer fixes.

**Recursive traversal is the one shape where the query form is unambiguously better**: Gutenberg's splice loop for descendants and `while` loop for ancestors are three-line Datalog rules each — though the document order the splice exists to produce runs straight back into the sort problem.

#### 8.10.3 Where it sits

The engine runs **inside the worker host** (§9.3), not on the main thread, for the reason §20.8 gives: an object graph in wasm loses because every read crosses the boundary, but a query engine wins because a great deal of work happens per crossing. A query is one message out and one result in; the rows it scanned never cross at all.

That places three things on our side of the line and they are the contract:

- **Feeding it.** The engine's view of the data is maintained from our patch stream. A committed transaction (§4.4) already carries exactly the deltas an incremental engine wants, so the adapter forwards patches rather than snapshots. This is the same shape §8.9's tombstones and §4.5's `derive.collection` already consume — a third consumer of one stream, not a new mechanism.
- **Addressing it.** Entities are identified by the collection key (§8.1 `getKey`). §4.13.6 already requires a composite key to serialise stably because patch paths embed it; the query layer inherits that constraint rather than adding one.
- **Reading from it.** A query is exposed as an ordinary `derived` node (§4.13.1). Application code and components cannot tell a Datalog-backed derivation from a computed one, which is the point: the query layer must be swappable for `state/query-tanstack`, the pure-JS stopgap with the same surface, so a project can adopt queries before adopting wasm and so tests can run without it.

#### 8.10.4 What the boundary costs, and the rule that follows

Every result crossing back is serialised. That makes **result size, not query complexity, the thing to watch** — a query returning ten aggregate rows is cheap however hard it worked; one returning ten thousand entities is expensive however simple it was. Two consequences are specified rather than left to discover:

- A query returns **ids by default**, and the items are read from the collection already in the main thread. This is §4.5's `ids` + `byId` split applied across the worker boundary for the same reason it exists within a store, and it keeps the crossing proportional to the _answer_ rather than to the data.
- A live query pushes **deltas, not results**: enter, update, exit against the previous answer. A result set that is stable between updates costs nothing to keep current, which is the property that makes a subscribed query cheaper than a recomputed selector even before the engine's own incrementality is counted.

#### 8.10.5 History, and why this fits rather than collides

Datomic's most relevant idea is not its query language but that **history is first-class**: every fact is stamped with the transaction that asserted it, and "as of transaction T" is an ordinary query rather than a feature. Redux never made this convenient even with middleware.

We already have the raw material — the patch log is an ordered record of every change with its command (§4.4, §4.6) — and the two must be reconciled explicitly, because there is a real trap in treating them as one thing. **The patch log is not a database history.** It is bounded (§8.9 retains a window), it is per-client, and undo _rewrites the future_ rather than appending to the past. A query engine that assumed the patch log was an immutable append-only history would give wrong answers after the first undo.

So: the engine keeps whatever history it keeps, our patch log stays what it is, and the mapping between them is a stated adapter concern — a transaction id in the engine corresponds to a commit in our log while that commit is still retained, and to nothing once it is not. Undo appears to the engine as a new transaction asserting the inverse, never as a rewind, which is the same rule §4.10 already applies for replication.

#### 8.10.6 Adoption, staged

- **`state/query-tanstack` first.** The pure-JS engine with the same query surface, so the shape can be proven, the fixture in §13.1.7 can be re-run against a real engine, and no project is blocked on wasm.
- **The wasm engine as a source swap**, enabled per project by config once §13.1's harness shows it beating the JS path on that project's own data (the same measured-not-asserted rule §20.8 applies to columnar collections).
- **Never both at once** in one project — `state lint` treats the engine as an axis, like every other single-approach invariant (§11.2).

#### 8.10.7 What is Danny's to answer

Six questions, and they are genuinely his rather than ours:

1. **The query surface.** Datalog in what concrete form — EDN-shaped data, a tagged template, or a builder? Our side only requires that it be _data_ rather than a string, so the analyser can see a query's inputs and outputs and the compiler can fuse chains (D-rxjs).
2. **Incremental maintenance guarantees.** Which query shapes are maintained incrementally and which fall back to recompute. Aggregates and joins usually differ, and the honest answer shapes what we recommend rather than what we hide.
3. **The transaction and history model** the engine exposes, against §8.10.5's constraint that our log is bounded and rewritable by undo.
4. **Failure modes.** What a query does with a partial entity (§4.13.6's unsolved case), an unknown attribute, or a schema the client has not yet seen.
5. **Ordering.** Whether the engine can maintain an `order-by` (with `limit`) incrementally, including locale collation, or whether ordering is ours to keep in the derived-view primitive. The corpus in §8.10.2 makes this the most common stage after filter and join, so the answer decides the shape of every list.
6. **Bundle and startup cost** of the wasm module, against §13's budgets — a query engine that costs more to load than the selectors it replaces is a loss for small applications, and the threshold is a number, not a feeling.

Until those are answered this section specifies our half only, and the JS stopgap is the path that does not wait. Datomic query reference, as the shape being targeted: <https://docs.datomic.com/query/query-data-reference.html>

## 9. Remote replication and topologies

### 9.1 Protocol

`remote` module replicates a slice between one **leader** and N **replicas**. v1 has exactly one mode: `command` — replicas forward commands to the leader, the leader applies them and broadcasts patches `{ seq, txId, patches, cause, origin }`; replicas apply them as `origin: 'remote'` transactions (excluded from local history by default). Replicas may apply a command optimistically (§4.11 overlay) and reconcile on the leader's patch carrying the same `txId` — this is what removes Hyper's `mergeInitState` race: a replica's local selection is an overlay entry until the leader's echo confirms or supersedes it, so a stale `state:init` can never wipe it. Peer-to-peer patch exchange without a leader is out of scope (no clock to order patches); multi-tab always elects a leader (§9.3). Full wire protocol in Appendix B.

### 9.2 Transport drivers

`{ post(msg), onMessage(cb), close() }` with drivers: VS Code webview (`acquireVsCodeApi().postMessage` / `webview.postMessage`, JSON only, binary as separate `ArrayBuffer` messages), `BroadcastChannel`, `MessagePort`/Worker, `chrome.runtime` (browser extensions), WebSocket, and `vscode-messenger` (typed request/notification + broadcast) when present. Payload budget: ≤ 10 KiB per steady-state patch message, larger patch sets chunked per frame; snapshots/resync payloads are sent whole up to 4 MB (VS Code JSON limit headroom) and chunked at 256 KiB above that without frame pacing.

### 9.3 Topologies

- **VS Code:** extension host = leader (formalising today's `StateHub`); each webview = replica; `retainContextWhenHidden` not required. A hidden, non-retained webview is _destroyed_, so the leader keeps a bounded buffer per replica (default 500 patches / 256 KiB) only for the `retainContextWhenHidden` case; a re-created webview sends `hello { lastSeq }` (its `lastSeq` kept in `vscode.setState`) and receives either `resync(fromSeq)` patches if still buffered or a full `snapshot`. `vscode.setState` otherwise receives only the small persisted UI slice.
- **SaaS single tab:** no remote; optional `worker` host runs collections + persisters + outbox in a dedicated Worker (patches over MessagePort) to keep the main thread free.
- **SaaS multi-tab (opt-in):** `worker: 'shared'` runs the leader in a SharedWorker (no election needed — the browser guarantees a single instance); where SharedWorker is unavailable (Chrome Android) the fallback is a dedicated Worker per tab with a Web Locks-elected leader tab; UI slices replicate in `command` mode over `BroadcastChannel`/`MessagePort`. Single-tab is the default.
- **Server-authoritative (Electric/Zero/PowerSync):** the collection source is the leader; `remote` is not involved.

---

## 10. Devtools

_Sections 10.1–10.5 (the devtools host, its transport, the timeline, the subscription map and the recording panel) are not yet written; 10.6 is numbered ahead so that references to it from the comparison and the traceability table stay stable when they are._

- Everything the devtools show comes from the **transaction stream** (§4.4) plus the manifest (§5.1). No whole-state serialisation per action; state is inspected lazily by path (`inspect(path)` returns a handle; expanding a node fetches its snapshot). Diffs are computed from patches, in a Worker for large transactions.
- Panels: transaction timeline with cause chains (Reatom idea) and command/patch toggle; slice/collection tree with virtualised rendering; time travel by replaying patches (with `transient` filtering and sampling for high-frequency events); subscription map (which components subscribe to which paths — the answer to "why did this re-render"); sync/outbox status; history stacks; replication seq/lag per replica.
- Hosts: TanStack Devtools shell plugin (in-app, framework-agnostic, stripped by their Vite plugin), a VS Code webview panel (reuses the same UI over the §9 transport — this is Hyper's native home for it), a Redux DevTools bridge for familiarity (`maxAge` + sanitisers on by default), and `window.devtoolsFormatters` for console inspection of proxies/nodes.
- Protocol is versioned; history capped by bytes, not count.

### 10.6 Devtools maps

R45: names and internal values must **always** resolve in our devtools, with zero runtime overhead. The mechanism is a build-time metadata file — a devtools map — written beside the bundle and never shipped to users.

#### 10.6.1 Why React DevTools fails at this

React hook state is a linked list of `memoizedState` records on the fiber. Those records carry values and update queues; they carry no names, because names never survive to runtime. To display `const [count, setCount] = useState(0)` as `count`, the "parse hook names" feature must, in the browser: fetch the bundle's source map, obtain the original source (from `sourcesContent`, or by fetching the original file), parse it with an AST walker, and locate the hook call at the mapped position to recover the identifier. That is a network fetch plus a parse per component — which is why it is a button and not a default — and it fails when the map has no `sourcesContent` and the original is not servable, when the hook is wrapped in a custom hook so the call site is not where the name is, and when bundler output has been re-mapped enough that the position no longer lands on the declaration. It is source reconstruction, performed by the consumer, at inspection time.

Ours is not. The identifiers in the map are emitted by the same analysis pass that emits the ids the compiled code contains (§11.1) — a by-product of the build, not a reconstruction of it. Resolution in devtools is a key lookup in a loaded object. It cannot fail on wrapping, on missing `sourcesContent` or on a re-mapped position, because it never consults positions to establish identity. The one way it can be wrong is staleness, and §10.6.3 makes staleness detectable rather than silent.

#### 10.6.2 The artefact

`state.devmap.json`, written to `dist/.state/` alongside `state.manifest.json`, chunked one file per entry point (`state.devmap.<entry>.json`) with a small index in the `sections` style of source-map v3 index maps.

```jsonc
{
  "version": 1,
  "buildId": "01J9ZQ4K7T", // identical to the constant in the bundle
  "manifestHash": "sha256:…",
  "strings": ["todos", "src/state/todos.ts", "toggle", "Feed", "pushSync", "Done"],
  "nodes": {
    "t8f2a1": { "kind": 0, "name": 0, "path": "todos", "src": [1, 12, 9] },
    "f31b70": { "kind": 1, "name": 5, "path": "todos.byId.*.done", "src": [1, 19, 3] },
    "a19c04": { "kind": 2, "name": 2, "path": "todos.toggle", "src": [1, 31, 2], "writes": ["todos.byId.*.done"] },
    "e77b21": { "kind": 3, "name": 4, "path": "todos.pushSync", "src": [1, 44, 2], "writes": "dynamic" },
  },
  "components": {
    "C_4b71": { "name": 3, "src": [7, 4, 0], "subscribes": ["todos.ids", "ui.filter"] },
  },
  "schema": { "todos.byId.*.done": { "label": 5, "type": "boolean", "sensitive": false } },
}
```

`kind` is an integer code (slice, field, action, effect, complex, derived node, collection, task, component). `name` and `label` index the string table; `src` is `[fileIndex, line, col]`. Coordinates are **original source — decided, not open**: the id is produced by a pass already reading the original file, so original coordinates are what it has, whereas generated coordinates would need re-mapping on every rebuild and then need the ordinary source map anyway to be useful. The devmap therefore carries no `mappings` and duplicates nothing; stack traces continue to go through the ordinary source map. Two artefacts, two jobs.

`components.subscribes` is a **static, slice-level approximation** and marked as such — §4.3's read paths are recorded at runtime, so the map states which nodes a component can read, not which it read this frame. Like `writes`, a component whose reads cannot be bounded statically is marked `"dynamic"` rather than guessed at.

Keys are SIDs: a truncated hash of project-relative file path, declaration start position and declared name, in Effector's scheme. **This section decides that the SID is the toolkit's build-time identity**, not only a devtools key — §4.6's command log entry becomes `{ sid, name? }` with the human `name` string emitted in dev and uncompiled builds only, §9.1's wire protocol addresses slices by SID across processes, and §8.5's persist keys are SIDs so they survive minification. That is what makes zero overhead structural rather than a promise: the id bytes are paid for by features that have nothing to do with devtools, and the map itself adds none. It also creates a real dependency — the command log in a compiled production build is unreadable without a devmap, which is precisely the trade R45 asks for.

#### 10.6.3 Zero runtime overhead and staleness

The production bundle carries the SIDs it needs anyway plus exactly one devtools-related constant, `buildId`. There is no trailing `//# stateDevMapURL=` comment in production output — a reference is both a leak and a promise to serve the file; in dev the comment is emitted, because the dev server serves the map at `/@state/devmap` regardless. Devtools obtain the map in one of three ways, all keyed by `buildId`: from the dev server; from the project's `dist/.state/` (the VS Code panel, §10); or from an internal devtools host to which the build uploaded it, fetched by build id — the Sentry debug-id flow.

If no map resolves, devtools show SIDs verbatim under a visible banner. If a map resolves but its `buildId` does not match the bundle's, it is **refused, not merged** — a partially correct name table is worse than none — and the banner names both ids. `manifestHash` additionally ties the map to the manifest that `lint`, `bench` and `doctor` read, so a recording (§11.4) pinned to a build hash resolves against the right map or against none.

#### 10.6.4 Format

A purpose-built JSON document, not a source-map v3 envelope with a custom section. The v3 payload is `mappings`, a VLQ position-to-position encoding; our lookup is id-to-record, so riding the envelope means shipping an empty `mappings` and putting the entire content in a custom key. Custom keys are convention only — `x_google_ignoreList` shows both that they can exist and that consumers treat unknown keys as droppable, and bundlers rewrite and merge maps in passes we do not control. A map that survives a bundler by luck is not a design. What we borrow from v3 is the index-map `sections` shape for chunking, and nothing else. Size discipline: names and file paths interned in one string table, integer kind codes, one chunk per entry point, gzipped at rest. The budget is a §13-style row — target ≤ 5 % of the entry's uncompressed JavaScript (budget, not measurement, R66). No end user ever fetches it, so its size is a developer-experience number, not a bundle number.

#### 10.6.5 What it enables beyond names

Time-travel labels: each transaction in the timeline is titled with its command and slice rather than an id. Cause chains render as `todos.toggle → todos.pushSync` instead of `a19c04 → e77b21`. The `writes` index, inverted at load, answers "what writes this path" for the MCP server (R25) and for the subscription-map panel, with unprovable writers marked `"dynamic"` so an agent gets an honest gap rather than a confident wrong answer. Dev-mode error messages take an id from the runtime and print `slice "todos": write outside an action (strict mode)` instead of the SID.

#### 10.6.6 Security

The devmap describes an application's internal structure: every slice and action name, every path each component can read, and schema labels. It must not be deployed publicly, and the build makes that the default rather than a warning in the docs. Output goes to `dist/.state/`, outside whatever the framework treats as public static output; `state build` refuses to write it into a directory it detects as publicly served (`public/`, `static/`, the framework's configured asset directory) unless `--devmap-out` names that path explicitly; and `state lint` fails CI when a `*.devmap.json` is found under a public path. Publishing the map to a devtools host is an explicit upload step, never a side effect of `build`.

_Lineage (R65):_ Effector's SID plugin is the closest precedent and the direct source of the identity scheme — a Babel plugin injects a `sid` argument into `createStore`/`createEvent`/`createEffect`, hashed from file path plus declaration position, and uses it for SSR scope serialisation and devtools; the difference is that Effector also ships the human name into the bundle, whereas we ship only the id and keep names in the map. Sentry's debug-id proposal supplies the staleness mechanism verbatim: a constant injected into the artefact, matched against a sidecar uploaded at build time. Source maps v3 supply the `sections` index-map shape we chunk with and, in `x_google_ignoreList`, the evidence that custom envelope keys are convention rather than contract. Redux DevTools is the alternative we reject: it reads well because `action.type` is a string literal minifiers leave alone, making name quality exactly as good as developer discipline and costing bundle bytes. XState serialises the machine definition into the bundle — complete names, paid for at runtime. Vue devtools recovers component names from `__name` injected by the SFC compiler in dev, with filename inference as fallback; it degrades under minification, which is the failure mode a build-time map removes.

**Open:**

1. Whether declarations need a manual `id:` override. Moving a declaration changes its SID, which breaks an old recording's references and, now that persist keys are SIDs, a persisted payload's; a name-and-path fallback covers the common case, but a long-lived key may want an id that survives a file move.
2. Whether hosted internal devtools receive the map by build-time upload or fetch it from the deploy. Upload needs a store and an auth story the toolkit does not otherwise have.
3. Whether `writes` should attempt flow analysis beyond provably static writes, or stay deliberately limited and mark the rest `"dynamic"`.
4. Whether the devmap should subsume `state.manifest.json` — both are build-time metadata keyed by the same build, and two files invite divergence. They are separate here because the manifest is an input to `lint`/`bench`/`doctor` and is reviewed in diffs, while the devmap is a generated artefact nobody reads by hand.

---

## 11. CLI, analyser, agent tooling

### 11.1 Shared analyser

**Two engines, split by whether a task needs type inference (decision #23).** The Rust core (`state-analyzer`, SWC/Oxc-based) does everything answerable from syntax and usage: it finds `defineSlice/defineComplex/collection` call sites, extracts their declarative options into the manifest, resolves which toolkit modules and adapters are referenced, classifies components by read pattern (§5.3), and exposes AST edit operations. It ships as one binary, embedded by the bundler plugins and invoked directly by the Python CLI. A TypeScript sidecar (`@state/analyzer-types`) wraps the TypeScript program and starts **only** for the features that genuinely need the checker — typia-style validator generation from types (R49, decision #17), LSP hover showing resolved types, and the migrations whose codemods need inference rather than syntax. There is no shipped Rust TypeScript type checker today, and Microsoft's own native port (`tsgo`) is Go, not Rust — so this boundary is a fact about the ecosystem rather than a preference, and it should move as `tsgo` exposes a usable checker API. What the analyser does: it finds `defineSlice/defineComplex/collection` call sites, extracts their declarative options into the manifest, resolves which toolkit modules and adapters are referenced, classifies components by read pattern (§5.3), and exposes AST edit operations (add/remove/replace slice options, rename slices, move fields, extract complexes). The compiler, the CLI, the LSP plugin and the MCP server are all thin clients of it — the TypeScript language-service model.

### 11.2 `state-cli`

- `state init` — interactive: detects framework/bundler/package manager, asks which toolkit parts to enable (sync source, persistence, history, URL, devtools host, worker topology), **records every choice as an invariant in `state.config.yaml`**, installs adapter packages, adds the compiler plugin and `state lint` to CI, scaffolds a first complex from a template (or from an existing REST endpoint / OpenAPI / GraphQL schema → typed collection).
- `state migrate <subcommand>` — **planned, implementation pending under HYP-1457**. The following describes the intended contract: **a family of subcommands, not one command with every option** (decision #16, R40): the scenarios below are different migrations and a single flag soup cannot hold them. All of them target ≥80% automation via AST + LSP, accept `--analyze` (inspect the repository first and recommend the target configuration), run whole-project or scoped to a directory/slice, are reversible where no information is lost, print what they could not migrate automatically, and offer an **optional LLM post-processing step** (`--llm`) constrained to the diffs the codemod could not complete and reviewed as a normal diff.
  - `state migrate from <lib>` — another library or approach → ours: `zustand|jotai|valtio|redux-toolkit|react-query` and plain `useState`+`useEffect`+`fetch` hooks (Zustand store → slice, RTK slice → slice with `events: 'commands'`, React Query `useQuery` → `rest` collection, hand-rolled fetch hook → collection). Whole-project or piece-by-piece.
  - `state migrate shape <hooks|multi-store|single-store>` — switch between our own usage shapes.
  - `state migrate slice <name> …` — change one slice's options, e.g. `state migrate slice todos --sync electric --to manual` (removes the source, generates explicit `onInsert/onUpdate/onDelete` typed handler declarations requiring manual implementation of write logic the codemod cannot infer).
  - `state migrate mode …` — react/events mode changes, e.g. `state migrate mode react tracked→snapshot`, `state migrate mode events none→both`.
- `state build` — the compiler as a standalone step (for bundlers without a plugin) and for producing the manifest.
- `state lint` — **enforces the invariants in `state.config.yaml`**: exactly one approach per axis is in use (no mixing tracked and snapshot modes outside configured globs, no second store library creeping in, no source type outside the allowed list, no ad-hoc `fetch`+`useState` data fetching where collections are mandated, no toolkit module imported that the config doesn't allow — the mixes that conflict semantically and bloat the bundle). Violations are errors in CI; `state migrate` is its `--fix`: normalising a violation means running the corresponding codemod (e.g. rewrite a stray Zustand store into a slice, rewrite a hand-rolled fetch hook into a collection). Ships as both a CLI command and an ESLint plugin (`@state/eslint-plugin`) so violations surface in the editor.
- **`state lint` rules against effects (R84).** Two rules, because one blanket ban is a rule people switch off. **`no-effect-for-state`** (error) fires when an effect's body both reads state and writes state, or reads state and writes the non-DOM outside world — network, storage, URL, analytics. Its message names the replacement and the path, never just the offence. **`effect-must-be-dom`** (warn by default, ratcheting to error per glob through an `effects` axis in `state.config.yaml`) fires on any surviving `useEffect`.

  **The line between them is scheduling, not taste.** Declared reactions run in bus phase 4 — post-commit, drained in a microtask, _before React has rendered the state that triggered them_. So an effect whose body needs the DOM to reflect the last render has nothing in the store to attach to, and giving it one would mean a second scheduler that knows about framework rendering inside a framework-agnostic store — the coupling §4.15.6 already refuses. The criterion is what the body **needs**, not what its trigger is: scrolling a newly selected row into view is state-triggered and survives, because it measures a node that exists only after the render; a `matchMedia` subscription is DOM-triggered and does not, because its body only writes state.

  **The escape hatch is a renamed import, not a suppression comment.** `useDomEffect(ref, fn, deps)` — the signature forces the ref, which makes the claim partly checkable rather than purely asserted, and `grep -c useDomEffect` is a health number CI can ratchet down. A suppression comment is invisible in aggregate and disables the whole rule for the line. The honest cost: a determined author passes a ref holding a number and nothing catches it.

  The full catalogue — fourteen reasons an effect gets written, the declarative target for each, which are mechanically rewritable, and the three that legitimately survive — is `docs/research/2026-09-04-useeffect-patterns-and-declarative-equivalents.md`. Its migrations extend `state migrate from`, which already lists plain `useState`+`useEffect`+`fetch` hooks as a source idiom; no new subcommand.

- `state doctor` — advisory checks (warnings, not gate): module-level singletons, proxies in hot loops, `ownKeys`/spread on proxies, React Compiler conflicts (tracked mode under compiler), missing `getServerSnapshot`, `transient` state persisted, sync handlers resolving before ack, unbounded history; `--explain <Component|slice>` prints the compiler's decisions. Rule of thumb: `lint` = "this violates what this project chose", `doctor` = "this is probably a mistake anywhere".
- `state bench` — runs the §13 budgets against the real project: bundle size per entry, js-reactivity-benchmark scenarios on the project's own slices, krausest-style list ops on its largest collection, `postMessage` payload sizes, and fails CI on regression.
- `state lsp` — language-service plugin: hover shows a slice's modes/sources, code actions call `migrate` codemods, diagnostics from `doctor`.
- `state docs <query>` — full-text + semantic search over the toolkit docs and the project's manifest, for humans and agents (R36).
- **CLI shape (R36/R37):** every command runs as an interactive TUI (rig-ecosystem style) and in machine mode (`--json`); the CLI shell is Python in the rig style. It invokes the Rust compiler/analyzer binary directly — no long-lived service, no JSON-RPC, the ruff/uv shape — and starts the TypeScript sidecar over JSON-RPC only for the type-driven subset (§11.1, decision #23, superseding #14).

### 11.3 Agent MCP server (`state mcp`)

Tools exposed over MCP (usable from Hyper's own MCP setup, Claude Code, Cursor, etc.):

- `state.search({ query })` / `state.describe({ slice })` — manifest + types + sources + which components read what.
- `state.edit({ op, target, args })` — the analyser's AST operations (add field, change source, enable history, extract complex), returning a diff.
- `state.dump({ collection, source: 'backend'|'dev'|'snapshot', filter })` — pulls data through the collection's `sync` into a fixture file (JSON/TS), redacting by schema annotations (`sensitive: true`).
- `state.mock({ collections, from: fixture|recording })` — generates a dev-server mock (MSW handlers or a `local` source) from fixtures or from a recorded session's command log (§11.4), including latency/failure injection.
- `state.replay({ recording })` / `state.record()` — drive the store from a recorded transaction stream in a headless scope for reproduction and tests.
- `state.doctor()` / `state.bench()` — same as CLI, structured output.

### 11.4 Recordings (debugging user problems, R16)

`record()` captures the transaction stream (commands + patches, transients sampled), the manifest hash, and adapter events (sync acks, failures), with schema-driven redaction. A recording replays into a fresh scope (`replay()`), in tests, in Storybook, or in devtools time travel. Hyper attaches recordings to bug reports and telemetry (PostHog already in the stack) behind consent.

### 11.5 Mocks and fixtures

Fixtures are typed by the collection schema; `state.mock` and `state init --mock` generate MSW handlers (browser + Node) or a `local` source pre-filled from fixtures, with `faker`-style generators derived from the schema for empty collections.

---

## 12. Testing, Storybook, forms

### 12.1 Unit and integration tests

- `createTestStore(complexes, { initial, sources: mocks, now })` gives an isolated scope per test; no module singletons means no reset hooks. Dumb components are tested by rendering them with a `<StateProvider store={testStore}>` and asserting on snapshots or emitted commands (`expect(store.commands).toContainEqual(...)`) — actions and UI can be tested in isolation because logic lives in slices/complexes, not in components (R15, R18).
- `store.tick()` drains the bus listener queue (effects and framework notification are already synchronous, §4.1); fake timers cooperate with `mergeInterval`/debounce.
- Property/replay tests: any recording is a test input.

### 12.2 Storybook

`withState(complexes, { initial | recording })` decorator creates a store per story; `argTypes` map onto slice fields; a Storybook addon shows the transaction stream. Stories can start from a recording at a given transaction (R17).

**Capture from a live app (R75).** A browser extension is the third way into this decorator, alongside a hand-written `initial` and a `recording`: point it at a running application, capture the screen and the state behind it, and emit a story whose fixture is that capture. What travels is chosen **by state selectors** — the same `include`/`exclude` path vocabulary `persist` uses (§8.5) plus the schema-driven redaction `record()` already applies (§11.4) — so a story carries the state its component needs and neither the whole store nor anything secret or transient. Not yet designed: whether the artefact is a recording pinned to one transaction or a distinct snapshot format, whether the extension is the devtools host (§10) under another name, and how it attaches to a page it did not build. Its hard limit should be stated wherever it is documented: it can only capture an application that ships this toolkit.

### 12.3 Contract tests

Adapter conformance suite (§6), source conformance suite (buffer-before-fetch, ack-before-drop, retry policy), persister suite, transport suite. Third-party integrations run the same suites.

### 12.4 Forms

A recipe, not a module: a form is a `useLocal` slice with schema validation and `transient` keystroke nodes, `commit()` producing one command; history groups per field; TanStack Form/Standard Schema interop for validation.

### 12.5 Two-way control binding

Discharges **R67** (two-way control binding) and the _timing_ half of **R74** (declared input rate control); the supersession half of R74 is deliberately elsewhere (§12.5.4).

A binding is **syntax, not a runtime**. `bind()` expands, per call site, into the ordinary `value`/`onChange` pair the framework already wants. A compiled build contains no binding object, no convention lookup, no options parsing. The uncompiled build ships a real `bind()` producing the same props — required by §5.1's zero-semantic-change gate — and it is the only place a convention is resolved dynamically.

#### 12.5.1 Authoring surface

React: a prop spread with a literal options object, so the Rust analyser reads it without type information (decision #23).

```tsx
function SignupForm() {
  const f = useLocal(signup); // §4.9 transient form node
  return (
    <form {...bindForm(f)}>
      <input type="email" {...bind(f.$.email)} /> {/* required/maxlength derived from schema */}
      <input type="number" {...bind(f.$.age)} />
      <input type="checkbox" {...bind(f.$.subscribed)} />
      <select multiple {...bind(f.$.tags)}>
        …
      </select>
      <input type="file" {...bind(f.$.avatar)} />
      {PLANS.map((p) => (
        <input type="radio" key={p} {...bind.group(f.$.plan, p)} />
      ))}
      <Combobox {...bind(f.$.city)} /> {/* declared convention, §12.5.2 */}
      <Slider {...bind(f.$.zoom, { rate: { throttle: 16, edge: 'trailing' } })} />
    </form>
  );
}
```

`bind(node, opts?)` returns props; `bind.group(node, ownValue)` is the radio/checkbox-set form and emits a shared `name` derived from the path, so the controls are a real native group and arrow-key navigation works; `bindForm(node)` wires submit, flushing and validation reporting. Spread first, explicit props after: an explicit `value`/`onChange` wins and `state lint` warns, because a hand-written handler after the spread silently replaces the generated write. Control shape comes from the JSX element itself (`type`, `multiple`) first, from the field's schema second (a `boolean` field with no `type` is a checkbox, a `File` field a file input), and is a build error when neither decides — there are no `as:`/`multiple:` options restating what is already in the source.

**The binding target decides commit semantics.**

- **Transient target** (`useLocal`, §4.9) with no rate policy: write-through, one synchronous transaction per event, per R6. No shadow.
- **Durable slice field**, or any target with a `rate` policy: a transient **shadow** node is materialised at `/ui/$draft/<store-path>` and the target is committed from it per the policy. The shadow is keyed by store and path, not by component instance, so two controls bound to the same field track each other keystroke-by-keystroke (Vue's `v-model` semantics) and the timer has one owner. Default is `commit: 'change'` — Vue's `.lazy` promoted from modifier to default, because write-through to a durable field puts one command per keystroke into the command log (§4.6), which is the redux-form failure §4.9 exists to prevent. `commit: 'input'` opts back in.

Other adapters get no second sugar: Vue uses `v-model` on a node exposed as a `Ref`, Svelte `bind:value` on the `$state`-like proxy, Angular `[(ngModel)]` through a supplied `ControlValueAccessor`. The registry does work only where the framework has none — React, Solid (`use:bind`), Lit (a `bind()` directive) — which keeps §5.4 honest and charges Solid no prop-splitting tax (R5). `contenteditable` is **out of scope for v1**: two-way binding a rich-text surface is selection- and range-preservation work, not value glue; hold the editor's own model with `ref()` (§4.2) and write from its change event.

#### 12.5.2 The convention registry

Three tiers, in resolution order, each answering the same two questions: how to read the current value into a prop, and how to extract the new value from the callback.

1. **Built-in table for host elements** — static data in the compiler, keyed by tag plus `type`, and the same table the runtime uses. `input[text|email|url|search|tel|password]` → `value` / `e.currentTarget.value`; `input[number|range]` → `value` (string) with a declared parse; `input[checkbox]` → `checked`; `input[radio]` → `checked={node === own}` / `own`; `input[file]` → `files`, read-only (§12.5.6); `select` → `value`; `select[multiple]` → `[...e.currentTarget.selectedOptions].map(o => o.value)`; `textarea` → `value`.
2. **A declaration for components** — a literal, side-effect-free call the analyser reads:

   ```ts
   defineControl(Combobox, {
     value: 'value', // prop carrying the current value
     change: 'onValueChange', // prop carrying the callback
     arg: 'value', // 'value' | 'event' | 'value,event' | 'event,value' | 'checked'
     empty: null, // what to pass when the node holds null/undefined
   });
   defineControl(DatePicker, { value: 'selected', change: 'onSelect', arg: (d: Date) => d.toISOString() });
   ```

   Declarations live beside the component when you own it, in a controls manifest named by `state.config.yaml` when you do not; component libraries can ship their own (`@state/controls-<lib>`). A function `arg` is inlined when it is a pure arrow, imported otherwise.

3. **Type-driven inference (TypeScript sidecar)** — with no declaration, the sidecar reads the props type: a `value`/`checked` prop paired with an `on*Change` callback whose first parameter is not event-shaped gives `arg: 'value'`; a first parameter assignable to `SyntheticEvent`/`Event` gives `arg: 'event'`. Inference emits exactly what a declaration would. `state doctor --explain <site>` prints which tier answered.

**Fallback.** When none resolve — an untyped component, a control chosen by a runtime expression, or a build without the compiler — `bind()` stays a runtime function: it emits both `value` and `checked`, wraps the callback in an argument sniffer (`a instanceof Event || a?.nativeEvent ? read(a.target) : a`), and resolves host elements from the tag at first event. The cost is why this is not the default: a closure allocation per render per binding, an `instanceof` plus a property probe per event, and no statically inlined validation attributes. `state lint` reports every unresolved site; `bind.fallback: error` in the config fails the build instead.

**When the declaration is wrong.**

- Build time: the sidecar cross-checks the declaration against the props type where the component is typed; a `change` prop that does not exist is a build error, a mismatched `arg` a `doctor` error.
- Dev: the generated glue asserts the shape of the first event it sees and throws with the call site. Stripped in production.
- Production: the wrong thing is written — an event object into a string field — and the field's schema (§4.12) rejects it at the transaction boundary. That is the last line, and it is why bound fields should be schema-typed.

#### 12.5.3 What the compiler emits

Authored:

```tsx
<input type="email" {...bind(f.$.email)} />
<Combobox {...bind(search.$.city, { rate: { debounce: 300 } })} />
```

Emitted (React, snapshot mode, dev assertions stripped):

```tsx
// module scope: a factory, not state — no store, no node, no timer captured here
const _mk_city = (n) => trailing(300, (v) => _set(n, v));

function Search() {
  const _n_city = _draft(search.$.city, _mk_city); // shadow node + its writer, memoised on the node,
  // created once per store, disposed with the store scope
  return (
    <>
      <input
        type="email"
        required
        maxLength={254}
        value={f.$.email.value ?? ''}
        onChange={(e) => _set(f.$.email, e.currentTarget.value)}
      />
      <Combobox value={_n_city.value ?? null} onValueChange={_n_city.write} />
    </>
  );
}
```

No registry lookup, no options object, no `typeof`, no `instanceof`: the convention was consumed at build time and what remains is the pair of props a React developer would have written by hand. Nothing stateful is hoisted to module scope (§4.7). The only conditional the emitter ever inserts into a handler is `e.nativeEvent.isComposing`, and only for text-like controls (§12.5.6) — a check about this keystroke, not a branch on which control this is.

#### 12.5.4 Rate control (R74)

Declared, never hand-rolled. Valid on a binding and as a slice-level default:

```ts
rate: 'sync'                                   // default
   | { debounce: number }                      // trailing edge unless stated
   | { throttle: number, edge?: 'leading' | 'trailing' | 'both' }
   | { debounce: number, maxWait: number }     // debounce with a guaranteed flush
commit: 'input' | 'change' | 'submit'          // when the shadow reaches the target

defineSlice('search', {
  fields: { query: NonEmptyString },
  bind: { query: { rate: { debounce: 300 } } },  // every binding to this path inherits it
})
```

**Rate control never delays the DOM.** The shadow is written synchronously on every event regardless of policy, and the controlled `value` prop reads the shadow — so caret, selection and IME buffer are untouched by a 300 ms debounce. §4.1's synchronous commit pipeline is what makes this true, and it is why the write must stay synchronous even here. The policy governs only _propagation_: shadow → target, and therefore the command log, persistence, sync, and any effect watching the target. "Immediate write plus debounced commit" is not a pattern the developer assembles; it is the only thing a rate policy can mean. A `rate` on a transient target therefore still materialises a shadow — the transient node becomes the commit target rather than the buffer.

Emitted: one timing closure per store-path, over one `setTimeout`, memoised on the shadow node and disposed with the store scope (~100 bytes of shared helper). Pending timers **flush** — never drop — on `blur`, on `Enter` in a single-line control, on `bindForm` submit, on an explicit `commit()`, and on scope disposal; losing the last keystroke to an unmount is the classic hand-rolled-debounce bug and the generated code does not have it. `store.tick()` and fake timers cooperate (§12.1).

**Supersession is not rate control.** "Latest wins, cancel the previous in-flight request" is a _task_ policy and belongs to §4.15: it is concurrency, it needs an `AbortController`, and it cannot exist before a task does. Debounce decides whether a task starts; supersession decides what happens to one already running. Unify them and you get both failure reports the design review named — "why does my debounce cancel my requests" and "why does my latest-wins delay my input". They compose, and the composition is what a search box actually wants:

```tsx
<input {...bind(search.$.query, { rate: { debounce: 300 } })} />;
effect({ on: search.$.query, policy: 'latest', run: (ctx, q) => api.search(q, { signal: ctx.signal }) });
```

#### 12.5.5 Validation interop (R56)

Standard Schema carries no constraint metadata, so derivation goes through **JSON Schema**, which zod 4, valibot and ArkType all export. From it the compiler derives `required`, `minlength`/`maxlength`, `pattern`, `min`/`max`, `step` (from `multipleOf`) and `type` (from `format`). Where the schema expression is a literal chain the analyser can read, attributes are inlined at the call site (§12.5.3); otherwise they are derived once per binding at mount and cached on the node — never per render.

Native constraint validation is **sufficient** for single-field presence, length, range, step and regex, and is preferred there: free, accessible, and working before hydration. A runtime check is **still required** for refinements and transforms, cross-field rules (confirm-password, date ranges), async rules (uniqueness), and R56's constrained/branded string types whose predicate has no native analogue. Default is `validate: 'commit'`, on the same event that commits shadow → target; `'input'` and `'blur'` are available, and per-keystroke validation is opt-in because it re-renders the error UI per keystroke.

Failures are state, shaped like §4.11's row metadata: `$error` on the **shadow/form node — never on the durable target**, so validation residue is not persisted, synced or replicated. It holds `{ code, message, path }[]`, written in the same transaction as the value so one patch and one undo entry cover both; `form.$valid`/`form.$errors` are derived (§4.3). `bindForm` leaves native validation **on** and calls `reportValidity()` on submit, so browsers show their own bubbles by default; the generated glue mirrors runtime messages into `setCustomValidity` so `:invalid` stays accurate. `bindForm(f, { ui: 'custom' })` is what sets `noValidate`, for forms rendering their own error UI.

#### 12.5.6 Hazards, named and resolved

- **Caret and IME.** The shadow write is synchronous inside the event, so the controlled value never lags the caret. During composition the shadow still mirrors every `input` event — the IME is editing the DOM value and the shadow must follow — but commit and validation are suppressed while `e.nativeEvent.isComposing` and flush at `compositionend`. Committing mid-composition is the half-written-kana-in-the-store bug.
- **Controlled ↔ uncontrolled.** Emitted glue always coerces: `null`/`undefined` → `''` for text/number/select, `false` for checkbox/radio, `[]` for `select[multiple]`. React never sees the prop become `undefined`, so the warning cannot fire.
- **Number inputs.** The shadow holds the raw **string**, the target the parsed number. `''` commits `null`, never `0`. A string that does not parse does not commit and raises `$error` — a `NaN` from `valueAsNumber` is not a value.
- **Checkbox indeterminate.** Field type `boolean | null`; `null` emits a callback ref setting `el.indeterminate = true`, since React has no such prop. The next interaction resolves it to a boolean.
- **File inputs.** One-way from the DOM: the store holds the `FileList` via `ref()` (§4.2 already treats non-plain objects as refs), the node is forced `transient` and excluded from `persist`/`sync`/`record`, and `value` is never written back. Clearing the field emits `el.value = ''` through the callback ref — the only way to reset a file input.
- **`select[multiple]`.** Read from `selectedOptions`, not `value`; the field is an array and comparison is by value, not option index.
- **uSES synchrony.** Every write, including the one inside a debounce timer, is an ordinary synchronous transaction (§4.1), so `getSnapshot` stays consistent within the tick. A debounced commit is a _later_ transaction, not a deferred one; nothing is queued into React's scheduler.

#### 12.5.7 Cost

No bindings in the project: `state/bind` is never linked, the convention table is not emitted, `defineControl` calls dead-code-eliminate (§5.2). Compiled with bindings: the floor is the inlined props per call site plus, where a rate policy exists, one shared timing helper (~100 bytes) and one timer per bound path — no registry, no per-event dispatch. Uncompiled: the runtime `bind()` with the host-element table, the argument sniffer and runtime schema derivation, budgeted at **≤ 1.5 kB min+gz** under §13's per-module line. Budget, not measurement (R66).

_Lineage (R65):_ the surface is Vue's `v-model`, with `.lazy` promoted from modifier to default for durable targets and `.number`/`.trim` replaced by the field's schema (R56); `bind.group` is Svelte's `bind:group`; the desugaring is Angular's `[(x)]` = `[x]` + `(xChange)`, which is literally what we emit; the spread-a-props-object call shape is React Hook Form's `register`; `defineControl` is Vue's per-component `model` option externalised so third-party components bind without wrapping (Solid's `use:` directives are the rejected alternative — they cover elements, not components). Knockout's original two-way bindings are the cautionary case and the reason React took its one-way stance: implicit bidirectional data flow with no answer to "who changed this", compounded in Angular 1 by digest-cycle cost. **A compiler changes that calculation and nothing else does.** React's objection is to implicit runtime data flow, not to the _syntax_ of declaring a value and its handler together; what we emit is the explicit `value`/`onChange` pair React itself recommends, in the same file, visible in the output, with no observer between them — and §4.4 answers Knockout's question directly, since every write is a transaction carrying `cause`, making "who changed this" a devtools query rather than a bisect. Of the form libraries: Formik is the controlled-per-keystroke design whose re-render cost §4.9 already answers; React Hook Form bought performance by going uncontrolled and surrendering the store as single source of truth; TanStack Form is the closest current design, and this is a compiled version of its per-field subscription with the glue removed.

**Open:**

1. Whether `commit: 'change'` or `commit: 'input'` is the right default for durable targets. `'change'` is chosen here on command-log grounds; it will surprise anyone expecting a keystroke at the durable path immediately (it is visible — at the shadow path).
2. Whether `bind` may target a collection item path (`items.byId[id].qty`) directly or only through a shadow. Row-level undo grouping (§4.10) argues for the shadow; ergonomics argue against.
3. Whether type-driven inference (tier 3) is on by default or opt-in — it makes the emit depend on the TypeScript sidecar, which the Rust-analyser-only fast path does not have.
4. Whether `contenteditable` ever gets a `bind.html` experimental tier, or a permanent refusal plus a documented rich-text recipe.

### 12.6 Capture from a running application (R75)

The browser extension that turns a live screen into a story. §12.2 sketches it as a third way into `withState`; this is the design.

**What is captured.** Three things, together, because any one alone is insufficient: the **state** the screen was rendered from, the **screenshot** (so a reviewer can see what the story is supposed to look like without running it), and the **manifest hash** (so the capture can be refused rather than misapplied against a different build, §10.6.3).

**The filter is a region query, not a new concept.** R75 asks for filtering "by state selectors". The vocabulary already exists twice over — `include`/`exclude` path patterns from `persist` (§8.5) and regions from §4.16 — so a capture profile is a small composition of both:

```ts
// state.config.yaml
capture:
  default: { regions: [domain, view], exclude: ['**/token', '**/*Secret'] }
  bugReport: { regions: [domain, view, draft], redact: schema }   # never session
```

The defaults are chosen and not left to the operator, because the operator will not think about it at the moment they are trying to file a bug: **`session` is never captured**, `draft` only when the capture is a bug report (it is the part a user cannot reproduce, §4.16.5), and every field marked `sensitive` in its schema is redacted by the same code path `record()` already uses (§11.4). A capture that has to be manually sanitised is a capture that will one day be published unsanitised.

**What the artefact is — decided.** A capture is a **recording pinned to one transaction**, not a new format. `record()` already produces the transaction stream with redaction; a capture is that stream truncated at the moment of capture plus the screenshot and the manifest hash. This costs nothing to specify and buys three things immediately: `withState({ recording })` already accepts it, time-travel already understands it, and the same artefact serves a bug report, a story and a regression fixture. Inventing a snapshot format would have produced a fourth thing that only Storybook could read.

**How the extension reaches the store — and the limit stated out loud.** Through the devtools bridge (§10), which is the same channel the devtools panel uses and is present only in development builds and in production builds that explicitly opt in. **The extension can therefore only capture an application that ships this toolkit with the bridge enabled.** That is a real limit, it will disappoint someone who expected to point it at any React app, and it belongs in the extension's own first paragraph rather than in a FAQ.

**Output.** A `.story.tsx` written next to the component (or copied to the clipboard when the extension has no filesystem access), importing the capture as a JSON fixture. Story naming comes from the component identity in the devmap (§10.6), so a capture of the same component twice produces `Feed.captured-2` rather than a collision.

_Lineage (R65):_ the capture-the-screen-and-its-state idea is Chromatic's and Percy's, arriving from the visual-regression side rather than the state side; Redux DevTools' state export is the closest existing thing and stops at raw JSON with no provenance and no redaction; Storybook's own `composeStories` is what makes the emitted story useful in a test as well as in the UI.

**Open:** whether the extension writes files at all, or only ever emits to the clipboard and lets a CLI command place them — filesystem access is the difference between a Chrome extension people install and one they are told not to.

---

## 13. Performance and size budgets

Measured, CI-gated (`state bench`, size-limit). Numbers are targets for v1 GA; the spike (§18) must land within 1.5× of them or the architecture is revisited.

| Budget                                                                                                                      | Target                                                                  | Reference point (brief §3)                            |
| --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `state` core (signals + proxy store + tx/patches + scopes + bus), min+gz                                                    | ≤ 4 kB                                                                  | Valtio 5.8, Zustand 3.5, alien-signals 1.9            |
| `state/collections` (ids/byId, per-item nodes, diff-aware derive)                                                           | ≤ 3 kB                                                                  | —                                                     |
| React adapter                                                                                                               | ≤ 1.5 kB                                                                | `@preact/signals-react` 6.1 incl. uSES shim           |
| Each toolkit module (history, persist, url, remote, optimistic)                                                             | ≤ 2 kB                                                                  | zundo 0.7, nuqs core                                  |
| Minimal app, **uncompiled** (core + React adapter, one slice, no collections)                                               | ≤ 6 kB                                                                  | must hold without the compiler (§1)                   |
| Minimal app, compiled                                                                                                       | ≤ 4.5 kB                                                                | compiler strips unused paths                          |
| Runtime deps                                                                                                                | 0 (peers only for adapters/sources)                                     | nanostores, alien-signals                             |
| js-reactivity-benchmark (17 scenarios)                                                                                      | ≥ Preact on every scenario                                              | milomg bench; Zustand/Valtio are not in it            |
| React store microbench (1k subscribed components, 1 write; 10k-row collection, select 1 row; 100 keystrokes into one input) | ≤ 1.0× Zustand and ≤ 1.0× Valtio on each                                | new bench, baselines recorded before the spike        |
| krausest: swap rows / replace all rows / partial update (every 10th)                                                        | ≤ Legend-State (≈ vanilla) with compiler `<For>`; ≤ 1.3× Legend without | brief §5.4; create-1k is React-bound, not a store bar |
| Untouched subtree cost on write                                                                                             | 0 allocations                                                           | structural sharing                                    |
| Per-transaction overhead (patch generation)                                                                                 | ≤ 2× a hand-written immutable update; ≤ Mutative no-freeze              | Immer 11 ≈ 2–3× handwritten                           |
| Proxy read on hot path after compiler                                                                                       | 0 Proxy traps (rewritten to signal reads)                               | V8 Proxy get ≈ 13×                                    |
| `postMessage` patch message                                                                                                 | ≤ 10 KiB default, chunked above                                         | Surma 16 ms frame budget                              |
| Devtools overhead (dev)                                                                                                     | ≤ 5 % on the transaction path; 0 in prod                                | stripped                                              |
| Memory per collection item                                                                                                  | ≤ 1 lazily-created signal per read property + 1 node object             | Svelte/Solid lazy model                               |

**Spike bars (measurable without the compiler, §18):** uncompiled minimal app ≤ 6 kB; js-reactivity-benchmark ≥ Preact; React microbench ≤ 1.0× Zustand/Valtio; krausest swap/replace ≤ 1.3× Legend; zero allocations on untouched subtrees (heap snapshot diff); `postMessage` patch messages ≤ 10 KiB in the VS Code replacement. Compiler-dependent bars are re-measured in weeks 7–10.

Browser floor (R22): last 2 versions of Chromium/Firefox/Safari; Node ≥ 20, Bun ≥ 1.2; Proxy, WeakRef, `structuredClone` assumed everywhere; Web Locks/OPFS/SharedWorker are browser-only and optional with fallbacks; `AsyncLocalStorage` is server-only (`state/ssr`).

### 13.1 The benchmark harness (R28)

The table above is budgets, not measurements (R66). This section specifies the machine that turns them into measurements. Its design constraint: a benchmark section in a library's own documentation is marketing until proven otherwise, so every rule below exists to make a dishonest number harder to produce than an honest one.

#### 13.1.1 The four axes

Each axis varies one thing and holds the rest at a declared default; the suite is a declared cross-product, not every combination.

| Axis                 | What varies                                                                                                                                                                                                                                                                                                              | Why the axis exists                                                                                                                                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data types           | flat scalars; deep nested objects (depth 3/6/10); arrays; keyed collections (`ids` + `byId`); custom types with codecs (§4.13); string-valued vs number-valued fields                                                                                                                                                    | Per-property lazy signals, patch-path construction and structural sharing all behave differently by shape. Depth exercises path length; codecs exercise the encode/decode boundary on every read; strings vs numbers separate allocation cost from arithmetic cost                                 |
| Data volumes         | 10², 10³, 10⁴ items as the standing tiers; 10⁵ as a slow tier run nightly only                                                                                                                                                                                                                                           | A single size hides the complexity class, which is the only reason volume is an axis. Three decades separate O(1) from O(log n) from O(n); one point separates nothing. Reported per tier, never averaged across tiers                                                                             |
| Operation kinds      | single-field write; batch write of k fields in one transaction (k = 1/10/100); per-item update in a large collection; insert; remove; sort/filter/derive recompute; undo; replay of a recorded command log; patch generation alone (write with the patch log detached vs attached); hydration from a serialised snapshot | These are the operations §4.4–§4.11 actually charge for. The three §13 rows already named — 1k subscribed components with one write, 10k-row collection selecting one row, 100 keystrokes into one input — are members of this axis, not a parallel set; the harness owns them and §13 quotes them |
| Real-world scenarios | five application-shaped fixtures, below                                                                                                                                                                                                                                                                                  | Everything above is still a loop. Scenarios are where interaction between the store, the framework adapter and the DOM shows up                                                                                                                                                                    |

Scenarios are what distinguish R28 from every suite we adopt: a real component tree driven by a scripted input trace, not a `for` loop.

- **Virtualised table with live sorting.** 10⁴ rows, 30 visible, sort key changed while a background source writes updates. Measures what a microbench cannot: that a write to a row outside the window costs nothing, and that a sort change re-renders 30 rows and not 10⁴.
- **Form with per-keystroke state.** One `transient` field, 40 fields on screen, validation deriving from three. Measures write amplification per keystroke and the render count of untouched siblings — cost paid 100 times a second.
- **Collaborative document receiving remote patches while the user types.** Local transactions interleaved with inbound patches from `remote` (§9) at 5/s and 50/s. Measures merge-window behaviour, patch application against a tree the user is concurrently mutating, and message size against the ≤ 10 KiB budget.
- **Growing feed scrolled back through.** Grows by 50 items every 500 ms to 5·10³ while the user scrolls. Measures retained heap growth and eviction (§8.9), which no operation-level bench observes at all.
- **SSR page hydrated from a serialised snapshot** (§7). The only fixture with a time-to-first-meaningful-paint number, and the only one that charges for snapshot parsing and store construction rather than for updates.

Every fixture carries a `fixtureVersion`; whether versions are pinned per release or rotated is open #2 below.

#### 13.1.2 What is measured

Four metrics, each authoritative for a different axis. A benchmark reporting only mean wall time is close to useless and is not accepted into the suite.

- **Wall time per operation** — authoritative for the data-type and operation-kind axes; on its own, meaningless for scenarios.
- **Allocations and retained heap** — authoritative for the volume axis and the feed scenario. Sampled by CDP heap profiling in headless CI, so §13's `0 allocations on untouched subtrees` row is **CI-only**: the in-browser runner cannot reproduce it (`measureUserAgentSpecificMemory` is coarse and needs cross-origin isolation).
- **Re-render count** — authoritative for every React scenario, and usually the real currency: a store 20 % faster per write that renders twice as many components is slower in the application. Counted from React Profiler commits plus a render counter in the adapter's dev build.
- **Bundle bytes** — authoritative for the packaging rows; from size-limit, not the harness.

The hydration scenario additionally reports time to first meaningful paint: the first paint containing the fixture's declared sentinel element.

#### 13.1.3 Statistical honesty

The noise rule already exists and is not restated: §5.6.5's median of N runs with a ±2 median-absolute-deviation band, N and the reference machine pinned under `bench` in `state.config.yaml`. The harness adds only what that rule does not cover.

Report the median and the MAD; never the mean, never a bare "ops/sec ± margin". Competing implementations are interleaved per round (A B C A B C), never blocked (AAA BBB CCC), so thermal and JIT-state drift hit all candidates equally. Warm-up is per-scenario, not global: hot-path benches discard `config.warmup` iterations, pinned alongside N, while hydration and cold-start scenarios are **cold by definition** and run in a fresh iframe per sample — warming them up is a bug, not a fix. The site runner's current warm = 3, runs = 7 stays as the interactive default and is superseded by the pinned N for anything published.

#### 13.1.4 Where it runs

| Environment                                                           | Job                                               | What it may claim                                                                                                                                        |
| --------------------------------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Developer machine                                                     | fast feedback while optimising                    | Nothing publishable. Absolutes are untrustworthy; direction only                                                                                         |
| CI, headless, shared runner class                                     | regression detection                              | Deltas against the previous run **on the same runner class**, with a band widened for shared-runner variance. Never absolutes                            |
| The pinned reference machine (§5.6.5, `bench` in `state.config.yaml`) | the only source of published absolutes and ratios | Everything: absolutes, cross-library ratios, the §13 rows, R66's speedups                                                                                |
| Documentation site, in-browser                                        | honesty                                           | Whatever it just measured on the reader's own hardware, labelled with that hardware. The strongest claim available, because the reader watched it happen |

Two consequences. Published figures — every absolute and every cross-library ratio, including the §13 rows and R66's numbers — come only from runs whose `env` matches the pinned reference; a shared-runner `ci` sample renders on the site as a delta against its `--baseline` run or not at all. And `--gate` compares against the band for the environment it ran in: §5.6.5's ±2 MAD when `env` matches the reference machine, the widened runner-class band otherwise.

#### 13.1.5 Baselines and fairness

Baselines: Zustand, Valtio, Jotai, Legend-State, Redux Toolkit with reselect, MobX, and a hand-written immutable update as the floor — the libraries §13 already names, plus the two selector-heavy ones R66 needs. The signal libraries are covered by adopting js-reactivity-benchmark and are not re-measured here. Not every baseline appears in every scenario; one absent from a scenario is listed as absent, not quietly omitted.

The fairness problem: an idiomatic Zustand implementation and a naive one differ by more than any two libraries do, and a benchmark's author always writes their own library idiomatically. The rule — **a baseline implementation is published only once a named reviewer who prefers that library has signed it off**, a maintainer or regular contributor credited by name in the results file. Until then the row carries `reviewedBy: null` and renders as "unreviewed — not published", with the code linked so it can be criticised. Enforced by the schema, not by a paragraph.

#### 13.1.6 What we adopt rather than re-invent

js-reactivity-benchmark (milomg) is adopted wholesale for the reactivity graph: 17 scenarios over wide/deep/dynamic topologies, better than anything we would write. krausest/js-framework-benchmark is adopted for list operations, **keyed mode only** — the keyed/non-keyed split is its best idea and non-keyed results measure a different program; its create-1k row is React-bound and is not a store bar (§13). What neither covers is exactly the half R28 asks for: store-level operations (transactions, patch generation, undo, replay, hydration) and application-shaped scenarios. That half is ours to build.

#### 13.1.7 The Datalog-vs-selectors fixture (R66)

R66's showcase is a harness fixture, not a blog post. Two sourcing tracks: permissively-licensed open-source Redux applications, used verbatim and attributed; and Hyper's own selector pyramids, which may not appear on the site (R55) and are therefore anonymised down to DAG topology alone — node count, depth, fan-in per node, input slice count, and reselect's own `recomputations()` counters under a scripted session — then re-synthesised as a shape-matched pyramid over generated data. Each pyramid gets an equivalent declarative query against `derive.collection` / Danny-DB (R32, `state/query-tanstack`).

Varied: collection size (10²–10⁵), update rate (1/s to 1000/s), selectivity (0.1 % to 100 % of the collection matched), and read:write ratio. The honest outcomes include losing. Incremental view maintenance pays index upkeep on every write, so at small N, at high selectivity where recompute is one cheap filter pass, and at write-heavy/read-light ratios, recompute should win. Where it loses, the results file records the loss and the site renders it — a fixture that reports only its wins is not evidence.

**A prototype version of this fixture has been run and is reported in** `docs/research/2026-09-04-r66-ivm-vs-selectors-first-run.md`. It measures three columns rather than two: recompute, a path hand-written for one query shape, and the patch-driven `deriveCollection` primitive that exists in the prototype today. At 10 000 rows and 200 single-item updates the hand-written path reaches ≈280× and the real primitive ≈61×, which is the number worth quoting — and the primitive pays for the whole store write path that the recompute column does not have. It is still not this fixture: no query planner, no chained derivations, and no real-world pyramid. Its most useful finding is that the small-collection caveat above did **not** reproduce even with real machinery, so that caveat is predicted rather than observed until a planner is measured.

Readability is not measurable here; the Concepts page's "Queries instead of selector pyramids" keeps that as a qualitative claim, and every performance figure on it stays labelled unmeasured until this fixture runs.

#### 13.1.8 Results, provenance, and the site

One machine-readable file per run, appended to `bench/results/`. The site renders figures **only** from it.

```ts
type BenchResults = {
  schemaVersion: 1;
  runId: string; // ULID, stable reference id for a figure
  commit: string; // git sha of the harness and the library
  startedAt: string; // ISO 8601
  env: {
    kind: 'dev' | 'ci' | 'browser';
    browser?: { name: string; version: string };
    runtime?: { name: 'node' | 'bun'; version: string };
    cpu: string;
    cores: number;
    memoryGiB: number;
    os: string;
    runnerClass?: string; // CI only; deltas comparable only within one class
    isReferenceMachine: boolean; // false ⇒ deltas only, never a published absolute
  };
  config: { n: number; warmup: number; interleaved: true };
  samples: Array<{
    scenario: string; // fixture id
    fixtureVersion: string;
    axis: { dataType: string; volume: number; operation: string };
    subject: string; // 'state' | baseline id
    metric: 'wallMs' | 'allocBytes' | 'retainedBytes' | 'renders' | 'ttfmpMs' | 'bytesGz';
    median: number;
    mad: number;
    runs: number[];
  }>;
  baselines: Array<{
    id: string;
    library: string;
    version: string;
    sourceUrl: string;
    reviewedBy: string | null; // null ⇒ not published, rendered as "unreviewed"
  }>;
};
```

Every figure in the documentation references a `runId` plus a sample selector. **A figure whose `runId` is absent from `bench/results/` fails the site build** — it neither renders a stale number nor silently disappears. A claim with no result renders as a budget, labelled as such, exactly as §13 is labelled today. That build-time check, not review discipline, is what stops the numbers rotting.

#### 13.1.9 `state bench`

§11.2 already defines the command; this adds its shape.

```
state bench [suite...]            # reactivity | list | store | scenarios | datalog | size
  --project                       # run against this project's own slices and collections
  --compare <lib,lib>             # include baselines
  --volumes 1e2,1e3,1e4
  --baseline <runId|path>         # regression source; default: last run, same runner class
  --gate                          # fail on any §13 row outside the band for this env
  --out bench/results/<runId>.json
  --json
```

`--project` is the interesting flag: the analyser manifest (§11.1) already enumerates every slice, collection and component read pattern, so a project needs to supply only a fixture generator per collection, and the harness derives the operation set from the manifest. `--gate` is the CI form and is the only mode that fails a build.

_Lineage (R65):_ js-reactivity-benchmark — the right way to isolate a reactivity graph across topologies; no store, no DOM, no memory metric, and small enough to tune for. krausest/js-framework-benchmark — the keyed/non-keyed distinction, and a fairness model copied wholesale: authors submit and review their own implementations by public PR; wrong in that DOM cost drowns store differences. Tachometer — differences with confidence intervals, automatic sampling until decidable, and interleaved rounds against browser variance; we take the interleaving and the "is this decidable yet" discipline, but report median/MAD instead of its mean-based intervals. mitata and benchmark.js are the same lesson from opposite ends: mitata reports p50/p99 with GC detection and is right (though Node/Bun micro only), benchmark.js reports "ops/sec ± margin" off the mean and is the anti-pattern this section is written against — quoted for a decade as though it were a measurement, now unmaintained. Speedometer 3 — scenario-shaped workloads across real framework implementations under cross-vendor governance, the proof that application-shaped benchmarking works; its risk is Goodhart's law once engines optimise for it, which is what open #2 is about. And the failure mode common to every library-authored benchmark including these: the author's library is idiomatic and everyone else's is a strawman. §13.1.5's named-reviewer rule is the only defence we have found that is checkable.

**Open:**

1. Whether the in-browser runner may publish cross-library comparisons at all, or only `state`-versus-`state` figures. A reader's browser running someone else's library through our harness on our fixture is the exact shape of an unfair comparison, reviewed code or not.
2. Whether scenario fixtures are pinned per release (a time series, and therefore tunable-for) or rotated (Goodhart-resistant, but no time series). `fixtureVersion` is recorded either way, because without it neither option is reconstructable after the fact.
3. Whether the Datalog fixture's Hyper-derived pyramids stay representative once anonymised to topology alone. A synthesised pyramid with the right depth and fan-in can carry entirely the wrong data distribution — and selectivity is the variable that decides the result.

---

## 14. Packaging

- One npm scope, one core package with subpath exports: `state` (core), `state/collections`, `state/react`, `state/vue`, `state/solid`, `state/svelte`, `state/angular`, `state/lit`, `state/history`, `state/persist`, `state/persist/indexeddb|opfs|vscode`, `state/url`, `state/url/tanstack-router|react-router|next`, `state/remote`, `state/remote/vscode|broadcast|worker|chrome`, `state/worker`, `state/optimistic`, `state/outbox`, `state/collections/rest|graphql|rpc|ws|rx|electric|powersync|rxdb|crdt|server-actions`, `state/devtools`, `state/testing`, `state/ssr`. Separate packages only for build-time tools (`@state/compiler`, `@state/cli`, `@state/analyzer`, `@state/mcp`, `@state/storybook`) and heavy optional engines (`state/query-tanstack`).
- `"type":"module"`, ESM-only, `"sideEffects": false`, `/*#__PURE__*/` on every factory, no barrel re-exports of side-effectful modules, `exports` map with `types` conditions, `development`/`production` conditions for devtools/no-op swaps.
- size-limit per entry in CI; API extractor for public types; conformance suites published for third-party adapters/sources.
- Versioning: semver from 0.x with a stability tag per module (`stable | preview | experimental`), mirroring TanStack/Solid-primitives; compiler manifest version pinned to runtime version.
- Licence: MIT (interop with the whole ecosystem depends on it; FSL/AGPL would kill adoption for a universal library).

#### 14.1 The reactivity core ships as its own package (R41, decision #19)

The graph algorithm is published separately, as `@state/reactive`, and the toolkit depends on it like anyone else would. Three reasons, and the third is the one that matters:

1. **The requirement asks for an isolated, pure, well-tested dependency to exist at all.** alien-signals is isolated and pure and its test coverage is modest; if no package of that shape exists at the standard we need, we publish one rather than keep a good implementation buried inside a store.
2. **It de-risks the vendoring** (decision #2). A vendored copy with an upstream-sync script is a maintenance debt with no external users to catch its bugs. A published package has both.
3. **It forces the interface to be real.** A graph that only ever serves our own store will grow assumptions about our store. One with outside consumers cannot.

**Contents:** signals, computeds, effects, the two-phase batch (§4.1), scopes and disposal. **Not** included: the Proxy layer, paths, patches, transactions, collections — everything that makes it _our_ store stays in `state`. The boundary test is whether a general reactivity user would want it.

**Variants behind one interface.** Decision #19 requires the internal implementation choices — doubly-linked dependency lists versus arrays, dirty flags versus version counters — to be benchmarked against each other rather than chosen by taste, and switchable behind an unchanged public surface. They are selected **statically at build time** via a package export condition; a dynamic per-workload switch is explicitly not built until a profile shows the choice depends on the workload, because a runtime branch on the hottest path in the library would cost more than either variant saves. The comparison runs as a §13.1 harness fixture, and the default is whichever wins there — not whichever is written first.

**Test standard, since "well-tested" is the requirement's actual content:** property-based tests for glitch-freedom (no observer ever sees a partially-updated graph, over generated diamond and cycle-free random topologies), dynamic-dependency correctness (a computed that stops reading a source is unsubscribed from it), disposal (no retained references after a scope is disposed, asserted against a heap snapshot), and the full js-reactivity-benchmark suite as a correctness fixture before it is a performance one.

**Versioning:** `@state/reactive` versions independently and `state` depends on a caret range. It is the one place a semver-major in a dependency is allowed to precede one in the toolkit, because its surface is small and its consumers are few.

---

## 15. Migration plan for Hyper

Ordered so each step is independently shippable and the acceptance test is Hyper's own product.

1. **Spike (2 weeks, §18, Appendix C):** core + collections + React adapter (snapshot + tracked) + `remote/vscode` + `collections/rest` + devtools transaction stream. Replace `shared-editor-state` + `StateHub` with a `remote` slice (leader = extension host) and `useGitHubRepositories` with a `rest` collection. Measure the spike bars (§13). `persist` follows in weeks 3–6.
2. **Zustand stores → slices** (auth, connection, git, diagnostic, network, nudge, projectActivation) via `state migrate from zustand`; keep hook names as thin aliases for one release.
3. **REST/RPC hooks → collections + `rpc` source** over the existing `PlatformMessage` bus (the union becomes the typed contract; `requestId` correlation moves into the `rpc` transport; SSE/`api:fetch` proxying becomes a transport driver). Target: the 145 hook files shrink to complexes per page.
4. **canvas-engine undo → `history`** with per-slice stacks and `historyKey` per canvas; the command pattern maps 1:1 onto commands; snapshots become `snapshot()`.
5. **Transient UI state → `useLocal`**; `state doctor` drives the long tail of `useState`.
6. **Templates:** `state init` presets for `nextjs-shadcn`, `nextjs-tamagui`, `remix-shadcn`, `vite-shadcn`, `bun-shadcn`; the Hyper generator emits complexes per page for user apps.
7. **Agent tooling:** wire `@state/mcp` into `extension-mcp-setup.ts` so Hyper's agents edit user-app state through the analyser; recordings attached to Hyper bug reports.

---

## 16. Risks and mitigations

| Risk                                                       | Mitigation                                                                                                                                                           |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owning a reactivity runtime                                | Vendored, settled algorithm (~600 lines); internal interface allows swapping to native `Signal`; bench in CI                                                         |
| Compiler + React Compiler conflicts                        | Run first, emit compiler-safe code, force snapshot mode under RC; conformance test matrix with RC on/off; `doctor` warns                                             |
| Proxy tracking bugs (leaks, identity, destructuring)       | Snapshot mode default; lint rules; `raw/snapshot/ref` escapes; react-tracked's caveat list as test cases                                                             |
| Scope creep (8 frameworks × 3 modes × N sources)           | v1 GA = React + Vue + Solid + Svelte adapters via one conformance suite; `preview` tag for the rest; sources beyond rest/rpc/graphql/ws/query ship as `experimental` |
| TanStack DB contract churn (0.x)                           | Contract pinned to a version in our manifest; adapter shim per breaking change; our own collections do not depend on their runtime                                   |
| Patch-based history under sync producing surprising merges | Inverse-transaction semantics, origin scoping, conflict reports in devtools; documented as the Yjs/Loro model                                                        |
| Compiled vs uncompiled divergence                          | CI runs the suite both ways; compiler emits nothing not expressible at runtime                                                                                       |
| Adoption friction from "all state global"                  | `useLocal` keeps the `useState` ergonomics; doctor + migrate make it incremental; transient defaults make it free                                                    |
| Devtools freezing on big state                             | Lazy path inspection, patch-based diffs in a Worker, byte caps, sampling                                                                                             |
| Two-audience tension (Hyper vs universal)                  | Hyper is the acceptance test; anything Hyper-specific lives in Hyper's complexes, never in the toolkit                                                               |

---

## 17. API sketches

### 17.1 Minimal app (any framework)

```yaml
# state.config.yaml — invariants chosen at `state init`, enforced by `state lint`, changed explicitly
framework: react
react: { mode: snapshot, tracked: ['src/canvas/**'] } # tracked allowed only here
events: { default: both, production: commands }
sources: { allowed: [rest, rpc] } # a graphql import fails lint until added
persist: { allowed: [indexeddb, vscode] }
forbid: [zustand, jotai, redux] # migration completed — lint keeps it that way
devtools: dev
```

```ts

// store.ts
export const createAppStore = () => createStore().use(todos, session)

// React
<StateProvider create={createAppStore}><App/></StateProvider>
function TodoList() {
  const t = useSlice(todos)                 // snapshot; reads tracked → subscribes to t.items.ids, t.filter
  return <For each={t.items} filter={t.filter === 'done' ? i => i.done : undefined}>
    {(item) => <TodoCard item={item}/>}     // one component per key, subscribed to its own node
  </For>
}
function TodoCard({ item }: { item: Node<Todo> }) {
  const i = useSlice(item)
  const { toggle } = useActions(todos)      // bound to the provider store — never the definition
  return <label><input type="checkbox" checked={i.done} onChange={() => toggle(i.id)}/>{i.text}</label>
}
```

### 17.2 Per-keystroke, global, cheap

```ts
function Search() {
  const q = useLocal(searchQuery)           // registered under /ui/Search/<useId()>, transient by default
  return <input value={q.value} onInput={e => q.set(e.currentTarget.value)}/>  // sync write → one subscriber re-renders
}
```

### 17.3 A complex (HOX)

```ts
export const cart = defineComplex('cart', {
  slices: { coupon },
  collections: {
    items: collection(CartItem, { key: 'productId' }),
    products: collection(Product, { key: 'id', source: rest({ url: '/api/products' }) }),
  },
  derived: (s) => ({ total: derive(() => sum(s.items.map(i => i.qty * s.products.get(i.productId).price))) }),
  actions: (s) => ({ add: (id: string) => s.items.upsert(id, i => ({ productId: id, qty: (i?.qty ?? 0) + 1 })) }),
  history: { domain: 'cart' },   // the domain its slices join by default (§4.10)
  events: 'both',
})
// React widgets shipped beside it, importing only the complex
export const CartBadge = () => { const c = useComplex(cart); return <Badge n={c.items.ids.length}/> }
```

### 17.4 VS Code leader/replica

```ts
// extension host
const host = createStore().use(editorState);
remote.lead(host, editorState, { transport: vscodeHost(panels) });
// webview
const ui = createStore().use(editorState);
remote.follow(ui, editorState, { transport: vscodeWebview(), mode: 'command' });
```

### 17.5 Sync source with optimistic mutator

```ts
const todos = collection(Todo, {
  key: 'id',
  source: rpc(api.todos, { subscribe: api.todos.changes }), // tRPC/oRPC contract, MessagePort or HTTP
  mutators: {
    toggle: {
      args: z.string(),
      run: (s, id) => {
        s.get(id).done = !s.get(id).done;
      },
    },
  },
});
// UI: const { toggle } = useActions(todos); toggle(id) → optimistic overlay → rpc → ack(txid) → overlay dropped
```

### 17.6 Tests and Storybook

```ts
const store = createTestStore([cart], { sources: { products: local(fixtures.products) } })
render(<StateProvider store={store}><CartBadge/></StateProvider>)
store.actions(cart).add('p1')
expect(store.commands.at(-1)).toMatchObject({ name: 'cart.add', args: ['p1'] })

export const Loaded: Story = { decorators: [withState([cart], { recording: recordings.cartFull })] }
```

---

## 18. Roadmap and spike plan

- **Weeks 1–2 — Spike.** Core (vendored signals, proxy store, transactions/patches), collections (`ids/byId`, per-item nodes), React adapter (snapshot + tracked), `remote/vscode` (Appendix B protocol), `collections/rest`, devtools transaction stream to console + Redux bridge. Replace `shared-editor-state`+`StateHub` and `useGitHubRepositories` in Hyper (Appendix C). Bench against the spike bars in §13. **Go/no-go.**
- **Weeks 3–6 — Toolkit v0.** history, persist (localStorage/IndexedDB/vscode), optimistic + outbox, url (TanStack Router + React Router), worker host, SSR dehydrate/hydrate, Next.js and Remix recipes; conformance suites; `state doctor`.
- **Weeks 7–10 — Compiler v0 + CLI.** Analyzer, Vite/Babel plugins, React mode selection, unused-module stripping, `state init`, `state migrate from zustand|react-query`, manifest; TanStack Devtools panel + VS Code panel.
- **Weeks 11–14 — Adapters + sources.** Vue, Solid, Svelte adapters through the conformance suite; graphql/ws/rpc/electric/powersync sources; `@state/mcp` with search/edit/dump/mock/replay; Storybook addon.
- **Then:** Angular/Lit adapters, `state/query-tanstack`, SWC plugin for Turbopack, LSP plugin, public 0.x release and docs; full competitor matrix page and build-setup fit check are produced alongside (next deliverables after this spec).

---

## 19. Open decisions

Decided in this draft (defaults an engineer can build against; overturn by editing the spec, not in chat): alien-signals is vendored with an upstream-sync script (§4.1); `events` defaults to `both` in dev / `commands` in prod (§4.6); writes outside actions are `loose` everywhere, `strict` per slice (§4.4); React snapshot mode is the only inferred mode (§5.3); SaaS multi-tab leader is opt-in, single-tab default (§9.3); undo persistence is off by default (§4.10); remote has one mode, `command` (§9.1); MIT licence (§14).

Still open:

1. **Name and scope on npm** (working name `state`; needs a real name before the public repo).
2. **Statebus lineage:** keep `ByID`, `substateInterest` (→ collection `interest` ref-counting, §4.5) and the phase ordering as named credits; the package itself is superseded. Needs Danny's agreement.
3. **Undo persistence for Hyper's canvas** — on (proposed) — decided when canvas-engine migrates (§15.4).
4. **Docs/positioning language:** the API and docs are English; the team's working documents may stay bilingual.
5. **Recording in production** (§11.4): behind consent and sampling — the exact policy is Hyper's, not the toolkit's.
6. **Async lifecycle, cancellation, transitions, input rate control (R71–R74).** Asked for as
   first-class citizens on 2026-09-04. A design review has been run and lives in
   `docs/research/2026-09-04-structured-concurrency-and-cancellation.md` (advisory, not yet
   decided). Its load-bearing conclusions, for anyone reading only this spec:
   - **A transaction is not a task.** Transactions stay synchronous and atomic — there is
     nothing in one to cancel. A task is the async thing that commits zero or many
     transactions over time. **The command is the task root**, so the command log already has
     the right identity; route and component scopes are its parents. Slices and query
     subscriptions must not own task lifetimes.
   - **Cancellation is a status transition on the existing command entry, not a new command
     and not an undo.** Compensation, where it happens, is inverse patches attributed to the
     same command ID (which argues for grouping patches by command ID — needed for undo
     grouping anyway).
   - **Children fail independently by default** (Kotlin's `SupervisorJob` position). Fail-fast
     is opt-in via explicit `all`/`race` groups. This is the inverse of the server-side default
     and is the most common porting mistake.
   - **The four asks are two mechanisms, not one and not four.** Status lifecycle and
     cancellation are the same thing (`cancelled` is a terminal status; the status machine
     should be an `fsm()` instance, §4.6). Debounce/throttle is a signal operator that runs
     _before_ any task exists, and is distinct from the "latest wins" task policy. The page
     bridge splits into route-scope-ending (structured concurrency, ours) and the
     `useTransition`/View-Transition hookup (render scheduling, the adapter's).
   - **`AbortSignal` is the substrate** — with `AbortSignal.any` for the parent link — but it
     supplies no join, no LIFO finalizers, no non-cancellable section, no status/progress and
     no typed reason; those are ours.
   - **Cost:** ~1.5–3 kB irreducible; tree support is dead code and dropped when no effect in
     the project declares that it spawns, which is how this stays compatible with F2.
     Still genuinely open, and needing a decision before this becomes a section:
     (a) whether the default scope is `route` or nearest-enclosing-else-app;
     (b) the rebase policy when an _independent later_ command read a cancelled command's
     optimistic write — the review's position is that the failure surfaces on the later command
     with a `dependency-cancelled` reason, and that this case is not fully solvable client-side;
     (c) whether to adopt the proposed `effect({ on, debounce, policy, scope, timeout, writes, run })`
     shape as-is.

Briefing outcomes (brief §7): Q1 compiler stance → §5.3 (all three modes, snapshot inferred); Q2 command granularity → §4.4/§4.6 (both logs, per-slice modes); Q3 keystroke policy → §4.9 (defaults as proposed, no exclusions named yet); Q4 TanStack DB → §8.1 (protocol + interop); Q5 SaaS leader → §9.3 (opt-in); Q6 undo scope → §4.10 (per-slice, persist off); Q7/Q8 targets and versions → §6/§7, all environments in v1 with stability tags (§14); Q9 devtools hosts → §10 (all three); Q10 bars → §13; Q11 statebus → open item 2; Q12 positioning → §1 (universal, MIT); Q13 migration → §15 (incremental, spike first).

---

## 20. The standalone compiler (`statec`)

Satisfies R31, R42, R46. This is the most speculative chapter in the document and is written to be read that way: a capability ladder, each rung with its own cost, risk and verdict. Rung 1 is a few weeks of work with a large payoff; Rung 3 may never happen.

### 20.1 Why this is a separate product from `state build`

`state build` (§5) specialises code that **already uses this toolkit**: it knows every slice, complex and `useLocal` because they were declared, and its zero-semantic-change contract (§5.1) holds because it only removes what it proved unused. `statec` transforms code that **does not** — ordinary React with `useState`, `useReducer` and JSX — into code that does. `state build`'s worst case is a missed optimisation; `statec`'s is a behaviour change in an application that never opted into our model. That asymmetry is why it ships as a separate binary, opt-in and version line, never as a `state-cli` subcommand.

Shared: the Rust analyser crate (decision #23 — SWC/Oxc parse, scope and control-flow analysis), the TypeScript sidecar for anything needing the type checker, and the manifest. `statec` does not invent a second manifest — it writes a `statec` section into `state.manifest.json`, including `record`, because §5.2 lowers a `useLocal` with no external readers back to a plain signal, which would silently undo Rung 1; `record` is the documented switch suppressing that lowering (§5.1).

The dependency runs one way: `statec`'s **output** uses the toolkit, injecting `state` core plus the React adapter as runtime dependencies. A project that runs `statec` is an adopter whether or not it writes a slice by hand.

### 20.2 The ladder

| Rung                         | What it buys                                                                      | Cost                                                    | Principal risk                             | Status                                          |
| ---------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------- |
| 1 — `useState` → store nodes | Whole app inspectable, recordable, replayable; state assertions without rendering | ~2–3 kB runtime, one analyser pass                      | Instance identity under replay             | **Intended.** Off by default until §20.9 passes |
| 2 — fine-grained rendering   | Solid-like precise DOM updates for eligible leaves                                | Per-engine codegen, eligibility analysis, fallback path | Silent divergence on ineligible components | **Exploratory.** Leaves only                    |
| 3 — resumability             | No hydration pass; handlers loaded on interaction                                 | A closure serialiser of Qwik's magnitude                | Arbitrary closures are unserialisable      | **[may never happen]**                          |

### 20.3 Rung 1 — `useState` lowered to store nodes, source unchanged

The rung the product is actually for. Components keep writing `useState`; each call is rewritten into a store node scoped to the component instance — the `useLocal` shape of §4.9, registered at `/ui/<component>/<instanceId>`, flagged `transient`, coalesced per frame.

```tsx
// source, unchanged
function Filter() {
  const [q, setQ] = useState('');
  return <input value={q} onChange={(e) => setQ(e.target.value)} />;
}

// emitted
function Filter() {
  const q$ = useLocal('ui/Filter', { q: '' }); // node id: /ui/Filter/<useId()>
  return (
    <input
      value={q$.q}
      onChange={(e) => {
        q$.q = e.target.value;
      }}
    />
  );
}
```

What it buys: the whole state of a running application becomes one inspectable tree; a user's bug becomes a recording (§11.4) rather than a description; tests assert on state without rendering (§12.1).

- **Instance identity** is React `useId()`, as in §4.9 — stable across SSR and StrictMode double-mount, so registration must be idempotent: the second mount re-attaches rather than creating a sibling. `useId` is _positional_, so a recording replays faithfully only against the same build; recordings are pinned by manifest hash.
- **Functional setters** (`setQ(prev => prev + 1)`) lower to a read-modify-write inside one transaction, preserving atomicity. **Lazy initialisers** run once on node creation and must not be hoisted.
- **`useReducer` is the best fit on the ladder**: a reducer is a command handler and `dispatch` is intent, so it maps onto the command log (§4.6) with better fidelity than `useState`.
- **Not lowered:** `useRef` (mutable, holds DOM nodes, not serialisable); `useState<T>` where `T` is not JSON-shaped (functions, DOM nodes, class instances) — detecting that needs types, so it is a sidecar check and a bail-out when the sidecar has not run; anything inside `node_modules`.
- **The hazard is not a conditional `useState`.** That breaks React's rules of hooks, so the compiler may assume it does not occur. A **custom hook called conditionally** does occur, looks legal, and hides `useState` behind one call. Any `use*` call under a conditional, loop, logical short-circuit or after an early return makes the _whole component_ ineligible — the bail-out granularity `babel-plugin-react-compiler` uses, for the same reason.

_Lineage (R65): global-by-default local state — Statebus, Legend-State; instance-scoped node ids — §4.9; component-level bail-out on unanalysable hook usage — `babel-plugin-react-compiler`._

### 20.4 Rung 2 — fine-grained rendering

The brutal part first. Solid compiles JSX to DOM operations because a read is a **call** (`count()`), so every reactive expression is syntactically visible. In React a read is a plain value, so the compiler must perform escape analysis to decide which JSX expressions depend on state. That difference, not the list of escape hatches, is why a general solution does not exist — the escape hatches merely finish the argument, each meaning arbitrary code touches the subtree.

**Eligible subset:** a leaf component with static element types (no component-from-props, no render-prop children); no ref, portal, context, Suspense, third-party component or `dangerouslySetInnerHTML`; and all JSX expressions traceable to props or store nodes. Eligible components compile to a create-once template plus per-expression updates, hosted inside React by a placeholder that renders once and takes over its subtree — Million.js's `block()` shape, inheriting its limit: it works where the block boundary is clean and nowhere else.

**Everything else falls back to ordinary React, unmodified.** Not a courtesy — the viability condition: a compiler that breaks 5% of components is worthless regardless of the other 95%. Ineligibility is recorded per component in the manifest with a reason, readable via `statec explain <Component>`; `"use no statec"` pins a component to plain React, mirroring `"use no memo"`. Rung 2 is incompatible with React Compiler on the same component — RC would memoise a render body Rung 2 removed — so §5.3's demotion logic applies unchanged.

_Lineage (R65): compiled templates with per-expression updates — Solid's JSX compiler; a compiled block hosted inside React — Million.js; bail-out with reasons — React Compiler; streaming-friendly compiled templates — Marko._

### 20.5 Rung 3 — resumability **[may never happen]**

§1 lists Qwik resumability as a v1 non-goal; this is where it would return, and only in half.

State is the easy half: a store is JSON-shaped and `dehydrate`/`hydrate` already exist (§7). Closures are the hard half: resumability requires every event handler to become an independently loadable chunk with its captured environment serialised and re-linkable. That is the whole of Qwik's `$` optimizer plus its serialisation rules — a research project of that magnitude, not a feature.

Plausible: store resumability plus lazy handlers for Rung-2 leaves whose closures capture nothing but store paths and props (Qwik's serialisability rule applied to a subset we already restricted). Not plausible: general resumability of arbitrary React code.

_Lineage (R65): `$`-boundary closure extraction and lazy handler chunks — Qwik; graph dehydration — §7._

### 20.6 Runtime type checks (R31)

The same generator as decision #17 — one validator engine, not a second. The toolkit already checks three doors (hydration, sync-in, replay; §4.12); `statec` adds three compile boundaries: **component props**, **custom-hook returns**, **module exports**. Cost is a monomorphic generated function per checked type — a handful of comparisons for a flat object, measurable in `state bench`, not free. They are stripped by a compiler flag, not a runtime condition, so production ships no dead branch. Types come from the TypeScript sidecar; without it no checks are emitted, rather than weaker checks being guessed.

### 20.7 R42 — an agnostic core with per-engine variants

One IR of **reactive boundaries** — where a value is read, where it is written, which crossings escape a component — with per-engine back-ends.

Which half generalises: one IR for **state access** across React, Solid and Vue is realistic, because §6's adapters already reduce to four primitives (`subscribe`, `getSnapshot`, `signal`, `scope`) and the boundary analysis is about the code, not the renderer. One IR for **rendering** is not — Rung 2 codegen is per-engine, and a second back-end means a second codegen, not a second config file. The claim that one IR covers React and Solid and Vue rendering is the kind that collapses on contact with the second framework, and this spec does not make it. A second back-end needs the engine's component-boundary rules, its update primitive, and a fallback as graceful as Rung 2's. React first; Solid second, because its runtime is closest to ours and would expose the IR assumptions we have not noticed.

R42's second half — avoiding V8 deoptimisations in emitted code (hidden-class stability, monomorphic call sites) — is a property of the emit rules, shared with `state build`, and is specified alongside R44 in §5.6.

### 20.8 R46 — js and wasm builds of the core

Decided here, and sceptically: **an object-graph core in wasm loses.** The reactivity graph is read by JS rendering code, so every read crosses the JS↔wasm boundary, and a crossing plus a marshal costs more than the Proxy trap it replaces. R62 narrowed the earlier blanket verdict to object graphs specifically; this section keeps that narrowing.

Where wasm genuinely wins: **columnar collections** (a keyed collection in typed arrays, where JS reads a view and hot operations — filter, sort, aggregate over large row counts — never cross per element); **the query engine** (Danny's Datomic-like Rust→wasm database, already the intended query layer — decision #11, R32); and the existing **CRDT and SQLite plugins** in the worker host (§8.8).

A dual build therefore ships the JS core unchanged as the default plus an optional `state/collections/columnar` wasm module and the query engine — **not** a wasm re-implementation of the store — and stays inside §8.8's constraint: no SharedArrayBuffer, no COOP/COEP requirement anywhere. The enable condition is measured, not asserted: `state bench` shows the wasm collection path beating the JS path by the margin configured in `state.config.yaml`, on the project's own data. No number is claimed because none has been measured (R66). Shared memory, zero-copy host↔guest views and cross-origin isolation belong to the R43/R62 research document (to be written).

### 20.9 Verification and the honest gate

A compiler that changes semantics is worse than no compiler. §5.1 already requires compiled and uncompiled builds to pass the same suite; `statec` needs more, because its input never agreed to our model.

**Differential testing.** Each fixture runs twice — uncompiled React and `statec` output — driven by the same recorded interaction script. A divergence is any of: a DOM difference after any event (snapshot per event, not per test); a difference in the command and patch logs modulo `instanceId`; a different console warning or error; a thrown exception on one side only; a differing effect order. Render _counts_ are excluded — reducing them is the point.

**Corpus:** Hyper itself (the first customer, §15), the Playground application, and public TodoMVC-class fixtures with deliberately awkward components — a portal, a context consumer, a Suspense boundary, a third-party date picker — whose job is to be _rejected_ by eligibility analysis, not compiled.

**The rule:** every rung ships behind its own flag, disabled by default, until it passes the corpus with zero divergences. A rung that cannot be made to pass is withdrawn, not shipped with a caveat.

The cautionary literature is unanimous. Prepack was ambitious and abandoned: whole-heap evaluation and re-serialisation held only in a closed world and collapsed on any external side effect it could not model. Closure Compiler's advanced mode works only because it demands the whole program be compiled together — property renaming breaks on anything that is not. GWT shipped real Java-to-JavaScript for a decade and taught the general lesson: a compiler that quietly changes semantics (longs, threading) shifts the debugging cost onto every user, forever. All three were technically impressive. This gate exists so `statec` fails loudly at build time instead of joining them.

### 20.10 Roadmap

- **Rung 1 — intended.** Starts when §18's spike passes go/no-go and `useLocal` is real; roughly four weeks including the differential harness. Nothing else starts before it ships enabled somewhere.
- **Runtime type checks — intended**, immediately after Rung 1: the generator exists (decision #17), only the injection points are new.
- **Rung 2 — exploratory.** Starts only if Rung 1 has run a full release on Hyper with zero divergences _and_ a measured render-cost problem exists that fine-grained updates would solve. Without the second condition it is a solution looking for a problem.
- **R46 columnar/wasm — conditional.** Starts when a real project has a collection large enough for `state bench` to show the margin, and the R43/R62 research document has been written.
- **Rung 3 — [may never happen].** Would require Rung 2 shipped and stable, a serialisability analysis we do not have, and a customer whose time-to-interactive problem is not solved by islands (§7).

---

## Appendix A — Spike API reference (v0, subject to change after go/no-go)

```ts
// ---- core ----
createStore(opts?: { scope?: Scope; name?: string }): Store
interface Store {
  use(...defs: (SliceDef | ComplexDef)[]): Store
  actions<D extends SliceDef | ComplexDef>(def: D): Actions<D>       // bound instance
  get<D>(def: D): Node<State<D>>                                        // root node of a mounted slice
  tx<T>(name: string, fn: () => T, meta?): T                            // explicit transaction
  subscribe(target: Node | Selector, cb: () => void, opts?): Unsubscribe
  getSnapshot<T>(node: Node<T>): Snapshot<T>                           // cached reference until next commit touching node
  on(event: string | PatchListener | TxListener, handler): Unsubscribe
  tick(): void                                                          // drain bus listener queue
  dispose(): void
  readonly commands: readonly Command[]                                 // when events retains commands
}

defineSlice<F, C, A>(name: string, def: {
  fields?: F                         // Standard Schema per field
  collections?: C                    // collection(...) per key
  initial: Initial<F, C>
  actions?: (s: Draft<F, C>) => A
  derived?: (s: Reader<F, C>) => Record<string, Derived>
  writes?: 'loose' | 'warn' | 'strict'                 // default 'loose'
  events?: 'commands' | 'patches' | 'both' | 'none'
  history?: false | { scope?: 'slice' | 'complex' | 'global' | string; mergeInterval?: number; limit?: number; persist?: boolean }
  persist?: PersistPolicy
  sync?: never                        // slices don't sync; collections do (source)
}): SliceDef

collection<T>(schema: StandardSchema<T>, opts: {
  key: keyof T | ((t: T) => string)
  source?: Source<T>
  mutators?: Record<string, { args?: StandardSchema; run: (c: CollectionDraft<T>, ...args) => void; optimistic?: boolean }>
  gcTime?: number; staleTime?: number
}): CollectionDef<T>

interface Node<T> { readonly $: Signal<Snapshot<T>>; readonly path: string /* JSON Pointer */ }
interface CollectionNode<T> extends Node<Collection<T>> {
  ids: Node<string[]>; get(id: string): Node<T> | undefined
  insert(t: T): void; upsert(id: string, fn: (prev?: T) => T): void; remove(id: string): void
  map<U>(fn: (t: T) => U): U[]; query?: never /* state/query-tanstack */
  loadSubset(opts: { cursor?: string; offset?: number; limit: number; where?; orderBy? }): Promise<{ hasMore: boolean }>
  refetch(): Promise<void>; invalidate(): void
  readonly $synced: Signal<boolean>; readonly $pending: Signal<number>
}

interface Transaction { id: string; ts: number; cause?: Cause; command?: Command; patches: Patch[]; inversePatches: Patch[]; meta: { transient?: boolean; origin?: string } }
type Patch = { op: 'add' | 'replace' | 'remove' | 'move'; path: string /* JSON Pointer */; value?: unknown; from?: string }
type Command = { name: string; args: unknown[]; actorId?: string; ts: number; txId: string }

// identity rules
snapshot(x)  // plain object graph; snapshot(a) === snapshot(a) until a commit touches a; Object.is-comparable
raw(x)       // underlying target; raw(proxy) === raw(proxy)
ref(x)       // opaque; never proxied, never patched (stored by reference, excluded from persist/remote)
// Map/Set → state.map()/state.set() reactive wrappers; Date/URL/class instances → ref by default
// arrays: `length` is its own signal; index writes patch `/path/<index>`; splice generates minimal move/remove ops
// destructuring a Node/snapshot copies plain values — no reactivity; lint rule `state/no-destructure-node`

// ---- react ----
<StateProvider store | create initial?>            // one of store | create
useSlice<T>(node: Node<T> | SliceDef): Snapshot<T>  // snapshot mode
useSlice<T, U>(node, selector: (s: Snapshot<T>) => U, equals?): U
useActions<D>(def: D): Actions<D>
useComplex<D extends ComplexDef>(def: D): ComplexHandle<D>
useLocal<T>(def: LocalDef<T>, key?: string): { value: T; set(v: T | ((p: T) => T)): void; node: Node<T> }
useItems<T>(coll: CollectionNode<T>): readonly string[]; useItem<T>(coll, id): Snapshot<T> | undefined
<For each filter? sort?>{(item: Node<T>) => ReactNode}</For>
useTracked(): void                                   // 'use state:tracked' only
```

## Appendix B — Remote wire protocol v1 (`remote`, mode `command`)

Messages are JSON objects `{ t: type, ...payload }` on a transport `{ post, onMessage, close }`. All numbers are monotonic per leader session (`session` changes when the leader restarts).

| From → To         | Message       | Payload                                                                              | Semantics                                                                                                                                      |
| ----------------- | ------------- | ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| replica → leader  | `hello`       | `{ replicaId, slices: string[], lastSeq?: number, lastSession?: string }`            | On connect/reconnect. `lastSeq` from `vscode.setState`/memory.                                                                                 |
| leader → replica  | `welcome`     | `{ session, seq }` then either `resync` or `snapshot`                                | `resync` if `lastSession === session` and `lastSeq` is within the buffer; otherwise `snapshot`.                                                |
| leader → replica  | `snapshot`    | `{ seq, slices: { [name]: raw } }`                                                   | Full raw values (no proxies, `ref`s omitted). Replica replaces truth, **keeps its optimistic overlay** and re-applies it.                      |
| leader → replica  | `resync`      | `{ from, to, txs: TxMsg[] }`                                                         | Buffered transactions in order.                                                                                                                |
| replica → leader  | `cmd`         | `{ cid, txId, name, args, actorId, ts }`                                             | A command executed optimistically on the replica under `txId`.                                                                                 |
| leader → replicas | `tx` (TxMsg)  | `{ seq, session, txId, origin: replicaId \| 'leader', patches, cause?, transient? }` | Broadcast to all replicas **including the sender**; the sender matches `txId` and drops its overlay entry; others apply as `origin: 'remote'`. |
| leader → replica  | `reject`      | `{ txId, reason, patches? }`                                                         | Command rejected (strict mode, validation, conflict); replica rolls back the overlay (`inversePatches`) and emits `remote.rejected`.           |
| either            | `ping`/`pong` | `{ ts }`                                                                             | Liveness; also used to measure lag shown in devtools.                                                                                          |

Rules: a replica never applies its own optimistic patches to truth — truth changes only via `tx`/`snapshot`; `seq` gaps trigger `hello` with `lastSeq` (never silent skipping); leader buffer per session is bounded (500 tx / 256 KiB, configurable) and `transient` transactions are coalesced per frame before broadcast and never buffered for resync; payloads over the transport budget are chunked (`{ t: 'chunk', id, i, n, data }`) and reassembled before dispatch; message schema version is negotiated in `hello/welcome` (`v: 1`).

Why this closes the `mergeInitState` race: the webview's local selection is an optimistic overlay keyed by `txId`; a `snapshot` (the old `state:init`) replaces truth but the overlay is re-applied on top, so the selection survives until the leader either echoes the `tx` (overlay dropped, truth now contains it) or `reject`s it.

## Appendix C — Hyper spike integration map

| Today                                                                                                 | Spike replacement                                                                                                                                                                                        | Notes                                                                                                                                        |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/lib/platform/shared-editor-state.ts` (Zustand replica, `applyPatch/init`, `mergeInitState`)   | `defineSlice('editor', …)` + `remote.follow(store, editor, { transport: vscodeWebview() })` in webviews                                                                                                  | `mergeInitState` deleted; behaviour covered by Appendix B overlay rule; keep `useSharedEditorState()` as an alias hook for one release       |
| `vscode-extension/hypercanvas-preview/src/StateHub.ts` (`register/applyUpdate/broadcast`)             | `remote.lead(hostStore, editor, { transport: vscodeHost(panels) })`                                                                                                                                      | `vscodeHost` wraps `webview.postMessage` + `onDidReceiveMessage` per registered panel; `register(panelId, webview)` becomes transport attach |
| `PlatformMessage` `state:init` / `state:update` variants                                              | Appendix B messages under `type: 'state:*'` namespace on the same bus                                                                                                                                    | Other `PlatformMessage` variants untouched in the spike                                                                                      |
| `client/components/github/hooks/useGitHubRepositories.ts` (7× `useState`, manual paging, `authFetch`) | `collection(GitHubRepository, { key: 'id', source: rest({ url: '/api/github/repositories', params: { org, search, sort }, page: 'offset', perPage: 20, fetch: authFetch }) })` + `useItems`/`loadSubset` | Same hook signature exported as an adapter for the existing consumer component                                                               |
| `client/stores/editorStore.ts` `loadPersistedState/savePersistedState`                                | untouched in the spike (weeks 3–6: `persist`)                                                                                                                                                            | —                                                                                                                                            |
| Webview `vscode.getState/setState`                                                                    | `remote` stores `{ session, lastSeq }` + the UI slice snapshot                                                                                                                                           | Through `persist/vscode` later; direct calls in the spike                                                                                    |
| Feature flag                                                                                          | `HYPER_STATE_SPIKE=1` env at build, both paths compiled; rollback = flag off                                                                                                                             | Existing tests must pass in both modes                                                                                                       |

Measurements the spike must report (§13 spike bars): bundle delta of the webview, transactions/s and lag in the VS Code leader/replica path (devtools `ping`), `postMessage` payload sizes, React microbench vs the current Zustand stores, heap diff on selection changes.

## Appendix D — Review record

v0.1 → v0.2 changes (from an independent consistency review against the brief): snapshot mode is the only inferred React mode; one scheduling pipeline (sync effects and notification, microtask bus); actions bound via `useActions`/`store.actions` — no definition-level calls; core split into `state` + `state/collections` with query/joins moved to `@state/db-ivm`; budgets restated with an uncompiled minimal-app bar and spike-only bars; patch generation gated by consumers, `events` controls retention; `useLocal` lowering disabled with `record`; layering rewritten as a DAG; vendoring decided; spike scope aligned between §15 and §18; monotonic read-path union under React Compiler; signals-in-JSX marked experimental; VS Code destroyed-webview resync flow; TanStack DB shim semantics and version pin; async actions end at first `await`; ALS moved to `state/ssr`; RR7 `defer` removed; per-boundary hydration; no directive insertion by the compiler; SharedWorker wording; defaults for strictness, remote mode, conflict policy, `useLocal` ids, source lifecycle, message budgets, bare-write commands, Astro registry; wrong briefing-question reference fixed; §4.8 cross-reference fixed; Appendices A–C added.

## 21. Reading and execution clarifications (2026-09-08)

R85–R92 and decision #30 are explained in the research guide published at `/learning`.

**Reactive consistency.** A subscribed UI/effect causes a pull after invalidation; “lazy” describes computed evaluation, not absence of consumer scheduling. A single-write diamond and several independent writes are different consistency problems. The runnable prototype uses synchronous notification batching: `tx()` delays observers, while explicit reads inside its body see current edits. It has no rollback, no asynchronous isolation, and no distributed two-phase commit guarantee. Microtask scheduling alone must not be described as old-snapshot reads. See the paired REPL examples `writes-unbatched` / `writes-batched`.

**Region declaration.** `createStore({ ui: region.view({ panelOpen: false }), draft: region.draft({ note: '' }) })` is implemented in the site prototype. Metadata is stripped during initialisation; normal reads are unchanged. Pointer maps remain supported, with explicit options overriding matching annotated paths. Only implemented per-region policies may be claimed; tags alone do not enable I/O. The current prototype demonstrates persistence filtering, not every planned policy in §4.16. Prior-art ingredients: React component identity/lifetime, MobX-state-tree volatile state, selective persistence. No single originator of “state lifetime” is asserted.

**Electric.** The current read protocol includes initial shape data, changes, shape handle + log offsets, up-to-date and must-refetch controls; its live mode can use long polling or SSE. Reconnection and cache safety are protocols and policies, not automatically supplied by HTTP. The six protocol labs are local teaching models; the optional real HTTP exercise is a small read-only adapter, not the production Electric SDK or Danny's query engine. Its SSE display deliberately restarts with a fresh snapshot rather than inventing durable event-ID checkpoint semantics.

**Step and static reading.** Steps are actual top-level execution checkpoints; Run does not insert an artificial yield between synchronous statements. Setup is initialised before stepping, and already-started async callbacks remain live. Scrubbing records does not roll back live objects. Markdown exports preserve the complete editor source, not just CodeMirror's virtualised visible lines. No-JavaScript readers receive real HTML; execution controls still require JavaScript.
v0.1 → v0.2 changes (from an independent consistency review against the brief): snapshot mode is the only inferred React mode; one scheduling pipeline (sync effects and notification, microtask bus); actions bound via `useActions`/`store.actions` — no definition-level calls; core split into `state` + `state/collections` with query/joins moved to `state/query-tanstack`; budgets restated with an uncompiled minimal-app bar and spike-only bars; patch generation gated by consumers, `events` controls retention; `useLocal` lowering disabled with `record`; layering rewritten as a DAG; vendoring decided; spike scope aligned between §15 and §18; monotonic read-path union under React Compiler; signals-in-JSX marked experimental; VS Code destroyed-webview resync flow; TanStack DB shim semantics and version pin; async actions end at first `await`; ALS moved to `state/ssr`; RR7 `defer` removed; per-boundary hydration; no directive insertion by the compiler; SharedWorker wording; defaults for strictness, remote mode, conflict policy, `useLocal` ids, source lifecycle, message budgets, bare-write commands, Astro registry; wrong briefing-question reference fixed; §4.8 cross-reference fixed; Appendices A–C added.

## 22. Guided learning and navigation

This section covers the site experience, not a stable public API or new runtime semantics.

| Requirement                                 | Destination                                                                                            |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| R99 — literate product experience           | Home, the shared Code/Markdown presentation, guided REPL lessons and the separate exact-source editor. |
| R100 — unified navigation and scoped search | The shared header and menu/search panel on every route.                                                |

The homepage begins with an interactive product demonstration and concise benefits. Learning flows show their purpose and the live outcome before advanced source editors. Explanatory full-line comments render as ordinary prose; the exact original source remains available for inspection and export. A primary Try link leads to a complete relevant scenario. Reference-only signatures and dialects retain a separately labelled View source action; the related demo is not presented as execution of that source.

The header orders brand, current page, current section and one combined menu/search control. Page and combined-control actions reveal global navigation and a search field together. The section action opens the same panel with the rendered page's heading list and explicit In page scope. Queries in that mode search heading titles and section text, prioritizing title matches. No-match results keep the scope intact. Removing the tag by its cross preserves the query; Backspace removes it only after the input is empty.

Heading selection navigates to the real rendered anchor and closes the panel. Escape returns focus to the opener; modal keyboard focus remains contained. Input text is at least 16 CSS pixels and user scaling is not disabled. Desktop/mobile Chromium or desktop WebKit checks establish layout and interaction coverage, not a claim that physical iPhone keyboard zoom has been tested.

Decision 34 supersedes decision 33's primary Try destination while preserving exact-source and no-auto-run guarantees. Decision 35 defines the unified navigation scope. Delivery and review belong to HYP-1463; the broader API programme remains HYP-1457.

| R101 | Contextual vecli figures; shared ASCII frame/table repair and preserved text source. No standalone diagram page. See vector-cli/examples/diagrams/README.md and site/src/lib/inline-diagram.ts. |
