# HYP-370 — DevServerManager + PreviewProxy lifecycle FSM (decomposition)

Date: 2026-06-03
Author: Alex Ultra + Claude
Status: Draft
Linear: HYP-370

## Context

The preview stack boots and serves a user's dev server through two services in
`vscode-extension/hypercanvas-preview/src/services/`:

- **`DevServerManager.ts`** — spawns the dev server child process, detects the
  framework, picks a free port, owns a `DevServerStatus` field, and exposes
  `start()`/`stop()`/`restart()`/`waitForReady()` to the extension host.
- **`PreviewProxy.ts`** — a localhost HTTP/WS proxy between the VS Code webview
  iframe and the dev server, injecting interaction/error/console scripts and
  retrying upstream responses.

The ticket frames four reactive fixes — `localhost` vs `127.0.0.1`, IPv6, ANSI
strip, proxy-before-server race — as symptoms of a missing explicit dev-server
lifecycle FSM (`starting → ready → stopping → stopped`), asks for a single
network-probe utility, and asserts the "real fix" is awaiting a fresh
`compiled successfully` after the entry-file patch (the 55e8ddcd 30s retry budget
being a bandaid).

The code has moved on since the ticket was filed. Most of the FSM signal already
exists as a field, the recompile-await work is already shipped, and the retry
budget bandaid has since grown far past 30s. The job here is reconciliation first,
then a phased decomposition that touches only what is actually missing.

Real code paths:

- Status field + transitions: `DevServerManager.ts:64`, `_updateStatus`
  (`:837-850`), set from `start()` guards (`:193-201`), stdout/stderr ready
  detection (`:293`, `:311`), `exit`/`error` handlers (`:320-336`),
  `_waitForReady` (`:687-712`).
- Status type: `types.ts:98` (`'stopped' | 'starting' | 'running' | 'error'`),
  consumed by the webview at `types.ts:269`.
- Recompile gate: `armRecompileGate` (`:479-490`), `_maybeResolveRecompileGate`
  (`:516-531`), `awaitRecompile` (`:497-505`), `waitForReady` (`:677-682`);
  armed from `onBeforeWebpackEntryPatch` (`extension.ts:784`), awaited at
  iframe-load sites (`extension.ts:729`, `:981`, `:1217`).
- Proxy lifecycle flag: `PreviewProxy._isStopping` (`PreviewProxy.ts:51`,
  `:115`, `:150`, `:168`, `:391`).
- Retry budget bandaid: `PreviewProxy.ts:244-256` (now 90 retries / ~342s).

## Reality check — assumed vs actual

This is the load-bearing section. The ticket carries the same ticket-vs-reality
gap that sank HYP-372/HYP-300 — except inverted: it assumes work is _undone_ that
is in fact _done_.

### "There is no lifecycle FSM" — half-true

EXISTS: a 4-value `DevServerStatus` enum (`types.ts:98`) is already the de facto
state. `getState()` (`:176-185`) and `onStatusChange` publish it; the webview
reads `status?: DevServerStatus` (`types.ts:269`). So "no states" is wrong, and a
green-field FSM rewrite would needlessly churn a working external contract.

ACTUAL GAP: it is a **passively-set field, not a guarded machine**. Every
transition is written ad-hoc through `_updateStatus()` with no transition table
and no rejection of illegal transitions. Concretely, "running" is set from at
least four places that don't know about each other:

- `start()` early-return guards if already `running`/`starting` (`:193-201`),
- stdout ready-message detection (`:293-296`),
- stderr ready-message detection (`:311-314`),
- `_waitForReady` port-open poll (`:703-706`).

And there are **parallel sub-lifecycles living outside the enum**:

- the **recompile gate** — a `{promise, resolve, armedAt}` object (`:96-100`),
  not a status; while armed, `running` does not mean "serving stable",
- `PreviewProxy._isStopping` — the proxy's own private stop flag,
- `_portDetected`, `_pendingIsolatedMode`, `_projectPathPinned` — boolean
  side-channels that gate behavior but aren't part of any state model.

The genuine deliverable is therefore not "invent states" but "make the existing
states a guarded machine and pull the out-of-band sub-lifecycles into it
(or make them explicit, named sub-states)."

### "The real fix is awaiting a fresh compiled successfully" — already shipped

