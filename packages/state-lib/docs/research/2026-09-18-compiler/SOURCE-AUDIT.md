# Source audit: supplied material versus new evidence

Original files are never edited. IDs and SHA256 values are in SOURCES.json. Source-dependent statements below are attributed to the original; corrections are independent checks. The original old benchmark ZIP mentioned by S5 was not attached and was not reproduced.

**S1 — master spec draft v0.2.** Its optional disappearing compiler, per-case non-regression budgets, explicit scopes and split runtime/tooling are the baseline intent (§1,§5,§11,§13). The repository contains a later v0.6 and subsequent decisions: #23 specifies Python CLI and Rust compiler; #12 changes React mode policy relative to the attachment. We preserved those canonical decisions. This first compiler implements explicit strategy boundaries, not the complete analyzer, React mode inference, init/migrate/MCP or TypeScript type checker.

**S2 — Gradual Reactivity Compilation.** Page5 proposes static accessors, compiled computed-key helpers and a Proxy prototype fallback. Page7 suggests prototype has/ownKeys could close enumeration gaps. Our executable tests disprove that enumeration repair: Object.keys/Reflect.ownKeys inspect the receiver's own keys and do not call its prototype's ownKeys trap. The has trap affects `in`, which is not equivalent. Deleting an existing own accessor bypasses a prototype delete trap. Promoting a missing key on read changes later enumeration. Extracting a method through a helper can lose `this`. These do not make scoped GRC impossible; they prohibit treating its example as a transparent general-purpose store. Accessors are not guaranteed as cheap as plain data fields. JIT observations are engine/version-specific, not portable constants.

**S3 — rendering engine analysis.** The main-thread DOM boundary and separation of same-thread Wasm memory from worker transport remain useful. The new run verifies worker.document is absent and the modern string/streaming path actually executes. The source explicitly reports no new benchmarks of its own; its earlier transfer numbers are not our current measurements. Reconciliation offload is not automatically latency improvement, and a queued worker is not synchronous state.

**S4 — six threads beyond push-pull.** Keep scalar reactivity, incremental collection operators and rendering scheduling as separate decisions. DBSP/differential dataflow/Salsa are specific tools with state, output and operator costs; do not translate the source's broad 'more powerful' phrasing into universal O(delta) performance or a universal signal ceiling. Semantic HTML priorities, subtree serialization/revival and automatic Canvas takeover remain hypotheses. No negative literature search proves universal novelty. We have not implemented or benchmarked those ideas in this slice, nor established physical-mobile/ARIA correctness for them.

**S5 — Wasm/DOM/state report.** Retain its four-axis distinction: algorithm, data representation, executor and placement. Its object-packing and typed-buffer resident timings answer different questions. Our new eight-round uint32 experiment uses the same representation and checksum, separately reports worker startup/ingest, and tests both isolated and ordinary pages without browser safety flags. This does not reproduce the old Linux/Chromium144 benchmark, compare arbitrary JS callbacks, demonstrate SIMD speed, or establish application INP.

## Revalidated public references (accessed 2026-09-18)

- [W1] WebKit, Safari26.6 release: https://webkit.org/blog/18178/webkit-features-for-safari-26-6/ —26.2 string builtins,26.6 streaming compileOptions.
- [W2] MDN Atomics.waitAsync: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Atomics/waitAsync —non-blocking API, main-thread availability, shared-memory preconditions.
- [W3] MDN Scheduler: https://developer.mozilla.org/en-US/docs/Web/API/Scheduler —limited availability; no universal postTask/yield assumption.
- [W4] WHATWG DOM issue1217: https://github.com/whatwg/dom/issues/1217 —proposal about detached/offscreen DOM, not access to the live document.
- [W5] ECMAScript Object.keys: https://tc39.es/ecma262/2026/multipage/fundamental-objects.html#sec-object.keys and EnumerableOwnProperties: https://tc39.es/ecma262/2026/multipage/abstract-operations.html#sec-enumerableownproperties .
- [W6] MDN Wasm JS builtins: https://developer.mozilla.org/en-US/docs/WebAssembly/Guides/JavaScript_builtins —supported operations and explicit options; no general host-heap access.
- [W7] MDN WebAssembly.Memory.grow: https://developer.mozilla.org/en-US/docs/WebAssembly/Reference/JavaScript_interface/Memory/grow —refresh views after non-shared memory growth.
- [W8] Shared-everything threads draft: https://github.com/WebAssembly/shared-everything-threads —a separate evolving proposal, not a property of ordinary SharedArrayBuffer.
- [W9] Oxc parser: https://oxc.rs/docs/guide/usage/parser and esbuild plugin contract: https://esbuild.github.io/plugins/ . Local locked versions are recorded with the source.

Public references establish platform/implementation contracts, not the numeric results of our experiments. Engine binaries are Playwright builds, not a verification of each vendor's latest stable release or real iPhone.
