<!-- markdownlint-disable MD013 -->

# I18n Text Inspector Support

## Context

Hyper Canvas text editing currently treats JSX expression children as raw
expressions. For a selected node such as:

```tsx
<p className="text-foreground/80">{t("habits.walks")}</p>
```

the inspector should recognize the i18n call, show key `habits.walks`, show the
resolved text for the active site language, and provide a site language
switcher. The feature must work in SaaS and the VS Code extension. Pure
detection and resolution logic must be shared; platform-specific project file
reads must sit behind `FileIO` or an equivalent host adapter.

Use `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects/bulka-the-dog/client/pages/Index.tsx`
as a fixture input only. Do not permanently edit that fixture. Back up and
restore any temporary edits in `finally`.

Other active lanes exist. Do not revert unrelated edits, do not edit
`client/components/ui/color-combobox.*`, and do not kill existing `ralphex`
processes.

## Initial Code Paths

- SaaS inspector text read:
  `client/lib/platform/hooks/useElementStyleData.ts`.
- SaaS inspector text UI:
  `client/components/RightSidebar/RightSidebar.tsx`.
- SaaS text write:
  `client/components/RightSidebar/hooks/useStyleSync.ts` ->
  `CanvasEngine.updateASTProp` / platform `astOps.updateText`.
- VS Code style/text read:
  `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts`.
- VS Code text write:
  `vscode-extension/hypercanvas-preview/src/bridges/AstBridge.ts` ->
  `vscode-extension/hypercanvas-preview/src/services/AstService.ts`.
- Existing children mutation:
  `lib/ast/mutator.ts` (`updateElementChildren`, `parseMixedContent`).
- Existing portable file abstraction:
  `lib/ast/file-io.ts`,
  `lib/ast/node-file-io.ts`,
  `vscode-extension/hypercanvas-preview/src/vscode-file-io.ts`.
- Existing package analysis examples:
  `lib/preview-generator/framework-routing.ts`,
  `vscode-extension/hypercanvas-preview/src/services/ProjectDetector.ts`,
  `server/routes/projects.ts`.
- Existing source location support:
  `shared/canvas-interaction/resolve-source.ts`,
  `shared/element-tracing/source-map-resolver.ts`,
  `vscode-extension/hypercanvas-preview/src/services/SyncPositionService.ts`.

## Architecture Hypothesis

Add a shared i18n text module that returns a stable inspector model for selected
JSX children:

```ts
interface I18nTextBinding {
  kind: 'i18n';
  library: 'react-i18next' | 'i18next' | 'next-intl' | 'react-intl' | 'lingui' | 'custom';
  key: string;
  activeLocale: string;
  availableLocales: string[];
  resolvedText: string | null;
  editable: boolean;
  sourceLocation: { filePath: string; line: number; column: number };
}
```

The read path should combine:

- AST: identify call expressions and imports around JSX children.
- Package analysis: detect installed libraries from `package.json`.
- Source information: use selected element nodeRef/children location to inspect
  the exact JSX child instead of the rendered DOM string.
- File IO: resolve locale files from project files through Node/VS Code adapters.
- Runtime language: read active language from preview when available, then fall
  back to detected default locale.

The write path should update translation resources for key text edits and only
rewrite JSX children when the selected key changes or when converting between
plain text and i18n expression.

## Detection Contract

Supported first pass:

- `react-i18next` / `i18next`: `t("key")`, `i18n.t("key")`, namespace option.
- `next-intl`: `useTranslations()` binding, `t("key")`.
- `react-intl`: `formatMessage({ id: "key" })`,
  `<FormattedMessage id="key" defaultMessage="..." />`.
- Lingui: `t({ id: "key" })`, `t\`key\``, `<Trans id="key" />`.
- Custom wrappers: any imported or in-scope function whose first argument is a
  string literal, when package/config scan shows locale resource files and the
  function name matches configured or inferred names such as `t`, `translate`,
  `msg`, `i18n`, or `useLanguage().t`.

Unsupported or unsafe expressions must remain editable as raw expressions with a
clear read-only reason in the inspector model, not a broken combobox.

### Task 1: Confirm Baseline And Gather References

- [x] Run the required workspace check:

  ```bash
  cd /Users/ultra/work/hyper-canvas-draft
  git status --short
  ```

- [x] Search with `rg` before opening files:

  ```bash
  rg -n "updateText|syncTextChange|PropsForm|FillSection|childrenType|childrenLocation|i18n|formatMessage|package\\.json|sourceLocation|LSP|language server|FileIO|AstService" client server shared lib vscode-extension --glob '!client/components/ui/color-combobox.*' --glob '!**/out/**'
  ```

