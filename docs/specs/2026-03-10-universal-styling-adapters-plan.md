# Universal Styling Adapters — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make MCP styling tools framework-agnostic with strict validation, adapter-based resolution, and z.union() schema.

**Architecture:** Extend `StyleAdapter` with `resolveStyles()` method. Each adapter validates its expected input parameter (className vs styleProps) and returns actionable errors. Switch `hyper_get_element_styles` from deprecated `server.tool()` to `registerTool()` with `z.union()` inputSchema. Add curated `VALID_TAMAGUI_STYLE_PROPS` for prop name validation.

**Tech Stack:** TypeScript, zod, @modelcontextprotocol/sdk, bun:test

---

## Chunk 1: Git Cleanup + Foundation

### Task 1: Move non-core commits to main

Non-core commits on `HYP-283-generic-mcp-styling-tools` that belong on main:

| Commit    | Description                          | Files                                                   |
| --------- | ------------------------------------ | ------------------------------------------------------- |
| `903bafe` | simplify markdownlint-cli permission | `.claude/settings.local.json`                           |
| `1087623` | absolute paths in render-state.py    | `.claude/commands/what.md`, worktree submodule          |
| `3b1ff8e` | Open VSX publishing                  | `.github/workflows/publish-extension.yml`, `publish.sh` |
| `ecb6c4c` | serena line_ending config            | `.serena/project.yml`                                   |

Playwright plan commit `a1635ef` → move to worktree.

- [ ] **Step 1: Copy playwright plan to worktree**

```bash
cp docs/plans/2026-03-09-playwright-companion-ux.md \
   .claude/worktrees/playwright-companion-ux/docs/plans/
```

- [ ] **Step 2: Cherry-pick non-core commits to main**

```bash
git stash  # if uncommitted changes
git checkout main
git cherry-pick 903bafe 1087623 3b1ff8e ecb6c4c
git push origin main
```

- [ ] **Step 3: Rebase feature branch onto new main**

```bash
git checkout HYP-283-generic-mcp-styling-tools
git rebase main
# Conflicts unlikely — file sets don't overlap with HYP-283 commits
# Playwright plan commit (a1635ef) stays on branch — will be removed in step 4
git stash pop  # if stashed
```

- [ ] **Step 4: Remove playwright plan from feature branch**

```bash
git rm docs/plans/2026-03-09-playwright-companion-ux.md
git commit -m "chore: move playwright companion UX plan to dedicated worktree"
```

- [ ] **Step 5: Force push feature branch**

```bash
git push --force-with-lease
```

---

### Task 2: Create `VALID_TAMAGUI_STYLE_PROPS`

**Files:**

- Create: `lib/tamagui/style-props.ts`
- Test: `lib/tamagui/__tests__/style-props.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// lib/tamagui/__tests__/style-props.test.ts
import { describe, expect, it } from "bun:test";
import { isValidTamaguiStyleProp, VALID_TAMAGUI_STYLE_PROPS } from "../style-props";

describe("VALID_TAMAGUI_STYLE_PROPS", () => {
  it("should contain core layout properties", () => {
    for (const prop of ["display", "flex", "flexDirection", "alignItems", "justifyContent", "position"]) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("should contain spacing properties", () => {
    for (const prop of ["padding", "paddingTop", "margin", "marginLeft", "gap"]) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("should contain color properties", () => {
    for (const prop of ["backgroundColor", "color", "borderColor", "shadowColor"]) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("should contain sizing properties", () => {
    for (const prop of ["width", "height", "minWidth", "maxWidth", "minHeight", "maxHeight"]) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("should contain text properties", () => {
    for (const prop of ["fontSize", "fontWeight", "lineHeight", "textAlign", "fontFamily"]) {
      expect(VALID_TAMAGUI_STYLE_PROPS.has(prop)).toBe(true);
    }
  });

  it("should not contain unknown properties", () => {
    expect(VALID_TAMAGUI_STYLE_PROPS.has("foo")).toBe(false);
    expect(VALID_TAMAGUI_STYLE_PROPS.has("backgroundColour")).toBe(false);
    expect(VALID_TAMAGUI_STYLE_PROPS.has("class")).toBe(false);
  });
});

describe("isValidTamaguiStyleProp", () => {
  it("should return true for valid props", () => {
    expect(isValidTamaguiStyleProp("backgroundColor")).toBe(true);
    expect(isValidTamaguiStyleProp("flex")).toBe(true);
  });

  it("should return false for invalid props", () => {
    expect(isValidTamaguiStyleProp("foo")).toBe(false);
    expect(isValidTamaguiStyleProp("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — confirm it fails**

Run: `bun run test lib/tamagui/__tests__/style-props.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement**

