# Deep dive: the data & reactivity prior art

Source snapshots studied (2026-09-04, `main` clones): **TanStack DB** `@tanstack/db@0.8.7`, **tldraw state** `@tldraw/state@5.4.0` (the maintained continuation of signia), **alien-signals** `3.2.1`. Everything below is read from the repositories' actual code. Verdicts per API: **adopt** / **adapt** / **avoid** — for the `state` toolkit.

---

## Chapter 1 — TanStack DB

### Architecture from the source

TanStack DB is a monorepo (`packages/`) with a clean layering: `db-ivm` (the incremental engine, a TypeScript port of differential-dataflow ideas, formerly "d2ts"), `db` (Collections, transactions, query builder + compiler), `offline-transactions` (durable outbox), plus framework bindings (`react-db`, `vue-db`, …) and per-backend collection adapters (`electric-db-collection`, `query-db-collection`, `powersync-db-collection`, …).

The `Collection` is not one class but a facade over six managers, wired together in `packages/db/src/collection/index.ts`:

- `state.ts` — `CollectionStateManager`: `syncedData: SortedMap<TKey, TOutput>` (the confirmed base), `optimisticUpserts: Map`, `optimisticDeletes: Set` (the overlay), plus `pendingSyncedTransactions`, row origins, and virtual-props caching.
- `sync.ts` — `CollectionSyncManager`: implements the `begin/write/commit/markReady` contract handed to adapter sync functions.
- `mutations.ts` — `insert/update/delete`; `update` runs your callback against a change-tracking proxy (`proxy.ts`) to derive a minimal `changes` object.
- `changes.ts`, `subscription.ts` — batched change events and filtered/ranged subscriptions (what live queries consume).
- `transactions.ts` (package root) — the user-facing `Transaction` with `mutate()/commit()/rollback()`, a `TransactionScope` stack, and mutation merging.
- `query/` — builder (typed `q.from().where().join().select()` via ref-proxies), IR + optimizer, `compiler/` (compiles IR to a d2 dataflow graph), and `live/` (bridges graph output back into a Collection).

**The sync contract.** An adapter's `sync({ begin, write, commit, markReady, markError, truncate })` builds _sync transactions_. `begin()` pushes a pending transaction object; `write()` appends operations to the last pending transaction, deriving the key via `getKey` when absent; `commit()` marks it committed and calls `state.commitPendingTransactions()`. From `sync.ts`:

```ts
begin: (options?: { immediate?: boolean }) => {
  ...
  this.state.pendingSyncedTransactions.push({
    committed: false, applicationStarted: false, layoutChanged: false,
    operations: [], deletedKeys: new Set(),
    rowMetadataWrites: new Map(), collectionMetadataWrites: new Map(),
    immediate: options?.immediate, applied,
  })
},
```

`write()` on an `insert` for an already-synced key does a deep-equality check: if the value is an echo of local data (or a hydration seed), it silently downgrades to `update`; otherwise it throws `DuplicateKeySyncError`. `commit()` can take an `AbortSignal` and returns a receipt promise (`applied.promise`) so adapters can await application. `markReady()` flips lifecycle status — collections are `idle → loading → ready`, and `markReady` gates first-read semantics. `truncate()` clears staged operations, marks the transaction, and — crucially — snapshots the optimistic overlay _now_ (`optimisticSnapshot`) so a full re-sync doesn't wipe in-flight local edits.

**Optimistic overlay.** Reads compose overlay-over-base (`state.ts`):

```ts
public get(key: TKey): TOutput | undefined {
  const { optimisticDeletes, optimisticUpserts, syncedData } = this
  if (optimisticDeletes.has(key)) return undefined
  if (optimisticUpserts.has(key)) return optimisticUpserts.get(key)
  return syncedData.get(key)
}
```

