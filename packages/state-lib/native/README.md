# Native StateIR write-set kernel

This is the first native implementation boundary, not the complete state library.
It uses Rust executable code and Verus specifications in the **same kernel module**.
The executable kernel passed Verus with **9 verified items and 0 errors** in
[run 34649516983](https://github.com/hyperide/hyper-saas/actions/runs/34649516983),
at commit `44a347ed225e66cfb6fd739a117b15a6159a4803`. The same compiled binary passed
**16,082 command results** against the independent oracle; the verifier rejected both
publication and revision mutants for genuine proof failures. The source-bound manifest
is retained in `evidence/2026-09-11/verification.json`. This is evidence for that exact
source and scope, not a blanket proof badge for the library or for future revisions.

## Contract

A snapshot contains fixed scalar `i64` slots and a `u64` revision. A commit receives
an expected revision and a canonical write-set: final writes sorted by ascending
slot, with no duplicate slots. The method checks all inputs before changing a slot.
Stale revisions, invalid indices, noncanonical writes and revision overflow return
an error without changing either the snapshot or its revision. An empty/no-op
write-set succeeds at the same revision, including at the maximum revision.
A changed accepted write-set applies all requested values and advances exactly once.

The Verus contract states acceptance in **both directions**, not just “if it succeeds,
it is correct”: a valid input must succeed as well. It specifies exact resulting
values and an unchanged snapshot on every rejected path. Safe index reads return
`None` outside the snapshot rather than panicking.

```text
TypeScript event (future compiler)
  -> final writes, sorted/unique (future checked boundary)
  -> native commit: stale check -> complete read-only preflight
       error: unchanged snapshot and revision
       no-op: same revision
       changed: publish writes -> revision + 1
  -> changed slots / reactive engine (next implementation layer)
```

Both scans touch only the supplied write-set, not the full snapshot. The commit
body does not clone the snapshot or allocate a second state vector. Proof-only
sequences and invariants are erased before execution. This is an implementation
cost argument, **not a measured speedup over JavaScript**. Initial snapshot ownership
and building/canonicalising the write-set are separate costs.

## Reproduce and inspect evidence

Use the pinned Verus release from `.github/workflows/state-native-verify.yml`, or set
`VERUS` to that executable, then run:

```sh
./tools/verify.sh
```

The gate verifies and compiles `src/main.rs`, including the executable kernel module,
then drives the resulting binary against an independent Python model through 16,000
seeded transactions plus explicit integer-limit, empty/no-op, invalid-index, stale,
duplicate and unsorted cases. These tests do not substitute for the proof.

Negative controls deliberately break value publication and revision advancement;
an additional reject-all control challenges the non-vacuous acceptance contract.
The verifier must reject them for a failed assertion, invariant or postcondition;
a tool crash or parse failure is not accepted as a negative proof control. CI retains
the complete verifier output, control logs, conformance result, binary and a manifest
binding successful evidence to the kernel and executable SHA-256 hashes. No local
`assume`, `admit` or external-body proof bypass is allowed in the kernel.

## Exact trust and applicability boundary

Atomicity here means failure atomicity at a synchronous, exclusively borrowed Rust
call boundary. It is **not** hardware-atomic concurrent publication, crash durability,
a distributed transaction, or a proof of arbitrary client application code.
The parser/I/O driver, Rust compiler, standard library, Verus, SMT solver and vstd
specifications remain trusted boundaries. Source verification is not machine-code
compiler verification. The Verus release requires its matching Rust 1.98.0 toolchain;
that pin is not a claim that the compiler has no defects. Z3 4.16.0 is independently
downloaded at the official pinned archive digest and recorded in the evidence.

Not implemented here: TS lowering, write-set canonicalisation, immutable structural
snapshots, nested savepoints, worker/shared-memory publication, scalar dependency
graphs, collection IVM, tasks, persistence, framework adapters, LSP or MCP. The TS
reference kernel in the consolidation PR remains a different implementation and
has not been proved equivalent to this module. Independent Kani checks are a next
verification layer, not claimed as completed by these Verus checks.

Part of HYP-1457. The next vertical slice connects typed StateIR operations and TS
conformance fixtures to this boundary without weakening its acceptance contract.

## Harness hardening and native macOS validation — 2026-09-13

The conformance runner now rejects missing or incorrect output even under Python
optimization. Twelve subprocess controls exercise normal, `-O`, and environment-enabled
optimization. The negative-proof classifier has 132 synthetic controls and requires a
completed verifier rejection; crashes, parsing/compiler errors and incomplete output
are not accepted as proof failures.

The corrected harness ran on **macOS arm64**, using the same pinned Verus release,
Rust 1.98.0 and Z3 4.16.0. Official archive digests were checked before execution.
The real run reports **9 verified items, 0 errors**, **16,082 oracle results** and
rejection of all three mutants for proof failures. This is a native macOS result,
not a new Linux CI result. The kernel is unchanged from the earlier Linux evidence.

`evidence/2026-09-13-macos/verification.json` binds this result to the kernel,
compiled executable, driver, oracle, regression controls and verification scripts.
The adjacent text logs retain actual verifier, oracle and control results. These
controls strengthen the evidence machinery; they do not expand the kernel's proof
scope or prove compiler/FFI/reactivity behavior. Part of HYP-1461; HYP-1457 remains
the broader, unfinished implementation programme.