```typescript
// lib/tamagui/style-props.ts
/**
 * @file Curated set of valid Tamagui/React Native style properties
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: Tamagui supports React Native style props + some web extras
 * Architecture: static set — for dynamic project palettes see HYP-XXX
 */

export const VALID_TAMAGUI_STYLE_PROPS: ReadonlySet<string> = new Set([
  // Layout
  "display",
  "flex",
  "flexDirection",
  "flexWrap",
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "alignItems",
  "alignSelf",
  "alignContent",
  "justifyContent",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "zIndex",
  "overflow",
  "overflowX",
  "overflowY",

  // Spacing
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "paddingHorizontal",
  "paddingVertical",
  "margin",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "marginHorizontal",
  "marginVertical",
  "gap",
  "rowGap",
  "columnGap",

  // Sizing
  "width",
  "height",
  "minWidth",
  "maxWidth",
  "minHeight",
  "maxHeight",
  "aspectRatio",

  // Colors
  "backgroundColor",
  "color",
  "borderColor",
  "borderTopColor",
  "borderRightColor",
  "borderBottomColor",
  "borderLeftColor",
  "shadowColor",
  "outlineColor",
  "textDecorationColor",

  // Borders
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "borderRadius",
  "borderTopLeftRadius",
  "borderTopRightRadius",
  "borderBottomLeftRadius",
  "borderBottomRightRadius",
  "borderStyle",

  // Text
  "fontSize",
  "fontWeight",
  "fontFamily",
  "fontStyle",
  "lineHeight",
  "letterSpacing",
  "textAlign",
  "textTransform",
  "textDecorationLine",
  "textDecorationStyle",
  "textShadowColor",
  "textShadowOffset",
  "textShadowRadius",

  // Effects
  "opacity",
  "elevation",
  "shadowOffset",
  "shadowOpacity",
  "shadowRadius",

  // Transform
  "transform",
  "transformOrigin",

  // Tamagui extras (web-compatible)
  "cursor",
  "pointerEvents",
  "userSelect",
  "animation",
]);

export function isValidTamaguiStyleProp(key: string): boolean {
  return VALID_TAMAGUI_STYLE_PROPS.has(key);
}
```

- [ ] **Step 4: Run test — confirm it passes**

Run: `bun run test lib/tamagui/__tests__/style-props.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
feat(lib): add VALID_TAMAGUI_STYLE_PROPS curated property set (HYP-283)
```

---

### Task 3: Add `transparent`/`current`/`inherit` to Tailwind palette

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/color-token-provider.ts:101-117`
- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `TailwindColorTokenProvider` describe in `color-token-provider.test.ts`:

```typescript
it("should include transparent, current, inherit in palette", () => {
  provider = getColorTokenProvider("tailwind");
  const colors = provider.listColors();
  expect(colors.find((c) => c.token === "transparent")).toBeTruthy();
  expect(colors.find((c) => c.token === "current")).toBeTruthy();
  expect(colors.find((c) => c.token === "inherit")).toBeTruthy();
});

it("should include transparent/current/inherit in families", () => {
  provider = getColorTokenProvider("tailwind");
  const families = provider.getFamilies();
  expect(families).toContain("transparent");
  expect(families).toContain("current");
  expect(families).toContain("inherit");
});

