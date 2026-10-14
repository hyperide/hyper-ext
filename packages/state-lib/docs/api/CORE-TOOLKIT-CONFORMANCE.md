# Core/toolkit conformance (HYP-1507 pilot)

Source-only pilot note: only the headless row below is implemented, and only
it is tested — with `bun test packages/state-lib/toolkit/src/` plus
`tsc --noEmit -p packages/state-lib/toolkit/tsconfig.json` against the merged
Runtime (`b3af90fb`). Every other row is PLANNED and must not be presented as
shipped or tested. An unpublished pre-release package export of the headless row
exists (`toolkit/tools/export-package.mjs` + `PROVENANCE.json`); no package is
published from this pilot.

Boundary: core imports nothing and assumes no environment (spec §1/§3).
Dependency direction is toolkit -> core, never core -> toolkit. Renderer
bindings and third-party adapters live in the toolkit, each behind its own
entrypoint that the headless path never transitively loads. The production
barrel (`toolkit/src/index.ts`) never re-exports the conformance testing
harness; test runners import it from `toolkit/src/testing.ts`.

Architectural parity is required across the rows below, but parity means
equivalent applicable guarantees with evidence — coherent snapshots,
meaningful state/error semantics, start/stop/retry, ownership and teardown,
isolated SSR/test contexts, type/JavaScript misuse checks, documentation —
not identical method names, identical throughput, or forcing every adapter
into one latest-value request model. Streams stay push-based with
source-side backpressure; caches keep source-side ownership, GC and
revalidation; collections keep their canonical source contracts (spec §8).

| Ecosystem / category                                                        | Applicable capabilities                                                                                                                                                                  | Promised contract suite                                       | Native difference                                                     | Status + version evidence                                                |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Headless async-resource (this pilot)                                        | idle/loading/success/empty/error/cancelled, refresh-with-prior (`hasData`), retry, cancel, dispose, exhaustive match, unknown failure narrowing                                          | `async-conformance.ts` scenarios AR-01…AR-10 via `testing.ts` | none (baseline)                                                       | implemented + tested in this pilot (bun test, tsc); no package published |
| React binding                                                               | `useSyncExternalStore` over `getSnapshot`/subscribe, StrictMode mount ownership                                                                                                          | same suite via a React factory                                | concurrent time-slicing; transitions stay adapter-side (spec §4.15.6) | planned; no peer version pinned                                          |
| Vue binding                                                                 | `ref`/`watch` bridge over subscribe                                                                                                                                                      | same suite via a Vue factory                                  | template unwrapping conventions                                       | planned; no peer version pinned                                          |
| Solid binding                                                               | fine-grained signal bridge                                                                                                                                                               | same suite via a Solid factory                                | no vDOM; per-item subscriptions                                       | planned; no peer version pinned                                          |
| Svelte binding                                                              | `createSubscriber` bridge (`svelte/reactivity`); store contract (`subscribe`) for legacy; `$state.raw` snapshots; slices in context (`setContext`)                                       | same suite via a Svelte factory                               | runes reactivity; module-level `$state` export limitation             | planned; no peer version pinned                                          |
| Angular binding                                                             | injectable service + `async` pipe shape; native `toSignal` takes an Observable (explicit RxJS wrapper); `@ngrx/signals` `signalStoreFeature` for NgRx teams; DI ownership; zoneless-safe | same suite via an Angular factory                             | DI ownership, zone behavior                                           | planned; no peer version pinned                                          |
| Lit / web components                                                        | `StateController` (ReactiveController) + `watch()` directive; store discovery across shadow roots via the Context Community Protocol, never `window`                                     | same suite via a Lit factory                                  | attribute/property reflection                                         | planned; no peer version pinned                                          |
| Schema/validation (R49)                                                     | typia-style compile-time validation as the default story; runtime schema libraries (Zod/Valibot/ArkType) via Standard Schema interop                                                     | validation-adapter suite (later)                              | each library owns its schema authoring                                | planned; no peer version pinned                                          |
| Data/query sources (REST, GraphQL, TanStack, RPC incl. VS Code postMessage) | load/cancel/retry over this contract; cache/GC/dedupe/revalidation stay source-side                                                                                                      | source-adapter suite (later)                                  | each SDK owns caching, dedupe, revalidation                           | planned; names from spec §8 only                                         |
| Streams/RPC (WS/SSE/RxJS/CRDT)                                              | subscription teardown maps to cancel/dispose; push delivery, backpressure is source-side                                                                                                 | stream-adapter suite (later)                                  | push vs pull; not a latest-value request model                        | planned; names from spec §8 only                                         |
| Persistence (IndexedDB/OPFS)                                                | persist what the domain marks; outbox retry in app                                                                                                                                       | persist-adapter suite (later)                                 | quota, availability, cross-tab                                        | planned; HYP-1498 owns the track                                         |
| URL/routing                                                                 | route scope ends tasks with reason `scope-ended`                                                                                                                                         | router-adapter suite (later)                                  | history API vs framework routers                                      | planned; spec §8.6, §4.15.6                                              |
| Devtools/test fixtures                                                      | seeded state, controlled providers, deterministic input                                                                                                                                  | fixture suite (later)                                         | framework test renderers differ                                       | planned; R15–R17                                                         |
| Qwik                                                                        | resumability boundary                                                                                                                                                                    | same suite IF the boundary allows                             | explicit documented constraint                                        | honest gap, not parity                                                   |
| Service Worker cache/background sync                                        | offline outbox transport                                                                                                                                                                 | persist suite extension                                       | Chromium-only Background Sync                                         | honest gap per R70, not v1                                               |

Scenario IDs (implemented in `async-conformance.ts`, consumed by
`async-conformance.test.ts` via `testing.ts`): AR-01 initial load, AR-02 falsy
success, AR-03 explicit empty, AR-04 failure/retry, AR-05 refresh retains prior,
AR-06 prompt cancel, AR-07 stale settlement dropped, AR-08 boundary rejection
preserves authority, AR-09 dispose freezes, AR-10 isolation between instances.
Ownership regressions beyond AR-01…AR-10 live in `async-ownership.test.ts`
(outer-transaction rejection, abort-driven replacement, post-commit cancel,
subscriber-dispose refusal, disposal reentry, throwing loading subscriber,
undefined-refresh metadata, unknown failure narrowing) and the production-entry
closure checks in `import-boundary.test.ts`.
