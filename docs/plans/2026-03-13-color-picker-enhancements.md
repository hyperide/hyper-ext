# Color Picker Enhancements Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enhance ColorCombobox with multi-format color search, interactive copy tooltips, component color strip, and inline opacity input.

**Architecture:** Modular composition — 4 independent modules (`ColorSearchParser`, `ColorTooltip`, `ComponentColorStrip`, `OpacityInput`) composed by `ColorCombobox`. Shared color utilities extracted to `shared/utils/color.ts`.

**Tech Stack:** React, TypeScript, Radix UI Tooltip, shadcn/ui, Tailwind CSS v3, bun:test

**Spec:** `docs/specs/2026-03-13-color-picker-enhancements-design.md`

---

## Chunk 1: Shared Color Utilities

### Task 1: Extract color utilities to `shared/utils/color.ts`

**Files:**

- Create: `shared/utils/color.ts` (directory `shared/utils/` does not exist — create with `mkdir -p shared/utils`)
- Create: `shared/utils/color.test.ts`
- Modify: `lib/tamagui/values.ts:282-298` (replace local `hexToRgb`, `colorDistance` with imports; keep re-exports so downstream consumers like VS Code extension don't break)
- Modify: `client/components/ui/color-combobox.tsx:93-109` (replace local `hexToRgb`, `colorDistance` with imports)
- Modify: `client/components/RightSidebar/utils.ts:7-49` (keep `hexToRgba` local, move `hexWithAlpha` + `parseHexWithAlpha`)

- [ ] **Step 0: Create directory**

Run: `mkdir -p shared/utils`

- [ ] **Step 1: Write failing tests for `hexToRgb`**

```ts
// shared/utils/color.test.ts
import { describe, expect, test } from "bun:test";
import { hexToRgb } from "./color";

describe("hexToRgb", () => {
  test("converts 6-digit hex", () => {
    expect(hexToRgb("#3b82f6")).toEqual({ r: 59, g: 130, b: 246 });
  });

  test("converts hex without #", () => {
    expect(hexToRgb("3b82f6")).toEqual({ r: 59, g: 130, b: 246 });
  });

  test("returns null for invalid input", () => {
    expect(hexToRgb("xyz")).toBeNull();
    expect(hexToRgb("")).toBeNull();
  });

  test("handles black and white", () => {
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
  });

  test("converts 3-digit hex", () => {
    expect(hexToRgb("#abc")).toEqual({ r: 170, g: 187, b: 204 });
    expect(hexToRgb("f00")).toEqual({ r: 255, g: 0, b: 0 });
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun run test shared/utils/color.test.ts`
Expected: FAIL — `Cannot find module './color'`

- [ ] **Step 3: Write failing tests for remaining functions**

```ts
// append to shared/utils/color.test.ts
import { colorDistance, hexToHsl, hexWithAlpha, hslToHex, hslToRgb, parseHexWithAlpha, rgbToHex } from "./color";

describe("rgbToHex", () => {
  test("converts rgb to hex", () => {
    expect(rgbToHex(59, 130, 246)).toBe("#3b82f6");
  });

  test("clamps values to 0-255", () => {
    expect(rgbToHex(-10, 300, 128)).toBe("#00ff80");
  });

  test("handles black and white", () => {
    expect(rgbToHex(0, 0, 0)).toBe("#000000");
    expect(rgbToHex(255, 255, 255)).toBe("#ffffff");
  });
});

describe("hslToRgb", () => {
  test("converts pure red", () => {
    expect(hslToRgb(0, 100, 50)).toEqual({ r: 255, g: 0, b: 0 });
  });

  test("converts pure green", () => {
    expect(hslToRgb(120, 100, 50)).toEqual({ r: 0, g: 255, b: 0 });
  });

  test("converts achromatic gray", () => {
    const { r, g, b } = hslToRgb(0, 0, 50);
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(r).toBeCloseTo(128, 0);
  });
});

describe("hslToHex", () => {
  test("converts hsl to hex", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
  });
});

describe("hexToHsl", () => {
  test("converts pure red", () => {
    const { h, s, l } = hexToHsl("#ff0000");
    expect(h).toBe(0);
    expect(s).toBe(100);
    expect(l).toBe(50);
  });

  test("converts blue-500", () => {
    const { h, s, l } = hexToHsl("#3b82f6");
    expect(h).toBeCloseTo(217, 0);
    expect(s).toBeCloseTo(91, 0);
    expect(l).toBeCloseTo(60, 0);
  });

  test("converts gray (achromatic)", () => {
    const { h, s, l } = hexToHsl("#808080");
    expect(h).toBe(0);
    expect(s).toBe(0);
    expect(l).toBeCloseTo(50, 0);
  });
});

describe("colorDistance", () => {
  test("identical colors return 0", () => {
    expect(colorDistance("#ff0000", "#ff0000")).toBe(0);
  });

  test("black and white return max-ish distance", () => {
    const d = colorDistance("#000000", "#ffffff");
    expect(d).toBeCloseTo(441.67, 0);
  });

  test("returns Infinity for invalid input", () => {
    expect(colorDistance("invalid", "#000000")).toBe(Infinity);
  });
});

describe("hexWithAlpha", () => {
  test("100% opacity adds ff", () => {
    expect(hexWithAlpha("#3b82f6", "100")).toBe("#3b82f6ff");
  });

  test("50% opacity adds 80", () => {
    expect(hexWithAlpha("#3b82f6", "50")).toBe("#3b82f680");
  });

  test("0% opacity adds 00", () => {
    expect(hexWithAlpha("#3b82f6", "0")).toBe("#3b82f600");
  });

  test("returns original for non-hex", () => {
    expect(hexWithAlpha("$blue9", "50")).toBe("$blue9");
  });
});

describe("parseHexWithAlpha", () => {
  test("parses #rrggbbaa format", () => {
    expect(parseHexWithAlpha("#3b82f680")).toEqual({ color: "#3b82f6", opacity: "50" });
  });

  test("parses #rrggbb format (no alpha)", () => {
    expect(parseHexWithAlpha("#3b82f6")).toEqual({ color: "#3b82f6", opacity: undefined });
  });

  test("returns original for non-hex", () => {
    expect(parseHexWithAlpha("$blue9")).toEqual({ color: "$blue9", opacity: undefined });
  });
});
```

- [ ] **Step 4: Implement `shared/utils/color.ts`**

```ts
// shared/utils/color.ts
/**
 * @file Shared color conversion and distance utilities
 *
 * Accessed via: Internal module, not exposed
 * Assumptions: hex inputs are 6-digit (#rrggbb) or 3-digit (#rgb)
 */

export function hexToRgb(h: string): { r: number; g: number; b: number } | null {
  // Try 6-digit first
  const result6 = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  if (result6) {
    return {
      r: Number.parseInt(result6[1], 16),
      g: Number.parseInt(result6[2], 16),
      b: Number.parseInt(result6[3], 16),
    };
  }
  // Try 3-digit
  const result3 = /^#?([a-f\d])([a-f\d])([a-f\d])$/i.exec(h);
  if (result3) {
    return {
      r: Number.parseInt(result3[1] + result3[1], 16),
      g: Number.parseInt(result3[2] + result3[2], 16),
      b: Number.parseInt(result3[3] + result3[3], 16),
    };
  }
  return null;
}

export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) =>
    Math.max(0, Math.min(255, Math.round(n)))
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const rgb = hexToRgb(hex);
  if (!rgb) return { h: 0, s: 0, l: 0 };

  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

export function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;

  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) {
    r = c;
    g = x;
  } else if (h < 120) {
    r = x;
    g = c;
  } else if (h < 180) {
    g = c;
    b = x;
  } else if (h < 240) {
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    b = c;
  } else {
    r = c;
    b = x;
  }

  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

export function hslToHex(h: number, s: number, l: number): string {
  const { r, g, b } = hslToRgb(h, s, l);
  return rgbToHex(r, g, b);
}

export function colorDistance(hex1: string, hex2: string): number {
  const rgb1 = hexToRgb(hex1);
  const rgb2 = hexToRgb(hex2);
  if (!rgb1 || !rgb2) return Infinity;
  return Math.sqrt((rgb1.r - rgb2.r) ** 2 + (rgb1.g - rgb2.g) ** 2 + (rgb1.b - rgb2.b) ** 2);
}

export function hexWithAlpha(hex: string, opacity: string): string {
  if (!hex || !hex.startsWith("#")) return hex;
  const opacityNum = Number.parseFloat(opacity);
  if (Number.isNaN(opacityNum)) return hex;
  const alpha = Math.round((opacityNum / 100) * 255);
  const alphaHex = alpha.toString(16).padStart(2, "0");
  const cleanHex = hex.slice(1).padEnd(6, "0").slice(0, 6);
  return `#${cleanHex}${alphaHex}`;
}

