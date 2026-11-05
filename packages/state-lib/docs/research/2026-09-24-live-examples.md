# Unified live examples and paired application work

The new `/repl/board-commands` and `/repl/issue-triage` examples keep editable multi-file source, generated commands, full bundled output, an interactive board and configurable timing in one workbench. The board uses nested cards; triage separates issue records from column ordering. Both compare the same commands and data model with runtime draft execution and generated immutable operations. They are examples derived from the real document-publication modules, not completed copies of the two deployed applications.

The compiler is the native Rust planner compiled to Wasm, published as `b348a8e6bf689c1091e5476f4d8e739bbc7a808e` in PR802. Its source and browser artifacts are hashed. The bundler resolves only the supplied virtual project; all reachable library code counts in raw/gzip entry size. Compiler/bundler download costs are separate on-demand tooling assets, not removed from the site budget.

Edited application code executes in a disposable worker inside an opaque-origin frame with no network permission. Compilation and execution are different boundaries. The host owns cancellation, timeout and state hashing. Timing uses calibrated repeated operations; its percentiles describe batch means. Correctness compares an identical validation sequence and checks retained snapshots before timing, rather than claiming that unequal-length timing batches end in identical values.

## Source, result and mechanism

Each project exposes its application files, reference commands, declaration, generated modules and shared runtime source. Every timing/size block links to real specification anchors for path copying, batch construction, ordering, atomic publication, compiler behavior or full entry size. Historical measurements remain dated records; the new controls perform actual browser runs.

The UI keeps the last successful build after invalid source, supports cancellation and retains edits in session storage. Raw and gzip minima are highlighted independently. A browser test exposed truncated preview counts and incorrect selection after a cross-column move; both models now preserve full counts and absolute row indices while limiting rendered rows.

## Validation and scope

The complete site suite passed 84 gates, including static HTML/Markdown, actual anchors and the new eight-scenario workbench check. Additional real-engine tests execute compilation, moves, Undo, equivalence and cancellation in Chromium, Firefox and WebKit. Root types, lint, source/asset hash checks and local PostgreSQL persistence tests run separately. Further edits require rerunning their affected checks before release.

Browser observations are saved locally and can be explicitly submitted. A private Unix-socket PostgreSQL test verified persistence across connections, deduplication and retention of slower observations. The hosted database is not yet connected: Neon requires authorized project access. A failed share never reports success or discards the local run. Community observations are not silently promoted into trusted compiler-admission profiles.

Boards and Tasks have independent migration worktrees and pinned original comparison worktrees. Current ownership coverage, application parity and staging requirements are tracked in HYP-1490/HYP-1491. Neither complete application migration nor remote paired staging is implied by these two example routes. Main and production remain unchanged.

## Review follow-up

The source review confirmed the main lifecycle/identity paths and identified concrete boundary refinements. The service now ignores user-supplied forwarded headers outside the known Vercel transport, accepts an explicit unknown coarse browser classification, and preserves strict validation of arbitrary metadata. Timer-floor observations are no longer called a tie. Sharing an equivalent observation is described as adding to matching measurements. The sandbox serializes `<` safely before placing source in its script envelope, preserving exact code while avoiding HTML comment/parser states. Red-first contracts cover these changes.

The first visual-tool invocation incorrectly applied a canvas-selection rule demanding a blue outline to this documentation workbench. A correctly scoped insertion invocation still triggered that rule, so automated visual acceptance is not claimed. Actual screenshots were inspected, and browser geometry, visible data/counts, independent raw/gzip highlights and interactions are verified separately. No visual guard or project setting was disabled to manufacture acceptance.

Remaining performance work is explicit: repeated compilation recreates the isolated compiler worker, and the bounded preview reconstructs/replays its current action sequence. These costs do not enter the timed command batches, but they affect workbench responsiveness and should be reduced with owned reusable sessions. They are not hidden as runtime-library performance gains. Full existing REPL conversion and the remotely hosted measurement database remain separate tracked work.
