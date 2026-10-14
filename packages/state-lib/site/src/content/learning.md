# Reactivity, synchronisation and readable documentation

This guide separates an algorithm, its scheduling policy, and the product guarantees built on top. The state implementation on this site is a runnable **prototype**, not the published production library. Protocol laboratories are **deterministic teaching models**. The separately labelled HTTP reader makes real requests only after you configure an authorised endpoint. Research checked against the primary sources below on **8 September 2026**.

## Lazy derivation does not mean a sleeping UI

Consider `price → total → UI`. The UI has already read `total`, so a dependency edge exists. Changing `price` does not have to eagerly recompute every reachable derived value, but it must propagate invalidation far enough to discover the subscribed consumer.

The sequence is: **write the source → mark affected dependencies → schedule/check a subscribed consumer → pull the inputs it needs → notify/render if its observed result changed**. During the pull, a derived node checks its dependencies before returning a value. An unobserved computed has nobody asking for its value, so its expensive calculation can remain unevaluated indefinitely. A computed read by the UI is observed: the UI subscription is the reason a pull happens without another user action.

There are two related implementation choices. An effect runner can pull dependencies before deciding whether to invoke the effect body. A framework adapter can arrange a snapshot check when invalidated. Neither requires computing all unobserved derived values. React's eventual commit/paint is a separate scheduler decision; a state notification is not a promise that the DOM or pixels changed synchronously inside `set()`.

A useful equality optimisation is `temperature → isFreezing → UI`. Changing 10 to 11 invalidates the path, but `isFreezing` stays `false`. The graph checks the computed and can skip the downstream effect/render. The computation checking for equality is work, even though the UI body is skipped. This is not “zero work”.

[Try: lazy versus observed computation](/repl/lazy-ui). Step through subscriber creation, a write, and an explicit read of the unused computed. The live signal controls use the same objects; inspection does not secretly evaluate an unused derive.