This sentence is verbatim the scope of **HYP-371**, which @ultra **closed as
delivered, no code change needed**, covered by the HYP-363 cluster. The recompile
gate in `DevServerManager.ts` already does exactly this for webpack/parcel:
`armRecompileGate()` fires before the entry-file AST rewrite (`extension.ts:784`),
`_maybeResolveRecompileGate()` releases only on a fresh post-patch
`compiled successfully` (timestamp-guarded against the stale pre-patch one,
`:516-531`), and `awaitRecompile()` is awaited at every iframe-load site. 6/6
recompile-gate unit tests are green (`DevServerManager.test.ts:344-424`).

So this pillar of HYP-370 is **done**. Reusing it as a sub-ticket would duplicate
finished work — the same trap, inverted.

### The four "symptoms" — two are a host-string bug, not an FSM gap

- **localhost vs 127.0.0.1 / IPv6**: a host-string inconsistency across probe and
  proxy sites, not a lifecycle issue. `_findFreePort` binds `127.0.0.1`
  (`:583`), `_isPortOpen` connects `localhost` (`:741`), the proxy WS upgrade
  writes `host: 127.0.0.1` (`PreviewProxy.ts:406`) while the HTTP proxy uses
  `localhost` (`:206`), and `HyperMcpServer` binds `127.0.0.1` (`:97`). This is
  fixed by one shared probe util, independent of any FSM.
- **ANSI strip**: already centralized in `ANSI_ESCAPE_PATTERN`
  (`DevServerManager.ts:20`) and applied on every stdout/stderr chunk. No
  outstanding work; do not re-open it.
- **proxy-before-server race**: largely already handled — `start()` awaits
  `_previewProxy.start()` (`:238`) before spawning the dev server, so the proxy
  exists before requests can be routed. The surviving race the ticket actually
  means is the **post-patch second-compile** one, and the recompile gate guards
  it. Verify rather than assume there is residual race here.

### Bandaid status

55e8ddcd set the `/test-preview` retry to 30s. The code has since grown to **90
retries / ~342s** (`PreviewProxy.ts:244-256`). So the bandaid wasn't removed — it
inflated. Walking it back is real, remaining work, but it is gated on the FSM
guaranteeing ordering, and it overlaps the MEMORY note "walk back inflated e2e
timeouts." It belongs as its own phase, last.

### Overlap with HYP-369

HYP-369 ("PreviewPanel selection FSM — idle → selecting → selected → disposing")
is a **different object**: it governs PreviewPanel _component selection_, not the
dev-server _process lifecycle_. They are the same _cluster_ of preview-stack FSM
refactors (369 selection / 370 lifecycle / 371 recompile-await, already done) but
share no state. The only coupling worth a decision: whether both consume one tiny
shared FSM/transition primitive or stay independent — see Risks.

## Scope / Decomposition

The ticket is an epic. Decompose into independently shippable phases, ordered so
the shared-code/foundation work lands first and the bandaid walk-back lands last.

### Phase 0 (close, no code) — fold HYP-371 / recompile-await

The "await fresh compiled successfully" pillar is already delivered (recompile
gate). No sub-ticket. Record in HYP-370's description that this slice maps to the
closed HYP-371, so nobody re-implements it.

### Phase 1 — Single IPv6-aware network-probe utility (FOUNDATION)

- **Why first**: closes 2 of the 4 cited symptoms (localhost/127.0.0.1, IPv6),
  pure and trivially TDD-able, and is a prerequisite that removes a class of
  flakiness the later phases would otherwise inherit.
- **Key files**: new util (e.g.
  `vscode-extension/hypercanvas-preview/src/services/netProbe.ts`) exporting
  `probeOpen(port)` and `findFreePort(startPort)`; consumers
  `DevServerManager._findFreePort`/`_isPortOpen` (`:574-596`, `:717-743`),
  `PreviewProxy` listen/WS host header (`:130`, `:398-407`), `HyperMcpServer`
  (`:97`).
- **Acceptance (TDD)**: a unit test asserts `probeOpen` returns true for a server
  bound to `::1` (IPv6-only) and a server bound to `127.0.0.1`, using one
  consistent host-resolution strategy; `findFreePort` binds and connect-probes via
  the same path. Red first: today `_findFreePort`(`127.0.0.1`) +
  `_isPortOpen`(`localhost`) disagree on an IPv6-only bind.

### Phase 2 — Guarded transition table in DevServerManager

- **Key files**: `DevServerManager.ts` — replace bare `_updateStatus` assignments
  with a `transition(to: DevServerStatus)` that consults an explicit table and
  rejects/no-ops illegal transitions; route the four "running"-setting sites
  (`:293`, `:311`, `:703`, plus `start()` guards) through it.
- **Contract preservation**: `getState()` shape, `onStatusChange` payload, and
  `types.ts:98`/`:269` MUST be unchanged. This is an acceptance criterion, not a
  nicety — the webview depends on it.