The overlay is **recomputed from scratch** on every transaction lifecycle change: `recomputeOptimisticState()` snapshots the previous overlay, clears it, replays the mutations of every _active_ transaction (skipping `completed`/`failed`), diffs against the snapshot to produce change events, then filters events against `recentlySyncedKeys` and pending sync transactions to suppress the flicker of "optimistic drop → sync re-insert". Completed-but-not-yet-synced mutations are kept in a `pendingOptimistic*` staging area until the server echo arrives. This replay design makes rollback trivial (a failed transaction just stops being replayed) at the cost of O(active mutations) per recompute and a lot of duplicate-suppression bookkeeping — that filtering code is the hairiest part of the file.

**User transactions.** `collection.insert(...)` outside an explicit transaction creates an auto-committing transaction whose `mutationFn` calls your `onInsert` handler. `Transaction.applyMutations` merges mutations per `globalKey` with algebraic rules (`insert+update→insert`, `insert+delete→removed`, `update+delete→delete`, `update+update→union changes`) via a Map instead of the old O(n²) scan. `rollback()` cascades: it collects the transaction's `globalKey`s and rolls back any other transaction touching the same keys (`rollbackConflictingTransactions`).

**Live queries / db-ivm.** `D2` (`db-ivm/src/d2.ts`) is a tiny dataflow scheduler: a graph of operators connected by `DifferenceStreamWriter/Reader`s carrying `MultiSet<[key, value]>` messages — `[value, multiplicity]` pairs where an update is a retract (−1) plus an insert (+1). `run()` steps operators until no pending work. The join operator (`operators/join.ts`) is a textbook incremental join with two persistent `Index`es:

```ts
export class JoinOperator<K, V1, V2> extends BinaryOperator<...> {
  #indexA = new Index<K, V1>()
  #indexB = new Index<K, V2>()
  ...
  // Emit ΔA⋈B_old + A_old⋈ΔB + ΔA⋈ΔB, using pre-append snapshots
```

with O(1) presence checks (consolidated multiplicity per key) to drive left/right/full/anti null-extension transitions. `orderBy` compiles to `topKWithFractionalIndex`, which assigns fractional order keys so a row that doesn't _move_ doesn't produce churn — subscribers get a stable `orderByIndex` string per row. The query compiler (`query/compiler/index.ts`) walks the optimized IR and `pipe`s operators (`filter`, `map`, `join`, `groupBy`, `distinct`, `topK…`); `query/live/collection-config-builder.ts` then plays the _sync adapter_ role for a result Collection: an `output()` operator accumulates the run's diffs into `pendingChanges`, and `flushPendingChanges` folds each key's net `{inserts, deletes}` counts into a single `begin(); write({type: insert|update|delete}); commit()` — the live query literally syncs into an ordinary Collection, so optimistic overlay, indexes and subscriptions compose for free. A transaction-scoped `scheduler.ts` orders graph runs so a multi-collection optimistic mutation produces one consistent flush.

**Offline outbox** (`offline-transactions/`): `OutboxManager` persists serialized transactions under `tx:<id>` keys via a pluggable `StorageAdapter` (IndexedDB/localStorage); `TransactionSerializer` JSON-encodes mutations with `{ __type: 'Date' }` markers. `KeyScheduler` is deliberately dumb — strict FIFO by `createdAt`, one at a time, gated by `nextAttemptAt` backoff. `OfflineExecutor` wires leader election (Web Locks, falling back to `BroadcastChannel`, falling back to always-leader), an `OnlineDetector`, and a `RetryPolicy` with `NonRetriableError` to bail permanently.

### API surface walkthrough

