# State access, query algebra and real SIMD experiments

Research/prototype revision, 2026-09-08. This directory is standalone; it does not require the previous uncommitted lab archive. It is not yet a replacement for the complete state-lib prototype.

## Run

Node 22+, Python 3.10+, TypeScript 5.8.3 (local or globally installed); clang 17 with wasm32/wasm-ld for rebuilding the SIMD kernels. TypeScript is used by compile-access.mjs. Actual typia generation was not run; tests inject explicitly labelled fixture validators.

```sh
node --test *.check.mjs
python3 build.py
node run-node.mjs
python3 run-browser.py
```

The browser runner additionally requires Python Playwright and Chromium; it uses the installed browser for an owned about:blank compute experiment, not a deployed website. No network, worker, SAB, DOM, layout or INP result should be inferred. Build commands, compiler remarks, assembly, binary hashes, randomized sample timings and full correctness checks are written to results/.

## Public access

The normalized experiment accepts separate tables with scalar fields and foreign keys. `store.state.invoices[1].customer.name = '…'` writes the one authoritative customer. `store.action(name, fn)` returns a callable synchronous action closing over store. One setter outside an action is one implicit commit. The runtime fallback registers ordinary table getters; compiled:true plus compile-access avoids O(N) property registration. The compiler preserves LHS-before-RHS evaluation and shadowed identifiers.

Limitations: narrow static member-path transform; no production JSX/schema compiler; reverse-FK deletion scans and observer scanning remain; cache eviction/snapshots/optimistic-layer integration are not complete. Do not equate expected O(1) field resolution with O(1) entire commit cost.

## Query corpus

corpus.mjs contains 38 exact task pairs, each with native JS and experimental operators; operators.check.mjs runs every pair. The documentation site's /queries page renders and runs those actual functions. Other library/SQL/jq/Datalog adapters are not claimed as implemented. This does not replace the earlier 22-case production-selector research corpus.

## Documentation integration

Canonical amendments live in ../../docs/spec. The existing site composes them into the appropriate master-spec chapters, links them from related pages, and adds /queries and a generated-prototype /api page. This avoids an isolated ideas.md and avoids drifting copies of the new chapters. The old master-spec mirror remains unchanged.

Local core/operator tests and compute experiments ran. The full existing-site bun check suite and production deployment did not run in this environment; this PR remains draft until those gates pass. The complete raw result archive accompanies the response; kernels and harnesses here reproduce it.
