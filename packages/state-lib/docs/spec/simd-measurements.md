<span id="simd-measurements" class="anchor"></span>

### Measured SIMD, algorithm changes and the direct-DOM baseline

**Measured experiment, September 8, 2026.** Chromium 144.0.7559.96, Linux x86_64, clang 17.0.0. This is warmed compute on an owned about:blank page, not a current-browser matrix, network/worker/DOM benchmark or INP measurement. No browser security policy was bypassed. Node 22.16.0 results are retained separately.

The query computes the same count, exact integer sum and first 50 matching IDs in source order. Cases cover sparse, mixed and dense matches. There are 1,200 edge-correctness checks, warmup, 15 samples per measured variant and randomized variant order. Fixture creation, packing, memory growth and copy costs are recorded separately and are **excluded** from hot-loop times.

Million-row median milliseconds:

| Variant | Sparse | Mixed | Dense |
|---|---:|---:|---:|
| js-objects | 3.2500 | 8.3000 | 5.2000 |
| js-soa | 1.9500 | 8.5000 | 3.2000 |
| wasm-scalar-aos | 1.2000 | 3.9000 | 0.8625 |
| wasm-scalar-soa | 1.3000 | 3.8500 | 0.9000 |
| wasm-scalar-split | 1.0500 | 1.0250 | 1.0250 |
| wasm-auto-split | 0.6750 | 0.6500 | 0.6500 |
| wasm-auto-explicit | 0.5125 | 0.5875 | 0.4188 |
| wasm-auto-host | 16.3000 | 19.4000 | 17.3000 |

#### What actually prevented SIMD

The fused kernel combines a reduction with variable-length output compaction (`out[count]`). LLVM's diagnostics reject vectorizing these dependencies. Changing AoS to SoA alone did not remove the obstruction. Separating the aggregate loop from the short prefix-ID pass allowed LLVM to emit a vectorized reduction. An explicit wasm_simd128 version supplies another comparison. Generated assembly and diagnostics are preserved.

For mixed matches the scalar SoA fused loop is about 3.85 ms; rewriting it as two scalar passes gives about 1.025 ms. That is an **algorithmic** improvement. Enabling auto-SIMD on the same split algorithm yields about 0.65 ms, approximately **1.58x** further improvement. Do not attribute the entire difference to SIMD. uint64 accumulation avoids enabling unsafe floating-point reassociation; totals must fit the documented exact-number range.

The host-getter kernel does not pack JS objects, but calls ordinary imported JS accessors about twice per row. It is not a JS-string-builtin test. Its slower result illustrates that avoiding a bulk copy can introduce a larger repeated boundary cost; it does not prove every possible host-import workload is slow.

#### What direct DOM meant

The previous prototype compared direct writes to existing DOM nodes against a store transaction plus reactive bindings producing equivalent DOM writes. The direct path did not provide validation, logs, optimistic state or subscriptions. It was a lower-bound overhead baseline, not a claim that a framework can make the browser's identical DOM setter intrinsically faster. A framework can beat a naive application by avoiding redundant writes, using better batching and preventing repeated forced layout; that must be measured separately with equal semantics.

Reproduce from `experiments/2026-09-08`: `python3 build.py`, then `node run-node.mjs` or `python3 run-browser.py`. The browser runner requires Playwright and an installed Chromium executable. Raw samples, binary hashes and compiler diagnostics are included in the delivered experiment archive. Full existing-site integration gates and Safari/Firefox were not run in this environment.

Sources: [LLVM vectorizers](https://llvm.org/docs/Vectorizers.html), [vectorization legality source](https://llvm.org/doxygen/LoopVectorizationLegality_8cpp_source.html), [Wasm SIMD guidance](https://emscripten.org/docs/porting/simd.html).
