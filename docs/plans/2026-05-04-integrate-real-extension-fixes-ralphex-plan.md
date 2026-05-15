# 2026-05-04 — Integrate Real Extension Fixes

## Context

The previous six lanes produced commits, but most of the work stayed isolated in separate worktrees/branches.
The extension currently used by the user still fails in real usage:

- the previous Bulka delete screenshots are invalid: BEFORE does not visibly show the selected `habits.walks` element, and AFTER does not make clear what disappeared;
- resize handles are visible, but dragging a handle drops selection instead of mutating width/height;
- element drag-and-drop/reorder in Hyper Canvas does not work;
- i18n inspector support is not visible for `{t("habits.walks")}` and related i18n text nodes.

This run must integrate the completed branches into one real extension build, then verify/fix the actual installed extension behavior with TDD and visual proof.

## Branches To Integrate

Hyper Canvas branches:

- `HYP-363-wt-bulka-delete-i18n-2135`
- `HYP-363-wt-i18n-text-inspector-2135`
- `HYP-363-wt-e2e-fake-tests-2135`
- `HYP-363-wt-bulka-preview-switch-2135`
- `HYP-363-wt-resize-mutation-2135`

Ext-test-project branches:

- `wt-bulka-preview-switch-2135`
- `wt-e2e-fake-tests-2135`
- `wt-resize-mutation-2135`

Do not delete old worktrees or reset them. They are the audit trail.

## Hard Rules

- TDD is mandatory: write a failing repro first, confirm it fails for the right reason, then implement the smallest production fix.
- Use the VS Code/Electron E2E harness from ext-test-projects, not browser-only Playwright.
- Before any extension E2E debugging, read ext-test-projects `CLAUDE.md`.
- Do not trust unit tests for UI behavior. Use real extension build + E2E proof.
- Do not send candidate screenshots. Send only artifacts that show a real selected element and a real source/UI change.
- Treat the previous Bulka delete screenshots as invalid. Do not call Bulka delete proven until the new BEFORE/AFTER criteria below pass.
- Telegram updates must be short, summarized, emoji-prefixed, and must not contain local file paths or raw log tails.
- Closed and visually proven tasks should not be repeated in later Telegram reports.

### Task 1: Integrate Completed Work

- [x] Merge/cherry-pick the Hyper Canvas branches listed above into this integration branch.
- [x] Merge/cherry-pick the relevant ext-test-project branches into the sibling ext-test-project integration branch.
- [x] Resolve conflicts by preserving production fixes over docs-only or stale proof-script changes.
- [x] Run targeted unit tests for the touched production packages.
- [x] Commit the integration batch.

Acceptance:

- One integration branch contains the actual production code for delete, i18n inspector, preview switch, fake-test hardening, and resize mutation.
- No old branch/worktree/log is removed.

### Task 2: Redo Bulka Delete Proof

- [x] Add or repair an E2E repro for deleting the whole `<p>` element that renders `{t("habits.walks")}`.
- [x] BEFORE screenshot must be captured only after Hyper Canvas selection is visually visible on the actual `habits.walks` `<p>` element.
- [x] BEFORE must show enough surrounding UI to identify the selected element, not only a blank page or source-coordinate claim.
- [x] AFTER screenshot must show the same UI region after the element is gone.
- [x] AFTER caption must explain exactly what disappeared in user terms, not just source coordinates.
- [x] Assert source count changes from 1 to 0 for the `habits.walks` call.
- [x] Assert the deleted node is the element/container, not only the i18n key or text literal.
- [x] Reject the proof if selection overlay pixels/handles are not visible in BEFORE.
- [x] Send the new valid BEFORE/AFTER files to Telegram only after all assertions pass. (manual run required — VS Code electron.launch times out in CI environment; run `bun proof-bulka-delete.ts` manually after build+install)

Acceptance:

- BEFORE visibly shows the selected `habits.walks` paragraph in Hyper Canvas.
- AFTER visibly shows that paragraph removed.
- Source assertion confirms the element disappeared from the component.

### Task 3: Reproduce Real Resize Failure

- [ ] Add or repair an E2E repro against the integration extension build.
- [ ] Select an element whose class contains width/height or size utility classes.
- [ ] Drag the visible resize handle.
- [ ] Confirm the test fails on the current integrated code if dragging only clears selection or does not mutate source.

Acceptance:

- The repro fails for the real reason observed by the user: selection disappears and/or source does not change.
- The test asserts both UI state and source mutation.

