# Application work elimination, not an isolated setter

Tasks: HYP-1737 (complete-entry specialization), HYP-1739 (snapshot capture), HYP-1740 (keyed completion view). Canonical specification: §4.4, §4.5, §5.1–5.2, §8.5 and §13. Implementation and measurements use the same isolated Boards migration baseline, `90d06a8a38ab5bddb5922b43a56e8a4073090b2b`; neither application main nor production is modified.

## What changes

The previous complete application distribution copied both state engines and their helpers. An explicit fixed entry now goes through `state build`, which lowers declared backend constants before linking. Both baseline and state-lib use that same compiler and bundler. A third bundle-only control measures ordinary minification and linking separately from specialization. The runtime manifest records every contributing source module and raw/gzip/Brotli size; dormant engines and the runtime URL backend selector disappear from the corresponding fixed graph. The ordinary uncompiled entry remains available.

The save queue now accepts an immutable capture port. Only values certified by the library's ownership registry are retained by reference; ordinary or shallow-frozen input still gets a private structured clone. Sending retains its separate mutable-payload contract. This removes a redundant whole-document clone from each edit, not the eventual serialization or network work. The failed-capture, in-flight/newer-version and mutating-sender cases preserve their original authority and retry boundaries.

An optional pure immutable-row adapter computes a checked completion-only view plan. It holds no application state and does not import a new reactive engine. The board verifies every target before applying any visible change, then updates the completion class and accessible control attributes on existing rows. Structural edits, mismatched keys and unsupported fields use the full existing renderer. For each identity-changed array, the current implementation scans every row and allocates a key Set proportional to that array length; it is not advertised as a complete incremental-query engine. Its meaningful saving is avoiding unrelated DOM reconstruction and layout work.

## Correctness discovered during optimization

The first pre-link transform discarded inherited TypeScript class-field and JSX settings. Actual emitted execution reproduced the changed setter behavior and missing JSX factory. A per-file unbundled esbuild build now preserves the existing configuration lookup and source maps. A second regression reproduced accidental development-mode selection before a production link; matching production minification in both passes fixes it. Root TypeScript/JavaScript configuration participates in profile identity. These are semantic tests, not string-only assertions that the output looks smaller.

Old exploratory browser samples are retained separately; they are not silently relabelled as measurements of a later source hash.

## Measurement contract

Trusted pointer clicks execute the real compiled app against its synthetic in-memory API, including actual save requests and checked final state. The event handler interval starts at capture and ends in the window bubble listener after the application handler. A committed-output assertion guards that interval. The next requestAnimationFrame interval is recorded separately; it is not field INP or proof of completed paint. DOM row replacement is counted in a separate diagnostic click with the observer disconnected during numerical trials.

Each size has one warmup page and seven independently created measured pages for each variant, alternating their order, with six timed clicks per page. Product limits remain unchanged: up to 200 rows per column, 1,200 visible rows per board, and 10,000 total rows spread across boards in the largest document. A table labelled 10,000 total does not mean 10,000 visible DOM rows.

Static requests are fulfilled from the exact emitted artifacts. Thus the experiment does not measure an external network download. Chromium retained heap is measured after explicit GC; WebKit has no invented heap value. Concurrent machine load, browser versions, every sample and output hashes remain attached. Small timer-resolution and frame-phase differences are preserved even when they do not favour state-lib.

## Reproduction

Set `STATE_BUILD_CLI` to this repository's `packages/state-lib/cli/bin/state`. In the Boards branch run `node --test tests/state-specialized-build.mjs`, then the regular application interaction suite with `MIGRATION_COMPILED_ROOT=dist/specialized-test`. Run `scripts/benchmark-compiled-board.mjs` with `BENCH_ENGINE=chromium` and `BENCH_ENGINE=webkit`, separate output directories, `BENCH_TRIALS=7` and an unused local port. Do not run another load-generating suite concurrently on the same machine. Native compiler and capture/row conformance tests must also pass.

Whole-app byte accounting includes every emitted runtime JavaScript file. Source maps and static assets are listed separately. Ordinary bundling, state-specific pruning, clone removal and row reuse are separate mechanisms; none is attributed to Wasm merely because the project also offers a Wasm compiler. The entry still contains the extra features its stronger state model requires, so comparison against the equally optimized original baseline remains visible.

