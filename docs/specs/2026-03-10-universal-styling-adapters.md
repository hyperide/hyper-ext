# Universal Styling Adapters — Design Spec

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Ticket:** HYP-283
**Goal:** Make MCP styling tools framework-agnostic via adapter pattern with strict input validation.

---

## Context

`hyper_get_element_styles` currently uses if/else chains to handle Tailwind and Tamagui.
When an agent passes the wrong parameter (e.g. `styleProps` for a Tailwind project),
the tool silently echoes the input back — no error, no useful work done.

## Design Decisions

### 1. Extend `StyleAdapter` with `resolveStyles`

Add a read method alongside the existing `applyStyles` (write):

```typescript
interface StyleAdapter {
  applyStyles(
    astService: AstService, filePath: string, elementId: string,
    styles: Record<string, string>,
  ): Promise<{ success: boolean; result?: string; warning?: string; error?: string }>;

  resolveStyles(
    params: { className?: string; styleProps?: Record<string, string> },
  ): { success: true; styles: Record<string, string> }
     | { success: false; error: string };
}
```

Each adapter validates that the correct parameter was passed and returns actionable errors.

### 2. `z.union()` schema via `registerTool`

Replace `server.tool()` with `server.registerTool()` for `hyper_get_element_styles`:

```typescript
server.registerTool('hyper_get_element_styles', {
  description:
    'Parse element styles into CSS properties.\n'
    + '- Tailwind projects: pass className (e.g. "flex gap-4 bg-blue-500")\n'
    + '- Tamagui projects: pass styleProps (e.g. {backgroundColor: "$blue9"})\n'
    + 'Use hyper_get_state to check the active framework.',
  inputSchema: z.union([
    z.object({ className: z.string() }).strict(),
    z.object({ styleProps: z.record(z.string(), z.string()) }).strict(),
  ]),
}, handler);
```

Schema enforces exactly one parameter at the MCP level. Adapter validates
framework-parameter match at runtime.

### 3. Adapter validation behavior

**TailwindStyleAdapter.resolveStyles:**
- `styleProps` present → error: `"This is a Tailwind project. Pass { className: 'flex gap-4 ...' } instead of styleProps."`
- `className` missing → error: `"className is required for Tailwind projects."`
- `className` present → `parseTailwindClasses(className)`, return resolved styles

**TamaguiStyleAdapter.resolveStyles:**
- `className` present → error: `"This is a Tamagui project. Pass { styleProps: { backgroundColor: '$blue9' } } instead of className."`
- `styleProps` missing → error: `"styleProps is required for Tamagui projects."`
- `styleProps` present → validate prop names against `VALID_TAMAGUI_STYLE_PROPS`, resolve `$tokens` to hex, return

### 4. `VALID_TAMAGUI_STYLE_PROPS`

New file: `lib/tamagui/style-props.ts`

Curated `Set<string>` of ~60-80 valid Tamagui/React Native style properties:
- Layout: display, flex, flexDirection, alignItems, justifyContent, position, ...
- Spacing: padding, paddingTop, margin, marginLeft, gap, ...
- Sizing: width, height, minWidth, maxWidth, ...
- Colors: backgroundColor, color, borderColor, shadowColor, ...
- Text: fontSize, fontWeight, lineHeight, textAlign, ...
- Borders: borderWidth, borderRadius, borderStyle, ...
- Effects: opacity, overflow, zIndex, ...

Exports:
```typescript
export const VALID_TAMAGUI_STYLE_PROPS: ReadonlySet<string>;
export function isValidTamaguiStyleProp(key: string): boolean;
```

Unknown props in `styleProps` → warning (not error) listing invalid keys and
suggesting valid alternatives.

### 5. Tailwind palette: add CSS keyword colors

Add to `buildTailwindPalette()`:
```typescript
{ token: 'transparent', hex: 'transparent' },
{ token: 'current', hex: 'currentColor' },
{ token: 'inherit', hex: 'inherit' },
```

These appear in `listColors()`/`getFamilies()` but `findNearest()` naturally
excludes them (colorDistance returns Infinity for non-hex values).

### 6. Derive TW prefix regex from map keys

Replace hardcoded regex in `normalizeStylesInput` with:
```typescript
const TW_KEY_PREFIXES = Object.keys(TW_PREFIX_TO_CSS)
  .sort((a, b) => b.length - a.length).join('|');
const TW_KEY_PREFIX_RE = new RegExp(`^(${TW_KEY_PREFIXES})-(.+)$`);
```

Same pattern for value prefix regex (color-related subset: bg, text, border, ring, shadow).

## Files Changed

| File | Change |
|------|--------|
| `vscode-extension/.../color-token-provider.ts` | Add `resolveStyles` to interface + both adapters, derive regex |
| `vscode-extension/.../styling-tools.ts` | Switch to `registerTool` + `z.union()`, delegate to adapter |
| `lib/tamagui/style-props.ts` | **NEW** — `VALID_TAMAGUI_STYLE_PROPS` set |
| `vscode-extension/.../__tests__/styling-tools.test.ts` | Update tests for validation, add `[rgb(300,0,0)]` test |
| `vscode-extension/.../__tests__/color-token-provider.test.ts` | Add tests for resolveStyles, prop validation |

## Out of Scope

- **Dynamic Tamagui palette from project config** — separate Linear issue (read tamagui.config.ts, cache, file watcher)
- CSS property validation for Tailwind (Tailwind uses className string, not individual props)
