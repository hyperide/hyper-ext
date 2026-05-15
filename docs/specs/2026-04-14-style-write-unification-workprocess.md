# Style Write Unification Workprocess

## Purpose

Short workfile for the current execution state.
The previous verbose log was archived outside the repo to keep this file
operational instead of historical.

Archived copy:

- `/Users/ultra/work/workfile-archive/2026-04-14-style-write-unification-workprocess.2026-04-24-0845.md`

## Brief History

1. Spec phase:
   - style-write unification architecture, source ownership, source confidence,
     theme routing, and workprocess rules were developed and iterated.
2. Shared implementation phase:
   - shared style read/write managers, planners, executors, theme context, and
     source-tab plumbing were implemented and validated with focused tests.
3. VS Code extension parity phase:
   - source tabs, CSS Modules routing, panel readiness, selection disposal,
     MCP operations, and related extension regressions were fixed.
4. E2E hardening phase:
   - repeated failures exposed harness defects: stale dialogs, stale
     diagnostics, command-palette targeting, dirty-editor teardown, worker
     collisions, expected-runtime-error annotation gaps, preview shell sizing,
     and shutdown hangs after VS Code reload.
   - many harness issues were fixed incrementally in the extension repo and
     ext-test repo, while HYP-363 remained the active branch for preview-shell
     offscreen/blank-surface fallout.
5. Current phase:
   - stop treating partial reruns as the main progress metric.
   - use the full `2211`-test Playwright matrix as the verification source of
     truth, and only restart it for a blocker that invalidates a large part of
     the queue.

## Consolidated User Requirements

This section consolidates the still-active user requirements extracted from the
archived workfile and the current chat. Treat it as the live operating
instruction set for this workstream.

### Execution mode

1. Main goal: get the VS Code extension E2E matrix green, not only isolated
   shards.
1. Default verification mode: run the full Playwright matrix (`2211` tests),
   not only `independent`.
1. Do not kill or restart a full run on the first ordinary failure.
1. Let the full run continue, collect failures, analyze them while the queue is
   still running, and restart only if a blocker clearly poisons a large part of
   the suite.
1. Focused reruns are for root-cause confirmation and proof of a fix, not as
   the main progress metric.
1. Retries are disabled for debugging evidence (`--retries=0`) unless the user
   explicitly asks otherwise.
1. Do not use Restore/retry as a workaround for E2E flakiness. Analyze the
   failure mode instead.

### Watchdog and system monitoring

1. Keep long runs under explicit watchdog polling with regular sleep cycles
   (`30-60s`).
1. Do not go silent while a long run is active.
1. Monitor:

    - VS Code windows and modal dialogs,
    - Hyper Logs / diagnostics noise,
    - active `hvsc-*` / Playwright / dev-server processes,
    - CPU/load, memory pressure, and swap activity.
1. If the machine becomes unsafe or a run starts contaminating later tests,
    stop and analyze before opening more windows or starting more runs.

### Failure classification

1. Distinguish explicitly between:

    - test-body assertion failures,
    - test-scoped teardown failures,
    - worker-scoped shutdown failures,
    - harness/environment contamination.
1. Expected runtime-error tests must be annotated and their diagnostics must be
    cleared after assertion.
1. Unexpected log/diagnostic output is a real failure signal, not harmless
    noise.
1. Save dialogs must be prevented, not merely dismissed after they appear.

### Visual verification

1. Treat screenshots as ground truth.
1. Review full-window screenshots, not only cropped components.
1. Explicitly check for:

    - empty panes,
    - wrong active tab/frame,
    - offscreen webviews,
    - stale dialogs/overlays,
    - clipped content or large empty areas,
    - Hyper Logs errors that may not show up as a failing assertion yet.

### Work discipline

1. Keep commits atomic.
1. After every meaningful change and after every commit, update the workfile
    with what changed, why, validation, remaining risk, and next step.
1. Do not claim a review/test/run happened unless it actually happened.
1. Do not self-invoke nested `codex` from inside Codex (`codex exec`,
   similar same-agent self-nesting).
