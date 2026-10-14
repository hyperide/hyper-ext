# Deep dive: the store prior art

Source snapshots studied (cloned 2026-09-04): **zustand** @ `b57db4f` (v5, 2026-08-25), **valtio** @ `4689e79` (v2, 2026-08-13), **jotai** @ `3e0b9ff` (v2.20.3, 2026-08-24), **legend-state** @ `23b5dde` (v3.0.0-beta.48, 2026-08-11). All file references are to `src/` in those repos. Codemod notes feed `state migrate from <lib>`.

---

## Zustand 5

### Architecture from the source

**Module map.** The entire runtime is small enough to list: `vanilla.ts` (101 lines, the store), `react.ts` (65 lines, the hook), `traditional.ts` (89 lines, the v4-compat equality path), `vanilla/shallow.ts` + `react/shallow.ts` (equality helpers), and seven middlewares under `middleware/` (`persist` 404 lines, `devtools` 437, `subscribeWithSelector` 74, `immer` 88, `combine` 15, `redux` 50, `ssrSafe` 25 — experimental). Everything else in the package is TypeScript type machinery (the mutator-tuple encoding), which is genuinely larger than the runtime.

**`createStore` internals.** The store is one closure over `let state` and a `Set` of listeners. The whole semantics of Zustand lives in nine lines of `setState`:

```ts
const nextState = typeof partial === 'function' ? partial(state) : partial;
if (!Object.is(nextState, state)) {
  const previousState = state;
  state =
    (replace ?? (typeof nextState !== 'object' || nextState === null))
      ? nextState
      : Object.assign({}, state, nextState);
  listeners.forEach((listener) => listener(state, previousState));
}
```

Three load-bearing facts: (a) merge is **one level deep** (`Object.assign`), nested updates are the user's problem; (b) notification is unconditional broadcast to every listener — there is no granularity in the core, all granularity is reconstructed downstream by selectors; (c) `getInitialState()` exists (v5 addition) purely to give `useSyncExternalStore` a server snapshot. The initializer runs once with `set/get/api` already live, which is why actions can close over `set` — and why you cannot read state during initialization.

**`react.ts` — the uSES binding.** `useStore` is `React.useSyncExternalStore(api.subscribe, () => selector(api.getState()), () => selector(api.getInitialState()))` plus `useDebugValue`. That's it. v5 dropped the shim and the equality argument: uSES compares the _selected slice_ with `Object.is`, so every listener runs every selector on every store write, and re-render is skipped only if the result is referentially stable. `create` does `Object.assign(useBoundStore, api)` — the hook _is_ the store object.

**`traditional.ts` — the equality story.** The v4 behavior survives in a separate entry point (`useStoreWithEqualityFn` over `use-sync-external-store/shim/with-selector`). Mainline v5 pushed equality into the selector via `useShallow`: a `useRef` holding the previous slice, returning the _previous reference_ if `shallow(prev, next)` — equality re-encoded as selector memoization. `vanilla/shallow.ts` compares prototypes, treats anything with `entries()` by keyed comparison, and ordered iterables element-wise (with a comment saying “avoid checking entries type”; this excerpt omits the leading maintenance annotation and is not byte-for-byte verbatim).

**Middleware = api monkey-patching.** Every middleware has the same shape: `(fn) => (set, get, api) => { patch api; return fn(patchedSet, get, api) }`. There is no middleware protocol beyond "overwrite `api.setState` and hope you compose."

- **`persist`** rehydration flow: `api.setState` is wrapped to call `setItem()` after every write (serializing `partialize({...get()})` on _every_ set — no debounce). `hydrate()` bumps a `hydrationVersion` counter to invalidate concurrent rehydrations, reads storage through a hand-rolled `toThenable` shim so **synchronous storages hydrate synchronously** (no microtask — the trick that makes localStorage hydration render-safe), runs `migrate` on version mismatch (dropping state if none provided), `merge`s, `set(state, true)`, then fires `onFinishHydration`. v5 change: persist no longer writes to storage at store creation.
- **`devtools`** action naming: `setState` grows a third argument `action?`. If omitted, v5 tries `findCallerName(new Error().stack)` — it literally regex-parses the stack trace for the frame after `api.setState` — falling back to `'anonymous'`. Multiple stores multiplex one extension connection via a module-global `trackedConnections: Map`. Time-travel writes back through `setStateFromDevtools` with an `isRecording` flag so the echo isn't re-sent; equality of external state is checked with `JSON.stringify` comparison (!).
- **`subscribeWithSelector`** wraps `api.subscribe` with `(selector, listener, {equalityFn, fireImmediately})`, closing over `currentSlice` and diffing on every store notification. Equality _is_ first-class here — because there is no uSES in the way.
- **`immer`** is ~10 runtime lines; the other ~75 are type-level surgery. **`redux`** attaches `api.dispatch` + `dispatchFromDevtools`. **`combine`** is a type-inference device, not behavior.

