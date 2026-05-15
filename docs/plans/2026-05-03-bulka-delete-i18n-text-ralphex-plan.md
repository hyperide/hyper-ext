<!-- markdownlint-disable MD013 -->

# Fix Bulka i18n Text Element Deletion

## Context

User reports that deleting this element from the VS Code Hyper Canvas preview
does not work in the Bulka fixture:

```tsx
<p className="text-foreground/80">{t("habits.walks")}</p>
```

Fixture path:
`/Users/ultra/work/ext-test-projects/bulka-the-dog/client/pages/Index.tsx`.

Use the Bulka project only as a reproduction fixture. Do not make permanent
edits to `ext-test-projects` source files.

There are other active lanes in this repository. Do not revert unrelated edits.
Avoid `client/components/ui/color-combobox.*`. Do not kill existing `ralphex`
processes.

## Initial Findings To Verify

- Bulka has two adjacent identical nodes:
  `<p className="text-foreground/80">{t("habits.walks")}</p>`.
- VS Code Delete/Backspace flows through:
  `shared/canvas-interaction/keyboard-handler.ts` ->
  `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`
  -> `hypercanvas:deleteElements` ->
  `vscode-extension/hypercanvas-preview/src/webview-preview-panel/useCanvasInteraction.ts`
  -> `keyboard:delete` ->
  `vscode-extension/hypercanvas-preview/src/PreviewPanel.ts` ->
  `AstBridge.deleteElements` ->
  `AstService.deleteElements`.
- Context menu delete flows through:
  `client/components/CanvasElementContextMenu.tsx` ->
  `contextMenu:delete` ->
  `PreviewPanel._handleContextMenuDelete` ->
  `AstBridge.deleteElements`.
- `AstService.duplicateElement`, `wrapElement`, `updateStyles`, and
  `updateProps` use `_resolveElementInCorrectFile`.
- `AstService.deleteElements` still resolves with `_resolveElement` against the
  original requested file. Confirm whether this is the failing path before
  changing it.

## Root-Cause Hypothesis

Deletion is resolving the selected source-location nodeRef too narrowly. The
selected `<p>` has JSX expression children with an i18n call expression, and the
fixture has duplicate adjacent call-expression paragraphs. If the preview sends
a synthetic source ref that needs node-map source-location resolution, fuzzy
column matching, or correct-file fallback, `deleteElements` may fail or target
the wrong AST node because it bypasses `_resolveElementInCorrectFile`.

Prove or disprove this with a failing production-code test before implementing.

### Task 1: Confirm Workspace State And Reproduction Shape

- [x] Run workspace verification commands and record nodeRef shape

Run:

```bash
cd /Users/ultra/work/hyper-canvas-draft
git status --short
rg -n "deleteElements|keyboard:delete|contextMenu:delete|hypercanvas:deleteElements|resolveClickLocal|sourceLocation|findElementByPosition|JSXExpressionContainer|CallExpression" client shared vscode-extension lib server test -S
rg -n "habits\\.walks|<p className=\"text-foreground/80\"|t\\(\"habits" /Users/ultra/work/ext-test-projects/bulka-the-dog/client/pages/Index.tsx
sed -n '330,390p' /Users/ultra/work/ext-test-projects/bulka-the-dog/client/pages/Index.tsx
```

Also read the VS Code E2E rules before any extension debug work:

```bash
sed -n '1,220p' /Users/ultra/work/ext-test-projects/CLAUDE.md
```

Record the exact selected nodeRef shape observed or inferred from source
location. Do not edit the Bulka source as the permanent fix.

### Task 2: Write The Failing Test First

- [x] Write AstServiceDelete.test.ts with failing regression test

Add a focused regression test before implementation. Preferred path:
`vscode-extension/hypercanvas-preview/src/__tests__/AstServiceDelete.test.ts`.

Use production `AstService` with `InMemoryFileIO`, not copied delete logic.
Model the Bulka shape with two adjacent identical JSX elements:

