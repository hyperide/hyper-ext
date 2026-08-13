# Codex Review — PR #208 AGENTS.md Rules

**Date**: 2026-05-22 16:16 Europe/Belgrade  
**Branch**: hooks-canvas-fix-ralphex-plan → main  
**Files reviewed**: AGENTS.md, scripts/send-md-pdf-to-iphone.py, docs/reviews/.gitkeep  
**Verdict**: REQUEST_CHANGES

---

## Findings

### [P2] AGENTS.md ~line 958–970 — Hardcoded Tailscale IP / mandatory auto-transfer rule

AGENTS.md makes automatic PDF transfer to `iphone` mandatory for every spec/plan review and documents a fixed Tailscale node/IP. That is actionable, but it creates a standing exfiltration rule for potentially sensitive repo docs and bakes a personal device identifier into project policy. Should require explicit user approval or an env/configured destination. The Tailscale IP should not be committed to the repo.

### [P2] AGENTS.md ~lines 989–1009 — Advisor/Codex escalation matrix not agent-agnostic

The escalation rules are not fully actionable across agents. The section requires `advisor`, states only the main Claude agent can call it, requires a subagent to formulate the request, and also says questions are forbidden without "advisor and Codex" — even though Codex is explicitly forbidden from calling nested `codex` and must use Claude instead. Needs a clear per-agent matrix: Claude main, Claude subagent, Codex, other agents; what each may call; and what fallback is acceptable when `advisor` is unavailable.

### [P3] scripts/send-md-pdf-to-iphone.py — Missing required file header

Non-trivial new source file does not follow the repo's required file-header format with `@file`, `Accessed via`, assumptions, and tradeoffs. Current module docstring is useful but does not satisfy the stated rule.

### [P3] scripts/send-md-pdf-to-iphone.py ~line 172 — PDF artifacts left on disk

Writes rendered HTML/PDF to `/tmp/hyperide-pdfs` and only deletes the HTML by default. No credentials present, subprocess calls are not shell-injected, but review PDFs may contain sensitive plan/spec content and remain on disk. Prefer `tempfile.TemporaryDirectory()` by default, or add an explicit `--keep-pdf` flag.

---

## Other Notes

- `docs/reviews/.gitkeep` — correct pattern: empty tracked placeholder for a directory that will later contain committed Markdown review records.
- The script has no hardcoded credentials or secrets. The hardcoded `iphone` default is operational config, not a credential.

---

## Summary

| Item                                              | Status                                     |
| ------------------------------------------------- | ------------------------------------------ |
| AGENTS.md — clarity & actionability               | P2 issues found                            |
| scripts/send-md-pdf-to-iphone.py — safety/secrets | No secrets; P3 header + P3 tempfile issues |
| docs/reviews/.gitkeep                             | Correct pattern                            |
| **Overall verdict**                               | **REQUEST_CHANGES**                        |
