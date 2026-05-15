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

## ES.EFB.001 Effect boundaries — who may read and write what

```yaml spec-section
id: ES.EFB.001
spec: enabling-system
kind: enabling.effect_boundaries
title: Actor mutation rights across the five-layer architecture
statement_type: duty
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [ES.ARCH.001]
supersedes: []
terms: [HyperCanvas]
target_refs: [TS.BOUNDARY.001, TS.ENV.001, TS.ROLE.001, ES.ARCH.001]
evidence_required:
  - kind: L1
    description: no fs/vscode/path imports in L3 client source — enforced by Biome/TypeScript
  - kind: E2E
    description: all write paths (JSX, i18n, CSS) exercise the L1 adapter chain, not direct FS
  - kind: manual
    description: shared code (L1/L2) changes have a failing test written before any production change
```

**Actor mutation rights:**

| Actor | Direct write | Direct read | Constraint |
|---|---|---|---|
| L3 Canvas UI (browser / webview) | none | none | All project state access via L2 message bridge — both reads and writes |
| L4 Extension host | VS Code workspace state, file watchers, diagnostics | VS Code API | Project file writes route through L1 via L2 FileIO; extension does not invoke git |
| L1 Core engine | User project files (JSX, i18n, CSS) | User project files | Only via L2 FileIO adapter; never direct |
| L2 Platform adapters | L1 outputs (bridge, proxy) | L1 inputs | Bridge between L3 and L1; no independent business logic |
| MCP tools | Trigger L1 operations | L1 read results | Only authorized external write surface for AI agents |
| External AI agents (Claude Code, Codex) | Any layer via tools | Any layer | L1/L2 shared code requires TDD + commit-level impact analysis |

**Boundary rules:**

**L3 no-direct-access rule** — L3 has no Node.js runtime; FS access is physically impossible. Architectural rule additionally prohibits `fs`, `vscode`, or Node path imports in L3 client code (enforced by Biome). L3 reads project state (element styles, i18n keys, computed layout) and writes changes exclusively via L2 message bridge. Neither direction may bypass the bridge.

**Write routing invariant** — All **style** writes (Tailwind classes, CSS Modules, inline styles) are routed through `StyleWritePlanner.selectTarget()` → L1 adapter. Structural JSX writes (delete, duplicate, move) route through `AstService` directly. i18n writes route through `AstBridge` → `AstService.updateI18nKey` / `writeI18nResource`. No parallel write path may exist in L3 or L4 for any of these categories. Any direct file mutation in a delivery surface is a boundary violation.

**Shared code change gate** — Modifying currently-working L1 core engine or L2 adapters requires: (a) TDD — failing test written and confirmed RED before any production code change; (b) impact analysis in the commit message describing what changes and which callers or surfaces could be affected.

**MCP sole external entry point** — External AI agents access L1 operations exclusively through MCP tools (`hypercanvas.mcpServer`). Direct file modifications that bypass MCP and the L1→L2 chain violate this boundary.

**Bundler-scoped readonly at L1** — Projects with ProjectType `nextjs | cra | remix | unknown` enter readonly mode: AST writes are disabled by L1 capability check (`ProjectCapabilities.canWrite`), not by L3 UI logic. ProjectType `vite | webpack` are write-capable. CSS framework edit support (Tailwind, CSS Modules, styled-components, Emotion, Tamagui, shadcn/ui, DaisyUI — supported; MUI, Ant Design, Chakra UI, Mantine, Fluent UI, NextUI, Vanilla Extract, Panda CSS, UnoCSS, StyleX — not yet) is orthogonal to bundler type.

**Cross-surface L1 parity** — Both VS Code Extension and SaaS must use the identical L1 core (`lib/`). Neither surface may add a parallel write implementation. Divergence is a boundary violation.

**SCM boundary** — Extension reacts to git-discard via L4 file watcher (entry file watcher on `App.tsx` / `main.tsx`). Extension does not invoke git commands on the user's behalf.

## ES.APL.001 Agent policy — supported agents and autonomy bounds

```yaml spec-section
id: ES.APL.001
spec: enabling-system
kind: enabling.agent_policy
title: Supported host agents, autonomy bounds, and human-decision gates
statement_type: duty
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [ES.EFB.001]
supersedes: []
terms: [HyperCanvas]
target_refs: [TS.BOUNDARY.001, ES.ARCH.001, ES.WORK.001, ES.EFB.001]
evidence_required:
  - kind: manual
    description: human approval recorded in haft baseline for every spec section status flip
  - kind: manual
    description: no RemoteTrigger calls appear in session history or Bash commands
```

**Supported host agents:**

