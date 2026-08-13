# MCP test failures — API mismatches + selection timeout

<!-- commission: wc-20260513-507415ec | decision: dec-20260513-class-c-mcp-test-params -->

## Context

### Failures observed (S1, run-20260512-084158-98150)

4 MCP tool tests fail in `tests/project-independent/mcp-tools.spec.ts`. Two distinct root causes.

#### Root cause A — wrong MCP tool parameter names (tests 3 & 4)

**`hyper_get_element_styles — Tailwind classes parsed` (~25–28s)**

Test calls:

```typescript
await callMcpTool(port!, "hyper_get_element_styles", { elementId: selectedIds[0] });
```

Tool schema requires `{ className: string }` OR `{ styleProps: Record<...> }` (union type).
Error from server: `"Unrecognized key: 'elementId'"`.

**`hyper_suggest_color_token — nearest Tailwind token` (1242ms, fast fail)**

Test calls:

```typescript
await callMcpTool(port!, "hyper_suggest_color_token", { hex: "#3b82f6" });
```

Tool schema requires `{ color: string }`.
Error from server: `"Invalid input: expected string, received undefined"` for path `["color"]`.

These are **test bugs** — wrong parameter names. The tool implementations have the correct schema; the tests were written with stale parameter names.

#### Root cause B — `waitForAnySelection` timeout (tests 1 & 2)

**`hyper_duplicate_element — copy appears` (~55–57s)**
**`hyper_get_selection — returns canvas state` (~55–57s)**

Both tests call `setupPreviewWithDevServer` + `canvas.clickElement(ids[...])` + `canvas.waitForAnySelection(25_000)`.

Actual error: `TimeoutError: frame.waitForFunction: Timeout 25000ms exceeded` inside `PreviewCanvas.waitForAnySelection` (line 279–281 of PreviewCanvas.ts).

The canvas click at line 316/751 (`canvas.clickElement(ids[ids.length - 1])`) does not result in a canvas selection signal within 25s on the `[independent]` project. This is likely because:

- On the reference project (react-vite-tw4-twitter), clicking via CDP takes >25s under 3-shard Docker CPU pressure to propagate the selection through bridge → StateHub → canvas state
- OR the last clickable element has an attribute that prevents selection (e.g., it's a container without a fiber node)

## Scope

**Allowed:**

- `ext-test-projects/e2e/tests/project-independent/mcp-tools.spec.ts` — fix parameter names and increase selection timeout

**Forbidden:**

- Changes to MCP tool implementations
- Changes to `setup-preview.ts` for these tests

## Tasks

### Task 1: Fix root cause A — wrong parameter names

**`hyper_suggest_color_token` (line 1239–1264):**

- [ ] Change `{ hex: '#3b82f6' }` → `{ color: '#3b82f6' }` in the tool call
- [ ] Run in isolation to confirm fix

**`hyper_get_element_styles` (line 1183–1220):**

- [ ] Read the MCP tool definition for `hyper_get_element_styles` to confirm current schema
- [ ] The test currently sends `{ elementId: selectedIds[0] }`. The tool expects `{ className }` or `{ styleProps }`. Get the element's CSS class from inspector or canvas state, pass it as `className`. If the tool description says it accepts an element nodeRef too (schema may have changed since the test was written), use the correct key.
- [ ] Update the test call to match the actual tool schema
- [ ] Run in isolation to confirm fix

### Task 2: Fix root cause B — waitForAnySelection timeout

**`hyper_duplicate_element` and `hyper_get_selection`:**

The `canvas.clickElement(ids[ids.length - 1])` approach is unreliable for selection signal timing. Use `openExplorerAndSelect` instead, which gates on the inspector showing a componentName (more reliable signal):

```typescript
// Replace:
await canvas.clickElement(ids[ids.length - 1]);
await canvas.waitForAnySelection(25_000);
const selectedIds = await canvas.getSelectedIds();
expect(selectedIds.length).toBeGreaterThan(0);

// With:
await openExplorerAndSelect(window, cmd, 0); // tree item 0, waits for inspector
const selectedIds = await canvas.getSelectedIds();
expect(selectedIds.length).toBeGreaterThan(0);
```

OR, if `openExplorerAndSelect` is not available in this test's imports: increase `waitForAnySelection` timeout to 60s (the `[independent]` project has slow selection under Docker 3-shard CPU).

- [ ] Check which imports are available in `mcp-tools.spec.ts`
- [ ] Apply the more reliable selection method
- [ ] Ensure the `selectedIds[0]` passed to `hyper_duplicate_element` is a valid nodeRef (not empty)

### Task 3: Run all 4 tests GREEN

- [ ] `HYPER_E2E_SHARDS=1 bun run test:docker` with `--grep "hyper_suggest_color_token|hyper_get_element_styles|hyper_get_selection|hyper_duplicate_element"`
- [ ] All 4 pass, each completes in <30s (no 55–57s timeouts, no 1242ms fast fails)
- [ ] Send TG report with pass/fail counts

## Acceptance criteria

1. `hyper_suggest_color_token` GREEN — passes correct `{ color }` param
2. `hyper_get_element_styles` GREEN — passes correct param matching tool schema
3. `hyper_duplicate_element` GREEN — `waitForAnySelection` completes in <30s
4. `hyper_get_selection` GREEN — `waitForAnySelection` completes in <30s
5. No regression in other MCP tool tests
