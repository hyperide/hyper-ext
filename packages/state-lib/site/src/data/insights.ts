/** Per-layer insights — moved from the research brief §3 (R64: one home for landscape content). HTML strings, linkified at render. */
export const INSIGHTS: Record<string, string[]> = {
  reactivity: [
    'Sync, glitch-free reads + batched notification is the scheduling split that "feels like useState" (Preact/Vue). Solid 2 / Svelte 5 microtask-batched reads require flush() for sync reads — unfamiliar ergonomics.',
    'Deep proxies create one signal per property lazily on first tracked read, so untouched subtrees cost nothing. Design around the known gotchas: class instances/Map/Set/Date need wrappers, destructuring loses reactivity, array length is its own signal.',
    'Per-item list updates exist at two layers. View layer: Solid mapArray / Svelte keyed each; React has no equivalent — the floor is component granularity: the parent subscribes to the ordered id list, each row to its own node. Store layer: signia getDiffSince and Solid createProjection are the only diff-aware derived collections; a derived-list API must consume diffs or it re-runs the loop.',
    'SSR: only Qwik serialises a live signal graph; everyone else serialises raw values and rebuilds computeds on the client — snapshot the raw tree, never proxies; per-request store instances.',
  ],
  stores: [
    'Immer 11 closed most of the gap to Mutative (+21–26%) but still defaults to auto-freeze, which dominates cost on big trees; COW is O(size of touched container), so >10k hot arrays should be normalised into ids+byId.',
    'Event logs for free today: @xstate/store (typed inspection events), RTK (by design), Effector (inspect with causal chain), mobx-keystone (serialisable actions + patches). None combine an event log with proxy ergonomics — that gap is the opportunity.',
    'Best per-test isolation: Effector fork() scopes (override values and effect handlers), then Jotai/Zustand-vanilla/xstate factories. Module-level singletons are what break Storybook and SSR.',
    'statebus contributes substateInterest ref-counting (sources connect only while someone subscribes) and all-reducers-then-all-listeners phase ordering — both adopted.',
  ],
  immutability: [
    'Copy-on-write proxy drafts (Immer/Mutative/limu/structura) all shallow-copy touched containers and share the rest; complexity is O(touched container size), reads stay native, data stays plain.',
    'HAMT structures (Immutable.js) give O(log32 n) updates independent of size but tax every boundary with conversion; fast if you never call toJS(). A HAMT storage variant for very large collections is a measured experiment, not a default.',
    'Patches + inverse patches (RFC 6902) are the interop currency: undo, devtools time travel, replication and persistence deltas all consume the same pair.',
  ],
  sync: [
    'Two-store split everywhere: immutable synced truth + optimistic overlay, rebased when truth changes, dropped on confirmation (TanStack DB, Electric, Zero). Rows expose $synced/$origin.',
    'Handlers resolve only after sync-back (Electric txid, RxDB awaitInSync, Zero ack) — otherwise the UI flickers. Sources must return a monotonic version the store can await.',
    'Intent-based mutators (name + validated args, re-run on the server) give a natural command log for undo, replay and idempotent retries.',
    'Outbox before dispatch: persist to IndexedDB first, FIFO replay, backoff + jitter, idempotency keys, Web Locks leader election. Background Sync API is Chromium-only, so the queue lives in-app.',
    'Event-sourcing hygiene (LiveStore): versioned past-tense event names, pure materialisers, clientOnly vs synced events, undo as a compensating event — sound under concurrent remote edits.',
    'Origin-scoped undo (Yjs trackedOrigins, Loro excludeOriginPrefixes + mergeInterval): tag every change with an origin, undo only your own, group within a time window.',
  ],
  api: [
    'The ecosystem converged on TanStack Query queryOptions as the narrow waist: tRPC, oRPC, openapi-fetch, hey-api all emit it — a source that accepts {queryKey, queryFn, streamFn} interops with all of them.',
    'Realtime converged on SSE + resume cursors (tRPC 11, graphql-sse, Electric shapes): one "async iterable of deltas + resume cursor" abstraction covers every subscription transport.',
    'GraphQL retreated to the multi-team niche; its client innovations (typed documents via gql.tada, persisted queries) survive. Normalise GraphQL results into collections rather than wrapping Apollo’s cache.',
    'Optimistic state is the weakest point of every transport layer — all of them delegate to manual cache surgery. A store owning optimistic state uniformly across sources is differentiated exactly there.',
  ],
  transport: [
    'birpc’s post/on-only contract is the floor for transport drivers: no MessagePort transfer, which VS Code postMessage silently drops (the documented Comlink failure).',
    'Redux DevTools’ freezes are structural (full-state serialisation across a process per action) — stream patches, inspect state lazily by path, cap history by bytes.',
    'URL state: keep parser-API compatibility with nuqs so the largest existing user base migrates for free.',
  ],
}