1. `createCollection({ id, getKey, schema, sync, onInsert/onUpdate/onDelete })` — one config unifies identity, validation, sync-in and mutation-out. **Adopt** the shape (getKey + handlers); our collections (ids + byId) map directly onto `getKey`/`syncedData`.
2. `begin()/write()/commit()/markReady()/truncate()` sync contract — small, adapter-friendly, transactional. **Adopt**, near-verbatim; it is the best-designed piece of the library.
3. `collection.update(key, draft => { draft.completed = true })` — proxy-recorded minimal changes; `transaction.mutations[0].changes` holds only touched fields. **Adapt**: we get the same artifact from patch-emitting transactions without a proxy replay, and our patches are paths, not shallow key sets.
4. `createTransaction({ mutationFn }); tx.mutate(() => {...}); await tx.isPersisted.promise` — explicit multi-collection optimistic transactions with a persistence promise. **Adopt** the two-promise lifecycle (applied locally vs persisted); it's the right UX.
5. `useLiveQuery({ query: q => q.from({ todo }).where(({todo}) => eq(todo.completed, false)).orderBy(...) })` — typed builder over ref-proxies, compiled to IR. **Adapt**: the incremental maintenance is the part worth keeping; a full SQL-ish builder/optimizer (optimizer.ts alone is >1k lines) is beyond our toolkit's scope. Our diff-aware `derive` covers the filter/map/sort 90% case; the Datalog engine covers the rest.
6. `collection.subscribeChanges(cb, { includeInitialState })` + `currentStateAsChanges()` — "state as an initial batch of inserts" makes subscribers uniform. **Adopt**.
7. `queryCollectionOptions` / `electricCollectionOptions` adapter factories. **Adapt** as a pattern (options-creator factories), not as dependencies.
8. `startOfflineExecutor({ storage, mutationFns })` keyed by _named_ mutation functions (survives reload). **Adopt** the named-mutationFn registry idea for our outbox; **avoid** the strict global FIFO — per-key queues would allow safe parallelism.

### What we take vs what we do differently

- **Take**: the sync-transaction contract; overlay-over-base reads; duplicate-echo downgrade of insert→update; the live-query-result-is-a-collection trick; truncate-preserves-overlay; leader-elected outbox.
- **Differently**: TanStack recomputes the whole overlay and _diffs snapshots_ to discover what changed, then filters false positives — because mutations store whole `modified` objects. Our patch-emitting transactions make the delta the primitive: apply/revert patches directly, no snapshot diffing, no `recentlySyncedKeys` suppression pass. Their change events are per-row; our per-path signals give sub-row invalidation their subscribers can't express (a row edit invalidates every consumer of the row). And where they route all derivation through a d2 graph, our diff-aware `derive` consumes the same patch stream the transactions emit — one diff currency end-to-end instead of converting Collection events → multiset deltas → collection events.

### Gotchas found in the source

- `recomputeOptimisticState` early-returns during sync commits _except_ for user-triggered actions — a comment explains live queries went unresponsive during long commits otherwise. Ordering sensitivity between sync application and optimistic recompute is the recurring bug source in this file.
- Insert-echo handling depends on `deepEquals` of the whole row; a server that transforms values on write (timestamps) will throw `DuplicateKeySyncError` unless the adapter is careful — hence the `hydrationSeedKeys` escape hatch.
- `sync.ts` guards every callback with `isCurrentSync()` (an epoch counter) so a restarted collection ignores late writes from a zombie sync — mandatory once cleanup/restart exists.
- The join docs in `join.ts` note "final presence logic" exists to avoid emit→retract churn _within the same tick_ — naive incremental outer joins flicker.
- `applyMutations` was rewritten from `findIndex` to a Map for O(n) bulk inserts, and rebuilds `this.mutations` **in place** "to preserve the array's identity for external holders" — external code observes that array.
- `utils/btree.ts` records remaining preallocation and sorted-array initialisation work in the studied snapshot — the b-tree backing ordered indexes is young.

---

## Chapter 2 — signia / @tldraw/state

### Architecture from the source

`packages/state/src/lib/` is small and flat: `Atom.ts`, `Computed.ts`, `EffectScheduler.ts`, `transactions.ts`, `capture.ts`, `ArraySet.ts`, `HistoryBuffer.ts`, `helpers.ts` (attach/detach/haveParentsChanged/equals), `types.ts` (`Signal`, `RESET_VALUE`). React lives in `@tldraw/state-react` (`track.ts`, `useStateTracking.ts`, `useValue.ts`, …). Everything class-shaped is wrapped in `singleton()` (a `Symbol.for` registry on `globalThis`) so duplicate bundles share one clock and one instanceof identity.

