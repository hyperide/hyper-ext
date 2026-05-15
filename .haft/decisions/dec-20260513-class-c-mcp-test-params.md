---
id: dec-20260513-class-c-mcp-test-params
kind: DecisionRecord
version: 2
status: active
title: "Fix MCP tool tests — wrong param names + waitForAnySelection timeout"
mode: standard
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
links:
  - ref: prob-20260513-class-c-mcp-test-params
    type: addresses
  - ref: ES.ARCH.001
    type: governs
---

# Fix MCP tool tests — wrong param names + waitForAnySelection timeout

## 1. Problem Frame

4 tests in `ext-test-projects/e2e/tests/project-independent/mcp-tools.spec.ts` fail (S1, run-20260512-084158-98150):

**Root cause A — stale param names:**
- `hyper_suggest_color_token` (1242ms fast fail): test sends `{ hex: '#3b82f6' }`, tool schema requires `{ color: string }` → MCP error -32602 "expected string, received undefined" for path ["color"]
- `hyper_get_element_styles` (~25s): test sends `{ elementId: selectedIds[0] }`, tool expects `{ className: string }` or `{ styleProps: Record }` → "Unrecognized key: elementId"

**Root cause B — selection timeout:**
- `hyper_duplicate_element` (55–57s): `canvas.clickElement` + `waitForAnySelection(25_000)` times out — click doesn't propagate to selection signal within 25s under Docker 3-shard CPU pressure
- `hyper_get_selection` (55–57s): same cause

The tool implementations are correct; the tests were written against stale param names.

## 2. Decision

**Selected:** Fix param names in the test file; replace `clickElement + waitForAnySelection` with `openExplorerAndSelect` (gates on inspector showing componentName — more reliable than raw canvas click timing).

**Why selected:** Minimal-scope test-side fix. Tool implementations are correct and must not change.

**Affected files:**
- `ext-test-projects/e2e/tests/project-independent/mcp-tools.spec.ts` — param names + selection method

**Forbidden:**
- MCP tool implementations
- `ext-test-projects/e2e/helpers/setup-preview.ts`

**Evidence requirements:**
- `HYPER_E2E_SHARDS=1 bun run test:docker --grep "hyper_suggest_color_token|hyper_get_element_styles|hyper_get_selection|hyper_duplicate_element"` — all 4 pass, each in <30s

## 3. Rationale

**Counterargument:** Increasing `waitForAnySelection` to 60s would also fix B without touching the selection method. Rejected: masks the root cause (unreliable canvas click timing under CPU load) instead of using the reliable inspector-gate path.

**Rejected alternatives:**
| Variant | Verdict | Reason |
|---------|---------|--------|
| Fix tool schema to accept `hex`/`elementId` | Rejected | Tools are correct; tests were stale. Changing tools would break other callers. |
| Increase waitForAnySelection to 60s | Rejected | Masks flakiness. openExplorerAndSelect gates on real state, not time. |

**Weakest link:** `openExplorerAndSelect` availability in mcp-tools.spec.ts imports — must verify before switching.

## 4. Consequences

**Rollback plan:**
- If `openExplorerAndSelect` is not importable in mcp-tools.spec.ts: fall back to increasing timeout to 60s as interim fix, file Linear ticket to import the helper.

**Refresh triggers:**
- MCP tool schema changes (param names, types)
- `openExplorerAndSelect` API changes
