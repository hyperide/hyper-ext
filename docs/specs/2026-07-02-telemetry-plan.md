# HyperIDE Telemetry Plan — Maximally Detailed AND Useful

- **Status:** DRAFT for CTO review (spec only — implements nothing)
- **Ticket:** [HYP-859](https://linear.app/glide-vc/issue/HYP-859/telemetry-plan-spec-maximally-detailed-and-useful-posthog-telemetry)
- **Date:** 2026-07-02
- **Author:** plan-writer agent, commissioned by the CTO: _"Confirmed the email. Already
  saw a couple of events. Great. Work out a plan for maximally detailed and useful
  telemetry."_ (2026-07-01, translated)
- **Backend:** PostHog EU Cloud, project `213539`, key `$POSTHOG_PROJECT_API_KEY`
  (public write-only project key — safe to ship inside a browser bundle by design, same
  class of key referenced at `client/App.tsx:25`, where it is already committed
  literally. **CTO decision 2026-07-02: this document itself never writes the key
  literally, going forward** — it is referred to only as `$POSTHOG_PROJECT_API_KEY`.
  Note this is a hygiene policy for new spec/doc text, not a claim that the key is
  absent from history: an earlier revision of this very spec (commit `2ec28a1e`)
  committed it literally, and `client/App.tsx` still does. Rotating/purging that
  existing exposure is a separate decision, out of scope for this edit. The key's local
  copy lives in `.env` (gitignored, not committed going forward) and in GitHub Actions
  secrets, injected at build/run time.)
- **Related:** PR [#598](https://github.com/hyperide/hyper-saas/pull/598) (client PostHog init, merged),
  PR [#602](https://github.com/hyperide/hyper-saas/pull/602) (HYP-855 white-screen fix, merged),
  PR [#497](https://github.com/hyperide/hyper-saas/pull/497) (extension telemetry pipeline, merged),
  PR [#581](https://github.com/hyperide/hyper-saas/pull/581) (telemetry.json manifest completion, merged)
  (**corrected, spec-web review**: links previously pointed at the wrong repo,
  `hyperide-ai/hyperide` — this repo's remote is `hyperide/hyper-saas`.)

---

## Table of contents

1. [Goals & principles](#1-goals--principles)
2. [Current-state inventory](#2-current-state-inventory)
3. [Event taxonomy](#3-event-taxonomy)
4. [Identity & consent](#4-identity--consent)
5. [Reliability of telemetry itself](#5-reliability-of-telemetry-itself)
6. [Session replay & error tracking](#6-session-replay--error-tracking)
7. [Dashboards & consumption](#7-dashboards--consumption)
8. [Rollout phases](#8-rollout-phases)
9. [Open decisions for the CTO](#9-open-decisions-for-the-cto)

---

## 1. Goals & principles

### 1.1 The one question this plan answers

"Maximally detailed" is easy — turn on autocapture and drown. "Maximally useful" is the
constraint: **every event in this plan exists to answer a named product question.** An
event with no question attached does not ship. The taxonomy tables in §3 carry a
"Question it answers" column for exactly this reason; if a future event PR cannot fill
that column, the event is rejected in review.

### 1.2 Principles (normative)

| #   | Principle                                                                                                                                                                                                                           | Consequence                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P-1 | **Useful > voluminous.** Every event answers a named question.                                                                                                                                                                      | "Question" column mandatory in §3 tables and in any future event PR.                                                                                         |
| P-2 | **PII never leaves the process.** Only enums, counts, durations, booleans, and one-way hashes. No source code, file paths, prompts, URLs, free-form user strings.                                                                   | Already enforced in the extension (`TelemetryService.scrubProps`, `sender.ts stripPaths`); SaaS client must adopt the same contract (§3.2).                  |
| P-3 | **EU data residency.** All ingestion goes to `https://eu.i.posthog.com` (directly or via our proxy). No US sub-processor for analytics.                                                                                             | Already true for both wired surfaces; the reverse proxy (§5.4) must preserve this.                                                                           |
| P-4 | **Telemetry must never break the product.** Init isolated, every emit try/caught, missing keys degrade to inert.                                                                                                                    | The HYP-855 lesson (§5.1). Extension already complies (`sender.ts` INVARIANT block); client complies post-#602.                                              |
| P-5 | **Telemetry must notice its own death.** Zero events in prod is an incident, not silence.                                                                                                                                           | Ingestion heartbeat + boot canary are P0 deliverables (§5.2, §5.3), because prod was once white-screened and nobody noticed until a telemetry investigation. |
| P-6 | **Compliance is a gate, not a footnote.** VS Code global telemetry setting and our own opt-out are ANDed; the `telemetry.json` manifest stays complete.                                                                             | Already implemented (§2.2); every new extension event updates `telemetry.json` in the same PR (CI-checkable).                                                |
| P-7 | **Dev and prod never mix in one dataset.**                                                                                                                                                                                          | Separate PostHog project for dev/e2e, or hard prod-only gating (current state), decided in §9 OD-1.                                                          |
| P-8 | **Style-system events carry the master-spec axes.** `cssFramework` and `designSystem` are independent dimensions (master spec §5.5, D26); a style-edit event without them cannot answer "which CSS systems do users actually edit". | §3.4.3 adds the axis props to every style-write event.                                                                                                       |

### 1.3 Naming convention — decision

**Decision: `domain.action` (camelCase action), the convention already shipped in the
extension** — e.g. `canvas.elementSelected`, `inspector.styleEdited`, `devServer.failed`.

Rationale against switching to `surface:object_verb` (the greenfield alternative):

1. **64 events already ship under `domain.action`** in
   `vscode-extension/hypercanvas-preview/src/telemetry/events.ts`, mirrored in the
   user-facing transparency manifest `telemetry.json` (262 lines). Renaming a shipped
   taxonomy breaks the manifest contract, any existing PostHog insights, and the
   header comment in `events.ts` says it explicitly: _"Keep names stable — they are the
   schema PostHog/Sentry index on; renaming breaks dashboards."_
2. Surface does not belong in the event name. The same conceptual action
   (`inspector.styleEdited`) happens in the extension webview AND the SaaS editor
   (shared `RightSidebar`); encoding surface in the name would split one funnel into
   two event streams. Surface is a **common property** (`surface: 'extension' | 'saas' |
'server'`) attached to every event, which PostHog filters/breakdowns handle natively.
3. `domain.action` groups naturally in PostHog's event list (alphabetical sort clusters
   by domain), which is the main ergonomic argument for prefixes anyway.

Normative rules:

- Event name = `domain.action`, domain is a product noun (`canvas`, `inspector`,
  `auth`, `project`, `ai`, `preview`, `devServer`, `error`, `funnel`, `session`,
  `dissatisfaction`, `samples`, `srv`), action is a past-tense verb phrase in camelCase.
- Server-origin business events use the `srv.` domain prefix to make origin auditable
  (`srv.userSignedUp`), because server events bypass all client-side gating and must be
  distinguishable in incident forensics.
- Every event carries the common props: `surface`, `appVersion` (ext version / client
  build hash), `env` (`production` | `development`), plus PostHog defaults.
- Property names are camelCase; enum values are lowercase kebab or the master-spec
  vocabulary verbatim (`tailwind-v4`, `css-modules`, `shadcn`).

---

## 2. Current-state inventory

Verified by reading code on 2026-07-02 (main @ `3c8f6f2b` + the #602 branch
`fix/posthog-telemetry`).

### 2.1 SaaS web client (`client/`) — autocapture only, prod-only, no identity

`client/App.tsx:23-32` (shape after #602, branch `fix/posthog-telemetry`, worktree
`/Users/ultra/work/hyper-canvas-draft-worktrees/posthog-fix`):

- `posthog-js` `^1.396.3` (root `package.json:52`), `posthog.init` at module top,
  guarded by `process.env.NODE_ENV === 'production'` (statically inlined by Bun — the
  #598 version used Vite's `import.meta` env object, which Bun leaves undefined in
  browser output, and the module-top TypeError white-screened prod: HYP-855).
- Config: `api_host: 'https://eu.i.posthog.com'`, `defaults: '2026-05-30'`.
- Wrapped in try/catch so init failure cannot block mounting; tripwire tests exist
  (`client/__tests__/browser-bundle-safety.test.ts`, #602).
- **What it actually sends:** autocapture (clicks/inputs/pageviews per posthog-js
  defaults) only. Zero explicit `capture()` calls, zero `identify()` calls, no group
  analytics, no replay, no feature flags, no reverse proxy. The "couple of events" the
  CTO saw in the PostHog UI are autocapture/pageview events. Note: current posthog-js
  defaults capture SPA route changes as pageviews (`capture_pageview:
'history_change'`), so the BrowserRouter navigation is already visible —
  [posthog.com/docs/product-analytics/autocapture](https://posthog.com/docs/product-analytics/autocapture).

Gaps: no identity (all users are anonymous distinct_ids — funnels across login are
broken), no business events, adblock-exposed (direct `eu.i.posthog.com` requests from a
developer-heavy audience), no error capture, no consent posture documented.

### 2.2 VS Code extension (`vscode-extension/hypercanvas-preview`) — full pipeline, INERT in production

The extension has the most mature telemetry code in the company — and it sends
**nothing** from production installs. Shipped in #497, manifest completed in #581:

- **Taxonomy:** `src/telemetry/events.ts` — 64 `domain.action` events across
  session/funnel/command/preview/devServer/ai/explorer/canvas/inspector/panel/theme/
  error/feedback/dissatisfaction, with typed prop vocabularies (`ErrorCategory`,
  `ValueKind`, `Outcome`, `ContextMenuAction`, ...) and a webview allow-list
  (`WEBVIEW_ALLOWED_EVENTS`) so a compromised webview cannot inject arbitrary names.
- **Service:** `src/telemetry/TelemetryService.ts` — gates on
  `vscode.env.isTelemetryEnabled === true` AND `hypercanvas.telemetry.enabled !== false`
  (both live-tracked via `onDidChangeTelemetryEnabled` / `onDidChangeConfiguration`);
  routes through `vscode.env.createTelemetryLogger`; hashes `machineId`/`sessionId`
  (sha256, 16 hex chars) before anything leaves the process; `scrubProps` drops any
  string >64 chars or containing `/`, `\`, `://`, or spaces as defense-in-depth.
- **Senders:** `src/telemetry/sender.ts` — `posthog-node` `^5` (lazy-required, key-gated)
  for events + `@sentry/node` (private `NodeClient`, explicit minimal integration
  allow-list, no global hooks, `beforeSend` strips absolute paths) for errors. Both
  degrade to inert on missing keys, never throw.
- **Session layer:** `src/telemetry/sessionTelemetry.ts` — `session.activated` /
  5-minute `session.heartbeat` / `session.ended` with counters, one-shot
  `funnel.firstPreview` (globalState-latched, `msSinceActivate`),
  `src/telemetry/dissatisfaction.ts` heuristics (quick-undo, retry-loop,
  error-then-quit) + webview rage/dead/error clicks.
- **Compliance:** `telemetry.json` transparency manifest (262 lines, every event with
  purpose + properties, for `code --telemetry` transparency); one-time privacy notice
  (`src/telemetry/firstRunNotice.ts`) with OK / Open Settings / Disable; settings
  `hypercanvas.telemetry.{enabled,posthogKey,posthogHost,sentryDsn}`
  (`package.json:460-495`).
- **Project dimensions at activation:** `extension.ts:405-481` detects and attaches
  `projectType`, `cssSystem`, `uiKit` to `session.activated`.

**The gap that makes all of this moot:** `hypercanvas.telemetry.posthogKey` defaults to
`""` and falls back to the `HYPERCANVAS_POSTHOG_KEY` env var
(`TelemetryService.readConfig`, `TelemetryService.ts:164`). Nothing bakes a key at build
time — `HYPERCANVAS_POSTHOG_KEY` appears **only** in `package.json` (setting docs) and
`TelemetryService.ts` (the fallback read); no esbuild define, no CI secret, no
`build-and-install.sh` export. A marketplace/VSIX install therefore has
`backendConfigured === false`, the pipeline is inert, and even the first-run privacy
notice is deliberately suppressed (`TelemetryService.hasActiveBackend`). **The main
product target reports zero telemetry today.** Fixing this is the core of Phase 2 (§8)
and OD-2 (§9).

Second gap: per-edit events do not carry the style-system axes. `inspector.styleEdited`
emits only `{ styleCount, state }` (`preview-panel-message-router.ts:511`); the
`cssSystem`/`uiKit` dimensions exist only on `session.activated`. Cross-filtering in
PostHog by person is not possible here (distinct_id is a machine hash shared across
projects the user opens), so "style edits by css system" is unanswerable today. §3.4.3.

Third (naming) note: the activation prop is called `uiKit`, which the master spec's D26
naming guard retires in favor of `designSystem` (master spec §5.5). §3.4.3 schedules the
additive rename.

### 2.3 Server (`server/`, Bun) — zero

No posthog-node, no analytics of any kind (grep for posthog/telemetry/analytics:
only GitHub webhook routes match "webhook"). All signup/project-create/AI-generation
truth lives here and is currently invisible.

### 2.4 e2e portal — out of scope

Internal tool, tiny audience. Explicitly skipped per commissioning brief; the only
telemetry-adjacent requirement is that e2e runs must NOT pollute the prod dataset
(§9 OD-1 / P-7): Docker e2e runs the client with `NODE_ENV=production` builds in some
lanes, so prod-only gating alone is not sufficient once explicit events land — the
e2e lanes MUST NOT reach the prod project. The clean mechanism is the dev-project key
per OD-1 (selected at build time). The fallback — `opt_out_capturing()` — has a timing
trap: it must be effective BEFORE `init()` fires the first pageview, and e2e drives a
production client build whose init it does not control; the workable variant is
pre-seeding PostHog's persisted opt-out flag in storage via the harness (Playwright
context init script) before the first page load, not a post-load call. An `env: 'test'`
marker alone is NOT sufficient either way: it would only tag events going through our
capture wrapper, while autocapture from an e2e-driven browser would still pollute the
prod dataset untagged.

### 2.5 Inventory summary

| Surface     | Pipeline code                          | Actually sending in prod | Identity         | Errors                      | Key gaps                                                    |
| ----------- | -------------------------------------- | ------------------------ | ---------------- | --------------------------- | ----------------------------------------------------------- |
| SaaS client | minimal (init only)                    | YES (autocapture only)   | anonymous only   | none                        | no events, no identify, adblock-exposed, no consent posture |
| Extension   | excellent (64 events, compliance done) | **NO — no key shipped**  | hashed machineId | Sentry path (inert, no DSN) | ship a key; axis props on style events                      |
| Server      | none                                   | no                       | n/a              | logs only                   | no business-truth events                                    |
| e2e portal  | none                                   | no                       | n/a              | n/a                         | keep out of prod dataset                                    |

---

## 3. Event taxonomy

### 3.1 Common properties (all surfaces)

| Property     | Type        | Values / notes                                                                                                  |
| ------------ | ----------- | --------------------------------------------------------------------------------------------------------------- |
| `surface`    | enum        | `saas` \| `extension` \| `server`                                                                               |
| `env`        | enum        | `production` \| `development` \| `test` (redundant if OD-1 picks separate projects; cheap insurance either way) |
| `appVersion` | string      | extension version (e.g. `0.1.66`) / client build id / server release                                            |
| `machineId`  | hash        | extension only — sha256-16 of `vscode.env.machineId` (already shipped)                                          |
| `sessionId`  | hash/string | extension: hashed `vscode.env.sessionId`; SaaS: PostHog session id (automatic)                                  |

**SaaS mechanism note:** on the web client, `surface`/`env`/`appVersion` MUST be
registered as super-properties (`posthog.register({...})` in the init module, §5.1) —
not merely merged by the capture wrapper. Autocapture events bypass any wrapper; without
`register()` they would carry no common props, which would silently exclude them from
every `env=production` filter this plan relies on (the §5.2 heartbeat queries, first of
all). **Timing invariant:** the props must be present on the very first `$pageview`,
which posthog-js emits during `init()` itself — a `register()` called after `init()`
returns may miss it. Implementation options (implementer's choice, the Phase 1
acceptance criterion verifies the outcome): (a) `capture_pageview: false` in the init
config, `register()`, then capture `$pageview` manually (and wire SPA route-change
pageviews from the router); or (b) verify empirically that same-tick `register()`
lands on the queued initial pageview for our pinned posthog-js version. **Extension
status (corrected, spec-web review):** `TelemetryService.commonProps` today merges only
`machineId`, `sessionId`, and `extVersion` (`TelemetryService.ts:140-144`) — `surface`
and `env` are NOT yet merged, despite the table above listing them as common to every
surface. Adding both is an explicit Phase 2 scope item (§8, item 2), required before any
`properties.surface = 'extension'` PostHog query (starting with the §5.2 heartbeat) can
match a real event. The server wrapper merges the full common-prop set per event.

Priorities: **P0** = Phase 1/2 blocker, answers a question we need this month.
**P1** = ship in the same phase if cheap, else next. **P2** = backlog, needs a
demonstrated question before implementation.

### 3.2 SaaS client events (new — today: autocapture only)

The SaaS client adopts the extension's PII contract: enums/counts/durations/booleans/
hashes only. A shared `client/lib/telemetry.ts` wrapper (thin `capture()` guard: no-op
when init failed, dev-logs in development) is the single call site — direct
`posthog.capture` calls outside the wrapper are lint-banned. Common props ride as
super-properties registered at init (§3.1 mechanism note), so autocapture carries them
too.

Autocapture stays ON (pageviews, clicks — free funnel glue and rage-click raw material),
with `autocapture` allowlist tuning deferred until volume data exists (P2).

| Event                       | Props                                                                              | Question it answers                                                                                                    | Prio |
| --------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---- |
| `app.telemetryBoot`         | `bootMs`                                                                           | Canary: is the bundle executing AND telemetry alive? (§5.3; the HYP-855 class of failure becomes an alertable absence) | P0   |
| `auth.signupCompleted`      | `method` (github\|google\|email)                                                   | Where do new users come from; signup conversion by method                                                              | P0   |
| `auth.loginCompleted`       | `method`                                                                           | Returning-user activity baseline (also the `identify()` seam, §4.1)                                                    | P0   |
| `auth.loginFailed`          | `method`, `reasonCategory`                                                         | Is auth silently broken for a provider?                                                                                | P1   |
| `workspace.created`         | —                                                                                  | Team-adoption signal                                                                                                   | P1   |
| `project.created`           | `source` (template\|import\|ai), `template` (enum), `cssFramework`, `designSystem` | Which project kinds do users start; feeds adoption-by-css-system                                                       | P0   |
| `project.opened`            | `cssFramework`, `designSystem`, `ageDays` (bucketed)                               | Retention proxy: do users come back to projects?                                                                       | P1   |
| `project.deleted`           | `ageDays` (bucketed)                                                               | Churn signal                                                                                                           | P2   |
| `editor.opened`             | `cssFramework`, `designSystem`                                                     | Entry into the core product                                                                                            | P0   |
| `editor.canvasRendered`     | `durationMs`, `firstForProject` (bool)                                             | TTFR (time-to-first-render) — the SaaS "aha" moment; regression tracking                                               | P0   |
| `editor.canvasRenderFailed` | `errorCategory` (reuse extension's `ErrorCategory`), `messageHash`                 | What breaks first renders, by category                                                                                 | P0   |
| `canvas.elementSelected`    | `via` (click\|explorer\|breadcrumb)                                                | Is inspect-select discoverable? Mirrors extension event for cross-surface funnels                                      | P1   |
| `inspector.styleEdited`     | `styleCount`, `cssFramework`, `designSystem`, `writeTarget`                        | Feature adoption by css system (shared RightSidebar; same name+props as extension, §3.4.3)                             | P1   |
| `ai.generationRequested`    | `kind` (component\|page\|edit)                                                     | AI feature demand                                                                                                      | P1   |
| `ai.generationCompleted`    | `kind`, `outcome`, `durationMs`                                                    | AI success rate + latency as experienced                                                                               | P1   |
| `error.clientUnhandled`     | via PostHog error tracking (§6.2)                                                  | What crashes the SaaS client in the field                                                                              | P0   |

**`errorCategory` sharing gap (found in spec-web review):** `editor.canvasRenderFailed`
above says "reuse extension's `ErrorCategory`", but that type is defined
extension-local (`events.ts`, extension-only module) — the SaaS client cannot import
it as-is, and neither surface currently has a module either can share. Before this
event ships, extract `ErrorCategory` (and any other cross-surface enum this plan reuses
by name, e.g. event names themselves) into a shared module both `client/` and
`vscode-extension/` can import, or accept intentional string-literal drift with an
explicit note; either is fine, but "reuse" as written implies a shared import that does
not exist yet.

Explicitly rejected (P-1 fails — no named question): per-keystroke events, scroll
tracking, generic "button clicked" duplicates of autocapture.

### 3.3 Server events (Bun, posthog-node) — small and business-truth-only

**Argument: events for business truth, logs for operations.** The temptation is to pump
API latency/5xx into PostHog. Recommendation: **do not.** PostHog is a product-analytics
store — per-request latency events would dominate volume (P-1 violation), duplicate what
structured logs + a future APM do better, and pollute funnels. The server sends only
events that are (a) business-truth the client cannot be trusted to report
(signup/creation — client events die with adblock, §5.4) or (b) inputs to the
reliability net (§5). API latency/error-rate stays in server logs; if we later want
op-metrics dashboards, that is an APM/OTel decision, not a PostHog event.

| Event                       | Props                                           | Question it answers                                                                                                          | Prio |
| --------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---- |
| `srv.userSignedUp`          | `method`                                        | Ground-truth signup count (adblock-immune; reconciles client `auth.signupCompleted` — the delta measures adblock loss, §5.4) | P0   |
| `srv.projectCreated`        | `source`, `cssFramework`, `designSystem`        | Ground-truth project creation                                                                                                | P1   |
| `srv.aiGenerationCompleted` | `kind`, `outcome`, `durationMs`, `tokensBucket` | AI cost/latency truth (server sees real token usage)                                                                         | P1   |
| `srv.dockerSessionStarted`  | `outcome`, `coldStart` (bool), `durationMs`     | Preview-infra reliability as a business metric                                                                               | P2   |

Implementation note (Phase 1): `posthog-node` v5 in `server/`, ONE shared long-lived
client (queue defaults `flushAt: 20`, `flushInterval: 10000`; `await posthog.shutdown()`
on graceful exit —
[posthog.com/docs/libraries/node](https://posthog.com/docs/libraries/node)),
`distinct_id` = server-side user id (same id `identify()` uses on the client, §4.1),
fail-open (missing key = inert, mirroring `sender.ts` invariants). **Ground-truth
caveat:** batching means up to `flushAt`-1 events / `flushInterval` ms are lost on a
crash — unacceptable for an event sold as reconciliation ground truth. `srv.userSignedUp`
(the P0) is therefore `await posthog.flush()`-ed after capture, before the signup
handler completes (failure tolerated + logged — analytics durability must not fail the
signup itself); the P1/P2 events ride the batch. **The await must be bounded (spec-web
review, Medium):** "failure tolerated + logged" covers `flush()` rejecting, but not
`flush()` hanging — an unbounded `await` on a slow/stalled `eu.i.posthog.com` connection
adds unbounded latency to the signup response, which directly violates P-4 ("telemetry
must never break the product"). Wrap it in a short race against a timeout (e.g.
`Promise.race([posthog.flush(), timeout(2000)])`) so a stalled flush degrades to
"lost this one ground-truth event, logged" rather than a hung signup. **Honesty note on
what this actually guarantees (Low confidence, spec-web review):** the shared
long-lived client's `flush()` drains the WHOLE queue, not this one event specifically —
under concurrent signups, a resolved `flush()` confirms the queue was sent, but a
timeout on a busy queue could still mean this particular event lands just after the
window closes rather than being truly lost. Read this as "best-effort delivery within
~2s, logged on outright failure," not "this exact event is provably delivered before
the timeout resolves" — an honest downgrade from "ground truth," consistent with §5.5's
general delivery-guarantees stance. If signup volume ever makes awaited flushes matter,
that is a nice problem to have.

### 3.4 Extension events

#### 3.4.1 What already exists (keep as-is)

The 64-event taxonomy in `events.ts` is well-designed and already answers the funnel
brief. Mapping the commissioned funnel onto shipped events:

| Funnel stage         | Existing event                                                                                                                | Notes                                            |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| install -> activate  | `session.activated` (`activationReason`, `vscodeVersion`, `coldStartMs`, `hasWorkspace`, `projectType`, `cssSystem`, `uiKit`) | wired, `extension.ts:472-481`                    |
| first preview        | `funnel.firstPreview` (`msSinceActivate`, `succeeded`) — one-shot per machine                                                 | wired, `sessionTelemetry.ts:92-100`              |
| first element select | `canvas.elementSelected`                                                                                                      | first-occurrence computed in PostHog (see below) |
| first style edit     | `inspector.styleEdited`                                                                                                       | ditto                                            |
| first drag / resize  | `canvas.dragStarted`/`dragEnded`, `canvas.elementResized`                                                                     | ditto                                            |
| errors along the way | `preview.renderFailed`, `preview.blankDetected`, `devServer.failed`, `error.*` (all with `errorCategory` + `messageHash`)     | wired                                            |
| frustration          | `dissatisfaction.*` (6 events)                                                                                                | wired                                            |

**Decision: no new one-shot `funnel.first*` events.** PostHog funnels on unique users
already compute first-occurrence ordering; `funnel.firstPreview` earns its keep only
through the `msSinceActivate` timing prop. Adding a latched one-shot per stage
multiplies globalState bookkeeping for data PostHog derives for free. If per-stage
time-to-first timings prove necessary, revisit as a single `funnel.milestone` event
with a `stage` enum (P2).

#### 3.4.2 New extension events

| Event                   | Props                                                                    | Question it answers                                                                                     | Prio |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- | ---- |
| `samples.generated`     | `outcome`, `durationMs`, `componentKind`, `cssFramework`, `designSystem` | Does sample generation (a first-run hook) work and get used? (sample-gen hang was a real CTO-found bug) | P1   |
| `preview.bridgeTimeout` | `phase` (connect\|settle\|render), `waitedMs`                            | Where does the preview bridge stall? (today a stall is invisible unless it converts to `renderFailed`)  | P1   |
| `mcp.toolInvoked`       | `tool` (enum), `outcome`, `durationMs`                                   | Is the MCP surface used at all?                                                                         | P2   |

**`preview.bridgeTimeout` webview-origin gotcha (found in spec-web review):** the
bridge-connect/settle/render timing this event describes is tracked in
`usePreviewBridge.ts`, which runs in the **webview**, not the extension host. Every
other webview-origin event crosses the host boundary via `canvas.sendEvent({type:
'telemetry:event', name, props})`, and the host only forwards names present in
`WEBVIEW_ALLOWED_EVENTS` (`events.ts`) — anything else is silently dropped
(`TelemetryService`'s webview-event handler returns early on an unlisted name). A naive
implementation that just calls `track('preview.bridgeTimeout', ...)` from
`usePreviewBridge.ts` the way `canvas.routeNavigated` does would ship an event that
never reaches PostHog. The implementing PR must add `preview.bridgeTimeout` to
`WEBVIEW_ALLOWED_EVENTS` alongside `TelemetryEvents`, and cover it in
`events.test.ts` and `telemetry.json` (P-6, §3.4.3(4)) — same checklist as any other
new event, called out here because the webview-vs-host split makes it easy to add the
event definition and forget the allow-list entry specifically.

#### 3.4.3 Style-system axis props (the master-spec alignment) — P0

Per master spec §5.5 (`docs/specs/2026-06-12-styles-system-master-spec.md`), styling
capability is **orthogonal axes** — `cssFramework` (tailwind-v3/v4, css-modules,
plain-css, vanilla-extract, emotion, styled-components, ...) and `designSystem`
(shadcn, mui-system, chakra-ui, mantine, tamagui, none) — and the D26 naming guard says
use `designSystem`, never `uiKit`.

Changes:

1. **Add `cssFramework` + `designSystem` props** to every style-write and element-mutation
   event: `inspector.styleEdited`, `inspector.propEdited`, `inspector.textEdited`,
   `canvas.elementInserted/Deleted/Duplicated/Wrapped/Moved/Resized`, `canvas.dragEnded`,
   `samples.generated`. **Correction (spec-web review) — this is not a simple pipe-through:**
   the activation-time detection at `extension.ts:405-414` calls `detectCssSystem` and
   `detectUIKit` (`ProjectDetector.ts`), and neither returns the orthogonal pair this
   prop set needs. `detectCssSystem` explicitly **folds** both axes into one winner ("the
   first match wins... the most specific match", e.g. `shadcn` over `tailwind` when both
   are present) — by design it cannot also report the underlying `cssFramework`.
   `detectUIKit` returns only `'tailwind' | 'tamagui' | 'none'`, missing `mui-system`,
   `chakra-ui`, `mantine`, and even `shadcn` (which `detectCssSystem` already detects as
   its own category, not as a design system layered on a framework) — well short of the
   §5.5 `designSystem` vocabulary this item's own enum claims to use. There is no "pair"
   to thread today; a new detector/mapper producing the true orthogonal
   `{cssFramework, designSystem}` pair must be written (reusing `detectCssSystem`'s
   existing dependency-scan signals rather than its folded return value), with test cases
   for shadcn-on-tailwind, MUI, Chakra, Mantine, and Tamagui — not just a wiring change at
   the router-deps call site. **Documented limitation: this is a per-session snapshot**
   — if the user changes the stack mid-session (adds Tailwind, installs shadcn),
   subsequent edit events inherit the stale pair until the next activation. Accepted for
   now (stack changes mid-session are rare and D-2 is a trend dashboard, not an audit);
   re-detecting per edit is deliberately out of scope.
2. **Add `writeTarget`** (enum: `designSystemProp` | `utilityClass` | `inlineStyle` |
   `stylesheet`, mapping the master-spec Part 7 priority-chain levels L0-L3) to
   `inspector.styleEdited` once the write pipeline reports which level the planner chose.
   This is the single highest-value style prop: it answers _"do users' edits land in
   the paradigm-native form we promised per css system, or do they degrade to inline?"_
   — the exact editability promise the css-in-js program is making. If the planner
   cannot surface this cheaply today, ship (1) first and (2) behind a follow-up ticket.
3. **Rename `uiKit` -> `designSystem` AND `cssSystem` -> `cssFramework` on
   `session.activated`, additively (scope corrected, spec-web review):** the earlier
   revision of this item only renamed `uiKit`, but `extension.ts:405-481` attaches
   BOTH `cssSystem` and `uiKit` to `session.activated` (§2.2), and Phase 2's
   acceptance criterion (§8) explicitly expects `session.activated` to arrive with
   `cssFramework`/`designSystem` — both new names, not one. Emit both pairs for two
   releases (`designSystem`+`cssFramework` canonical, `uiKit`+`cssSystem` deprecated
   in `telemetry.json`), then drop the old pair. Never break a shipped dashboard
   silently (P-6).
4. Every change here updates `telemetry.json` in the same PR (P-6). Recommend a small
   CI check: every name in `TelemetryEvents` appears in `telemetry.json` (the #581 gap —
   37 missing events — was found by hand).

#### 3.4.4 Volume guards

`canvas.elementHovered` and `canvas.zoomed`/`canvas.panned` (forward-declared) are the
only plausibly high-frequency names in the taxonomy. Before the key ships (Phase 2),
verify hover is debounced at the emit site or demote it to sampled (1-in-N) — a hover
firehose from a single active user can eat a meaningful slice of the free tier
(§6.4 cost math).

### 3.5 Taxonomy shape summary

- **Extension:** 64 shipped events (verified in `events.ts`) + 3 new (§3.4.2) + axis
  props on ~11 of them (§3.4.3). Of the shipped set, the P0-watch subset for dashboards
  is ~15 (session/funnel/preview/devServer/error/dissatisfaction + the style-write four).
- **SaaS:** autocapture + 16 explicit events (§3.2): 8 P0, 6 P1, 2 P2.
- **Server:** 4 events (§3.3): 1 P0, 2 P1, 1 P2.
- Everything else stays autocapture/logs; no other events ship without a named question.

---

## 4. Identity & consent

### 4.1 SaaS identity

- **Anonymous:** PostHog anonymous `distinct_id` (cookie/localStorage) from init —
  status quo.
- **On login/signup:** call `posthog.identify(serverUserId)` in the auth-success path
  (the `AuthProvider` / `AuthCallback` seam, `client/pages/AuthCallback.tsx`), with
  person properties limited to: `plan`, `signupMethod`, `createdAt`, workspace count
  bucket. **No email/name as person properties** in Phase 1 — PostHog person profiles
  with emails turn an analytics store into a PII store and change the GDPR posture;
  revisit only with a named question (P-1) and a DPA review.
- `posthog.reset()` on logout (prevents cross-account distinct_id bleed on shared
  machines).
- Server events use the same `serverUserId` as `distinct_id` (§3.3), so client and
  server events join into one person — from the moment `identify()` runs; pre-login
  anonymous client events merge into that person only via PostHog's identify-time
  anonymous-id merge, not retroactively by magic.
- **Group analytics** (workspace as group type): P2 — useful the day partner/team
  reporting needs per-workspace rollups. It is a **paid add-on with a billing trap**:
  once enabled, ALL identified events in the project are billed at the add-on rate,
  not just group-tagged ones
  ([posthog.com/docs/product-analytics/group-analytics](https://posthog.com/docs/product-analytics/group-analytics)).
  Do not enable without a named question and a cost check.

### 4.2 Extension identity

- `distinct_id` = sha256-16 of `vscode.env.machineId` — already shipped and correct:
  stable per machine, honors the "hashes only" contract (`TelemetryService.ts:118-123`).
  Precedent: Microsoft's own `@vscode/extension-telemetry` attaches the machine id as
  `common.vscodemachineid`
  ([github.com/microsoft/vscode-extension-telemetry](https://github.com/microsoft/vscode-extension-telemetry)),
  so using it as the analytics id is first-party-sanctioned; our extra hash is defense
  in depth. Optional hardening (P2): add an app-specific salt to the hash so our
  distinct_id can never be correlated with another vendor's hash of the same machineId.
- **No identify() in the extension.** There is no login in the extension today; the
  moment one exists, linking the machine-hash to a SaaS user id via `alias` is a
  one-way door (it converts "anonymous machine stats" into "personal data" under GDPR)
  — that is a deliberate CTO decision for later, not a default (flagged in §9 OD-4
  context but not opened as a decision now).

### 4.3 VS Code opt-out compliance (mandatory section)

Already implemented — this section exists to make the contract explicit and reviewable:

1. Sends **only** when `vscode.env.isTelemetryEnabled === true` AND
   `hypercanvas.telemetry.enabled !== false` (`TelemetryService.isEnabled`,
   `TelemetryService.ts:174-176`). This is exactly what the official guide **requires**
   ("it is required that extension authors respect the user's choice by utilizing the
   `isTelemetryEnabled` and `onDidChangeTelemetryEnabled` API"); reading the raw
   `telemetry.telemetryLevel` config is explicitly discouraged as potentially
   incorrect vs the API
   ([code.visualstudio.com/api/extension-guides/telemetry](https://code.visualstudio.com/api/extension-guides/telemetry)).
   A custom PostHog sender wired into `createTelemetryLogger` is compliant under the
   same guide — the logger API exists precisely to take any custom `TelemetrySender`.
2. Both gates are live: flipping either setting stops sends without a reload
   (`subscribeToGateChanges`).
3. Events route through `vscode.env.createTelemetryLogger`, which adds VS Code's own
   built-in cleaning pass on top of our scrubbing.
4. Our opt-out settings carry the required `"tags": ["telemetry", "usesOnlineServices"]`
   (`package.json:463-466`) so they surface under VS Code's telemetry settings search.
5. `telemetry.json` (extension root) enumerates every event + properties for
   `code --telemetry` transparency output; the file is optional per the guide but
   first-party extensions ship it, and P-6 keeps ours complete (CI check proposed in
   §3.4.3(4)). Note: ours uses a simplified `{purpose, comment, properties}` shape
   rather than core's per-property `{classification, purpose}` GDPR-comment format —
   aligning to the core format is a P2 nicety, not a compliance gap (the file format
   is not enforced).
6. One-time privacy notice with a working Disable path (`firstRunNotice.ts`) — note it
   is correctly suppressed while no backend key is configured, so shipping the key
   (Phase 2) is also what activates the notice. The marketplace listing/README must
   gain a short telemetry disclosure paragraph in the same release (Phase 2 acceptance).

### 4.4 GDPR / consent for SaaS (EU)

Facts: EU-resident processing (P-3) is already satisfied by PostHog EU Cloud.
The open question is the cookie/ePrivacy posture, because `posthog-js` defaults to
cookie+localStorage persistence, and strictly read, ePrivacy wants consent for
non-essential cookies even when the analytics themselves ride on legitimate interest.

Recommended posture (also §9 OD-4):

- **Marketing/product pages (logged-out):** cookieless — `persistence: 'memory'`
  (session-scoped, no consent banner needed under the common reading; loses
  cross-session stitching for anonymous visitors, which we can live with).
- **Logged-in app:** persistent id via `identify()` (the id is the account, not a
  tracking cookie), `persistence: 'localStorage+cookie'`, disclosed in the privacy
  policy with an opt-out toggle in `UserSettings`.
- **IP handling:** enable PostHog project setting to discard client IP at ingestion
  (GeoIP city-level is derived before discard); do not store raw IP as a property.
- A privacy-policy page update ships with Phase 1 (acceptance criterion), before
  explicit events with `identify()` go live.

This keeps the banner-free UX for the funnel-critical landing pages while staying
defensible; a full consent-management platform is overkill for a developer tool at
this stage.

---

## 5. Reliability of telemetry itself

The reason this section is first-class: **prod hyperi.de was white-screened and nobody
noticed until a telemetry investigation** (HYP-855 forensics). Two independent failures
compounded: the app crashed at module top (killing the product), and because the crash
was in the same module as `posthog.init`, telemetry died with it — so the outage
produced no signal, just silence. Silence must become an alert.

### 5.1 Init isolation (the #602 lesson, codified)

- Telemetry init lives in its own module with its own try/catch and **no other
  module-top side effects sharing its blast radius** — post-#602 `client/App.tsx`
  already wraps init in try/catch including the guard expression; Phase 1 extracts it
  to `client/lib/telemetry.ts` so App.tsx module-top stays side-effect-free.
- The #602 tripwire tests (`client/__tests__/browser-bundle-safety.test.ts` — no raw
  Vite-isms / node globals in the browser bundle) stay as the regression net; any new
  telemetry module is added to their scan surface.
- Extension side is already exemplary (`sender.ts` never-throw invariants); no change.

### 5.2 Ingestion heartbeat — zero-events alert (P0)

Design (concrete, two layers — belt and suspenders):

**Layer 1 — PostHog native alert:** a Trends insight `count of events` filtered to
`env=production, surface=saas`, with a PostHog **threshold alert**: "less than 1" with
the insight's interval sized to the surface's window from step 3 below (6h for SaaS —
an hourly-interval insight would false-page at night regardless of Layer 2's care) ->
notify. PostHog alerts support lower-bound absolute thresholds on trends
and SQL insights (not funnels), checked hourly (15-minute frequency is a paid-plan
feature), delivered via email/Slack/Discord/Teams/webhooks; anomaly-detection alerts
also exist ([posthog.com/docs/alerts](https://posthog.com/docs/alerts)). Zero-cost to
stand up; its weakness is that it lives inside the same vendor whose ingestion we are
watching, and email is not a pager. **Caveat to verify before relying on it (Low,
spec-web review):** if PostHog evaluates the threshold against the _current, still-open_
6h bucket rather than the last _closed_ one, `count` is naturally near-zero at the start
of every bucket, which would false-fire every 6h regardless of the night-safe window
choice. Confirm PostHog's actual evaluation semantics (closed vs. open interval) before
trusting Layer 1 alone; this is the reason Layer 2 (below) is the real pager and Layer 1
stays "belt and suspenders."

**Layer 2 — external cron probe (the one that pages Alex):** a ~40-line script,
scheduled every 30 min (GitHub Actions `schedule:` in this repo, or the prod host's
cron — GH Actions preferred: config-as-code, no server mutation; fallback host cron
given the June billing outage precedent). Two known GH Actions failure modes are
designed around below: `schedule:` runs are best-effort (delays of 5-30+ min at busy
times) and scheduled workflows are auto-disabled after 60 days without repo activity —
hence the dead-man's switch in step 5.

1. Query PostHog Query API (HogQL), one query per surface with THAT surface's window
   from step 3: `SELECT count() FROM events WHERE timestamp > now() - INTERVAL 6 HOUR
AND properties.env = 'production' AND properties.surface = 'saas'` (extension/server
   variants use `INTERVAL 24 HOUR` once live — without the per-surface filter, healthy
   extension traffic would mask a dead SaaS and vice versa). Secret:
   `POSTHOG_PERSONAL_API_KEY` (read-only scope).
2. If a surface's count breaches its threshold -> send Telegram via Bot API
   (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` secrets — the same bot identity the local
   `tg` utility uses; the cron cannot depend on Alex's laptop being awake, so it talks
   to the Bot API directly): message includes per-surface counts, the window, and a
   link to the PostHog live-events view.
3. **Windows must respect baseline traffic, or the alert trains Alex to ignore it.**
   At ~200 WAU, a 60-min zero on SaaS is NORMAL at night/weekends — a naive 60-min
   zero-alert would false-page and die of alert fatigue. Therefore: the always-on,
   traffic-independent signal is the **synthetic probe** (below) — it runs every cycle
   regardless of user traffic. The zero-events check uses per-surface windows sized to
   baseline: SaaS 6h initially (tighten as traffic grows), extension/server 24h once
   live. Thresholds are config constants, revisited when volume data exists.
4. The probe itself failing (API error, non-200) also sends the Telegram message —
   a broken watchdog must not look like a healthy prod.
5. **Dead-man's switch for the watchdog itself (P-5 applies recursively):** a skipped
   or auto-disabled cron produces no error to catch — the watchdog dies silently. Every
   successful probe run pings a dead-man endpoint (healthchecks.io free tier, or an
   equivalent); the endpoint pages (its own email/webhook -> Telegram) when a ping is
   missed. This is the one piece that must live OUTSIDE both PostHog and GitHub.

**Synthetic check (part of the same probe, and the primary always-on signal):** the
event-based heartbeat detects "events stopped" only when traffic exists; a white screen
at 3am (or one visible only to adblocking users) needs a traffic-independent probe.
Same cron: `curl` hyperi.de, assert HTTP 200 AND the response includes the app-root
marker; a headless-render check (Playwright) is the thorough version but is NOT
required for Phase 1 — the boot canary (§5.3) covers the JS-crash class for real
visitors, and the curl check covers total outage.

### 5.3 `app.telemetryBoot` canary

**Emission point — corrected (High-severity finding, spec-web review):** an earlier
revision of this section placed the emission immediately after successful
`posthog.init`, inside the same isolated module the try/catch lives in (§5.1). That
placement is a real bug in the design, not just an implementation detail: §5.1's own
isolation deliberately moves telemetry init into its own module with **no other
module-top side effects sharing its blast radius** — which means, by construction,
telemetry init now succeeds (and the canary fires) _independently_ of whether the rest
of the app (React mount, App.tsx render) crashes. A crash that happens _after_ a
successful `posthog.init` but during/in mount — exactly the failure class the isolation
was built to stop telemetry from dying alongside — would still see `app.telemetryBoot`
sent, defeating the one differential this canary exists to provide. (HYP-855 itself
predates the #602 isolation and was a same-module crash where init and mount failed
together; post-isolation, a mount-only crash is the gap this correction closes.)

**Corrected design:** the client emits `app.telemetryBoot` once per page load
**immediately after the React root successfully mounts and paints** (an effect on the
root component, or the callback after `ReactDOM.createRoot(...).render()` — NOT inside
the telemetry-init module/try-block itself). `posthog.init` still runs first and in its
own isolated module (§5.1 stands), but the canary event is deliberately emitted from a
_different_ point downstream of it, so its absence can mean "init succeeded but mount
did not." This is the event whose **absence** is meaningful: autocapture can produce
events from cached pages/old tabs long after a deploy breaks cold boots. The Layer-2
probe additionally checks the **differential** condition over the same SaaS window as
§5.2(3) (6h — a shorter window would false-page at night exactly like a naive
zero-events alert): `count(app.telemetryBoot) == 0 AND count(events WHERE
properties.surface = 'saas') > 0`. **The second term must be surface-qualified
(corrected, spec-web review, second pass) — an unqualified `count(any events) > 0` is
a real bug given OD-1's chosen topology:** OD-1 put SaaS and extension in the SAME prod
project (`213539`, §9 OD-1(b)). An unqualified "any events" term would go true from
extension traffic alone (e.g. extension users active worldwide overnight while SaaS has
none), false-paging "SaaS white-screen" purely because the extension is healthy — the
exact alert-fatigue class §5.2(3) exists to prevent, reintroduced here by an
under-qualified condition. **Sequencing note:** this differential is also literally
unevaluable until `surface` is a real property on live events — which, under the
extension-first ordering (§8), means it does not work AT ALL for either surface until
its respective dependency ships (SaaS: Phase 1 item 1's `posthog.register()`;
extension: Phase 2 item 2's `commonProps` addition) — not "partially," as an earlier
phrasing implied. Stale tabs still autocapturing SaaS events while no SaaS cold boot
succeeds is the white-screen-deploy signature, and the differential makes it
traffic-independent within that surface (no SaaS visitors at all -> both SaaS counts
zero -> no page; total outage is the synthetic curl check's job, §5.2). (Extension
equivalent already exists: `session.activated`, which fires from `extension.ts`
activation, after the extension host itself is live — the analogous "downstream of
init" placement.)

**Acceptance criterion addition (Phase 1, §8):** the existing acceptance criteria only
test the canary's presence on a healthy load; add a negative test — inject a mount-time
crash (e.g. via a feature-flagged throw in the root component) in a staging build and
verify `app.telemetryBoot` is **absent** while `$pageview`/other events still fire. This
is the only check that actually proves the canary detects the failure class it exists
for.

### 5.4 Adblock-resistant ingest proxy (SaaS) — DEFERRED

**Status: DEFERRED (CTO decision 2026-07-02).** Kept in this spec for the future — the
design below stays as reference — but it is not being built now. Not part of Phase 1
scope (§8); revisit once SaaS analytics volume/adblock loss actually motivates it.

hyperi.de's audience is developers — adblock rates are far above consumer baseline, and
`eu.i.posthog.com` is on the common blocklists. Without a proxy we undercount the exact
segment we sell to, and the §5.2 alert gets noisier (legit traffic that sends nothing).

Options:

| Option                                                  | Pros                                                                                                                                                                  | Cons                                                                                                                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) PostHog managed reverse proxy                       | **free for all Cloud users**, zero code, live in minutes ([docs/advanced/proxy/managed-reverse-proxy](https://posthog.com/docs/advanced/proxy/managed-reverse-proxy)) | still a separate CNAME'd subdomain — uBlock's CNAME-uncloaking (Firefox) and list updates re-block third-party-resolved hosts; runs on Cloudflare edge ("EU traffic usually hits EU edges, not guaranteed") |
| (b) **Own first-party path on hyperi.de (recommended)** | true same-origin = maximally block-resistant (no CNAME to uncloak); we own the Bun server + domain already; no new infra; EU path fully ours                          | ~a route's worth of code + care with Host header/SNI and body passthrough                                                                                                                                   |
| (c) Cloudflare Worker proxy                             | easy, documented pattern                                                                                                                                              | new infra dependency we do not otherwise run                                                                                                                                                                |

Recommendation: **(b)** — a `/ingest/*` passthrough route in the Bun server
(`server/`), following the documented self-host pattern
([posthog.com/docs/advanced/proxy/nginx](https://posthog.com/docs/advanced/proxy/nginx)):

- `/ingest/static/*` -> `https://eu-assets.i.posthog.com/static/*` (SDK lazy-loads:
  array.js chunks, replay recorder — without this, replay/toolbar silently break).
  This route MUST match BEFORE the catch-all below, or static requests hit the events
  host and the recorder breaks silently;
- everything else under `/ingest/*` -> `https://eu.i.posthog.com/*` (events, session
  recordings, flags — one catch-all covers them);
- each route sets the `Host` header (and SNI) to ITS OWN upstream —
  `eu-assets.i.posthog.com` for the static route, `eu.i.posthog.com` for the catch-all
  — or PostHog returns 401s; preserve `X-Forwarded-For` so GeoIP still works;
- client config: `api_host: 'https://hyperi.de/ingest'` + `ui_host:
'https://eu.posthog.com'` (ui_host keeps toolbar/app links pointing at the real UI —
  required whenever api_host is a proxy,
  [posthog.com/docs/advanced/proxy](https://posthog.com/docs/advanced/proxy));
- path name deliberately avoids "analytics/telemetry/posthog/ph" substrings (blocklist
  regex bait, per the same docs).

EU residency is preserved (P-3): the proxy is a dumb pipe to the EU ingestion host.
If (b) stalls for any reason, (a) is a free same-day fallback — strictly better than
no proxy.

The extension does NOT need this: `posthog-node` from the extension host is a
server-style HTTP client, not subject to browser adblockers.

### 5.5 Delivery guarantees, honestly stated

posthog-js batches and can lose the last moments of a session (page close races); the
extension flushes every 30s + on `deactivate()` (`TelemetryService.startFlushTimer`,
`dispose`). We accept both: telemetry is sampling reality, not accounting. Anything
that must be exact (billing, quotas) is server data, never analytics (§3.3).

---

## 6. Session replay & error tracking

### 6.1 Session replay — recommendation: ON for SaaS prod, masked, 100% while small

- **Where:** SaaS client only. Not in the extension webview (screen-recording a user's
  editor/IDE content crosses the PII contract — file names, source code pixels — and
  `telemetry.json`'s "no source code" promise; do not revisit without CTO sign-off).
  Replay is fully supported on EU Cloud (Frankfurt, AWS eu-central-1) — P-3 holds
  ([posthog.com/blog/posthog-cloud-eu](https://posthog.com/blog/posthog-cloud-eu)).
- **Config (posthog-js):** set masking EXPLICITLY, never trust defaults across SDK
  upgrades (P-2 is our contract, not PostHog's): `maskAllInputs: true` (even though it
  is the documented default — passwords are always masked either way), a
  `maskTextSelector` covering every element that renders user project content
  (rendered TEXT is NOT masked by default — only inputs are), and the `ph-no-capture`
  class on the canvas/preview container to skip it entirely. Masking happens
  client-side; masked data never leaves the browser
  ([posthog.com/docs/session-replay/privacy](https://posthog.com/docs/session-replay/privacy)).
  The canvas iframe content is cross-origin from the recorder's perspective — verify in
  Phase 3 what the recording actually captures around the preview iframe; if user code
  pixels leak, `ph-no-capture` the container wholesale.
- **Sampling:** 100% of sessions while traffic is early-stage (free tier includes
  5,000 recordings/month; see §6.4 — we are nowhere near it). Sampling is a
  server-driven project setting (deterministic by session id), so dialing it down later
  needs no deploy
  ([docs/session-replay/how-to-control-which-sessions-you-record](https://posthog.com/docs/session-replay/how-to-control-which-sessions-you-record)).
  Set a calendar check: when recordings/month approaches ~4k, drop the sample rate or
  switch to trigger-based capture (record only sessions containing `$exception` /
  dissatisfaction events) rather than paying reflexively.
- **Why at all:** the CTO keeps hand-finding interactive defects that green e2e misses
  (mapped-instance mis-selects, false contrast checks, resize-on-auto — the documented
  pattern of interactive bugs found by humans); replay is the cheapest way to see what
  a confused user actually did. **Gap noted, spec-web review:** this is SaaS-only
  replay (this section), but `dissatisfaction.rageClick` — the event-to-recording jump
  described here — exists only in the extension webview pipeline
  (`useDissatisfactionClicks.ts`); the SaaS event table (§3.2) has no equivalent
  today. Either add a SaaS `dissatisfaction.rageClick` event (mirroring the extension
  one) or rely on PostHog's own built-in `$rageclick` autocapture event for the SaaS
  side — pick one explicitly in the implementing PR; the Phase 3 acceptance criterion
  below assumes SOME rage-click signal exists on SaaS and needs whichever is chosen.
- **Perf:** PostHog's own benchmark: the MutationObserver adds ~0.0004% heap, initial
  DOM snapshot ~269KB one-time, ~2.8KB per mutation packet — "no discernible impact"
  ([posthog.com/blog/session-recording-performance](https://posthog.com/blog/session-recording-performance));
  the recorder lazy-loads (not in the base bundle) via the proxy (§5.4 must forward
  `/ingest/static/*`). Enable AFTER the proxy exists, not before — replay assets are
  also adblock targets.

### 6.2 Error tracking — recommendation: PostHog error tracking, drop the Sentry path

Context: `sender.ts` already wires a Sentry EU client (inert — no DSN configured
anywhere, same key-shipping gap as PostHog). There was a past "PostHog/Sentry keys" ask;
the decision has been sitting unmade. Recommendation: **consolidate on PostHog error
tracking, one vendor, one dashboard** (P-1's spirit applied to tooling):

- Error tracking is a shipped, fully-priced PostHog product (no beta label;
  [posthog.com/docs/error-tracking](https://posthog.com/docs/error-tracking)).
- SaaS client: enable posthog-js exception autocapture + explicit
  `posthog.captureException` at the ErrorBoundary seam. Errors land next to the
  events/funnels they broke, linkable to replays.
- Extension host: replace the Sentry branch in `sender.ts` with posthog-node's
  `captureException` (v5 also offers `enableExceptionAutocapture` for uncaught
  exceptions/rejections — we do NOT enable it; the extension already owns process-level
  error capture deliberately, see the `sender.ts` no-global-hooks invariant;
  [posthog.com/docs/error-tracking/installation/node](https://posthog.com/docs/error-tracking/installation/node))
  — **keeping the existing path scrubbing** (`stripPaths` moves in front of the PostHog
  call; the PII contract does not relax because the vendor changed).
- Free-tier math also favors consolidation: PostHog includes 100K exceptions/month
  free vs Sentry's 5K
  ([posthog.com/docs/error-tracking/pricing](https://posthog.com/docs/error-tracking/pricing),
  [posthog.com/blog/posthog-vs-sentry](https://posthog.com/blog/posthog-vs-sentry)).
- What we give up vs Sentry: deeper release-health/source-map tooling, a more mature
  grouping engine, tracing (PostHog's is alpha). Acceptable at our error volume; the
  cost of two vendors (two DSNs to ship, two dashboards nobody checks, two DPAs) is the
  bigger tax today. Escape hatch documented: the `TelemetrySender` interface
  (`sender.ts:33-42`) is exactly the seam where Sentry can be re-added later without
  touching call sites.
- Effort note: removing Sentry deletes the `@sentry/node` dependency and its careful
  no-global-hooks setup — net code shrink.

### 6.3 Feature flags

Not a Phase 1-2 need (no experiment backlog exists). Free tier is generous (1M flag
requests/month, [posthog.com/pricing](https://posthog.com/pricing)), so cost is not the
blocker — the absence of a use-case is. Phase 3 evaluates PostHog feature flags for
staged rollouts of risky extension features (e.g. new write pipelines) — the extension
side would need flag evaluation via posthog-node (each poll is a network call from the
editor; cache aggressively, fail to defaults). Do not build flag plumbing speculatively
(YAGNI); one concrete rollout use-case triggers it.

### 6.4 Cost estimate

PostHog free tier (verified 2026-07 at [posthog.com/pricing](https://posthog.com/pricing)):
1M analytics events, 5K replay recordings, 1M flag requests, 100K exceptions per month,
usage-based after (events from $0.00005, recordings from $0.005). Napkin: 200 WAU x 20
sessions/mo x 150 events/session ≈ 600k events/month — inside free tier; replay at 100%
of a few hundred sessions/week is far under 5k/month. Conclusion: cost is not a
constraint until roughly 10x current scale; volume guards (§3.4.4) matter more for
signal-to-noise than for money.

---

## 7. Dashboards & consumption

Five named dashboards, each with an owner and a cadence. A dashboard nobody is
scheduled to look at is dead weight (P-1 applies to dashboards too).

| #   | Dashboard                            | Contents                                                                                                                                                                                                                                                     | Who / when                                                                                   |
| --- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| D-1 | **Activation funnels**               | Extension: activate -> firstPreview -> first select -> first styleEdit -> first drag/resize (unique-user funnel, `msSinceActivate` medians). SaaS: landing -> signup -> project.created -> editor.opened -> canvasRendered. Conversion + drop-off per stage. | Alex, weekly; the single most decision-relevant view                                         |
| D-2 | **Feature adoption by style system** | `inspector.styleEdited` / element mutations broken down by `cssFramework` x `designSystem` (§3.4.3); `writeTarget` distribution per system (are edits landing paradigm-native?); `samples.generated` outcomes per system                                     | Alex + styles-system workstream, weekly; directly steers the css-in-js editability program   |
| D-3 | **Stability & errors**               | `preview.renderFailed`/`blankDetected` rate by `errorCategory`; `devServer.failed`; `error.*` trends; `editor.canvasRenderFailed` (SaaS); error-tracking issue list; `dissatisfaction.*` trend as the frustration proxy                                      | Alex, weekly + after every extension release (release regression check against `appVersion`) |
| D-4 | **Telemetry health**                 | events/hour per surface (the §5.2 insight), `app.telemetryBoot` count, `session.activated` count, last-event-seen per surface, probe-run results                                                                                                             | Nobody daily — this one exists to feed alerts; humans look only when paged                   |
| D-5 | **Weekly partner report (Denny)**    | WAU/MAU per surface, new signups (`srv.userSignedUp` — ground truth), activation rate (D-1 top-line), top-3 css systems by edit volume, releases shipped                                                                                                     | Denny, weekly; English, screenshot-friendly (partner-forwarding rule)                        |

**Weekly auto-summary to Telegram (design only, build in Phase 3):** "design only" means
this spec defines the summary's **format, metrics, and queries** — the D-5 numbers, the
HogQL/Query-API calls that produce them, and the HTML layout below — but the actual
**sending pipeline** (the cron job that runs the queries and calls the Bot API on a
weekly schedule) is a Phase 3 build item, not built as part of this spec. The §5.2 cron
infrastructure gains a weekly mode — query the D-5 numbers via the PostHog Query API,
format an HTML summary (WAU, signups, activation %, top css systems, error-rate delta
vs previous week), send via Bot API to Alex's chat. Reuses the probe's secrets and
runner; ~a screen of code. Explicitly a summary-with-link, not a dashboard replacement.

### 7.1 Real-time critical-problem alerts to Telegram (P0, added 2026-07-02)

**Not a Phase 3 nicety — added directly by the CTO during a live incident:** the prod
landing white-screen (HYP-855, §5) sat undetected until a manual telemetry
investigation; a _weekly_ summary would never have caught it. This requirement is a
distinct, higher-priority delivery from the weekly-summary design above — real-time,
not batched — and reuses the same Telegram delivery path.

- **Source signals:**
  1. **PostHog error-rate spike** — a PostHog trends/SQL insight on `error.*` /
     `editor.canvasRenderFailed` / error-tracking exception volume, alerting on a
     sudden rate increase over a short rolling window (minutes, not the §5.2 zero-events
     windows — this is "too many errors", not "too few events"). **Needs an absolute
     floor, not a bare percentage (corrected, spec-web review):** at ~200 WAU (§6.4)
     absolute error counts are tiny — 1 -> 3 errors in a minute is a "+200% spike" by
     percentage alone but is not an incident. Gate on **rate spike AND count >= N**
     within the window (N a config constant, revisited with volume data, same spirit
     as §5.2(3)'s windows), or this P0 alert — added specifically to stop the next
     silent incident — trains Alex to ignore it before it ever proves itself, which is
     exactly the alert-fatigue failure §5.2 was designed against.
  2. **Uptime synthetic probe on `hyperi.de`** — the same-cron synthetic curl check
     already specified in §5.2 (assert HTTP 200 + app-root marker) is the
     traffic-independent signal for **total outage**. The **actual white-screen
     signature** from the incident that prompted this requirement is narrower and
     belongs specifically to the `app.telemetryBoot` differential from §5.3 (count of
     `app.telemetryBoot` going to zero while other events keep flowing) — per §5.2's
     own existing distinction, curl-plus-marker passes on a 200-with-broken-JS
     white-screen (the server still returns the static shell fine), so the curl half of
     this signal is a total-outage check, not a white-screen detector; do not conflate
     the two when implementing (see the wave-1 correction below).
- **Delivery:** the existing `tg` CLI / Bot API path already used by the §5.2 heartbeat
  probe (`TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`) — no new delivery mechanism, just a
  faster-firing, error/uptime-triggered check layered onto the same cron and secrets.
- **Cross-reference — out of scope here:** a CI red-on-main -> Telegram alert (catching
  a broken build/deploy before it reaches prod) is a **separate, already-tracked**
  concern from this telemetry-based, post-deploy runtime signal; do not conflate the two
  when implementing.
- **Priority: high** — flagged during a live white-screen incident, not a hypothetical;
  should ship alongside the §5.2 heartbeat (it is layered onto the same cron, probe, and
  secrets, so it cannot ship before its dependency) rather than waiting for Phase 3's
  weekly-summary build.
- **Honest wave-1 scope given the §8 extension-first priority call — including a real
  residual gap, flagged rather than glossed over:** the signals above are keyed to
  whichever surfaces are actually emitting at build time, not fixed to SaaS.
  - The **uptime synthetic probe** (part of signal 2, `[BOTH]`/surface-independent) is
    live immediately regardless of either surface's event state — but per the
    total-outage-vs-white-screen distinction drawn in signal 2 above, it would NOT have
    caught the actual HYP-855 white-screen (a 200-with-broken-JS class, not a
    non-200/outage class); only the `app.telemetryBoot` differential would have.
  - The **error-rate-spike signal** (signal 1) and the **boot/activation differential**
    (the rest of signal 2) already have extension-side inputs — `error.*`,
    `preview.renderFailed`, `devServer.failed` for errors, and `session.activated` as
    the extension's boot-equivalent (§5.3) — that go live (raw events start flowing
    into the shared prod project `213539`, OD-1) as soon as Phase 2's key ships, which
    per §8 is priority #1 and ships _ahead of_ deferred SaaS work. **Caveat (spec-web
    review):** the events existing is not the same as an alert being able to
    attribute them to the extension specifically — since OD-1's chosen topology puts
    SaaS and extension in the SAME prod project, any query/alert that filters on
    `properties.surface = 'extension'` (as §5.2's design does) additionally needs
    Phase 2 item 2's `commonProps` addition; without it these events are visible in
    the project but not cleanly separable from SaaS traffic by surface. These two
    signals CAN be live on the **extension** surface from early in wave 1 once both
    the key AND item 2 ship — but that protects the extension, not the SaaS landing
    page HYP-855 actually hit.
  - What stays deferred is specifically the **SaaS-side** inputs to those same two
    signals — `editor.canvasRenderFailed` (Phase 1 item 4) and, critically, the SaaS
    `app.telemetryBoot` differential (Phase 1 item 1, §5.3) — until SaaS work lands.
    **Residual gap, stated plainly:** under the extension-first ordering, wave-1 does
    NOT close the exact HYP-855 failure class for the SaaS landing page — only the
    weaker total-outage probe runs there until the deferred SaaS boot canary ships.
    This is a real trade-off of the SaaS-deferred decision (§8), not a rounding error;
    flagging it here for CTO awareness rather than silently reprioritizing item 1
    ourselves. Do not claim wave-1 §7.1 covers SaaS error-rate or white-screen-class
    detection before `editor.canvasRenderFailed` / `app.telemetryBoot` exist in prod —
    extension error/boot detection is a separate, earlier-available claim.

---

## 8. Rollout phases

**Priority order (CTO decision 2026-07-02): the VS Code extension is priority #1.** It
is the main product target and, per §2.2, currently ships **zero** telemetry in
production despite already having the most mature pipeline in the company — that gap
closes first. SaaS work below stays fully in this spec (the design is not dropped) but
is **deferred — future**: build the extension-enabling work ahead of any SaaS-only item.
Each scope item below is tagged with its surface and build-order weight:
`[EXT]` = extension, ships first; `[SAAS — deferred]` = SaaS-only, waits until after
extension telemetry is live; `[BOTH]` = shared infra needed either way (not deferrable
just because SaaS is deferred).

Recommended execution order given the priority call: Phase 2 (`[EXT]`, activates the
already-built 64-event pipeline) plus the `[BOTH]` items of Phase 1 — item 3 (heartbeat/
probe scaffolding including the §7.1 real-time alerts) and item 6 (OD-1 topology) — go
first; the `[SAAS — deferred]` items of Phase 1 (items 1, 2, 4, 5 — including SaaS init
isolation/`client/lib/telemetry.ts` extraction, which is SaaS-client-only code and does
not get a `[BOTH]` exemption) and Phase 3 follow once extension telemetry is live and
stable. The phase numbering below is kept as originally scoped (grouped by deliverable,
for design completeness) — the per-item `[…]` tags in the Phase 1/2/3 scope lists below
are the actual build-order signal, not the "Phase N" label or this summary paragraph.

### Phase 1 — Reliability net + SaaS core (est. 2-3 agent-days)

Scope:

1. `[SAAS — deferred]` Extract client telemetry init to `client/lib/telemetry.ts`
   (§5.1) with the `capture()` wrapper (§3.2); `app.telemetryBoot` canary (§5.3).
2. `[SAAS — deferred, DEFERRED per §5.4]` `/ingest` reverse proxy on the Bun server +
   client `api_host` switch, including `/ingest/static/*`. Kept in scope for the
   future; not being built now (CTO decision 2026-07-02, §5.4).
3. `[BOTH]` Ingestion heartbeat: PostHog threshold alert (Layer 1) + external cron
   probe with Telegram paging + synthetic curl check + dead-man's switch on the probe
   itself (Layer 2, §5.2) — includes the §7.1 real-time critical-problem alerts
   (high priority, added 2026-07-02). **Caveat (corrected, spec-web review):** Layer
   1's per-surface event-count alert is live for the surface-independent synthetic
   probe from wave 1, but is meaningfully filterable for **neither** surface out of
   the box: the **SaaS**-surface half waits on this item's super-props registration
   (§5.1), and the **extension**-surface half waits on Phase 2 item 2's
   `commonProps` addition (§3.1, §8) — the extension's Phase 2 key alone does not
   make it `surface`-filterable. Build the infra now; do not expect accurate
   surface-filtered alerting from either surface until its respective dependency
   lands.
4. `[SAAS — deferred]` SaaS P0 events (§3.2: auth, project.created, editor.opened,
   canvasRendered, canvasRenderFailed) + `identify()`/`reset()` (§4.1).
5. `[SAAS — deferred]` Consent posture: cookieless on logged-out pages, privacy-policy
   update, IP-discard project setting (§4.4) — implements OD-4's option (a), which is
   the **recommendation**, not yet a CHOSEN decision (§9 OD-4 remains open); revisit
   this item if OD-4 is decided differently before it's built. Deferred either way, so
   not currently time-sensitive.
6. `[BOTH]` OD-1 outcome applied (dev/prod separation).

Acceptance criteria:

- [ ] Blackhole test: with ingestion blackholed in a staging setup and probe windows
      set to test values, the probe pages Telegram within one cron cycle + window —
      demonstrated once, with the message screenshot. (Production detection latency =
      surface window + cron phase + GH Actions scheduling slack; the synthetic curl
      check is the fast path for total outage.)
- [ ] Dead-man's switch verified: pausing the cron produces a page from the external
      endpoint within its grace period.
- [ ] **Added, spec-web review (second pass):** §7.1 error-spike test — a staged error
      burst (above the N-count floor added to §7.1 signal 1) pages Telegram within one
      cron cycle, demonstrated on whichever surface is live at test time (extension,
      given the extension-first order, §8) — not blocked on the deferred SaaS boot
      canary's own negative test. Without this, the highest-priority, incident-motivated
      detector in this plan (§7.1, added live during HYP-855) ships with no proof it
      actually fires.
- [ ] No false pages: one week of production operation with real (low, nightly-zero)
      traffic produces zero unwarranted pages — the windows of §5.2(3) hold in practice.
- [ ] ~~`app.telemetryBoot` visible in PostHog from a prod cold load; D-4 dashboard
      live.~~ DEFERRED with item 1 above (§8, `[SAAS — deferred]`) — `app.telemetryBoot`
      is a SaaS client canary (§5.3); re-add when SaaS client init work lands.
- [ ] ~~Negative canary test: a staged mount-time crash produces NO
      `app.telemetryBoot` while other events keep flowing (§5.3, added spec-web
      review).~~ DEFERRED with item 1 above for the same reason — this is the check
      that proves the corrected §5.3 emission point (post-mount, not post-init)
      actually detects the failure class it exists for; do not skip it when item 1
      ships even though it is easy to satisfy with the presence-only check above.
- [ ] ~~Signup -> project -> editor funnel (D-1 SaaS side) renders with real
      events.~~ DEFERRED with item 4 above (§8, `[SAAS — deferred]` SaaS P0 events) —
      re-add when the SaaS explicit events ship.
- [ ] ~~Proxy verified: events ingest with uBlock Origin enabled in a test browser.~~
      DEFERRED with item 2 above (§5.4) — re-add when the proxy is actually built.
- [ ] ~~Autocapture events carry the registered super-props (`surface`, `env`) —
      verified on live events, since every heartbeat filter depends on them (§3.1
      note).~~ DEFERRED for **both** surfaces, on two different items — **corrected,
      spec-web review** (this checklist previously claimed the extension already had
      this; it does not). The SaaS half is DEFERRED with item 1 above (super-props
      registration via `posthog.register()` is part of the deferred SaaS client-init
      extraction, §5.1). The extension half is DEFERRED with Phase 2 item 2 below
      (§3.1, §8) — `TelemetryService.commonProps` today merges only `machineId`,
      `sessionId`, `extVersion`, not `surface`/`env`; `surface`/`env`-filtered event
      counts for the extension become available only once Phase 2 item 2 ships, not
      merely from the key (Phase 2 item 1). Only the surface-independent synthetic
      probe is live from wave 1 without a dependency.
- [ ] No paths or free-form user strings in any captured event (spot-audit of live
      events) — applies to every surface actually live at acceptance time, not just
      SaaS: given the extension-first order (§8), Phase 2's extension events are likely
      live by the time this is checked, on top of the SaaS autocapture that is already
      live today (§2.1). Re-audit as each remaining deferred item ships.

### Phase 2 — Extension goes live, compliantly (est. 2-3 agent-days) — `[EXT]` PRIORITY #1

**All items in this phase are `[EXT]` and ship ahead of the `[SAAS — deferred]` items in
Phase 1/3, per the priority order stated at the top of §8 (CTO decision 2026-07-02).**

Scope:

1. OD-2 outcome: ship the PostHog key in extension builds (esbuild `define` of
   `HYPERCANVAS_POSTHOG_KEY` in `esbuild.js` + `build-and-install.sh`/CI, keeping the
   user setting as override) — this single change activates the existing 64-event
   pipeline AND the first-run privacy notice. **Implementation gotcha (found in
   spec-web review):** esbuild `--define` does textual/AST replacement of the exact
   dotted expression it is told to match (e.g. `process.env.HYPERCANVAS_POSTHOG_KEY`).
   `TelemetryService.readConfig()` currently reads the key via `const env =
process.env;` then `env.HYPERCANVAS_POSTHOG_KEY` (`TelemetryService.ts:162,170`) —
   an aliased local, not the literal `process.env.HYPERCANVAS_POSTHOG_KEY` path — so a
   define targeting that literal path does **not** match this read, and a VSIX build
   would still see an empty key at runtime with the plan otherwise unchanged. This
   item's implementation must either (a) change `readConfig()` to read
   `process.env.HYPERCANVAS_POSTHOG_KEY` directly (no `env` alias) so the define
   substitutes it, or (b) introduce a distinct build-time constant (e.g.
   `__HYPERCANVAS_POSTHOG_KEY__`) defined by esbuild and read directly at that name
   instead of through `process.env`. Either is a one-line-plus-define change; call it
   out explicitly in the implementing PR so it isn't silently dropped.
2. Add `surface: 'extension'`, `env`, and rename `extVersion` -> `appVersion` in
   `TelemetryService.commonProps` (**found in spec-web review**: today
   `commonProps` merges only `machineId`, `sessionId`, and `extVersion` —
   `TelemetryService.ts:140-144` — none of `surface`, `env`, or the spec's
   `appVersion` name are merged, despite §3.1's common-properties table listing all
   three for every surface). Required before the §5.2 heartbeat's
   `properties.surface = 'extension'` filter, and any other per-surface PostHog
   query, can match a single real extension event — without this item, shipping the
   key (item 1) still leaves extension events invisible to every surface-filtered
   insight/alert in this plan. **Two sub-notes:**
   - The `extVersion` -> `appVersion` rename can be a straight rename, not §3.4.3's
     additive `uiKit`->`designSystem` dance: per §2.2, the extension ships **zero**
     telemetry in prod today (`backendConfigured === false`), so there is no live
     `extVersion`-keyed dashboard/query to break.
   - `env` needs a source. Prefer the already-available VS Code runtime API over a
     new esbuild define: `context.extensionMode === vscode.ExtensionMode.Production`
     (`Production` for a real marketplace/VSIX install, `Development` under F5/`--
extensionDevelopmentPath`) — no build-time baking required, unlike the key in
     item 1. `esbuild.js`'s extension-host build (`extensionCtx`, `src/extension.ts`,
     `platform: 'node'`) currently has **no** `define` block at all (only the
     separate webview browser bundles do, for unrelated reasons); this item does not
     need to add one.
3. Marketplace/README telemetry disclosure paragraph (§4.3(6)).
4. Axis props on every event listed in §3.4.3(1) — style-write AND element-mutation
   events (`inspector.*`, `canvas.elementInserted/Deleted/Duplicated/Wrapped/Moved/
Resized`, `canvas.dragEnded`, `samples.generated`; scope corrected, spec-web review
   — not just the style-write subset) + `uiKit`->`designSystem` AND
   `cssSystem`->`cssFramework` additive renames (§3.4.3(3)) + `telemetry.json` updates
   - the events-vs-manifest CI check (§3.4.3(4)).
5. New events: `samples.generated`, `preview.bridgeTimeout` (§3.4.2).
6. Hover/zoom volume guard verification (§3.4.4).
7. Heartbeat probe extended to the `extension` surface (24h window, §5.2(3)) — depends
   on item 2 for the `surface`-filtered query to return anything.

Acceptance criteria:

- [ ] A fresh VSIX install (VS Code telemetry ON) shows the privacy notice once and
      `session.activated` arrives in PostHog with `cssFramework`/`designSystem`.
- [ ] Flipping VS Code telemetry OFF (or `hypercanvas.telemetry.enabled: false`) stops
      events without reload — re-verified end-to-end against the live backend.
- [ ] `telemetry.json` == `TelemetryEvents` enforced by CI (red on divergence).
- [ ] D-1 extension funnel + D-2 render with real events from at least 2 machines.
- [ ] A live extension event is retrievable via a `properties.surface = 'extension'`
      PostHog query (proves item 2's `commonProps` addition actually landed, not just
      the key).

### Phase 3 — Replay, error tracking, weekly report (est. 3-4 agent-days)

Scope:

1. `[SAAS — deferred]` Session replay on SaaS: masked, 100%, post-proxy (§6.1); verify
   canvas/preview masking empirically. Blocked on the §5.4 proxy, itself deferred.
2. `[BOTH]` Error-tracking consolidation per OD-3 (CHOSEN: PostHog both surfaces,
   remove Sentry path from `sender.ts`, keep `stripPaths` scrubbing) (§6.2).
3. `[BOTH]` Weekly Telegram summary cron (§7) — design-only in this spec (format,
   metrics, queries); the sending pipeline is the Phase 3 build item. Note: the
   real-time critical-problem alerts (§7.1) are a separate, higher-priority item
   already scoped into Phase 1's `[BOTH]` heartbeat work, not this weekly cron.
4. `[BOTH]` D-5 partner dashboard finalized with Denny's actual asks.
5. `[BOTH]` Feature-flags evaluation memo (one page: first concrete rollout candidate
   or explicit "not yet") (§6.3).

Acceptance criteria:

- [ ] A rage-click event links to a watchable, correctly-masked recording (no user
      source code readable in any sampled frame — screenshot proof).
- [ ] A thrown test error in prod SaaS appears as a grouped error-tracking issue.
- [ ] One weekly summary delivered to Telegram with real numbers.
- [ ] Sentry dependency removed (or OD-3 documented otherwise).

Sequencing note: phases are ordered by risk-reduction per effort — the heartbeat
(Phase 1) protects everything after it; the extension key (Phase 2) unlocks the
already-built main-product telemetry; replay/reporting (Phase 3) are additive comfort.

---

## 9. Open decisions for the CTO

**OD-1 — PostHog project topology (dev/prod, surfaces). CHOSEN: (b) — CTO decision
2026-07-02.**
Options: (a) one project `213539` for everything, separated by `env`/`surface` props —
**rejected:** prop-based separation keeps polluting autocapture and every insight needs
an `env` filter forever (one forgotten filter = wrong numbers to a partner); (b) **CHOSEN
— two projects: prod (all surfaces, `213539`) + one dev/test project** for local dev,
e2e, and staging; (c) per-surface projects — **rejected:** kills cross-surface funnels
and identity joins for no gain at our volume.
Cost of (b): one extra key in configs. e2e lanes get the dev key or
`opt_out_capturing()` (§2.4).

**OD-2 — How the extension ships its PostHog key. CHOSEN: (a) — CTO decision
2026-07-02.**
Options: (a) **CHOSEN — bake at build time via esbuild define**; (b) keep env-var only
(status quo = telemetry stays dead in prod) — **rejected:** leaves the main product
target at zero telemetry, the exact gap this plan exists to close (§2.2); (c) default
value in the `package.json` setting — **rejected:** exposes the key as a user-editable
default that survives into settings-sync diffs.
Rationale for (a): the key is a public write-only project token — the client already
commits the same class of key in `client/App.tsx:25`; the `package.json` "Never commit a
key here" caution targets the user-visible setting, not the build. (a) keeps the setting
as a clean override for self-hosters while making prod builds work.
Implementation note (spec-web review — see Phase 2 item 1, §8): a naive define does not
actually wire through, because `TelemetryService.readConfig()` reads the key via a
`const env = process.env` alias rather than the literal `process.env.X` path esbuild's
`--define` matches; the implementing PR must change the read site or introduce a
dedicated define constant, or (a) ships with the key still empty at runtime.

**OD-3 — Error tracking: PostHog-only vs keep Sentry. CHOSEN: (a) — CTO decision
2026-07-02.**
Options: (a) **CHOSEN — PostHog error tracking on both surfaces, delete the Sentry path**
(§6.2); (b) Sentry for the extension host + PostHog for SaaS — **rejected:** keeps a
second vendor/DSN/dashboard alive for no volume-justified reason at our error scale;
(c) Sentry everywhere — **rejected:** loses the events-adjacent-to-errors/replays
ergonomics and the free-tier headroom (100K exceptions/month vs Sentry's 5K, §6.2).
Rationale for (a): one vendor, errors adjacent to funnels/replays, net code deletion;
the `TelemetrySender` seam preserves the escape hatch if Sentry's release-health tooling
is ever needed again for extension crash triage.

**OD-4 — SaaS consent mode. NOT decided — awaiting explicit CTO choice; recommendation
remains (a).**
Options: (a) **cookieless (`persistence: 'memory'`) on logged-out pages + persistent
identified analytics after login, privacy-policy disclosure + settings opt-out, no
banner** (recommended, §4.4); (b) classic consent banner gating all analytics (cleanest
legally, costs funnel visibility on the landing page — the exact place we need it);
(c) full persistence for everyone, banner-free (indefensible under ePrivacy for EU
traffic; not recommended).
Recommendation: **(a)** — pragmatic and defensible for a developer tool; revisit if
legal counsel or an enterprise customer questionnaire demands (b).

Clarifications answering the CTO's questions (2026-07-02, not a decision — background
for whichever option is ultimately chosen):

- **Where does the cookie-banner obligation actually come from?** ePrivacy (the rule
  governing storing/reading cookies and localStorage on a user's device), not GDPR as
  such — GDPR governs processing personal data once collected, ePrivacy governs the
  act of storing/reading anything on the device in the first place. Option (a) is
  cookieless pre-login (`persistence: 'memory'` — nothing is stored on the device at
  all before login), so the ePrivacy storage trigger never fires and no banner is
  required for that surface; privacy-policy disclosure plus a post-login opt-out in
  `UserSettings` are what carry the GDPR/legitimate-interest posture once persistence
  starts after login.
- **Does the VS Code extension need a consent banner too?** No — the extension shows
  no banner and is not proposed to grow one. It follows the editor's own telemetry
  convention instead: respect VS Code's telemetry setting (send nothing when the user
  has it off — already implemented via `vscode.env.isTelemetryEnabled` +
  `onDidChangeTelemetryEnabled`, per §4.3's guidance to use that API rather than reading
  the raw `telemetry.telemetryLevel` config directly) plus disclosure via the README and
  the one-time first-run notice (`firstRunNotice.ts`, §4.3(6)). This is a different
  compliance mechanism than the SaaS cookie question above — extension telemetry is not
  cookie/localStorage-based browser tracking, so ePrivacy's cookie-banner trigger does
  not apply there in the first place.

---

_End of plan. Implementation is intentionally out of scope; each phase becomes its own
ticket(s) referencing this spec, with per-event PRs quoting the "Question it answers"
column per P-1._