1. Running a different agent CLI from this session is allowed and preferred for
   external review when the workflow calls for it (for example `claude` from
   Codex).
1. Do not delete `.serena/` tracked memory/settings.
1. Keep bridge-bot/dev-tooling work separate from the main product/E2E
    critical path unless the user explicitly prioritizes it.

### Telegram/reporting

1. Telegram updates must be short, manual summaries.
1. Do not dump raw logs, giant transcripts, diffs, or model context into
    Telegram.
1. Prefer Russian for user-facing Telegram status answers.
1. If there is a real blocker or question, raise it in Telegram instead of
    silently stalling.

### Current hard rule for the present cycle

1. Full `2211`-test run stays alive and is observed to the end unless a
   mass-breaker invalidates downstream results.

## Current Objective

- Get the full VS Code extension Playwright E2E matrix green.
- Use the full matrix, not only a local slice.
- Keep the run alive long enough to observe the real failure set.

## Current Branch

- Repo: `hyperide/hyper-saas`
- Branch: `ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e`
- Main-repo summary base when this file was condensed: `9fbab5bb`
- ext-test-projects head when the external repo status was last checked: `df5e060`
- PR URL is not recorded in this summary; verify it before PR/merge workflow.

## Confirmed Scope

- Full Playwright matrix at the last explicit enumeration on `2026-04-24`
  against main-repo base `9fbab5bb`: `2211 tests in 41 files`
- `independent` slice only: `769 tests`
- This count is operational guidance, not a permanent constant; refresh it after
  adding or deleting specs.

## Green Definition

- "Green" means the full Playwright matrix completes with `0` failed tests.
- Unexpected teardown failures, worker-shutdown failures, save dialogs,
  persistent Hyper Logs noise, or harness contamination mean the matrix is not
  green even if the failing assertion count is zero.
- Intentionally skipped tests remain allowed only when they are already marked
  and understood; new flakes do not count as green.

## Current Rules

This section is the operational summary of the consolidated user requirements
above. Keep it in sync with that section; if they diverge, update both.

1. Run the full `2211`-test Playwright matrix as the default source of truth.
2. Do not restart the full run on the first red test.
3. Let the run continue and collect failures unless a blocker is clearly
   invalidating a large part of the matrix.
4. Restart only for a mass-breaker, for example:
   - worker/fixture corruption that poisons many later tests,
   - broken harness startup,
   - shutdown bug that aborts the whole queue,
   - environment failure that makes later results meaningless.
5. Treat teardown and worker shutdown as product-grade code paths:
   distinguish between:
   - test body assertion failure,
   - test-scoped teardown failure,
   - worker-scoped shutdown failure.
6. Keep Telegram updates short and factual.
7. During long-running work, send a short Telegram heartbeat at least every 15
   minutes and on phase changes.
8. While a long-running run is active, keep watchdog polling and avoid `final`
   completion messaging.
9. Use regular sleep-based watchdog cycles (`30-60s`) while a long run is
   active, so the run is never left without active monitoring.
10. Keep `--retries=0` as the default for debugging evidence unless the user
   explicitly asks for retries.
11. "Sleep-based watchdog" here means periodic polling around background
    sessions, not blocking the actual long-running process in the foreground.

## Latest Confirmed Fixes

### 2026-04-24: worker shutdown after VS Code window reload

Problem:

- `renderer process crash does not lose workspace state` no longer failed on
  `Execution context was destroyed`.
- The real remaining blocker was worker teardown after `Developer: Reload Window`.
- `closeVSCode()` could hang indefinitely and consume the fixture timeout.

Fix:

- `ext-test-projects/e2e/setup/electron-app.ts`
  - added internal timeout around `instance.app.evaluate()`
  - added internal timeout around `instance.app.close()`
  - fallback to `forceCloseVSCode()` when graceful close does not finish

Regression proof:

- unit regression added in `ext-test-projects/e2e/setup/electron-app.test.ts`
- targeted E2E for the crash/reload case passed after the fix