it("should exclude non-hex colors from nearest search results", () => {
  provider = getColorTokenProvider("tailwind");
  const nearest = provider.findNearest("#000000", 5);
  // transparent/current/inherit have Infinity distance — never in top results
  for (const n of nearest) {
    expect(n.token).not.toBe("transparent");
    expect(n.token).not.toBe("current");
    expect(n.token).not.toBe("inherit");
  }
});
```

- [ ] **Step 2: Run tests — confirm first two fail**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`
Expected: FAIL on 'transparent' not found

- [ ] **Step 3: Implement — add keyword colors to `buildTailwindPalette()`**

In `color-token-provider.ts`, modify `buildTailwindPalette()`:

```typescript
function buildTailwindPalette(): ColorEntry[] {
  const entries: ColorEntry[] = [
    { token: 'white', hex: '#ffffff' },
    { token: 'black', hex: '#000000' },
    { token: 'transparent', hex: 'transparent' },
    { token: 'current', hex: 'currentColor' },
    { token: 'inherit', hex: 'inherit' },
  ];
  // ... rest unchanged
```

- [ ] **Step 4: Run tests — confirm pass**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```
fix(mcp): add transparent/current/inherit to Tailwind color palette (HYP-283)
```

---

### Task 4: Derive TW prefix regex from map keys

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/color-token-provider.ts:197-224`

- [ ] **Step 1: Run existing tests — confirm green baseline**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`
Expected: PASS (existing normalizeStylesInput tests via TailwindStyleAdapter)

- [ ] **Step 2: Replace hardcoded regex with derived one**

In `color-token-provider.ts`, after `TW_PREFIX_TO_CSS` definition:

```typescript
// Derive regex from map keys — single source of truth
// Sort by length descending so longer prefixes match first (e.g. "px" before "p")
const TW_KEY_PREFIXES = Object.keys(TW_PREFIX_TO_CSS)
  .sort((a, b) => b.length - a.length)
  .join("|");
const TW_KEY_PREFIX_RE = new RegExp(`^(${TW_KEY_PREFIXES})-(.+)$`);

// Color-related prefixes for value normalization
// SYNC: subset of TW_PREFIX_TO_CSS — only prefixes that map to color CSS properties
const TW_COLOR_PREFIXES = ["bg", "text", "border", "ring", "shadow"];
const TW_VALUE_PREFIX_RE = new RegExp(`^(${TW_COLOR_PREFIXES.join("|")})-(.+)$`);
```

Then in `normalizeStylesInput`, replace the two hardcoded regex usages:

```typescript
function normalizeStylesInput(raw: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === "className" || key === "class") continue;

    const twPrefixMatch = key.match(TW_KEY_PREFIX_RE);
    if (twPrefixMatch && (!value || value === "true")) {
      const cssKey = TW_PREFIX_TO_CSS[twPrefixMatch[1]];
      if (cssKey) {
        result[cssKey] = twPrefixMatch[2];
        continue;
      }
    }

    const valueTwMatch = value.match(TW_VALUE_PREFIX_RE);
    if (valueTwMatch) {
      const cssKey = TW_PREFIX_TO_CSS[valueTwMatch[1]] ?? key;
      result[cssKey] = valueTwMatch[2];
      continue;
    }

    result[key] = value;
  }
  return result;
}
```

