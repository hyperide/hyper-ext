# Framework adapters: which names belong to whom?

An adapter translates a store's read/subscribe/lifetime contract into a framework's rendering contract. It does not make framework APIs into state-lib exports. **All production `state/*` adapter packages below remain planned.** The React example in the existing browser REPL uses the site's actual prototype; the other recipes are editable references, not evidence of shipped adapters.

## A common boundary to explain the examples

The `Readable<T>` type below is a **local explanatory interface** used only in this guide. It is not a claim about a published package's exports. `getSnapshot()` must return the same immutable reference while unchanged. `subscribe` returns a disposer. For SSR, supply a request-specific initial snapshot; never share user data through a module-global store.

```ts
interface Readable<T> {
  getSnapshot(): T;
  subscribe(notify: () => void): () => void;
}
```

The site prototype's `store.snapshot()` currently clones: it must **not** be passed directly to React's `getSnapshot` callback for an object result. The prototype has path-specific hooks, and its signal getter can provide a stable scalar. A production adapter needs a cached immutable snapshot or versioned read boundary. [React documents this cached-snapshot requirement](https://react.dev/reference/react/useSyncExternalStore).

## React

**Native:** `useSyncExternalStore`, `useState`, `memo`, `useOptimistic`, `use` are React APIs. **Proposed state APIs:** `useSlice`, `useTracked`, `useActions`, `StateProvider`, `For`, `useItems`, `useItem` and `useOptimisticSlice`. A `For` component is not built into React.

```ts
import { useSyncExternalStore } from 'react'; // native React

// This guide's adapter function, not a native React API.
function useReadable<T>(node: Readable<T>, serverSnapshot: T) {
  return useSyncExternalStore(
    notify => node.subscribe(notify),
    () => node.getSnapshot(),
    () => serverSnapshot,
  );
}
```

Use a snapshot bridge for an external store integrated with normal React rendering. The proposed tracked mode additionally owns read tracking; this wrapper does not implement it. The mode policy follows decision #12: tracked is recommended absent React Compiler, while Compiler-enabled projects select snapshot mode. The earlier adapter paragraph said the opposite and has been corrected.

[Run the native React bridge and prototype side by side](/repl/adapter-react). The rest of the guide's exact-source buttons preserve imports and interfaces; they do not pretend to have bootstrapped a framework application. Contract: [§6.1](/spec#s6-1).

## Vue

**Native Vue:** `shallowRef`, `computed`, `triggerRef`, `onScopeDispose`. **Proposed state/Vue:** `useSlice`, its signal bridge and `definePiniaStore`. Pinia's existing `defineStore` is native to **Pinia**, not Vue; `definePiniaStore(slice)` would be our compatibility helper.

```ts
import { shallowRef, onScopeDispose } from 'vue'; // native Vue
function useReadable<T>(node: Readable<T>) { // guide-local adapter
  const value = shallowRef(node.getSnapshot());
  const stop = node.subscribe(() => { value.value = node.getSnapshot(); });
  onScopeDispose(stop);
  return value;
}
```

The snapshot must be read again on each notification. For an immutable replacement, assigning `value.value` is sufficient; `triggerRef` is for a deliberately stable outer ref with changed internal contents, not something to blindly add to every update. Source: [Vue advanced reactivity](https://vuejs.org/api/reactivity-advanced.html). Contract: [§6.2](/spec#s6-2).

## Solid

**Native Solid:** `createSignal`, `onCleanup`, `For`; `reconcile` and `createStore` live in `solid-js/store`. **Proposed state adapter:** binding a state node to a Solid signal. An unqualified `from(node)` is ambiguous because Solid also has a native `from` utility; imports must state which one is meant.

```ts
import { createSignal, onCleanup } from 'solid-js'; // native Solid
function useReadable<T>(node: Readable<T>) { // guide-local adapter
  const [read, write] = createSignal(node.getSnapshot());
  const stop = node.subscribe(() => write(() => node.getSnapshot()));
  onCleanup(stop);
  return read;
}
```

The setter receives an updater function so a function-valued snapshot is not mistakenly invoked as an updater. Call inside an owner context so cleanup is attached. Large keyed lists need a per-item contract rather than this whole-snapshot wrapper. Sources: [createSignal](https://docs.solidjs.com/reference/basic-reactivity/create-signal), [onCleanup](https://docs.solidjs.com/reference/lifecycle/on-cleanup). Contract: [§6.3](/spec#s6-3).

## Svelte

**Native Svelte:** `readable` from `svelte/store`, `createSubscriber` from `svelte/reactivity`, and compiler runes such as `$state`. **Proposed state adapter:** a lifecycle-aware bridge from a state node to one of those native contracts. `$state` is not an ordinary imported function.

```ts
import { readable } from 'svelte/store'; // native Svelte
function asReadable<T>(node: Readable<T>) { // guide-local adapter
  return readable(node.getSnapshot(), set => {
    // Refresh on first subscription: the source may have changed since construction.
    set(node.getSnapshot());
    return node.subscribe(() => set(node.getSnapshot()));
  });
}
```

This is the conventional store-contract recipe. The `createSubscriber` route is a different Svelte-5 integration and must be separately tested. A server store belongs to the request/context, not a module singleton. Source: [Svelte stores](https://svelte.dev/docs/svelte/stores). Contract: [§6.4](/spec#s6-4).

## Angular

**Native Angular:** `toSignal` from `@angular/core/rxjs-interop`, `inject`, `DestroyRef`. **Native RxJS:** `Observable`. **Proposed state/Angular:** `injectSlice` and a state-node bridge. Angular's native `toSignal` expects an Observable, **not an arbitrary state node**.

```ts
import { toSignal } from '@angular/core/rxjs-interop'; // native Angular
import { Observable } from 'rxjs'; // native RxJS
function stateNodeSignal<T>(node: Readable<T>) { // guide-local adapter
  const updates = new Observable<T>(subscriber => {
    subscriber.next(node.getSnapshot());
    return node.subscribe(() => subscriber.next(node.getSnapshot()));
  });
  return toSignal(updates, { requireSync: true });
}
```

Call in an injection context, or explicitly pass an injector. Native `toSignal` subscribes and handles destruction according to Angular's documented lifecycle. This example emits synchronously, so `requireSync` is justified rather than guessed. Use a name such as `stateNodeSignal` to avoid suggesting Angular has a `toSignal(node)` overload. Source: [Angular RxJS interop](https://angular.dev/ecosystem/rxjs-interop). Contract: [§6.5](/spec#s6-5).

## Lit and other Web Components

**Native Lit:** `ReactiveController`, `ReactiveControllerHost`, `requestUpdate`. **Proposed state/Lit:** `StateController` and a pinpoint-render directive. This is unrelated to state-lib's low-level `watch(fn)` primitive despite earlier overloaded wording.

```ts
import type { ReactiveController, ReactiveControllerHost } from 'lit';
class ReadableController<T> implements ReactiveController { // guide-local
  value: T;
  private stop?: () => void;
  constructor(private host: ReactiveControllerHost, private node: Readable<T>) {
    this.value = node.getSnapshot();
    host.addController(this);
  }
  hostConnected() {
    this.value = this.node.getSnapshot();
    this.stop?.();
    this.stop = this.node.subscribe(() => {
      this.value = this.node.getSnapshot();
      this.host.requestUpdate();
    });
  }
  hostDisconnected() { this.stop?.(); this.stop = undefined; }
}
```

Reconnects refresh the current value and establish a new subscription. A production context/discovery adapter is additional work; this controller does not solve context across shadow roots by itself. Source: [Lit reactive controllers](https://lit.dev/docs/composition/controllers/). Contract: [§6.6](/spec#s6-6).

## Qwik and the limit of a recipe

Qwik remains outside the v1 adapter set. Serializable snapshots and ids are a possible reattachment design; serializing a live subscription function or a closure over the store is not that design. A recipe must respect resumability instead of claiming to be “the same hook with a different import.” Contract: [§6.7](/spec#s6-7).

## What must be tested before an adapter is called implemented

A type-correct wrapper alone is insufficient. Test initial read and update ordering; cached snapshot identity; multiple subscriptions; unsubscribe and remount/reconnect; errors; empty/large keyed lists; SSR request isolation and initial hydration; framework development-mode remounts; controlled-input selection and actual IME composition. Measure size from the built adapter, not the length of these illustrative snippets. The shared proposed conformance suite is itself planned, not an already published `@state/adapter-tests` dependency.
