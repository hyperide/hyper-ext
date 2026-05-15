# Enabling System Spec

## ES.ARCH.001 Layered architecture of HyperCanvas enabling system

```yaml spec-section
id: ES.ARCH.001
spec: enabling-system
kind: enabling.architecture
title: Five-layer architecture — Platform, Core Engine, Platform Adapters, Canvas UI, Delivery Surfaces
statement_type: explanation
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [TS.BOUNDARY.001]
supersedes: [ES.placeholder.001]
terms: [HyperCanvas]
target_refs: [TS.ENV.001, TS.ROLE.001]
evidence_required:
  - kind: manual
    description: shared lib/ is imported by both extension and SaaS without duplication
```

**Layer stack (each layer depends only on layers below it):**

**L0 — Platform contracts**: VS Code Extension API, Node.js/Hono HTTP runtime, Electron, browser APIs. No dependencies. All other layers depend on L0.

**L1 — Core engine** (`lib/`, `server/`): AST read/write (TypeScript/JSX), i18n read/write (JSON + merged-TS), style adapters (Tailwind, CSS Modules, inline styles). Shared between extension and SaaS — one implementation, no duplication. Depends on L0 only.

**L2 — Platform adapters**: FileIO abstraction (VS Code API vs Node.js fs), RPC/message bridge (webview ↔ extension host), dev-server proxy. Depends on L1.

**L3 — Canvas UI** (`client/`): React inspector panel, canvas overlay, preview iframe, drag/drop, i18n inspector. Communicates with L2 via message bridge. Depends on L2.

**L4 — Delivery surfaces** (one-way depends on L0–L3, surfaces do not depend on each other):
- **VS Code Extension** (.vsix): webview host, activation events, commands palette, SCM integration, panel lifecycle. Installed locally in VS Code.
- **SaaS**: browser-based web app, auth, multi-tenant workspace management, billing. Runtime: Docker containers on k3s cluster; cloud dev-server per workspace. Same L1 core via HTTP routes (Hono); L3 canvas UI served in browser.

## ES.WORK.001 Work methods for HyperCanvas enabling system artifacts

```yaml spec-section
id: ES.WORK.001
spec: enabling-system
kind: enabling.work_methods
title: How specs, decisions, commissions, runtime runs, and evidence are produced
statement_type: duty
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [ES.ARCH.001]
supersedes: []
terms: [HyperCanvas]
target_refs: [TS.ENV.001, TS.ROLE.001, TS.BOUNDARY.001]
evidence_required:
  - kind: manual
    description: haft spec check returns clean after each new section is approved
```

**Five work methods — each names actor, capability, method, and produced work:**

**Specs** — actor: CTO (human principal) + Claude Code (agent); capability: authoring formal SpecSections grounded in code/tests; method: haft onboarding loop (next_step → draft → human approves → haft spec onboard --approve); work: active SpecSection with valid YAML in `.haft/specs/`. Gate: `haft spec check` must be clean before status flips to active.

**Decisions** — actor: CTO + Claude Code; capability: evaluating non-trivial architecture trade-offs; method: DecisionRecord drafted with rationale, alternatives, rollback, valid_until; CTO approves; work: approved DecisionRecord in haft DB + markdown projection. Trigger: any non-trivial architecture choice or constraint change.

**Commissions** — actor: Claude Code; capability: scoping bounded implementation work; method: WorkCommission created with explicit scope, linked Decision, exit criteria; work: WorkCommission record. Trigger: after Decision is recorded. Commission authorizes code changes within the declared scope only.

**Runtime runs** — actor: automated Docker harness; capability: running Playwright+Electron test suite against the VS Code extension; method: `cd ext-test-projects/e2e && HYPER_E2E_SHARDS=3 bash scripts/docker-parallel-run.sh` — 3 isolated Docker containers, each hosts one Playwright worker with a worker-scoped shared VS Code instance (Electron); `git checkout -- .` restores test project files before each test; CDP mouse used for all iframe interactions (frame locator clicks are blocked by nested webview sandbox); when `[test-errors]` flood exceeds ~5 repeats for one test, that test is failed fast and skipped — the shard continues on remaining tests; the shard is killed only if the same error floods across all subsequent tests (shared VS Code state broken, systemic infra failure); after the run, failing tests are re-run as a subset (`--grep` / `--project`) to validate fixes without re-running the full suite. Commit time must predate run start — if the fix commit is newer than the first `sharedVSCode setup START` timestamp in the log, the run is stale and must be relaunched; work: per-shard artifacts in `docker-artifacts/run-<id>/shard-{1,2,3}/` — `docker.log` (Playwright stdout), `ast-debug.log` (extension AST operation trace), `screenshots/` (failure screenshots). Check: all shards exit 0, no `[test-errors]` flood, pass/fail/skip counts sent to Telegram.

**Evidence** — actor: Playwright test harness (automated) + agent (critical review); capability: producing per-test pass/fail signals, iframe runtime diagnostics, and visually verified screenshots; method: two-tier evidence — (1) test result: GREEN/RED recorded in `docker.log` per named test ID (e.g. `PI-5-DR-EK`, `PI-7-9`); (2) iframe diagnostics: `[test-errors]` markers in `docker.log` capture `console.error`, `pageerror`, and HMR failures inside the preview iframe that are invisible in normal pass/fail output — must be grepped separately alongside `— failed` lines; failure screenshots captured automatically via `screenshot: 'only-on-failure'`, stored in `docker-artifacts/run-*/shard-*/screenshots/`; screenshots are read and reviewed critically to **find problems**, not confirm expectations — the reviewer describes literally what is visible before comparing to expected, checks for hidden failures (empty preview, "No element selected", raw `{t("...")}` literal, crashed extension host), and rejects non-representative screenshots (a passing test with an empty canvas proves nothing); work: evidence record = test name + shard + `docker.log` path + reviewed screenshot (or explicit "screenshot not representative" note). Decay trigger: any commit touching the spec area (L1 AST engine, L3 canvas UI, L4 extension) that post-dates the run start time makes the evidence stale — rerun required.
