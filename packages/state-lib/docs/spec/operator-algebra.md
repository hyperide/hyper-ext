<span id="operator-algebra" class="anchor"></span>

### Query algebra, examples and optimization boundaries

**Specification plus executable reference, September 8, 2026.** Extends R27, R28, R32, R52, R66 and R79. [The operator page](/queries) runs 38 paired examples against the same fixture. This is a new corpus; it does not pretend the earlier 22 production selectors have all been reimplemented.

The public surface should combine familiar collection pipelines and relation navigation. The write surface stays mutable-looking actions. Persistent storage, lazy iteration, incremental maintenance and SIMD are different mechanisms; sharing a pleasant chain syntax does not provide all four automatically.

| Family | Operator basis to evaluate | Useful service scenarios |
|---|---|---|
| Selection | where/filter, reject, find, some, every, partition, exists | Unpaid invoices, permission-filtered menus, missing resources |
| Projection | map/select, pick, omit, rename, pluck, entries, fromEntries | Cards, export rows, UI prop groups |
| Cardinality/shape | flatMap, flatten, chunk, zip, unzip, pivot, unpivot, nest | Tags, imports, cross-tabs, nested detail views |
| Identity/sets | keyBy, uniqueIndex, distinctBy, union, intersect, except, concat | Selection sets, normalized identities, merge/import deduplication |
| Relations | inner/left/full join, semi/anti join, lookup, include, exists | Customer relations, orphan audits, access scopes |
| Grouping | groupBy, countBy, aggregateBy, having, rollup | Revenue by customer/country, status summaries |
| Scalar aggregates | count, sum, product, min/max, argMin/argMax, weightedMean | Invoice totals, cheapest offers, weighted scores |
| Statistics | mean, variance, stddev, median, quantile, IQR, MAD, covariance, correlation, histogram | Latency p95, risk/outlier analysis, distributions |
| Ordering | orderBy, stableSort, topK, bottomK, rank, denseRank | Tables, leaderboards, task priority |
| Windows/sequences | scan, pairwise, lag/lead, moving windows, runs, sessionize | Chat grouping, running totals, monitoring windows |
| Pagination | offset/limit, keyset, opaque cursor, bidirectional window | Grids, infinite scroll, timelines |
| Scalar transforms | clamp, round, abs, logarithm, normalize, safeDivide, date buckets, string operations | Display projections, metrics, search preprocessing |

This is a basis, not a claim that every named operator is implemented. The executable reference implements lazy where/select/flatMap/take/skip/distinct; stable orderBy; groupBy; indexed inner/left/semi/anti joins; scan/windows; set operations; scalar reductions; pick/omit/zip/pivot; exact quantile, variance and histograms. Some advanced operations above still require API and semantics decisions.

#### One-to-one examples

Each executable example has one input, a native-JS reference, an operator implementation, the expected result and an optimization note. The Run both button invokes the very functions displayed, not a different canned demo. Native references prioritize clarity, not benchmark superiority. The module exports the shared fixture so snippets are not disconnected fragments. Floating-point results use relative tolerance 1e-10; integer/order/shape results are compared exactly.

The current implementations are JS only. jq, Ramda, Lodash, Immutable.js, SQL/Datalog and Danny DB adapters are not silently represented as executed. Add such adapters to the same cases and equality checks, rather than changing the task to fit each language.

#### Physical plans and legality

Implemented here: lazy iterator stages without intermediate result arrays, early exit for take/find, hash join indexes, one-pass partition and running scan, Welford variance, binary-search histogram bins. Lazy generator composition is not yet compiler-emitted loop fusion.

Planned: fused native loops, projection/predicate pushdown, reverse foreign-key indexes, delta-maintained groups and joins, hash-vs-merge-vs-index join selection, top-K heaps, dictionary IDs/bitsets, shared subplan caching, column pruning, SIMD lowering and calibrated worker scheduling. Each plan needs an explain output naming dependencies, layout, executor, estimates, measured samples and fallback reason.

Do not reorder arbitrary callbacks: closures, effects, exceptions and nondeterminism can make transformations invalid. `take(1).filter(p)` differs from `filter(p).take(1)`. Having is not generally a pre-group predicate. Floating-point reduction is not associative. Outer-join filter pushdown can remove retained unmatched rows. Sort keys must specify null ordering, locale/collation and stable ties. Null, undefined, NaN, duplicates, empty input and integer overflow need explicit contracts.

#### Incremental and parallel are not synonyms

Count/sum can maintain small mergeable accumulators. Mean maintains sum plus count. Min/max deletion may need a multiset/index. Exact median/quantiles need order-statistics support or recomputation; approximate sketches must be explicitly approximate. Joins need indexes on both sides and propagate multiplicity. Running sequences depend on order. A generic reducer with an opaque callback cannot automatically become an incremental or parallel reducer: it needs declared algebraic properties or a serial fallback.

Pagination retains query identity, generation, ordering and snapshot/version policy. Offset pagination, keyset pagination and server opaque cursors are not interchangeable. Infinite scroll is a presentation/retention policy, not a fourth transport protocol. Changing filters invalidates old-generation pages; concurrent responses must not append to the wrong query.

Sources: [Lodash](https://lodash.com/docs/), [Ramda transduce](https://ramdajs.com/docs/#transduce), [Immutable Seq](https://immutable-js.com/docs/v5/Seq/), [Immer](https://immerjs.github.io/immer/performance/), [TanStack DB live queries](https://tanstack.com/db/latest/docs/guides/live-queries), [Drizzle](https://orm.drizzle.team/docs/select), [jq manual](https://jqlang.org/manual/).
