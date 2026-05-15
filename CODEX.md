# CODEX Instructions

Read `AGENTS.md` — it has a dedicated "Codex-Specific Workflow" section with
command equivalents, commit discipline rules, and legacy fallback policy.

## Quick Reference

**Committing:** Read `.claude/commands/commit.md` and execute each step as shell
commands. Skip `codex exec review` (can't self-invoke) — do self-review via
`git diff --staged` instead. Commit every 15 minutes max, not at session end.

**Building extension:** `./vscode-extension/hypercanvas-preview/build-and-install.sh`

**Telegram reports:** never pipe raw tool output, logs, diffs, transcripts, or
model context into `send-tg-report.sh`. Write a short human summary manually and
link the local log/workfile path for details. Pagination is for normal long
answers, not a license to send megabytes of uncurated text.

**Pre-commit checklist (minimum):**

```bash
biome check <changed-files>
npx tsc --noEmit
bun run test          # NOT bare `bun test`
```

**Style write routing:** `StyleWritePlanner.selectTarget()` is the only routing
mechanism. Default tab is Computed. Old Tailwind-only mutation code must be
deleted, not kept. See AGENTS.md "Style write routing" section.
