# Research — `useEffect` patterns and their declarative equivalents

**Date:** 2026-09-04 · **Status:** research, nothing decided · **Requirement:** R84

**Summary.** Of the fourteen reasons an effect gets written, ten are a missing primitive wearing a hook: a computed, a data source, a policy, or a declared reaction. Three are irreducible, and they share the property that makes the lint decidable — **their body needs the DOM to reflect the last render**. Declared effects (§4.14) run in bus phase 4, post-commit and pre-render, so the store cannot host those and should not try. Hence two rules rather than one ban: `no-effect-for-state` (error) where trigger and outputs are both state, and `effect-must-be-dom` (warn, ratcheting to error per glob) for the rest, with a **renamed import** rather than a suppression comment as the escape hatch — `useDomEffect(ref, fn, deps)`, whose signature forces the ref argument that makes the claim partly checkable and wholly greppable. Migrations extend `state migrate from`'s already-listed "plain `useState`+`useEffect`+`fetch` hooks" entry.

One naming hazard first, because every lint message depends on it: the spec has **two** things called `effect`. §4.1 `effect(fn)` is a phase-2 signal effect; §4.15 `effect({ on, writes, run })` is a declared reaction in phase 4, and §4.14 warns they must not be conflated. No message may say "use `effect()` instead" — it names the specific construct (`derive`, a collection source, `bind`, `persist`, "a declared effect"). A bare phase-2 `effect(fn)` in a component body is the same violation as a `useEffect`, or the rule is evaded by an import swap.

## 1. The catalogue

| #   | Reason the effect exists         | Target                             | Verdict                          |
| --- | -------------------------------- | ---------------------------------- | -------------------------------- |
| 1   | Fetch on mount                   | collection source (§4.5, §8.1)     | forbid + codemod                 |
| 2   | Derive state with a setter       | `derive` (§4.3)                    | forbid + codemod                 |
| 3   | Reset state when a prop changes  | `useLocal(slice, key)` (§4.9)      | forbid + codemod                 |
| 4   | Subscribe to an external store   | `migrate from <lib>`, or a source  | forbid + codemod                 |
| 5   | Subscribe to a browser API       | env sources (**new module**)       | forbid + codemod                 |
| 6   | Timers and intervals             | declared effect / task (§4.15)     | forbid, except rAF-to-DOM        |
| 7   | Event-handler logic misfiled     | an action at the call site         | forbid, flag only                |
| 8   | Chains of effects                | `derive`, or one action            | forbid, flag only                |
| 9   | Debounce / throttle a write      | `bind` rate policy (§12.5.4)       | forbid + codemod                 |
| 10  | Sync to `localStorage` / the URL | `persist` (§8.5), `url` (§8.6)     | forbid + codemod                 |
| 11  | Analytics on mount or change     | declared effect on a patch trigger | forbid, open question            |
| 12  | Imperative DOM work              | —                                  | **keep**                         |
| 13  | Cleanup on unmount               | scopes (§4.7, §4.15.5)             | split: forbid / keep             |
| 14  | `useLayoutEffect`                | —                                  | **keep**, one sub-case forbidden |

### 1. Fetch on mount, and the race

```tsx
useEffect(() => {
  let alive = true;
  fetch(`/api/products/${id}`)
    .then((r) => r.json())
    .then((d) => {
      if (alive) setData(d);
    });
  return () => {
    alive = false;
  };
}, [id]);
```

The `alive` flag discards a late response without aborting the request, is omitted more often than written, dedupes nothing when two components want the same `id`, and leaves loading and error state to booleans that drift.

```ts
const products = collection(Product, { key: 'id', source: rest('/api/products') });
// component: useSlice(products).byId.get(id)
```

`sync(begin/write/commit/markReady)` owns the request, `interest` refcounting dedupes and disconnects (§4.5), status is state (§4.15.4). **Forbid, with a codemod.**

### 2. Deriving state by calling a setter

