---
id: prob-20260513-class-f-et17-tree-scroll
kind: ProblemCard
version: 1
status: active
title: "E2E CLASS F — ET-17 leaf tree item click doesn't scroll canvas from bottom"
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
source: "run-20260512-084158-98150 S1"
---

# E2E CLASS F — ET-17 leaf tree item click doesn't scroll canvas from bottom

`"ET-17: clicking a small leaf tree item from scrolled-down viewport scrolls canvas to it"`
fails in S1 (2 failures, `[independent]` project). B8 fix from v0.1.45 covers ET-16 but
not ET-17. Scroll position doesn't change within 8s after tree item click.