export function parseHexWithAlpha(hex: string): {
  color: string;
  opacity: string | undefined;
} {
  if (!hex || !hex.startsWith("#")) return { color: hex, opacity: undefined };
  if (hex.length === 9) {
    const color = hex.slice(0, 7);
    const alphaHex = hex.slice(7, 9);
    const alpha = Number.parseInt(alphaHex, 16);
    const opacity = Math.round((alpha / 255) * 100).toString();
    return { color, opacity };
  }
  return { color: hex, opacity: undefined };
}
```

- [ ] **Step 5: Run tests — verify they pass**

Run: `bun run test shared/utils/color.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Replace imports in `lib/tamagui/values.ts`**

At `lib/tamagui/values.ts`:

- Remove local `hexToRgb` function (lines 282-291) and `colorDistance` function (lines 293-298)
- Add import: `import { colorDistance, hexToRgb } from '@shared/utils/color';`
- If `@shared` alias doesn't exist, use relative path: `import { colorDistance, hexToRgb } from '../../shared/utils/color';`

Check tsconfig for path alias: `grep -r "shared" tsconfig*.json` — use whatever alias is configured.

- [ ] **Step 7: Replace local functions in `color-combobox.tsx`**

At `client/components/ui/color-combobox.tsx`:

- Remove local `hexToRgb` and `colorDistance` inside `findClosestColor` (lines 93-109)
- Add import: `import { colorDistance } from '@shared/utils/color';` (or appropriate alias)
- Update `findClosestColor` to call imported `colorDistance` directly

- [ ] **Step 8: Update `RightSidebar/utils.ts` imports**

At `client/components/RightSidebar/utils.ts`:

- Remove `hexWithAlpha` (lines 19-29) and `parseHexWithAlpha` (lines 35-49)
- Re-export from shared: `export { hexWithAlpha, parseHexWithAlpha } from '@shared/utils/color';`
- Keep `hexToRgba` local (it has different semantics, used only here)

This preserves all existing import paths (`import { hexWithAlpha } from '../utils'`).

- [ ] **Step 9: Run full test suite — verify no regressions**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 10: Run lint and typecheck**

Run: `biome check client/components/ui/color-combobox.tsx lib/tamagui/values.ts client/components/RightSidebar/utils.ts shared/utils/color.ts && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 11: Commit**

```bash
git add shared/utils/color.ts shared/utils/color.test.ts lib/tamagui/values.ts client/components/ui/color-combobox.tsx client/components/RightSidebar/utils.ts
git commit -m "refactor: extract shared color utilities to shared/utils/color.ts"
```

---

## Chunk 2: Multi-Format Color Search

### Task 2: Implement `parseColorInput` in `color-search-parser.ts`

**Files:**

- Create: `client/components/ui/color-search-parser.ts`
- Create: `client/components/ui/color-search-parser.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/components/ui/color-search-parser.test.ts
import { describe, expect, test } from "bun:test";
import { parseColorInput } from "./color-search-parser";

// No canvas mock needed — hex/rgb/hsl are parsed via regex.
// Named colors (canvas fallback) return null in test env (typeof document === 'undefined').

describe("parseColorInput", () => {
  test("parses 6-digit hex with #", () => {
    const result = parseColorInput("#3b82f6");
    expect(result).toEqual({ hex: "#3b82f6", original: "#3b82f6", format: "hex" });
  });

  test("parses 6-digit hex without #", () => {
    const result = parseColorInput("3b82f6");
    expect(result).toEqual({ hex: "#3b82f6", original: "3b82f6", format: "hex" });
  });

  test("parses 3-digit hex", () => {
    const result = parseColorInput("#abc");
    expect(result).toEqual({ hex: "#aabbcc", original: "#abc", format: "hex-short" });
  });

  test("parses 3-digit hex without #", () => {
    const result = parseColorInput("000");
    expect(result).toEqual({ hex: "#000000", original: "000", format: "hex-short" });
  });

  test("parses 1-digit hex (#a → #aaaaaa)", () => {
    expect(parseColorInput("#a")).toEqual({ hex: "#aaaaaa", original: "#a", format: "hex-short" });
    expect(parseColorInput("f")).toEqual({ hex: "#ffffff", original: "f", format: "hex-short" });
    expect(parseColorInput("#0")).toEqual({ hex: "#000000", original: "#0", format: "hex-short" });
  });

  test("parses rgb format", () => {
    const result = parseColorInput("rgb(59, 130, 246)");
    expect(result?.format).toBe("rgb");
    expect(result?.hex).toBe("#3b82f6");
  });

  test("parses rgb without commas", () => {
    const result = parseColorInput("rgb(59 130 246)");
    expect(result?.format).toBe("rgb");
    expect(result?.hex).toBe("#3b82f6");
  });

  test("parses hsl format", () => {
    const result = parseColorInput("hsl(0, 100%, 50%)");
    expect(result?.format).toBe("hsl");
    expect(result?.hex).toBe("#ff0000");
  });

  test("returns null for non-color text", () => {
    expect(parseColorInput("hello")).toBeNull();
    expect(parseColorInput("blue-500")).toBeNull(); // token name, not CSS color
  });

  test("returns null for empty input", () => {
    expect(parseColorInput("")).toBeNull();
    expect(parseColorInput("   ")).toBeNull();
  });
});
```

Note: Canvas API is not available in bun:test. The `cssColorToHex` function uses `document.createElement('canvas')`. For tests, we need to either:

- Mock `document.createElement` to return a fake canvas context
- Or extract the canvas call behind a testable interface

Recommended approach: `parseColorInput` handles hex and rgb/hsl via regex + math directly (no canvas needed for known formats). Canvas `cssColorToHex` is used only as a fallback for named/exotic CSS colors. Tests for named colors can be skipped in unit tests and verified manually in browser.

Adjust implementation to use regex parsing for known formats (hex, rgb, hsl) and canvas only for fallback (named colors).

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun run test client/components/ui/color-search-parser.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `color-search-parser.ts`**

```ts
// client/components/ui/color-search-parser.ts
/**
 * @file Multi-format color input parser
 *
 * Accessed via: Internal module, used by ColorCombobox search
 * Assumptions: runs in browser environment (canvas API for named color fallback)
 */