## Recorded application result before review corrections

The recorded pre-review compiled artifacts passed 65 compiler tests, 53 capture/COW/row contracts, 392 Boards unit tests, four fixed-build contracts and 28 compiled application browser scenarios. Both browser runs retain seven independent measured pages per size/backend and six timed trusted clicks per page. Values below are milliseconds; each pair is **equally compiled baseline → state-lib**.

| Engine   | Total rows (visible) | Handler median | Handler p95 | Next-frame median | Next-frame p95 |
| -------- | -------------------: | -------------: | ----------: | ----------------: | -------------: |
| chromium |                1 (1) |        1 → 0.3 |   1.6 → 0.6 |       13.5 → 13.7 |    14.6 → 14.7 |
| chromium |              30 (30) |      2.1 → 0.4 |   3.2 → 0.8 |       13.5 → 12.6 |    14.6 → 13.9 |
| chromium |          1200 (1200) |     32.6 → 0.8 |    50 → 1.6 |        165 → 10.2 |   240.7 → 17.4 |
| chromium |         10000 (1200) |     56.3 → 0.8 |  83.3 → 1.4 |       192.3 → 9.1 |   278.7 → 16.5 |
| webkit   |                1 (1) |          2 → 1 |       3 → 1 |           11 → 11 |        15 → 13 |
| webkit   |              30 (30) |          4 → 1 |       5 → 2 |           18 → 10 |        24 → 12 |
| webkit   |          1200 (1200) |         82 → 1 |     102 → 2 |           401 → 6 |       523 → 12 |
| webkit   |         10000 (1200) |        107 → 1 |     157 → 2 |           344 → 5 |       508 → 11 |

Both engines avoid reconstructing any unrelated task rows on completion; the old renderer recreated the entire visible set. On Chromium at 10,000 total rows, retained JavaScript heap after GC changes from 15,574,328 to 4,730,908 bytes. At one and 30 rows the library retains roughly 29–32 KB more; those costs are not omitted. At one row the Chromium next-frame median is 13.5 → 13.7 ms and p95 14.6 → 14.7 ms: handler work is lower, but the frame-phase metric does not establish a win in every small case. Neither it nor the coarse WebKit timer is treated as a universal worst-case guarantee.

### Complete entry bytes

| Entry                      | Raw JS |  Gzip | Brotli |
| -------------------------- | -----: | ----: | -----: |
| specialized-test-baseline  |  96859 | 37132 |  32080 |
| specialized-test-state-lib | 112126 | 42150 |  36424 |
| state-bundle-only          | 118604 | 44214 |  38116 |

The previously copied state-lib distribution was 68,690 gzip bytes. Ordinary bundling accounts for most of the reduction to 44,214 bytes; static state/backend specialization then reduces that to 42,150 bytes. The equally optimized original baseline is smaller still at 37,132 bytes. This change therefore lowers the actual download relative to the prior distribution, but does **not** establish that the stronger state-lib application is smaller than the optimized baseline. Compiler modules and source maps do not enter the runtime count.

### Traceability to supplied materials

The owner-supplied master spec §5.1 requires zero semantic change and the same suite for compiled/uncompiled code; the TS/JSX/production regressions enforce it. §4.4 structural sharing and §8.5 persistence justify certified snapshot retention. §4.5/§6.1.4 motivate row-local view updates; the present plan is narrower than their full per-item collection implementation. §13 still sets whole-pipeline budgets. The supplied _Wasm, DOM и скрытая многопоточность_ report §1 and §11 separates algorithm, data representation, executor and thread: these gains come from less copying and fewer DOM mutations, not a claim that Wasm accelerated a JS setter. The supplied rendering-engine analysis recommends synchronous main-thread defaults for lightweight commits; no worker round trip is inserted into completion. The GRC report remains research input, not an automatically enabled prototype-Proxy mutation model. Existing correctness and enumeration semantics are not replaced by its experimental mechanism.

### Remaining work

Developer source volume has not yet decreased: explicit fixed-entry wiring and the small view adapter add code. Shared lifecycle/controller reduction is a separate active workstream (HYP-1738/UB-113), not counted as this implementation. The next performance gate expands from completion to movement, text entry, dense changes, cold loading and realistic mixed interaction; unsupported actions continue using the tested fallback. Independent remote application staging and its blocked role/auth configuration are also separate. No existing denial is bypassed and no production data is used.

