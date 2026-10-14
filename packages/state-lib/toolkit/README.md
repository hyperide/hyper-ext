# Toolkit: framework-neutral async UX

Unpublished pre-release. Not published to any registry, not a stable v1 API.
This universal toolkit is NOT internal-only: `private: true` is only a
temporary no-npm-publish guard for this unfinished pre-release.

Tracked by [HYP-1507](https://tasks-ultrabricks.vercel.app/issues/e7cf33c7-b4e9-4b01-92b3-b699bb4f6a1f)
(original tracker alias: HYP-1502).

## Contract

`createAsyncResource(runtime, { load, isEmpty? })` owns one request lifecycle on
the CURRENT public Runtime/latestTask surface (merged `b3af90fb`). It clones no
store and weakens no core guard: cancellation, current-result ownership and the
transaction/pure-read/notification boundary probes all come from `latestTask`.

Snapshots are a frozen discriminated union — consumers never coordinate
unrelated booleans:

- `idle` — never started.
- `loading` with `hasData: false` — first load; with `hasData: true` — refresh
  that retains the prior value in `data`. Prior presence is explicit metadata:
  `undefined` is a valid result, so `data === undefined` never means "no prior".
- `success` — latest load committed (falsy and `undefined` values are valid).
- `empty` — latest load committed AND the domain `isEmpty(value, input)`
  returned true. Default `isEmpty` is `() => false`: emptiness is declared by
  the domain, never inferred from falsy data.
- `error` — latest loader rejection, retaining prior data when there is any
  (`error` is `unknown`: narrow it with `instanceof` in the handler; no payload
  type is declared without a runtime normalizer). The rejection also rejects
  `run()` so fire-and-forget callers cannot miss it.
- `cancelled` — an in-flight request was cancelled; prior data retained.

`matchAsyncState(snapshot, handlers)` dispatches exhaustively. All six cases
are required by the types and validated at runtime (a missing handler throws,
even for a state the current snapshot is not in). The return type is generic —
never a framework node. Matching is pure: it starts no network work.

## Ownership rules

- One resource per use-site; no cross-resource/test/request leakage. The
  snapshot reference is stable until a real transition publishes a new one.
  Snapshot records are frozen shallowly: the discriminated record is immutable,
  but a caller-owned result payload (object/array) is not deep-frozen.
- `run`/`retry`/`cancel`/`dispose` reuse the kernel boundary probes BEFORE any
  local authority or state change; a rejected start leaves the previous
  request, snapshot and remembered input intact — even when the rejection is
  caught inside an outer transaction.
- `run` claims its ticket before starting the kernel task (abort listeners run
  synchronously) and publishes `loading` only after the job owns it. If the
  `loading` publication itself throws a committed `NotificationError`, the
  error still surfaces synchronously, but the started job keeps its ticket and
  settles the snapshot later — never an unstarted permanently pending job.
- A loader that ignores `AbortSignal` still loses commit authority on
  cancel/supersede: late success/error never overwrite the latest request.
  `cancel` rechecks ownership after abort callbacks: a replacement run started
  synchronously by an abort listener keeps its `loading` state, and cancelling
  an already-committed success releases the claim without relabelling it.
- `retry()` without a prior `run(input)` throws; `dispose()` probes the kernel
  boundaries before any teardown (a dispose attempted inside a subscriber is
  refused with authority and subscriptions intact), claims disposal before
  revoking authority so abort-driven reentrant `run` is refused, then freezes
  the last snapshot with no further publication. Disposal is idempotent.
- A committed `NotificationError` (an observer failed AFTER publication) keeps
  its committed state and rejects `run()` as infrastructure failure, distinct
  from a loader rejection carried as `error` state.
- Error origin: a `NotificationError` thrown BY the loader (for example, the
  loader calls another stateful API whose notification fails) or by the domain
  `isEmpty` before any publication is a loader/domain rejection, not a
  committed publication. `run()` rejects with the ORIGINAL error object
  (identity preserved) and the snapshot settles to `error` with prior data
  retained. Origin is marked privately with a wrapper that never escapes the
  module: the loader result is assimilated exactly once with one ordinary
  `await`, so a lazy thenable runs its body exactly once and a late obsolete
  rejection settles nothing. Only a bare `NotificationError` with no loader
  origin counts as committed.

## Grounding

REQUIREMENTS F3/R19, R11–R13, R15–R18, R71; master spec §1/§3 (core imports
nothing), §6 (shared conformance, all renderer adapters as peers), §7 (one
runtime per request, no singleton), §8 (sources/query/persist/router as later
toolkit adapters over this contract), §4.15 (async lifecycle, cancellation).

Renderer bindings (React/Vue/Solid/Svelte/Angular/Lit) and source adapters
(REST/GraphQL/RPC/streams/RxJS/CRDT, persist, router, devtools) are LATER
slices that consume the conformance suite via the testing entrypoint
(`toolkit/src/testing.ts`), not part of this unit. The production barrel
(`toolkit/src/index.ts`) never re-exports the testing harness, so browser and
worker bundles never load it. Qwik and Service Worker constraints stay
documented gaps (`docs/api/CORE-TOOLKIT-CONFORMANCE.md`).

## Package export (unpublished pre-release)

The pre-release ships as an unpublished pair — `@ultrabricks/state-toolkit-async`
plus its exact peer `@ultrabricks/state-lib@0.1.0-pilot.1` — generated by
`toolkit/tools/export-package.mjs` into a NEW directory.

**Single-writer contract:** the caller must exclusively own the absent
destination and serialize writers to its parent. Files, directories and
dangling symlinks observed during either preflight are refused. This is not an
atomic no-replace API: on POSIX, an empty directory created by another process
after the last check can be replaced by the rename. Do not use a shared,
concurrently writable destination without caller-provided serialization.

**Separate inputs and outputs:** the destination parent must be outside the
copied toolkit and Runtime source trees, including through symlink aliases.
Overlapping paths are explicitly rejected before staging: putting generated
output in compiler inputs would copy the build into itself or contaminate a
later export. An output beside a custom source directory, or elsewhere in the
repository outside those source trees, remains supported.

The export compiles the toolkit, rewrites the
source-development import (`../../runtime/src/index.js`) to the public peer in
both JS and declarations, and records inputs, hashes and tool versions in
`PROVENANCE.json`. It is NOT published to any registry; `private: true` is the
temporary guard that keeps it off npm until the pre-release is finished.

The package is assembled in an owned sibling directory on the destination
filesystem, so an output on a different disk does not require a cross-device
rename. Compiler scratch is removed before the complete package is renamed to
the destination; no cleanup runs after publication. An unexpected `EXDEV` is
refused without copying into or deleting the destination, with the filesystem
error retained as the cause. Other I/O errors keep their original identity;
when cleanup also fails, an `AggregateError` preserves both errors and names
the owned staging directory that needs removal.

Compiler scratch stays owner-only. Once scratch is removed, the completed
package directory receives normal directory permissions (`0777 & ~umask` on
POSIX) before promotion; a restrictive caller umask remains restrictive.
The destination parent must already exist on a local filesystem. No crash
durability or protection from concurrent parent mutation is promised.

```sh
node packages/state-lib/toolkit/tools/export-package.mjs ./toolkit-pilot-0
```

Consume the pair standalone (no monorepo, no framework peers):

```js
import { createAsyncResource, matchAsyncState } from '@ultrabricks/state-toolkit-async';
import { Runtime } from '@ultrabricks/state-lib';

const runtime = new Runtime();
const resource = createAsyncResource(runtime, { load: async (id) => fetch(`/api/items/${id}`) });
await resource.run('42');
matchAsyncState(resource.getSnapshot(), {
  idle: () => 'idle',
  loading: (s) => (s.hasData ? `refreshing ${s.data}` : 'loading…'),
  success: (s) => `ok: ${s.data}`,
  empty: (s) => `empty: ${s.data}`,
  error: (s) => `failed: ${String(s.error)}`,
  cancelled: () => 'cancelled',
});
```

Production entry (`@ultrabricks/state-toolkit-async`) exports only the
async-resource/match surface and stays browser-safe (no `node:` builtins). The
conformance harness is a SEPARATE explicit subpath
(`@ultrabricks/state-toolkit-async/testing`) with its Node-only runners; the
production closure never loads it. One Runtime serves both sides: the toolkit
never vendors, bundles or inlines the core — `StateError`,
`NotificationError` and `Runtime` identity is shared with the consumer's core.

Limitations: no renderer bindings yet (React/Vue/Solid/Svelte/Angular/Lit are
planned peer slices against the same AR-01…AR-10 suite), no source adapters
(REST/GraphQL/streams/persist/router), no published registry artifact, no
stable v1 API. Next adapter matrix: `docs/api/CORE-TOOLKIT-CONFORMANCE.md` —
only the headless row is implemented and tested; every other row is planned.
