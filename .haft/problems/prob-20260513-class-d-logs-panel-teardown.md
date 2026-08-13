---
id: prob-20260513-class-d-logs-panel-teardown
kind: ProblemCard
version: 1
status: active
title: "E2E CLASS D — logs panel test runs 600s, corrupts shared VS Code worker"
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
source: "run-20260512-084158-98150 S3"
---

# E2E CLASS D — logs panel test runs 600s, corrupts shared VS Code worker

`"logs panel opens after dev server stop"` in `dev-server.spec.ts:80` ran 600,953ms.
After the test, 5 subsequent tests cascade-fail with 83s timeouts (D2 victims).
Root cause: fixture teardown hangs on `closePreview` — webview frozen after dead dev server.