import { hslToRgb, rgbToHex } from "@shared/utils/color";

export type ColorFormat = "hex" | "hex-short" | "rgb" | "hsl" | "named";

export interface ParsedColorInput {
  hex: string;
  original: string;
  format: ColorFormat;
}

const HEX_6 = /^#?([0-9a-f]{6})$/i;
const HEX_3 = /^#?([0-9a-f]{3})$/i;
const HEX_1 = /^#?([0-9a-f])$/i;
const RGB_RE = /^rgb\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})\s*\)$/i;
const HSL_RE = /^hsl\(\s*(\d{1,3})\s*[,\s]\s*(\d{1,3})%?\s*[,\s]\s*(\d{1,3})%?\s*\)$/i;

/** Expand 3-digit hex to 6-digit: abc → aabbcc */
function expand3(short: string): string {
  return short
    .split("")
    .map((c) => c + c)
    .join("");
}

// hslToRgb is imported from @shared/utils/color — no local duplicate

/** Canvas-based CSS color resolver for named colors and exotic formats */
let canvasCtx: CanvasRenderingContext2D | null = null;

function cssColorToHex(input: string): string | null {
  if (typeof document === "undefined") return null;
  if (!canvasCtx) canvasCtx = document.createElement("canvas").getContext("2d");
  if (!canvasCtx) return null;

  canvasCtx.fillStyle = "#010101";
  canvasCtx.fillStyle = input;
  if (canvasCtx.fillStyle !== "#010101") return canvasCtx.fillStyle;

  canvasCtx.fillStyle = "#020202";
  canvasCtx.fillStyle = input;
  if (canvasCtx.fillStyle !== "#020202") return canvasCtx.fillStyle;

  return null;
}

export function parseColorInput(input: string): ParsedColorInput | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // 6-digit hex
  const hex6 = HEX_6.exec(trimmed);
  if (hex6) {
    return { hex: `#${hex6[1].toLowerCase()}`, original: trimmed, format: "hex" };
  }

  // 3-digit hex
  const hex3 = HEX_3.exec(trimmed);
  if (hex3) {
    return { hex: `#${expand3(hex3[1].toLowerCase())}`, original: trimmed, format: "hex-short" };
  }

  // 1-digit hex: #a → #aaaaaa
  const hex1 = HEX_1.exec(trimmed);
  if (hex1) {
    const ch = hex1[1].toLowerCase();
    return { hex: `#${ch.repeat(6)}`, original: trimmed, format: "hex-short" };
  }

  // rgb(r, g, b) or rgb(r g b)
  const rgb = RGB_RE.exec(trimmed);
  if (rgb) {
    const r = Number.parseInt(rgb[1], 10);
    const g = Number.parseInt(rgb[2], 10);
    const b = Number.parseInt(rgb[3], 10);
    if (r <= 255 && g <= 255 && b <= 255) {
      return { hex: rgbToHex(r, g, b), original: trimmed, format: "rgb" };
    }
  }

  // hsl(h, s%, l%) or hsl(h s l)
  const hsl = HSL_RE.exec(trimmed);
  if (hsl) {
    const h = Number.parseInt(hsl[1], 10);
    const s = Number.parseInt(hsl[2], 10);
    const l = Number.parseInt(hsl[3], 10);
    if (h <= 360 && s <= 100 && l <= 100) {
      const { r, g, b } = hslToRgb(h, s, l);
      return { hex: rgbToHex(r, g, b), original: trimmed, format: "hsl" };
    }
  }

  // Fallback: CSS named colors via canvas API
  const resolved = cssColorToHex(trimmed);
  if (resolved) {
    return { hex: resolved, original: trimmed, format: "named" };
  }

  return null;
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun run test client/components/ui/color-search-parser.test.ts`
Expected: ALL PASS (hex and rgb/hsl tests pass via regex; named color tests may need canvas mock or be browser-only)

- [ ] **Step 5: Commit**

```bash
git add client/components/ui/color-search-parser.ts client/components/ui/color-search-parser.test.ts
git commit -m "feat: add multi-format color input parser (hex, rgb, hsl, named)"
```

### Task 3: Integrate color search into ColorCombobox

**Files:**

- Modify: `client/components/ui/color-combobox.tsx:285-307` (search filter logic)
- Modify: `client/components/ui/color-combobox.tsx:395-423` (search results rendering)

- [ ] **Step 1: Update `filteredGroups` memo to use `parseColorInput`**

At `color-combobox.tsx`, add import:

```ts
import { parseColorInput } from "./color-search-parser";
import { colorDistance } from "@shared/utils/color";
```

Replace the `filteredGroups` memo (lines 285-307) with:

```ts
const COLOR_SEARCH_DISTANCE_THRESHOLD = 80;

const parsedSearchColor = React.useMemo(() => {
  return search.trim() ? parseColorInput(search.trim()) : null;
}, [search]);

