---
id: dec-20260513-class-e-delete-element-regression
kind: DecisionRecord
version: 2
status: active
title: "Fix delete element regression — no-op on webpack+CSS Modules and tw3-kanban/styled-shopify"
mode: standard
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
links:
  - ref: prob-20260513-class-e-delete-element
    type: addresses
  - ref: TS.BOUNDARY.001
    type: governs
---

# Fix delete element regression — no-op on webpack+CSS Modules and tw3-kanban/styled-shopify

## 1. Problem Frame

`"delete element — removed from file, cascade to children"` fails across all shards (S1: 2, S2: 6, S3 original: 8, S3 re-run: 4+) on multiple projects. Cross-project, consistent, ~20s execution (actual run, not timeout victim). First appeared in the run-20260512 cycle; not present before v0.1.46.

**Root cause A — webpack+CSS Modules projects (382–472s hang):**
`openExplorerAndSelect` in `setup-preview.ts:909` calls `inspector.getComponentName()` which returns a Promise that never resolves on webpack+CSS Modules projects. The `.catch(() => '')` fallback does not fire because the promise is permanently pending (not rejecting). `expect.poll` waits for the full test timeout (400s+) before failing.

**Root cause B — vite projects (19–24s):**
File content is unchanged after the delete command executes. Zero delete entries in `ast-debug.log` for tw3-kanban and styled-shopify project types — AstService is never called. The delete command in extension.ts runs but the nodeRef is empty or invalid (selection state not populated), so the write layer is never reached.

## 2. Decision

**Selected:**
- **Root cause A fix:** Wrap `inspector.getComponentName()` in `Promise.race([getComponentName(), timeout(3000).then(() => '')])` in `setup-preview.ts`. The 3s timeout covers both the webpack compile gap and the legitimate slow-inspector case without hanging.
- **Root cause B fix:** Instrument the delete command handler in `extension.ts` with `ast-debug.log` entries to confirm where the call chain breaks; then fix the break point (likely empty nodeRef from selection state, or a project-type guard that incorrectly skips AstService).

**Why selected:** Root A is a test helper bug (wrong assumption that getComponentName always resolves). Root B requires investigation before prescribing a fix — ast-debug.log is the fastest path to the break point.

**Affected files:**
- `ext-test-projects/e2e/helpers/setup-preview.ts` (Root A)
- `vscode-extension/hypercanvas-preview/src/extension.ts` (Root B investigation)
- Possibly `lib/` (if AstService call site needs fixing)

**Evidence requirements:**
- `HYPER_E2E_SHARDS=1 bun run test:docker --grep "delete element"` — passes on all project types including tw3-kanban, styled-shopify, webpack-react-cssmodules-spotify
- `ast-debug.log` shows delete entries for previously-failing projects

## 3. Rationale

**Counterargument:** A 3s timeout in `Promise.race` for getComponentName adds latency to the happy path. Acceptable: the happy path completes in <100ms normally; 3s is a ceiling, not a floor.

**Rejected alternatives:**
| Variant | Verdict | Reason |
|---------|---------|--------|
| Increase test timeout to 600s | Rejected | Masks the hang; makes shard runs 10min per test on webpack projects. |
| Remove getComponentName call from setup | Rejected | It's a legitimate inspector gate; removing it weakens the E2E coverage. |
| Skip the test on webpack projects | Rejected | Delete element must work on all project types. |

**Weakest link:** Root B break point is unknown until ast-debug.log instrumentation reveals it. The DR covers both fix tracks; Task 2 is conditional on Task 1 findings.

## 4. Consequences

**Rollback plan:**
- If Promise.race(3s) causes flakiness on slow CI (getComponentName occasionally takes 2–3s legitimately): increase ceiling to 5s.
- If Root B investigation reveals a deeper architecture issue (e.g., selection FSM gap): file a separate Linear ticket; scope this commission to the instrumentation + minimal fix only.

**Refresh triggers:**
- Changes to `inspector.getComponentName()` implementation
- Changes to extension.ts delete command handler
- New project types added to the E2E matrix
