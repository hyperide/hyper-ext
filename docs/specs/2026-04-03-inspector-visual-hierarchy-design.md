# HYP-357: Inspector Panel Visual Hierarchy in VS Code Extension

## Problem

The Inspector panel in the VS Code extension lost visual hierarchy — inputs blend
into the panel background, toggle active states are barely visible. Everything is
monochrome with no depth levels.

Root cause: `--background: transparent` in `webview/styles.css` makes the panel bg
equal to whatever VS Code provides for the sidebar. Combined with `--muted` mapping
to `--vscode-input-background`, which is too close to the sidebar bg in most themes,
inputs and toggles lose contrast.

### Current toggle state (before)

Both components use the same pattern — ternary on active state:

**PositionSection.tsx** — container: `flex items-center mb-2 whitespace-nowrap`

- Active: `bg-background border border-border font-medium`
- Inactive: `bg-muted`

**LayoutSection.tsx** — container: `flex items-center mb-3`

- Active: `border border-border bg-background`
- Inactive: `bg-muted`

Problem: `bg-background` resolves to `transparent` in the extension, `bg-muted`
resolves to `--vscode-input-background` which is nearly identical to sidebar bg.
Both states are visually indistinguishable.

## Design

Background-based visual hierarchy (no borders), matching the Figma reference.

### Three bg levels

| Level                | Purpose                | Dark                                     | Light                                    |
| -------------------- | ---------------------- | ---------------------------------------- | ---------------------------------------- |
| 1 — Panel            | Section background     | `--vscode-sideBar-background`            | `--vscode-sideBar-background`            |
| 2 — Toggle container | Groups toggle buttons  | `--toggle-container-bg` (subtle overlay) | `--toggle-container-bg` (subtle overlay) |
| 3 — Active pill      | Selected toggle button | `--toggle-active-bg` (lighter overlay)   | `--toggle-active-bg` (white + shadow)    |

Input fields (`bg-muted` = `--vscode-input-background`) already have correct
structure (icon + value inside one bg container). They become visible once Level 1
is fixed — no changes to input components needed.

### Toggle tokens

Dedicated CSS custom properties so toggle styles reference tokens, not raw rgba.

**Extension** (raw color values, no HSL):

| Token                    | Dark                     | Light                        | High Contrast (Dark) | High Contrast Light |
| ------------------------ | ------------------------ | ---------------------------- | -------------------- | ------------------- |
| `--toggle-container-bg`  | `rgba(255,255,255,0.06)` | `rgba(0,0,0,0.06)`           | `transparent`        | `transparent`       |
| `--toggle-active-bg`     | `rgba(255,255,255,0.12)` | `#fff`                       | `transparent`        | `transparent`       |
| `--toggle-active-shadow` | `none`                   | `0 1px 2px rgba(0,0,0,0.08)` | `none`               | `none`              |

High-contrast (both Dark and Light): uses `var(--vscode-contrastBorder)` border
instead of bg differentiation. Both HC themes share the same token values — the
border color itself differs per theme via the VS Code variable.

**SaaS** (HSL triplets for Tailwind):

| Token                    | Light                         | Dark                                       |
| ------------------------ | ----------------------------- | ------------------------------------------ |
| `--toggle-container`     | `210 40% 96.1%` (= `--muted`) | `217.2 32.6% 17.5%` (= `--muted`)          |
| `--toggle-active`        | `0 0% 100%` (white)           | `217.2 32.6% 23%` (lighter than container) |
| `--toggle-active-shadow` | `0 1px 2px rgba(0,0,0,0.06)`  | `0 1px 2px rgba(0,0,0,0.2)`                |

Dark mode active pill is _lighter_ than container (+5.5% lightness), not darker —
matches the extension behavior and Figma reference.

**Tailwind config**: no changes needed. Toggle tokens are consumed exclusively via
`.toggle-container` / `.toggle-active` CSS classes (defined in `global.css`), not
via Tailwind utility classes like `bg-toggle-active`. This avoids extending
`tailwind.config.ts` for single-use visual tokens.

### Scope

**Change:**

- Input field visibility (via CSS variable fix, zero component changes)
- Toggle active state for Position and Layout sections (CSS token classes + JSX class swap)