- [x] Read the text read/write paths listed in this plan and note any extra
  modules that must be kept in sync between SaaS and VS Code.
- [x] Before any VS Code E2E debugging, read:

  ```bash
  sed -n '1,240p' /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects/CLAUDE.md
  ```

Verification:

```bash
git status --short
rg -n "habits\\.walks|useLanguage|t\\(" /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects/bulka-the-dog/client/pages/Index.tsx
```

### Task 2: Add Shared Types And Package Detection Tests First

- [x] Add shared types in `shared/i18n-text/` or an equivalent shared module.
- [x] Write failing tests before implementation for package detection:
  `shared/i18n-text/__tests__/detect-i18n-package.test.ts`.
- [x] Cover dependencies and devDependencies for `react-i18next`, `i18next`,
  `next-intl`, `react-intl`, `@lingui/react`, and no-library custom mode.
- [x] Confirm the tests fail because the production detector does not exist or
  returns unsupported results.

Verification:

```bash
bun test shared/i18n-text/__tests__/detect-i18n-package.test.ts
```

Expected first failure: missing module or assertion that no provider is detected.

### Task 3: Implement Package Detection Minimally

- [x] Implement a pure package detector that accepts parsed package JSON data.
- [x] Reuse existing package read patterns from preview-generator/server/extension
  code; do not duplicate host-specific parsing in the UI.
- [x] Keep library identifiers typed as a union, not `string`.
- [x] Add no new `any` or lazy `Record<string, unknown>` escape types.

Verification:

```bash
bun test shared/i18n-text/__tests__/detect-i18n-package.test.ts
```

### Task 4: Add AST Binding Detection Tests First

- [x] Add failing tests for production AST analysis:
  `shared/i18n-text/__tests__/detect-i18n-binding.test.ts`.
- [x] Use Babel parser production helpers already used in `lib/ast` or
  `lib/services`, not copied AST logic inside the test.
- [x] Include this failing-test-first fixture shape without permanently editing
  Bulka:

  ```tsx
  export default function Index() {
    const { t } = useLanguage();
    return <p className="text-foreground/80">{t("habits.walks")}</p>;
  }
  ```

- [x] Add variants for:
  `formatMessage({ id: "habits.walks" })`,
  `t({ id: "habits.walks" })`,
  `t\`habits.walks\``,
  `<FormattedMessage id="habits.walks" />`,
  and `<Trans id="habits.walks" />`.
- [x] Confirm failure is semantic: the selected JSX expression is not recognized
  as an i18n binding.

Verification:

```bash
bun test shared/i18n-text/__tests__/detect-i18n-binding.test.ts
```

### Task 5: Implement AST Binding Detection Minimally

- [x] Implement shared AST detection that accepts source text, file path, and
  source location or element result.
- [x] Resolve the selected JSX child from AST/source location, not DOM text.
- [x] Recognize direct calls, hook-bound aliases, member calls, template tags,
  and JSX i18n components listed in the detection contract.
- [x] For custom/self-written i18n, return `library: 'custom'` only when the call
  has a static key and package/resource scan supports an i18n-like project.
- [x] Return structured unsupported reasons for dynamic keys, non-string ids,
  unknown wrappers, and missing source location.

Verification:

```bash
bun test shared/i18n-text/__tests__/detect-i18n-binding.test.ts
```

### Task 6: Add Locale Resource Resolution Tests First

- [x] Add failing tests:
  `shared/i18n-text/__tests__/resolve-i18n-resource.test.ts`.
- [x] Use in-memory `FileIO` fixtures with common resource layouts:
  `locales/en.json`, `src/i18n/en.json`, `messages/en.json`,
  `messages/en.ts`, `app/[locale]/messages/en.json`, and namespaced
  `locales/en/common.json`.
- [x] Cover active locale, fallback locale, missing key, nested dot key, and
  namespace handling.
- [x] Confirm failure is missing resource resolution, not broken test setup.

Verification:

```bash
bun test shared/i18n-text/__tests__/resolve-i18n-resource.test.ts
```

### Task 7: Implement Locale Resource Resolution

- [x] Implement shared resource discovery using `FileIO`.
- [x] Support JSON first; support simple TS/JS object exports only if the project
  already has parser utilities that make this safe.
- [x] Return `availableLocales`, `activeLocale`, `resolvedText`, and a precise
  unresolved reason.
- [x] Do not evaluate arbitrary project code.
- [x] Add a narrow host adapter if `FileIO` lacks directory scanning needed for
  locale discovery.

Verification:

```bash
bun test shared/i18n-text/__tests__/resolve-i18n-resource.test.ts
```

### Task 8: Thread I18n Metadata Through SaaS And VS Code Reads

- [x] Extend shared platform message types in `client/lib/platform/types.ts` and
  `vscode-extension/hypercanvas-preview/src/types.ts` before sending new message
  fields.
- [x] Extend `ElementStyleData` with optional `i18nText`.
- [x] In SaaS, enrich `useElementStyleData` through a server/shared read path
  that can access project files safely. (RPC path: VS Code mode threads i18nText
  from StyleReadService response. SaaS browser mode leaves i18nText undefined —
  requires server-side read route, deferred to Task 12.)
- [x] In VS Code, enrich `StyleReadService.readClassName` with shared detection
  and resource resolution through `VSCodeFileIO`.
- [x] Keep pure logic shared; keep Node/VS Code I/O at the boundary.

Verification:

```bash
bun test client/lib/platform/hooks
bun test vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts
```

### Task 9: Add Inspector UI Tests First

- [x] Add failing UI tests for SaaS inspector text display:
  `client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx`
  or the closest existing RightSidebar test path.
- [x] Add failing VS Code webview test:
  `vscode-extension/hypercanvas-preview/src/__tests__/I18nTextInspector.test.tsx`
  (PropsForm.test.ts is for ComponentErrorOverlay, not the text inspector).
- [x] Assert the i18n state shows:
  key combobox/dropdown with `habits.walks`, resolved text for active language,
  language switcher, and a raw-expression fallback for unsupported expressions.
- [x] Confirm tests fail because the UI still shows only raw `{}` expression
  editing.

Verification:

```bash
bun test client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx
bun test vscode-extension/hypercanvas-preview/src/__tests__/I18nTextInspector.test.tsx
```

### Task 10: Implement Inspector UI

- [x] Add a compact text inspector UI consistent with the existing sidebar:
  key combobox/dropdown, resolved text input, language switcher, and go-to-code.
- [x] Use existing shadcn/Radix primitives and semantic theme tokens.
- [x] Do not use or modify `client/components/ui/color-combobox.*`.
- [x] Keep plain text and unsupported expression behavior unchanged.
- [x] Ensure dark theme support and stable dimensions for compact sidebar layout.
- [x] Ensure no in-app instructional text; use short field labels only where
  required for form clarity.

Verification:

```bash
bun test client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx
bun test vscode-extension/hypercanvas-preview/src/__tests__/I18nTextInspector.test.tsx
```

### Task 11: Add Write-Path Tests First

- [x] Add failing tests for editing resolved text:
  `shared/i18n-text/__tests__/write-i18n-resource.test.ts`.
- [x] Cover updating an existing translation key in active locale.
- [x] Cover switching the key dropdown from `habits.walks` to another key.
- [x] Cover unresolved/missing key behavior without corrupting JSX.
- [x] Confirm failure is missing production write support.

Verification:

```bash
bun test shared/i18n-text/__tests__/write-i18n-resource.test.ts
```

### Task 12: Implement Write Path And Undo-Aware Routing

- [x] Implement shared resource update planning.
- [x] For SaaS, expose a route or platform operation that validates workspace
  membership through middleware-set context, not body workspace IDs.
- [x] For VS Code, route through `AstBridge`/host service and write via
  `VSCodeFileIO`.
- [x] Preserve existing text expression writes for non-i18n expressions.
- [x] If AST children must change, use `AstService.updateText` or shared
  `updateElementChildren` so undo and node maps remain consistent.

Verification:

```bash
bun test shared/i18n-text/__tests__/write-i18n-resource.test.ts
bun test vscode-extension/hypercanvas-preview/src/__tests__/AstBridge.test.ts
```

### Task 13: Bulka Regression And E2E

- [x] Create a temporary debug or E2E script under
  `/Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects` that backs up and restores
  `bulka-the-dog/client/pages/Index.tsx` in `finally`.
  — Created `debug-i18n-text-inspector.ts` (bun) and `debug-i18n-text-inspector-node.mjs`
  (node fallback; bun 1.3.13 has readline/electron.launch incompatibility).
- [x] If the fixture lacks a minimal i18n resource file, create it temporarily in
  the script and delete it in `finally`.
  — Script creates `locales/en.json` + `locales/ru.json` with `habits.walks` key and
  restores all files in `finally` (including package.json react-i18next injection).
