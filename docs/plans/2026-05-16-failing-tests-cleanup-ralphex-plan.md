# Failing tests cleanup: fix 25 pre-existing test failures

## Context

`bun run test` currently shows **3108 pass, 25 fail** on this branch (same as main). The failures are pre-existing but need to be resolved. Test failures hide regressions — if a new bug causes a test to fail, it gets lost in the noise.

## Failing Tests Breakdown

### Category A: AstService — element insertion, wrap, style write (5 fails)
- `AstService.insertElement > inserts a native HTML element as child of parent`
- `wrapElementInAST > should add wrapper props`
- `StyleWriteExecutor > executes static Tailwind plans by replacing conflicting classes`
- `StyleWriteExecutor > executes inline style object plans by merging style properties`
- `StyleWriteExecutor > routes computed writes to Tailwind when the element owns className styles`
- `StyleWriteExecutor > routes computed writes to inline styles when no class source exists`

### Category B: AstService — moveElement, cache invalidation (7 fails)
- `AstService.moveElement — text-container & inline-emoji moves (Task 4)` — 3 sub-tests
- `AstService cache invalidation (Task 3)` — 2 sub-tests
- `AstService wrap element > resolves a source-location nodeRef passed as elementId`
- `AstService shared style-write routing > updateProps writes to the element source file when filePath is a different shell component`

### Category C: AstService — cross-component moves (3 fails)
- `AstService.moveElement — cross-component cross-file moves (Task 5)` — 3 sub-tests

### Category D: I18n (5 fails)
- `Bulka project — real client/lib/translations.ts` — 4 sub-tests
- `AstService updateI18nKey > replaces only the selected i18n key literal and preserves the helper expression`

### Category E: Inspector (2 fails)
- `I18nTextInspector > fires onKeyChange on retry when optimisticKey is set but realKey differs`

### Category F: UI Components (2 fails)
- `StrokeSection > syncs stroke width, style, and color edits`
- `StrokeSection > keeps native color input valid for non-hex computed colors`

### Category G: AstBridge (1 fail)
- `AstBridge > ast:writeI18nResource newElementId > returns data.newElementId equal to elementId when previousKey changes`

## Scope

Fix ALL 25 failures. Group by category for parallel work.

## Hard Rules

- Do NOT change test expectations to match broken behavior. Fix the root cause.
- Do NOT skip tests with `test.skip` or `.only`.
- Run tests after each category fix.
- If a test failure is caused by a missing test fixture/mock, create the fixture.
- If a failure requires architectural changes, STOP and ask for guidance.

### Task 1: Fix Category F — StrokeSection UI tests (2 fails)

- [ ] Read `client/components/RightSidebar/sections/__tests__/StrokeSection.test.tsx`
- [ ] Failure: "The given element does not have a value setter" — `fireEvent.change` on a color input. Color input `<input type="color">` may not have a value setter in jsdom/testing-library. Try using `input.value = '#000000'` directly + `fireEvent.input()` or fix the input type in the test.
- [ ] Failure: `expect(input.value).toBe('#000000')` but received `undefined` — the input element may not have `.value` property. Check if it's a native color input or a custom component.
- [ ] Fix and verify: `bun test StrokeSection.test.tsx` — 6 pass, 0 fail.

### Task 2: Fix Category A — AstService style/insert/wrap tests (5 fails)

- [ ] Read failing test files and the code they test.
- [ ] Run tests individually: `bun test lib/ast/__tests__/AstService.insertElement.test.ts` etc.
- [ ] Find root cause: likely missing mock, changed AST shape, or missing fixture file.
- [ ] Fix and verify each.

### Task 3: Fix Category B — moveElement and cache invalidation (7 fails)

- [ ] Run individual test files.
- [ ] Check if failures relate to NodeMapService mock, file system state, or AST cache.
- [ ] Fix and verify.

### Task 4: Fix Category C — cross-component moves (3 fails)

- [ ] These are complex cross-file AST operations.
- [ ] Check for missing import resolution, component name collisions, or file path issues.
- [ ] Fix and verify.

### Task 5: Fix Category D — I18n translations (4 fails)

- [ ] Read `client/lib/translations.ts` and test file.
- [ ] Bulka project tests may require specific fixture files or locale data.
- [ ] Check if fixture files exist and have correct content.
- [ ] Fix and verify.

### Task 6: Fix Category D+E — I18n key update + inspector (3 fails)

- [ ] `AstService updateI18nKey` — AST mutation may expect specific source shape.
- [ ] `I18nTextInspector` — mock setup or async timing issue.
- [ ] Fix and verify.

### Task 7: Fix Category G — AstBridge writeI18nResource (1 fail)

- [ ] Simple unit test, likely mock expectation mismatch.
- [ ] Fix and verify.

### Task 8: Final verification — all tests green

- [ ] `bun run test` — must show 0 failures.
- [ ] Commit and push.

Acceptance: `bun run test` shows 0 failures (or only justified skips with comments).