**Do NOT change:**

- State selector tabs (Base / Hover / Focus / Active / Focus Visible) — uses a different
  pattern (`bg-popover` + `shadow-sm` for selected, `text-muted-foreground` for unselected),
  not the `bg-background border border-border` / `bg-muted` pattern. Separate visual treatment,
  separate ticket if needed.
- Color swatches, Fill section dropdown, color picker
- Stroke / Effects collapse sections
- Section headers, separators, spacing

## Implementation

### CSS class resolution: extension vs SaaS

The `.toggle-container` / `.toggle-active` classes are defined in **two** CSS files
with different syntax:

- **Extension**: `webview/styles.css` — `background: var(--toggle-container-bg)` (raw CSS variable)
- **SaaS**: `client/global.css` — `background: hsl(var(--toggle-container))` (HSL triplet via `hsl()`)

This is safe: only one stylesheet is loaded per environment. Extension webviews load
`styles.css` (bundled by esbuild). SaaS loads `global.css` (via Tailwind/Vite).
There is no scenario where both are active simultaneously — the extension webview is
a separate document context from the SaaS app.

### 1. `vscode-extension/hypercanvas-preview/src/webview/styles.css`

Fix `--background` variable (in existing `:root, body.vscode-dark, ...` block):

```css
--background: var(--vscode-sideBar-background, var(--vscode-editor-background));
```

Fallback chain: `--vscode-sideBar-background` → `--vscode-editor-background`.
Both are standard VS Code theme variables. `--vscode-editor-background` is always
defined (required by VS Code theme API). Minimal themes that omit sidebar bg will
fall through to editor bg cleanly.

Add toggle tokens (new blocks, after the existing variable block):

```css
/* SYNC: client/global.css — toggle hierarchy tokens */
:root,
body.vscode-dark {
  --toggle-container-bg: rgba(255, 255, 255, 0.06);
  --toggle-active-bg: rgba(255, 255, 255, 0.12);
  --toggle-active-shadow: none;
}

body.vscode-light {
  --toggle-container-bg: rgba(0, 0, 0, 0.06);
  --toggle-active-bg: #fff;
  --toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}

body.vscode-high-contrast,
body.vscode-high-contrast-light {
  --toggle-container-bg: transparent;
  --toggle-active-bg: transparent;
  --toggle-active-shadow: none;
}
```

Add toggle utility classes (reference tokens, not hardcoded values):

```css
.toggle-container {
  background: var(--toggle-container-bg);
  border-radius: 6px;
  padding: 2px;
}

.toggle-active {
  background: var(--toggle-active-bg);
  box-shadow: var(--toggle-active-shadow);
  border-radius: 4px;
}

body.vscode-high-contrast .toggle-active,
body.vscode-high-contrast-light .toggle-active {
  border: 1px solid var(--vscode-contrastBorder);
}
```

### 2. `client/global.css`

Add toggle tokens to existing `:root` and `.dark` blocks inside `@layer base`:

```css
/* In :root (light) — after existing variables: */
/* SYNC: vscode-extension/hypercanvas-preview/src/webview/styles.css — toggle hierarchy tokens */
--toggle-container: 210 40% 96.1%;
--toggle-active: 0 0% 100%;
--toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);

/* In .dark — after existing variables: */
--toggle-container: 217.2 32.6% 17.5%;
--toggle-active: 217.2 32.6% 23%;
--toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);

/* In @media (prefers-color-scheme: dark) :root:not(.light):not(.dark) — same as .dark: */
--toggle-container: 217.2 32.6% 17.5%;
--toggle-active: 217.2 32.6% 23%;
--toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
```

Add toggle classes in `@layer utilities` (not `@layer components`).
Currently `global.css` has no `@layer components` block. These classes are
single-purpose visual utilities (one class = one visual state), consistent
with the existing utilities in `@layer utilities`:

```css
/* In @layer utilities — after existing utility classes: */
.toggle-container {
  background: hsl(var(--toggle-container));
  border-radius: 6px;
  padding: 2px;
}

.toggle-active {
  background: hsl(var(--toggle-active));
  box-shadow: var(--toggle-active-shadow);
  border-radius: 4px;
}
```