Prior art: [Preact signals and effects](https://preactjs.com/guide/v10/signals/), [Preact's implementation discussion](https://preactjs.com/blog/signal-boosting/). “Converged algorithm” is descriptive shorthand for related push–pull designs, **not one universally standardised algorithm or a claim that every framework uses identical scheduling**.

## One write and two writes are different consistency problems

A diamond has `a → left → sum` and `a → right → sum`. After **one** write to `a`, a correct graph implementation invalidates both branches before a consumer can run. Pulling `sum` brings both required branches up to date. A consumer must not get new-left + old-right just because one branch happened to be visited first. That is the single-write glitch-freedom problem.

[Try: one write through a diamond](/repl/diamond). Starting at 1 gives 2 + 3 = 5; setting 2 gives 4 + 6 = 10, not the mixed 7 or 8.

Now consider an invoice with two independent source signals, quantity 1 and unit price 100. The application intends to change them to quantity 2 and unit price 80. An immediate subscriber can see:

| Boundary | Quantity | Price | Total |
|---|---:|---:|---:|
| Initially | 1 | 100 | 100 |
| After the first completed write | 2 | 100 | 200 |
| After the second completed write | 2 | 80 | 160 |

The intermediate 200 is **not a broken derivation**: it is correct for the source state that actually existed between those two writes. The reactive graph cannot infer that two ordinary calls belong to one business operation. There need not be another thread, a timer, an `await`, or a browser paint: a synchronous subscriber can run inside the first setter.

This occurs accidentally in ordinary application code: changing a filter and then resetting its page; switching an account and then its selected project; updating an amount and then its currency; setting a selected ID before loading the associated form. An immediate subscriber that sends a request, records analytics or persists state can act on that intermediate combination. React might batch its renders and never visibly paint it, while a non-React subscriber already used it. A screenshot alone therefore cannot test this guarantee.

[Try: the two writes without batching](/repl/writes-unbatched). Expected subscriber history: 100, 200, 160. Compare it with the next example using the same inputs and observer.

## What a two-phase batch actually guarantees

Use push–pull **with** an explicit notification boundary, not a different replacement algorithm. The first phase applies the writes and marks dependencies. The second phase, after the outer synchronous batch completes, lets pending observers check/pull the final state and publishes the resulting changes. An observer shared by the writes is deduplicated. Unobserved derives can remain lazy even after the batch.

[Try: batch with an intentional intermediate read](/repl/writes-batched). The subscriber history is 100, 160. Inside the transaction body, the example deliberately reads `total()` after updating quantity and before updating price: that direct read returns **200**. Batching delays scheduled observers; it does not make arbitrary code inside the transaction unable to inspect its current edits.

This distinction prevents several false guarantees:

- The prototype's `tx()` is synchronous notification batching. It is **not rollback**, serialisable database isolation, or a distributed two-phase commit protocol.
- Writes after an `await` are a later synchronous segment. Wrap each coherent result update in its own transaction; do not assume `tx(async () => …)` holds a global transaction open safely across requests.
- “Flush in a microtask” describes **when observers are serviced**. It does not, by itself, say that direct source reads return an old snapshot. A double-buffered design may offer that extra rule, but must specify it separately.
- An effect that writes more state can schedule more work. “At most once” applies to a settled, non-feedback notification pass, not to an arbitrary self-updating effect forever.

A microtask-coalesced default is a useful ergonomic policy, but it still cannot discover a transaction crossing a timer/network response, or prevent an explicit read between setters. An explicit transaction communicates intent and works independently of a renderer's batching. For data that must always travel together, a single aggregate write may also be simpler than independently writable fields.

Lineage: [Preact batch](https://preactjs.com/guide/v10/signals/#batchfn) documents deferred reactions and reads inside batches; [MobX actions](https://mobx.js.org/actions.html) document transaction boundaries for reactions. This site no longer equates Svelte/Solid/Preact/Vue flush timing or read isolation: those are version-specific contracts, not interchangeable labels.

## Electric is a read synchronisation protocol, not “large downloads”

Electric maintains a **selected local representation of Postgres data**. A shape defines the relevant root table, row filter and columns. It is valuable when that representation should stay current as other clients or services change it, not just when there are many rows. A shared board containing twenty tasks already has update/delete/reconnect problems.

Initial data and later changes solve different jobs. The initial snapshot gives the client a starting state. Later log entries add, update or remove keyed records, including records with old IDs and records that leave the filter. The protocol maintains a meaningful boundary between a snapshot and subsequent changes so an edit made while initial loading is underway is not silently lost.

The current shape model has a single root table and supports filtering based on related data through supported subqueries. Do not translate “shape” into “an arbitrary SQL join result with every server query feature”. For local joined/derived views, client-side query engines and synchronisation adapters form another layer. See the [shape guide](https://electric.ax/docs/sync/guides/shapes) and [TanStack DB integration](https://electric.ax/docs/sync/integrations/tanstack).

### Why raw SSE is not the same alternative

SSE carries server-to-client events. By itself it does not define a consistent initial snapshot, how a predicate's membership changes, durable retention, how a delete becomes a local removal, or when an old checkpoint is invalid. You can implement all of those over SSE; at that point the comparison is your custom sync system against Electric, not two equivalent transport APIs.

Electric **already supports SSE**, using `live=true` and `live_sse=true`, as well as long-polling. SSE can reduce repeated request overhead; caching and proxy behaviour differ. A proxy that buffers the entire response is unsuitable for live SSE. The server and SDK still implement the shape semantics above that transport.

For an ephemeral typing indicator, a job-progress percentage or a one-way notification that need not reconstruct a dataset, a small SSE endpoint may be entirely sufficient. For a replicated collection that must survive missed updates and deletions, specify the missing guarantees before choosing the simpler implementation.

### A log checkpoint is not the last record ID

Record-ID/keyset pagination answers “which rows come after this row in an ordering?”. A sync checkpoint answers “which changes have I incorporated from this particular history?”. Deleting record 2 while the client is offline must be delivered even if its last loaded record was 900. Asking for records after 900 cannot communicate that deletion.

The real protocol uses a **shape handle plus an offset**, not the educational model's small integer or a row ID. `offset=-1` starts initial loading. Responses supply continuation metadata; `up-to-date` means current through the server's response boundary, not guaranteed current forever. `must-refetch`/HTTP 409 requires discarding the incompatible local shape and resynchronising. Persist a checkpoint together with the materialised data it describes; a checkpoint alone is not a replica.

[Try: reconnect with an old-ID delete](/repl/sync-resume). [Try: expired history and refetch](/repl/sync-reset). Repeat delivery in the model to distinguish an idempotent keyed materialisation from arbitrary side effects such as incrementing a counter for every received event. There is no blanket “nothing can ever be duplicated” guarantee.

### Chunks, progressive display and on-demand subsets

Large initial logs can span multiple responses. Progressively displaying arrived rows is a **presentation policy**, not evidence that the shape is complete. A subtotal computed over the first chunk is not the total for the whole shape. The model lets you choose staged publication or progressive display with an explicit incomplete marker.

[Try: loading while the server changes](/repl/sync-large). Change a server row between snapshot chunks; finish the snapshot, then catch up the log. The fixture has forty synthetic server rows, not a claimed large-scale benchmark.

Chunking an entire selected shape and loading only requested subsets are different. Current Electric also documents changes-only logs and **subset snapshots**, with snapshot metadata used to reconcile overlap with the change stream. Subset snapshots are not implemented by this site's minimal HTTP reader or the simple model. Consult the official SDK and [HTTP API](https://electric.ax/docs/sync/api/http) for that protocol rather than extending the illustrative integer cursor into a production client.

### CDN sharing is useful, but not the only reason

Equivalent authorised requests for the same shape/history/chunk can reuse cache entries; compatible live long-poll requests can be collapsed. A public latest-price board or a catalogue category shared by many readers is a plausible application. A tenant-specific board can also share within its access boundary. Unrelated personalised shapes are not magically one reusable response.

Authorisation must happen at the backend/proxy before serving protected data, and cache keys/headers must preserve those access boundaries. Do not put an administrator token into the REPL or globally cache private responses. A current-price materialisation is also not automatically a complete tick history, an exchange-grade feed, or a latency guarantee. See [Electric authentication](https://electric.ax/docs/sync/guides/auth) and the caching section of the HTTP API.

### Which scenario should I try?

| Situation | What it teaches | Playground |
|---|---|---|
| Shared project board | Changes to a small collection matter; moving a row outside the shape removes it | [Board](/repl/sync-kanban) |
| Catalogue category | Selected local data can be searched without another round trip once available | [Catalogue](/repl/sync-catalog) |
| Public latest-price board | Shared state is plausible for cache reuse; ticks and benchmarks are not simulated | [Latest values](/repl/sync-quotes) |
| Chunked initial load | Partial display versus complete-state publication; update during loading | [Chunks](/repl/sync-large) |
| A disconnected client | Old-ID update/delete, retained checkpoint, repeat delivery | [Reconnect](/repl/sync-resume) |
| Server history recreated | Invalid handle; discard and rebuild rather than silently skip | [Refetch](/repl/sync-reset) |

All six have a server/client visualisation, editable server rows, chunk controls, connection state and event trace. They deliberately perform **no network I/O** and do not claim to execute Electric's implementation. [The real HTTP exercise](/repl/electric-http) instead lets you configure an authorised endpoint and inspect actual messages. It is read-only, does not bundle Postgres, and does not implement the production SDK's retry/persistence/subset/transaction-coordination coverage. After stopping its SSE display it starts a fresh snapshot instead of inventing a resumable event ID.

Electric's read path does not implement application write validation or conflict policy. Those belong to your write API and, where needed, an optimistic overlay/outbox. In the intended architecture, state-lib manages local reactive state, lifecycle and user intent; an Electric adapter supplies confirmed remote data. Danny's proposed local query engine addresses the query/materialisation layer; no claim about its unprovided implementation is needed to explain this separation.

## Three artefacts means three views of one action

[Try: snapshot, change record and intent](/repl/read-write). The author declares an action called `todos.toggle`, then invokes it once. The UI shows: **(1) resulting snapshot; (2) change record with forward and inverse patches; (3) named intent**. The inverse belongs to the change-record category, which is why four printed lines still describe three categories. The command name comes from the declaration: the runtime did not infer business meaning from a boolean assignment.

A snapshot answers “what is the current state?”. A patch answers “what changed, and how can this local change be reversed?”. A named command answers “which declared operation caused it?”. These are useful for inspection and history, but they do not alone prove distributed undo or offline replay correct. Also, this prototype makes detached snapshot copies; production structural-sharing ambitions are not evidence that these copies are structurally shared.

## Regions: known ingredients, explicit local policy

There is no defensible single inventor of “classifying state by ownership and lifetime”. These are distinct predecessors: [React state lifetime follows component identity](https://react.dev/learn/preserving-and-resetting-state); [MobX-state-tree volatile state](https://mobx-state-tree.js.org/concepts/volatiles) separates temporary instance state from snapshots; [Redux persistence black/whitelists](https://github.com/rt2zz/redux-persist#blacklist--whitelist) select retained parts. These precedents are related ingredients, not claims that any of them ships state-lib's four-tag API.

Our `domain`, `view`, `session`, `draft` names compose those policy decisions. They are **not** memory-allocation regions, nor do labels themselves implement expiry, permission checks or remote synchronisation. In this prototype, region-aware persistence filtering is implemented; other policies must have their own implementation and tests.

[Try: inline region declarations](/repl/regions). Write `ui: region.view({ panelOpen: false })` beside the data, rather than maintaining a second pointer map. Markers are unwrapped during initialisation: reading `store.state.ui.panelOpen` yields the ordinary value. Existing pointer-map options remain available for migration and override the same declared path. Path matching respects segment boundaries: `/ui` does not cover `/uint`.

Regions, persistence and optimism are related but **not one feature**. Regions classify a lifetime/ownership scope. Persistence determines what survives and in which representation. Optimism separates tentative intent from confirmed data until success/failure. A view-only drag preview may be optimistic but not persisted; a durable preference may be persisted without being optimistic; an offline draft can need both local retention and later validation. The REPL now lists these as separate task groups, rather than burying all three under “Policy”.

## Two boundaries apply to more than dates

A domain value, its wire representation and its display/editor representation need not be the same type. Date is one worked example, not the definition of the feature.

| Domain value | Storage/wire contract | Editor/display contract |
|---|---|---|
| Money amount | Explicit currency plus agreed precision, for example integer minor units | Locale-dependent decimal/group separators; temporarily incomplete input |
| Date/time | Explicit instant or date-only contract, not an ambiguous formatted label | Locale and time-zone presentation |
| Physical quantity | Canonical value plus defined unit semantics | User-selected units and precision |
| Enum/reference | Stable code or identifier | Translated label or editable search text |
| Structured document | Versioned data structure | Rich-text presentation and intermediate editor state |

A codec handles the domain ↔ wire boundary. A presenter/parser handles the domain ↔ UI boundary, including incomplete or invalid editing text. Changing locale should not rewrite saved data. Saving a half-typed minus sign as a valid domain number would be a different bug. Do not silently replace a domain value when parsing fails.

[Try: the Date example and locale changes](/repl/conversion). It demonstrates the split; it is not a claim that money, units or rich text are already implemented as built-in types. Background on the display side: [ECMAScript internationalisation API](https://tc39.es/ecma402/).

## Reading, copying and running this documentation

The served build now prerenders every manifest route into real HTML. A client can read headings, tables, explanations and example source without running JavaScript. React adds interactions in the browser. Each page also has a generated `.md` representation, with a small `/llms.txt` index and an optional full-text `/llms-full.txt` corpus. The Copy page dropdown offers Markdown, a page link and both text entry points. It does not send your current code or data to an AI service.

This follows the [llms.txt proposal](https://llmstxt.org/) and [documentation-platform contextual menus](https://www.mintlify.com/docs/ai/contextual-menu), not a mandatory browser standard. Standard alternate/describedby link relations advertise the Markdown and index. Explicit `.md` URLs work without content negotiation; this static build does **not** claim `Accept: text/markdown` negotiation on arbitrary HTML routes.

Step really executes one next top-level statement and pauses. Run proceeds without inserting an artificial `await` between synchronous statements. Earlier frames are immutable records; scrubbing them is not reverse execution of network requests, timers or the live UI. Reset cancels owned resources and restores the example. Scaffolding is initialised as a unit before the first step; step inside that setup by moving the relevant statement into the main program.

Every example has its custom product UI or a shared live-bindings workbench. The JSX editor now uses the same static API hints as the program editor, with labels for React/native HTML/REPL helpers. This is not a full TypeScript language server, and top-level tracing cannot reveal a value scoped only inside a component event callback.

Diagram expansion offers pan, wheel/pinch/button zoom, fit, rotation, a caption and gallery navigation. A narrow touch device requests fullscreen/landscape when permitted. A non-maximised desktop window can request a separate screen-sized popup; blocked popups fall back to the full-page viewer. Browsers control actual popup geometry and orientation/fullscreen permissions, so manual rotation and the in-page viewer remain available. References: [window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open), [Fullscreen](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen), [orientation lock](https://developer.mozilla.org/en-US/docs/Web/API/ScreenOrientation/lock).


## Runtime implementation and verification status

There is now a separate synchronous TypeScript reference kernel, in addition to this
site's larger API prototype. It implements staged transactions with nested savepoints,
lazy derives and post-commit notifications. Equality validation reads the staged snapshot
without poisoning committed caches; root disposal handles dynamically ordered graphs.
The normal verification command includes strict callback type contracts, adversarial
regressions and seeded differential event streams against from-scratch evaluation.

This is tested reference code, **not a formally proved production StateIR runtime**.
Signal objects are still caller-owned references; immutable structural snapshots,
compiled event boundaries, collection IVM and the native Rust/Verus backend remain
separate implementation steps. The API examples on this page still run against the
explicitly labelled site prototype. Test coverage does not imply compiler correctness,
framework correctness or a universal speed advantage over ordinary JavaScript.
