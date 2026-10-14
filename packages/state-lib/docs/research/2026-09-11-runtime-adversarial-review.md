# Reference runtime adversarial review

Review date: 11 September 2026. Baseline: `f8367e423837727ef1700c0f888ddd15da30da8c`.
Part of HYP-1457. This is an executed regression review, not a formal proof.

## Reproduced defects

| Case                                                   | Baseline result                                                | Repair                                                                                                      |
| ------------------------------------------------------ | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Equality preflight reads a cold derive and then throws | Committed signal is 1, cached double is 4                      | Retain the staging context through the complete preflight; speculative reads never replace committed caches |
| Equality preflight reads a warm derive                 | Cached double is 2 while the staged signal is 2                | Same staged-snapshot context, independent of cache warmth                                                   |
| A derive depends on a later-created derive             | Root disposal throws and leaves an owned node behind           | Tear down the whole owned graph during root disposal; keep the manual observed-dispose guard                |
| A derive calls `signal.update`                         | User updater executes before the forbidden-write error         | Check write permissions before invoking the updater                                                         |
| One source has 150,000 dependents                      | V8 throws `Maximum call stack size exceeded` after publication | Push dependents individually rather than spreading them as function arguments                               |
| Standalone strict TypeScript compilation               | Two TS2345 errors in generic subscriptions                     | Separate private generic observation from the public synchronous callback contract                          |

All five runtime reproductions were red before the implementation changes and green
afterwards. The suite also checks listener failure isolation, pending delivery disposal,
and 32 seeded streams of 250 transactions against a from-scratch reference. Listener
ordering is not specified; the disposal fixture deliberately accepts either order.
Positive and negative callback type contracts run under strict TypeScript separately
from runtime transpilation.

## Consolidation review

The source-PR integration finished green at `203531d7`. Merging current main revealed
only agent-document conflicts: retain main's split rules and deletion of AGENTS-CORE,
not the older giant document. An unrelated generated CanvasPreview import and
`/test-preview` route were also present in the old state branch without their generated
source. Restore `client/App.tsx` from main instead of shipping that unrelated artifact.
Retain main's audited root dependency lock; the site retains its own locked dependencies.
The diagram primitives from the source PRs remain included.

Remove the completed one-shot merge/export scripts and their write-enabled workflow.
The permanent read-only workflow now verifies PRs to main as well as the state branch.
Runtime fixtures and type contracts are part of the normal site gate, not a temporary
integration-only step. No failed gate is disabled or converted to a warning.

## Proof and performance boundary

The TS kernel remains an executable reference. These tests are not a proof of arbitrary
programs, a refinement proof of TypeScript compilation, or proof of browser/framework
behavior. The agreed next implementation boundary remains Rust plus executable Verus
proofs and independent conformance tests. Performance needs equal-semantics measurements;
there is no blanket “faster than vanilla” claim.

## Follow-up adversarial review — 2026-09-12

The fresh review covered the complete consolidation, not only its last integration fix.
The following failures were reproduced and received focused regression coverage:

- Conditional self/mutual cycles overwrote recovery dependencies; cycle detection now precedes cache/graph replacement.
- Self-disposed observers and derives reattached edges after evaluation; finalization now leaves disposed nodes detached.
- Rejected promise results escaped synchronous guards as unhandled rejections; guards drain rejection while preserving their synchronous error. This does not cancel scheduled work.
- Allocation during a transaction leaked graph ownership on rollback; graph allocation now has an explicit boundary.
- Foreign-runtime tracked reads silently cached stale values; they now fail explicitly, while `peek`/`untrack` remain untracked snapshot reads. Pure callbacks cannot write through another runtime.
- Nested savepoints repeatedly copied the complete pending map; a reversible write journal removes that quadratic map work. The isolated operation-count probe is not an application-speed benchmark.
- Date parsing used UTC midnight despite timezone-aware presentation; unchanged local dates now round-trip, with explicit rejection where a local midnight does not exist.
- A rejecting race winner left losing tasks running; cancellation and settlement now cover either outcome, including shielded cleanup.
- Cancelled anchor navigation still scrolled when fonts became ready; cancellation now invalidates that continuation.
- Static output omitted `/repl/snippet` and `/concepts/practical`, and inherited homepage metadata; cold-load checks require both routes and exactly one correct canonical/Markdown alternate.
- Experimental access lowering detached method receivers; receiver-sensitive calls and tagged templates retain their binding.
- The worker's Lodash default export was not callable, although the separate fixture runner passed; authored executable snippets now run through the actual worker handler as well.
- The null-ordering test accepted a missing-method TypeError; it now executes the real terminal and asserts the intended ordering error.
- TanStack joins/orders silently used fallback scans; both executable entry paths declare real indexes, and a negative control proves the warning detector is live.
- A directly imported Lezer package was only transitively installed; it is now declared directly and an AST-based dependency regression catches its removal.
- Build-dependent prerender regressions initially ran before a fresh build; they now run in the post-build gate. Runtime follow-ups and compiler regressions are wired into the permanent gate.

The highlighter check parses an inert real-browser fragment instead of stripping HTML with a regular expression. It checks lossless text and allowed elements/attributes. Chromium was already a declared test dependency with explicit CI provisioning; adding this assertion did not add an undeclared browser dependency. Quoted upstream examples and application gate settings remain intact.

Root TypeScript failures and the misleading CI job name were independently reproduced on the unchanged main TypeScript tree and tracked separately as HYP-1458. They are not silently treated as passing or patched by weakening the state-lib tests.

All evidence remains scoped: these are executable reference/prototype regressions, not a formal proof of the TypeScript library, native equivalence, universal performance or production readiness. Final CI and deployment evidence belongs to the exact published revision, not an earlier working-tree run.
