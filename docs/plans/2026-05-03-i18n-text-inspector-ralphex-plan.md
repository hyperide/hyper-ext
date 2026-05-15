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

Use `/Users/ultra/work/ext-test-projects/bulka-the-dog/client/pages/Index.tsx`
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
  sed -n '1,240p' /Users/ultra/work/ext-test-projects/CLAUDE.md
  ```

Verification:

```bash
git status --short
rg -n "habits\\.walks|useLanguage|t\\(" /Users/ultra/work/ext-test-projects/bulka-the-dog/client/pages/Index.tsx
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

- [ ] Add failing tests:
  `shared/i18n-text/__tests__/resolve-i18n-resource.test.ts`.
- [ ] Use in-memory `FileIO` fixtures with common resource layouts:
  `locales/en.json`, `src/i18n/en.json`, `messages/en.json`,
  `messages/en.ts`, `app/[locale]/messages/en.json`, and namespaced
  `locales/en/common.json`.
- [ ] Cover active locale, fallback locale, missing key, nested dot key, and
  namespace handling.
- [ ] Confirm failure is missing resource resolution, not broken test setup.

Verification:

```bash
bun test shared/i18n-text/__tests__/resolve-i18n-resource.test.ts
```

### Task 7: Implement Locale Resource Resolution

- [ ] Implement shared resource discovery using `FileIO`.
- [ ] Support JSON first; support simple TS/JS object exports only if the project
  already has parser utilities that make this safe.
- [ ] Return `availableLocales`, `activeLocale`, `resolvedText`, and a precise
  unresolved reason.
- [ ] Do not evaluate arbitrary project code.
- [ ] Add a narrow host adapter if `FileIO` lacks directory scanning needed for
  locale discovery.

Verification:

```bash
bun test shared/i18n-text/__tests__/resolve-i18n-resource.test.ts
```

### Task 8: Thread I18n Metadata Through SaaS And VS Code Reads

- [ ] Extend shared platform message types in `client/lib/platform/types.ts` and
  `vscode-extension/hypercanvas-preview/src/types.ts` before sending new message
  fields.
- [ ] Extend `ElementStyleData` with optional `i18nText`.
- [ ] In SaaS, enrich `useElementStyleData` through a server/shared read path
  that can access project files safely.
- [ ] In VS Code, enrich `StyleReadService.readClassName` with shared detection
  and resource resolution through `VSCodeFileIO`.
- [ ] Keep pure logic shared; keep Node/VS Code I/O at the boundary.

Verification:

```bash
bun test client/lib/platform/hooks
bun test vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts
```

### Task 9: Add Inspector UI Tests First

- [ ] Add failing UI tests for SaaS inspector text display:
  `client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx`
  or the closest existing RightSidebar test path.
- [ ] Add failing VS Code webview test:
  `vscode-extension/hypercanvas-preview/src/__tests__/PropsForm.test.ts` or a
  focused preview-panel test if PropsForm is the active inspector for text.
- [ ] Assert the i18n state shows:
  key combobox/dropdown with `habits.walks`, resolved text for active language,
  language switcher, and a raw-expression fallback for unsupported expressions.
- [ ] Confirm tests fail because the UI still shows only raw `{}` expression
  editing.

Verification:

```bash
bun test client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx
bun test vscode-extension/hypercanvas-preview/src/__tests__/PropsForm.test.ts
```

### Task 10: Implement Inspector UI

- [ ] Add a compact text inspector UI consistent with the existing sidebar:
  key combobox/dropdown, resolved text input, language switcher, and go-to-code.
- [ ] Use existing shadcn/Radix primitives and semantic theme tokens.
- [ ] Do not use or modify `client/components/ui/color-combobox.*`.
- [ ] Keep plain text and unsupported expression behavior unchanged.
- [ ] Ensure dark theme support and stable dimensions for compact sidebar layout.
- [ ] Ensure no in-app instructional text; use short field labels only where
  required for form clarity.

Verification:

```bash
bun test client/components/RightSidebar/__tests__/I18nTextInspector.test.tsx
bun test vscode-extension/hypercanvas-preview/src/__tests__/PropsForm.test.ts
```

### Task 11: Add Write-Path Tests First

- [ ] Add failing tests for editing resolved text:
  `shared/i18n-text/__tests__/write-i18n-resource.test.ts`.
- [ ] Cover updating an existing translation key in active locale.
- [ ] Cover switching the key dropdown from `habits.walks` to another key.
- [ ] Cover unresolved/missing key behavior without corrupting JSX.
- [ ] Confirm failure is missing production write support.

Verification:

```bash
bun test shared/i18n-text/__tests__/write-i18n-resource.test.ts
```

### Task 12: Implement Write Path And Undo-Aware Routing