const filteredGroups = React.useMemo(() => {
  if (!search.trim()) return colorGroups;

  // Color-based search: filter by proximity (precompute distances once)
  if (parsedSearchColor) {
    const filtered: Record<string, ColorOption[]> = {};
    for (const [groupName, options] of Object.entries(colorGroups)) {
      const withDistance = options
        .map((opt) => ({ ...opt, _distance: colorDistance(parsedSearchColor.hex, opt.hex) }))
        .filter((opt) => opt._distance < COLOR_SEARCH_DISTANCE_THRESHOLD);
      if (withDistance.length > 0) {
        withDistance.sort((a, b) => a._distance - b._distance);
        filtered[groupName] = withDistance;
      }
    }
    return filtered;
  }

  // Text-based search: filter by name (existing logic)
  const query = search.toLowerCase().trim();
  const filtered: Record<string, ColorOption[]> = {};
  for (const [groupName, options] of Object.entries(colorGroups)) {
    if (groupName.toLowerCase().includes(query)) {
      filtered[groupName] = options;
    } else {
      const matchingColors = options.filter(
        (opt) => opt.value.toLowerCase().includes(query) || opt.label.toLowerCase().includes(query),
      );
      if (matchingColors.length > 0) {
        filtered[groupName] = matchingColors;
      }
    }
  }
  return filtered;
}, [search, colorGroups, parsedSearchColor]);
```

- [ ] **Step 2: Update search results rendering for exact match highlighting**

In the search results rendering (lines 395-423), update the `CommandItem` content to show hex and highlight exact matches:

```tsx
{
  options.map((option) => {
    const distance = "_distance" in option ? (option as ColorOption & { _distance: number })._distance : Infinity;
    const isExact = parsedSearchColor && distance === 0;

    return (
      <CommandItem
        key={option.value}
        value={option.value}
        onSelect={() => handleSelect(option.value)}
        className={cn("flex items-center gap-2 cursor-pointer", isExact && "bg-yellow-100 dark:bg-yellow-900/30")}
      >
        <div className="w-4 h-4 rounded border border-border shrink-0" style={{ backgroundColor: option.hex }} />
        <span className="flex-1 text-xs">
          {tokenSystem === "tamagui" ? `$${option.label}` : option.label}
          <span className="text-muted-foreground ml-1">{option.hex}</span>
        </span>
        {/* Show matched format if search was non-hex */}
        {isExact &&
          parsedSearchColor &&
          parsedSearchColor.format !== "hex" &&
          parsedSearchColor.format !== "hex-short" && (
            <span className="text-xs bg-yellow-200 dark:bg-yellow-800 px-1 rounded">{parsedSearchColor.original}</span>
          )}
        {currentToken === option.value && <IconCheck className="w-4 h-4 text-green-600 shrink-0" stroke={2} />}
      </CommandItem>
    );
  });
}
```

- [ ] **Step 3: Run lint and typecheck**

Run: `biome check client/components/ui/color-combobox.tsx && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Manual test in browser**

Open editor, select element, open color picker. Type:

- `#ff0000` → should show red-500 area with yellow highlight
- `rgb(59, 130, 246)` → should show blue-500 with yellow highlight + `rgb(59, 130, 246)` badge
- `red` → should show red tokens (closest match)
- `blue` → should fall back to text search showing blue group

- [ ] **Step 5: Commit**

```bash
git add client/components/ui/color-combobox.tsx
git commit -m "feat: integrate multi-format color search into ColorCombobox"
```

---

## Chunk 3: Color Tooltip with Copy

### Task 4: Create `ColorTooltip` component

**Files:**

- Create: `client/components/ui/color-tooltip.tsx`
- Create: `client/components/ui/color-tooltip.test.ts`

- [ ] **Step 1: Write failing tests for tooltip copy logic**

```ts
// client/components/ui/color-tooltip.test.ts
import { describe, expect, test } from "bun:test";
import { formatColorValues } from "./color-tooltip";

describe("formatColorValues", () => {
  test("generates all 4 formats for a token", () => {
    const values = formatColorValues("blue-500", "#3b82f6");
    expect(values).toHaveLength(4);
    expect(values[0]).toEqual({ label: "blue-500", hotkey: "t", value: "blue-500" });
    expect(values[1]).toEqual({ label: "#3b82f6", hotkey: "#", value: "#3b82f6" });
    expect(values[2].hotkey).toBe("r");
    expect(values[2].value).toMatch(/^rgb\(/);
    expect(values[3].hotkey).toBe("h");
    expect(values[3].value).toMatch(/^hsl\(/);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun run test client/components/ui/color-tooltip.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `ColorTooltip`**

```tsx
// client/components/ui/color-tooltip.tsx
/**
 * @file Interactive color tooltip with copy-to-clipboard and keyboard shortcuts
 *
 * Accessed via: Internal component, used by ColorCombobox palette swatches
 * Assumptions: requires TooltipProvider ancestor, clipboard API available
 */

import { IconCopy } from "@tabler/icons-react";
import cn from "clsx";
import * as React from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { toast } from "@/hooks/use-toast";
import { hexToHsl, hexToRgb } from "@shared/utils/color";

interface ColorValue {
  label: string;
  value: string;
  hotkey: string;
}

interface ColorTooltipProps {
  tokenName: string;
  hex: string;
  children: React.ReactNode;
  /** Whether the search input currently has focus (disables hotkeys) */
  searchFocused?: boolean;
}

export function formatColorValues(tokenName: string, hex: string): ColorValue[] {
  const rgb = hexToRgb(hex);
  const hsl = hexToHsl(hex);

  return [
    { label: tokenName, value: tokenName, hotkey: "t" },
    { label: hex, value: hex, hotkey: "#" },
    {
      label: rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : hex,
      value: rgb ? `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` : hex,
      hotkey: "r",
    },
    {
      label: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      hotkey: "h",
    },
  ];
}

// TOAST_LIMIT=1 in use-toast.ts already prevents toast spam — new toast replaces previous
function copyToClipboard(value: string) {
  navigator.clipboard.writeText(value);
  toast({
    title: `Copied ${value}`,
    duration: 1500,
  });
}

