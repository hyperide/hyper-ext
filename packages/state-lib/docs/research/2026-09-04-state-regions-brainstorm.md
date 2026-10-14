# Brainstorm — semantic regions of state, and how to make them a benefit rather than a tax

**Date:** 2026-09-04 · **Status:** brainstorm, nothing decided · **Requirements:** R76 (primary), R77, R78, R79 · **Related:** §4.13 tiers, §4.14 layers, §8.5 persist, §8.9 retention

Asked for directly: how do we realise the split of state into semantic regions — business,
automations, UI, and probably one or two more — such that it is _useful_ rather than a tax; how
does an agent know when to recommend it; is a region a place in the tree or a property of a node;
and how does the orthogonal dimension of derived data compose with all of it.

---

## 0. The distinction that unlocks the rest

§4.14 already partitions **code** into four layers: business logic, automations, utilities, UI
logic. That is not the same question. This one is about partitioning **data**, and conflating the
two is the first mistake available. A single slice can be written by business logic and read by UI
logic; a UI-only field can be produced by an automation. Layers describe who may write; regions
describe what the data _is_ and therefore how it should be treated.

Keeping them separate also answers a smaller question that would otherwise bite: `utilities` is a
code layer with no data at all, and `automations` is a code layer that _does_ own data (its rules).
Four layers do not map onto four regions and should not be forced to.

## 1. What the regions actually are

Five, and the fifth and sixth are the ones not in the original list.

| Region         | What it holds                                                                                                          | The one-line test                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **domain**     | Entities and the business truth. Orders, documents, users.                                                             | If the server also knows it, or would want to, it is domain.                     |
| **session**    | Who is here and in what context: identity, permissions, feature flags, current workspace, connection status.           | Survives navigation, dies at logout, and no undo stack should ever contain it.   |
| **view**       | What is open, selected, scrolled, hovered, dragged, expanded, typed-and-not-yet-committed.                             | Delete it and the application is still correct; the user just loses their place. |
| **draft**      | Work in progress that has not become domain yet: the binding shadow (§12.5), the optimistic overlay, the outbox queue. | The user would be _angry_ if it vanished, but the server has not accepted it.    |
| **automation** | The rules users author (§4.14) plus their run history.                                                                 | It is user-authored configuration, so it is domain-shaped but about behaviour.   |
| **cache**      | What the server said and when, with freshness metadata.                                                                | Discardable without loss, re-fetchable, and never the source of truth.           |

`draft` is the region worth arguing for hardest, because it is the one every codebase has and none
names — and naming it is what makes R77 (never lose user input) a two-line policy instead of a
feature.

## 2. Why a region is worth declaring at all — the anti-tax argument

**A region is not a new concept. It is a name for a bundle of policy defaults that already exist
as individual options.** That single framing is the whole answer to "how is it not a tax".

Today a slice sets `persist`, `sync`, `events`, `history`, `transient` and `retain` one at a time.
Those settings are not independent in practice — they cluster, and the clusters are exactly the
regions:

|                | persist                  | sync                | command log | undo                   | evictable             | loss-protected |
| -------------- | ------------------------ | ------------------- | ----------- | ---------------------- | --------------------- | -------------- |
| **domain**     | yes                      | yes                 | yes         | yes                    | only with a tombstone | —              |
| **session**    | separately (token store) | no                  | no          | **never**              | no                    | —              |
| **view**       | no                       | no                  | no          | grouped, coalesced     | freely                | no             |
| **draft**      | **yes, crash-safe**      | not until committed | no          | as one entry on commit | **never**             | **yes**        |
| **automation** | yes                      | yes                 | yes         | yes                    | no                    | —              |
| **cache**      | optional                 | inbound only        | no          | no                     | **first to go**       | —              |

So `region: 'view'` replaces five option lines with one, and — more valuable — it makes the _next_
policy free: when §8.9 retention arrived, every `view` node already had a sensible eviction default
without anyone editing a slice. A project that declares nothing keeps setting options one by one,
exactly as now. Nothing breaks, nothing is required, and adopting the label is a strict reduction
in configuration. That is the shape a feature has to have to be adopted incrementally.

**The second benefit is legibility at a boundary.** Four questions get one-line answers instead of
an audit: what leaves this machine (domain + automation), what survives a reload (everything but
view), what a bug report may contain (not session), what a screenshot-to-Storybook capture (R75)
should include (domain + view, never session or draft).

## 3. Region is a property, not a place — and both readings can be true at once

The question posed was whether UI state lives in its own subtree or beside the data. The answer
that makes both work: **the region is a tag on the node; the location in the tree is free.**

If region were a location, changing a policy would require moving data, and colocation — the entire
point of a complex (§4.8) — would be in permanent tension with policy. So:

