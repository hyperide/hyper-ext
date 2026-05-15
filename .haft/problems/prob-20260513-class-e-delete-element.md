---
id: prob-20260513-class-e-delete-element
kind: ProblemCard
version: 1
status: active
title: "E2E CLASS E — delete element is a no-op on multiple project types"
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
source: "run-20260512-084158-98150 S1/S2/S3"
---

# E2E CLASS E — delete element is a no-op on multiple project types

`"delete element — removed from file, cascade to children"` fails across all shards
(S1: 2, S2: 6, S3 original: 8, S3 re-run: 4+). Cross-project, consistent, ~20s runs.
Two root causes: (A) getComponentName() hangs on webpack+CSS Modules; (B) AstService
not called on tw3-kanban/styled-shopify.