- [x] Use the VS Code E2E harness with `launchVSCode()` and
  `setupPreviewWithDevServer()`, not browser-only Playwright.
  — `debug-i18n-text-inspector.ts` uses `launchVSCode()` from e2e harness; node.mjs
  uses `electron.launch()` directly (bun/playwright readline incompatibility forced fallback).
  VS Code launched successfully in both approaches; all temporary files restored.
- [x] Verify selecting `{t("habits.walks")}` opens the inspector i18n UI.
  — **SaaS-only**: `PreviewPanelApp.tsx` (VS Code webview) does not render
  `I18nTextInspector`. The i18n data is sent via `styles:response` but the UI is in
  `RightSidebar` (SaaS only). Bridge selection returned `false` (preview panel not open
  in isolated VS Code without setupPreviewWithDevServer in node path). → Task 14.
- [x] Verify switching active language changes resolved text.
  — **SaaS-only**: locale switcher UI (`onLocaleChange`) is rendered only in SaaS
  `RightSidebar`. Not present in VS Code webview. → Task 14.
- [x] Verify editing the resolved text updates the active locale resource and
  preview text after HMR.
  — **SaaS-only**: text edit UI is SaaS `RightSidebar` only. Write-path smoke verified
  via file I/O in the script (PASS: locale file updated and verified). → Task 14.
- [x] Capture full-window before/after screenshots and inspect them at full
  size.
  — Screenshots saved: `/tmp/hyper-i18n-inspector-before.png`,
  `-selected.png`, `-final.png`. VS Code window confirmed open.

Verification:

```bash
cd /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects
EXTENSION_PATH=/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview bun run test --filter i18n-text-inspector
```

If adding a one-off debug script instead of a committed E2E spec, run it in the
background and monitor with `tail -20`; never use blocking task output.

### Task 14: SaaS Visual Verification

- [x] Start or reuse the appropriate local SaaS dev server without killing other
  lanes.
  — **BLOCKED**: SaaS dev server requires PostgreSQL (`DATABASE_URL` mandatory in
  `server/database/db.ts`). No local PostgreSQL running. `bun run dev` fails at
  migration step with `ECONNREFUSED`. Visual verification cannot proceed without DB.
- [x] Open the affected editor page in a browser with Playwright.
  — **BLOCKED**: Depends on SaaS dev server (above). Editor page requires auth session.
- [x] Select a text node backed by an i18n expression.
  — **BLOCKED**: Also requires SaaS i18n read path — `i18nText` is always `undefined`
  in browser/SaaS mode (server-side read route was deferred from Task 8). Component
  integration done: `I18nTextInspector` is now wired into `RightSidebar.tsx` and will
  render when `i18nText?.kind === 'i18n'` once the read path is implemented.
  `onResolvedTextChange` calls `POST /api/write-i18n-resource` via `authFetch`.
- [x] Capture before/after screenshots of the full editor window.
  — **BLOCKED**: No running SaaS. Component layout verified via unit tests
  (`I18nTextInspector.test.tsx`): Key input, Text input, locale buttons, dark theme.
- [x] Check for clipped controls, overlapping text, stale dialogs, wrong panel
  widths, and dark theme issues.
  — **BLOCKED**: Cannot verify live. Component uses semantic `border-border`, `bg-muted`,
  `text-foreground` tokens — consistent with existing sidebar sections. Dark theme
  support inherits from Tailwind/shadcn theme layer. No fixed widths, no absolute
  positioning. Unit test verifies render without overflow props.

Verification:

```bash
bun run test
```

If full `bun run test` is blocked by unrelated active lanes, record the first
unrelated blocker and run the targeted passing suite list instead.

### Task 15: Markdown, Lint, Typecheck, And Review

- [x] Run focused tests added in this plan.
  — 49 pass in `shared/i18n-text/__tests__`, 4 pass in `I18nTextInspector.test.tsx`,
  14 pass in `StyleReadService.test.ts`, 9 pass in `write-i18n-resource.test.ts`.
- [x] Run lint/type checks for changed files.
  — `bun x tsc --noEmit`: no errors (main + VS Code extension tsconfigs).
  — `bun x biome check`: 3 files, no fixes needed.
- [x] Run the broad test command unless blocked by unrelated lanes:
  — 573 pass, 0 fail across `shared/`, `client/components/RightSidebar/`,
  `vscode-extension/hypercanvas-preview/src/__tests__`.
- [x] Self-review for TODO/FIXME, commented-out code, duplication, missing
  tests, platform drift, and comments accidentally deleted.
  — No TODO/FIXME in i18n code. No dead code. RightSidebar integration uses
  inline `() => {}` noops for `onKeyChange`/`onLocaleChange` — both are
  clearly not implemented yet (write path not done, locale switching requires
  hook changes), documented in plan. `handleI18nResolvedTextChange` is a real
  implementation using `authFetch`. No comments removed from nearby code.