```tsx
export default function Index() {
  const { t } = useLanguage();
  return (
    <div>
      <p className="text-foreground/80">{t("habits.walks")}</p>
      <p className="text-foreground/80">{t("habits.walks")}</p>
    </div>
  );
}
```

Test requirements:

- Build `AstService('/workspace', fileIO)` and await `ensureInitialized()`.
- Get node-map entries for the two `p` elements from
  `service.nodeMapService.getNodeMap('/workspace/client/pages/Index.tsx')`.
- Call `service.deleteElements('client/pages/Index.tsx', [sourceLocationRef])`
  where `sourceLocationRef` has the same source-ref form the preview sends:
  `client/pages/Index.tsx:<line>:<column>`.
- Include a variant with a deliberately mismatched column on the same line if it
  reproduces the bug; this matches existing fuzzy-column behavior covered by
  `AstServiceNavigation.test.ts`.
- Assert that exactly one `habits.walks` paragraph remains and that the
  neighboring identical paragraph is preserved.

Run only the new test and confirm it fails for the right reason:

```bash
bun test vscode-extension/hypercanvas-preview/src/__tests__/AstServiceDelete.test.ts
```

Expected failing reason:

- `AstService.deleteElements` returns `{ success: false }`, or
- the file still contains both identical paragraphs, or
- the wrong neighboring paragraph is removed.

If the test passes immediately, do not implement the hypothesized fix. Add the
next failing test lower in the stack:

- `lib/ast/position-finder.test.ts` for same-line or fuzzy source selection.
- `shared/canvas-interaction/resolve-source.test.ts` for call-site mapping.
- `vscode-extension/hypercanvas-preview/src/__tests__/useCanvasInteraction.test.ts`
  for message conversion from `hypercanvas:deleteElements` to `keyboard:delete`.

### Task 3: Implement The Smallest Proven Fix

- [x] Update AstService.deleteElements to use _resolveElementInCorrectFile

After the failing test proves the failing layer, make the smallest change.

Likely implementation if Task 2 confirms the hypothesis:

- Update `AstService.deleteElements` to resolve each identifier through
  `_resolveElementInCorrectFile`, matching duplicate, wrap, style, and prop
  operations.
- Preserve current semantics: re-read before each deletion, tolerate already
  deleted child nodes, update the node map after mutations, and return failure
  only when no element was deleted.
- If a cross-file delete is possible, return `resolvedPath` and
  `contentBeforeWrite` consistently enough for `AstBridge.deleteElements` undo
  tracking. If this needs more than a narrow fix, stop and document the tradeoff
  before expanding scope.

If the proven issue is shared click/source resolution, put the fix under
`shared/canvas-interaction/` or `shared/element-tracing/` and consume it from
both:

- SaaS client path: `client/lib/element-tracing/ElementTracer` and editor hooks.
- VS Code extension path:
  `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`.

Do not patch only one platform for element resolution, click handling, overlay
rendering, or deletion behavior.

### Task 4: Add Targeted Regression Coverage

- [x] Add regression tests for fix; run lint

Keep tests focused on production code.

Minimum expected tests after the fix:

- `vscode-extension/hypercanvas-preview/src/__tests__/AstServiceDelete.test.ts`
  covers deleting one of two adjacent identical i18n call-expression paragraphs.
- If the fix touches `lib/ast/position-finder.ts`, add a regression in
  `lib/ast/position-finder.test.ts`.
- If the fix touches shared click/source logic, add or update tests in
  `shared/canvas-interaction/resolve-source.test.ts` or
  `shared/canvas-interaction/click-handler.test.ts`.
- If message plumbing changes, add or update
  `vscode-extension/hypercanvas-preview/src/__tests__/useCanvasInteraction.test.ts`
  and `vscode-extension/hypercanvas-preview/src/__tests__/AstBridge.test.ts`.

Run targeted tests:

```bash
bun test vscode-extension/hypercanvas-preview/src/__tests__/AstServiceDelete.test.ts
bun test lib/ast/position-finder.test.ts shared/canvas-interaction/resolve-source.test.ts
bun test vscode-extension/hypercanvas-preview/src/__tests__/useCanvasInteraction.test.ts vscode-extension/hypercanvas-preview/src/__tests__/AstBridge.test.ts
```

Then run the relevant lint/type check slice:

```bash
bun lint
```

If `bun lint` is too broad because of unrelated active lanes, run the narrowest
available repo lint/type command and clearly record why the full command was not
usable.

### Task 5: Verify SaaS And Extension Paths

- [x] Inspect both VS Code and SaaS delete paths; fix SaaS if vulnerable

Before considering the fix complete, explicitly inspect both paths:

- VS Code: `PreviewPanel.ts`, `AstBridge.ts`, `AstService.ts`,
  `useCanvasInteraction.ts`, and `iframe-interaction.ts`.
- SaaS: `CanvasElementContextMenu.tsx`, `useHotkeysSetup.ts`,
  `ASTApiServiceImpl.ts`, `server/routes/deleteElement.ts`,
  `server/routes/deleteElements.ts`, and shared source-resolution modules.

If the fix belongs only to VS Code host AST resolution, explain why SaaS already
uses the equivalent route or why the route needs a matching change. If SaaS is
also vulnerable, fix it in shared/server code with tests.

### Task 6: Bulka E2E And Visual Verification

- [x] Run Bulka E2E debug script, take before/after screenshots

Use the real VS Code extension E2E harness. Do not use browser-only Playwright
for extension verification.

Do not permanently modify Bulka source. Use a temporary debug script that backs
up and restores `client/pages/Index.tsx` in `finally`.

Suggested command:

```bash
cd /Users/ultra/work/ext-test-projects
EXTENSION_PATH=/Users/ultra/work/hyper-canvas-draft/vscode-extension/hypercanvas-preview \
  bun /tmp/hyper-bulka-delete-i18n-debug.ts \
  > /tmp/hyper-bulka-delete-i18n-debug.log 2>&1 &
tail -40 /tmp/hyper-bulka-delete-i18n-debug.log
```

The debug script must:

- Import `launchVSCode` from `e2e/setup/electron-app`.
- Import `setupPreviewWithDevServer` from `e2e/helpers/setup-preview`.
- Use project
  `/Users/ultra/work/ext-test-projects/bulka-the-dog`.
- Open `client/pages/Index.tsx`.
- Select or click the rendered paragraph for `habits.walks` using the real
  preview iframe and CDP mouse/page object helpers.
- Trigger Delete or context menu Delete.
- Assert the file now has exactly one
  `<p className="text-foreground/80">{t("habits.walks")}</p>`.
- Take screenshots before and after under `/tmp/`.
- Restore the original file content in `finally`, then close VS Code.

Also inspect screenshots manually for the selected element and post-delete
state. Record the screenshot paths in the final handoff.

### Task 7: Final Checks And Handoff

- [x] Run git diff, verify no unrelated files changed, produce handoff summary

Run:

```bash
git diff --stat
git diff -- vscode-extension/hypercanvas-preview/src/services/AstService.ts \
  vscode-extension/hypercanvas-preview/src/__tests__/AstServiceDelete.test.ts \
  lib/ast/position-finder.ts \
  shared/canvas-interaction/resolve-source.ts
```

Do not revert unrelated dirty files. Do not touch
`client/components/ui/color-combobox.*`.

Final handoff must include:

- Exact files changed.
- Failing test command and failure reason observed before implementation.
- Passing targeted test commands.
- Bulka E2E command, log path, and screenshot paths.
- Whether SaaS needed a matching fix, with file references.
- Any skipped findings and why. If a real out-of-scope bug is found, create or
  request a Linear issue instead of silently dropping it.