- [ ] **Step 3: Run tests — confirm still green**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`
Expected: PASS — behavior unchanged

- [ ] **Step 4: Commit**

```
refactor(mcp): derive TW prefix regex from map keys — single source of truth (HYP-283)
```

---

## Chunk 2: resolveStyles + registerTool

### Task 5: Add `resolveStyles` to `StyleAdapter` — TDD

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/color-token-provider.ts`
- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`

- [ ] **Step 1: Write failing tests for TailwindStyleAdapter.resolveStyles**

Add to `color-token-provider.test.ts`, inside `TailwindStyleAdapter` describe:

```typescript
describe("resolveStyles", () => {
  it("should parse className into CSS properties", () => {
    const adapter = getStyleAdapter("tailwind");
    const result = adapter.resolveStyles({ className: "flex flex-col gap-4" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.styles.display).toBe("flex");
      expect(result.styles.flexDirection).toBe("column");
      expect(result.styles.gap).toBe("1rem");
    }
  });

  it("should reject styleProps with actionable error", () => {
    const adapter = getStyleAdapter("tailwind");
    const result = adapter.resolveStyles({ styleProps: { backgroundColor: "red" } });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Tailwind");
      expect(result.error).toContain("className");
    }
  });

  it("should reject empty input", () => {
    const adapter = getStyleAdapter("tailwind");
    const result = adapter.resolveStyles({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("className");
    }
  });
});
```

- [ ] **Step 2: Write failing tests for TamaguiStyleAdapter.resolveStyles**

Add to `TamaguiStyleAdapter` describe:

```typescript
describe("resolveStyles", () => {
  it("should resolve $token values to hex", () => {
    const adapter = getStyleAdapter("tamagui");
    const result = adapter.resolveStyles({ styleProps: { backgroundColor: "$blue9" } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.styles.backgroundColor).toBe("#0090ff");
    }
  });

  it("should pass through non-token values", () => {
    const adapter = getStyleAdapter("tamagui");
    const result = adapter.resolveStyles({ styleProps: { padding: "16px" } });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.styles.padding).toBe("16px");
    }
  });

  it("should reject className with actionable error", () => {
    const adapter = getStyleAdapter("tamagui");
    const result = adapter.resolveStyles({ className: "flex gap-4" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Tamagui");
      expect(result.error).toContain("styleProps");
    }
  });

  it("should reject empty input", () => {
    const adapter = getStyleAdapter("tamagui");
    const result = adapter.resolveStyles({});
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("styleProps");
    }
  });

  it("should warn about unknown CSS properties", () => {
    const adapter = getStyleAdapter("tamagui");
    const result = adapter.resolveStyles({
      styleProps: { backgroundColor: "$blue9", foo: "bar", baz: "123" },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.styles.backgroundColor).toBe("#0090ff");
      expect(result.warning).toContain("foo");
      expect(result.warning).toContain("baz");
    }
  });
});
```

- [ ] **Step 3: Run tests — confirm they fail**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`
Expected: FAIL — `resolveStyles is not a function`

- [ ] **Step 4: Implement `resolveStyles` on `StyleAdapter` interface**

In `color-token-provider.ts`, update the interface:

```typescript
type ResolveInput = { className?: string; styleProps?: Record<string, string> };
type ResolveResult =
  | { success: true; styles: Record<string, string>; warning?: string }
  | { success: false; error: string };

export interface StyleAdapter {
  applyStyles(
    astService: AstService,
    filePath: string,
    elementId: string,
    styles: Record<string, string>,
  ): Promise<{ success: boolean; result?: string; warning?: string; error?: string }>;

  resolveStyles(params: ResolveInput): ResolveResult;
}
```

- [ ] **Step 5: Implement `TailwindStyleAdapter.resolveStyles`**

Add import at top of `color-token-provider.ts`:

```typescript
import { parseTailwindClasses } from "@lib/tailwind/parser";
```

Add method to `TailwindStyleAdapter`:

```typescript
// NOTE: parseTailwindClasses returns ParsedTailwindStyles (typed fields like position?: 'static' | 'relative')
// which is NOT assignable to Record<string, string>. Coerce via Object.entries, filtering out undefined.
resolveStyles(params: ResolveInput): ResolveResult {
  if (params.styleProps) {
    return {
      success: false,
      error: "This is a Tailwind project. Pass { className: 'flex gap-4 bg-blue-500' } instead of styleProps. styleProps is for Tamagui projects.",
    };
  }
  if (!params.className) {
    return {
      success: false,
      error: "className is required for Tailwind projects. Example: { className: 'flex gap-4 bg-blue-500' }",
    };
  }
  const parsed = parseTailwindClasses(params.className);
  const styles: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (v !== undefined) styles[k] = String(v);
  }
  return { success: true, styles };
}
```