**The epoch clock.** There is one integer, `inst.globalEpoch` (`transactions.ts`), advanced on every atom write. Every signal stamps `lastChangedEpoch`; a computed also keeps `lastCheckedEpoch` (advances on every check, even no-change ones) and `lastTraversedEpoch` (set when a change is pushed through it). Dependencies are stored as parallel arrays `parents[]` / `parentEpochs[]` captured in deref order. This is a **pull-based lazy** system: writes don't recompute anything; a read of a computed decides staleness by comparing epochs:

```ts
if (
  !isNew &&
  (this.lastCheckedEpoch === globalEpoch ||
    (this.isActivelyListening && !getIsInTransaction() && this.lastTraversedEpoch <= this.lastCheckedEpoch) ||
    !haveParentsChanged(this))
) {
  this.lastCheckedEpoch = globalEpoch;
  return this.state;
}
```

Three tiers of short-circuit: same epoch (nothing anywhere changed); actively-listening and not traversed since last check (every ancestor change would have traversed me, so skip the O(parents) scan — invalid inside transactions, since traversal is deferred to commit); finally `haveParentsChanged`, which brings each parent up to date and compares `parent.lastChangedEpoch !== child.parentEpochs[i]`.

**Capture.** `get()` calls `maybeCaptureParent(this)`: if a `CaptureStackFrame` is open, the parent is added to a `parentSet` (ArraySet) and written into `parents[offset]`; a displaced previous occupant is remembered in `maybeRemoved` and detached in `stopCapturingParents` if it wasn't re-captured. `attach`/`detach` maintain `children` recursively: a computed that gains its first child starts listening to its own parents, and one that loses its last child unhooks all the way up — so unobserved subgraphs cost nothing and can be GC'd.

**ArraySet** is the perf workhorse for `children`/`parentSet`: an inline array up to 8 entries (lazily allocated — "most signals never get a child"), promoted permanently to a `Set` beyond that; `remove` swaps the last element into the hole to stay dense.

**Diffs: getDiffSince / withDiff / RESET_VALUE.** Any signal can carry a `HistoryBuffer<Diff>` (opt-in via `historyLength`): a circular buffer of `[fromEpoch, toEpoch, diff]` tuples, contiguity-invariant. `atom.set(value, diff?)` records the supplied diff, else calls `computeDiff(prev, next, lastChangedEpoch, newEpoch)`, else stores `RESET_VALUE` — and pushing `RESET_VALUE`/`undefined` **clears the whole buffer**, because a silent gap would make later `getChangesSince` return an incomplete list rather than an honest "resync". `getDiffSince(epoch)` returns `EMPTY_ARRAY` if up to date, the diff array if the buffer covers the range, else the `RESET_VALUE` symbol — every consumer must handle the reset branch by rebuilding from scratch. On the computed side, the deriver receives `(previousValue, lastComputedEpoch)` and may return `withDiff(nextValue, diff)`; combined with `getDiffSince` on its parents this is the incremental-computation protocol tldraw's store indexes are built on:

```ts
const double = computed('double', (prev, lastEpoch) => {
  if (isUninitialized(prev)) return count.get() * 2
  const diffs = count.getDiffSince(lastEpoch)
  if (diffs === RESET_VALUE) return count.get() * 2  // rebuild
  return withDiff(prev + sum(diffs) * 2, ...)        // incremental
})
```

**Transactions** (`transactions.ts`) are rollback-first: while `currentTransaction` is open, `atomDidChange` merely records each atom's first-seen prior value in `initialAtomValues`; children are _not_ traversed. Root commit runs `flushChanges`, which walks `children` graphs marking `lastTraversedEpoch` and collecting `EffectScheduler`s into a Set, then calls `maybeScheduleEffect()` on each. `abort()` bumps the epoch and re-`set`s every recorded initial value — so effects still fire after rollback and observe restored values (documented deliberately). Writes made _by effects during the reaction phase_ are queued into `cleanupReactors` and drained in a loop with a 1000-iteration depth guard. Nested transactions fold their `initialAtomValues` into the parent on commit.