export function ColorTooltip({ tokenName, hex, children, searchFocused }: ColorTooltipProps) {
  const [open, setOpen] = React.useState(false);
  const values = React.useMemo(() => formatColorValues(tokenName, hex), [tokenName, hex]);

  React.useEffect(() => {
    if (!open || searchFocused) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const entry = values.find((v) => v.hotkey === e.key);
      if (entry) {
        e.preventDefault();
        copyToClipboard(entry.value);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, searchFocused, values]);

  return (
    <Tooltip open={open} onOpenChange={setOpen} delayDuration={200}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="p-0 w-auto max-w-none" onPointerDownOutside={(e) => e.preventDefault()}>
        <div className="flex flex-col py-1">
          {values.map((entry) => (
            <button
              key={entry.hotkey}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                copyToClipboard(entry.value);
              }}
              className="flex items-center gap-3 px-2 py-0.5 hover:bg-accent text-xs cursor-pointer"
            >
              <span className="flex-1 text-left font-mono">{entry.label}</span>
              <span className="flex items-center gap-1 text-muted-foreground">
                <IconCopy className="w-3 h-3" stroke={1.5} />
                <kbd className="text-[10px]">{entry.hotkey}</kbd>
              </span>
            </button>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun run test client/components/ui/color-tooltip.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add client/components/ui/color-tooltip.tsx client/components/ui/color-tooltip.test.ts
git commit -m "feat: add ColorTooltip with copy-to-clipboard and hotkeys"
```

### Task 5: Wrap palette swatches with `ColorTooltip`

**Files:**

- Modify: `client/components/ui/color-combobox.tsx:460-474` (grid palette buttons)
- Modify: `client/components/ui/color-combobox.tsx` (add TooltipProvider wrapper)

- [ ] **Step 1: Add imports and state for search focus**

At top of `color-combobox.tsx`, add:

```ts
import { ColorTooltip } from "./color-tooltip";
import { TooltipProvider } from "@/components/ui/tooltip";
```

Add search focus tracking state inside component:

```ts
const [searchFocused, setSearchFocused] = React.useState(false);
```

- [ ] **Step 2: Track search input focus**

At the `CommandInput` (line 391), add focus tracking:

```tsx
<CommandInput
  placeholder="Search colors..."
  className="h-9"
  value={search}
  onValueChange={setSearch}
  onFocus={() => setSearchFocused(true)}
  onBlur={() => setSearchFocused(false)}
/>
```

- [ ] **Step 3: Wrap PopoverContent in `TooltipProvider`**

Wrap the `<PopoverContent>` inner content with `<TooltipProvider delayDuration={200}>`.

- [ ] **Step 4: Wrap grid swatch buttons with `ColorTooltip`**

At lines 460-474 (grid palette buttons), wrap each button:

```tsx
{
  options.map((option) => (
    <ColorTooltip
      key={option.value}
      tokenName={tokenSystem === "tamagui" ? `$${option.value}` : option.value}
      hex={option.hex}
      searchFocused={searchFocused}
    >
      <button
        type="button"
        onClick={() => handleSelect(option.value)}
        className={cn(
          "w-5 h-5 rounded border transition-all hover:scale-110 hover:z-10",
          currentToken === option.value
            ? "border-foreground ring-1 ring-foreground ring-offset-1 ring-offset-background"
            : "border-border hover:border-muted-foreground",
        )}
        style={{ backgroundColor: option.hex }}
      />
    </ColorTooltip>
  ));
}
```

- [ ] **Step 5: Run lint and typecheck**

Run: `biome check client/components/ui/color-combobox.tsx && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Manual test**

Open color picker, hover over a color swatch:

- Tooltip should appear in ~200ms
- Shows token name, hex, rgb, hsl
- Click row → copies, shows toast
- Press `t`, `#`, `r`, `h` → copies corresponding value (only when not typing in search)
- Hovering into tooltip works (interactive)

- [ ] **Step 7: Commit**

```bash
git add client/components/ui/color-combobox.tsx
git commit -m "feat: integrate ColorTooltip into palette swatches"
```

---

## Chunk 4: Component Color Strip

### Task 6: Implement `extractComponentColors` pure function

**Files:**

- Create: `client/components/ui/extract-component-colors.ts`
- Create: `client/components/ui/extract-component-colors.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/components/ui/extract-component-colors.test.ts
import { describe, expect, test } from "bun:test";
import { extractComponentColors } from "./extract-component-colors";
import type { ASTNode } from "@/lib/canvas-engine/types/ast";

const makeNode = (id: string, props?: Record<string, unknown>, children?: ASTNode[]): ASTNode => ({
  id,
  type: "div",
  props,
  children,
});

describe("extractComponentColors", () => {
  test("extracts backgroundColor from props.className (Tailwind)", () => {
    const ast: ASTNode[] = [makeNode("1", { className: "bg-blue-500 text-white p-4" })];
    const result = extractComponentColors(ast, "tailwind");
    expect(result.some((c) => c.value === "blue-500")).toBe(true);
    expect(result.some((c) => c.value === "white")).toBe(true);
  });

  test("deduplicates same color, counts occurrences", () => {
    const ast: ASTNode[] = [
      makeNode("1", { className: "bg-blue-500" }),
      makeNode("2", { className: "bg-blue-500 text-blue-500" }),
    ];
    const result = extractComponentColors(ast, "tailwind");
    const blue500 = result.find((c) => c.value === "blue-500");
    expect(blue500?.count).toBe(3);
  });

  test("sorts tokens first, then hex by count", () => {
    const ast: ASTNode[] = [makeNode("1", { className: "bg-[#ff0000]" }), makeNode("2", { className: "bg-blue-500" })];
    const result = extractComponentColors(ast, "tailwind");
    expect(result[0].isToken).toBe(true);
  });

  test("deduplicates token and hex with same resolved color", () => {
    const ast: ASTNode[] = [makeNode("1", { className: "bg-blue-500" }), makeNode("2", { className: "bg-[#3b82f6]" })];
    const result = extractComponentColors(ast, "tailwind");
    const blues = result.filter((c) => c.hex === "#3b82f6");
    expect(blues).toHaveLength(1);
    expect(blues[0].isToken).toBe(true);
  });

  test("returns empty for nodes without color props", () => {
    const ast: ASTNode[] = [makeNode("1", { className: "p-4 flex" })];
    const result = extractComponentColors(ast, "tailwind");
    expect(result).toHaveLength(0);
  });

  test("traverses children recursively", () => {
    const ast: ASTNode[] = [
      makeNode("1", { className: "bg-red-500" }, [
        makeNode("2", { className: "text-green-500" }, [makeNode("3", { className: "border-blue-500" })]),
      ]),
    ];
    const result = extractComponentColors(ast, "tailwind");
    expect(result).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `bun run test client/components/ui/extract-component-colors.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `extractComponentColors`**

```ts
// client/components/ui/extract-component-colors.ts
/**
 * @file Extracts color values from AST nodes for component color strip
 *
 * Accessed via: Internal module, used by useComponentColors hook
 * Assumptions: AST is already loaded on client from parseComponent
 */

import type { ASTNode } from "@/lib/canvas-engine/types/ast";
import { getColorHex } from "@/lib/tailwind/tailwind-values";
import { getTamaguiColorHex } from "@lib/tamagui/values";
import type { TokenSystem } from "./color-combobox";

export interface ColorEntry {
  value: string;
  hex: string;
  isToken: boolean;
  count: number;
}

/** Tailwind color class prefixes that carry color values */
const TW_COLOR_PREFIXES = [
  "bg-",
  "text-",
  "border-",
  "shadow-",
  "ring-",
  "outline-",
  "accent-",
  "fill-",
  "stroke-",
  "decoration-",
];

/** Tamagui props that carry color values */
const TAMAGUI_COLOR_PROPS = ["backgroundColor", "color", "borderColor", "shadowColor"];

function extractTailwindColors(className: string): Array<{ value: string; hex: string; isToken: boolean }> {
  const classes = className.split(/\s+/);
  const colors: Array<{ value: string; hex: string; isToken: boolean }> = [];

  for (const cls of classes) {
    // Strip state variants (hover:, focus:, etc.)
    const base = cls.includes(":") ? cls.split(":").pop()! : cls;

    // Arbitrary color: bg-[#ff0000]
    const arbMatch =
      /^(?:bg|text|border|shadow|ring|outline|accent|fill|stroke|decoration)-\[#([0-9a-fA-F]{3,6})\]$/.exec(base);
    if (arbMatch) {
      let hex = arbMatch[1];
      if (hex.length === 3)
        hex = hex
          .split("")
          .map((c) => c + c)
          .join("");
      colors.push({ value: `#${hex}`, hex: `#${hex.toLowerCase()}`, isToken: false });
      continue;
    }

    // Token color: bg-blue-500, text-white, border-red-200, etc.
    for (const prefix of TW_COLOR_PREFIXES) {
      if (!base.startsWith(prefix)) continue;
      const token = base.slice(prefix.length);
      // Strip opacity modifier: blue-500/50 → blue-500
      const tokenClean = token.includes("/") ? token.split("/")[0] : token;
      const hex = getColorHex(tokenClean);
      if (hex) {
        colors.push({ value: tokenClean, hex, isToken: true });
      }
      break;
    }
  }

  return colors;
}

function extractTamaguiColors(props: Record<string, unknown>): Array<{ value: string; hex: string; isToken: boolean }> {
  const colors: Array<{ value: string; hex: string; isToken: boolean }> = [];

  for (const prop of TAMAGUI_COLOR_PROPS) {
    const val = props[prop];
    if (typeof val !== "string" || !val) continue;

    if (val.startsWith("$")) {
      const hex = getTamaguiColorHex(val);
      if (hex) colors.push({ value: val, hex, isToken: true });
    } else if (val.startsWith("#")) {
      colors.push({ value: val, hex: val, isToken: false });
    }
  }

  return colors;
}

function traverseAST(
  nodes: ASTNode[],
  tokenSystem: TokenSystem,
  accumulator: Map<string, ColorEntry & { elementIds: Set<string> }>,
) {
  for (const node of nodes) {
    let extracted: Array<{ value: string; hex: string; isToken: boolean }> = [];

    if (tokenSystem === "tailwind" && typeof node.props?.className === "string") {
      extracted = extractTailwindColors(node.props.className);
    } else if (tokenSystem === "tamagui" && node.props) {
      extracted = extractTamaguiColors(node.props);
    }

    for (const color of extracted) {
      const key = color.hex.toLowerCase();
      const existing = accumulator.get(key);
      if (existing) {
        existing.count++;
        existing.elementIds.add(node.id);
        // Token form takes priority over raw hex
        if (color.isToken && !existing.isToken) {
          existing.value = color.value;
          existing.isToken = true;
        }
      } else {
        accumulator.set(key, {
          ...color,
          count: 1,
          elementIds: new Set([node.id]),
        });
      }
    }

    if (node.children) {
      traverseAST(node.children, tokenSystem, accumulator);
    }
  }
}

export function extractComponentColors(astNodes: ASTNode[], tokenSystem: TokenSystem): ColorEntry[] {
  const accumulator = new Map<string, ColorEntry & { elementIds: Set<string> }>();
  traverseAST(astNodes, tokenSystem, accumulator);

  const entries = Array.from(accumulator.values()).map(({ elementIds: _, ...entry }) => entry);

  // Sort: tokens first (alphabetical), then hex (by count desc)
  return entries.sort((a, b) => {
    if (a.isToken !== b.isToken) return a.isToken ? -1 : 1;
    if (a.isToken && b.isToken) return a.value.localeCompare(b.value);
    return b.count - a.count;
  });
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun run test client/components/ui/extract-component-colors.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add client/components/ui/extract-component-colors.ts client/components/ui/extract-component-colors.test.ts
git commit -m "feat: add extractComponentColors for AST color extraction"
```

### Task 7: Create `useComponentColors` hook

**Files:**

- Create: `client/components/ui/hooks/use-component-colors.ts` (directory `client/components/ui/hooks/` does not exist — create with `mkdir -p client/components/ui/hooks`)

- [ ] **Step 0: Create directory**

Run: `mkdir -p client/components/ui/hooks`

- [ ] **Step 1: Create the hook**

```ts
// client/components/ui/hooks/use-component-colors.ts
/**
 * @file Hook to extract and maintain color list from component AST
 *
 * Accessed via: Internal hook, used by ColorCombobox
 * Assumptions: engine may be null (VS Code context), AST available via root.metadata.astStructure
 */

import { useEffect, useMemo, useState } from "react";
import type { CanvasEngine } from "@/lib/canvas-engine/core/CanvasEngine";
import type { TokenSystem } from "../color-combobox";
import { type ColorEntry, extractComponentColors } from "../extract-component-colors";

export function useComponentColors(
  engine: CanvasEngine | null,
  componentPath: string | null,
  tokenSystem: TokenSystem,
): ColorEntry[] {
  const [treeVersion, setTreeVersion] = useState(0);

  useEffect(() => {
    if (!engine) return;

    const handler = () => setTreeVersion((v) => v + 1);
    engine.events.on("tree:change", handler);
    return () => {
      engine.events.off("tree:change", handler);
    };
  }, [engine]);

  return useMemo(() => {
    if (!engine || !componentPath) return [];

    const root = engine.getRoot();
    const astStructure = root?.metadata?.astStructure as import("@/lib/canvas-engine/types/ast").ASTNode[] | undefined;
    if (!astStructure) return [];

    return extractComponentColors(astStructure, tokenSystem);
    // treeVersion in deps triggers recalculation on tree:change
    // biome-ignore lint/correctness/useExhaustiveDependencies: treeVersion triggers recalculation on tree:change
  }, [engine, componentPath, tokenSystem, treeVersion]);
}
```

- [ ] **Step 2: Commit**

```bash
git add client/components/ui/hooks/use-component-colors.ts
git commit -m "feat: add useComponentColors hook with tree:change re-scan"
```

### Task 8: Create `ComponentColorStrip` UI and integrate into ColorCombobox

**Files:**

- Modify: `client/components/ui/color-combobox.tsx` (add strip above palette, pass componentPath + engine props)
- Modify: `client/components/RightSidebar/sections/FillSection.tsx` (pass componentPath and engine)
- Modify: `client/components/ui/fill-picker.tsx` (pass through componentPath and engine)

- [ ] **Step 1: Add props to `ColorComboboxProps`**

At `color-combobox.tsx`, add to `ColorComboboxProps` interface (line 20):

```ts
/** Canvas engine instance for extracting component colors */
engine?: import('@/lib/canvas-engine/core/CanvasEngine').CanvasEngine | null;
/** Path to the currently open component file */
componentPath?: string | null;
```

- [ ] **Step 2: Add strip UI inside PopoverContent**

After `CommandInput` (line 391), before `CommandList`, render the strip:

```tsx
// Inside the component, use the hook:
const componentColors = useComponentColors(engine ?? null, componentPath ?? null, tokenSystem);

// In the render, after CommandInput, before CommandList:
{
  componentColors.length > 0 && (
    <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border overflow-x-auto scrollbar-hide">
      {componentColors.map((entry) => (
        <ColorTooltip
          key={entry.hex}
          tokenName={entry.isToken ? entry.value : entry.hex}
          hex={entry.hex}
          searchFocused={searchFocused}
        >
          <button
            type="button"
            onClick={() => {
              if (entry.isToken) {
                handleSelect(entry.value);
              } else {
                onChange(entry.hex);
                setOpen(false);
              }
            }}
            className={cn(
              "w-5 h-5 rounded-full border shrink-0 transition-all hover:scale-110",
              currentHex === entry.hex
                ? "border-foreground ring-1 ring-foreground ring-offset-1 ring-offset-background"
                : "border-border hover:border-muted-foreground",
            )}
            style={{ backgroundColor: entry.hex }}
          />
        </ColorTooltip>
      ))}
    </div>
  );
}
```

Add import at top:

```ts
import { useComponentColors } from "./hooks/use-component-colors";
```

- [ ] **Step 3: Thread `engine` and `componentPath` from FillSection**

At `FillSection.tsx`, add props to interface:

```ts
engine?: import('@/lib/canvas-engine/core/CanvasEngine').CanvasEngine | null;
componentPath?: string | null;
```

Pass through to `FillPicker` and `ColorCombobox`:

```tsx
<FillPicker
  ...
  engine={engine}
  componentPath={componentPath}
/>
...
<ColorCombobox
  ...
  engine={engine}
  componentPath={componentPath}
/>
```

At `fill-picker.tsx`, add same props and pass through to `ColorCombobox`.

At `RightSidebar.tsx`, find where `FillSection` is rendered and pass `engine` and `componentPath`:

```tsx
<FillSection
  ...
  engine={engine}
  componentPath={componentPath}
/>
```

- [ ] **Step 4: Add CSS for hidden scrollbar**

Add to the div with `overflow-x-auto`:

```css
/* scrollbar-hide utility — if not in Tailwind config, use inline style */
```

If `scrollbar-hide` is not a Tailwind utility, use inline style:

```tsx
style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
```

And add `[&::-webkit-scrollbar]:hidden` to className.

- [ ] **Step 5: Run lint and typecheck**

Run: `biome check client/components/ui/color-combobox.tsx client/components/ui/fill-picker.tsx client/components/RightSidebar/sections/FillSection.tsx && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Manual test**

Open editor, select element in a component with colors. Open color picker:

- Strip should show above palette with circles for each unique color
- Tokens first, then hex
- Hover shows tooltip, click selects color
- Modifying a color and reopening should reflect updated colors

- [ ] **Step 7: Commit**

```bash
git add client/components/ui/color-combobox.tsx client/components/ui/fill-picker.tsx client/components/RightSidebar/sections/FillSection.tsx client/components/RightSidebar/RightSidebar.tsx
git commit -m "feat: add component color strip above palette in ColorCombobox"
```

---

## Chunk 5: Opacity Input

### Task 9: Create `OpacityInput` component

**Files:**

- Create: `client/components/ui/opacity-input.tsx`
- Create: `client/components/ui/opacity-input.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
// client/components/ui/opacity-input.test.ts
import { describe, expect, test } from "bun:test";
import { shouldShowOpacity } from "./opacity-input";

describe("shouldShowOpacity", () => {
  test("shows in unlinked (hex) mode regardless of system", () => {
    expect(shouldShowOpacity(false, "tailwind")).toBe(true);
    expect(shouldShowOpacity(false, "tamagui")).toBe(true);
  });

  test("shows in linked mode for Tailwind (supports alpha)", () => {
    expect(shouldShowOpacity(true, "tailwind")).toBe(true);
  });

  test("hides in linked mode for Tamagui (no alpha support)", () => {
    expect(shouldShowOpacity(true, "tamagui")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `bun run test client/components/ui/opacity-input.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `OpacityInput`**

```tsx
// client/components/ui/opacity-input.tsx
/**
 * @file Compact opacity percentage input for color picker
 *
 * Accessed via: Internal component, rendered inline in ColorCombobox
 * Assumptions: opacity is 0-100 integer scale
 */

import * as React from "react";
import { Input } from "@/components/ui/input";
import type { TokenSystem } from "./color-combobox";

interface OpacityInputProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

const TOKEN_SYSTEM_SUPPORTS_ALPHA: Record<TokenSystem, boolean> = {
  tailwind: true,
  tamagui: false,
};

export function shouldShowOpacity(isLinked: boolean, tokenSystem: TokenSystem): boolean {
  return !isLinked || TOKEN_SYSTEM_SUPPORTS_ALPHA[tokenSystem];
}

export function OpacityInput({ value, onChange, className }: OpacityInputProps) {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value.replace("%", "").trim();
    const num = Number.parseInt(raw, 10);
    if (raw === "" || raw === "-") {
      onChange("");
      return;
    }
    if (!Number.isNaN(num)) {
      onChange(`${Math.max(0, Math.min(100, num))}`);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const increment = e.key === "ArrowUp" ? 1 : -1;
    const step = e.shiftKey || e.altKey ? 10 : 1;
    const num = Number.parseFloat(value || "100") || 0;
    const newNum = Math.max(0, Math.min(100, num + increment * step));
    onChange(`${newNum}`);
  };

  return (
    <div className={`h-6 w-14 px-2 bg-muted rounded flex items-center ${className || ""}`}>
      <Input
        type="text"
        value={`${value || "100"}%`}
        placeholder="100%"
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        className="h-auto border-0 bg-transparent !text-[11px] text-foreground p-0 focus-visible:ring-0 focus-visible:ring-offset-0 flex-1 text-center"
      />
    </div>
  );
}
```

- [ ] **Step 4: Run tests — verify they pass**

Run: `bun run test client/components/ui/opacity-input.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add client/components/ui/opacity-input.tsx client/components/ui/opacity-input.test.ts
git commit -m "feat: add OpacityInput component with visibility logic"
```

### Task 10: Integrate `OpacityInput` into `ColorCombobox` and migrate from `FillSection`

**Files:**

- Modify: `client/components/ui/color-combobox.tsx` (add OpacityInput, new props)
- Modify: `client/components/ui/fill-picker.tsx` (pass through opacity props)
- Modify: `client/components/RightSidebar/sections/FillSection.tsx` (remove standalone opacity, pass opacity props)
- Modify: `client/components/RightSidebar/RightSidebar.tsx` (add textOpacity state, preserve text opacity on parse)

**Responsibility boundary:** ColorCombobox only calls `onChange(hexWithAlpha(...))` when opacity changes.
The parent does NOT need a separate `onOpacityChange` — opacity is encoded in the hex value.
The parent tracks the opacity state separately only for reading/displaying current value.

- [ ] **Step 1: Add opacity props to `ColorComboboxProps`**

```ts
// Add to ColorComboboxProps interface:
/** Current opacity value (0-100), for display in OpacityInput */
opacity?: string;
/** Callback when opacity changes — parent updates its opacity state */
onOpacityChange?: (value: string) => void;
```

- [ ] **Step 2: Render OpacityInput inside ColorCombobox**

At the end of the component render (before the link/unlink button, line 508-509), replace the `{beforeUnlinkSlot}` with:

```tsx
{
  /* Opacity input */
}
{
  shouldShowOpacity(isLinked, tokenSystem) && opacity !== undefined && onOpacityChange && (
    <OpacityInput
      value={opacity}
      onChange={(newOpacity) => {
        onOpacityChange(newOpacity);
        if (currentHex?.startsWith("#")) {
          onChange(hexWithAlpha(currentHex, newOpacity || "100"));
        }
      }}
    />
  );
}
{
  /* Legacy slot for non-opacity content */
}
{
  beforeUnlinkSlot;
}
```

Add imports:

```ts
import { OpacityInput, shouldShowOpacity } from "./opacity-input";
import { hexWithAlpha } from "@shared/utils/color";
```

- [ ] **Step 3: Add `textOpacity` state to RightSidebar**

At `RightSidebar.tsx`, add state next to existing `fillOpacity` (line 347):

```ts
const [textOpacity, setTextOpacity] = useState("");
```

At line 741 where textColor is parsed, preserve opacity (currently discarded):

```ts
if (ep.color) {
  const { color, opacity: parsedTextOpacity } = parseHexWithAlpha(ep.color);
  setTextColor(color);
  setTextOpacity(parsedTextOpacity ?? "100");
}
```

- [ ] **Step 4: Update FillSection props and usage**

Add to `FillSectionProps`:

```ts
textOpacity: string;
onTextOpacityChange: (value: string) => void;
engine?: import('@/lib/canvas-engine/core/CanvasEngine').CanvasEngine | null;
componentPath?: string | null;
```

For background color — pass opacity props to `FillPicker`:

```tsx
<FillPicker
  ...
  opacity={fillOpacity}
  onOpacityChange={onFillOpacityChange}
/>
```

Remove the `beforeUnlinkSlot` prop (lines 120-135).
Remove `handleFillOpacityChange` (lines 71-78) and `handleFillOpacityKeyDown` (lines 80-92).

For text color — add opacity to `ColorCombobox`:

```tsx
<ColorCombobox
  value={textColor || ""}
  onChange={(val) => {
    onTextColorChange(val);
    syncStyleChange("color", val);
  }}
  opacity={textOpacity}
  onOpacityChange={onTextOpacityChange}
  inputPlaceholder="000000"
  className="flex-1"
  tokenSystem={projectUIKit === "tamagui" ? "tamagui" : "tailwind"}
  engine={engine}
  componentPath={componentPath}
/>
```

- [ ] **Step 5: Update `fill-picker.tsx` to pass opacity props through**

Add `opacity` and `onOpacityChange` to `FillPicker` props and pass through to `ColorCombobox`.

- [ ] **Step 6: Pass new props from RightSidebar to FillSection**

At `RightSidebar.tsx`, where `FillSection` is rendered:

```tsx
<FillSection
  ...
  textOpacity={textOpacity}
  onTextOpacityChange={setTextOpacity}
  engine={engine}
  componentPath={componentPath}
/>
```

- [ ] **Step 6: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 7: Run lint and typecheck**

Run: `biome check client/components/ui/color-combobox.tsx client/components/ui/fill-picker.tsx client/components/RightSidebar/sections/FillSection.tsx && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 8: Manual test**

1. Open editor, select element with background color
2. Verify opacity field appears next to color input and link button
3. Change opacity → color updates with alpha
4. Switch to Tamagui token mode → opacity field hidden
5. Switch to Tailwind token mode → opacity field visible
6. Unlink from token → opacity field visible
7. Check text color also has opacity field

- [ ] **Step 9: Commit**

```bash
git add client/components/ui/color-combobox.tsx client/components/ui/fill-picker.tsx client/components/RightSidebar/sections/FillSection.tsx client/components/RightSidebar/RightSidebar.tsx
git commit -m "feat: integrate OpacityInput into ColorCombobox, migrate from FillSection"
```

---

## Chunk 6: Final Integration & Cleanup

### Task 11: Final integration test and cleanup

**Files:**

- All modified files from previous tasks

- [ ] **Step 1: Run full test suite**

Run: `bun run test`
Expected: ALL PASS

- [ ] **Step 2: Run full lint**

Run: `bun run lint`
Expected: No errors or warnings

- [ ] **Step 3: Verify no stale imports**

Check that old direct imports of `hexToRgb`/`colorDistance` from `lib/tamagui/values.ts` don't exist elsewhere:

```bash
grep -r "from.*tamagui/values.*hexToRgb\|from.*tamagui/values.*colorDistance" client/ --include="*.ts" --include="*.tsx"
```

Only `lib/tamagui/values.ts` itself should import from `shared/utils/color.ts`.

- [ ] **Step 4: Verify `beforeUnlinkSlot` is no longer used for opacity**

```bash
grep -r "beforeUnlinkSlot" client/ --include="*.ts" --include="*.tsx"
```

Should only appear in `ColorComboboxProps` definition (kept for backward compatibility if other uses exist) and the rendering line. If no other consumers use it, consider removing the prop entirely.

- [ ] **Step 5: Manual end-to-end test**

Full flow test:

1. Open editor with a Tailwind project
2. Select a component element
3. Open background color picker
4. **Search**: Type `rgb(239, 68, 68)` → see red-500 highlighted yellow with rgb badge
5. **Search**: Type `red` → text search shows red group
6. **Search**: Type `#ef4444` → red-500 highlighted yellow
7. **Tooltip**: Hover any swatch → tooltip with 4 formats + copy icons with hotkeys
8. **Tooltip copy**: Click `#3b82f6` row → toast "Copied #3b82f6"
9. **Tooltip hotkey**: Hover swatch, press `r` → copies rgb
10. **Strip**: Component colors shown above palette, tokens first
11. **Strip click**: Click component color → selects it
12. **Opacity**: Field visible next to color input, changes work
13. **Opacity visibility**: Link to Tamagui token → opacity hidden
14. **Text color**: Same features work for text color picker

- [ ] **Step 6: Commit any fixes from testing**

Stage only the specific files that were fixed, then commit:

```bash
git commit -m "fix: integration fixes from manual testing"
```