Status:

- locally validated in `ext-test-projects`
- as verified on `2026-04-24` via `git status`, the related ext-test-projects
  changes were still not separately committed there
- re-verify that status before any new ext-test commit or PR step

## Current Working Tree (Not Yet Committed)

### HYP-363 preview-shell/offscreen follow-up

Purpose:

- keep the preview panel on a stable shell surface instead of blending
  disconnected/start states with stale iframe content.

Current edits:

- `vscode-extension/hypercanvas-preview/src/webview-preview-panel/PreviewPanelApp.tsx`
  - adds `getPreviewShellScreen()`
  - introduces `DisconnectedPreviewScreen`
  - wraps the live preview in a dedicated surface container
- `shared/data-testid-map.ts`
  - adds `TID.preview.surface`
- `vscode-extension/hypercanvas-preview/src/__tests__/PreviewPanelApp.test.ts`
  - new coverage for preview-shell state selection

Status:

- implemented in the working tree
- not yet committed
- still needs proof from the live full-matrix run and focused follow-up checks
- focused validation completed: `bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewPanelApp.test.ts`
  passed (`3 pass / 0 fail`)
- the live full E2E matrix has already progressed well past the earlier
  HYP-363 checkpoints without exposing a new preview-shell red cluster
- external `claude` review was attempted for this subset, but the CLI produced
  no findings before timing out

### Inspector width normalization follow-up

Purpose:

- remove the blank right gutter seen in screenshots where inspector sections
  were constrained to `max-w-sidebar-section` inside a wider panel.

Current edits:

- `client/components/RightSidebar/RightSidebar.tsx`
- `client/components/RightSidebar/sections/{Appearance,Effects,Fill,Layout,Margin,Position,StateSelector,Stroke,StyleSourceTabs}Section.tsx`
- section wrappers now use `w-full` instead of `max-w-sidebar-section`

Status:

- implemented in the working tree
- not yet committed
- still needs full-window visual verification against the extension screenshot
- touches files also changed by merged HYP-357 work; verify no overlap/regression
  around `StateSelectorSection` before committing
- the live full E2E matrix continued through inspector-focused interaction tests
  after this change without surfacing a sidebar regression at those checkpoints
- a dedicated isolated full-window screenshot attempt was started on a separate
  worker, but launching a second VS Code instance timed out under concurrent
  heavy E2E load
- external `claude` review was attempted for this subset, but the CLI produced
  no findings before timing out

### Repo guidance updates

Purpose:

- record the workflow guardrails added after repeated screenshot-review and
  Telegram-reporting mistakes.

Current edits:

- `AGENTS.md`
  - requires full-window screenshot review
  - requires a cyclic Telegram heartbeat during long-running work
  - clarifies that only self-nested `codex` CLI is forbidden; other agent CLIs
    are allowed for external review
- `CODEX.md`
  - mirrors the same screenshot-review and Telegram-reporting discipline
  - explicitly prefers another agent CLI such as `claude` for external review

Status:

- implemented in the working tree
- not yet committed
- documentation-only guardrails, no product behavior change

## Latest Verified Progress

From the last completed targeted validations before switching to full-matrix mode:

- `setup/electron-app.test.ts`: green
- targeted `renderer process crash does not lose workspace state`: green

From the most recent full-matrix observation in this cycle:

- the queue reached at least `141/2211`
- no red test had been observed at that checkpoint
- the run also emitted repeated `iframe-mouse` / `test-preview` visibility
  warnings that triggered refresh-and-continue behavior
- treat this as a historical progress marker, not as proof that a run is still
  active right now

More recent live checkpoints observed after that summary baseline:

- the queue advanced through at least `363/2211` and later `Vite` / `Next.js`
  overlay detection cases without introducing a red test at those checkpoints
- `renderer process crash does not lose workspace state` passed in the live full
  run, which is the relevant regression path for the preview shutdown/recovery
  area

## Known Open Work