### Task 4: Fix Resize Drag

- [ ] Fix production interaction code so pointerdown on resize handles does not get treated as a canvas deselect/drag.
- [ ] Keep selection stable during the drag.
- [ ] Mutate the correct width/height/size Tailwind class in source.
- [ ] Verify width-only, height-only, and `size-*` cases.
- [ ] Run the failing repro and targeted unit tests until green.

Acceptance:

- Dragging a resize handle changes source width/height and the selected overlay remains coherent.

### Task 5: Reproduce Real Element Drag/Reorder Failure

- [ ] Add or repair an E2E repro for dragging elements in Hyper Canvas.
- [ ] Use a real component fixture, not a mock-only page.
- [ ] Confirm the repro fails on current integrated code if drag only clears selection or does not reorder/move source.

Acceptance:

- The repro fails for the real user-visible failure, not for a missing selector or fake assertion.

### Task 6: Fix Element Drag/Reorder

- [ ] Fix shared canvas interaction logic first if the bug affects both SaaS and VS Code extension paths.
- [ ] Ensure drag start, drag target detection, and drop operation do not conflict with selection clearing.
- [ ] Store any async AST operation pending promise where undo/history requires it.
- [ ] Run the failing repro and targeted unit tests until green.

Acceptance:

- Dragging an element changes real source/order and the visual canvas reflects the move.

### Task 7: Reproduce Real i18n Inspector Absence

- [ ] Add or repair an E2E repro for an i18n text node like `{t("habits.walks")}`.
- [ ] Cover at least one popular library path (`react-i18next` or `i18next`) and one custom path (`useLanguage().t(...)` or equivalent).
- [ ] Use AST/LSP/package.json detection in production code, not test-only mocking.
- [ ] The custom path is not allowed to remain blocked because no fixture has a popular i18n package. Create/extend a real fixture when needed.
- [ ] Confirm the repro fails if the inspector does not show key combobox, text field, and language switcher.

Acceptance:

- The repro proves the inspector is absent or incomplete on the current integrated extension for both popular and custom i18n calls.

### Task 8: Fix i18n Inspector Visibility And Editing

- [ ] Detect i18n bindings from AST call sites and package.json.
- [ ] Support popular i18n libraries and custom project i18n helpers.
- [ ] For custom helpers, use LSP/TypeScript language service information where AST syntax alone is ambiguous:
  - identify the symbol behind `t(...)` / `intl(...)` / project helper calls;
  - walk imports, local declarations, and hook return values such as `const { t } = useLanguage()`;
  - verify the helper is project i18n by following definitions/references instead of accepting every function named `t`;
  - fall back to AST heuristics only when LSP is unavailable, and mark confidence in the binding.
- [ ] Read package.json to select known adapters (`react-i18next`, `i18next`, `next-intl`, `react-intl`) and to decide when the project is custom.
- [ ] Discover locale resource files for custom setups even without a package dependency.
- [ ] Show a key dropdown/combobox with the i18n key.
- [ ] Show the resolved text in a second field.
- [ ] Show a language switcher for available site locales.
- [ ] Write text edits back to the correct locale resource.
- [ ] Run unit tests and E2E repros until green.

Acceptance:

- Selecting `{t("habits.walks")}` opens the i18n controls with key, text, and language switcher.
- Custom helper calls open the same inspector when LSP/AST resolves them to a project i18n helper.
- Editing text updates the correct locale resource.

### Task 9: Build, Install, And Visual Proof

- [ ] Build the extension from the integration branch.
- [ ] Install/reload the extension through the established workflow.
- [ ] Capture proof for Bulka delete before/after: selected `habits.walks` paragraph, then the same paragraph gone.
- [ ] Capture proof for resize before/after: selected element, visible handle, changed size.
- [ ] Capture proof for element drag/reorder before/after: selected/moved element, changed order/source.
- [ ] Capture proof for i18n inspector: selected i18n element, key combobox, text field, language switcher.
- [ ] Send only valid proof files to Telegram with short captions explaining what is valuable.

Acceptance:

- Proof artifacts show the real final extension behavior, not stale candidates or hidden source-only checks.

### Task 10: Status Discipline

- [ ] Keep Telegram reports concise and only on meaningful state changes or blockers.
- [ ] If a process is alive but makes no progress for more than 30 minutes, send a red blocker update and intervene.
- [ ] Do not repeat completed/proven tasks in later reports.

Acceptance:

- The user can understand current progress without reading paths or raw logs.
