# Query syntax, TanStack DB and the state query boundary

Status: researched design and executable value-equivalence fixtures, not a performance result. Reviewed 2026-09-08. The site fixture uses **@tanstack/db 0.8.7**, whose installed dependency is **@tanstack/db-ivm 0.1.19**. Package versions are pinned by the site lockfile; examples must be retested when it changes.

## Three questions that must not be conflated

1. **How do I express a computation?** Array methods, jq, a fluent SQL-like builder, Datalog rules and functional pipelines answer this question.
2. **How do I update stored values?** Immutable copies, Immer recipes, Immutable.js persistent collections and database transactions answer a different question.
3. **How is a result maintained after changes?** Full recomputation, memoization, fine-grained reactive invalidation and incremental view maintenance (IVM) are execution strategies. Attractive syntax does not imply any one of them.

The [interactive comparison](/selectors-vs-datalog) fixes a common input/output contract before comparing spellings. The [complete original corpus](/selectors-vs-datalog#production-corpus) retains all 22 source records and their pinned provenance. Its production excerpts are not represented as complete, equivalent programs.

## The package-name correction

`@state/db-ivm` in the earlier spec was an **unimplemented package placeholder**, not an existing npm package. It was too easy to read it as a dependency one could install. The real upstream engine is **@tanstack/db-ivm**, in the [TanStack DB repository](https://github.com/TanStack/db/tree/main/packages/db-ivm). We now call our still-unimplemented boundary **state/query-tanstack** and explicitly mark it planned. This is an adapter proposal, not a rename of TanStack's package, a fork, or an assertion of API compatibility.

The preferred experiment is to integrate the public `@tanstack/db` collection/query API first. Importing its lower-level IVM engine directly would also require owning query compilation, key semantics, indices, subscriptions, batching and lifetime cleanup. That is much more than changing an import name. The public [overview](https://tanstack.com/db/latest/docs/overview), [live-query guide](https://tanstack.com/db/latest/docs/guides/live-queries) and [mutation guide](https://tanstack.com/db/latest/docs/guides/mutations) are the starting contracts.

## What TanStack DB contributes

TanStack DB separates typed collections from reactive queries and optimistic mutations. Its query builder makes relational intent visible rather than hiding it inside an arbitrary callback over an array. Sync integrations supply collection changes; a live query can be maintained as those collections change. The important comparison is therefore not “another store hook”, but a client-side data/query layer. See the [overview](https://tanstack.com/db/latest/docs/overview).

Its query-driven synchronization work is particularly relevant: the query can help determine which subset of data to load, rather than requiring every collection in full first. This is not a promise that every arbitrary JavaScript predicate, recursion or locale-aware sort can be pushed to every backend. Capabilities belong to the selected adapter. See the [query-driven sync announcement](https://tanstack.com/blog/tanstack-db-0.5-query-driven-sync).

The local fixture intentionally uses `queryOnce`, not a subscription. Tests establish matching values and ordering for these inputs, **not incremental behavior**. The installed version's result rows carry virtual metadata; the join example explicitly projects `{id, owner}` again before comparing it with plain JS. The engine also warns when a join/order lacks an index and falls back to local scans. Neither that normalization nor those scans should disappear from a benchmark's accounting.

## IVM and differential dataflow, concretely

Imagine a dashboard showing total unpaid amount. A naive selector reads every invoice whenever its input identity changes. An incremental operator can keep the previous total and update it using the changed contribution. IVM is the general idea of maintaining a materialized query result from changes instead of starting over.

Differential dataflow expresses collections as changes with weights, and in the full model logical times. Inserting a row contributes `+1`; retracting it contributes `-1`. An update can be represented as removal of the old row plus insertion of the new row. Operators propagate those changes. The general system supports iterative computations and logical-time progress; it is not merely a synonym for running a JavaScript callback after an event. See the project's [introduction and implementation](https://timelydataflow.github.io/differential-dataflow/) and [collection documentation](https://docs.rs/differential-dataflow/latest/differential_dataflow/collection/struct.Collection.html).

For example, suppose two distinct active rows each contribute `4`, so the total is `8`. Changing one row's amount from `4` to `7` gives:

```text
existing sum                 8
retract old contribution    -4
insert new contribution     +7
new sum                     11
```

That arithmetic is our explanatory example, not a measurement. The engine must retain enough state to know what an old row contributed. Duplicates, joins, grouping, retractions and ordered windows make the required state much richer than one accumulator.

A join can amplify a single input change into many output changes. Removing the current maximum needs an index or alternative retained candidates; without them it may require a scan. A top-N view must know which row should enter when another leaves. Thus **“updates are O(1)” is not a general consequence of differential dataflow**. Operator state, indices, initialization and output size all matter. A Rust/WASM implementation also has data transfer and string/identity costs; language choice alone establishes no winner.

Do not assume the TypeScript package implements every capability of the general Rust system. In particular, logical-time frontiers, iteration, recursive rule evaluation and persistence must be confirmed against the engine version actually integrated. The prototype's diff-aware `deriveCollection` is likewise not automatically a complete differential engine.

## TanStack DB, the intended Rust/WASM DB and state-lib

The second column below describes the **intended engine contract in spec §8.10**, not an audited implementation of Danny's database. Its code and operational guarantees were not available for this comparison. Unknown means unknown, not absent.

| Concern | TanStack DB | Intended Datomic-like Rust/WASM engine | state-lib responsibility |
| --- | --- | --- | --- |
| Authoring | Typed TS query builder | Datalog-like querying intended; exact dialect must be agreed | A readable app API and an explicit supported-operator set |
| Change maintenance | Incremental live queries; inspect the chosen operator/index path | Incremental result delta protocol needs verification | Consume result deltas as ordinary derived state |
| History | Optimistic mutation lifecycle is documented; do not infer Datomic-style historical queries from it | History-first intent; retention and historical-query behavior unverified | Command/patch history domains and clear undo semantics |
| Synchronization | Multiple collection integration strategies | Wire and worker-host contract still to be agreed | Sources, outbox, cancellation and ownership boundaries |
| Framework behavior | Framework-specific bindings | Not established by the engine contract | Input/caret correctness, subscription cleanup, rendering adapters |
| Complex queries | Explicit relational operators; arbitrary functions need boundary handling | Recursion, aggregates and ordering depend on dialect/implementation | Keep non-relational stages visible, not silently reinterpreted |
| Cost | Startup, indexes, retained state and delta fan-out must be measured | Also WASM bridge, encoding and worker costs | End-to-end harness with the same data and changes |

These components can compose. Choosing TanStack's engine does not by itself settle state-lib's task cancellation, view-to-model parsing, input editing, command attribution, scope ownership or UI history. Conversely, state-lib should not rebuild TanStack's collection planner merely to keep its own name on every layer.

## Comparing authoring styles

| Style | Particularly readable for | What it does not supply by itself | Proposed use |
| --- | --- | --- | --- |
| JavaScript array methods | Small local transformations, positional scans, custom collation | Automatic relational planning or incremental deltas | Default escape hatch, with explicit full-recompute semantics |
| jq | JSON extraction, nested reshaping, short pipelines | TS model inference or a live client collection | Data import/export tools and exploratory transformations |
| Lodash / Ramda | Familiar collection operations and composition | Relational maintenance merely from `pipe`/`chain` | Useful readability baseline; avoid point-free code that hides domain names |
| Prisma-style object queries | Common filters and relations near an ORM model | Client-side incremental UI behavior | Borrow concise equality filters and explicit relation names |
| Drizzle / TanStack-style builder | Joins, predicates, projections, sorting with named aliases | Semantics for opaque JS callbacks | Borrow typed expressions and inspectable plans |
| Datalog | Relations, shared variables, recursive rules | Stable display order from an unordered relation | Optional advanced surface, not mandatory syntax for every UI author |
| Immer | Local immutable writes using a draft | A query engine | Compare writes to writes; keep read code ordinary JS |
| Immutable.js | Persistent collection transformations | Free conversion between plain JS and persistent containers | An alternative container model, with conversions shown and measured |

Primary references: [jq manual](https://jqlang.org/manual/), [Lodash](https://lodash.com/docs/), [Ramda](https://ramdajs.com/docs/), [Prisma filtering/sorting](https://www.prisma.io/docs/orm/v7/prisma-client/queries/filtering-and-sorting), [Drizzle select](https://orm.drizzle.team/docs/select), [Datomic query reference](https://docs.datomic.com/query/query-data-reference.html), [Immer produce](https://immerjs.github.io/immer/produce/), [Immutable.js](https://immutable-js.com/docs/v5/).

## A small authoring proposal, not a new engine

The site contains an experimental, fully recomputing facade:

```ts
const top = view.from(rows)
  .where({ active: true })
  .orderBy('rank', 'desc')
  .orderBy('id', 'asc')
  .take(2)
  .select('id');
```

Its design hypothesis is that ordinary equality filters should be as brief as ORM filters, while order/window operations should be explicit and readable like a pipeline. Its immutable `explain()` plan makes that supported subset inspectable. `select`/`sum` are terminals. Null ordering and heterogeneous sort keys are rejected rather than assigned accidental semantics.

**Current implementation:** `site/src/lib/view-plan.ts` performs a full recomputation. It is a research prototype outside the production API surface. There is no incremental subscription, backend pushdown, custom query compiler, join implementation or persistent index hidden behind these methods. This small baseline lets us test readability and semantic contracts without pretending the difficult engine work is finished.

Before promoting it, compare error messages, completion, complex predicates, joins, nulls, ordering and migration on real tasks. Keep a typed builder for expressions the object form cannot express. Do not add a new string DSL just to save punctuation. Leave arbitrary JS visibly outside the optimizable subset.

## Corrections to the earlier corpus interpretation

The original filter translation omitted `type === 'gap'`; the corrected form preserves that OR branch. The aggregate example precomputed unread counts and simplified muting logic, so it was not a complete equivalent to the production helper. The keyed-lookup OR query drops fallback priority unless rank or sequential fallback is explicit. A recursive relation returns descendants, not document order.

“Datalog cannot express this under any reading” was too strong. The narrower, defensible claim is that an unordered core relation does not itself provide an ordered UI list. Explicit position/path attributes, dialect extensions, host functions or post-processing may recover a particular operation. They must be shown and their costs included. Nor does using a query language automatically stabilize result object identity; the subscription/result-delta contract still has to do that.

## Validation and the next engine experiment

The committed fixture tests execute JavaScript, actual Lodash/Ramda/Immutable.js/Immer, the experimental facade and actual TanStack DB. jq is executed by the CLI in the test harness. Datalog, Prisma and Drizzle are reference spellings because their corresponding database runtimes and schemas are not installed in the browser. The UI says this rather than substituting a JavaScript implementation and calling it a successful database query.

The next benchmark must separately record initial load, index creation, single-row changes, high-fan-out joins, parameter changes, top-N boundary churn, bulk changes, teardown and memory retained. It needs a live TanStack query and the agreed Rust/WASM engine over the same seeded entities, including equal aggregate values, missing relations and ordering ties. Existing value-equivalence tests are necessary but insufficient evidence for choosing that engine.