| Agent | Invocation | Scope | Haft tools |
|---|---|---|---|
| Claude Code | Interactive session (Sonnet 4.6 / Opus) | Planning, implementation, spec onboarding, review, monitoring | All haft tools; may draft and check but not self-approve sections |
| Codex | `codex exec review --uncommitted` or `codex exec "<prompt>"` | Peer code review at commit time; second opinion on architecture; coding agent when Claude Code limits are exhausted or when two independent implementations are needed for comparison | None — no haft MCP access |
| Ralphex | `ralphex docs/plans/<plan>.md` at local CLI | Autonomous plan execution in isolated worktree; commits, builds, E2E runs | None |
| External AI via MCP | `hypercanvas.mcpServer` (MCP protocol) | L1 operations only — read/write JSX, i18n, CSS via tool calls | None |

**Autonomy bounds — what agents may do without explicit human instruction:**

- Read and write project files within the declared WorkCommission scope
- Create git commits (not push); run builds, tests, E2E subset runs
- Send TG reports and heartbeats
- Dispatch subagents (Agent tool), CronCreate for monitoring loops
- Run `haft spec check` and draft new spec sections (status stays `draft`)
- Invoke `codex exec review --uncommitted` before any commit
- Reload VS Code extension after changes (`vscmd workbench.action.reloadWindow`)

**Human-decision gates — actions that require explicit human approval before proceeding:**

1. Spec section status flip to `active` — `haft spec onboard --approve <id> --approved-by human` records the human decision; agent may not self-approve
2. DecisionRecord creation and approval
3. WorkCommission creation (follows an approved Decision)
4. `git push` to remote
5. PR creation or merge
6. Edits to `AGENTS.md`, `CLAUDE.md`, or any `.haft/specs/` carrier
7. Destructive file operations outside declared WorkCommission scope

**Prohibited — regardless of context:**

- `RemoteTrigger` — forbidden in this project without exception; no Ralphex, no delegation, no scheduling via RemoteTrigger
- Nested `codex exec` calls from inside a Codex session
- Agent self-improvement: modifying the agent's own instruction files (AGENTS.md, CLAUDE.md) without a human-initiated edit
- Killing unrelated Ralphex processes

**Principal hierarchy:** CTO (human) is the sole principal. Claude Code, Codex, and Ralphex are delegates. Delegates act within scope declared by the principal; scope that was not declared is not implicitly authorized. A passing test or a clean build is not authorization to expand scope.

## ES.CMP.001 Commission policy — how work is authorized, scoped, and retired

```yaml spec-section
id: ES.CMP.001
spec: enabling-system
kind: enabling.commission_policy
title: WorkCommission authorization, scope rules, freshness gates, and retirement criteria
statement_type: duty
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [ES.APL.001]
supersedes: []
terms: [HyperCanvas]
target_refs: [TS.BOUNDARY.001, ES.APL.001, ES.EFB.001, ES.WORK.001]
evidence_required:
  - kind: manual
    description: every merged commit on main traces back to a plan file or an explicitly declared scope; no scope-expanding commits
```

**WorkCommission carrier:** In this project a Ralphex plan file (`docs/plans/YYYY-MM-DD-<slug>-ralphex-plan.md`) is the WorkCommission carrier. Its sections map to commission fields: Context → motivation, Scope → allowed/forbidden paths and what-not-to-do, Tasks → acceptance criteria.

**Who may create:**
- Claude Code — after the CTO approves the backing description; may draft the plan, must not self-execute without the plan being present in `docs/plans/`
- CTO (human) — directly, by authoring or approving a plan file
- Where: `hyper-canvas-draft` repo only
- Under what: `haft spec check` is clean; backing motivation is stated in the plan Context
- When: any time a non-trivial change is needed; trivial single-file fixes (< 5 lines, no shared code) may be committed without a plan

**Scope rules:**

*Allowed by default:* any path in the repo that the plan's Scope section explicitly names or describes.

*Forbidden without explicit Scope declaration (where + what):*
- `AGENTS.md`, `CLAUDE.md`, `.haft/specs/` — require the human-initiated gate from ES.APL.001
- L1 core engine (`lib/`, `server/`) and L2 adapters — allowed only when named in Scope AND TDD gate passes (failing test confirmed RED before any production change, per ES.EFB.001)
- Paths in other worktrees or repos — not in scope unless explicitly stated

*Forbidden regardless of Scope:* RemoteTrigger calls; killing unrelated Ralphex processes; expanding scope mid-execution without a plan amendment and human acknowledgement.

