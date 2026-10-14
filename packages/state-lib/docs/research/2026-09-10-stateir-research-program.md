# StateIR research program

Research draft, 10 September 2026.

This document records the current direction for HYP-1457 after reconciling the state-lib research with the 7-8 September Wasm, GRC and incremental-computation investigations.

## Deliverables

The research is split into one white paper and three implementation specs:

1. **StateIR: A Verified, Incremental State Architecture for TypeScript Applications** - motivation, prior art, four-engine synthesis, TypeScript verified islands, node_modules boundaries, Wasm/shared-memory model, MLIR trade-offs, hypotheses and evaluation plan.
2. **S1 - Core Semantics and Proofs** - snapshots, atomic commit/abort, derives, invariants, task generations, refinement properties and proof obligations.
3. **S2 - TypeScript Frontend and Interop** - familiar TS syntax, verified subset, implicit event-turn transactions, effect/escape analysis, node_modules package summaries, translation validation, LSP/VS Code/MCP diagnostics.
4. **S3 - Incrementality, Execution and Backends** - red-green scalar computation, DBSP/differential collection deltas, Wasm representation, workers/SharedWorker, SharedArrayBuffer/shared WebAssembly.Memory, string builtins/externref/ropes, backend cost model and optional MLIR lowering.

## Architectural decision under research

StateIR is a small semantic IR, not a new general-purpose source language. Application authors should continue to write TypeScript. Only state-critical islands need semantics narrow enough to translate and verify. The implementation target is Rust, with Verus as the primary executable-code proof system and Kani as an independent model-checking layer. LLVM is the first optimized code-generation backend. MLIR is a candidate multi-level optimizer once StateIR operations and laws stabilize.

The runtime is divided by responsibility rather than by process:

- transaction/snapshot kernel: versions, staging, atomic commit, rollback, invariants, history;
- scalar dependency engine: red-green validation, lazy pull, equality cutoff and durability;
- collection engine: DBSP/differential-style deltas, indexes, joins, grouping and materialized views;
- temporal/task engine: FSM semantics, commands, effects, structured concurrency, cancellation and supersession.

Unused engines must erase at build time. They may live in one native binary/Wasm module or be split between main and workers according to measured cost and capability constraints.

## Clarification: pack + Wasm

The earlier 7.25 ms `pack + scalar Wasm` benchmark was intentionally a one-shot ingestion path: ordinary JS records were copied into contiguous Wasm linear-memory fields before executing the kernel. It was not a resident shared-memory architecture. SharedArrayBuffer/shared WebAssembly.Memory, transfer, externref and JS string builtins were investigated separately; rope/chunk representations were architectural candidates rather than part of that timing. SharedWorker was not the worker primitive measured, and shared-everything Wasm threads remain a draft proposal.

This distinction becomes an explicit benchmark rule: algorithm, representation, executor and placement are independent variables. Resident Wasm must not be compared to JS including ingestion without labeling the difference.

## Beginner atomicity rule

The common case should not require a developer to know the word `transaction`. All synchronous writes triggered by one registered event/callback are staged and published as one version by default. The compiler escalates only when an async suspension, opaque re-entrant call, timer, callback escape or declared invariant makes the atomicity boundary ambiguous. If a declared invariant is violated by an intermediate publish but restored by a later write, the compiler can reject the split rather than merely recommend batching.

## node_modules boundary

The initial plan is package effect/escape summaries, cached by package content hash and compiler version, rather than wholesale translation of npm. Each foreign boundary is classified as pure, read-only, known mutator, tracked live facade, foreign capability, or rejected. Passing reactive state into opaque code must never silently drop tracking. A research direction is proof-carrying package summaries that expose mutability/retention/async/nondeterminism contracts without putting the entire package implementation inside StateIR's trusted computing base.

## MLIR position

MLIR is attractive because a custom `state` dialect can retain high-level operations such as transaction commit, delta join and task spawn long enough for domain-specific fusion, vectorization, bufferization and async lowering before reaching LLVM. It is not mandatory for v0 because StateIR semantics are still changing; encoding unstable semantics immediately in C++/TableGen would multiply implementation surface. The direct StateIR -> Rust backend remains the reference. A small shadow MLIR dialect should be introduced after the semantic model survives multiple revisions and only promoted if it yields concrete compiler or runtime wins.

## Claims that remain hypotheses

- The four-engine composition can preserve near-zero orchestration overhead through static erasure/fusion.
- Translation-validated TypeScript verified islands can retain familiar ergonomics while materially reducing state bugs.
- Package summaries plus escape analysis can prevent silent reactivity loss across practical npm ecosystems.
- Backend placement can be inferred from purity/capability properties plus measured cost models instead of exposed as an application-level API choice.
- Representative equal-semantics workloads can outperform hand-written vanilla JS once the vanilla baseline must provide the same atomicity, incremental queries, history and stale-task safety.

All of these require reproducible measurements and explicit proof/refinement coverage before being stated as achieved properties.