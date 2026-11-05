# One compiler core in the CLI and browser

The Rust planner and command generators now live in `compiler/src/lib.rs`. The native binary remains a stdin/JSON adapter; the browser calls the same library through `compile_json`. The Wasm boundary parses source and generates modules without evaluating the supplied application code.

`compiler/build-web.sh` uses the pinned wasm-bindgen CLI and builds the **library** target. Building the CLI executable for wasm32 is not equivalent: its `main` expects stdin and may exit. The initial parity tests caught that packaging mistake before the working browser artifact was accepted.

The browser entry bounds requests to four MiB. Its host runs compilation in a disposable worker and uses a closed in-memory source tree. The ordinary native build admission policy is unchanged. The workbench deliberately builds both declared candidates for comparison; it does not mark an unqualified candidate as a selected production implementation.

## Verification

The seven new tests cover exact native/Wasm planner parity, repeated calls and real syntax diagnostics, malformed/oversized input, and inclusion of the shared library/Cargo configuration in the profile fingerprint. Together with the existing command, path-ownership and size-budget contracts, the discovered compiler suite has 51 tests.

The site worktree also executes native-generated functions in Chromium, Firefox and WebKit. Runtime/history, application source and reachable library modules are present in both compared entry graphs. Edited-code execution is isolated from page storage and network; it is a different worker from the trusted compiler.

## Reproduce

Run `cargo build --locked --manifest-path compiler/Cargo.toml`, `bash compiler/build-web.sh`, then `python3 -m unittest discover -s tests/compiler -p 'test_*.py'` from `packages/state-lib`. The browser artifacts are generated into ignored `compiler/pkg-web`; the site publishes an explicitly hashed copy with its example source manifest.

Changing compiler source or its Cargo configuration invalidates older qualification profiles. Historical controller results remain historical. The interactive examples add direct source-to-output exploration; they do not imply that every legacy example, full application migration or remote measurement database is complete.

## Review corrections

The web size/panic settings now live in a dedicated profile inheriting release, so native release defaults remain unchanged. Parity tests include a fresh accepted profile and an unbounded-ratio rejection, not only missing-profile fallback. Repeated calls and recovery from a returned parse error run within one Wasm instance. The build records source and native/Wasm artifact hashes; tests reject stale artifacts instead of trusting file presence.

The browser parity review also exposed a32-bit sample-count truncation: a minimum of2^32 could wrap to zero on Wasm and admit empty samples. A direct red test reproduced the wrong selection. The planner now retains the count as u64 and compares widened lengths, preserving the native policy on both targets. Values2^32,2^32+1 and2^64−1 are explicitly compared.