- **Acceptance (TDD)**: unit test asserts an illegal transition (e.g.
  `stopped → running` without `starting`) is rejected/ignored and `onStatusChange`
  is not fired for it; existing `DevServerManager.test.ts` initial-state/callbacks
  suites stay green.

### Phase 3 — Recompile as an explicit sub-state

- **Key files**: `DevServerManager.ts` recompile-gate block (`:96-100`,
  `:479-545`, `:677-682`).
- **Scope**: surface "running but recompiling after patch" as a named sub-state
  (e.g. `running` + a `recompiling` flag in `DevServerState`, or a derived
  `ready-pending-recompile`) so consumers can distinguish stable-serving from
  mid-recompile without reaching into the promise. Keep `armRecompileGate` /
  `awaitRecompile` / `waitForReady` public signatures stable (extension.ts
  callers).
- **Acceptance (TDD)**: extend the existing recompile-gate tests
  (`DevServerManager.test.ts:344-424`) to assert the reported state reflects
  recompiling between arm and release; all 6 existing gate tests stay green.

### Phase 4 — Couple PreviewProxy lifecycle to the manager FSM

- **Key files**: `PreviewProxy.ts` `_isStopping` (`:51`, `:115`, `:150`, `:168`,
  `:391`); `DevServerManager._stopProxy` (`:560-569`).
- **Scope**: derive proxy serving/stopping from manager state instead of an
  independent private flag, so there is one source of truth for "are we serving."
  First **verify** there is residual proxy-before-server race (proxy.start() is
  already awaited at `:238`); if none, narrow this phase to the coupling cleanup.
- **Acceptance (TDD)**: unit test asserts proxy rejects/short-circuits requests
  exactly when the manager is not in a serving state, driven through manager
  transitions rather than calling `proxy.stop()` directly.

### Phase 5 — Walk back the inflated retry budget

- **Key files**: `PreviewProxy.ts:244-256` (the 90-retry / ~342s `/test-preview`
  budget), plus the 504 retry (`:217-229`) and asset retries (`:262-271`).
- **Gated on**: Phases 2-4 guaranteeing ordering so the iframe never requests
  `/test-preview` before the post-patch recompile is released.
- **Acceptance (TDD/e2e)**: restore a tight retry bound and prove webpack-react
  preview still loads without the wide budget; coordinate with the MEMORY note
  "walk back inflated e2e timeouts after a3230b4 stabilizes" (SHAs live in
  ext-test-projects). Per development.md, inflated timeouts mask the real bug —
  this phase is where the masking is removed once the root ordering is enforced.

## Risks & prerequisites

- **Shared-code blast radius (Phase 1)**: the net-probe util is consumed by
  `HyperMcpServer` in addition to the two preview services. Per the repo rule
  "don't change general code that has always worked unless necessary" — migrating
  HyperMcpServer is in scope only because the host-string inconsistency spans it;
  keep that migration mechanical and covered by its own test
  (`HyperMcpServer.test.ts`).
- **External contract (Phase 2/3)**: `DevServerState`/`DevServerStatus` cross the
  extension-host ↔ webview boundary (`types.ts:269`). Any state-shape change must
  stay additive/back-compatible or the webview breaks silently.
- **Ordering**: 1 → 2 → 3 → 4 → 5. Phase 5 (bandaid removal) must be last; doing
  it before 2-4 re-introduces the post-patch race the wide budget currently masks.
- **HYP-369 coupling decision**: recommend keeping 369 and 370 independent
  (different objects, no shared state) but extracting a single small
  transition-table primitive both can consume IF Phase 2 produces one cleanly. Do
  not block 370 on 369.
- **Verification before assertion (Phase 4)**: confirm with a test whether a
  proxy-before-server race still exists before writing a fix for it — proxy.start()
  is already awaited at `:238`.

## Out of scope

- The recompile-await / "second compiled successfully" work — already delivered
  (HYP-371 closed, HYP-363 cluster). Do not re-implement.
- ANSI stripping — already centralized (`DevServerManager.ts:20`), no work.
- PreviewPanel component-selection FSM — that is HYP-369, a different object.
- Dependency-repair flow (`shouldRepairDependencies`, `_repairDependencies`),
  monorepo target resolution (HYP-420/HYP-431), and isolated-mode script swapping
  — touched only insofar as they read the new state, not reworked here.
- The 504 cold-start retry and asset-retry budgets are reviewed in Phase 5 only as
  a follow-on; their primary tuning is not the goal of this epic.
