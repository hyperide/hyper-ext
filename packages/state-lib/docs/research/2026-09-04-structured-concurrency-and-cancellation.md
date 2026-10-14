# Research — structured concurrency, cancellation and async lifecycle in a global UI store

**Date:** 2026-09-04 · **Status:** advisory input, not decided · **Requirements:** R71, R72, R73, R74 · **Extends:** R59 (honest redux-saga review)

This document is the answer to a question put to a consulted model (Fable): _how does
structured concurrency relate to the design of a global UI state store?_ It was commissioned
after four capabilities were asked for as first-class citizens — async status lifecycle,
cancellation tokens with real request cancellation and parent→child cascade, a
page-transitions bridge, and keystroke input throttling.

**Its recommendations are input, not decisions.** Nothing here is binding until it appears in
`DECISIONS.md` or the master spec. The master spec's §19.6 carries the summary and links here.

---

## Summary

1. **Transaction ≠ task.** A transaction is synchronous, atomic, and already committed the
   instant it exists — there is nothing in it to cancel. The _task_ is the async thing that
   commits zero or many transactions over time. Almost everything else follows from keeping
   these separate.
2. **The command is the task root.** Route/page and component are parent scopes that commands
   nest under. Slice and query subscription are not lifetimes and must not own task trees.
3. **Cancellation is a status, not an undo.** A cancelled command stays in the command log with
   a terminal `cancelled` status. Rollback, where it happens, is compensation expressed as
   inverse patches attributed to that same command.
4. **Status and cancellation are one mechanism and belong in core.** Task tree / spawn /
   supervision is a compile-in-when-used layer. Keystroke throttling and the page-transitions
   bridge are two different things wearing one word and should not be folded into the task system.
5. **Steal from saga:** the fork tree with automatic child cancellation, `finally`-style cleanup,
   `takeLatest` as a declarative policy, `race`. **Do not steal:** generators as the mechanism,
   runtime effect interpretation, or the claim that the _body_ of an effect is data.

---

## 1. Which structured-concurrency guarantees transfer to a UI

**Scope-bound lifetime (no orphans)** — transfers fully, and matters most. The UI equivalent of
an orphan is the request that resolves after the user navigated away and writes into a slice
nobody is watching, or worse into one a _different_ page is now watching. Every frontend team has
fixed this with an `isMounted` flag. Structured concurrency is the principled version of that flag.

**Cancellation flows down the tree** — transfers fully. Its value on the frontend is not the
parent-cancels-fifty-children case (correctly identified as rare) but the trivial two-level case:
"the route scope ended, cancel the three fetches it started". The deep case comes free once the
two-level case exists — it is the same recursion, not extra work.

**Error propagation to the parent** — transfers only partially, **and the default flips**. On a
server a failed child usually means the request is dead: fail fast, cancel siblings, return 500.
In a UI one failed widget must not kill the page's other five. The UI default is Kotlin's
`SupervisorJob`: children fail independently, the parent observes but does not die. Fail-fast
becomes opt-in (an explicit `race` or `all` group). **Getting this backwards is the single most
common mistake when porting server structured concurrency to the client.**

**Join semantics** — transfers weakly. On a server, waiting for all children is what makes
cleanup sound. In a UI the parent frequently _cannot_ wait: a route change happens when the user
says so, not when the fetches drain. What survives: the parent must signal all children and run
their finalizers before the scope counts as closed, but must not block or delay navigation. So
cancellation is fire-and-forget from the UI's point of view, with a `settled` promise for whoever
genuinely needs the drain (tests, a "saving…" indicator).

**Does not transfer at all:** thread pools, blocking sections, cooperative yield points as a
scheduling concern. The browser has one thread and every `await` is already a yield point. Do not
build a scheduler.

## 2. What owns a task scope

- **Slice — no.** A slice partitions _data_, not lifetime; slices outlive every page. A slice-owned
  task is a global scope that never ends, which is "no structured concurrency" with extra steps. A
  slice may _host_ task state without owning task lifetimes.