### Usage idioms catalog

- **Actions-in-store**: `create((set) => ({ count: 0, inc: () => set((s) => ({count: s.count+1})) }))` — the recommended colocated form. Functions live _inside_ state, so `setState(x, true)` (replace) can wipe actions — the testing guide's reset pattern only works because `getInitialState()` still contains them. Devtools shows these as `anonymous` unless named.
- **External actions at module level**: `export const inc = () => useStore.setState(...)`. Docs claim "no downsides" — but it hard-binds actions to a module-singleton store: breaks per-test/per-request isolation (their own Next.js docs warn against module-level stores for exactly this leakage).
- **Slices pattern**: `create((...a) => ({...createBearSlice(...a), ...createFishSlice(...a)}))`. Slices are spread objects sharing one flat namespace and one `set` — key collisions are silent, cross-slice access is `get().addFish()` on the untyped whole, and the docs warn to apply middleware only at the combined store (two `persist`s fight over one `api.setState`).
- **Many small stores vs single store**: the flux guide says single store + slices; the community routinely does many stores. Nothing enforces cross-store transaction consistency (two `setState`s = two devtools actions, always).
- **Direct `setState` from anywhere**: bypasses action naming; with persist attached, does a full serialize per call.
- **Transient subscribe**: `store.subscribe(s => (ref.current = s.scratches))` — read into a ref, no re-render. The escape hatch for 60fps data.
- **`getState()` in handlers/async**: fresh-read pattern against stale closures. Fine, but invisible to devtools (reads are never tracked).
- **Selector stability (v5 footgun)**: `useStore(s => [s.a, s.b])` infinite-loops ("Maximum update depth exceeded", per the v5 migration guide); sanctioned fixes are `useShallow` or hoisted fallback constants. Test isolation is DIY: the official recipe is mocking `zustand` wholesale and collecting `storeResetFns`.

### What we take vs what we do differently

**Take:** the vanilla/react split with a dead-simple `StoreApi` contract; `getInitialState` for SSR snapshots; sync-hydration-when-storage-is-sync (our persist layer must preserve "sync storage ⇒ no hydration flash"); `subscribeWithSelector`'s `fireImmediately`; the curried-create trick for TS inference.

**Differently:** Zustand's core broadcasts to all listeners and rebuilds granularity per-hook via selector re-execution — our per-path signals invert this: a write to `user.name` notifies only that path's subscribers, so "selector stability" ceases to be a user problem; there is no `useShallow` because there is no derived-object identity to stabilize. Our snapshot hook with a monotonic read-set replaces selectors entirely. Where Zustand's devtools reconstructs actions from _stack traces_, our patch log makes every mutation carry its path+value provenance natively — action naming, time travel, and persistence diffs come from one log instead of three middlewares patching `setState` in fragile composition order. Config-enforced idioms replace docs-enforced ones.

**Codemod notes (zustand → state).** AST-detectable: `create()` calls; colocated action properties (function-valued props whose body calls `set`) → actions; `setState` object-literal arg → per-path assignments; member-expression selectors → path hooks; `useShallow(s => [a,b])` → multi-path hooks; `persist`/`devtools`/`immer` wrappers → config flags (immer becomes a no-op — direct mutation is native). **Not** reliably detectable: computing selectors (`s => s.items.filter(...)`) — must become explicit derived values, human review; `replace: true` semantics (whole-state swap — flag it); dynamic `getState()` reads in async flows; string-keyed cross-slice access; stack-trace-dependent devtools naming (emit a note, nothing to migrate).

### Gotchas found in the source

