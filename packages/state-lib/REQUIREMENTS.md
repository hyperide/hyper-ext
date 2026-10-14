# Requirements — canonical list

Consolidated from Mextner's working notes and decisions (2026-09-01 → 2026-09-03), cleaned up and translated to English. This file is the source of truth for requirement IDs; the master spec traces to them. Status: **spec** = covered by master spec v0.3, **partial** = spec covers part, **backlog** = not yet in spec.

## Product frame

- **F1.** A universal state toolkit for any project's state — a new, opinionated, universal product, not a Hyper-internal library. Hyper (VS Code extension + SaaS sharing one React codebase) and apps users build in Hyper are the first customers and the acceptance test. _(spec §1)_
- **F2.** Disappearing framework: a compiler specialises the library per project usage (Svelte-style); the bundle contains only what the project uses; a CLI scaffolds per project needs. _(spec §5)_
- **F3.** Toolkit, not monolith: every capability is an optional, replaceable module; everything works well together and without any part, or with parts swapped for what a project already uses. _(spec §1, §3)_

## Ergonomics

- **R1.** Global store as convenient as local React hooks; no selectors or manual memoization in the common case. Redux's real pain was not boilerplate but constant memoization — easy bugs, slow, memory-hungry. _(spec §4.3)_
- **R2.** Mutable-looking writes over immutable, structurally shared snapshots. _(spec §4.2, §4.4)_
- **R3.** Colocation and reuse: state + logic + UI decomposable per page and per reusable "HOX" (high-order compleXes: reducers + selectors + actions + adapters/providers + widgets for a reused UI part — Mextner's Redux-era invention); sliceable into hooks; no `_.get(state,'a.b.c')`. Hooks proved that uniting ui+state+logic enables easy decomposition; reducers/thunks implicitly relying on state made them hard to test and detached logic from components. _(spec §4.8)_
- **R4.** Per-item updates in `items.map(<Card/>)` / `<For>` without re-running the loop. _(spec §4.5, §6.1)_
- **R5.** Familiar, invisible, universal, fast — no Solid-style special utilities (e.g. prop-splitting) required of the user. _(spec §5, §6)_

## Model

- **R6.** All state global — including pure UI state and per-keystroke form state. redux-form was a mistake of mechanism, not principle: the mechanism must make this free. _(spec §4.9)_
- **R7.** Events for all changes (Danny's requirement). Event sourcing + FSM are the useful concepts inside Redux. _(spec §4.4, §4.6)_
- **R8.** Signals as the reactivity primitive. _(spec §4.1)_
- **R9.** Structural sharing; memory-conscious. _(spec §4.4)_
- **R10.** Undo/redo and optimistic updates as toolkit features. _(spec §4.10, §4.11)_

## Data / middleware toolkit

- **R11.** Pluggable data-source middlewares with auto-sync: REST, GraphQL, RPC (incl. VS Code postMessage), WebSockets/SSE, RxJS, CRDT, TanStack; combinable heterogeneous sources. _(spec §8)_
- **R12.** Local persistence with filtering of what persists (IndexedDB etc.). _(spec §8.5)_
- **R13.** Browser history / routing / URL query as store-backed state. _(spec §8.6)_
- **R14.** Middlewares (and core where it pays) may use wasm, web workers, service workers. Decision so far: core stays pure JS; wasm only in CRDT/SQLite plugins inside the worker host. _(spec §8.8, §9.3)_

## Engineering qualities

- **R15.** Easy unit tests for dumb components; per-test store instances. _(spec §12.1)_
- **R16.** Easy debugging of user problems — reproducible event logs, recordings. _(spec §11.4)_
- **R17.** Easy Storybook stories. _(spec §12.2)_
- **R18.** Clean separation: UI / UI logic / business logic. _(spec §4.8, §17)_
- **R19.** Framework-agnostic core; adapters for React/Vue/Solid/Svelte/web components; works with SSR, server components, meta-frameworks (front+back in one framework). _(spec §6, §7)_ Core/toolkit conformance matrix: `docs/api/CORE-TOOLKIT-CONFORMANCE.md` (HYP-1507 pilot, integration pending).
- **R20.** Zero dependencies, tiny bundle, ESM, tree-shaking; "faster than vanilla JS" as aspiration, measured bars as the enforceable form. Old browsers can be dropped. _(spec §13, §14)_
- **R21.** Devtools that are pleasant and never freeze — unlike Redux DevTools' UI. _(spec §10)_
- **R22.** Modern browsers only. _(spec §13)_

## Compiler, CLI, tooling

- **R23.** Compiler ("disappearing framework"): per-project specialisation; all React integration modes available, selected per component; event-logging mode per slice. _(spec §5)_
- **R24.** `state-cli`: `init` (interactive scaffolding), `migrate`, `build` (compiler), `doctor`, `bench`. _(spec §11.2)_
- **R25.** Agent tooling (MCP): search/edit of state definitions, dumping states from a backend into fixtures, generating dev-server mocks from snapshots and recorded event logs. _(spec §11.3)_
- **R26.** `state.config.yaml` records the approach chosen at `state init` as explicit invariants; `state lint` guarantees the project uses that one approach (no conflicting or bundle-bloating mixes); `state migrate` is the fix/normaliser. Invariants change only by explicit edits. _(spec §5.1, §11.2)_

## Added 2026-09-03

- **R27 (backlog).** Detailed cross-library comparisons: features and performance and other criteria, library vs library. Features are of two kinds — comparable ("better here, worse there") and _different-approach_ features that win in different use cases; both must be represented. With visualizations, and easy navigation between tools, features, and concepts.
- **R28 (backlog).** Benchmark suite covering different data types, data volumes, operation kinds, and real-world scenarios — not just microbenchmarks. Results surfaced next to examples (see R38).
- **R29 (backlog).** Runtime type checking section and integration: survey the new generation of validators that are many times faster than zod/ajv (candidates to verify: ArkType's JIT set-theory engine, typia's compile-time codegen, TypeBox/valibot), pick the story for validating at collection/action boundaries, and compare honestly.
- **R30 (partial — spec §11.2).** `state migrate` must migrate code _from other libraries and approaches_ to our system, ≥80% automated via AST/LSP, targeting the project's chosen usage variant; whole-project or piece-by-piece; must also switch between our own usage shapes (hooks ↔ multiple stores ↔ single store); must analyse the repository to help choose the target configuration; **every migration offers an optional LLM post-processing step** to finish what AST rules could not.
- **R31 (backlog — separate utility, not inside state-cli).** A compile-React tool inspired by (and compared against) React Compiler, which "only removes useMemo" — we should aim higher: optionally compile React code into something Solid-/Qwik-like and super-optimised, with optional runtime type checks injected; components keep using `useState` while the compiler turns it into global state under the hood — giving full-state testing, user-problem debugging, recordings, and the rest of the global-state benefits without changing component code.
- **R32 (backlog).** Danny's database as the query layer: a Datomic-like DB written in Rust compiled to wasm, with a powerful query language. Complex derived state moves from hand-written, slow, test-heavy selectors into declarative queries against it. Datomic's other relevant idea: history/versions as a first-class citizen (Redux never made this convenient even with middleware) — aligns with our patch-log design and should shape it.
- **R33 (backlog).** Assess Hyper-side benefits before/while migrating: which whole classes of Hyper bugs the new state engine eliminates; whether it gives the right path to collaborative editing; indexing all code and worktrees; fast editing/navigation; blast-radius view; possible benefits for the style-editing-core master spec.
- **R34 (backlog).** Illustrations for all concepts, found/inspired/made in one unified style; validated for comprehensibility by an iterative protocol: show another model/subagent the illustration with minimal context, see what it understands, add hints, iterate and improve the illustration.
- **R35 (this package).** All state work lives in `packages/state-lib`: documentation site with comparisons, specs, accepted decisions, etc. — and the site must be interactive.
- **R36 (backlog).** `state cli` provides documentation search (so agents can help a human get oriented fast); every command works both as a pretty interactive TUI and in machine-readable mode.
- **R37 (backlog).** `state cli` implemented in Python, in the style of the rig ecosystem tools. (Tension to resolve: the analyzer/compiler must live in TypeScript to use the TS compiler API — the likely shape is a Python CLI/TUI shell in rig style driving a TS analyzer service; see DECISIONS.)
- **R38 (backlog).** Interactive examples, not just visualisations (animated and clickable): code examples as REPLs with live state visualisation, easy switching between approaches/examples, with perf and bundle-size benchmarks shown in place.
- **R39 (backlog).** Devtools comparison across every tool that has them.

## Decision changes (2026-09-03)

- **D-react-mode.** React tracked mode (`useSignals`-style render tracking) should be **opt-out, not opt-in**: enabled by default and _recommended instead of React Compiler_, since our compiler + fine-grained subscriptions aim to make React Compiler unnecessary. Snapshot mode remains the automatic fallback where React Compiler is detected and active. (Supersedes the v0.2 "snapshot is the only inferred mode" default; the config invariant records the choice per project.)
- **D-zustand.** Zustand is upgraded from "context/superseded" to a **primary competitor deserving deep comparison**: it has many strong ideas and APIs and many usage variants (actions in the store or not, direct writes vs actions, slices, vanilla, middlewares) — the comparison must cover its variants, not one caricature.
- **D-rxjs.** RxJS is not only an API-layer item: compare it as a reactivity system too (push streams vs pull signals), and study operator fusion (e.g. most.js merging consecutive `map`s into one) as an optimisation our compiler should apply to derived chains.
- **D-legend.** Legend-State's fine-grained React primitives deserve a feature-level comparison against Solid and others (are they more convenient/faster?), not just a "watch" verdict.

## Confirmed formulations

- Redux ≈ event sourcing + FSM: yes, with nuance — actions are events and the state is their fold (event-sourcing shape), but the events are not the persisted source of truth and reducers are transition functions without explicit states/guards (implicit FSM). Our design makes both aspects explicit and optional: the command/patch logs are real logs, and `fsm()` is a real state machine.

## Added 2026-09-03 (second batch)

- **R40 (spec update pending).** `state migrate` gets **subcommands**, not one command with every option: the described scenarios are entirely different migrations — `migrate from <lib>` (other library/approach → ours), `migrate shape <hooks|multi-store|single-store>`, `migrate slice <name> --sync <a>→<b>` (e.g. auto DB sync → manual handlers), `migrate mode` (react mode / events mode changes), each with `--analyze`, partial scope, and the optional `--llm` post-process step.
- **R41.** The push-pull reactivity core must exist as an **isolated, pure, well-tested dependency**. If no library offers that shape (alien-signals is isolated and pure but carries modest test coverage), we publish our own standalone package with a serious test suite. Additionally: benchmark the implementation variants against each other — linked lists vs arrays for dependency storage, dirty flags vs version counters — and either pick the winner or make the variant switchable (statically per build, possibly dynamically per workload) behind the same interface.
- **R42 (extends R31).** Our own TS/React compiler direction: an agnostic version plus variants for any JSX and for specific rendering engines (React first). It must understand where reactive boundaries are crossed and inject the required code automatically, so application code looks completely familiar — deep-proxy ergonomics without manual wiring (no special utilities, per R5). It must also actively **avoid V8 deoptimizations** in its output (hidden-class stability, monomorphic call sites) — this belongs to the standalone TS compiler as much as to `state build` (R44).
- **R43 (research).** wasm state research: can the whole state live in wasm memory — shared memory (SharedArrayBuffer/threads), zero-copy or copy-avoiding schemes, layouts that exploit our immutability/structural sharing; alternatively invent algorithms that give deep-proxy ergonomics without Proxy overhead, or rethink the approach to avoid Proxy entirely. Compile-target variants: js and wasm builds of the core (R46).
- **R44.** `state build` should also _optimise_: simplify generated code, reduce deoptimisations (hidden-class stability, monomorphism), use asm.js-style patterns where they help, and emit performance hints for developers/agents; where transpilation alone cannot achieve an optimisation, `state migrate` applies it as a refactor.
- **R45.** Devtools name fidelity: React DevTools notoriously fails to show hook names (even the "parse hook names" button usually fails). In our devtools names and internal values must **always** resolve — with zero runtime overhead, via a separate build-time metadata file ("devtools maps", analogous to source maps) shipped next to the bundle.
- **R46.** Compile-target variants: js and wasm outputs of the core (see R43).
- **R47 (research section).** Offline-first collaboration: the concrete pattern for working without internet, accumulating local edits, and syncing to the backend when connectivity returns — as its own section alongside collaborativity, CRDTs and adjacent approaches (relates to spec §8.7 outbox and §4.11, but needs the full comparative treatment).
- **R48 (research).** redux-form post-mortem: analyse in detail why exactly it was slow and inconvenient, and document point-by-point how our design avoids each cause.
- **R49 (decision).** typia-style compile-time validation is adopted as the default validation story in our compiler (validators generated from TS types at build time, zero runtime schema cost); runtime schema libraries (zod/ArkType/valibot) remain supported via Standard Schema for interop.
- **R50 (research).** ElectricSQL ideas beyond the state toolkit: evaluate its resumable-shape-log model for Hyper itself and for the code factory inside Hyper (today the rig+lmao/axe ecosystem) and the agent-orchestration system — they position it for agent workloads.
- **R51 (matrix conventions).** The comparison matrix may assign **multiple verdict badges** per row with per-badge notes (e.g. "steal ideas" + "interop"); PouchDB/CouchDB is reclassified as _context_; the API layer vs Transport & tooling split needs clearer layer descriptions (API layer = how the app talks to backends: typed requests, caches, subscriptions; Transport & tooling = the plumbing and DX around our own modules: message bridges, URL state, undo helpers, devtools hosts).
- **R52.** Immutable.js is not fully discarded: mine and possibly improve its ideas (HAMT node design; it can beat Immer when staying inside its structures and skipping `toJS`); likewise structura.js ideas (compile-time freezing via readonly types, circular/multi-reference support, moves/transpositions inside drafts) are candidate features.

## Added 2026-09-03 (third batch)

- **R53 (positioning).** The ambition is to become **the Postgres of client-side state** — default universal infrastructure, not a niche library. Hyper and Hyper-generated apps are only the proving ground, not the audience definition.
- **R54 (docs system).** Every reference is a link with a hover tooltip: requirement ids (R-n), spec sections (§n), quotes, and every named term/concept/library (nuqs, birpc, inverse patches…). Definition sites are hover/clickable too and show **backlinks** (all mentions). Requests are numbered and individually named so prose can cite them instead of vague phrases (the word "braindump" is retired from public docs). Link styling stays calm — subtle/semi-transparent underlines rather than a sea of blue (reveal-on-hover was considered and rejected: accidental-click confusion).
- **R55 (site positioning).** The state-lib site speaks as an open-source library's site: no first-adopter internals; examples abstracted ("a VS Code-extension-shaped app", "a multi-tab app"). Adopter-specific research and migration live in the adopter's own repo docs (`hyperide/docs/specs/2026-09-03-hyper-state-adoption.md`), including the transports inventory (REST/SSE/WS/RPC — per-situation transport is fine and is an adapter test bed).
- **R56 (data modeling layer).** Relate stores ↔ models ↔ HOX explicitly. Wanted: models/DTOs where derived fields live _next to_ raw data (not only in detached selectors); explicit tiers so it is always clear what is **source of truth** (consistent, non-contradictory), what is **preprocessing** (done in actions), and what is **derived**; custom data types with serialization/deserialization and consistency guarantees but _without_ OOP encapsulation of behaviour (e.g. a currency type that can't be confused with a number — domain-specific ones for the adopters); constrained strings (most strings should carry constraints checked at compile time and runtime, flowing into the forms story — possibly our own forms module + interop + native HTML validation); chaining ergonomics over open data (no classes needed); composition + interfaces only — **no inheritance**, with the single tolerated exception of one-level inheritance from a library base (React class components / MVC frameworks style); classes recognised for what they conflate: (1) custom types, (2) utility groups with pre-bound ctx, (3) framework component contracts. Also: review MVVM and other historical architectures for surviving ideas and where they evolved.
- **R57 (store GC / rotation middleware).** Long-lived tabs must not grow unboundedly while still keeping the "walk back through posts without refetch" cache benefit (revalidate-only requests). A toolkit middleware with eviction policies driven by per-node metadata (reference counts, is-subscribed, last read/write time); automatic typical actions (component unmounted / its data changed → node cleared) exposed as explicit, non-magical decorators — "HOC under a new sauce"; primitives so projects don't invent bespoke eviction actions.
- **R58 (research).** Should the toolkit promote **normalized data from the backend** (server responds in a normalized layout so client manipulations are fast)? Survey existing standards/precedents (JSON:API, normalizr conventions, GraphQL normalized caches) and decide whether to specify a recommended layout schema.
- **R59 (automations layer).** Review redux-saga honestly: what survives (explicitly declared effects/triggers as data vs arbitrary code buried in actions/selectors — likely yes; generator choreography and its complexity — likely no). Wanted: **explicitly declared triggers** that can be visualised and even edited visually. Overall explicit layering of app code: business logic / **automations** (user-configurable business logic) / utility layer / UI logic.
- **R60 (research).** Mobile local-state survey: iOS (CoreData and why it is disliked, SwiftData), Android (Room, DataStore), Flutter (drift, Isar/Hive), KMP (SQLDelight) — inform which toolkit concepts port beyond the web (React Native/Expo first).
- **R61 (research).** VS Code webview transport beyond JSON `postMessage`: `ArrayBuffer` transfer for binary, localhost WebSocket/HTTP via `portMapping` where a local server exists; keep `postMessage` as the baseline driver. (Detail in the Hyper adoption doc §2.5.)
- **R62 (research doc, extends R43/R46).** Deep wasm study for a wasm compile target and shared-memory state: wasm Threads + SharedArrayBuffer (zero-copy sharing between threads), host↔guest zero-copy via pointers + typed-array views over wasm memory, columnar layouts for collections, COOP/COEP / cross-origin-isolation requirements (and what Spectre actually forced), js and wasm dual builds of the core. The earlier "wasm only for CRDT/SQLite plugins" stance is narrowed to _object graphs_; columnar/binary state and query engines are open research, not dismissed.
- **R63 (glossary).** The concepts system gains a glossary: every term used anywhere (inverse patches, RSC, COOP/COEP, OPFS, SharedWorker, SharedArrayBuffer, ByID, atoms, IVM, resumability, SSG, uSES, …) gets a short definition, a link to its full explainer where one exists, and participates in the R54 tooltip system. Comparisons between related terms are first-class.
- **R64 (single source).** The Landscape data has one home (`site/src/data/landscape.ts`); condensed tables elsewhere (the brief) are snapshots that point at it, never a second maintained copy.
- **R65 (prior art).** Every mechanism in the spec and docs cites its lineage — which library/system supplied the idea and what we changed (e.g. `transient` = Zustand's transient-updates name + Yjs/Loro merge-window semantics + LiveStore's clientOnly split). No idea presented as invented when it is assembled; assembled-well is the actual craft claim.

- **R66 (research/content).** Datalog-vs-selectors showcase: collect real-world gnarly reselect/selector pyramids, show each replaced by a Datalog-style query (Danny-DB / derive.collection), demonstrate the readability win, and **measure** the speedups (IVM vs recompute) — no claimed numbers before the harness produces them. First cut lives on the Concepts page ("Queries instead of selector pyramids").
- **R67 (feature).** Two-way control binding, Vue v-model-class: bind a store path to a control with no value/onChange glue — for native inputs (each with its own value/checked/files semantics) and custom components with varying callback conventions ((e), (value), (value, e), (e, value), …). The compiler knows each control's convention and generates exact fast glue per call site — no runtime branching. Interops with the forms story (R56 constrained strings) and native HTML validation.
- **R68 (site).** /validation merged into the Landscape as its own layer (R29 content lives there); a dedicated CLI page presents state-cli as half the product; the Compare page carries hover detail panels (how ours works + why it wins) with honest status tags (prototyped / spec / planned).

## Added 2026-09-04

- **R69 (site delivery).** The docs site is a served application, not a file: routing goes
  through the History API with real paths, a direct request to any deep URL
  (`/requirements`, `/spec`, `/compare`) must be answered by the host with the app rather
  than a 404, `#` is reserved for in-page anchors only (never for routing), an anchor in the
  entry URL must scroll to its target even on a cold load, and browser back/forward must
  behave normally. The site is published so those URLs can be opened and shared. The
  file:// hash fallback exists only for the offline single-file build and must never take
  over the served build. _(asked twice, after two rounds where direct links 404'd and
  `/requirements#R40` did not scroll)_
- **R70 (service workers, decided).** Question asked: should the toolkit support IndexedDB
  and Service Worker caches? IndexedDB — yes, it is the primary persister (spec §8.5).
  Service Workers — not in v1: the Cache API adds little over the ordinary HTTP cache plus
  the persister, and Background Sync (the one real win, for the offline outbox) is
  Chromium-only, so the outbox stays in IndexedDB with in-app retry. A `persist/cache-api`
  module may exist later as an explicitly experimental extra. _(decision #22)_

## Added 2026-09-04 (async lifecycle, cancellation, transitions)

Four capabilities the owner wants as **first-class citizens**, not patterns each project
re-invents. Whether some of them are one mechanism in different clothes is a design
question, deliberately left open here — this section records the asks, not the design.

- **R71 (feature, partial).** Async status as a first-class citizen: every asynchronous
  operation — an async computed, a collection sync, a mutation, a declared effect — exposes
  the same observable lifecycle, `pending` / `loading` / `progress-info` / `success` /
  `error`, readable out of the store like any other state instead of being rebuilt from
  hand-written booleans in every component. `progress-info` carries information, not just a
  flag: steps, counts, bytes or percent wherever the underlying source can report them.
  Today the spec has only fragments of this — `computed.async()` tracks `pending`/`latest`/
  `error` (§4.3) and the optimistic overlay counts `$pending` (Appendix A) — with no single
  lifecycle shared across async sources.
- **R72 (feature).** Cancellation tokens, with cancellation that reaches the actual request
  and that cascades. Two distinct halves: (a) cancelling stops the real work — the HTTP
  request is aborted, the subscription torn down, the worker call abandoned — not merely
  "the result is ignored on arrival"; (b) when one request or transaction spawns others,
  cancelling the parent cancels every descendant, so no orphan work survives its reason for
  existing. Named prior art: Redux-saga's task cancellation
  (https://redux-saga.js.org/docs/advanced/TaskCancellation) — "make Redux-saga great again"
  — specifically its cancellation of forked children with the parent, cleanup that still runs
  on the way out, and sections that can be marked non-cancellable. Extends the honest saga
  review in R59. The owner notes the parent-cancels-descendants case is **not common** in
  frontend work; the requirement is that the toolkit can do it, and that this capability is
  **discoverable by an AI agent** working in a project — it must surface through the
  agent-facing surfaces (the MCP server, R25; documentation search, R36; and the skill that
  fronts them), so an agent knows `state` can do this without being told.
- **R73 (feature).** A page-transitions bridge: navigation is something the store takes part
  in rather than something that happens to it. In scope: what state survives a transition and
  what is discarded, what in-flight work belonging to the page being left is cancelled (R72),
  how a pending navigation is itself represented as readable state (R71), and interop with
  the platform and framework mechanisms — the browser View Transition API, React
  `startTransition`, and router-level navigation events. Relates to R13 (history/routing/URL
  as store-backed state) and to R69's routing rules for our own site. _(Exact boundary to be
  confirmed with the owner before it becomes a spec section.)_
- **R74 (feature).** Keystroke input throttling as a first-class citizen. R6 already puts
  every keystroke in global state and R67 binds a control to a store path with no glue; this
  adds that the **rate-control policy is declared, not hand-rolled** — throttle, debounce,
  leading/trailing edge, and "latest wins, abandon the previous in-flight one" — stated once
  on the binding or the slice and compiled into exact glue per call site, rather than each
  input growing its own timer. Ties into R56's forms story.

## Added 2026-09-04 (capture surface)

- **R75 (feature — browser extension → Storybook).** A Chrome extension that captures what is
  on screen in a running application and turns it into Storybook material: the screen itself
  and the component states behind it, exported as stories whose fixture is the captured state.
  Capture is filtered **by state selectors** — the operator chooses which slices/paths go into
  the fixture, so a story carries the state its component actually needs rather than the whole
  store, and nothing secret or transient rides along. This turns "reproduce the exact screen I
  am looking at" from a manual re-derivation into a capture, for a bug report, a design review,
  or a regression story. Much of the machinery is already specified and this is a new entry
  point to it rather than a new mechanism: `record()`/`replay()` already capture the
  transaction stream with schema-driven redaction (§11.4, R16), `withState(complexes, { initial
| recording })` already starts a story from a recording (§12.2, R17), the agent tooling
  already dumps state into typed fixtures and generates mocks from snapshots (§11.3/§11.5,
  R25), and `persist`'s `include`/`exclude` is the existing vocabulary for choosing what
  travels (§8.5, R12). Open before it becomes a spec section: whether the captured artefact is
  literally a recording pinned to one transaction or a distinct snapshot format; whether the
  extension is the devtools host (R21) wearing another hat or a separate surface; and how it
  reaches a store in a page it did not build (the devtools bridge is the likely answer, which
  makes it work only where the toolkit is present — a limit worth stating out loud).

## Added 2026-09-04 (regions, input safety, idempotency, binding metadata)

- **R76 (state regions).** Semantic regions of _state_ — business/domain, automations, UI —
  and probably one or two more worth naming. Two hard constraints on the design. (a) **It must
  be a benefit, never a tax**: a project should be able to not do it at all while the split
  buys nothing, and adopt it incrementally the moment it does. (b) **The agent recommends the
  split** (through the skills we ship) when the payoff appears, which means the recommendation
  must be derivable from something checkable rather than from taste. Open questions the design
  must answer: whether a region is a _location_ in the tree or a _property_ of a node — UI
  state should be able to live either in its own subtree or right beside the data it belongs
  to, with chain aliases making both readable the same way; and how the separate, orthogonal
  dimension of **derived** data (which exists for any data in any region) composes with
  regions. To be brainstormed properly before it becomes a spec section.
- **R77 (never lose user input).** An opt-in middleware that prevents loss of typed-but-not-yet-
  committed input — across reload, crash, navigation and accidental close. Requires a way to
  mark what counts as user input in the first place.
- **R78 (idempotency keys on actions — Danny).** Each action carries an idempotency key so a
  replayed or duplicated command can be discarded rather than applied twice. The motivating
  case is offline: actions accumulate while disconnected and are synced later, and a backend —
  a banking one especially — must be able to drop duplicates. Danny's shorthand for the key is
  "some kind of action meaning hash". The precise derivation is a design question, not a given:
  a pure content hash makes two genuinely distinct but identical-looking actions collide.
- **R79 (component ↔ state binding metadata).** The compiler collects, per component, which
  state fields it may be bound to, and that metadata becomes a first-class artefact. Behind it
  is a stated dislike of every existing option: wiring a component to the store directly through
  hooks, `mapStateToProps`, container components, and drilling props through several levels —
  with the honest admission that there may be no fifth option. The working preference, from
  practice: group props into named objects by data slice and drill those, because it makes each
  component's dependencies visible in a way containers scattered everywhere do not; and reach
  for context or a direct hook only for system-level state that nearly every component needs.
  Direction to explore: stop recommending direct wiring, provide a migration off it, and
  consider letting application code read what looks like a plain global variable that the
  compiler turns into a precise reactive subscription.
- **R80 (site).** Every code sample on the site is syntax-highlighted, and ideally every sample
  carries a button that opens it in a REPL playground where it can be edited and run — with the
  scaffolding and any extra examples it needs added around it, so that what opens actually works
  and makes sense on its own rather than being a fragment torn out of context. Extends R38
  (interactive examples) with the two things that make a sample usable rather than decorative.
- **R81 (site).** In the REPL, hovering a variable shows its current value, the way a debugger
  does. The point is not convenience: a toolkit whose central claim is that all state is
  inspectable should demonstrate that by making its own examples inspectable, so a reader can
  hover a store path and see what is actually in it rather than reason about it.
- **R82 (site).** Every long page carries a sidebar table of contents that tracks the heading
  currently in view, with smooth scrolling to a heading when one is clicked. The master spec
  alone is over two hundred thousand characters; without it a reader cannot tell where they
  are or what else the page holds.
- **R83 (converters at boundaries).** Normalizr is no longer maintained. Two consequences.
  (a) Conversions of that kind are **not good for performance**, but remain a legitimate
  **transitional path** — a project cannot change its backend on day one. (b) The area needs
  its own landscape research, because some normalisation is **always** required, and not only
  when receiving and sending data: also **when editing, and when using data in components**.
  What is wanted is one general, declarative way to define **converters at boundaries, in both
  directions**, across two distinct boundaries — **store ↔ outside world** and **store ↔
  components**. Motivating example: a date held as `Date` in the store, wanted as a formatted
  string by a component, and needed in some serialised form by the outside world. Three
  representations of one value; the conversions between them declared once, clearly, rather
  than scattered. Extends R58 and §4.13.3's codecs, which already cover only the outward half.
- **R84 (lint against `useEffect`, and the migrations that follow).** Agreed with Danny:
  `state lint` should **forbid `useEffect` and patterns like it**, backed by **advanced
  migrations**. The work this needs first is a study — catalogue the typical reasons an effect
  gets written, and for each one show how the same thing is expressed declaratively in the
  store. The rule is only credible if it also names the cases where an effect is genuinely the
  right answer; a blanket ban with no stated survivors is a rule people switch off.

## Documentation review — 2026-09-08

- **R85 (Narrow-screen detail and contents navigation).** Comparison hover details must open as a full-width bottom sheet when a sidebar cannot fit. On pages with a TOC, narrow layouts put an active-heading-aware horizontal ribbon below the primary menu, supporting the same pointer/drag/edge and native touch navigation.
- **R86 (Static and agent-readable documentation).** HTML pages must be readable by curl without executing JavaScript. Generate per-page Markdown, llms.txt and a combined text export; add a Copy page dropdown and discoverable alternate links. Verify the generated served build, not only the disk SPA.
- **R87 (Explain and demonstrate consistency boundaries).** Explain lazy derives with eager UI subscriptions, single-write diamond consistency, accidental intermediate observations across independent writes, batching versus direct reads and asynchronous boundaries. Supply paired executable examples and primary-source references.
- **R88 (Electric use cases and protocol laboratories).** Explain Electric versus SSE, initial chunks versus on-demand subsets, log checkpoints versus record-ID pagination, CDN/auth boundaries and refetch. Supply several interactive visual scenarios with step tracing, and distinguish simulated protocol teaching from actual authorised HTTP requests.
- **R89 (Diagram exploration).** Provide gallery navigation, descriptions, pan/zoom, touch pinch, fit and rotate. Request mobile fullscreen/landscape and a separate screen-sized desktop window where appropriate, retaining usable fallbacks for browser permission and popup restrictions.
- **R90 (Artefact semantics and region prior art).** Clarify the three categories produced by a named action; cite concrete prior art for region ingredients without claiming one inventor. Support lifetime metadata adjacent to initial data and separate regions, persistence and optimism in the documentation.
- **R91 (General boundary conversion).** State clearly that Date is one example of separate domain-wire and domain-view contracts. Include money, units, identifiers and structured values as design examples; do not imply unimplemented built-in converters.
- **R92 (Executable steps and usable examples).** Every example must expose a clickable UI or live workbench. Step must execute one next top-level instruction rather than silently execute the whole program. Reset appears when meaningful; JSX gets hover help with honest limits on local runtime values.
- **R93 (practical documentation).** Every introduced abstraction needs a concrete use case, worked example, ownership/status label and comparison with simpler alternatives. FSM and framework adapter docs must distinguish native APIs, explanatory wrappers and planned state APIs.
- **R94 (query comparison).** Study TanStack DB and the actual `@tanstack/db-ivm` package against the intended Rust/WASM query contract; explain differential dataflow. Show the complete 22-case corpus and method on the site, compare normalized equivalent snippets across Datalog, jq, ORM, Lodash/Ramda and immutable-write styles, with paired hints and explicit semantic/runtime limits.
- **R95 (examples and API).** Every authored code block has an exact-source Try link. Missing framework/database runtimes are clearly reference-only. Publish a structured, searchable API index from the full untruncated prototype types, separately from planned production methods.
- **R96 (navigation strip).** Delayed edge hover reaches either end even on edge entry; leaving waits before resetting to the start and reentry cancels the reset. Distant edges gently lens in 3D, while the pointer/focus edge stays legible. Preserve drag, native scrolling, keyboard, touch and reduced-motion operation.
- **R97 (precise references).** Link unexplained terms to detailed concepts, repair shallow/wrong destinations, prevent code from overlapping the TOC and make requirement traceability an unambiguous two-column table. Check actual anchor existence rather than URL shape alone.
- **R98 (SVG specification primitives).** Extend vecli with convenient frames, tables, arrows, diagram compositions and site-aligned color presets, plus a documented ASCII-box/arrow-to-SVG mode with editable text, genuine vector geometry, validation and tests.

## Visual learning and unified navigation — 2026-09-16

- **R99 (literate product experience).** The homepage is a vivid, understandable product landing page with genuine interactive demonstrations, not a wall of code comments. Full-line explanations become normal readable prose interleaved with focused source and visible outcomes. Every primary Try action opens a relevant complete example with purpose, setup, instructions and live visualization; a naked signature is not a useful demo. Preserve exact original source separately as View source, without auto-running it or claiming unloaded runtimes. This supersedes R95 only for the primary Try destination, not source fidelity or truthful runtime labels.
- **R100 (unified navigation and scoped search).** Combine the burger and search control into one header action and reveal navigation plus search together in one panel. Place the current page after the brand and its current section immediately after that. The page trigger opens site navigation; the section trigger opens its headings with the same search field scoped explicitly by a left-side In page tag. Remove scope with its cross or Backspace in an empty input, preserving typed text on cross removal and returning to global search. Scope must never silently widen on no matches. Keep real heading targets, current-section tracking, mobile/desktop layout, keyboard focus and Escape behavior. Use readable input typography to avoid iPhone focus zoom without disabling user zoom.

- **R101 (Contextual diagrams and repair, supersedes the standalone R98 demo page).** Do not publish a dedicated `/diagrams` page. The vecli tool must redraw ASCII/Unicode diagram frames and tables as clean SVG geometry, repairing ragged edges while preserving labels and connector destinations. Use the same renderer alongside explanations wherever a diagram is appropriate, retain the original editable text, and validate nested/adjacent frames, table alignment, source safety and responsive reading. Do not manually patch only one illustration or silently reinterpret ambiguous/open shapes.