```ts
const order = defineComplex('order', {
  slices: {
    lines: collection(Line), // region: domain (inferred from having a source)
    selectedId: field(Id, { region: 'view' }), // lives beside the data it selects
    draftNote: field(Text, { region: 'draft' }), // protected from loss, not synced
  },
});
```

And then a **region view** gives the other reading for free, without a second copy:

```ts
store.region('view'); // a projection: every view-region node in the store, wherever it lives
store.region('draft'); // what would be lost right now if the tab closed
```

This is a derived index over node metadata, not a subtree, so the two readings never diverge. The
"aliases in chains" idea is the same mechanism from the other end: `order.$view.selectedId` reads
the region-filtered projection of that complex, and `order.selectedId` reads it in place. Same node,
two paths, no synchronisation problem, because there is only one node.

**The corollary worth stating:** the `/ui/...` subtree that §4.9 currently mandates for `useLocal`
becomes a _default placement_, not a rule. A component-scoped node is `view`-region wherever it
sits.

## 4. Derived is a third axis, and the composition rule falls out

There are now three orthogonal axes on a node, and it is worth being explicit that they are
orthogonal because two of them already exist:

- **Tier** (§4.13): `source` / `prepared` / `derived` — who may write it, and whether it is stored.
- **Region** (this document): domain / session / view / draft / automation / cache — how it is treated.
- **Layer** (§4.14): a property of _code_, not of data — listed only to say it is not an axis here.

A derived node has no region of its own; it **inherits, and the strictest input wins**. A computed
over domain data is domain. A computed over domain and view data is view — it must not be persisted
or synced, because it embeds a UI decision. A computed touching session is session and therefore
never appears in a bug report.

That rule is cheap to implement — the reactive graph already knows a computed's inputs, so the
region is derivable rather than declared — and it closes a real leak class: the derived value that
quietly carries session or view data into a payload because nobody thought about where it came
from. `state doctor` can report it as "this derived node is being persisted but reads a view-region
input", which is a bug people currently find in production.

**Ordering, strictest first:** session > draft > view > cache > automation > domain. Session is
strictest because it must never leave; domain is loosest because leaving is its job.

## 5. How the agent knows when to recommend the split

The recommendation has to come from something checkable, or it is taste with a robot's voice.
Three signals, all of which the analyser already has or can cheaply get:

1. **Convergent evidence.** A slice already sets four options that exactly match a region preset.
   The recommendation is then not "you should think about regions" but "these five lines are
   `region: 'view'`", with the diff. Mechanical, verifiable, and the developer can see the saving.
2. **Contradiction.** A node's settings straddle two presets — persisted but excluded from
   sync and absent from the command log. Either it is a genuine exception worth a comment, or it is
   a mistake. The agent asks; it does not assume.
