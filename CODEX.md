# CODEX Instructions

Read `AGENTS.md` — it has a dedicated "Codex-Specific Workflow" section with
command equivalents, commit discipline rules, and legacy fallback policy.

## Quick Reference

**Committing:** Read `.claude/commands/commit.md` and execute each step as shell
commands. Do not run nested `codex exec review` from inside Codex; if another
agent CLI is available (for example `claude`), use it for external review, then
always do self-review via `git diff --staged`. Commit every 15 minutes max, not
at session end.

**Building extension:** `./vscode-extension/hypercanvas-preview/build-and-install.sh`

**Telegram reports:** never pipe raw tool output, logs, diffs, transcripts, or
model context into Telegram (the `tg` CLI). Write a short human summary manually and
link the local log/workfile path for details. Pagination is for normal long
answers, not a license to send megabytes of uncurated text. For long-running
work, keep a periodic heartbeat active and send a concise status at least every
15 minutes plus on phase changes.

**Screenshot review:** inspect full-window screenshots, not just cropped
component snapshots. A subtree can look correct while the surrounding panel is
wrong. Explicitly check for empty space, clipped regions, width mismatches,
blocking dialogs, stale overlays, and wrong active tabs before calling a UI
change verified.

**Pre-commit checklist (minimum):**

```bash
biome check <changed-files>
npx tsc --noEmit
bun run test          # NOT bare `bun test`
```

**Style write routing:** `StyleWritePlanner.selectTarget()` is the only routing
mechanism. Default tab is Computed. Old Tailwind-only mutation code must be
deleted, not kept. See AGENTS.md "Style write routing" section.