- [ ] Implement shared resource update planning.
- [ ] For SaaS, expose a route or platform operation that validates workspace
  membership through middleware-set context, not body workspace IDs.
- [ ] For VS Code, route through `AstBridge`/host service and write via
  `VSCodeFileIO`.
- [ ] Preserve existing text expression writes for non-i18n expressions.
- [ ] If AST children must change, use `AstService.updateText` or shared
  `updateElementChildren` so undo and node maps remain consistent.

Verification:

```bash
bun test shared/i18n-text/__tests__/write-i18n-resource.test.ts
bun test vscode-extension/hypercanvas-preview/src/__tests__/AstBridge.test.ts
```

### Task 13: Bulka Regression And E2E

- [ ] Create a temporary debug or E2E script under
  `/Users/ultra/work/ext-test-projects` that backs up and restores
  `bulka-the-dog/client/pages/Index.tsx` in `finally`.
- [ ] If the fixture lacks a minimal i18n resource file, create it temporarily in
  the script and delete it in `finally`.
- [ ] Use the VS Code E2E harness with `launchVSCode()` and
  `setupPreviewWithDevServer()`, not browser-only Playwright.
- [ ] Verify selecting `{t("habits.walks")}` opens the inspector i18n UI.
- [ ] Verify switching active language changes resolved text.
- [ ] Verify editing the resolved text updates the active locale resource and
  preview text after HMR.
- [ ] Capture full-window before/after screenshots and inspect them at full
  size.

Verification:

```bash
cd /Users/ultra/work/ext-test-projects
EXTENSION_PATH=/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview bun run test --filter i18n-text-inspector
```

If adding a one-off debug script instead of a committed E2E spec, run it in the
background and monitor with `tail -20`; never use blocking task output.

### Task 14: SaaS Visual Verification

- [ ] Start or reuse the appropriate local SaaS dev server without killing other
  lanes.
- [ ] Open the affected editor page in a browser with Playwright.
- [ ] Select a text node backed by an i18n expression.
- [ ] Capture before/after screenshots of the full editor window.
- [ ] Check for clipped controls, overlapping text, stale dialogs, wrong panel
  widths, and dark theme issues.

Verification:

```bash
bun run test
```

If full `bun run test` is blocked by unrelated active lanes, record the first
unrelated blocker and run the targeted passing suite list instead.

### Task 15: Markdown, Lint, Typecheck, And Review

- [ ] Run focused tests added in this plan.
- [ ] Run lint/type checks for changed files.
- [ ] Run the broad test command unless blocked by unrelated lanes:

  ```bash
  bun run test
  ```

- [ ] Self-review for TODO/FIXME, commented-out code, duplication, missing
  tests, platform drift, and comments accidentally deleted.
- [ ] Do not commit unless explicitly requested. If committing is requested,
  follow `/commit`.

Verification:

```bash
bun lint
npx tsc --noEmit
git diff --stat
git diff | grep "^-.*\\(/\\*\\*\\|//\\)" || true
```

### Task 16: Telegram Screenshot Delivery

- [ ] Detect existing local ralphex/project notification configuration first:

  ```bash
  find .ralphex /Users/ultra/xp/codex-tg-bot -maxdepth 3 -type f 2>/dev/null | rg "send-tg-report|telegram|notify|webhook|slack|email|script"
  ```

- [ ] Prefer a configured ralphex notification transport if present.
- [ ] Otherwise use `/Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh`
  for a human-written summary and a local screenshot directory path.
- [ ] If sending image files requires a separate Telegram photo helper, make it
  read token/chat values from environment or local ignored config. Do not print
  secrets and do not commit credentials.
- [ ] Send only concise human summaries and verified screenshots, never raw
  command logs, diffs, prompts, or secrets.
- [ ] If no Telegram transport can be used, write a clear blocker in
  `.ralphex/progress/progress-2026-05-03-i18n-text-inspector-ralphex-plan.txt`
  with the screenshot paths and the missing transport requirement.

Verification:

```bash
test -x /Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh
ls -la /tmp | rg "i18n-text|hyper-canvas|bulka"
```

## Completion Checklist

- [ ] `git status --short` reviewed and unrelated changes left untouched.
- [ ] Failing tests were written first and failed for the right reason.
- [ ] Shared i18n detection/resolution logic is consumed by SaaS and VS Code.
- [ ] UI supports key selection, resolved text editing, and language switching.
- [ ] Unsupported/custom cases fail gracefully.
- [ ] Bulka fixture was not permanently modified.
- [ ] Visual screenshots were captured and inspected.
- [ ] Telegram delivery was completed or a precise blocker was recorded.
- [ ] Final self-rating out of 10 and concrete follow-up ideas are recorded in
  ralphex progress.