- **Query subscription — no,** or rather already solved. A live query has subscribe/unsubscribe and
  the signal graph disposes it. Folding it into the task tree re-implements signal disposal with a
  second vocabulary.
- **Component lifetime — a parent scope, not the root.** Components are ephemeral and
  framework-specific; this library is framework-agnostic. Component scope is what adapters plug in
  (`useEffectScope()` in React, `onDestroy` in Svelte), each creating a child of the active route scope.
- **Route / page — the most useful parent scope in practice.** Nearly every real frontend
  cancellation is "navigation happened". Long-lived enough to mean something, ends at a well-defined moment.
- **Transaction — no, and this is the trap.** Our transaction is synchronous: begin, apply, emit
  patches, commit. It has no duration in which to be cancelled. Making it async (open at request
  start, commit at response) turns it into a distributed transaction with optimistic reads inside,
  which is the optimistic overlay reinvented badly. A task _emits_ transactions; it is not one.
- **Command (user intent) — yes, the root.** A command has a beginning ("user clicked save"), a
  duration, spawned work, and an outcome. It already exists in our command log. Command IDs become
  task IDs; the log entry gains a status and a parent pointer; the store gets a registry of
  everything in flight without inventing a concept.

**Resulting shape:** route scope ⊃ component scope (optional, adapter-provided) ⊃ command (task
root) ⊃ spawned children. A command with no enclosing scope attaches to an app/root scope — the "I
know what I am doing, this must survive navigation" case, which should be explicit rather than default.

The store hosts the task tree as a **registry of task state** (status, progress, parent links,
start time) in a system slice that is ordinary observable signal state. That is what makes the
status lifecycle nearly free: `command.status` is a signal like any other. What the store must not
do is make the _write path_ the scope — writes stay synchronous.

## 3. Redux-saga, honestly

**Steal:**

- **The fork tree with automatic child cancellation.** `fork` attaches a child to the parent;
  cancelling the parent cancels children; the parent does not complete until forked children do
  (`spawn` for detached). Correct in 2016, still correct.
- **`finally` as the cleanup hook.** A cancelled generator receives a return and its `finally`
  runs — cleanup lives where the code already is, with access to its locals, not in a separate registry.
- **`takeLatest` / `takeLeading` / `throttle` as named policies** — "latest wins, cancel the
  previous" as one word. Steal the vocabulary.
- **`race`** — the one place fail-fast group semantics is what you want, made explicit.
- **`yield cancelled()`** — asking "am I being cancelled?" inside `finally`, so cleanup can tell
  "done" from "aborted". Maps onto `signal.aborted`.

**Leave:**

- **Generators as the mechanism.** They existed so effects could be yielded as plain objects and
  interpreted by middleware — a _testing_ win, not a modelling win. The cost: a second,
  non-standard control flow TypeScript could not type (`yield call(f)` was `any` for years), no
  `async/await` interop, and a model that broke every developer who had not read the docs twice.
  `async` + `AbortSignal` covers ~95% of it, with types.
- **Runtime effect interpretation.** The middleware was a small interpreter running on every
  user's machine, and nothing about it could be compiled away — the opposite of a disappearing framework.
- **The illusion that the body is data.** Saga's yielded objects looked like data, but the
  _sequence_ of them was decided by a Turing-complete generator body. The effect tree could not be
  drawn statically because it only existed once the code ran. Effects-as-data was true
  per-instruction and false per-program.