```tsx
const [total, setTotal] = useState(0);
useEffect(() => {
  setTotal(items.reduce((a, i) => a + i.price, 0));
}, [items]);
```

Two renders per change, a window where `total` is stale, and a value editable independently of its inputs. `derive(() => …)` is lazy, cached and cannot desynchronise; for filtered or sorted collections the target is `derive.collection(source, { filter, sort })`, which consumes patches rather than recomputing (R66 measured ≈61× at 10 000 rows). **Forbid, with a codemod** — the highest-volume entry in every codebase we have looked at.

### 3. Reset state when a prop changes

```tsx
useEffect(() => {
  setDraft(item.text);
  setDirty(false);
}, [item.id]);
```

React's own advice is to remount with `key`, which throws the old draft away.

```ts
const draft = useLocal(editorDraft, item.id); // §4.9: explicit key → one node per key
```

Switching items switches nodes; the previous draft is still in the store, so tab-back restores it, and whether it survives is a `retain` decision (§8.9) rather than an accident — R77's "never lose user input", concretely. **Forbid, with a codemod.**

### 4. Subscribing to an external store

```tsx
useEffect(() => store.subscribe(() => setState(store.getState())), []);
```

Tearing — a render observing two store versions — is the classic failure, and the reason `useSyncExternalStore` exists. If the store is another state library, `state migrate from <lib>` stops it being external; if it is genuinely foreign (extension host, worker, SDK), it implements the collection source contract once, in one place. **Forbid, with a codemod** for known libraries; flag the rest.

### 5. Browser APIs: resize, media query, online, visibility, storage

```tsx
useEffect(() => {
  const mq = matchMedia('(max-width: 640px)');
  const on = () => setNarrow(mq.matches);
  mq.addEventListener('change', on);
  on();
  return () => mq.removeEventListener('change', on);
}, []);
```

Written per component, so _n_ components mean _n_ listeners and _n_ copies of one global, observable, serialisable fact:

```ts
const env = slice('env', { source: browserEnv(['viewport', 'online', 'visibility', 'prefersDark']) });
```

**No such module exists today** — §8.4's built-in sources do not cover the browser environment, and this entry is the argument for adding one. Forbidding a pattern while offering no target is how a lint loses authority. **Forbid, with a codemod — conditional on the module existing.**

### 6. Timers and intervals

```tsx
useEffect(() => {
  const t = setInterval(tick, 1000);
  return () => clearInterval(t);
}, []);
```

Duplicated per mount, drifting, invisible to tests. A declared effect owns the timer, belongs to a scope, cancels with it, and cooperates with `store.tick()` and fake timers (§12.1). The exception is a `requestAnimationFrame` loop writing to a canvas or a transform — entry 12 wearing a timer. **Forbid, except when the body is DOM work.**

### 7. Event-handler logic that ended up in an effect

```tsx
useEffect(() => {
  if (submitted) {
    showToast('Saved');
    setSubmitted(false);
  }
}, [submitted]);
```

A boolean invented to carry "the user clicked" across a render boundary; it belongs in the handler, as an action. A codemod cannot do this safely — it would have to prove the flag has one writer, no other reader, and that moving the body preserves ordering against state the handler also writes. **Forbid, flag only**, naming the flag and its writer; the human fix takes thirty seconds once pointed at.

### 8. Chains of effects

One effect writes `a`, triggering an effect that writes `b`, triggering a third. Each hop costs a render, the intermediate states are observable and usually invalid, and nobody can draw the graph. Hops that compute become `derive`; hops that act become declared effects whose `on × writes` the analyser reads without executing anything (§4.14), so `doctor` reports cycles statically and the runtime caps depth at 16 hops per cause chain. **Forbid, flag only** — deciding which hops were derivations is a judgement, and getting it silently wrong is worse than the chain.

### 9. Debounced and throttled writes

```tsx
useEffect(() => {
  const t = setTimeout(() => onSearch(query), 300);
  return () => clearTimeout(t);
}, [query]);
```