- [ ] **Step 6: Implement `TamaguiStyleAdapter.resolveStyles`**

Add import:

```typescript
import { isValidTamaguiStyleProp } from "@lib/tamagui/style-props";
import { getTamaguiColorHex } from "@lib/tamagui/values";
```

Add method to `TamaguiStyleAdapter`:

```typescript
resolveStyles(params: ResolveInput): ResolveResult {
  if (params.className) {
    return {
      success: false,
      error: "This is a Tamagui project. Pass { styleProps: { backgroundColor: '$blue9' } } instead of className. className is for Tailwind projects.",
    };
  }
  if (!params.styleProps) {
    return {
      success: false,
      error: "styleProps is required for Tamagui projects. Example: { styleProps: { backgroundColor: '$blue9', padding: 16 } }",
    };
  }

  const unknownProps = Object.keys(params.styleProps).filter((k) => !isValidTamaguiStyleProp(k));
  const resolved: Record<string, string> = {};

  for (const [key, value] of Object.entries(params.styleProps)) {
    if (value.startsWith('$')) {
      const hex = getTamaguiColorHex(value);
      resolved[key] = hex ?? value;
    } else {
      resolved[key] = value;
    }
  }

  const warning =
    unknownProps.length > 0
      ? `Unknown style properties: ${unknownProps.join(', ')}. Valid Tamagui props include: backgroundColor, color, padding, display, flex, etc.`
      : undefined;

  return { success: true, styles: resolved, warning };
}
```

- [ ] **Step 7: Run tests — confirm pass**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/color-token-provider.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```
feat(mcp): add resolveStyles to StyleAdapter with strict validation (HYP-283)
```

---

### Task 6: Switch `hyper_get_element_styles` to `registerTool` + `z.union()`

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/styling-tools.ts`
- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/styling-tools.test.ts`

- [ ] **Step 1: Update test utility to capture `registerTool` handlers**

In `styling-tools.test.ts`, update `captureToolHandlers` to intercept both `registerTool` and `tool`:

```typescript
function captureToolHandlers(stateHub: StateHub): (name: string) => ToolHandler {
  const server = new McpServer({ name: "test", version: "0.0.1" });
  const handlers = new Map<string, ToolHandler>();

  // Capture registerTool calls (new API)
  const originalRegisterTool = server.registerTool.bind(server);
  server.registerTool = ((name: string, config: unknown, cb: ToolHandler) => {
    handlers.set(name, cb);
    return originalRegisterTool(name, config as Parameters<typeof originalRegisterTool>[1], cb);
  }) as typeof server.registerTool;

  // Capture server.tool calls (legacy, still used by suggest/list tools)
  const originalTool = server.tool.bind(server);
  server.tool = ((...args: unknown[]) => {
    const toolName = args[0] as string;
    const handler = args[args.length - 1] as ToolHandler;
    handlers.set(toolName, handler);
    return originalTool(...(args as Parameters<typeof originalTool>));
  }) as typeof server.tool;

  registerStylingTools(server, stateHub);

  return (name: string) => {
    const handler = handlers.get(name);
    if (!handler) throw new Error(`Tool "${name}" not registered`);
    return handler;
  };
}
```

- [ ] **Step 2: Update tests for new validation behavior**

Replace the existing `hyper_get_element_styles` tests. **Explicitly removed tests and why:**

- `'should return error when neither className nor styleProps provided'` → replaced by adapter-level validation tests in Task 5
- `'should pass through styleProps for non-Tamagui project'` → this was the silent echo bug. New test `'should reject styleProps for Tailwind project'` replaces it — passing styleProps to Tailwind is now a validation error, not a pass-through.

New tests:

```typescript
describe("hyper_get_element_styles", () => {
  it("should parse Tailwind className", async () => {
    const getHandler = captureToolHandlers(createMockStateHub("tailwind"));
    const handler = getHandler("hyper_get_element_styles");

    const result = await handler({ className: "flex flex-col gap-4" });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.display).toBe("flex");
    expect(parsed.flexDirection).toBe("column");
  });

  it("should resolve Tamagui tokens to hex", async () => {
    const getHandler = captureToolHandlers(createMockStateHub("tamagui"));
    const handler = getHandler("hyper_get_element_styles");

    const result = await handler({ styleProps: { backgroundColor: "$blue9" } });
    const parsed = JSON.parse(result.content[0].text);

    expect(parsed.backgroundColor).toBe("#0090ff");
  });

  it("should reject styleProps for Tailwind project", async () => {
    const getHandler = captureToolHandlers(createMockStateHub("tailwind"));
    const handler = getHandler("hyper_get_element_styles");

    const result = await handler({ styleProps: { backgroundColor: "red" } });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Tailwind");
    expect(result.content[0].text).toContain("className");
  });

  it("should reject className for Tamagui project", async () => {
    const getHandler = captureToolHandlers(createMockStateHub("tamagui"));
    const handler = getHandler("hyper_get_element_styles");

    const result = await handler({ className: "flex gap-4" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Tamagui");
    expect(result.content[0].text).toContain("styleProps");
  });

  it("should warn about unknown Tamagui props", async () => {
    const getHandler = captureToolHandlers(createMockStateHub("tamagui"));
    const handler = getHandler("hyper_get_element_styles");

    const result = await handler({ styleProps: { backgroundColor: "$blue9", foo: "bar" } });

    expect(result.isError).toBeUndefined();
    expect(result.content[0].text).toContain("#0090ff");
    // Warning about unknown prop in second content block
    expect(result.content).toHaveLength(2);
    expect(result.content[1].text).toContain("foo");
  });
});
```

- [ ] **Step 3: Run tests — confirm some fail (old behavior vs new expectations)**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/styling-tools.test.ts`
Expected: FAIL — old handler still passes through styleProps silently

- [ ] **Step 4: Rewrite `hyper_get_element_styles` registration**

In `styling-tools.ts`, replace the `server.tool('hyper_get_element_styles', ...)` block with:

```typescript
import { z } from "zod";
import { getStyleAdapter } from "./color-token-provider";

// hyper_get_element_styles — uses registerTool for z.union() schema
server.registerTool(
  "hyper_get_element_styles",
  {
    description:
      "Parse element styles into resolved CSS properties.\n" +
      "- Tailwind projects: pass className (e.g. {className: 'flex gap-4 bg-blue-500'})\n" +
      '- Tamagui projects: pass styleProps (e.g. {styleProps: {backgroundColor: "$blue9"}})\n' +
      "Use hyper_get_state to check the active framework if unsure.",
    inputSchema: z.union([
      z.object({ className: z.string().describe("Tailwind className string to parse") }).strict(),
      z
        .object({
          styleProps: z.record(z.string(), z.string()).describe("Tamagui style props as key-value pairs"),
        })
        .strict(),
    ]),
  },
  async (args: Record<string, unknown>) => {
    // z.union() produces { className: string } | { styleProps: Record<string, string> }
    // TypeScript can't destructure across union branches — use runtime narrowing
    const className = "className" in args ? (args.className as string) : undefined;
    const styleProps = "styleProps" in args ? (args.styleProps as Record<string, string>) : undefined;

    const adapter = getStyleAdapter(stateHub.state.projectUIKit);
    const result = adapter.resolveStyles({ className, styleProps });

    if (!result.success) {
      return { content: [{ type: "text" as const, text: result.error }], isError: true };
    }

    const content: Array<{ type: "text"; text: string }> = [
      { type: "text" as const, text: JSON.stringify(result.styles, null, 2) },
    ];
    if (result.warning) {
      content.push({ type: "text" as const, text: `Warning: ${result.warning}` });
    }
    return { content };
  },
);
```

Remove the `parseTailwindClasses` and `getTamaguiColorHex` imports from `styling-tools.ts` if they are no longer used there (they moved to the adapter).

- [ ] **Step 5: Update tool registration count test**

In `styling-tools.test.ts`, `registerStylingTools` describe — update to account for 1 `registerTool` call + 2 `tool` calls:

```typescript
describe("registerStylingTools", () => {
  it("should register 3 tools on the server", () => {
    const server = new McpServer({ name: "test", version: "0.0.1" });
    const stateHub = createMockStateHub();
    const toolNames: string[] = [];

    const originalTool = server.tool.bind(server);
    server.tool = ((...args: unknown[]) => {
      toolNames.push(args[0] as string);
      return originalTool(...(args as Parameters<typeof originalTool>));
    }) as typeof server.tool;

    const originalRegisterTool = server.registerTool.bind(server);
    server.registerTool = ((name: string, ...rest: unknown[]) => {
      toolNames.push(name);
      return originalRegisterTool(
        name,
        ...(rest as [Parameters<typeof originalRegisterTool>[1], Parameters<typeof originalRegisterTool>[2]]),
      );
    }) as typeof server.registerTool;

    registerStylingTools(server, stateHub);

    expect(toolNames).toEqual(["hyper_get_element_styles", "hyper_suggest_color_token", "hyper_list_color_tokens"]);
  });
});
```

- [ ] **Step 6: Run tests — confirm pass**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/styling-tools.test.ts`
Expected: PASS

