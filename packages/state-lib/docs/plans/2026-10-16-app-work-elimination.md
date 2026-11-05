# Eliminate application work — HYP-1737, HYP-1739, HYP-1740

Binding goals: the supplied master spec §4.4/4.5, §5.2, §8.5 and §13; keep the full application behavior, input/IME, history, immutable ownership and private-session guarantees. A store rename or a smaller isolated function is not success.

Implemented candidates:

1. HYP-1737: specialize explicit browser-entry constants before linking, preserve authored package side-effect metadata, enforce local-source containment, and account every emitted byte. The actual Boards bootstrap uses `state build`; baseline receives the identical bundler and specialization. A bundle-only control distinguishes ordinary bundling from state-specific pruning.
2. HYP-1739: capture owned immutable snapshots by reference at the save queue, but clone unowned values and keep the outgoing send payload private. Eliminate the repeat whole-document clone on the interaction path without weakening alias safety.
3. HYP-1740: derive a completion-only view plan from immutable keyed rows and validate all target nodes before applying it. Reuse DOM nodes for the named command; structural and unsupported changes retain the full renderer. The helper has no app singleton or retained row cache. It scans the changed list; only DOM mutation work is proportional to changed rows.

RED/GREEN evidence exists for opposite-engine retention, dynamic-import dead-class retention, browser-root and extension resolution, missing snapshot retention, save-payload isolation and actual DOM row identity. Full current gates: 61 compiler tests including native/Wasm parity, 53 snapshot/command/view tests, 392 board tests and 28 compiled application browser cases.

Ruling: product limits remain unchanged. An initial 1200-item single-column benchmark was rejected by the real API. Correct scenarios use at most 200 items per column and 1200 per visible board; 10000 total items span multiple boards. Do not relabel them as 10000 visible DOM rows.

Ruling: the first timing probe queued a microtask in the capture listener, which can run before later event listeners. Its handler timings are invalid and excluded. Correct timing runs from capture to a window bubble listener and asserts the committed result there. Count DOM replacements in a separate diagnostic click; disconnect its observer during numerical trials.

Release steps: finish current trusted-click measurements; preserve every adverse row and host condition; record exact code hashes and independent full-entry controls; review source and tests; publish separate branches through normal hooks; pin helper provenance. Update private technical reports/specs/tasks, not premature marketing. Independent cloud staging remains blocked by the unexecuted restricted-role operations; do not retry them by another route or replace them with privileged owner credentials.

## Resumed implementation ledger

The pending HYP-1737/1739/1740 implementation was recovered in its two isolated worktrees. The separate UB-113 draft/persistence work is actively running in other worktrees; it is neither overwritten nor represented as part of this change. Fresh inherited tests:61 compiler,53 COW/row/capture and392 board unit tests pass. Both fixed entry builds and the previous uncompiled application matrix pass.

A new adversarial parity check found the initial per-file `transform` erased project TypeScript semantics before linking: inherited assignment-style class fields became native define fields, and a custom JSX factory became React. Both failures were reproduced on actual emitted execution. Pre-link specialization now uses an unbundled esbuild build with normal file/config discovery, keeping inherited configuration and preserving source maps. Root tsconfig/jsconfig files participate in the source fingerprint. The expanded13static-entry tests pass; full verification and independent emitted controls are rerun before publication.

Ruling: library/runtime correctness is binding; compile speed is secondary to preserving the project's existing semantics. The pre-link pass may cost extra build CPU but adds no runtime dispatcher. An ordinary bundle-only control remains in the evidence to separate common minification benefits from state-specific removal.

A second pre-link parity regression found that partial minification selected esbuild's development NODE_ENV default before the production linker. The failing emitted program returned development; matching production minification in both stages fixed it. This is a build correctness and bundle-retention defect, not a performance claim. Initial timing runs are retained as exploratory evidence; publication measurements are taken after final builds and semantic corrections.

## Independent review correction ledger

The fresh code review identified a browserRoot bypass through an out-of-bound entry, transitive configuration fingerprint gaps and mixed generations after I/O failure. Direct RED tests reproduced them. Further tests reproduced path-alias/JSON boundary bypass and premature cleanup failure reporting. The fix validates loaded author files, inventories TypeScript's real configuration reads, rechecks the source identity, stages a complete generation and restores or preserves the previous directory on failure.

Nested JSX factory tests first exposed that the ordinary baseline also lost source-local settings at plugin resolution. Both paths now share a neutral, name-preserving pre-link pass and leave production environment/renaming to the final link. The pass batches all authored entries into one invocation, with its actual cost reported, instead of starting a build per module. Research notes distinguish the full per-array scan/key Set from delta-sized DOM writes. No runtime implementation or measured app behaviour is silently changed to satisfy the review.

Ruling after final review: keep compile-time constants at explicit module boundaries for this change. Moving them behind a runtime helper can prevent dead class initialization from disappearing; do not trade proven graph removal for superficial deduplication without an equally optimized build proof. Optional cleanup of test routing and other renderer conventions is not a correctness blocker. Precise current contracts cover stale/no-op board identity, standalone failure preservation, and cleanup-before-DOM semantics. Authored source reduction remains a separate measured goal rather than a claim from this larger branch.

Final review iteration: an omitted native esbuild executable hash and misleading single-pass telemetry for baseline/candidate comparison were reproduced. The executable joins the toolchain identity; an ambient override is refused. Both outputs now reuse one pre-link cache in one process, and the report counts their two final links explicitly. Config lookup deduplicates directories/reads and uses the already enumerated source inventory; the second independent identity check is retained for correctness. The actual application received a full three-role review with no remaining confirmed blockers after cleanup-before-DOM correction.