Two standard defects: the trailing keystroke is lost on unmount, and there is no supersession, so responses land out of order.

```tsx
<input {...bind(search.$.query, { rate: { debounce: 300 } })} />;
effect({ on: search.$.query, policy: 'latest', run: (ctx, q) => api.search(q, { signal: ctx.signal }) });
```

`rate` is input scheduling and flushes on blur, Enter, submit and scope disposal; `policy: 'latest'` is task supersession and aborts the previous request. **Forbid, with a codemod** for the plain shape.

### 10. Syncing to `localStorage` and to the URL

The same argument twice: an effect writing a serialised copy of state somewhere outside, plus a mount-time read that must not fight the write. Hand-rolled, they hydrate in the wrong order, loop when the URL write re-enters the state read, and have no versioning. Both are policies — `persist: { where: 'localStorage', include, debounce, version, migrate }`, and the `url` module's `updateFromSource` cycle guard. **Forbid, with a codemod.**

### 11. Analytics and logging

```tsx
useEffect(() => {
  track('checkout_viewed', { id });
}, [id]);
```

Effects fire twice in StrictMode, fire again on remounts the user never perceived, and scatter the event vocabulary across the tree. The command log already carries intent, so a declared effect on a command or patch trigger puts the whole analytics surface in one inspectable place. Mount _should_ be expressible as a patch trigger, since a `useLocal` node is an `add` at `/ui/<Component>/<instanceId>` — but §4.9 coalesces transient patches per frame and keeps them out of the command log, so **whether mount is reliably observable as a patch is an open question**. Change-triggered analytics is safe today; mount-triggered is flagged pending that answer.

### 12. Imperative DOM work — **keep**

Measurement, focus, scroll restoration, canvas, handing an element to a non-React widget:

```tsx
useEffect(() => {
  const chart = new ThirdPartyChart(ref.current, opts);
  return () => chart.destroy();
}, []);
```

No declarative target, and there should not be one. See §2.

### 13. Cleanup and cancellation on unmount

Split by what is cleaned. Aborting a request, tearing down a subscription, cancelling in-flight work: **forbid** — that work belongs to a scope, and when the scope ends its tasks cancel with reason `scope-ended`, finalisers run last-in-first-out, optimistic residue rolls back (§4.15.5). Destroying a widget or removing a DOM listener you added: **keep** — entry 12's cleanup half.

### 14. `useLayoutEffect` — **keep**, with one exception

It is a different question because its whole purpose is the window between mutation and paint: measure, adjust, before the user sees the intermediate. No store scheduling can occupy that window, because the store commits before React renders at all. The exception is using it to derive state synchronously to dodge the flash of a chained effect — that is entry 2 with better timing, and the lint should catch it by what the body touches, not by which hook it is.

## 2. The survivors, and why the store must not absorb them

The criterion follows from scheduling, not taste. Declared reactions run in bus phase 4: post-commit, drained in a microtask, **before React has rendered the state that triggered them**. A body that needs the DOM to reflect the latest render therefore has nothing in the store to attach to, and adding a post-paint hook would mean a second scheduler that knows about framework rendering inside a framework-agnostic store — the coupling §4.15.6 already refuses when it leaves `startTransition` to the adapter.

The criterion is about what the body **needs**, not what the trigger is. Scrolling a newly selected row into view is state-triggered and still a survivor, because it reads `getBoundingClientRect` on a node that exists only after the render. A `matchMedia` subscription is DOM-triggered and _not_ a survivor, because its body only writes state.

So: measurement after layout, focus management, scroll position, imperative handles to third-party widgets, canvas and WebGL, and anything reading or writing `ref.current` as an element. These are not exceptions grudgingly granted — they are the residue left when everything that was really state, data or policy has moved out, and the lint's job is to make that residue small enough to read.

**The escape hatch.** Not a suppression comment — ignorable, unsearchable in aggregate, and it disables the whole rule for the line. A renamed import instead:

```tsx
import { useDomEffect } from '@state/react';
useDomEffect(
  chartRef,
  (el) => {
    const c = new Chart(el);
    return () => c.destroy();
  },
  [opts],
);
```

The signature forces a ref, so the "this is DOM work" claim is partly checkable rather than purely asserted; `grep -c useDomEffect` is a health metric CI can ratchet down. The cost, plainly: a determined author passes a ref holding a number and nothing catches it. One more API surface and one unchecked claim, for a hatch that is discoverable and countable rather than invisible.

## 3. The lint design

Two rules and one config axis.

**`no-effect-for-state`** — error. Fires when the body reads state and writes state, or reads state and writes the non-DOM outside world (network, storage, URL, analytics). The message names the target and the path: `total is derived from items — use derive(() => …) instead of setState in an effect`.

**`effect-must-be-dom`** — warn by default. Fires on any surviving `useEffect` that is not `useDomEffect`, and says how to convert rather than that the code is wrong.

Discrimination is a 2×2 over what the body reads and writes:

| body reads                     | body writes            | verdict                                           |
| ------------------------------ | ---------------------- | ------------------------------------------------- |
| state                          | state                  | forbid — `derive`, keyed `useLocal`, or an action |
| state                          | outside world, not DOM | forbid — a policy or a declared effect            |
| browser globals                | state                  | forbid — a source                                 |
| `ref.current`, element methods | DOM                    | **survivor**                                      |

**Decidable in Rust alone:** whether the body calls a known setter (a `useState` destructure, a `useLocal` or slice write); whether it touches `fetch`/`axios`, `localStorage`, `history.pushState`, `matchMedia`, `addEventListener` on `window`/`document`; whether it touches `.current` at all; the dep array; and whether the hook is a wrapper (an `additionalEffectHooks`-style regex, or `useMyEffect` defeats the rule on day one). That covers most real code, because these bodies are short and their vocabulary is small.

**Needs the TypeScript sidecar.** `ref.current` holding an `HTMLElement` and one holding a number are syntactically identical; only the checker separates `RefObject<HTMLElement>` from `MutableRefObject<number>` — the first is a survivor, the second a mutable instance variable that should be a `useLocal` node. Likewise whether an imported helper transitively writes state.

**False positives, honestly.** A body that measures the DOM _and_ writes the measurement into state is legitimate (a tooltip positioning itself and recording its placement) and looks exactly like entry 2 to the analyser. A body that is one call into an imported helper is opaque to the Rust engine. An effect existing purely for its cleanup reads as "writes nothing" and is misclassified. All three land on `effect-must-be-dom` at warn, never on the error rule; the hatch costs one import line.

## 4. The migrations

**No new subcommand.** §11.2 defines `state migrate from <lib>` as "another library **or approach** → ours" and already lists "plain `useState`+`useEffect`+`fetch` hooks". This work is that entry expanded — `state migrate from react-effects`, sharing `--analyze`, partial scope, reversibility and the `--llm` pass. A fifth family member would break an axis whose meaning is "source idiom → ours".

