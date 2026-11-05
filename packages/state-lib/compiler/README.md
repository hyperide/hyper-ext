# state build — compiler preview

Python CLI → Rust/Oxc analyzer and planner → static ESM bundling. This implements a real, deliberately narrow first slice of R23/R24: explicit, evidence-qualified module specialization. It is not arbitrary TypeScript lowering, automatic React mode selection, a type checker, or automatic workerization.

## Run from packages/state-lib

```sh
cargo build --locked --manifest-path compiler/Cargo.toml
(cd build-tools && bun install --frozen-lockfile)
./cli/bin/state doctor --config experiments/2026-09-18-compiler/projection-fixture/state.config.json
node experiments/2026-09-18-compiler/measure-projection.mjs
./cli/bin/state build --config experiments/2026-09-18-compiler/projection-fixture/state.config.json --profile experiments/2026-09-18-compiler/results/projection-profile.json
./cli/bin/state explain --config experiments/2026-09-18-compiler/projection-fixture/state.config.json --profile experiments/2026-09-18-compiler/results/projection-profile.json
```

`cli/bin/state` is the supported repository-local executable. A separately installed Python wheel alone does not include the native compiler and bundler; a distributable installer is not implemented. `STATEC_BIN` can select an explicitly installed native binary. No binary is downloaded implicitly.

## Contract

The config explicitly identifies a source root, entry, output directory, targets, capabilities, lower-is-better metrics, cases, semantic contract, synchronous/asynchronous timing, and each candidate implementation. The fixture is the executable schema example. Profiles come from a trusted benchmark producer; a matching test hash and `passed` flag are evidence metadata, not a proof or signature.

A candidate is eligible only when every declared target/case/metric has enough finite nonnegative observations and `max(candidate) <= min(baseline)` in each cell. A mean win cannot hide one losing case. Missing/stale evidence falls back to baseline. All zero-duration cells are unresolved for strict improvement; a coarse timer does not prove zero cost. A worker cannot implement a synchronous contract. Target capabilities are explicit build inputs, not inferred from the machine running the build.

Oxc parses the source program and proves the supported facade is exactly a single named re-export with no executable body, directive or import attributes. The compiler changes only its module source literal, preserving export names, aliases and subset. Side-effectful facades are not optimized. Baseline output follows the original import graph unchanged. Profile hashes cover config, source-root files including Wasm assets, project locks, and the relevant compiler/bundler sources.

The actual candidate bundle is also compared to the original bundle in raw and gzip bytes. Growth rejects the specialization. The result contains `app.js`, an external source map, `state.manifest.json` and an ownership marker. No strategy dispatcher or native compiler ships in the runtime bundle. `--mode baseline` forces the original graph; `--require-improvement` fails rather than silently claiming an improvement. Non-generated output directories and project escapes are rejected.

The implementation expects trusted, well-formed project config and benchmark files. It is not a hardened remote compilation service or a complete JSON-schema validator. It does not execute arbitrary user config as code. Build dependencies run with the developer's ordinary local permissions.

## Verification and limits

```sh
python3 tests/compiler/test_cli.py
cargo fmt --check --manifest-path compiler/Cargo.toml
cargo clippy --locked --manifest-path compiler/Cargo.toml -- -D warnings
ruff check --select F cli tests/compiler
node --test experiments/2026-09-18-compiler/grc-counterexamples.test.mjs
```

The 15 end-to-end tests include exact baseline bytes, real result execution, stale source/Wasm assets, one losing case, sync-worker rejection, capability rejection, parser errors, ownership/path guards, facade effects and named-export preservation. These gates cover the preview; they do not certify all of the master spec. Tests exposed facade-side-effect erasure and asset-fingerprint omissions before their fixes.

The conservative sample rule is a promotion criterion, NOT a mathematical bound on every future execution. No algorithm can infer all future browser scheduling or workload distributions from nine measurements. App-wide latency, memory, accessibility, developer effort and baseline semantic equivalence need their own acceptance matrix. A faster but weaker contract must not qualify under the same contract ID.

See [research report](../docs/research/2026-09-18-compiler/REPORT.md) and [hypotheses](../docs/research/2026-09-18-compiler/HYPOTHESES.md).

## Review follow-up

The actual bundler records which facade loads were rewritten. An extensionless/aliased/unmatched import that the preview cannot specialize retains baseline with an explicit reason, never a false selected-candidate claim. Ties and timer-limited cells retain baseline; `doctor`/`explain` are marked analysis-only, whereas the build manifest is marked emitted-and-size-checked. The all-baseline path reuses one bundle pass. UTF-8 streaming is explicit. Candidate equivalence must include module initialization effects, not just return values. Output files are replaced individually, not as an atomic multi-file directory transaction.

## Application-research diagnostic regression — 2026-09-19

The CLI conformance suite now has 18 tests. `worstObservedRatio` includes rejected as well as accepted observation cells; missing observations produce null, not zero. A positive candidate over a zero baseline yields null plus `worstObservedRatioUnbounded: true`; `observedCells` states coverage. These diagnostics do not weaken the per-cell admission gate. See the separately rejected [COW application experiment](../experiments/2026-09-19-cow/REPORT.md). Profiles made before compiler-source changes remain historical and must be regenerated by the benchmark producer, not relabeled with a new hash.