Raw observations, source fingerprints, complete entry inventories and adverse/earlier runs: [evidence directory](2026-10-16-work-elimination/).

## Review corrections and release verification

The read-only review reproduced a browser-entry boundary bypass, missing transitive configuration identity and mixed JavaScript/map/manifest generations after an I/O fault. Their regression tests now pass. Authored alias-resolved files and JSON imports also have to remain under `browserRoot`. Configuration dependencies use TypeScript’s public JSONC/extends parser, stay inside the project, and are fingerprinted together with installed build-only parser/bundler code and lockfiles. A full source fingerprint is rechecked before output publication.

The complete output generation is prepared before a locked directory replacement; ordinary failures restore the previous generation, and a failed restoration retains its recovery path. Cleanup errors after commit are warnings rather than false build failures. This is not a power-loss filesystem guarantee. The pre-link pass was consolidated into one neutral multi-entry build, preserving local JSX names and final environment semantics; its actual file count/time appears in the manifest.

Application view cleanup now occurs after validating all target rows but before the first DOM write, matching the existing renderer’s error order. A throwing cleanup test reproduced the prior mismatch. Actual browser assertions additionally cover consecutive keyboard activation, accessible labels and preserved scroll.

The tables above remain a dated pre-review observation until the new runtime artifacts finish acceptance. They must not be treated as measurements of a later hash. Release observations, current source/config hashes and exact post-review test counts are added separately after the final run.

## Release acceptance, 21 October 2026

This section is a separate dated record. The 16 October observations above are retained unchanged as a pre-review record and are not relabelled. Everything below was measured on the review-corrected canonical source with the same Boards baseline (`90d06a8a`). Raw samples, screenshots, per-file inventories and source hashes are in [release-20261021/](2026-10-16-work-elimination/release-20261021/).

### Source and test status

The compiler reuses the single validated source inventory built before planning instead of walking the source root a third time; initial and final fingerprint walks remain the only two. Canonical path resolutions are cached within one build, and a failed publication-lock removal after commit is reported as a warning instead of a false failure. Strict Ruff is clean on the three touched Python files after narrow style repairs (import order, explicit `check=False`, bare re-raise, equivalent multi-context `with`). Other untouched compiler test files still carry inherited strict findings (`test_generated.py`, `test_generated_paths.py`, `test_wasm.py`); they are not part of this scope and are not claimed clean.

| Check                                             | Result                |
| ------------------------------------------------- | --------------------- |
| Complete compiler discovery (`unittest discover`) | 86 tests, all OK      |
| Capture / copy-on-write / row / command contracts | 53 pass               |
| Boards unit tests                                 | 395 pass              |
| Four fixed-build contracts                        | 4 pass                |
| Compiled browser scenarios (28)                   | see artifact equality |

The 28 compiled-browser scenarios were not re-executed. Rebuilding with the final compiler produced runtime JavaScript, HTML and CSS byte-identical to the artifacts that passed all 28 scenarios (SHA-256 `b83af585…` baseline and `f19621d5…` state-lib `app.js`; identical `index.html`, `style.css`, `refinements.css`), so that evidence applies to the final output. The bundle-only control rebuilds to the same `app.js` hash as before (`d99695e3…`).

### Complete entry inventory

| Entry                      | Raw JS |  Gzip | Brotli | All runtime files, gzip |
| -------------------------- | -----: | ----: | -----: | ----------------------: |
| specialized-test-baseline  |  96877 | 37132 |  32188 |                   44141 |
| specialized-test-state-lib | 112148 | 42166 |  36470 |                   49175 |
| state-bundle-only control  | 118626 | 44221 |  38165 |                   51230 |

Runtime files are JavaScript, HTML, CSS and the placeholder image; source maps are excluded and listed per file in `release-20261021/entry-bytes.json`. The previously copied state-lib distribution was 68,690 gzip bytes. Ordinary bundling and minification account for the reduction to 44,221; static specialization removes a further 2,055 gzip bytes (42,166). The equally optimized original baseline remains 5,034 gzip bytes smaller than the state-lib entry, so no smaller-than-baseline claim is made.

### Trusted-click measurements

