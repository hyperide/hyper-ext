# Hyper Canvas crash on Source Control discard

## Context

User-reported repro (2026-05-08): with Hyper Canvas open on `bulka-the-dog`, when the user
clicks "Discard All Changes" in VS Code Source Control (or discards individual files via the
SCM gutter), Hyper Canvas crashes. Console shows:

```
[Extension Host] [HyperIDE] Unhandled rejection in extension host:
  TypeError: Cannot convert undefined or null to object
    at push (<anonymous>)
```

(Two stacked rejections in the screenshot.)

Observed file states at crash time (Source Control panel):

- `project-structure.json` (untracked / `??`) — extension-managed cache file in `.hyperide/`
- `client/__canvas_preview__.tsx` (untracked) — extension-generated entry file
- `client/App.tsx` (modified `M`) — user changes being discarded
- `client/lib/translations.ts` (modified `M`) — user changes being discarded

Discarding `__canvas_preview__.tsx` itself produces a 404 in the iframe; closing and
reopening Hyper Canvas regenerates the file (via `_patchEntryFile`) and restores the preview.
That part is working as designed. The bug is the **uncaught rejection** when discarding
_other_ files while the extension's caches are still pointing at the old AST/structure.

### Suspect surface

- `vscode-extension/hypercanvas-preview/src/services/FileStructureStore.ts` — manages
  `.hyperide/project-structure.json`. If the discarded files (`App.tsx`, `translations.ts`)
  invalidate the structure but the store still holds a stale entry, a `.push` over a stale
  list whose item dictionary became `undefined` could throw.
- `extension.ts:89` — `if (!imports.includes(line)) imports.push(line);` (entry-file rebuild).
- `extension.ts:252` — `result.push({ relativePath, content });` (file scan).
- `PreviewPanel.ts:715` — `watcher.onDidDelete(...)`. Discard fires delete events for
  generated files.
- AST cache invalidation triggered by the file watcher could feed `null` into a downstream
  consumer (e.g. an `Object.entries(ast.symbols)` where `ast` is `null`).

`grep -rn "convert undefined or null"` over `vscode-extension/**/src` returns zero — the
throw originates in a JS runtime call (`Object.assign(target, null)` / `Object.keys(null)` /
spread of `null`). Find the exact site by running a real repro under the debugger or by
adding an `Error.captureStackTrace` wrapper around suspect call sites.

## Scope

Make Hyper Canvas survive a Source Control "Discard All Changes" without unhandled
rejections, on `bulka-the-dog`. Restore the canvas to a usable state automatically once the
discard settles (regenerated entry file, refreshed AST). Do **not** invent a brand-new
state machine — just identify the unguarded `Object` op and add the smallest correct guard,
or fix the upstream that produces the `null`/`undefined`.

Out of scope:

- Refactoring `FileStructureStore` or `PreviewPanel` lifecycle (deferred FSM ticket exists
  in MEMORY).
- Locale switcher / new-key visibility (separate plan).
- Webpack/Vite-only races (separate ticket).

### Task 1 — RED e2e: discard-while-canvas-open does not crash

Add `ext-test-projects/e2e/tests/project-dependent/bulka-canvas-discard-no-crash.spec.ts`:

1. Launch bulka via `launchVSCode` (see `ext-test-projects/CLAUDE.md`).
2. Open Hyper Canvas, wait for preview iframe to render (poll `previewLoaded`).
3. From the host (Node), `fs.appendFileSync` a no-op JSX comment to
   `<projectRoot>/client/pages/Index.tsx`. Reload the dev server's HMR if needed.