Mechanical, syntax only: entries 2, 9, 10, and the timer half of 6. Needs types: 1 (the response type becomes the collection's item schema), 4, and every `ref.current` disambiguation. Flag only: 7, 8, and 11 pending the open question.

Two of the four valuable codemods, shown as the tool's actual output rather than an idealised hand rewrite:

```ts
// before
const [total, setTotal] = useState(0);
useEffect(() => setTotal(items.reduce((a, i) => a + i.price, 0)), [items]);
// after — module scope if `items` is a slice path, else in-component
const total = derive(() => items.reduce((a, i) => a + i.price, 0));
```

```ts
// before: useEffect + setTimeout + onSearch (entry 9)
// Proposed output (HYP-1457; codemod implementation pending): input binding still requires manual work
effect({
  on: search.$.query,
  debounce: 300,
  policy: 'latest',
  writes: [search.$.results],
  run: (ctx, q) => api.search(q, { signal: ctx.signal }).then((r) => search.results.set(r)),
});
// Manual binding required: <input {...bind(search.$.query)} /> — rate now lives on the effect
```

For the unclassifiable, follow Svelte's precedent: when its migration script could not tell a derivation from a side effect it emitted `run` from `svelte/legacy` rather than guessing. The planned equivalent here (HYP-1457; implementation pending) is a rewrite to `useDomEffect` with an explicit diagnostic that classification remains unresolved and manual review and implementation are required. These diagnostics must be searchable and counted; the codemod must not silently guess the semantics.

## 5. The honest risk

**A rule that fires on legitimate code gets disabled.** Not hypothetical: `react-hooks/set-state-in-effect` is `error` by default in v6 and already collects "overly strict?" reports (react/react#34743) and a `useEffectEvent` bypass (#35390). Mitigation: only the unambiguous half is an error, everything ambiguous is a warning with a named hatch, and the hatch is an import rather than a suppression, so disabling never widens beyond the call site.

**A codemod that changes semantics is worse than the effect.** Four changes this family makes, all of which `--analyze` must print before running: the **mount run is lost** (`on:` fires on change; `useEffect` also fires on mount); **timing moves earlier** (phase 4 is pre-render, so a body that read a rendered DOM value now reads the previous one); **the intermediate stale render disappears** (intended, but code keyed to it breaks); and **debounce flush changes** (hand-rolled loses the trailing keystroke on unmount, `bind` flushes it — a fix, but still a change). Verification reuses the gate §5.1 already has: the same suite must pass before and after.

**A half-migrated project has both idioms.** `state lint` already enforces per-axis invariants with globs. Add an `effects` axis — `forbid | warn | allow` per glob — so migrated directories ratchet to `forbid` while the rest sit at `warn`, and the boundary is a config line a reviewer can read rather than a mood.

## 6. Prior art

**React's "You Might Not Need an Effect"** got the taxonomy right and the enforcement absent: it is prose, so compliance depends on having read it. This document is that page with verdicts and a compiler attached.

**`eslint-plugin-react-hooks` and exhaustive-deps** is the cautionary tale — correct far more often than its reputation suggests, but its message describes the symptom and never the fix, so the learned response became the disable comment.

**React Compiler's bail-out** is the degradation model worth copying: on a violation it skips one function, emits a diagnostic, never breaks the build, and `"use no memo"` is per-function and greppable.

**Solid's `createEffect`** shows fine-grained reactivity shrinking the effect population by construction — no dependency array, no render to fight — yet Solid still keeps effects for DOM work, independently confirming §2's residue.

**Svelte 5's `$:` → `$derived`/`$effect`** is the closest migration precedent, and its lesson is that the ambiguity _was_ the bug: `$:` never said whether you meant a value or an action. Its `run` stopgap and its microtask scheduling (which killed self-triggering loops) are both borrowed above.

**Vue's `watch` versus `computed`** is the same split with a decade of practice; its documented failure mode is ours to avoid — a `watch` that assigns to a ref is a `computed` written badly.

**XState** makes the strongest claim: a machine removes a class of effects entirely, because "when X happens in state S, do Y" becomes a transition rather than a reaction. `fsm()` is already a slice primitive and `state migrate` can promote a slice with `status` fields into one; entries 7 and 8 are most often better answered that way.

## Open questions

1. **Is mount observable as a patch?** Entry 11 depends on whether §4.9's per-frame transient coalescing preserves the `add` at `/ui/<Component>/<instanceId>` as a distinguishable event.
2. **Does the browser-env source module get built?** Entry 5's verdict is conditional on adding one to §8.4.
3. **Default severity of `effect-must-be-dom`** in a greenfield project from `state init` — warn, for consistency, or error, since there is nothing to migrate?
4. **How much ref-type discrimination justifies the sidecar's start-up cost** on every lint run, versus degrading to warn when types are unavailable.
