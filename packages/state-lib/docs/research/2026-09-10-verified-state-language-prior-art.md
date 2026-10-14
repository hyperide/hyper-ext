# Verified state engine language prior art — 2026-09-10

This pass asks a narrower question than the earlier JS/Wasm research: if the production state engine must be statically compiled, low-overhead, and amenable to machine-checked proofs, which existing language/compiler lineages are credible foundations?

## Executive conclusion

Do not fork Elm, Reason/ReScript, Idris, Vale, or a synchronous language as the production implementation language. The strongest practical substrate is **Rust for executable code**, constrained by a small state-specific semantic layer, with **Verus-style deductive verification for the proof-bearing core**, **Kani for complementary model checking/unsafe boundaries**, and a separately mechanised semantic model for the State IR. Native release builds can continue through rustc/LLVM; Wasm is a first-class target. If compiler correctness becomes a product requirement, prove StateIR lowering separately rather than attempting to verify rustc/LLVM wholesale.

The important research direction is therefore not “invent a whole general-purpose language”. It is a **small statically checkable state language / IR embedded in familiar Rust syntax and generated from higher-level adapters**. Its language rules should make the undesirable state bugs unrepresentable or diagnosable: deterministic transactions, explicit effects, total state-machine transitions, ownership/regions for mutable state, stable identities, versioned snapshots, and declared async/cancellation boundaries.

## Prior art worth stealing

### Rust + Verus / Kani / Prusti family

Verus keeps executable code as ordinary Rust while adding specification and proof modes that erase from the executable. This is the closest match to “one implementation, proofs beside it, no production proof overhead”. Kani provides model checking over Rust, function contracts and loop contracts and is especially useful for unsafe, arithmetic, finite protocol-state and counterexample work. Prusti demonstrates a second Rust→verification-IR route through MIR/Viper but currently supports a narrower Rust surface.

Decision: prototype the executable kernel in verifier-compatible Rust and deliberately keep the trusted kernel small enough that we can verify it without fighting arbitrary ecosystem code.

### F* / Project Everest

F* is a verified-programming language with dependent types and SMT automation and has demonstrated extraction to C, Wasm and assembly in Project Everest. It proves that high-performance, low-level, verified software is practical. Its cost for this project is ecosystem and ergonomics: making it the user-facing implementation language would create a larger integration burden than Rust. We should reuse its design ideas—effect separation, ghost specifications and verified boundary code—not adopt F* wholesale yet.

### CompCert, CakeML, verified Lustre

CompCert proves source-to-assembly semantic preservation for most of its compiler pipeline and provides a useful definition of what “verified compiler” actually means. CakeML demonstrates an ML-family language plus a verified backend. Verimag's verified Lustre compiler is especially relevant because Lustre is a deterministic synchronous/reactive language and the compiler lowers to CompCert's Clight. These systems show the strongest end-to-end assurance path, but they are poor direct foundations for an ergonomic general UI/data state toolkit.

The transferable idea from Lustre/SCADE is more important than the source language: **a deterministic tick/transaction semantics with explicit temporal state**. We should model the synchronous subset of state transitions this way while allowing explicit asynchronous effects outside it.

### Lean / Rocq / WasmCert

Lean is attractive for metatheory and executable specifications, and current Lean 4 uses LLVM in its toolchain. Rocq has the strongest verified-compiler lineage through CompCert. WasmCert provides mechanised Wasm semantics and type-safety results. These are best treated as semantic/proof infrastructure, not as the primary runtime language.

### MLIR + LLVM / Cranelift

MLIR is a good fit for a StateIR because it is explicitly designed for domain-specific dialects, dataflow graphs and lowering to LLVM. LLVM remains the optimizing production backend. Cranelift is worth retaining as a future fast-development backend where compile latency matters more than peak optimization.

Decision: do not start with MLIR. First make the StateIR semantics small and executable in Rust. Introduce an MLIR dialect only when there are real cross-target optimizations—operator fusion, layout specialization, SIMD/vector lowering, query plans—that justify the dependency.

## Reactive/runtime prior art

Qt QProperty/QML provides mature dependency-tracked property bindings in native C++ and demonstrates both the ergonomics and a failure mode: non-bindable dependencies can silently escape tracking. Apple Observation demonstrates compile-time macro generation of observation plumbing. Jetpack Compose snapshots are relevant for nested/versioned mutable snapshots and thread-local consistent reads. React Native Reanimated worklets demonstrate build-time extraction of small functions to another runtime/thread and the importance of minimizing captured data.

For computation, do not use one algorithm everywhere. Salsa/rustc's red-green query system is the strongest model for demand-driven memoized scalar/DAG computation with early cutoff. DBSP/differential dataflow is the stronger model for large collection queries and incremental joins/aggregates. The prior research's two-tier conclusion stands: scalar state and collection state need different incremental engines.

## Proposed new research object: StateIR

StateIR should have a tiny formal operational semantics and initially only these primitives:

- immutable values and stable entity IDs;
- cells/inputs and pure derived functions;
- atomic transactions with a staged write set and one commit version;
- dependency capture and deterministic invalidation;
- explicit effects/tasks outside the transaction;
- state machines with exhaustive transitions and guards;
- versioned snapshots and rollback;
- collection deltas as a distinct algebra from scalar invalidation;
- region/ownership declarations for cross-thread or Wasm-owned state.

The first theorems to mechanise are: atomicity (failed transaction publishes nothing), snapshot consistency, no observer sees a half-commit, deterministic result for a fixed event sequence, dependency-wave completeness, notification at-most-once per committed version, rollback inversion for reversible patches, and race freedom for the single-writer/shared-reader ownership protocol.

## Rejected as primary bases

Elm/ReScript are excellent ergonomics/reference designs but compile primarily for JS ecosystems and do not give the proof/performance path required here. Idris gives dependent types but its mainstream backend/runtime story is less suitable for a low-overhead systems core. Vale is still explicitly alpha and therefore unacceptable as a production foundation. SCADE is mature and safety-oriented but proprietary/domain-specific. Building directly on full Lean/F*/Dafny would optimize proof convenience at the expense of runtime ecosystem and adoption.

## Next implementation spike

Create `packages/state-lib/runtime/` as an independent Rust workspace. Implement only the transaction + scalar dependency kernel first, with zero framework dependencies. Add a reference interpreter for the same StateIR, differential tests between interpreter and optimized kernel, verifier contracts, Kani counterexample harnesses, and equal-result benchmarks against hand-written direct Rust/JS baselines. Only after the semantics are stable should normalized relations, DBSP-like collections, adapters, LSP/MCP and framework bindings be layered on top.