4. Confirm the file shows `M` in SCM (poll the extension's Source Control gutter, or
   simpler: use VS Code's `git.cleanFile` command on it and observe nothing else).
5. Trigger discard: drive `git.cleanAll` via `vscmd workbench.scm.cleanAll` (or per-file
   `git.cleanFile`). Wait 2s.
6. Read the extension host console via `app.evaluate(() => { … })` filtered for
   `Unhandled rejection`. **Assert zero matches.**
7. Assert the preview iframe is still alive (`previewLoaded` event), the canvas inspector
   responds to a click (selection rect appears), and `__canvas_preview__.tsx` exists on disk.
8. Screenshot AFTER the discard for proof. Visual check: canvas frame visible, an element
   selection rect present.

Test must be **RED** on current main (with the actual unhandled-rejection assertion failing
and/or the post-discard click failing to select). **GREEN** after Task 2/3.

### Task 2 — Locate the unguarded `Object` op

Three options, in order of cheapness:

1. Add an `unhandledRejection` listener at the very top of `vscode-extension/hypercanvas-preview/src/extension.ts`'s
   `activate()` that captures the full stack and logs it via `OutputChannel`. Reproduce the
   crash via the e2e from Task 1 (you can use a one-off `bun run e2e` for diagnosis only —
   normal e2e runs go through Docker per project rules). The stack will name the file/line.
2. If the listener is too noisy (already exists), grep for the suspects above and read each
   `.push` and `Object.{keys,entries,values,assign,fromEntries}` call. Add a debug guard
   (`if (!input) { console.error('null at <site>'); return; }`) at each suspect, run, narrow
   down by which guard fires first.
3. As a last resort, run the extension in attach-debug mode (VS Code "Run Extension" launch)
   and put a breakpoint on `TypeError`.

Do **not** wrap the whole extension in a giant try/catch — this masks bugs we'll see again
later. The fix lives at the site, not at the boundary.

### Task 3 — Apply the smallest correct fix

Once the call site is identified, the fix is one of:

- **Upstream**: ensure the producer never returns `null`/`undefined` for the field the
  consumer iterates. Default to an empty object/array.
- **Downstream**: `if (!x) return` at the call site, with a comment explaining when `x` can
  be missing (which file event made the cache stale, etc.).
- **Cache invalidation order**: if the AST/file-structure cache is reading a file that the
  discard just blanked, ensure invalidation happens BEFORE the consumer runs. Likely a
  watcher.onDidChange that synchronously triggers a rebuild before the new content has been
  read.

Add a unit test in the closest `__tests__/` directory covering the failure mode. Keep
`writable: …` plumbing untouched (recent c5a0c82a/5a0c82a touchups stay).

### Task 4 — Auto-recover from missing entry file

When `__canvas_preview__.tsx` is absent (user discarded it), the extension currently produces
404 until the panel is closed/reopened. Wire an explicit "regenerate entry file if missing"
guard in `PreviewPanel.ts` watcher.onDidDelete or in `_patchEntryFile`'s callers, so the
canvas self-heals without forcing the user to close the tab.

This Task is **lower priority than Task 3**. If it would balloon the scope, leave a TODO
and a deferred-Linear note in MEMORY.md instead.

### Task 5 — Telegram handoff

- Send a single TG report via `tg "..."`:
  - the call site that was throwing, the fix, files touched
  - both e2e + unit verdicts
  - commit hashes
- Send the e2e screenshot of canvas-after-discard via `tg --photo <path> "caption"`. Visually
  verify the canvas survived, an element is selectable, no error overlay.
- CLAUDE.md rule: no screenshot in TG = bug not fixed.

## Hard Rules

- Read `../ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD mandatory and **end-to-end first**: the e2e in Task 1 must fail RED on current main
  before any fix lands. Unit tests are companions, not substitutes.
- Use the local `ralphex` CLI only. Never use `RemoteTrigger` / claude.ai cloud API
  (CLAUDE.md top-of-file rule).
- This ralphex run is isolated in its own worktree; do not touch other worktrees, do not
  kill unrelated ralphex processes, do not delete unfamiliar files because grep finds no
  callers (CLAUDE.md "Dead code" — investigate first).
- Run e2e tests ONLY through `HYPER_E2E_SHARDS=1 bun run test:docker` from
  `ext-test-projects/e2e`. Local one-off runs allowed only as a diagnostic in Task 2;
  the final RED → GREEN verdict must come from Docker.
- Telegram heartbeat every 15 minutes (one human-written line, not raw logs).

## Progress tracking

Append incremental updates to `.ralphex/progress/2026-05-08-canvas-crash-on-discard.txt`
in the worktree.