**Freshness gates before execution:**
1. Plan file exists in `docs/plans/` and Scope section is non-empty
2. `haft spec check` is clean — no `spec_section_drifted`, no `blocking_findings`
3. If Scope names L1/L2 shared code: at least one failing test exists for the targeted behavior (TDD gate)
4. If the plan amends a prior commission: prior plan's retirement criteria were met or explicitly superseded

**Retirement criteria (commission is closed when all hold):**
1. All task acceptance criteria in the plan are met and committed
2. E2E subset targeted by the commission (`HYPER_E2E_SHARDS=1 bun run test:docker` with `--grep` matching the commission area) exits 0 or failures are pre-existing and documented
3. TG handoff sent: what changed, test command + result, remaining risk or deferred items
4. Plan file moved to `docs/plans/completed/` (or noted as complete in git commit message)

## ES.RTP.001 Runtime policy — harness lifecycle, isolation, and observability

```yaml spec-section
id: ES.RTP.001
spec: enabling-system
kind: enabling.runtime_policy
title: E2E harness lifecycle ownership, shard isolation, and observability requirements
statement_type: duty
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [ES.CMP.001]
supersedes: []
terms: [HyperCanvas]
target_refs: [TS.BOUNDARY.001, ES.WORK.001, ES.APL.001, ES.EFB.001]
evidence_required:
  - kind: E2E
    description: all shards exit 0 and docker.log artifacts are present in docker-artifacts/run-<id>/shard-{1,2,3}/
  - kind: manual
    description: no cross-shard state sharing — each container has its own user-data-dir confirmed by artifact paths
```

**Lifecycle ownership:**

The harness runtime is owned and operated by the agent (Claude Code) or the human CTO. The MCP plugin (`hypercanvas.mcpServer`) does NOT own runtime lifecycle — it exposes tools but does not start, stop, or observe the test harness.

| Actor | Start | Stop | Observe |
|---|---|---|---|
| Claude Code / CTO | `cd ext-test-projects/e2e && HYPER_E2E_SHARDS=3 bash scripts/docker-parallel-run.sh` | Container exits on completion or `HYPER_E2E_SHARD_TIMEOUT_SECONDS` | `tail` on `docker.log`; TG summary after run |
| Docker shard | Starts VS Code (Electron) + Playwright worker on container boot | Exits after Playwright worker completes or timeout | Writes artifacts to `docker-artifacts/run-<id>/shard-N/` |
| VS Code Extension (L4) | Activated by `onStartupFinished` inside each container | Killed when VS Code process exits | `ast-debug.log`, Hyper Logs panel (CDP-visible) |

**Isolation rules per shard:**

- Each shard runs in a separate Docker container — no shared filesystem, no shared Electron process, no shared network state between shards
- Each container has its own VS Code user-data-dir — extension settings, cached state, and installed extension are isolated
- Within a shard, all tests share one VS Code worker instance (worker-scoped fixture); `git checkout -- .` restores test project source files before each test
- CDP mouse is used for all iframe interactions — frame locator clicks are blocked by the nested webview sandbox
- `HYPER_E2E_SHARD_START` env var enables starting from a specific shard index without re-running earlier shards

**Freshness rule:** A run is stale if any commit touching the spec area (L1 AST engine, L3 canvas UI, L4 extension) post-dates the first `sharedVSCode setup START` timestamp in `docker.log`. A stale run must be relaunched before evidence is accepted.

**Observability requirements:**

Each RuntimeRun MUST produce:
- `docker-artifacts/run-<id>/shard-N/docker.log` — full Playwright stdout including `[test-done]`, `[test-errors]`, and `[fixture-timing]` lines
- `docker-artifacts/run-<id>/shard-N/ast-debug.log` — extension AST operation trace
- `docker-artifacts/run-<id>/shard-N/screenshots/` — failure screenshots (captured via `screenshot: 'only-on-failure'`)

After the run: pass/fail/skip counts sent to Telegram. Failing tests re-run as a subset (`--grep` / `--project`) to validate fixes before a new full run is launched.

## ES.EVP.001 Evidence policy — admissible kinds, congruence floors, and refresh triggers

```yaml spec-section
id: ES.EVP.001
spec: enabling-system
kind: enabling.evidence_policy
title: Admissible evidence kinds, minimum congruence per claim class, and refresh triggers
statement_type: duty
claim_layer: description
owner: human
status: active
valid_until: "2027-05-12"
depends_on: [ES.RTP.001, ES.WORK.001]
supersedes: []
terms: [HyperCanvas, Evidence]
target_refs: [TS.BOUNDARY.001, ES.ARCH.001, ES.RTP.001]
evidence_required:
  - kind: E2E
    description: all shards exit 0 and docker.log shows named tests pass for each claim class
  - kind: L1
    description: bun test passes for L1 core engine (lib/, server/) for each structural claim
  - kind: manual
    description: human reviewer confirms evidence record is representative (screenshot read, not just present)
```

