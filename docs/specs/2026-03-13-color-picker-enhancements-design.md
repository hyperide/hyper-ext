> **Companion to the master styles spec** (./2026-06-12-styles-system-master-spec.md). Still authoritative for the color-picker UI/UX implementation detail; cross-reference Part 12.5.
>
> **Consolidation update (HYP-722, D16):** the `COLOR_SEARCH_DISTANCE_THRESHOLD = 80` proposed in this
> spec is **RETIRED**. D16 is already RESOLVED on `main`: both call sites
> (`color-search-results.tsx:14`, `use-color-search.tsx:13`) read **40**, so the canonical value is
> **40**, not 80 — do NOT follow the 80 in this draft. See master §12.5 / D16 for the resolution, master
> §12 for the round-trip context, and §12.5 / D30 for the thin-coverage gap (component-level color-picker
> interaction coverage is still one test).

# Color Picker Enhancements Design

**Date**: 2026-03-13
**Status**: Draft
**Scope**: `client/components/ui/color-combobox.tsx`, `client/components/RightSidebar/`, `shared/utils/`

## Overview

Four enhancements to the ColorCombobox in RightSidebar:

1. **Multi-format color search** — parse hex, rgb, hsl, named CSS colors; filter palette by proximity; highlight exact matches
2. **Color tooltip with copy** — shadcn Tooltip on palette swatches with name, hex, rgb, hsl; click-to-copy, hotkeys
3. **Component color strip** — horizontal carousel of colors extracted from the open component file; tokens first, then hex
4. **Opacity input** — inline opacity field next to color input; visibility depends on token system capabilities

## Architecture: Modular Composition (Approach B)

Each feature is an independent module. ColorCombobox composes them. Each module is unit-testable in isolation.

### New Files

| File                                                 | Purpose                                                                                                                   |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `shared/utils/color.ts`                              | `hexToRgb`, `hexToHsl`, `rgbToHex`, `hslToHex`, `colorDistance` — extracted from `lib/tamagui/values.ts` and deduplicated |
| `client/components/ui/color-search-parser.ts`        | `parseColorInput()` — multi-format parsing via canvas API                                                                 |
| `client/components/ui/color-tooltip.tsx`             | `ColorTooltip` — interactive tooltip with copy and hotkeys                                                                |
| `client/components/ui/opacity-input.tsx`             | `OpacityInput` — compact percentage field                                                                                 |
| `client/components/ui/hooks/use-component-colors.ts` | `useComponentColors()` — extracts colors from client-side AST, re-scans on tree changes                                   |

### Modified Files

| File                                                      | Changes                                                                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `client/components/ui/color-combobox.tsx`                 | Integrate all 4 modules, wrap swatches with ColorTooltip, render ComponentColorStrip and OpacityInput. Replace local `hexToRgb`/`colorDistance` with imports from `shared/utils/color.ts` |
| `client/components/RightSidebar/sections/FillSection.tsx` | Remove standalone opacity field, pass opacity props into ColorCombobox                                                                                                                    |
| `client/components/RightSidebar/utils.ts`                 | Move `hexWithAlpha`, `parseHexWithAlpha` to `shared/utils/color.ts` if reusable                                                                                                           |
| `lib/tamagui/values.ts`                                   | Replace local `colorDistance`, `hexToRgb` with imports from `shared/utils/color.ts`                                                                                                       |

---

## Feature 1: Multi-Format Color Search

### Color Input Parsing

`parseColorInput(input: string): ParsedColorInput | null`

```ts
type ParsedColorInput = {
  hex: string; // normalized 6-digit hex (#rrggbb)
  original: string; // raw user input
  format: 'hex' | 'hex-short' | 'rgb' | 'hsl' | 'named';
};
```

**Supported formats:**

- `#0`, `#000`, `#000000`, `0`, `000`, `000000` — hex (with/without `#`, 1, 3, or 6 digits; `#a` → `#aaaaaa`)
- `rgb(r, g, b)`, `rgb(r g b)` — RGB
- `hsl(h, s%, l%)`, `hsl(h s l)` — HSL
- `red`, `black`, `blue`, etc. — any CSS named color
- Future formats (`oklch`, `lab`, `hwb`) — automatically supported