3. **A payoff event.** The moment a project adds a feature whose implementation is a region query,
   the split starts paying and the recommendation should fire. Concretely: adding a bug-report
   attachment (needs "everything except session"), adding crash recovery (needs "the draft
   region"), adding multi-tab sync (needs "domain and automation only"), hitting a memory ceiling
   (needs "evict cache first, never draft"). Each of those is a detectable moment — a new dependency,
   a new call — not a vibe.

The rule this suggests for the skills we ship: **never recommend the split in the abstract.** Only
recommend it attached to a feature that is being built, and always with the diff that shrinks the
configuration rather than growing it.

## 6. R77 — never lose user input, and why it needs no new marking

The requirement asks how to mark what counts as user input. The answer is that we already do,
twice, and had not noticed:

- §12.5's binding **shadow** is, by construction, typed-and-not-committed. Every bound control has
  one.
- The optimistic overlay and the outbox (§4.11, §8.7) are accepted-locally-but-not-remotely.

Both are the `draft` region. So R77 becomes a policy on one region rather than a feature with its
own vocabulary:

```ts
retain: { region: 'draft', evict: 'never' },     // §8.9 already forbids evicting unsynced work
persist: { region: 'draft', where: 'indexeddb', debounce: 250, crashSafe: true },
```

and three behaviours hang off it: a `beforeunload` guard fires when the draft region is non-empty
(and _only_ then, which is what stops it becoming the dialog everybody clicks through); on reload,
drafts are restored and the user is told what was recovered rather than silently given stale text;
and the draft region is what a crash report should carry, since it is the part the user cannot
reproduce.

Worth naming as a hazard: draft persistence writes half-typed content to disk, which is a privacy
question and not only a durability one. Fields carrying secrets need `sensitive: true` in the
schema (§4.12 already has the slot) and must be excluded, and the exclusion must be the default for
anything typed into an input with `type="password"` — a rule the compiler can apply from the JSX,
without asking.

## 7. R78 — idempotency keys, and the trap in "action meaning hash"

The requirement is right and the shorthand is dangerous, so it is worth separating them.

**Right:** every command should carry a key that lets a receiver — the server, or our own outbox
replay — discard a duplicate. Offline is the motivating case (§8.7 replays a queue after reconnect,
and a reconnect that races an already-delivered request duplicates it), and §4.15 already found the
same need from the other direction: cancelling an in-flight mutation is unsolvable without one.

**The trap:** a key derived purely from the _meaning_ of the action — name plus arguments — makes
two genuinely distinct actions collide. "Transfer £10 to Bob" twice, on purpose, is two transfers,
and a meaning hash silently drops the second. In a banking context, which is the example given,
that is the worst possible failure direction.

**The shape that works:** the key is generated **once per invocation, at the call site**, and stays
stable across every retry of _that_ invocation. A ULID or UUIDv7 in the command record, not a hash
of its contents. That is Stripe's design and the reason it is worded as "idempotency key" rather
than "request hash".

A content hash still earns a place, but as a _different_ thing with a different job: a
**deduplication hint** for accidental double-submits within a short window — the same button
clicked twice in 300 ms. That is a client-side guard with a time bound, it is allowed to be wrong
in the safe direction, and it must never be the wire-level key. Two mechanisms, two names, and the
spec should refuse to let them share a field.

Second-order consequences worth checking before this is written up: the key has to survive
persistence (it lives in the outbox record, so it must be in the persisted shape), it has to be
stable across a replay from a recording (or replay itself duplicates), and the server contract has
to say how long keys are remembered — an idempotency key with no retention window is a promise
nobody can keep.

## 8. R79 — the component/state binding metadata, and the honest answer about wiring

The dislike expressed is of every available option: hooks inside components, `mapStateToProps`,
containers, prop drilling. That is not indecision — each really does have a defect, and it is worth
writing them down before proposing anything:

- **Hooks in the component**: the dependency is invisible from outside; you cannot see what a
  component needs without reading its body, and you cannot render it in a test or a story without
  standing up a store.
- **`mapStateToProps`**: separates the declaration from the use, so the two drift, and it made every
  connected component re-run on every dispatch, which is R1's original complaint.
- **Containers everywhere**: the dependency graph is real but scattered across a parallel tree of
  files nobody reads.
- **Prop drilling**: honest and explicit, and the cost is real churn through intermediate components
  that do not care.

The stated practice — grouping props into named objects by data slice and drilling _those_ — is
better than it sounds, and the reason is worth extracting: it makes each component's dependency
**a named thing** rather than a list of scalars, so the intermediate levels pass one prop instead of
seven, and the dependency is visible at every level it passes through. That is close to being a
declaration; it is just written by hand.

**So the proposal is to generate what that practice writes by hand.** A component declares its
dependency as a region-and-path set; the compiler emits the grouped prop object, the subscription,
or both:

```tsx
// the declaration is data the analyser reads
const Row = component({ needs: { line: order.lines.item, ui: order.$view } }, ({ line, ui }) => …)
```

What that buys beyond ergonomics, and this is the part R79 is really asking for: the manifest gains
a component→paths map, which is exactly §10.6's `components.subscribes`. From it, three things that
do not exist today: **blast radius** ("which components does changing this field affect", which is a
question about a codebase, not a runtime), a **lint** that a component's declared needs match its
actual reads, and a **generated grouped-props refactor** — `state migrate shape` can convert direct
hook wiring into declared needs plus drilling, which is the migration the requirement asks for.

**On the "global variable that the compiler turns into a subscription" idea:** it is real and has
precedent — Svelte's `$store` auto-subscription is exactly this, and Qwik erases `useContext` the
same way. It is the right answer for the _system-level_ case named: a handful of things nearly every
component needs (current user, theme, permissions, connection status). Application code writes
`session.user.name`, the compiler emits a precise subscription. The reason it should be confined to
that case rather than generalised: a global read is invisible in a component's signature, which is
the exact defect listed first above — acceptable for five well-known globals, corrosive for
everything else.

## 9. What to decide, in order

1. **The region list.** Six above; `cache` might collapse into `domain` with freshness metadata, and
   `automation` might collapse into `domain` since it is user-authored configuration. Fewer regions
   is better if nothing is lost.
2. **Whether the region is inferable often enough to be optional in practice.** If most slices get
   the right region from their existing options, the feature costs nothing to adopt. If they do not,
   it is a tax and should be reconsidered.
3. **The strictness ordering for derived inheritance** — proposed above, needs an adversarial pass
   for cases where "strictest wins" gives an unhelpful answer.
4. **Whether `region` and §4.13's `tier` should be one declaration or two.** They are genuinely
   orthogonal, but two annotations on every field is the tax this document is trying to avoid.
5. **R78's two mechanisms** — the per-invocation key and the short-window content hash — need
   separate names before either is written into §8.7.