Method as described above: real trusted clicks on the compiled application, one warmup page plus seven independent measured pages per case, six timed clicks per page (42 per cell), alternating variant order, no other heavy process of this task running. The host was not idle: other projects kept the 16 logical CPU machine at a load average of about 5 to 7 (Chromium start `[5.06, 5.30, 4.58]`, end `[5.98, 6.92, 5.57]`; WebKit start `[5.68, 6.82, 5.56]`, end `[6.95, 7.24, 6.21]`), recorded per sample in the raw files. Chromium 153.0.8010.12 and WebKit 26.6, run in that order. Milliseconds; each pair is equally compiled baseline → state-lib.

| Engine   | Total rows (visible) | Handler median | Handler p95 | Next-frame median | Next-frame p95 | Rows recreated by one click | Retained JS heap after GC (bytes) |
| -------- | -------------------: | -------------: | ----------: | ----------------: | -------------: | --------------------------: | --------------------------------: |
| chromium |                1 (1) |      1.6 → 0.5 |   2.3 → 0.7 |         11.1 → 11 |        12 → 12 |                       1 → 0 |             2,801,688 → 2,839,336 |
| chromium |              30 (30) |      3.7 → 0.6 |   5.7 → 0.8 |        14.2 → 9.9 |      23 → 11.1 |                      30 → 0 |             2,845,564 → 2,878,032 |
| chromium |          1200 (1200) |       63.2 → 1 |  82.5 → 1.3 |        311 → 13.8 |     409 → 21.1 |                    1200 → 0 |             4,342,224 → 3,245,656 |
| chromium |         10000 (1200) |     90.4 → 0.9 | 119.3 → 1.2 |      312.2 → 12.5 |   371.6 → 15.4 |                    1200 → 0 |            15,584,456 → 4,731,016 |
| webkit   |                1 (1) |          2 → 1 |       3 → 1 |           25 → 25 |        26 → 26 |                       1 → 0 |                     not available |
| webkit   |              30 (30) |          4 → 1 |       6 → 1 |           24 → 23 |        28 → 25 |                      30 → 0 |                     not available |
| webkit   |          1200 (1200) |         93 → 1 |     116 → 2 |           546 → 7 |       616 → 13 |                    1200 → 0 |                     not available |
| webkit   |         10000 (1200) |        167 → 2 |     198 → 2 |           611 → 8 |       697 → 17 |                    1200 → 0 |                     not available |

Adverse and neutral cases are kept in the table. At one row the next-frame medians are indistinguishable on both engines (11.1 versus 11 ms on Chromium, 25 versus 25 ms on WebKit) and the Chromium p95 is identical; the one-row handler difference is below the WebKit timer's one-millisecond resolution. At one and 30 rows the library retains about 38 KB and 32 KB more JavaScript heap on Chromium. The coarse WebKit timer reports integer milliseconds and no heap value exists for it. Handler time, next requestAnimationFrame interval and retained heap are separate measurements; the second is not field INP or completed paint, and network download is not part of these runs (artifacts are served from disk). The 10,000-row cases still show 1,200 visible rows by product limit. These cells describe the completion path on a synthetic local document under shared host load; they are not a universal certification, a full-application result, or a claim about other actions.

Matching screenshots of the final baseline and state-lib artifacts after one completion click are in `release-20261021/screenshots/` (Chromium 1,200 rows and WebKit 30 rows); the WebKit 30-row pair is byte-identical (same SHA-256 `61b5fdb3…`). The Chromium 1,200-row pair is not: the two 1280×900 PNGs (SHA-256 `764bcc29…` baseline, `52fe8a21…` state-lib) differ in 50 RGB pixels, all inside the bounding box (28, 30)–(1230, 54) (a 1,202×24 pixel region near the top of the frame), and are not distinguishable by eye at full size. This is a screenshot comparison only, not a runtime-equivalence proof and not evidence of a rendering mismatch; the cause of the 50-pixel difference was not investigated.

### Attribution and what is still separate

Ordinary bundling, static specialization (dormant engines and backend selector removed), snapshot capture (one fewer whole-document clone per edit) and row-local rendering are separate mechanisms, and the bytes above credit bundling separately from specialization. Not proven here and kept separate: reduced authored application source (the fixed-entry wiring and view adapter add code), general edge-case admission, other actions and Tasks, shared lifecycle reduction (HYP-1738/UB-113), and the four independent cloud stages (no cloud application was created or measured).
