# Workspace test routing (HYP-1460)

Run `bun run test` from the repository root for the complete local test sequence.
Install the root dependencies with `bun install --frozen-lockfile`. The standalone
site also needs its own frozen install in `packages/state-lib/site` and Chromium
(`bunx playwright install chromium` from that directory), as required by its existing gate.

The coordinator runs three processes in order: application tests, Bun-native package
tests, and the complete state-lib site gate. `bun run test:packages` intentionally
runs the last two, including the site's builds and browser checks. The existing CI
jobs and `ci/local-checks.sh` have separate scopes; they are not silently relabelled
as having run this complete sequence.

Site `tools/*.check.mts` files are standalone checks; the site gate discovers all of
them and launches each in its own Node/tsx process. Node experiment `*.check.mjs`
files are collected recursively by `node-experiments.check.mts` and run with Node's
test runner. This preserves the compiler data-URL and exact-source contracts without
asking Bun's transpiler to retain Node's Function.toString representation. Runtime
and other Bun-native package tests keep their normal discovery names.

Exit zero alone is insufficient: each native phase must also produce a final Bun
summary and a fresh completed JUnit document; the site must finish its gate inventory.
The real Bun executable is verified and propagated to nested CLI calls. An empty
local npm Bun shim is never counted as a successful test run. Temporary JUnit files
are removed after validation; console output contains each phase's completed summary.

Regression tests exercise late failure after a successful standalone exit, missing
completion evidence, spawn errors, real Bun completion, full scope wiring and an
empty-runtime negative control. No assertions or test filters were removed to obtain
a passing result. The site gate still performs both builds and its browser scenarios.