**EffectScheduler & the React binding.** `maybeScheduleEffect` bails when `lastReactedEpoch === globalEpoch` or parents are unchanged; `execute()` snapshots the epoch _before_ running and passes `lastReactedEpoch` into the effect body — so even effects can be diff-aware via `getDiffSince`. The React `track` HOC wraps the component function in a `Proxy` whose `apply` trap calls `useStateTracking`, which pairs an `EffectScheduler` with `useSyncExternalStore`: the render itself runs inside `scheduler.execute()` (capturing parents), `scheduleEffect` bumps `scheduleCount` (the uSES snapshot) to request a re-render, and `attach()` happens in `useEffect` — avoiding zombie renders of deleted data, with a `maybeScheduleEffect()` right after attach to catch changes that happened between render and effect.

### API surface walkthrough

1. `atom(name, init, { historyLength, computeDiff, isEqual })` — named, diff-capable atom. **Adopt**; mandatory debug names and pluggable equality are cheap wins.
2. `computed(name, (prev, lastComputedEpoch) => ..., opts)` + `isUninitialized` — the deriver sees its previous output and clock. **Adopt** — this exact signature is what makes diff-aware derive expressible.
3. `signal.getDiffSince(epoch) → Diff[] | RESET_VALUE` + `withDiff(value, diff)`. **Adopt** the protocol; **adapt** the storage — our patch-emitting transactions feed the history buffer with structured path patches instead of user-supplied `computeDiff`.
4. `transaction(fn(rollback))` / `transact(fn)`. **Adapt**: batching + rollback semantics are right, but recording prior _values_ per atom is object-level undo; our transactions record patches, giving the same rollback plus an emitted changelog.
5. `react(name, fn, { scheduleEffect })` — pluggable scheduling. **Adopt**.
6. `track(Component)` / `useValue(signal)` — Proxy-apply trap + `useSyncExternalStore` + memo. **Adopt** the useStateTracking mechanics wholesale; it's the most battle-tested epoch-based React binding in production (tldraw itself).
7. `unsafe__withoutCapture(fn)` — peek without dependency. **Adopt**; keep the scary name.
8. `whyAmIRunning()` — logs the changed-ancestor tree for the current effect. **Adopt**; trivial to build on epochs and worth its weight in support tickets.
9. `@computed` decorator. **Avoid** — decorator-spec churn (the file supports three decorator protocols simultaneously) for ergonomics we don't need.

### What we take vs what we do differently

- **Take**: the global epoch clock with `lastChanged/lastChecked/lastTraversed` triple; `RESET_VALUE` as an honest "history exhausted, rebuild" signal; buffer-clear-on-gap invariant; ArraySet; deferred traversal inside transactions; the uSES render-inside-execute binding.
- **Differently**: signia's diffs are opaque user payloads — the library never interprets them. Our patches are structured (path-based), so the _framework_ can route them: a collection atom's patch `["byId","x","title"]` feeds per-path signals directly, whereas tldraw had to hand-build `computeDiff`/incremental derivations per index. Their transaction rollback restores snapshots and still re-runs effects after abort; patch-revert lets us skip notifying effects whose paths saw net-zero change. And their `parents`/`parentEpochs` parallel arrays + recursive attach are elegant but O(parents) on every cold check — see alien-signals for the cheaper linked-list version we grow from.

### Gotchas found in the source

- `Atom.set` runs `computeDiff` **before** ticking the epoch — a long comment explains that reading a dependent computed after the tick would stamp it checked-at-new-epoch mid-write and it would never see the change. Any epoch design must fix the "user code runs during a write" ordering.
- The traversal short-circuit in `Computed` is explicitly invalid during transactions; miss that condition and you serve stale values inside a `transact`.
- Error caching: a throwing computed stores `{ thrownValue }`, rethrows on next get, sets state to `UNINITIALIZED`, clears the history buffer — and specifically checks `error === null` (not state) so a first-run throw still advances `lastChangedEpoch`.
- `equals` consults the _old_ value's `.equals(b)` method only — asymmetric equality.
- `flushChanges` reuses a module-level `traverseReactors` set ("no allocation per atom; traversal never runs user code so nothing can re-enter") — a good trick and a good warning.
- Nested-transaction commit-during-reaction had a real bug (changes escaping outer rollback), now guarded by folding values _before_ any reacting special case (comment "T7" in `Transaction.commit`).

