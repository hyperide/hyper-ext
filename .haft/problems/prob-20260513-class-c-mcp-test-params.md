---
id: prob-20260513-class-c-mcp-test-params
kind: ProblemCard
version: 1
status: active
title: "E2E CLASS C — 4 MCP tool tests fail: wrong param names + selection timeout"
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
source: "run-20260512-084158-98150 S1"
---

# E2E CLASS C — 4 MCP tool tests fail: wrong param names + selection timeout

4 MCP tool tests fail in `mcp-tools.spec.ts` (S1, run-20260512-084158-98150).

- `hyper_suggest_color_token` — 1242ms fast fail, wrong param `{hex}` vs `{color}`
- `hyper_get_element_styles` — ~25s, wrong param `{elementId}` vs `{className}`
- `hyper_duplicate_element` — 55–57s, `waitForAnySelection(25_000)` TimeoutError
- `hyper_get_selection` — 55–57s, same TimeoutError
