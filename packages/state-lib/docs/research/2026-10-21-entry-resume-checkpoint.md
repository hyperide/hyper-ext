# Entry-specialization continuation — 21 October 2026

Related task: HYP-1737, verified as “Remove unused state engines from complete application downloads”. The existing Ubuntu worktrees remain the source; the online host is now reachable through its Paid Desktop Commander connection. No application main or production service was changed.

## Changes and evidence

Canonical path resolution is cached inside one compiler invocation and reused across its two links. Source-boundary checks still execute. A regression verifies actual emitted behavior and a nonzero bounded number of resolutions; all 26 static-entry tests pass. This is build-time duplicate-work elimination, not a new runtime latency claim.

Publication lock cleanup is treated separately from the output commit point. A failed lock removal reports the exact leftover lock without disguising installed output or masking the original installation failure. Reproduced failure tests now verify the successful generation, explicit warning, preserved previous generation on failed installation, and continued exclusion of another builder while the lock remains.

Current complete compiler discovery ran **86 tests: 85 pass, one fails**. The remaining regression detects an extra source inventory scan (three instead of the required two). The proposed argument change for reusing the initial inventory was denied by the tool before execution. It was not performed through an alternative mechanism, and the test remains enabled. The whole compiler release gate is not green.

Fresh separate acceptance: **53 immutable/COW/row contracts, 395 Boards unit tests, four fixed-build contracts, and 28 compiled browser scenarios pass**. Root TypeScript and knip completed. After the final source changes, both fixed builds were rerun; their runtime JS/HTML/CSS hashes exactly match the artifacts used by the accepted browser scenarios. This avoids claiming untested rebuilt runtime output or rerunning unrelated browser work merely to produce a new log.

The 16 October numerical archive remains a pre-review record. It is not relabelled as current-source performance proof. No new speed ratio, universal edge-case win, smaller-than-optimized-baseline claim, commit, push or deployment is asserted by this checkpoint.

Logs, RED/GREEN results, artifact parity and the written task comment are retained under `.superpowers/sdd/2026-10-16-app-work-elimination/session-20261021/`. HYP-1737 received the verified status through the existing authorized Tasks connection. The broader A/B staging, Tasks improvements and shared lifecycle work remain separate.

## Reflection

The productive next step is resolving the one remaining inventory-reuse gate, then fresh whole-branch review and source-matched release evidence. Repeating old benchmarks or restarting already implemented app migrations would not resolve it. The user requested a 30-minute reflection heartbeat; the available ChatGPT scheduler supports no cadence below one hour. No automatic task or host-side replacement scheduler has been installed without agreement to a supported cadence.

## Release acceptance update — 21 October 2026, later

The one remaining compiler gate is closed: the validated source inventory built before planning is now reused for the bundler, so only the initial and final fingerprint walks remain. The complete compiler discovery passes (**86 of 86**), the 53 capture/row contracts, **395** Boards unit tests and four fixed-build contracts pass, and strict Ruff is clean on the three touched Python files after narrow style repairs. Rebuilt runtime output is byte-identical to the artifacts that passed the 28 compiled-browser scenarios.

Source-matched measurements (Chromium then WebKit, seven pages per case, shared host load recorded) and the complete entry inventory are in the canonical report's release section and in `2026-10-16-work-elimination/release-20261021/`. The earlier statement above that the compiler gate was open is historical. Authored-source reduction, general edge-case admission, other actions, shared lifecycle and four cloud applications remain unproven and separate. Nothing was promoted to production.

## Source-boundary and publication follow-ups — after the release evidence

The release evidence above was recorded before these changes and does not cover them: `node_modules` classification in the browser-root check (an authored `src/node_modules` tree is no longer exempt), per-file placement of the lowered prelink sources so source-map `sources` stay resolvable for nested files, and refusal to replace a generated output name that is a directory. Their contracts live in `tests/compiler/test_static_entry.py` and `test_output_publication.py` (99 compiler tests in total; the eight Wasm contracts need `compiler/build-web.sh` and error without it). The measured numbers and `source-identities.json` in `release-20261021/` describe the earlier bundler and test files and are not re-measured here.