### 3. `client/components/RightSidebar/sections/PositionSection.tsx`

Current → New:

- Container div (`flex items-center mb-2 whitespace-nowrap`): add `toggle-container`
- Active button: `bg-background border border-border font-medium` → `toggle-active font-medium`
- Inactive button: `bg-muted` → remove (transparent, shows container bg through)

### 4. `client/components/RightSidebar/sections/LayoutSection.tsx`

Current → New (layout type toggle only, not aspect-ratio/padding/clip buttons):

- Container div (`flex items-center mb-3`): add `toggle-container`
- Active button: `border border-border bg-background` → `toggle-active`
- Inactive button: `bg-muted` → remove (transparent, shows container bg through)

### 5. Smoke tests

No tests exist for PositionSection or LayoutSection. Add minimal smoke tests:

- `client/components/RightSidebar/sections/__tests__/PositionSection.test.tsx`
- `client/components/RightSidebar/sections/__tests__/LayoutSection.test.tsx`

Each test renders the component and verifies:

- Container has `toggle-container` class
- Active button has `toggle-active` class
- Inactive buttons do NOT have `bg-muted` or `bg-background` classes

This catches class regressions during refactoring without testing visual appearance.

### Files touched

| File                                                                         | Type of change                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `vscode-extension/hypercanvas-preview/src/webview/styles.css`                | CSS variable fix + toggle tokens + toggle classes (extension)                           |
| `client/global.css`                                                          | Toggle tokens in `:root`/`.dark`/`@media` + toggle classes in `@layer utilities` (SaaS) |
| `client/components/RightSidebar/sections/PositionSection.tsx`                | Toggle class swap (shared component)                                                    |
| `client/components/RightSidebar/sections/LayoutSection.tsx`                  | Toggle class swap (shared component)                                                    |
| `client/components/RightSidebar/sections/__tests__/PositionSection.test.tsx` | Smoke test (new)                                                                        |
| `client/components/RightSidebar/sections/__tests__/LayoutSection.test.tsx`   | Smoke test (new)                                                                        |

### Theme compatibility

- Extension dark: alpha-channel overlays adapt to any VS Code dark color theme
- Extension light: white active pill with shadow — standard pattern
- Extension high-contrast dark: falls back to `var(--vscode-contrastBorder)` border on
  active pill — standard VS Code HC pattern, no subtle overlays
- Extension high-contrast light: same border approach as HC dark, `--vscode-contrastBorder`
  resolves to the theme-appropriate color automatically
- SaaS light: white active pill (`--toggle-active: 0 0% 100%`) on muted container
- SaaS dark: lighter active pill (`23%` lightness) on muted container (`17.5%` lightness),
  matching extension behavior where active state is always visually elevated

### Verification

Test in the following themes after implementation:

| Environment | Theme                  | Check                                                            |
| ----------- | ---------------------- | ---------------------------------------------------------------- |
| VS Code     | Default Dark           | Inputs visible, toggle active pill lighter than container        |
| VS Code     | Default Light          | Inputs visible, toggle active pill white with shadow             |
| VS Code     | High Contrast Dark     | Active pill has visible border, no invisible overlays            |
| VS Code     | High Contrast Light    | Active pill has visible border, contrast adequate on light HC bg |
| VS Code     | Dracula / One Dark Pro | Alpha overlays produce visible contrast on non-default bg        |
| SaaS        | Light                  | Toggle matches Figma reference                                   |
| SaaS        | Dark                   | Active pill lighter than container (not darker)                  |

Automated:

- `bun run test` — smoke tests verify correct CSS classes on toggle components
- Theme variant unit tests — load compiled extension CSS into happy-dom, set
  `document.body.className` to each theme class, verify CSS custom property values
  via `getComputedStyle().getPropertyValue()`. Covers dark, light, HC dark, HC light.
- Extension build check — `npm run build:css` + verify `out/webview.css` contains
  `.toggle-container` and `.toggle-active` selectors

Method: open Inspector panel, select an element, verify Position/Layout toggle
contrast visually. Take before/after screenshots.
