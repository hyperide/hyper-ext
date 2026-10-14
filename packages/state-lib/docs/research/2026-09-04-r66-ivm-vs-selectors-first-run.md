# R66 — measured: selector pyramid versus incremental maintenance

**Date:** 2026-09-04 · **Requirement:** R66 · **Fixture:** `site/src/pages/Bench.tsx`, suite `ivm` · **Runner:** `site/tools/run-bench.mts` · **Raw results:** `site/tools/bench-results.json`

R66 forbids claiming a number before a harness produces it. This is the first run that produces one, so this document exists to say exactly what was measured, on what, and what the number does and does not license us to claim.

## Provenance

|         |                                                                                           |
| ------- | ----------------------------------------------------------------------------------------- |
| Machine | Apple M4 Pro, 14 cores                                                                    |
| Browser | headless Chromium via Playwright                                                          |
| Commit  | recorded in `bench-results.json`                                                          |
| Method  | median of 9 timed samples after 3 warm-up samples; each sample is 200 single-item updates |

Absolute values are not comparable across machines. Ratios within one run are, and the ratio is what this fixture is for.

## The fixture

A collection of rows `{ id, status, team, prio }`, and one derived view built the way real applications build them: **filter** by status, **sort** by priority, **group** by team. One row's `status` is flipped, then the view is brought up to date, 200 times per sample.

Two implementations of "bring the view up to date":

- **recompute** — `rows.filter(…)`, `[...].sort(…)`, then group. This is what a reselect pyramid does when the input array's identity has changed, which it has, because a row changed. Every stage re-runs over the whole collection.
- **incremental** — the sorted array and the group index are maintained. A flip is a binary search plus a splice in the sorted array and one splice in one group. Nothing else is touched.

## Result

**Two incremental implementations are measured, and the difference between them is the point.**
`incremental` is hand-written for this one query shape — raw array manipulation, no store at all.
`deriveCollection` is the real primitive in `src/lib/proto.ts`: a patch-driven view that consumes
the transaction log, and whose numbers therefore include the _entire_ store write path — the proxy
write, patch and inverse-patch generation, the transaction commit, and signal notification. It is
doing strictly more work than either other column, and the recompute column is doing none of it.

| Collection size | recompute    | hand-written incremental | **`deriveCollection`** (real primitive, full store path) | ratio vs recompute |
| --------------- | ------------ | ------------------------ | -------------------------------------------------------- | ------------------ |
| 100 rows        | 0.8 ms       | below timer resolution   | **0.3 ms**                                               | **≈ 2.7×**         |
| 1 000 rows      | 6.7 ms       | 0.1 ms                   | **0.5 ms**                                               | **≈ 13×**          |
| 10 000 rows     | **110.2 ms** | 0.3 ms                   | **1.8 ms**                                               | **≈ 61×**          |

(200 single-item updates per measurement. "Below timer resolution" means the median rendered as `0.000 ms` — not zero, just under what `performance.now()` resolves for 200 operations here.)

**The honest headline is 61×, not 280×.** The earlier run measured the hand-written path, and this document said then that it was a ceiling for the shape rather than a prediction for a real engine. It was: the real primitive is about four and a half times slower than code written for one query, and that gap is what patch scanning, membership bookkeeping and the whole transaction pipeline actually cost. Reporting the smaller number is the point of having run it.

The shape is the expected one and the interesting part is how early it bites: recompute is O(n log n) per update and incremental is O(log n), so the gap widens with size, and at ten thousand rows a single checkbox costs **113 milliseconds** of derived-view work — seven dropped frames, from one click, in a view most applications would consider medium-sized.

## What this licenses us to claim, and what it does not

**Licensed:** that recomputing a filter-sort-group pyramid on every change is the wrong default at collection sizes real applications reach, and that maintaining the view from a diff is worth the machinery. That is R66's actual question and the answer is yes.

**Not licensed, and the caveats are larger than the headline:**

1. ~~**The incremental side is hand-written for this one query shape.**~~ **Resolved by measurement.** The real primitive now has its own column and lands at 61× rather than 280×, so the ceiling was real and the cost of generality is about 4.5×. What is _still_ unmeasured is the Datalog layer of R32, which adds query planning on top of what `deriveCollection` already pays.
2. **The recompute side is not strawmanned, but it is not optimised either.** It is an idiomatic memoized chain whose memo is invalidated because the array changed. A hand-tuned implementation could maintain its own index — at which point it _is_ the incremental implementation, which is rather the point.
3. **This is a prototype, not the library.** `deriveCollection` is about sixty lines in `src/lib/proto.ts`, checked against a full recompute by `site/tools/proto-derive.check.mts` — nine assertions, including that a history undo moves the view and that an unrelated write causes no repair at all. It is not the shipped `derive.collection`: no query planner and no diff-aware chaining.
4. **The small-collection caveat still did not reproduce — and now that means more.** §4.5, §13.1.7 and the brainstorm all anticipated incremental maintenance losing at small collections to its own overhead. At 100 rows the real primitive still wins, 0.3 ms against 0.8 ms, while paying for a transaction pipeline the recompute column does not have. The caveat looks weaker than when it was written — though a query _planner_ is the overhead it was really about, and that remains unmeasured.

## A second number from the same run

The Proxy suite, which the spec quotes from a third party, now has our own measurement: **1 M reads through one Proxy trap level: 11.5 ms, versus 1.6 ms plain — about 7×.** §13 cites "≈13×" from the brief's source. The difference is machine and access shape, not a contradiction, and the honest form for the site is our own number with our own provenance beside the cited one, rather than quietly adopting whichever is more flattering.

## Next

- ~~Re-run when `derive.collection` exists.~~ **Done** — that is what this revision reports; the gap narrowed from 280× to 61×.
- ~~Remove the `indexOf` in `repair()` in favour of a maintained position index.~~ **Tried, measured, reverted** — see below. The next real attempt needs a different data structure, not an index over an array.
- Add the two axes this fixture does not vary: update rate (a burst of changes should favour recompute, since one recompute serves many changes) and selectivity (a filter that admits almost everything gives incremental maintenance less to skip).
- Source a real selector pyramid from a production codebase, anonymised, rather than a synthetic one. R66 asks for real-world pyramids specifically, and a synthetic three-stage chain is the easy case.

## The optimisation that made it slower

The first revision of this document ended by naming the obvious next step: `repair()` locates an item
with `indexOf`, a linear scan, so replace it with a maintained `id → index` Map. That is the kind of
change one normally makes without measuring.

Measured, it made the 10 000-row column **3.8× slower** — 1.8 ms to 6.8 ms.

The reason is embarrassing only if you did not think it through. The view is a _sorted_ array, so
repairing one item splices it out and splices it back in at a new position. A splice shifts every
element after it, which invalidates every index after it, so the Map has to be rewritten from the
splice point to the end of the array on every single update. That is a full linear pass, unconditionally
— strictly more work than the scan it replaced, which at least stops as soon as it finds the item.

Reverted, and the reasoning is now a comment on `repair()` so nobody re-derives it. Beating a linear
scan here needs a structure where an ordered insert does not renumber its neighbours — an
order-statistic tree, or a skip list with ranks. That is real work for a gain that is currently 1.9 ms
per 200 updates, so it stays unbuilt and named rather than half-done.

The general lesson is the one worth keeping: **the optimisation the numbers appeared to want was a
pessimisation, and only a measurement said so.** This is exactly the discipline §5.6.5 demands of the
compiler's own optimisations — every one a flag, promoted only on an isolating benchmark — and it is
worth noting that the first time it was applied to our own code, the answer was no.
