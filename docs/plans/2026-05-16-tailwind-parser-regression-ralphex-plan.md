# tailwind parser regression: hyper_get_element_styles — Tailwind classes parsed

## Context

### Regression

Test `MCP Tools › hyper_get_element_styles — Tailwind classes parsed` (line 1177 in
`tests/project-independent/mcp-tools.spec.ts`) fails in run-20260516-102112-76022 (S1),
both attempts, ~25-29s each.

Root cause: commit `64638850` (2026-05-16, same-day) added an error guard in
`vscode-extension/hypercanvas-preview/src/mcp/tools/color-token-provider.ts`:

```ts
if (Object.keys(styles).length === 0) {
  return { success: false, error: `No styles found for className: ...` };
}
```

This guard was added to make the negative test (PI-9-461, line 1427 — `'nonexistent-xyz-class-xyzzy'`)
return `isError: true` correctly. That test now passes.

But `parseTailwindClasses` in `lib/tailwind/parser.ts` is too narrow — it handles only:
- Arbitrary values: `bg-[...]`, `border-[...]`
- Position: `absolute`, `relative`, `fixed`, `sticky`
- Margin: `m-*`, `mx-*`, `my-*`, `mt-*`, etc.
- Display: `flex`, `grid`, `hidden`, `block`, `inline-*`
- Gap: `gap-*`, `gap-x-*`, `gap-y-*`
- Overflow: `overflow-*`

It does NOT handle:
- **Padding**: `p-*`, `px-*`, `py-*`, `pt-*`, `pr-*`, `pb-*`, `pl-*`
- **Named Tailwind colors**: `bg-blue-500`, `bg-twitter-hover`, `text-white`, `text-gray-900`
- **`rounded` variants**: `rounded-full`, `rounded-2xl`, `rounded-3xl`, `rounded-none` etc.
- **`text-*` colors**: `text-twitter-text`, `text-blue-500`, etc.
- **Transition**: `transition-colors`, `transition-all`, etc.
- **Hover modifiers**: `hover:bg-twitter-hover`, etc.

A real DOM className from `react-vite-tw4-twitter` (e.g. `p-2 rounded-full hover:bg-twitter-hover transition-colors text-twitter-text`) returns `{}` from `parseTailwindClasses`. The guard then fires, returning `isError: true`. Test PI-9-451 expects no error → FAIL.

### Conflict

| Test | Input | Expects | Before fix | After 64638850 |
|------|-------|---------|-----------|----------------|
| PI-9-451 (line 1177) | real DOM className | no isError, JSON result | PASS | FAIL |
| PI-9-461 (line 1427) | `nonexistent-xyz-class-xyzzy` | isError: true | FAIL | PASS |

Goal: both tests pass simultaneously.

## Scope

Fix `lib/tailwind/parser.ts` to return non-empty styles for real Tailwind className strings.
The guard in `color-token-provider.ts` stays — it's correct for truly unknown classNames.

Do NOT change MCP tool interface, test expectations, or test fixture.

## Hard Rules

- Read `/Users/ultra/work/ext-test-projects/CLAUDE.md` before any E2E work.
- TDD: confirm test is RED before fix, GREEN after.
- This ralphex run is isolated. Use this Hyper Canvas worktree:
  `/Users/ultra/work/hyper-canvas-draft-worktrees/20260516-tailwind-parser/hyper-canvas-draft`
- Write progress to `.ralphex/progress/progress-2026-05-16-tailwind-parser.txt`.
- TG heartbeat every 15 min.
- E2E ONLY via `HYPER_E2E_SHARDS=1 bun run test:docker`.

### Task 1: Read the test and parser

- [ ] Read `ext-test-projects/e2e/tests/project-independent/mcp-tools.spec.ts` lines 1177–1300 (PI-9-451)
- [ ] Read `ext-test-projects/e2e/tests/project-independent/mcp-tools.spec.ts` lines 1427–1470 (PI-9-461)
- [ ] Read `lib/tailwind/parser.ts` — full file
- [ ] Read `vscode-extension/hypercanvas-preview/src/mcp/tools/color-token-provider.ts` — find the guard

Acceptance: understand exactly what className string PI-9-451 uses and what `parseTailwindClasses` returns for it.

### Task 2: Confirm RED

Run the two specific tests in isolation:

```bash
cd /Users/ultra/work/ext-test-projects
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --grep "hyper_get_element_styles" 2>&1 | tail -40
```

Confirm PI-9-451 fails, PI-9-461 passes.

Acceptance: RED confirmed — PI-9-451 fails with `isError` related error.

### Task 3: Extend parseTailwindClasses

In `lib/tailwind/parser.ts`, add support for at minimum:

1. **Padding** (same structure as existing margin):
   - `p-{size}`, `px-{size}`, `py-{size}`, `pt-{size}`, `pr-{size}`, `pb-{size}`, `pl-{size}`
   - Map to `paddingTop/Right/Bottom/Left` (or shorthand `padding`)

2. **Named Tailwind colors for `bg-*`**:
   - `bg-{color}-{shade}` (e.g. `bg-blue-500`, `bg-gray-100`)
   - Use the Tailwind color scale: 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950
   - Map to `backgroundColor`

3. **Named Tailwind colors for `text-*`**:
   - `text-{color}-{shade}` (e.g. `text-white`, `text-gray-900`)
   - Map to `color`

4. **`rounded-*` variants**:
   - `rounded-full`, `rounded-none`, `rounded-sm`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-3xl`
   - Map to `borderRadius`

5. **`transition-*`** (optional — only if needed to make test pass):
   - `transition-colors`, `transition-all`, `transition-opacity`, `transition-transform`
   - Map to `transition`

Don't parse `hover:*`, `focus:*` etc — modifier prefixes should be stripped before parsing (or ignored).

Acceptance: `parseTailwindClasses` returns non-empty object for a string like
`"p-2 rounded-full hover:bg-twitter-hover transition-colors text-twitter-text"`.

### Task 4: Confirm GREEN

```bash
cd /Users/ultra/work/ext-test-projects
HYPER_E2E_SHARDS=1 bun run test:docker -- \
  --grep "hyper_get_element_styles" 2>&1 | tail -40
```

Both PI-9-451 AND PI-9-461 must pass.

If PI-9-461 now fails (guard no longer fires for unknown class): the guard logic needs
to be smarter — distinguish "className looks like valid Tailwind but parser doesn't cover it"
vs "truly invalid class like `nonexistent-xyz-class-xyzzy`".

Alternative guard: `if (!isLikelyTailwindClassName(className) && Object.keys(styles).length === 0)`
where `isLikelyTailwindClassName` checks if any token matches a Tailwind prefix pattern.

Acceptance: both tests GREEN in <60s each.

### Task 5: Commit

```bash
git add lib/tailwind/parser.ts
git commit -m "fix(tailwind): extend parseTailwindClasses — padding, named colors, rounded variants"
```

### Task 6: TG Report

Send via `bash /Users/ultra/xp/codex-tg-bot/scripts/send-tg-report.sh`:
- Commit hash
- Which classes were added to parser
- Both test results (PI-9-451 GREEN + PI-9-461 GREEN)
- Screenshot showing GREEN run output
