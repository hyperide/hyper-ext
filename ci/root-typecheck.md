# Root TypeScript preflight

The `Lint & Typecheck` job runs `bun run typecheck` independently of `bun lint`.
The existing root tsconfig remains authoritative; the extension retains its
separate npm/TypeScript build gate.

## Dependency resolution

At `35325d0e`, a fresh frozen install with Bun 1.4.2 and a user-level
`linker = "isolated"`, `globalStore = true` reproduces five root errors:

- `LazyMonaco.tsx:51`: TS2559, editor props collapse to `IntrinsicAttributes`.
- `color-palette-grid.tsx:30` and `color-search-results.tsx:38`: TS7006.
- `input-otp.tsx:29`: TS18046, context becomes `unknown`.
- `capture-and-verify.ts:73`: TS2307, `playwright-core` is unresolved.

`tsgo --traceResolution` shows that React imports inside Monaco, cmdk, and
input-otp declarations resolve to React JavaScript in the global virtual store,
without the root `@types/react`. A clean hoisted install of the unchanged baseline
passes without editing those components. Switching linker on an existing install
can retain stale symlinks; use clean root and workspace `node_modules` directories
for this comparison. Workspace links from an isolated install point into the root
`.bun` store and become dangling when only the root installation is removed.

The project explicitly selects the hoisted layout already implied by its
`bun.lock` `configVersion: 0`, so user-level isolation settings cannot alter this
type lookup. See [Bun installation strategies](https://bun.com/docs/pm/isolated-installs).

`playwright-core` is a direct dependency because the capture helper and browser
installer resolve it from the root. Its exact prerelease pin deliberately matches
`@playwright/mcp`'s existing `1.59.0-alpha-1771104257000`: changing that revision
would change the browser requirement and exceed this preflight's scope. No locked
package version or integrity changes. The obsolete knip exemption is removed.
`@radix-ui/react-checkbox` is already declared and resolves as 1.3.3 in the clean
baseline and corrected installations; no additional declaration is needed.

## Regression procedure

Run from a clean dependency installation in an isolated worktree:

```sh
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun run test
```

Require actual test counts in the output. If the local Bun npm shim is a zero-byte
placeholder, invoke the existing `scripts/fix-bun-shim.ts` with the real Bun binary
(for example, `~/.bun/bin/bun scripts/fix-bun-shim.ts`) and rerun. An empty successful
test invocation is not regression evidence.

To prove the gate is active, temporarily add an included source file
`client/hyp1458-typecheck-probe.ts` containing:

```ts
const rootTypecheckProbe: string = 1458;
export { rootTypecheckProbe };
```

Run the exact CI command, `bun run typecheck`. It must exit nonzero with TS2322
at that file. Remove the probe and rerun the command; it must exit zero. HYP-1458
observed exit 2 with the probe and exit 0 after removal. Do not commit the probe.

Validate extension compatibility separately:

```sh
cd vscode-extension/hypercanvas-preview
npm ci
node_modules/.bin/tsc --noEmit -p ./
node esbuild.js --production
node scripts/check-webview-bundles.mjs
```