- Keep the active full Playwright matrix running to completion unless a
  mass-breaker appears.
- As failures appear, classify each one:
  - product bug,
  - harness bug,
  - environment issue,
  - stale baseline / expectation issue
- Validate the current HYP-363 preview-shell changes against the live failure
  set and against focused proof tests after the first full-run signal arrives.
- Validate the inspector width normalization with full-window screenshots, not
  only subtree captures.
- Fix only the confirmed blocker, then decide whether the full run must be
  restarted or may continue.
- Once the full matrix is green, split the remaining main-repo and ext-test
  changes into atomic commits, then verify PR state and merge/cleanup steps.

## Working Notes

- The old process overused slice reruns and delayed the full failure picture.
- The new mode is:
  - full run first,
  - classify live failures while the queue continues,
  - restart only when later results would be invalid.

## Immediate Next Step

- Start or continue a full Playwright matrix run under watchdog polling; do not
  replace it with another slice rerun.
- Use the first confirmed red cluster, if any, to decide whether the current
  preview-shell/inspector/ext-test worktree fixes are sufficient or need
  another focused patch.

## 2026-04-24 Domain Mirror Pass

Purpose:

- switch the public primary mirror from `hyperi.de` to `hyperide.ai`
- keep `hyperi.de` reachable as the alternate public mirror
- add canonical/public metadata so search and shared links point at
  `hyperide.ai`

Scope:

- `index.html`
  - add canonical, alternate, Open Graph, Twitter, and description metadata
    with `https://hyperide.ai/` as the primary URL
- `docs/app/layout.tsx`
  - set docs metadata base and canonical/public URLs to `docs.hyperide.ai`
- `k8s/overlays/production/kustomization.yaml`
  - move `APP_URL` and `HYPERCANVAS_ORIGIN` to `https://hyperide.ai`
  - keep both `hyperide.ai` and `hyperi.de` in ingress rules so the alternate
    host can be canonicalized to the primary mirror
  - move docs ingress to the canonical public host `docs.hyperide.ai`
  - remove the production `COOKIE_DOMAIN` override so auth cookies stay
    host-only on the canonical app host
- `server/index.ts` + `server/lib/public-url.ts`
  - redirect app traffic from `hyperi.de` to `hyperide.ai` before auth/cookie
    handling so OAuth, code-server preview, and invite flows stay on one origin
- public outbound links/default identities
  - welcome email docs link -> `https://docs.hyperide.ai`
  - default sender -> `noreply@hyperide.ai`
  - default git identity -> `user@hyperide.ai`
  - fetch user-agent URL -> `https://hyperide.ai`
- operator-facing docs/comments
  - update production health/bootstrap references to `hyperide.ai`
  - update domain comments in server/docs config

Validation:

- `bun test server/lib/public-url.test.ts server/services/__tests__/public-domain-config.test.ts`
  - green
- `bunx biome check index.html docs/app/layout.tsx server/index.ts server/modules/auth/tokens.ts server/modules/email/templates/welcome.ts server/modules/email/client.ts server/services/url-fetch.ts server/services/k8s-manager.ts server/services/__tests__/public-domain-config.test.ts`
  - green
- `git diff --check`
  - green
- `kustomize build --enable-alpha-plugins --enable-exec k8s/overlays/production`
  - blocked by unavailable SOPS age key in this environment
- temporary no-secret validation build
  - removed the base secrets generator in a temp copy and confirmed the rendered
    manifest contains:
    - `hyperide.ai` + `hyperi.de` app hosts
    - `docs.hyperide.ai` docs host
    - multi-host Traefik route matches for the rate-limited endpoints
- external `claude` review
  - initially found a real asymmetry: alternate-host requests could still fall
    back into primary-origin auth/code-server flows
  - follow-up fix: add canonical redirect middleware for `hyperi.de` app
    traffic before auth/cookie handling

Open note:

- `README.md` and `k8s/RUNBOOK.md` still have pre-existing markdownlint debt
  unrelated to this domain pass; targeted health URL edits were kept minimal.
