# Practical concepts: what they prevent, and when to use them

These explanations distinguish the working site prototype from planned production contracts. The [API index](/api) is generated from the prototype. The [master spec](/spec) describes the intended toolkit; a code sketch there is not automatically an installed export.

<span id="slice" class="anchor"></span>

## Slice: one named region, not another store runtime

A slice groups a domain's fields, collections, actions and local policies. For example, `checkout` can own the basket and submission status, while `session` owns the signed-in user. Compose them in one store when a transaction must update both. A component's temporary hover state need not become a global slice.

Compared with a plain object, the extra value is named composition and enforcement. Compared with an entirely separate store, a slice can share the same transaction, patch log and history policy. A migration can target that named region without rewriting unrelated data. The precise contract is [§4.2](/spec#s4-2), not the top of the spec.

<span id="fsm" class="anchor"></span>

## FSM: constrain a slice's legal lifecycle

Consider saving a draft. Four unrelated booleans (`isSaving`, `isSaved`, `hasError`, `isIdle`) admit contradictory combinations. One discriminated `status` is already better. A finite-state machine adds an explicit set of legal transitions and makes invalid events observable.

**Working plain-slice equivalent:** no `fsm` export is needed to understand the behavior. This standalone example can run in the exact-source REPL:

```js
const transitions = {
  idle: { save: 'saving' },
  saving: { success: 'saved', failure: 'error' },
  saved: { save: 'saving' },
  error: { save: 'saving' },
};
let state = { status: 'idle', error: null };
function send(event) {
  const next = transitions[state.status][event.type];
  if (!next) return { accepted: false, state };
  state = { ...state, status: next, error: event.type === 'failure' ? event.message : null };
  return { accepted: true, state };
}
log(send({ type: 'save' }));       // accepted; saving
log(send({ type: 'save' }));       // rejected; still saving
log(send({ type: 'failure', message: 'Offline' })); // error
```

**Planned state-lib authoring sketch:** `fsm({ states, on })` describes a slice, not an independent actor runtime. The expanded shape below proposes explicit source/target constraints; it is not a claim that these options ship today.

```ts
// Proposed API; not a prototype export.
const saveFlow = fsm({
  initial: { status: 'idle', error: null },
  states: {
    idle: { save: 'saving' },
    saving: { success: 'saved', failure: 'error' },
    saved: { save: 'saving' },
    error: { save: 'saving' },
  },
  on: {
    save: (ctx, ev, enq) => ({ ...ctx, status: 'saving', error: null }),
    success: (ctx, ev, enq) => ({ ...ctx, status: 'saved' }),
    failure: (ctx, ev, enq) => ({ ...ctx, status: 'error', error: ev.message }),
  },
});
```

Read `(ctx, ev, enq) => next` as: inspect the current slice and a typed event, synchronously return the next value, and optionally enqueue post-commit work. The proposed transition map validates the event at the source state and the returned target state. A rejected transition makes no state patch. A successful transition goes through the **ordinary named command → transaction → patch/inverse patch** path. Devtools and history therefore observe the same artifacts as for a normal action; “no separate machine runtime” means no second scheduler/history/state copy, not “zero machine bookkeeping.”

Network work must not run inside a pure transition or during replay. A save task begins after commit under a scope; its result sends a separate `success`/`failure` event, with an attempt identity or supersession policy to reject a stale response. An undo restores state; it does not magically undo a completed HTTP request.

The callback shape comes from [@xstate/store](https://stately.ai/docs/xstate-store), whose transitions return context and can synchronously enqueue work. The `states` map above and state-lib's patch/command integration are **our proposal**, not native `@xstate/store` syntax. Use a full statechart runtime when hierarchy, parallel regions, actor orchestration and its established tooling matter; do not assume this slice primitive implements them. See [XState state machines](https://stately.ai/docs/machines).

Use a status field plus ordinary actions for a small local lifecycle. Use the proposed FSM slice when illegal transitions, auditability and generated diagrams justify an explicit graph. Use full statecharts for richer orchestration. `state migrate` is a planned **assisted migration**: it can propose a graph from observed status assignments, but cannot safely infer hidden business rules, concurrency or whether a historical invalid combination should be repaired. Review the graph, define a persisted-state migration and test replay. Contract: [§4.6](/spec#s4-6).

<span id="dag" class="anchor"></span>

## DAG: dependencies without cycles

DAG means **directed acyclic graph**. An arrow `A → B` here means “A imports B.” Optional persistence can depend on the core without the core depending back on persistence. This is more precise than rigid numbered layers, because two independent features may share a dependency without depending on each other.

```text
React adapter ──→ core
collections   ──→ core
optimistic    ──→ collections
outbox        ──→ optimistic
outbox        ──→ persistence
```

A cycle such as `core → outbox → core` defeats the intended small independent core and complicates initialization. Check import cycles and dependency boundaries mechanically. The compiler and CLI are build tools, not required runtime graph nodes. Architecture: [§3](/spec#s3).

<span id="als" class="anchor"></span>

## ALS: request-local state on the server

ALS is Node's **AsyncLocalStorage**, a facility for retrieving context associated with an asynchronous execution chain. It is useful for request-scoped stores during SSR: two requests must not share a global current-user store. It is not a browser global, a replacement for cancellation ownership, or a license to hide every dependency.

```ts
import { AsyncLocalStorage } from 'node:async_hooks'; // Node native
const requests = new AsyncLocalStorage();
async function renderRequest(requestId, render) {
  return requests.run({ requestId }, render);
}
// Code executing inside render can read requests.getStore().
```

Explicitly passing a request context works in every environment and is often easier to test. ALS can reduce plumbing where the host supports it; the proposed `state/ssr` adapter owns that dependency, never `core`. Source: [Node AsyncLocalStorage](https://nodejs.org/api/async_context.html#class-asynclocalstorage). Contract: [§7](/spec#s7).

<span id="transactions" class="anchor"></span>

## tx(): one consistent commit boundary

A transaction groups related synchronous writes. Without it, a subscriber might see `firstName` updated while `fullName` still reflects the old surname. The outermost transaction defines when dependent state and subscriptions can observe a consistent commit. It does not turn asynchronous network operations into one atomic transaction.

```js
const before = { quantity: 1, unitPrice: 10 };
// Conceptual atomic next snapshot: publish once, after both writes.
const next = { ...before, quantity: 3, unitPrice: 12 };
log({ before, next, total: next.quantity * next.unitPrice });
```

That runnable snippet illustrates a boundary, not a transaction implementation. The actual prototype `tx` and store action examples are in [API: tx](/api#api-tx) and the [read/write REPL](/repl/read-write). In the planned async action model, commit before the first `await`; subsequent writes need a new transaction. Contract: [§4.4](/spec#s4-4).

<span id="microtasks" class="anchor"></span>

## Microtask draining: later than commit, not “after the browser paints”

“Drained in a microtask” means queued listeners are processed after the current JavaScript stack unwinds, before the event loop proceeds to a later task. It is useful for separating the synchronous consistency path from commands triggered by listeners. It does **not** guarantee that React has committed DOM changes or that a frame has painted.

```js
log('write committed');
queueMicrotask(() => log('bus listeners drained'));
log('synchronous caller continues');
// write committed → synchronous caller continues → bus listeners drained
```

A microtask that continuously schedules more microtasks can starve rendering; use bounded iterations and a documented overflow policy. DOM measurements belong to the framework's appropriate post-render lifecycle, not an assumption about microtask timing. Source: [HTML event-loop processing model](https://html.spec.whatwg.org/multipage/webappapis.html#event-loop-processing-model). Contract: [§4.1](/spec#s4-1).

<span id="double-buffering" class="anchor"></span>

## Double buffering: a listener must not extend its own current batch

Keep two queues: a **current** batch being delivered and a **next** batch receiving events generated during delivery. Swap them at the declared boundary. This prevents a listener from splicing new events into the collection currently being iterated, and makes the ordering explainable.

```js
let pending = ['A', 'B'];
const current = pending;
pending = [];
for (const event of current) {
  log('current', event);
  if (event === 'A') pending.push('C');
}
log('next batch', pending); // C, never inserted between A and B
```

Double buffering alone does not prevent an infinite A→B→A reaction cycle. The runtime still needs attribution, limits and a failure policy. It is also not the same mechanism as double-buffering pixels in a renderer. Contract: [§4.6](/spec#s4-6).

<span id="caret-ime" class="anchor"></span>

## Caret and IME correctness: do not corrupt an unfinished edit

The caret is the insertion position. An input method editor (IME) can keep an uncommitted composition while the user enters characters. Treating every intermediate composition as a complete domain value, overwriting the input with formatted output or delaying a controlled-input echo can move the caret or destroy the composition.

Keep raw editing text and committed model value distinct. During composition, preserve the user's text and selection; defer normalization/validation that would replace that text until the appropriate commit boundary. A rejected parse should remain visible as an editing state rather than corrupting the last valid model value. Synchronous state updates are necessary for common React controlled-input patterns, but are not alone sufficient for composition, selection restoration or complex formatters.

Source: [React input troubleshooting](https://react.dev/reference/react-dom/components/input#my-input-caret-jumps-to-the-beginning-on-every-keystroke), [UI Events composition events](https://w3c.github.io/uievents/#events-compositionevents). Contracts: [§4.9](/spec#s4-9) and [conversion at two boundaries](/spec#s4-13-5).