**Implementation:** Browser canvas API for parsing. No hardcoded color maps.

```ts
// Lazy-initialized singleton — avoids import-time `document` access (breaks tests/SSR)
let ctx: CanvasRenderingContext2D | null = null;
function getCtx(): CanvasRenderingContext2D {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')!;
  return ctx;
}

function cssColorToHex(input: string): string | null {
  const c = getCtx();
  // Two-sentinel approach to avoid collision with real colors
  c.fillStyle = '#010101';
  c.fillStyle = input;
  if (c.fillStyle !== '#010101') return c.fillStyle;

  // Input resolved to #010101 — verify it's intentional, not a failed parse
  c.fillStyle = '#020202';
  c.fillStyle = input;
  if (c.fillStyle !== '#020202') return c.fillStyle;

  return null; // canvas did not recognize the input
}
```

3-digit hex (`#abc`) is handled by canvas natively — it returns the expanded `#aabbcc`.
No manual expansion needed.

**Format detection:** regex-based pre-check to determine `format` field before passing to canvas:

- `/^#?[0-9a-f]$/i` → `hex-short` (1-digit, expanded to 6: `#a` → `#aaaaaa`)
- `/^#?[0-9a-f]{3}$/i` → `hex-short`
- `/^#?[0-9a-f]{6}$/i` → `hex`
- `/^rgb/i` → `rgb`
- `/^hsl/i` → `hsl`
- Otherwise if canvas resolves it → `named`

### Palette Filtering

When input is recognized as a color:

1. Convert to hex via `cssColorToHex()`
2. Compute `colorDistance()` (from `shared/utils/color.ts`) against each palette token
3. Filter to `distance < COLOR_SEARCH_DISTANCE_THRESHOLD` (tuning constant, initial value 80 — ~18% of max RGB distance 441; may need adjustment for perceptual accuracy in dark/light ranges), sort by distance ascending
4. **Exact match** (distance = 0): yellow background highlight on the matched token
5. Each result row shows: `token-name  #hex`
6. If matched via non-hex format: additionally show original format in the row, highlighted — e.g. `blue-500  #3b82f6  rgb(59,130,246)`

When input is NOT recognized as a color: fall back to current name-based filtering (substring match on token name/label).

---

## Feature 2: Color Tooltip with Copy

### Component: `ColorTooltip`

Wraps shadcn `Tooltip` (Radix UI). Renders around each color swatch in the palette grid.

**Tooltip content:**

```
blue-500                  ⎘ t
#3b82f6                   ⎘ #
rgb(59, 130, 246)         ⎘ r
hsl(217, 91%, 60%)        ⎘ h
```

Each row: value on the left, copy icon + hotkey hint (dimmed) on the right.

**Interactions:**

- **Click on row** — copies that value to clipboard, shows toast "Copied `<value>`"
- **Click on copy icon** — same as clicking the row
- **Hotkeys** (while tooltip is open AND search input is NOT focused):
  - `t` → copy token name
  - `#` (Shift+3) → copy hex
  - `r` → copy rgb(...)
  - `h` → copy hsl(...)
- **Toast** confirmation on copy — replacing toast (latest copy replaces previous, no spam stack)

**Behavior:**

- `delayDuration`: ~200ms (fast appearance)
- Interactive tooltip (Radix supports natively) — user can hover into tooltip to click/copy
- Click on the swatch itself still selects the color — tooltip doesn't intercept the primary click

### Conversion Utilities

`hexToHsl(hex: string): { h: number, s: number, l: number }` — added to `shared/utils/color.ts` alongside existing `hexToRgb`.

---

## Feature 3: Component Color Strip

### Color Extraction (Client-Side)

Pure function over the AST structure already loaded on the client (`root.metadata.astStructure`).
No server roundtrip needed — the AST is available after `parseComponent`.

`extractComponentColors(astStructure, tokenSystem): ColorEntry[]`

Traverses all AST nodes, extracts color values from style attributes (backgroundColor, color,
borderColor, boxShadow, etc.), resolves tokens to hex, deduplicates, counts occurrences.

```ts
type ColorEntry = {
  value: string; // token ($blue9, bg-blue-500) or hex (#3b82f6)
  hex: string; // always resolved hex for rendering
  isToken: boolean;
  count: number; // usage count in component
};
```

