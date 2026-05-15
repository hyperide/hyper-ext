# B5 — i18n Key Combobox: Fetch Available Keys via RPC

## Context

The `I18nTextInspector` component has a key combobox UI (using shadcn Command/Popover) that
lets users search existing i18n keys and create new ones. The combobox is built and wired, but
it never shows because `availableKeys` prop is always `undefined` and `keyEditable` is always
`false` in `RightSidebar.tsx`.

Root cause: there is no RPC path to fetch the list of keys from the active locale file.
`StyleReadService` resolves the translation of a single key, but does not expose all keys.

Current state (branch `ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e`):
- `I18nTextInspector` has `availableKeys?: string[]` and `keyEditable?: boolean` props
- The combobox JSX fires when `availableKeys && keyEditable`
- `RightSidebar.tsx` passes `availableKeys={undefined}` and `keyEditable={false}` (hardcoded)
- `onKeyChange` is wired but only sends `styles:writeI18nKey` — no RPC for reading keys yet

## Scope

Add the smallest working path:
1. `StyleReadService.getAvailableKeys(componentPath, syntheticRef): Promise<string[]>`  
   — reads locale file discovered by `discoverLayout`, returns all leaf-level keys.
2. New message type `styles:fetchI18nKeys` → PanelRouter → StyleReadService → response.
3. `useElementStyleData` sends this message after i18nText arrives (only when kind === 'i18n').
4. `RightSidebar` stores `availableKeys` state and passes it + `keyEditable={true}` to inspector.
5. One failing e2e test first, then green.

Do not implement key creation (onKeyChange write path) in this session — it already exists.
Do not modify `shared/canvas-interaction/` — only extension + client code.
Do not kill existing ralphex processes.
Do not modify `client/components/ui/color-combobox.*`.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any extension E2E.
- TDD mandatory: write a failing e2e or integration test first, confirm it fails for the right
  reason, then implement the fix.
- Do not push directly to `ultra/hyp-363-...` — commit to a new branch from current HEAD.
- Telegram heartbeat every 15 min during long work (short human-written summary, not logs).
- Write progress to `.ralphex/progress/progress-2026-05-05-b5-i18n-key-combobox.txt`.

This ralphex run is isolated. Use this Hyper Canvas worktree:
- `/Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b5-i18n-keys/hyper-canvas-draft`

Create it with:
```bash
git -C /Users/ultra/work/hyper-canvas-draft worktree add \
  /Users/ultra/work/hyper-canvas-draft-worktrees/20260505-b5-i18n-keys/hyper-canvas-draft \
  -b HYP-b5-i18n-key-combobox ultra/hyp-363-vs-code-preview-webview-opens-offscreen-in-e2e
```

### Task 1: Add `getAvailableKeys` to StyleReadService

- [x] Read `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts` fully.
- [x] Read `shared/i18n-text/resolve-i18n-resource.ts` — understand `discoverLayout` and `resolveKey`.
- [x] Add `getAvailableKeys(componentPath: string, syntheticRef: string, activeLocale?: string): Promise<string[]>` to `StyleReadService`.
  - Call existing `_tryDetectI18n` to get library + namespace.
  - Call `discoverLayout` with the detected locale info.
  - If `mergedData`: extract all leaf keys from `mergedData[activeLocale]` recursively.
  - If flat JSON: read file, parse JSON, extract all leaf keys recursively.
  - Return empty array on any error.
- [x] Add unit test in `src/__tests__/StyleReadService.test.ts`: `getAvailableKeys` returns key list for i18n JSX with flat locale file.
- [x] Run `bun test vscode-extension/hypercanvas-preview/src/__tests__/StyleReadService.test.ts`.

Acceptance: `getAvailableKeys` returns `['habits.walks', 'habits.runs', ...]` for the i18n fixture.

### Task 2: Add `styles:fetchI18nKeys` Message Type

- [x] Read `vscode-extension/hypercanvas-preview/src/PanelRouter.ts`.
- [x] Read `client/lib/platform/types.ts` — the `PlatformMessage` union.
- [x] Add `styles:fetchI18nKeys` to `PlatformMessage` in `client/lib/platform/types.ts`.
- [x] Add `styles:i18nKeysResponse` to the response types.
- [x] In `PanelRouter.ts`: handle `styles:fetchI18nKeys` → call `_styleReadService.getAvailableKeys(...)` → respond with `styles:i18nKeysResponse`.
- [x] Add PanelRouter integration test in `src/__tests__/PanelRouter.test.ts`: `styles:fetchI18nKeys` returns a response with `keys` array.
- [x] Run `bun test vscode-extension/hypercanvas-preview/src/__tests__/PanelRouter.test.ts`.

Acceptance: PanelRouter routes the message and responds with `{ type: 'styles:i18nKeysResponse', requestId, success: true, keys: string[] }`.

### Task 3: Wire Available Keys in useElementStyleData

- [x] Read `client/lib/platform/hooks/useElementStyleData.ts`.
- [x] After `i18nText` arrives with `kind === 'i18n'`, send `styles:fetchI18nKeys` with the same `elementId` and `componentPath`.
- [x] Handle `styles:i18nKeysResponse`: store `availableKeys` in state alongside `i18nText`.
- [x] Add `availableKeys?: string[]` to the hook return type.

Acceptance: `useElementStyleData` returns `availableKeys` when element has i18n binding.

### Task 4: Wire RightSidebar

- [x] Read `client/components/RightSidebar/RightSidebar.tsx`.
- [x] Pass `availableKeys={data.availableKeys}` and `keyEditable={true}` to `I18nTextInspector`.
- [x] Verify the combobox now renders (not disabled).

Acceptance: `I18nTextInspector` receives `availableKeys` and renders the Popover trigger (not a disabled input).

### Task 5: Write RED e2e Test, Then Make GREEN

- [x] Add test to `ext-test-projects/e2e/tests/project-independent/i18n-inspector.spec.ts`.
- [x] Test: select i18n element → click key combobox → list shows at least one key.
- [x] Confirm test FAILS before build (expected to fail = key list is empty/combobox not shown).
- [x] Build extension: `cd vscode-extension/hypercanvas-preview && npm run package`.
- [x] Install: `code --install-extension hypercanvas-preview-*.vsix --force`.
- [x] Reload VS Code: `vscmd workbench.action.reloadWindow -p /Users/ultra/work/ext-test-projects/react-vite-tw4-twitter`.
- [x] Run test — confirm GREEN.

Acceptance: Test passes, combobox shows keys from locale file.

### Task 6: Lint + Typecheck

- [x] `bun lint` in hyper-canvas-draft.
- [x] `bun typecheck` or `tsc --noEmit` for extension.
- [x] Fix any errors.

### Task 7: Commit

- [x] Commit all changes with message: `feat(i18n): wire availableKeys combobox via styles:fetchI18nKeys RPC`.
- [x] Run `/commit` workflow (codex review, Linear comment, commit).

### Task 8: Telegram Handoff

- [x] Send summary: what was implemented, test command + result, any remaining risk.
- [x] Send screenshot of combobox showing keys.
- [x] Do not repeat in later messages once done.