**On "effects as data" being the good idea:** agreed, with one sharpening — draw the boundary of
what is data honestly. Genuinely data: the **trigger**, the **policy** (latest/leading/queue/race/
every), the **scope**, the **timeout**, the **cancellation-on** dependencies, and the **declared
outputs**. That is enough to visualise and to edit visually: a box, its inputs, its policy, its
outputs, its parent. Not data: the body — data-dependent branching and dynamic fan-out ("for each
selected file, upload it, then when all are done, commit").

**What structured concurrency needs that effects-as-data cannot express: dynamic child creation.**
The number and shape of children depend on runtime values. Accept the split: the declaration says
"this effect may spawn children" (which the compiler uses to decide whether to link the tree
runtime at all), and the body creates them.

## 4. Interaction with the mechanisms we already have

### Optimistic overlay

Two cases, which must be named differently in the docs because people conflate them.

**Case A — dependents inside the cancelled tree.** Task T writes optimistic patch P, spawns child
C which reads optimistic state and writes Q. Cancelling T cancels C, rolls back Q, then P —
reverse order of application, exactly what a finalizer stack gives. Clean.

**Case B — an independent later command read the optimistic state.** T writes P (item created with
a temp id). The user, seeing the item, issues command U editing it (Q references the temp id). T is
cancelled; Q now references an entity that never existed. **This is not fully solvable on the
client and the docs should say so** rather than pretend. Honest handling: rebase — re-apply Q
against state without P; if Q's target is gone, rebase fails, and the error surfaces on **U**, not
T, since U is the command whose intent is now unfulfillable. U goes to `error` with a
`dependency-cancelled` reason and its own optimistic patches roll back. TanStack DB's overlay
already does this for server rejections; cancellation is the same path with a different reason
code. Reuse it — do not build a second rollback mechanism.

### Command log and patch log

- **Does a cancelled command appear in the log?** Yes — the log records intent, and the user _did_
  ask. Cancellation is a **status transition on the existing entry** (`pending → cancelled`), not a
  new command. Recording "cancel" as its own command is tempting for symmetry but makes replay
  ambiguous and pollutes the log with meta-operations. One exception: an explicit user cancel
  gesture (clicking "Cancel upload") is itself an intent and may be a command whose effect is to
  transition another command's status.
- **Does cancellation emit patches?** Only if compensation runs. Rollback emits inverse patches
  attributed to the same command ID; a task that wrote nothing produces none. **Recommendation:
  group patches by command ID** so a command's effects can be popped as a unit — needed for undo
  grouping anyway.
- **Undo of a half-finished cancelled task.** After cancellation the command is terminal; undo sees
  the residue, which is usually nothing. Undo must never target a `pending` task — the answer to
  "undo a running task" is "cancel it first", and the UI should say so.

### Offline outbox

- **Cancelled while queued (never sent)** — clean, and the case where cancellation is _most_ useful
  on the frontend: drop from the outbox, roll back the overlay, mark `cancelled`.
- **Cancelled while in flight** — not solvable client-side, and we should not pretend. Either the
  mutation carries an idempotency key and the client issues a compensating request, or we accept
  the ambiguity, mark it cancelled locally, and let the next sync reconcile. Document the latter as
  default, the former as what you do when it matters. This is also TanStack Query's position.
- Edge: cancelling a queued mutation a _later_ queued one depends on (create then update, both
  queued) is Case B, offline. Rebase the later one; on failure fail it with `dependency-cancelled`.

### Undo versus cancel

Distinct, and to be kept distinct. Undo reverses _completed_ effects of a _finished_ command by
replaying inverse patches; cancel stops _in-progress_ work and may emit inverse patches as a side
effect. They share the patch-log machinery, not the semantics: undo has a redo, cancel does not
(you re-issue the command); undo moves a cursor in history, cancel transitions a status. Merging
them yields a history cursor that can point at a running task, and everything downstream becomes conditional.

### AbortController / AbortSignal

**Sufficient as the leaf wire format, and we should use it as such** — `fetch`, event listeners
(`{ signal }`), timeout wrappers, WebSocket close, stream cancel all speak `AbortSignal`. A token
that is not an `AbortSignal` is a token converted at every boundary. `AbortSignal.any([...])`
(Chrome 116, Firefox 124, Safari 17.4) is the native tree primitive: parent→child propagation in one line.

Where it falls short, and what our runtime must add:

- **No join** — the signal says cancellation was requested, not that the task finished cancelling.
  We need a settled promise per task.
- **No finalizer ordering** — `addEventListener('abort')` fires in registration order; cleanup
  wants LIFO. Keep our own stack.
- **No non-cancellable sections** — saga's shield ("I am mid-commit, do not interrupt") has no
  native equivalent. Needs `shield(fn)`.
- **No status or progress** — the signal is binary; status lives in the registry.
- **Reason typing** — `signal.reason` is `any`. Define a `CancelReason` union (`user`,
  `scope-ended`, `superseded`, `timeout`, `dependency-cancelled`) and always abort with one; the
  visualiser and the agent both need to know _why_.
- **Accidentally uncatchable** — `AbortError` makes every `catch` distinguish it from real errors.
  Provide the discrimination helper once and swallow abort errors at the task boundary so they
  never surface as `error` status.

## 5. Are the four asks one mechanism?

**Status lifecycle + cancellation — one mechanism.** `cancelled` is a terminal status in the same
machine as `pending / loading / success / error`; the signal is the mechanism for one transition.
`progress` is a numeric sub-field of `loading` written via a `progress()` callback — not a separate
status and not a stream. **And the task status machine should be an instance of our existing
`fsm()` primitive**, not a parallel hand-rolled one: visualisation comes free and it proves the
primitive on a real consumer.

**Keystroke throttling — two things, split them.**

- _Input scheduling_ (debounce/throttle): deciding whether and when to start a task from a stream
  of input events. No task exists yet. A signal operator or a trigger option; pure timing, compiles
  to a `setTimeout`, nothing to do with concurrency.
- _Supersession_ ("latest wins, cancel the previous"): a task **policy** — this _is_ concurrency,
  and it is the `takeLatest` we are stealing.

Most search boxes want both (debounce 300 ms, then latest-wins on the request). They compose. Unify
them and you get "why does my debounce cancel my requests" and "why does my latest-wins delay my input".

**Page-transitions bridge — also two things.**

- _Route scope ending_: the previous route's scope closes, its commands cancel with reason
  `scope-ended`, optimistic residue rolls back. This is structured concurrency and is the core of it.
- _The bridge_ to `useTransition` / View Transitions: that is **render scheduling** — an adapter
  concern, not a store concern. The store's contribution is exposing `routeScope.pending` as a
  signal so the adapter can drive `isPending`. Do not put React's transition model in the store.

**So: two mechanisms, not four and not one.** (a) Task lifecycle — status + cancellation + scope +
policy. (b) Everything else is either a signal operator (debounce) or an adapter (transitions bridge).

## 6. Prior art — structured (enforced) versus conventional (you are merely supposed to)

**Swift** — structured. `async let` / `TaskGroup` children cannot outlive their scope; the compiler
enforces it. Cancellation is cooperative, which is right for UI too. `Task.detached` is the
explicit escape hatch — steal the naming convention that the unstructured thing should look
unusual. Actors and isolation solve data races we do not have.

**Kotlin coroutines** — structured, and the richest source. `viewModelScope` / `lifecycleScope` are
exactly "route scope" and "component scope": pre-made scopes tied to platform lifetimes, and the
single most successful piece of that API. `SupervisorJob` is the children-fail-independently
default argued for above — Kotlin made it opt-in and Android developers spent years learning to
always opt in, so **make it our default**. Cooperative cancellation via `isActive`/`ensureActive()`;
`withContext(NonCancellable)` is the shield. Also copy: `CancellationException` is filtered out
before user error handlers see it.

**Trio nurseries and cancel scopes** — structured, and the cleanest concepts, because it separates
two ideas others merge: the **nursery** (a task group whose children must finish before the block
exits) and the **cancel scope** (a lexical region that can be cancelled together, including things
that are not tasks — a single `await` can sit in one). That decoupling is what expresses "timeout on
this block" without spawning. For us: `scope` (owns lifetime) and `cancelScope`/`withTimeout`
(bounds a region) should be separable. Trio's other lesson: cancellation via exception propagating
through `finally` is the least surprising mechanism in a language with exceptions, which JS is.

**Effect-TS fibers** — structured and the most complete: interruption, `uninterruptible` regions,
`ensuring` finalizers, `Scope` as a first-class resource, typed errors versus defects. Gets right
that **interruption is a third outcome** distinct from success and failure, and the types know it.
Do not copy the whole: its runtime is a fiber scheduler with its own effect interpreter — the saga
interpreter with better types, and 50–100 kB of irreducible runtime. Correct for a full effect
system, wrong for a disappearing framework.

**Go `context.Context`** — conventional, and the cautionary tale. The idea is right; the ergonomics
failed because it is threaded by hand as the first parameter of every function (forgetting it is
silent and common), because it is unstructured (nothing ties a goroutine's lifetime to it), and
because it doubles as a grab-bag for request-scoped values. Lesson: the signal must be **ambient
within a task** (on the context object, not hand-threaded through every helper), there must be a
real registry so orphans are visible, and arbitrary values must not live on the scope.

**React Suspense / transitions** — not concurrency, render scheduling. `startTransition` marks an
update low-priority so React can interrupt _rendering_; there is no task and no cancellation of
your fetch. Suspense throws a promise and re-renders when it settles; the fetch is never cancelled
on unmount. Steal the _UX_ (stale content stays visible, `isPending` for spinners) via the adapter,
not the model.

**TanStack Query** — conventional, with a good refcount. Cancellation is observer-driven: when the
last observer unmounts the in-flight fetch is aborted via the signal passed to `queryFn` — _if_ the
`queryFn` bothered to use it. That "if" is the conventional part. Steal the refcounted observer
scope and the explicit `cancelQueries()` that also reverts optimistic updates. Note what it does
not solve: mutations are not cancellable at all, which leaves the in-flight-outbox case open there too.

**RxJS** — structured for _subscriptions_ (teardown always runs on unsubscribe; `switchMap` is
exactly latest-wins) but not for _tasks_ (an Observable has no notion of children spawned inside a
handler). `switchMap` / `exhaustMap` / `concatMap` / `mergeMap` are the canonical names for the four
policies — latest / leading / queue / every. Use the semantics, pick nicer names.

**Two things to steal above all: Kotlin's supervisor default, and Trio's separation of
scope-as-lifetime from cancel-scope-as-region.**

## 7. The honest cost

**Irreducible runtime, once any async effect exists:** a task registry (command ID →
`{ status, parent, controller, finalizers, settled }`, roughly 40 lines); the status machine (an
`fsm()` instance, so shared with what we already ship); an `AbortController` per task plus
`AbortSignal.any` for the parent link; a LIFO finalizer stack and `shield()`; the abort-error filter
at the task boundary. **Estimate 1.5–3 kB minified including tree support.** Small, not zero, and
paid by every user forever.

**Compiles away:** debounce/throttle (a `setTimeout` inlined at the trigger site); policies
(`latest` is one inlined `if (current) current.cancel()`, `every` is nothing); route scope (with a
known router adapter, scope open/close emitted at route boundaries with no generic tree walk); and
crucially **tree support** — if no effect body in the project calls `spawn`, the parent-pointer
logic and the `AbortSignal.any` link are dead code and get dropped. That is the key trick: the
_declaration_ states whether the body spawns, and the compiler links the tree runtime only when at
least one does.

**Cannot compile away:** the status registry (if anything observes `command.status` — which is the
entire point of the first ask) and the per-task `AbortController` (the leaf format has to exist for
`fetch` to receive it).

**Conceptual load** for a developer who never cancels anything: `{ signal }` in the effect context
(passed to `fetch` because the docs say so) and `command.status` on the read side. Not more than
TanStack Query asks today. Tree, `spawn`, `shield`, reasons — invisible until needed.

**First-class or optional module?** First-class for status + cancellation + scope + policy: this is
the mechanism every async effect uses whether the developer thinks about it or not, and making it
optional means every project ships the orphan bug. Tree/spawn/supervision should be **first-class in
the API** (in the context object, so the agent sees it) but **zero-cost when unused** via the
compiler. "Optional module" in the import sense is the wrong axis — it makes the capability
invisible to an agent, which is the one requirement explicitly named. The right axis is _declared in
the type, linked when used_. And: deep trees are indeed rare, but the **two-level case (scope ends →
cancel its fetches) is common, and it is the same code**.

## 8. Recommended API shape

```ts
const searchProducts = effect({
  on: products.query, // trigger: a signal, a command, or an event
  debounce: 300, // input scheduling — compiles to setTimeout
  policy: 'latest', // 'latest' | 'leading' | 'queue' | 'every'
  scope: 'route', // 'route' | 'app' | explicit Scope; default 'route'
  timeout: 10_000, // optional cancel scope over the whole body
  writes: [products.results], // declared outputs — for the analyser, not runtime-enforced
  run: async (ctx, query) => {
    const res = await api.search(query, { signal: ctx.signal });
    ctx.progress(0.5);
    products.results.set(res); // a normal synchronous transaction
  },
});
```

The `ctx` object is deliberately where the whole capability surface lives, so it is discoverable by
an agent reading the type:

```ts
interface EffectContext {
  signal: AbortSignal; // the leaf wire format
  reason: () => CancelReason | null; // why, if cancelled
  progress: (n: number, info?: unknown) => void;
  spawn: <T>(fn: (child: EffectContext) => Promise<T>, opts?: { detached?: boolean }) => Task<T>;
  all: <T>(tasks: Task<T>[]) => Promise<T[]>; // fail-fast group, cancels siblings
  race: <T>(tasks: Task<T>[]) => Promise<T>; // first wins, cancels the rest
  shield: <T>(fn: () => Promise<T>) => Promise<T>; // non-cancellable region
  onCancel: (fn: () => void) => void; // LIFO finalizer
}
```

Read side, on the command log entry:

```ts
command.status    // Signal<'pending' | 'loading' | 'success' | 'error' | 'cancelled'>
command.progress  // Signal<number | null>
command.error     // Signal<unknown | null>
command.cancel(reason?: CancelReason): void
command.settled   // Promise<void> — resolves after all finalizers have run
```

Scopes:

```ts
const scope = createScope(parent?)   // { spawn, cancel, settled, pending: Signal<boolean> }
router.onLeave(route => route.scope.cancel('scope-ended'))   // the adapter does this
```

Semantic defaults, stated once: children fail independently (supervisor); cancellation is
cooperative; abort errors never become `error` status; a cancelled command keeps its log entry;
compensation is inverse patches attributed to the same command ID; `all` and `race` are the only
fail-fast groups.

**Deliberately not built:** generators or any custom control flow (`async/await` + `AbortSignal`);
a scheduler or priority system (one thread, one event loop — `scheduler.postTask` in your own body
if you need it); a general fiber runtime (Effect-TS exists, do not reimplement it with fewer
types); custom cancellation tokens (`AbortSignal` or nothing); retry/backoff in core (a helper
taking `ctx.signal`, not an effect option that grows into a config DSL); cancellable transactions
(synchronous and atomic, ever); cancel-as-a-command in the log (except the explicit user gesture);
a React-transition model inside the store (expose `scope.pending`, let the adapter drive it);
server-side compensation for in-flight outbox mutations (provide the idempotency-key hook, document
the ambiguity, do not pretend to solve it).

## 9. Stated uncertainty

Whether `scope: 'route'` should be the default, or the default should be "nearest enclosing scope,
else app". The former is safer against the orphan bug; the latter is less surprising for library
code running outside any route. The lean is towards nearest-enclosing plus a lint rule flagging
effects that resolve to app scope without saying so — but that depends on how much of the router
the compiler can see, which was not verifiable from outside our adapters.