- [ ] **Step 7: Run full test suite**

Run: `bun run test`
Expected: All pass

- [ ] **Step 8: Commit**

```
feat(mcp): switch hyper_get_element_styles to registerTool + z.union() schema (HYP-283)
```

---

## Chunk 3: Integration Tests + Cleanup

### Task 7: Add `[rgb(300, 0, 0)]` integration test

**Files:**

- Modify: `vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/styling-tools.test.ts`

- [ ] **Step 1: Add test in `hyper_suggest_color_token` describe**

```typescript
it("should handle bracket-wrapped out-of-range rgb", async () => {
  const getHandler = captureToolHandlers(createMockStateHub("tailwind"));
  const handler = getHandler("hyper_suggest_color_token");

  const result = await handler({ color: "[rgb(300, 0, 0)]" });

  // rgb(300,0,0) clamps to #ff0000, brackets stripped → finds nearest red token
  expect(result.isError).toBeUndefined();
  expect(result.content[0].text).toMatch(/red/i);
});
```

- [ ] **Step 2: Run test — confirm pass (this should already work)**

Run: `bun run test vscode-extension/hypercanvas-preview/src/mcp/tools/__tests__/styling-tools.test.ts`
Expected: PASS — `parseAnyColorToHex` already handles brackets + clamping

- [ ] **Step 3: Commit**

```
test(mcp): add integration test for bracket+clamp color parsing (HYP-283)
```

---

### Task 8: Create Linear issue for dynamic Tamagui palette

- [ ] **Step 1: Create Linear issue**

Title: `feat(mcp): load Tamagui color palette from project config`
Description:

```
Currently TAMAGUI_COLORS in lib/tamagui/values.ts is hardcoded Radix colors.
Projects with custom tamagui.config.ts get wrong color suggestions.

Needed:
1. Read tamagui.config.ts from project (via stateHub or AstService)
2. Parse createTamagui({ tokens: { color: {...} } }) — static analysis or eval
3. Cache with invalidation on file change (file watcher)
4. Fallback to hardcoded Radix if config not found/parseable
5. Invalidate _cachedAllColors when palette changes

Adapter architecture from HYP-283 is ready for this — TamaguiColorTokenProvider
just needs a dynamic data source instead of the static TAMAGUI_COLORS constant.
```

Labels: enhancement
Priority: normal

- [ ] **Step 2: Record ticket number in MEMORY.md deferred tickets**

---

### Task 9: Run full checks and lint

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: All pass (scope: client lib server shared vscode-extension)

- [ ] **Step 2: Run lint**

Run: `bun lint`
Expected: Clean

- [ ] **Step 3: Run type check**

Run: `cd vscode-extension/hypercanvas-preview && npx tsc --noEmit`
Expected: No errors in changed files

- [ ] **Step 4: Build extension**

Run `/ext` skill to build and install.