---

## Chapter 3 — alien-signals

### Architecture from the source

Two files, 703 lines total. `system.ts` (262 lines) is the reusable core — `createReactiveSystem({ update, notify, unwatched })` returns `{ link, unlink, propagate, checkDirty, shallowPropagate }` and knows nothing about values, only graph topology. `index.ts` builds the public `signal/computed/effect/effectScope/trigger/startBatch/endBatch` API on top. The README states the constraints: no Array/Set/Map and no recursion in the core. Vue 3.6 ported this algorithm back into `@vue/reactivity` (PR vuejs/core#12349); it powers Vue language-tools' incremental virtual-code generation and xstate's atoms. Vue embeds it via the same `createReactiveSystem`-shaped core with its own node types supplying `update`/`notify` — exactly the extension seam the function exports.

**The linked-list structures.** Every node is a `ReactiveNode { deps, depsTail, subs, subsTail, flags }`; every edge is one `Link` object threaded into **two** doubly-linked lists at once:

```ts
export interface Link {
  version: number;
  dep: ReactiveNode;
  sub: ReactiveNode;
  prevSub: Link | undefined;
  nextSub: Link | undefined;
  prevDep: Link | undefined;
  nextDep: Link | undefined;
}
```

so a dependency edge costs one allocation, membership in both directions, and O(1) unlink — versus signia's parents-array + children-ArraySet pair. Re-tracking is allocation-free in the steady state: a re-run resets `depsTail = undefined` and `link()` first checks "is the next link in my existing deps list already this dep?" — if the effect reads the same signals in the same order, every link is reused; `purgeDeps` then unlinks whatever remains past `depsTail`. Dedup within a run uses a `version === cycle` check instead of a Set.

**Flag bits.** `ReactiveFlags`: `Mutable` (can produce values: signals + computeds), `Watching` (effects: wants `notify`), `RecursedCheck` (currently executing/tracking), `Recursed` (was reached again during its own run), `Dirty` (definitely stale), `Pending` (possibly stale). `index.ts` adds a private `HasChildEffect = 64` bit outside the core's range.

**propagate** (push phase) walks the subscriber lists iteratively with an explicit `Stack`, stamping subscribers `Pending`, calling `notify` on `Watching` nodes, and descending through `Mutable` nodes' own subs. Crucially, propagation _stops_ at already-`Pending|Dirty` subtrees — the push is O(newly-reached edges).

**checkDirty** (pull phase) resolves `Pending`: it walks a possibly-stale node's deps iteratively; on finding a `Mutable|Dirty` dep it calls `update(dep)` (recompute) and, if the value actually changed, `shallowPropagate`s the dep's subs (upgrading their `Pending → Dirty`); on a `Mutable|Pending` dep it descends. The unwind loop re-runs `update` up the chain only while values genuinely changed — this is the graph-coloring cutoff: a diamond whose left branch changes but computes an equal value never recomputes the join. `updateComputed` supplies the equality: plain `!==` only. Note `computed()` here passes `previousValue` into the getter — the same incremental hook as signia's `prev`.

**Effects and scheduling.** Signals are double-buffered (`currentValue`/`pendingValue` — a write inside a batch stores pending and marks `Dirty`; readers reconcile via `updateSignal`). A write propagates immediately and then, if `batchDepth === 0`, drains a flat `queued` array of effects. `notify` enqueues the effect **and its Watching ancestors**, then reverses the just-inserted segment so _outer effects run before inner ones_; `run()` re-checks `Dirty || (Pending && checkDirty(...))` before re-executing, disposes stale child effects, runs the user cleanup, and re-tracks. `effectScope` is just a node whose deps are its child effects. `trigger(fn)` creates a throwaway tracking node, records which signals `fn` read, and force-propagates them — the escape hatch for in-place mutation.

### API surface walkthrough

1. `const count = signal(1); count(); count(2)` — one callable for get/set. **Avoid** the call-convention (a `.get/.set` split reads better and survives TypeScript narrowing); **adopt** everything underneath.
2. `computed(prev => ...)` — lazy, cutoff-checked, previous-value-aware. **Adopt**; this plus our patch streams is diff-aware derive.
3. `effect(() => { ...; return cleanup })` with cleanup-on-rerun and automatic nested-effect disposal. **Adopt** — the parent-before-child ordering and auto-disposal of inner effects is exactly the ownership model we want.
4. `effectScope(fn)` — batch-dispose ownership tree. **Adopt** (component/store lifetimes).
5. `startBatch()/endBatch()` — counter + flush. **Adapt**: batching only — no rollback, no recorded changeset; our transactions subsume it and drive it internally.
6. `trigger(fn)` — manual dirty-marking after in-place mutation. **Adapt**: expose as a low-level dev-tool, not a headline API.
7. `createReactiveSystem({ update, notify, unwatched })` — the algorithm as a library. **Adopt** as _the_ integration pattern: our per-path signal nodes and collection row nodes are `ReactiveNode`s with custom `update` (apply pending patches) and `notify` (scheduler), reusing propagate/checkDirty untouched — precisely how Vue embedded it.
8. `getActiveSub()/setActiveSub()` — swap the tracking context. **Adopt** internally; needed for `untrack` and SSR boundaries.

### What we take vs what we do differently

- **Take**: the whole two-phase `Pending`-then-`checkDirty` push-pull core with equality cutoff; the intrusive doubly-linked `Link` with in-order reuse (allocation-free stable re-tracking); flags-as-bitmask; outer-before-inner effect queue; `unwatched` for lazy teardown. This is the engine tier for our per-path signals: thousands of fine-grained nodes make signia's per-node ArraySets and O(parents) epoch scans comparatively expensive, while alien-signals' per-edge cost is one object and its staleness check is push-bounded.
- **Differently**: alien-signals has no epochs, no diffs, no history — `update` returns only a boolean "changed". Our nodes' `update` applies _patches_ accumulated since last read; `getDiffSince`-style history (from signia) rides on top of this core rather than replacing it. No transactions or rollback — our patch-emitting transactions wrap the batch and revert by inverse patches. Equality is hardwired `!==`; we keep pluggable equality out of the core, as they do, via the `update` callback. And collections: alien-signals is scalar-only; our ids+byId collection becomes a family of nodes sharing this one propagation core.

### Gotchas found in the source

- `propagate`/`checkDirty` are deliberately non-recursive with hand-rolled `Stack` frames; the README keeps the recursive equivalents as documentation — port the recursive one first, optimize later.
- Signal double-buffering means a signal read _outside_ any tracking context after a batched write must reconcile (`flags & Dirty → updateSignal`) — forget that path and you read stale `currentValue`.
- `isSignal/isComputed/isEffect` brand-check via bound-function names — minifiers that rename those functions break it.
- `flush()`'s `finally` block re-flags effects left in the queue after a mid-flush throw so an exception in one effect doesn't strand the rest permanently un-watchable.
- `checkDirty`'s final `return dirty && !!sub.flags` — a node disposed mid-check must not report dirty; easy to miss when porting.
- `notify`'s in-place queue-segment reversal is the entire inner/outer ordering guarantee — three lines that look like a micro-optimization but are load-bearing correctness.

---

## Cross-cutting synthesis

The three projects tier cleanly: **alien-signals is the propagation engine** (adopt `createReactiveSystem` as our core, hosting per-path signal nodes); **signia contributes the temporal layer** (epoch clock, `getDiffSince`/`withDiff`/`RESET_VALUE`, history buffers, and the uSES React binding) that turns "changed" into "changed _how_"; **TanStack DB contributes the data layer** (collections with getKey/byId, the begin/write/commit/markReady sync contract, overlay-over-base optimistic reads, two-promise transactions, leader-elected outbox). Our unifying bet — structured path patches as the single diff currency — is the thing none of them has: signia's diffs are opaque, TanStack's are per-row events reconstructed by snapshot diffing, alien-signals has none. Patch-emitting transactions make all three layers speak one language.