If the same color appears both as a token and as a raw hex literal, they are deduplicated by
resolved hex — shown once, with `isToken: true` (token form takes priority).

### Hook: `useComponentColors`

`useComponentColors(engine: CanvasEngine | null, componentPath, tokenSystem)`

When `engine` is `null`, returns empty array and does not subscribe to events.

- **Initial render:** calls `extractComponentColors()` over the current AST
- **Re-scan on `tree:change`:** full re-extraction (components are small enough — hundreds of nodes max, extraction is O(n) with minimal overhead)
- Result is memoized, only recomputed when `tree:change` fires or `componentPath` changes

**Sort order:** Tokens first (alphabetical), then hex values (by count descending).

### Prop Threading

`componentPath` is available in `RightSidebar` → passed to `FillSection` → passed to `ColorCombobox` as a new prop.

### UI

Horizontal strip above the palette grid in ColorCombobox:

- Small color circles/squares in a row
- Horizontal overflow: scroll via mouse wheel or drag (no visible scrollbar)
- Click on color → selects it as current value
- Hover → same `ColorTooltip` as palette swatches
- If component has no colors → strip is not rendered

---

## Feature 4: Opacity Input

### Component: `OpacityInput`

`client/components/ui/opacity-input.tsx` — compact input field, ~48px wide, suffix `%`, range 0–100.

### Layout

Positioned inline: `[color-input] [link/unlink button] [opacity-input]` — single row.

### Visibility Logic

```ts
const showOpacity =
  !isLinked || // hex mode — always show
  (isLinked && tokenSystemSupportsAlpha); // linked + system supports opacity (Tailwind)
```

`tokenSystemSupportsAlpha`: Tailwind → `true`, Tamagui → `false`. Passed as prop from ColorCombobox.

### Application

ColorCombobox always outputs hex-with-alpha via `hexWithAlpha(hex, opacity)` → `#rrggbbaa`.
The downstream Tailwind generator is responsible for converting to class syntax (`bg-blue-500/50`).
ColorCombobox does NOT emit class names — it works with hex values only.

For both backgroundColor and textColor, the flow is:

1. User changes opacity in `OpacityInput`
2. ColorCombobox calls `onChange(hexWithAlpha(currentHex, opacity))`
3. `syncStyleChange` receives the `#rrggbbaa` value
4. StyleAdapter / generator converts to the appropriate format for the token system

### Migration

Current standalone opacity field in FillSection moves into ColorCombobox. FillSection no longer
renders opacity separately — ColorCombobox manages its own OpacityInput via `onOpacityChange`
callback. Both `backgroundColor` and `textColor` ColorCombobox instances get their own OpacityInput.

---

## Shared Utility Extraction

### `shared/utils/color.ts`

Extracted from `lib/tamagui/values.ts` (and Tailwind equivalents):

- `hexToRgb(hex): { r, g, b }`
- `rgbToHex(r, g, b): string`
- `hexToHsl(hex): { h, s, l }`
- `hslToHex(h, s, l): string`
- `colorDistance(hex1, hex2): number` — Euclidean RGB distance
- `hexWithAlpha(hex, opacity): string` — from RightSidebar/utils.ts
- `parseHexWithAlpha(hex): { color, opacity }` — from RightSidebar/utils.ts

Original locations import from `shared/utils/color.ts` — no duplication.

---

## Testing Strategy

- **`shared/utils/color.ts`**: Unit tests for all conversion functions, edge cases (3-digit hex, alpha, out-of-range values)
- **`color-search-parser.ts`**: Unit tests for each format, invalid inputs, fallback behavior. Canvas API mocked in test env.
- **`ColorTooltip`**: Unit tests for hotkey handling, copy behavior. Integration test with mock clipboard API.
- **`extractComponentColors`**: Unit tests for AST traversal, deduplication, token/hex sorting, token-hex dedup by resolved value.
- **`useComponentColors`**: Unit tests for re-scan on tree:change events. Mock engine.
- **`OpacityInput`**: Unit tests for visibility logic, value clamping, format output.
- **`ColorCombobox` integration**: Verify all modules compose correctly — search filters palette, tooltips render, strip shows component colors, opacity appears/hides based on system.
