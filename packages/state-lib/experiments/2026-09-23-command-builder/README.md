# Generated command experiment

See [the technical report](../../docs/research/2026-09-23-command-builders.md). The [summary](results/summary.json) and [raw archive](results/raw-results.zip) distinguish complete controller observations, full emitted entry sizes and the still-unqualified edge/tail cases. The final compiled programme is tested, not merely inspected.

`measure.mjs <boards-worktree>` rebuilds its owned synthetic fixture from the actual app sources and verifies canonical helper equality. Run `measure-size.mjs` and `measure-browser.mjs` afterward. They do not deploy or change a production database.