- `setState` with a non-object on a primitive store silently behaves as replace: `replace ?? (typeof nextState !== 'object' || nextState === null)`.
- Persist wraps `api.setState` but not the initializer's `set` — a middleware outside persist calling the raw `set` skips persistence.
- Devtools' `findCallerName` means **minified production builds report mangled action names**; and `JSON.stringify` comparison makes `JUMP_TO_STATE` O(state) and Date/Map-lossy.
- `subscribeWithSelector` caches `currentSlice` from subscribe-time; state changed before subscription diffs against a stale slice unless `fireImmediately`.
- The unresolved type-inference note in `vanilla.ts` line 67 has pointed at the same TS issue (#37663) since v3.

---

## Valtio 2

### Architecture from the source

**Module map:** `vanilla.ts` (460 lines — proxy, snapshot, subscribe, ref), `react.ts` (175 lines — `useSnapshot`), utils (`proxyMap`, `proxySet`, `subscribeKey`, `devtools`, `deepClone`). The hard part — render-time access tracking — is outsourced to **proxy-compare** (`createProxy`, `isChanged`, `affectedToPathList`, `markToTrack`, `getUntracked`).

**`proxy.ts` internals.** Each proxied object gets a `ProxyState = [target, ensureVersion, addListener]` in a module-global `proxyStateMap: WeakMap`. Versioning is global and monotonic: `versionHolder = [1]` increments on _any_ mutation anywhere. **Snapshot caching:** `snapCache: WeakMap<target, [version, snap]>` — `snapshot()` returns the cached object if the version matches, else rebuilds by walking `Reflect.ownKeys`, recursing into child proxies via _their_ cached snapshots. Unchanged subtrees keep referential identity across snapshots — that's the whole immutability story: copy-on-read, amortized by version numbers.

**Listener propagation up the tree.** When a child object is assigned, the parent's `set` trap proxies it and registers a child→parent listener that **prepends the prop to the op path**: `newOp[1] = [prop, ...path]`. Ops bubble to the root with full paths — Valtio has a latent patch log (`Op = ['set', path, value, prevValue]`), but it's opt-in (`unstable_enableOp`) precisely because building op objects on every write costs. Child listeners are only attached **while the parent has listeners** — a lazy dependency tree keeping unobserved graphs cheap. `ensureVersion` lazily recomputes a parent's version from children, so shared/multi-parent subobjects stay consistent without eager propagation.

**`subscribe`** batches ops in a microtask unless `notifyInSync` — one callback per flush with `ops.splice(0)`.

**`useSnapshot` and proxy-compare.** The hook: `affected = useMemo(() => new WeakMap, [proxyObject])` (per-hook access record), `useSyncExternalStore` whose `getSnapshot` diffs: if not first render and `!isChanged(lastSnapshot, nextSnapshot, affected)`, return the previous reference — uSES then bails via `Object.is`. The returned snapshot is wrapped in a _tracking_ proxy that records every property read during render into `affected`. The `inRender` flag makes the render-time getSnapshot always take the fresh snapshot (tracking must re-run), while subscription-time calls can bail. A `try/catch` around `isChanged` "ignore if a promise or something is thrown" quietly swallows tracking failures and re-renders conservatively.

**`proxyMap`/`proxySet`** (v2 rewrite): a Map emulated as a proxied plain object `{data, index, epoch}` plus an _unproxied_ `indexMap: Map<K, number>` in closure; mutations bump `epoch` (a normal proxied property riding the ordinary notification machinery).

### Usage idioms catalog

- **"Read from snapshots, mutate the source"** — the rule quoted verbatim in the `useSnapshot` docstring. Mutations are plain JS: `state.count++`, `delete state.x`.
- **Global proxy + `useSnapshot`**: destructuring a snapshot is fine (tracked proxies nest); **spreading** it or passing it wholesale to a memoized child records nothing / everything wrong.
- **Child-proxy subscription**: `useSnapshot(state.profile)` works but breaks when the parent slot is _replaced_ (`state.profile = {...}` — the component stays subscribed to the orphaned object; the docstring dedicates 20 lines to this trap).
- **Actions**: no convention — free functions mutating the proxy, or methods on it. Test isolation requires manual re-init; module-level proxies have the singleton problem.
- **Transient**: `subscribe(state.sub, cb)` / `subscribeKey(state, 'count', cb)`.
- **Getters/computed**: v2 supports object getters in snapshots; `watch` is deprecated toward valtio-reactive.

### What we take vs what we do differently

**Take:** version-stamped snapshot caching with per-subtree identity preservation (exactly the memoization our snapshot hook needs); ops-with-paths bubbling via prepended keys (validates our patch shape); lazy down-tree listener attachment only while observed; `ref()` as the opaque-value escape hatch.

**Differently:** Valtio tracks reads with a _second_ proxy layer over an immutable copy and diffs after the fact per notification, per hook. Our per-path signals make the read-set the subscription itself — no post-hoc diffing, no `affected` WeakMap lifetime bugs (their #519 targetCache patches one such leak). Our monotonic read-set fixes the class of bugs the `inRender` flag dances around: their `affected` is rebuilt every render and can transiently miss keys between render and subscribe; ours only grows until commit. Valtio's op log is off by default and `unstable_`; our patch log is the primary artifact. And where Valtio has _zero_ idiom enforcement (mutate anywhere, even during render — nothing warns), our config can require writes inside declared actions.

**Codemod notes (valtio → state).** Detectable: `proxy({...})` → store creation; `useSnapshot(x)` + member reads in the render body → path hooks; `subscribe`/`subscribeKey` → path subscriptions; `ref()` → opaque annotation. Not detectable: the _complete_ dynamic read-set (computed keys `snap[k]`, snapshots passed to helpers — fall back to whole-subtree subscription + warning); child-proxy-replacement bugs (semantic, not syntactic); mutations through aliases (`const p = state.profile; p.x = 1` — alias analysis is best-effort).

### Gotchas found in the source

- The global version counter means **any** mutation anywhere makes every snapshot's fast path re-verify (cheap but nonzero — a hot unrelated store taxes cold snapshots).
- Re-assigning the same raw object is a no-op, but assigning an equal-but-new object always notifies (no structural equality).
- `createSnapshotDefault`'s comment "Only the known case is Array.length so far" — own-descriptor collisions handled by skip; exotic objects with own non-configurable props silently drop them.
- `useSnapshot`'s subscribe does `callback()` immediately with the in-source note `// Note: do we really need this?` — papering over updates lost between render and subscription.

---

## Jotai 2 (post-2.20 internals rework)

### Architecture from the source

**Module map:** `vanilla/atom.ts` (143 lines — atom is a config object), `vanilla/store.ts` (41 lines — thin veneer), `vanilla/internals.ts` (**1270 lines — the actual store**), `react/` (Provider, `useAtomValue` 206 lines, `useSetAtom`, `useAtom`), `vanilla/utils/` (`atomFamily`, `atomWithStorage`, `selectAtom`, `splitAtom`, `loadable`, `unwrap`), plus babel plugins for debug labels.

**Atoms are inert configs.** `atom()` returns `{read, write, init?, toString}` with a global `atom${++keyCount}` key. All state lives in the store, keyed by atom object identity in WeakMaps — atoms are GC-able descriptors, stores are the universes.

**The building-blocks store.** Post-2.20, a store is `INTERNAL_buildStoreRev3(...)`: a frozen **29-slot tuple** (`BuildingBlocks`) of state (`atomStateMap`, `mountedMap`, `invalidatedAtoms`, `changedAtoms`, hook sets), interceptors, and every algorithm as a replaceable function by index. Devtools, jotai-scope and SSR frameworks swap slots instead of wrapping APIs. The header warns: _"Internal functions (subject to change without notice) — In case you rely on them, be sure to pin the version."_

**AtomState & epochs.** Per-atom mutable state: `{ d: Map<dep, epochOfDepWhenRead>, p: Set<pendingDependents>, n: epoch, m?: storeEpochValidatedAt, v?: value, e?: error }`. Mounted atoms additionally get listener/dependent sets — the doubly-linked mounted graph, freed on unmount. An atom's `n` bumps only when its value actually changes (`Object.is`); deps record the epoch at read time, so `readAtomState` validates a cached value by comparing each `dep.n` against `d.get(dep)`. A **store epoch** lets _unmounted_ atoms skip revalidation entirely when nothing in the store changed — the 2.20-era optimization for read-heavy unmounted graphs.

**Recomputation.** Writes call `invalidateDependents` (iterative stack), then `recomputeInvalidatedAtoms`: an explicit-stack DFS topological sort over mounted-or-pending dependents (comment: _"We don't bother to check for cycles, which simplifies the algorithm"_), then recompute in reverse order only atoms with actually-changed deps — glitch-free propagation without a scheduler. `flushCallbacks` loops until quiescence and aggregates listener errors into `AggregateError`.

**Async.** A read returning a promise stores the promise as the value; `p` sets track pending dependents (with an in-source maintenance note by Daishi about a potential leak that still needs investigation); `AbortController` exposed as lazily-created `options.signal`. On the React side, `useAtomValue` builds **continuable promises** — a wrapper that survives recomputation (on abort, chains to the next value) so `React.use` doesn't re-suspend on every dependency change; a `use` shim attaches `status/value/reason` for React <19.

**React binding & isolation.** `useAtomValue` is _not_ uSES — it's `useReducer` with a self-check reducer plus `store.sub` in an effect, an immediate `rerender()` after subscribe to catch missed updates, and inline `rerender()` when store/atom identity changed mid-render. Provider isolation: `StoreContext` defaulting to a lazily-created module `defaultStore`, with a dev warning if two Jotai instances create two default stores. Per-test/per-request isolation = `createStore()` or `<Provider>` — first-class, unlike Zustand/Valtio.

### Usage idioms catalog

- Primitive + derived atoms: `atom(get => get(countAtom) * 2)` — deps tracked per-execution (conditional `get` = dynamic graph, pruned after each read).
- Write-only action atoms: `atom(null, (get, set, arg) => {...})` with `useSetAtom` — Jotai's actions; naming only via `debugLabel`/babel plugin.
- `atomFamily` for keyed state (memoized by param; classic leak if params are unbounded — strong refs until `remove()`).
- `atomWithStorage` for persistence (per-atom; no migration/versioning story).
- `useHydrateAtoms` for SSR; `selectAtom`/`splitAtom` for derived slices; `loadable`/`unwrap` to de-suspense.
- What breaks: module-level `getDefaultStore().set(...)` defeats Provider isolation; atoms created inside render without `useMemo` remount state every render; the store dev-warns "store mutation during atom read".

### What we take vs what we do differently

**Take:** epoch-numbered dependency validation (our derived values record `(dep, epoch)` pairs the same way); the store-epoch shortcut for cold reads; mount/unmount as the lifecycle for effect-attached state (`onMount` ≈ our path activation hooks); Provider/store isolation as the default testing story; continuable promises for suspense-stable async.

**Differently:** Jotai's graph is **atom-granular and hand-declared** — fine granularity only if you slice state into many atoms; object-shaped state regresses to `selectAtom` boilerplate. Our per-path signals give atom-equivalent granularity _inside_ one document-shaped store. Jotai has no ops: a write is opaque, so devtools reconstruct state diffs — our patch log records the write itself. The 29-slot frozen array is an extensibility mechanism we deliberately reject in favor of named, semver'd extension points: index-addressed building blocks are unreviewable at call sites and version-pinned by necessity.

**Codemod notes (jotai → state).** Detectable: `atom(literal)` → path with initial value; `atom(get => ...)` with static `get(x)` calls → derived declarations (the read fn ports almost verbatim); write-only atoms → actions; the hooks → our hooks; `atomWithStorage` → persist config. Not detectable: **conditional dependencies** (`get(cond ? a : b)`) — ports as a dynamic derived read, emitted in permissive form; `atomFamily` keying → path-parameterization only when the param is string-like (flag object params); custom multi-atom `write` functions are transactions — mechanically translatable, but Jotai's eager recomputation inside `set` needs a behavioral note; anything touching `INTERNAL_*` is a hard stop.

### Gotchas found in the source

- `AtomState.p`: _"This may cause memory leaks, but it's for the capability to continue promises."_ — the quoted warning is retained; the trailing maintenance annotation asking Daishi to revisit it is omitted, so this is not the complete verbatim comment. It records a potential leak requiring investigation, not proof of a leak in every use.
- `shouldThrowSynchronously` string-matches error messages (`'call stack'`, `'too much recursion'`) to avoid caching _infinite recursion_ as an atom error value.
- `ensureAtomState` deliberately avoids destructuring because it's a hot spot (comment cites PR #3313) — index lookups over destructuring, in 2026.
- `flushCallbacks`'s do/while means a listener that writes re-enters recomputation before the flush completes; listener errors don't stop sibling listeners (`AggregateError`) — unlike Zustand, where a throwing listener aborts the `forEach`.

---

## Legend-State v3 (beta)

### Architecture from the source

**Module map:** core (`createObservable`, `ObservableObject.ts` 1506 lines — the proxy handler, `globals.ts`, `tracking.ts` 43 lines, `onChange.ts`, `batching.ts` 369 lines, `observe.ts`, `linked.ts`), react bindings (`use$`, `Memo/Computed/For/Show/Switch`, `observer`), sync engine (`synced.ts`, `syncObservable.ts` 1597 lines, retry/transform helpers), plugin dirs `persist-plugins/` (local-storage, indexeddb, async-storage, mmkv, expo-sqlite) and `sync-plugins/` (crud, fetch, firebase, supabase, keel, tanstack-query).

**Proxy-to-path, not proxy-to-object.** The structural inversion vs Valtio: the Proxy target is a **`NodeInfo`** — `{root, parent, key, children?, listeners?, proxy?, lazy, numListenersRecursive}` — _not_ the data. The raw data lives untouched at `node.root._`; `getNodeValue(node)` walks keys down the plain object (with a reused module-level scratch array — allocation-free path resolution). Child nodes are created lazily on property access and cached. Consequences: user data is never wrapped (JSON-ready, no unwrapping for network/storage); identity of `user$.name` is stable _by path_ even when the underlying value is replaced — the exact opposite of Valtio's child-replacement footgun; primitives get first-class observables.

**The `get` trap** is a dispatcher: symbols, link forwarding, Map/Set wrapping, the `observableFns` table (`get/set/peek/onChange/assign/delete/toggle` — with an arity `switch` commented _"Array call and apply are slow so micro-optimize this hot path"_), array modifier interception (`push` fast-path becomes `setKey(node, length, v)`; other mutators snapshot `prevValue = target.slice()` then re-set for correct change records), and array loopers whose **callbacks receive child proxies, not raw values**. Everything else returns a proxy — reads never touch data until `.get()`/`.peek()`.

**Tracking** is a global `tracking.current` context; `.get()` tracks, `.peek()` doesn't, `.get(true)` tracks _shallow_ (fire only on child-list changes). `trackSelector` subscribes immediately, with the comment: _"useSyncExternalStore doesn't subscribe until after the component mount. We want to subscribe immediately so we don't miss any updates."_

**Notification & batching.** `onChange` attaches listeners to a node and bumps `numListenersRecursive` on every ancestor — dispatch skips whole subtrees with zero listeners. `notify` computes changes up the tree — each ancestor listener receives `{path, pathTypes, valueAtPath, prevAtPath}` relative to itself — **a native patch log per listener** — coalesced per-node into `_batchMap` (a set reverted within a batch deletes the entry), flushed sync or per-batch, with a timeout guard that force-flushes and dev-errors _"Forcibly completing observableBatcher because end() was never called"_. `getPrevious` is a lazy clone-and-reverse-apply (_"cloning is expensive"_).

**React fine-grained bindings.** `use$`: a memoized closure holding `version` and `run` (dispose → track → resubscribe), wired to uSES where **the "snapshot" is just a version counter**; the value is computed during render. On change, it re-runs the selector and bumps the version only if the result changed. Inside an `observer`, a plain-observable selector skips the hook and joins the enclosing tracking context. **`Memo`/`Computed`**: `Computed` renders a render-prop whose observable reads re-render _only this leaf_; `Memo` is `React.memo(Computed, () => true)` — the comparator hard-codes "never re-render from parent". **`For`**: subscribes shallowly (re-renders only on length/key changes), auto-detects an `id`/`key` field, auto-wraps the row in `observer`/`memo`, and hands each row `item$` — the _observable_ — so row edits re-render only rows.

**`synced()`/persist plugin architecture.** `synced(params)` = `linked({...params, synced: true})` — a function tagged with `symbolLinked`. When a node whose value is a linked function is first activated (lazily, on read/listen), `activateSyncedNode` turns it into a managed remote binding; `syncObservable` owns the pipeline: load persisted data, apply remote `get`, then observe changes and route them into per-options queues (debounce, `retry` with backoff, `onBeforeSet/onAfterSet`, `revertChanges` on failure) — changesets are the same `{path, valueAtPath, prevAtPath}` records the listener system produces, so sync diffs are free.

### Usage idioms catalog

- `const state$ = observable({user: {name: ''}})`; read `.get()` (tracked) / `.peek()` (untracked); write `.set()/.assign()/.delete()/.toggle()`. Everything `$`-suffixed by convention.
- Components: `use$(state$.user.name)`, or `observer(Component)` + bare `.get()`s; leaves via `<Memo>{() => state$.count.get()}</Memo>`; lists via `<For each={list$} item={Row}/>`.
- Computeds: functions in observables become lazily-activated computed nodes; two-way linking via `linked({get, set})`.
- Sync: `syncObservable(state$, synced({get, set, persist}))` — local-first, retry-queued.
- What breaks: forgetting `.get()` silently renders a proxy; `peek()` in a selector = missed updates by design; passing `item$.get()` into `<For>` rows defeats row granularity; the `use$`-inside-`observer` short-circuit changes hook counts between observer and non-observer renders.

### What we take vs what we do differently

**Take (the most from any of the four):** the **node-tree-keyed-by-path with data left raw** design is the closest prior art to our per-path signals — path-stable identity, lazy node creation, `numListenersRecursive` subtree skipping, and per-listener relative-path change records (their `Change` ≈ our patch entries). Immediate subscription before uSES commit. `For`'s shallow-tracking + `item$` handoff is the correct list story.

**Differently:** Legend's tracking context is a **mutable global** populated by `.get()` side effects — implicit, and `peek` vs `get` is a per-call-site trap; our snapshot hook's monotonic read-set is collected by the hook itself from path reads, with no untracked-read footgun inside render. Legend's API surface is enormous and idioms are convention (`$` suffix); our config-enforced idioms cut this to one read form (+ strict writes when enabled). Their sync engine validates our patch-log-driven persistence — but `synced()`'s lazy node activation (a read triggers network) is spooky-action we deliberately don't take; our sync attaches to the patch log explicitly. `Memo`'s `() => true` comparator (children-closure staleness unless `scoped`) is a trap we avoid by not having closure-capturing leaf components.

**Codemod notes (legend-state → state).** Detectable — the easiest of the four, paths are literally in the AST: `observable(...)` → store; `.get()/.peek()/.set()/.assign()` chains → path reads/writes; `use$(x$.a.b)` → path hook; `<Memo>/<Computed>` → our leaf primitives; `<For each={x$}>` → our list helper; persist plugin names → persist config. Not detectable: `observer()` components' _implicit_ read-sets (any `.get()` in any called helper — translate to our tracked-snapshot hook wholesale); function-valued observables with dynamic reads; `linked` two-way timing semantics (emit behavioral warnings).

### Gotchas found in the source

- Array mutators other than `push` do `target.slice()` then double-write _"so it notifies with the correct prevValue"_ — a full copy per `splice/sort` to fake atomicity.
- The `get` trap special-cases `'constructor'`, `'apply'`, `'call'`, `Symbol.iterator`-on-primitives — each a scar from React/devtools probing proxies (_"React dev validation does this for example, and crashes"_).
- `flushPending()` inside `get`/`peek`: pending computed activations are force-flushed synchronously _because the user read_ — `get()` is not side-effect-free.
- `useSelector`'s dev-mode `resubscribe` exists solely as _"Workaround for React 18 running twice in dev (part 2)"_ — a parallel subscription path production never runs.

---

## Cross-cutting summary

|                   | Zustand 5                               | Valtio 2                                     | Jotai 2.20                             | Legend v3β                              | state                               |
| ----------------- | --------------------------------------- | -------------------------------------------- | -------------------------------------- | --------------------------------------- | ----------------------------------- |
| Granularity       | none in core; selector re-run per write | per-object version + render read-tracking    | per-atom epochs                        | per-path nodes, global tracking context | per-path signals                    |
| Change record     | none (devtools parses stack traces)     | opt-in `Op[path]` bubbling                   | none                                   | `Change{path,prev,value}` per listener  | patch log (primary)                 |
| Read tracking     | manual selectors                        | proxy-compare `affected`, rebuilt per render | explicit `get()` in atom reads         | `.get()` into mutable global tracker    | monotonic read-set in snapshot hook |
| Isolation/testing | DIY mock + reset registry               | none (module proxies)                        | `createStore`/Provider (best-in-class) | global `$` observables                  | store instances + config            |
| Persistence       | middleware wrapping `setState`          | none in core                                 | per-atom `atomWithStorage`             | full sync engine on changesets          | patch-log-driven                    |
| Idiom enforcement | docs only                               | none                                         | types only                             | convention (`$`)                        | config-enforced                     |

Codemod feasibility ranking for `state migrate from`: **legend-state** (paths in the AST) > **jotai** (declared deps, port reads) > **zustand** (member-expression selectors detectable; computing selectors and `replace:true` need review) > **valtio** (dynamic read-sets and aliased mutations force conservative whole-subtree fallbacks).
