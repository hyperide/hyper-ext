# Continuation checkpoint — 20 September 2026

Canonical worktree: state-build-research-20260918, branch research/state-build-20260918 (PR802). Boards worktree: boards-app-state-lib-pilot, branch research/state-cow-HYP-1500 (PR10). Tasks is unchanged; HYP-1499 is already Done.

Ordinary scoped source writes succeeded without changing permissions. The connector already had Allow all actions and unrestricted directories; a compound read was blocked without a detailed classifier reason. Do not infer a filesystem permission failure or bypass a future explicit denial.

COW historical references: all five previous failures fixed in canonical json-draft.mjs and synced byte-identically to the Boards research copy. 21/21 helper contracts,19/19 existing app contracts,117 default unit tests,both builds and6 common Chromium/WebKit/backend flows pass. No default algorithm change. Fresh actual-controller matrix remains13/21 strict latency cells versus original baseline. Whole-COW qualification rejects on performance, not correctness, and preserves11408raw/4288gzip B1 output.

Native projection generation is implemented: Rust projection.rs emits virtual modules, Oxc parses them, source maps expose generated text, no authored candidate file is written.18 existing CLI+11 generator tests pass. Review found cross-unit authored/generated path borrowing; three negative subtests reproduced it, role-specific validation fixed it, exact error assertions strengthened. Full first review and focused correction review completed successfully. Final exact-index three-role review PID82883 is pending; log results/final-staged-review.log. Do not alter the reviewed source index while that run is active.

Fresh generated projection profile and COW qualification were rerun after compiler-source changes rather than relabeling old hashes. Generated result171→64 raw,153→80gzip. Dense builder probe is handwritten data-only, not generated or integrated into the Runtime ownership system; last40 frozen versions checked, full exclusions in REPORT.md.

Next: collect exact-index review, publish normal-hook commit/push to existing research branch and read back SHA; pin the Boards helper provenance to that source commit and publish its reviewed research correction. Update HYP-1505 only after confirmed publication; HYP-1500/1504 remain In Progress. No main merge/production deployment. Preserve old pending generated research notes, earlier diagnostic JSON, .metadata_never_index and all other worktrees.

Next implementation objective after publication: generated immutable point/dense command bodies with one ownership/commit interface, then normalized ID ordering and granular rendering; qualify each command and complete pipeline against B1 semantics and B0 budgets. Do not advertise automatic per-command COW selection or a universal no-regression theorem before implementation and evidence.

## Canonical source published

Source commit 1a6d08481ce82f5fc57998b092b117b420eba06b was committed through the ordinary hooks, pushed, and read back from the remote research branch. PR802 now describes the corrected COW boundary and generated projections. Full source review, focused generated-path correction review, and final exact-index review all completed. The final reserved-name comment is handled by the mandatory Oxc parse of generated modules; invalid bindings are rejected before qualification, and that parse is not skipped. No broken output or new permission mechanism is introduced.

Boards helper adoption is the only source-publication step still pending: exact two-file staged review PID87604, log results/boards-fix-review.log. The code is byte-identical to the reviewed canonical helper and provenance pins1a6d084. After that review, normal commit/push and tracker readback remain required. Do not restart completed numerical benchmarks or all prior compiler reviews. HYP-1505 should only be marked Done after that publication is confirmed; performance work stays In Progress.

The full REPORT.pdf was rendered and visually inspected after the code commit; add it with this documentation checkpoint in a separate docs-only commit. No source byte was changed by that render. The Russian companion report is generated on the conversation surface; full canonical methods and data remain English in the repository.

## Final source delivery confirmed

Boards correction2d24ad478f6736e0aa42dffb1cb812308ea5eafe is now pushed and remote SHA verified. Its exact two-file staged review completed; normal hooks passed. The canonical source remains1a6d084, with the full PDF/documentation at d1afa0093a6c4e00b7ce52011d549bb52afd1889 before this final checkpoint. PR802 and PR10 describe the current repaired correctness status and still-rejected global COW timing gate. HYP-1505 was commented with verified SHAs and transitioned to Done at version3; HYP-1500/HYP-1504 are still ongoing research. No reviewer is active, no benchmark needs blindly restarting.

The app reviewer suggested moving historical-edge marking after the no-op check; that style suggestion was rejected because the dedicated unchanged-historical-assignment regression and correctness reviewer show the ordering is load-bearing. The descriptor trap does not rewrap values via state(). An additional direct check of a live draft nested in a newly inserted plain object passed, including structuredClone of the final graph, frozen sharing and the unchanged prior root. This extra check did not alter source or the measured profile.

Next work begins with generated immutable point/dense updates and a shared ownership publication boundary, not with redoing HYP-1505 or weakening the current performance gate. Every runtime representation change needs a fresh measured profile; generated projection data and COW performance are distinct evidence streams.