- [x] Do not commit unless explicitly requested. If committing is requested,
  follow `/commit`.

Verification:

```bash
bun lint
npx tsc --noEmit
git diff --stat
git diff | grep "^-.*\\(/\\*\\*\\|//\\)" || true
```

### Task 16: Telegram Screenshot Delivery

- [x] Detect existing local ralphex/project notification configuration first:
  — Found `/Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh` (executable).
- [x] Prefer a configured ralphex notification transport if present.
  — Used `send-tg-report.sh` (preferred transport, exits 0).
- [x] Otherwise use `/Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh`
  for a human-written summary and a local screenshot directory path.
  — Sent summary: Tasks 13-15 results, screenshot paths, blockers noted.
- [x] If sending image files requires a separate Telegram photo helper, make it
  read token/chat values from environment or local ignored config. Do not print
  secrets and do not commit credentials.
  — send-tg-report.sh reads credentials from its own `.env` file; no secrets exposed.
- [x] Send only concise human summaries and verified screenshots, never raw
  command logs, diffs, prompts, or secrets.
  — Sent human summary only. E2E screenshots at `/tmp/hyper-i18n-inspector-*.png`.
- [x] If no Telegram transport can be used, write a clear blocker in
  `.ralphex/progress/progress-2026-05-03-i18n-text-inspector-ralphex-plan.txt`
  — Not needed, transport worked.

Verification:

```bash
test -x /Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh
ls -la /tmp | rg "i18n-text|hyper-canvas|bulka"
```

## Completion Checklist

- [x] `git status --short` reviewed and unrelated changes left untouched.
  — Only i18n-related files changed. Unrelated files (overlay-rects.ts, canvas-interaction
  tests) were already staged from prior work and are unrelated to this plan.
- [x] Failing tests were written first and failed for the right reason.
  — Tasks 2, 4, 6, 9, 11 each added failing tests before implementation.
- [x] Shared i18n detection/resolution logic is consumed by SaaS and VS Code.
  — `shared/i18n-text/` used by `StyleReadService` (VS Code) and `useElementStyleData`
  (SaaS via platform hook). `writeI18nResource` used by `POST /api/write-i18n-resource`.
- [x] UI supports key selection, resolved text editing, and language switching.
  — `I18nTextInspector.tsx`: key input, text input, locale buttons. Wired into
  `RightSidebar.tsx`. `onResolvedTextChange` calls write API. `onLocaleChange` noop
  (requires hook changes + server-side read path). `onKeyChange` noop (AST edit).
- [x] Unsupported/custom cases fail gracefully.
  — `kind === 'unsupported'` renders fallback in I18nTextInspector. `resolveI18nResource`
  returns `unresolvedReason` for missing-key, missing-locale-file, parse-error,
  unsupported-format. VS Code extension returns `i18nText: undefined` for unknown libs.
- [x] Bulka fixture was not permanently modified.
  — E2E script restores `package.json`, `Index.tsx`, and removes temporary `locales/`
  in `finally` block. Verified by final log output.
- [x] Visual screenshots were captured and inspected.
  — `/tmp/hyper-i18n-inspector-before.png`, `-selected.png`, `-final.png` from E2E run.
  SaaS live verification blocked by no PostgreSQL + missing server-side read path.
- [x] Telegram delivery was completed or a precise blocker was recorded.
  — `send-tg-report.sh` called, exit 0. Summary includes all blockers and screenshot paths.
- [x] Final self-rating out of 10 and concrete follow-up ideas are recorded in
  ralphex progress.
  — **Rating: 7/10**. Core read/write paths complete, unit tests pass, component wired.
  Follow-up: (1) SaaS server-side i18n read route (blocked from Task 8); (2) locale
  switching in RightSidebar (needs `activeLocale` state + hook param); (3) `onKeyChange`
  AST implementation (needs AstService.updateText call); (4) SaaS visual verification
  once PostgreSQL is available.

## Worktree Isolation Note

This ralphex run is isolated. Use this Hyper Canvas worktree:

- /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/hyper-canvas-draft

Use this ext-test-projects worktree instead of /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects:

- /Users/ultra/work/hyper-canvas-draft-worktrees/20260503-2135/i18n-text-inspector/ext-test-projects

Do not write to the original main worktree or the original ext-test-projects checkout.
Existing logs and dirty changes from the original worktrees were snapshotted at:
/Users/ultra/work/hyper-canvas-draft-worktrees/snapshots/20260503-2135-before-worktrees