**Admissible evidence kinds:**

| Kind | Description | Produced by |
|---|---|---|
| `E2E` | Playwright+Electron test result against real VS Code Extension or SaaS browser. Artifacts: `docker.log` (named `[test-done]` lines), `ast-debug.log` (AST trace), `screenshots/` (failure captures). | Docker harness (`HYPER_E2E_SHARDS=3 bash scripts/docker-parallel-run.sh`) |
| `L1` | `bun test` unit test result on L1 core engine (`lib/`, `server/`). Covers AST read/write, StyleWritePlanner, i18n read/write in isolation. | Local or CI: `bun test` in `lib/` or `server/` |
| `typecheck` | `tsc --noEmit` passing on the affected layer. Evidence for structural type invariants only — not for runtime behavior. | `bun run typecheck` in `vscode-extension/hypercanvas-preview/` or root |
| `manual:agent` | Agent reads each screenshot with the Read tool, describes literally what is visible, and sends validated screenshots to Telegram. Agent also produces a test-suite summary: which tests ran, what each test checks, and what the CTO should look for visually. This step is mandatory for every behavioral fix — not optional when E2E passes. | Agent (Read tool + `send-tg-file.sh --photo`) |
| `manual:cto` | CTO acceptance: explicit sign-off after reviewing the agent's Telegram report and screenshots. A fix is not done until the CTO has seen and approved the visual evidence. | CTO via Telegram |

Both `manual` sub-kinds are unified under guard location `manual` in evidence_required.

**Minimum congruence floor per claim class:**

| Claim class | Minimum evidence | Guard location |
|---|---|---|
| L1 structural write (AstService, StyleWritePlanner, i18n) | L1 unit test (RED→GREEN) + E2E + manual:agent + manual:cto | `L1` + `E2E` + `manual` |
| L3 canvas UI behavior (selection, overlay, inspector) | E2E + manual:agent + manual:cto | `E2E` + `manual` |
| L4 extension command / lifecycle | E2E + manual:agent + manual:cto | `E2E` + `manual` |
| Agent policy / commission scope claims | manual:cto (human review of spec section) | `manual` |
| Type-level structural invariants | typecheck | `type` |

**Congruence floor rule:** the effective confidence of a multi-evidence claim equals the confidence of its weakest component — not the average. Passing E2E without CTO sign-off is not sufficient for any behavioral claim.

**Manual evidence protocol (mandatory for every behavioral fix):**

The agent duty is two-stage:

1. **Agent validation** — after E2E passes, for each relevant test:
   - Read the failure/pass screenshot with the Read tool
   - Describe literally what is visible (not what was expected)
   - Check representativeness: empty preview, "No element selected", raw `{t("...")}` literal, blank canvas, mismatched component — if any of these are present, the screenshot is **invalid**. Stop, identify which fix step produced the bad state, apply the fix, re-run the test, restart this protocol from the beginning. Loop until the screenshot shows the actual feature under test in a meaningful state.
   - Send the valid screenshot to Telegram via `send-tg-file.sh --photo`
   - Describe the test suite: what each test name covers, what the CTO should look for

2. **CTO acceptance** — CTO reviews the Telegram message and screenshots, gives explicit sign-off. The agent marks the commission retired only after this sign-off is received.

A screenshot is valid evidence when it is representative: it shows the actual feature under test in a meaningful state. A non-representative screenshot is not evidence and triggers a new fix cycle. A file path in a chat message is not evidence.

**Refresh triggers (VER-07):**

An evidence record becomes stale when any of the following hold:

1. **E2E staleness**: any commit to the spec area (L1 AST/i18n engine at `lib/` or `server/`, L3 `client/`, L4 `vscode-extension/`) that post-dates the first `sharedVSCode setup START` timestamp in `docker.log`. Run must be relaunched; the old result is not admissible.
2. **L1 unit test staleness**: any commit to `lib/` or `server/` that modifies the tested module's source, even if the test file itself is unchanged.
3. **Typecheck staleness**: any commit to the affected layer that modifies a public type declaration (`interface`, `type`, `class`, function signature) visible to its callers.
4. **Manual review staleness**: any commit that touches the visual behavior of the claimed UI component (L3 canvas, inspector, overlay). Manual evidence expires with the code it observed.
5. **Clock expiry**: `valid_until` reached — regardless of whether any commit has been made.
