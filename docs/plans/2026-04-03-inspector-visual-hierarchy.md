# Inspector Panel Visual Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore visual hierarchy in the Inspector panel — inputs visible against panel bg, toggle buttons have clear active/inactive states.

**Scope decision:** Only PositionSection and LayoutSection toggle groups are in scope.
StateSelectorSection (Base/Hover/Focus/Active tabs) uses a different pattern
(`bg-popover` + `shadow-sm`, not `bg-background border border-border` / `bg-muted`) —
separate visual treatment, separate ticket if needed.

**Architecture:** Three-level background hierarchy via CSS custom properties. Extension uses raw rgba values; SaaS uses HSL triplets consumed via `hsl()`. Shared React components use identical CSS class names (`.toggle-container`, `.toggle-active`) — resolved from different stylesheets per environment. No Tailwind config changes.

**Tech Stack:** CSS custom properties, Tailwind `@layer utilities`, `@testing-library/react` + `happy-dom`, `bun:test`

**Spec:** `docs/specs/2026-04-03-inspector-visual-hierarchy-design.md`

---

### Task 1: Extension CSS — fix `--background` and add toggle tokens

**Files:**
- Modify: `vscode-extension/hypercanvas-preview/src/webview/styles.css:34` (fix `--background`)
- Modify: `vscode-extension/hypercanvas-preview/src/webview/styles.css` (append toggle blocks after line 53)

- [ ] **Step 1: Fix `--background` variable**

In the existing `:root, body.vscode-dark, body.vscode-high-contrast, body.vscode-light` block (line 34), change:

```css
/* Before: */
--background: transparent;

/* After: */
--background: var(--vscode-sideBar-background, var(--vscode-editor-background));
```

- [ ] **Step 2: Add toggle token blocks after the variable block**

After line 53 (closing `}` of the variable block), add:

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

- [ ] **Step 3: Add toggle utility classes after the token blocks**

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

- [ ] **Step 4: Verify no syntax errors**

Run: `bun run lint`
Expected: PASS (Biome checks CSS via `biome.jsonc` include paths)

---

### Task 2: SaaS CSS — add toggle tokens and utility classes

**Files:**
- Modify: `client/global.css:63` (add tokens in `:root`)
- Modify: `client/global.css:102` (add tokens in `.dark`)
- Modify: `client/global.css:142` (add tokens in `@media` block)
- Modify: `client/global.css:288` (add toggle classes in `@layer utilities`)

- [ ] **Step 1: Add toggle tokens to `:root` (light theme)**

In `client/global.css`, inside the `:root` block (after line 63 — `--sidebar-ring`), add:

```css
    /* SYNC: vscode-extension/hypercanvas-preview/src/webview/styles.css — toggle hierarchy tokens */
    --toggle-container: 210 40% 96.1%;
    --toggle-active: 0 0% 100%;
    --toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.06);
```

- [ ] **Step 2: Add toggle tokens to `.dark`**

In the `.dark` block (after line 102 — `--sidebar-ring`), add:

```css
    --toggle-container: 217.2 32.6% 17.5%;
    --toggle-active: 217.2 32.6% 23%;
    --toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
```

- [ ] **Step 3: Add toggle tokens to `@media (prefers-color-scheme: dark)` block**

In the `@media` block (after line 142 — `--sidebar-ring`), add:

```css
      --toggle-container: 217.2 32.6% 17.5%;
      --toggle-active: 217.2 32.6% 23%;
      --toggle-active-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
```

- [ ] **Step 4: Add toggle utility classes inside `@layer utilities`**

In `client/global.css`, before the closing `}` of `@layer utilities` (before line 288's `}`), add:

```css
  /* Toggle hierarchy — visual depth for toggle button groups */
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

- [ ] **Step 5: Verify lint passes**

Run: `bun run lint`
Expected: PASS

---

### Task 3: Write smoke test for PositionSection (will fail — old classes)

**Files:**
- Create: `client/components/RightSidebar/sections/__tests__/PositionSection.test.tsx`

- [ ] **Step 1: Write the test file**

```tsx
// @bun-test-env happy-dom
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { PositionSection } from '../PositionSection';

const defaultProps = {
  selectedPosition: 'static' as const,
  posValues: { top: '0', right: '0', bottom: '0', left: '0' },
  projectUIKit: 'tailwind' as const,
  onPositionChange: () => {},
  onPositionValueChange: () => {},
  onPositionKeyDown: () => {},
};

describe('PositionSection toggle classes', () => {
  it('wraps toggle buttons in toggle-container', () => {
    const { container } = render(<PositionSection {...defaultProps} />);
    const toggleGroup = container.querySelector('.toggle-container');
    expect(toggleGroup).not.toBeNull();
  });

  it('applies toggle-active to selected position button', () => {
    const { container } = render(
      <PositionSection {...defaultProps} selectedPosition="abs" />,
    );
    const buttons = container.querySelectorAll('button');
    const absButton = Array.from(buttons).find((b) => b.textContent === 'abs');
    expect(absButton?.classList.contains('toggle-active')).toBe(true);
  });

  it('does not apply bg-muted or bg-background to inactive buttons', () => {
    const { container } = render(
      <PositionSection {...defaultProps} selectedPosition="static" />,
    );
    const buttons = container.querySelectorAll('button');
    for (const button of buttons) {
      if (button.textContent !== 'static') {
        expect(button.classList.contains('bg-muted')).toBe(false);
        expect(button.classList.contains('bg-background')).toBe(false);
      }
    }
  });

  it('does not apply old border classes to active button', () => {
    const { container } = render(
      <PositionSection {...defaultProps} selectedPosition="fixed" />,
    );
    const buttons = container.querySelectorAll('button');
    const fixedButton = Array.from(buttons).find((b) => b.textContent === 'fixed');
    expect(fixedButton?.classList.contains('border-border')).toBe(false);
    expect(fixedButton?.classList.contains('bg-background')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails for the right reason**

Run: `bun run test client/components/RightSidebar/sections/__tests__/PositionSection.test.tsx`

Expected: FAIL — `toggle-container` not found (old classes still in component).
The test should render successfully (happy-dom works), but assertions fail because the component still uses `bg-background border border-border` and `bg-muted`.

If it fails for a different reason (import resolution, missing mock, DOM not available), fix the test setup before proceeding.

---

### Task 4: Swap toggle classes in PositionSection (test passes)

**Files:**
- Modify: `client/components/RightSidebar/sections/PositionSection.tsx:52-104`

- [ ] **Step 1: Add `toggle-container` to the button group container**

Line 52, change:

```tsx
// Before:
<div className="flex items-center mb-2 whitespace-nowrap">

// After:
<div className="toggle-container flex items-center mb-2 whitespace-nowrap">
```

- [ ] **Step 2: Swap active/inactive classes on all position buttons**

There are 5 buttons (static, rel, abs, fixed, sticky). Each has this ternary pattern:

```tsx
// Before (example — static button, line 57-59):
className={`flex-[1.4] h-6 px-2 text-xs rounded-l flex items-center justify-center ${
  selectedPosition === 'static' ? 'bg-background border border-border font-medium' : 'bg-muted'
}`}

// After:
className={`flex-[1.4] h-6 px-2 text-xs rounded-l flex items-center justify-center ${
  selectedPosition === 'static' ? 'toggle-active font-medium' : ''
}`}
```

Apply the same transformation to all 5 buttons:

| Button | Line | Active before | Active after | Inactive before | Inactive after |
|--------|------|---------------|--------------|-----------------|----------------|
| static | 57-59 | `bg-background border border-border font-medium` | `toggle-active font-medium` | `bg-muted` | `''` |
| rel | 67-69 | `bg-background border border-border font-medium` | `toggle-active font-medium` | `bg-muted` | `''` |
| abs | 77-79 | `bg-background border border-border font-medium` | `toggle-active font-medium` | `bg-muted` | `''` |
| fixed | 87-90 | `bg-background border border-border font-medium` | `toggle-active font-medium` | `bg-muted` | `''` |
| sticky | 98-100 | `bg-background border border-border font-medium` | `toggle-active font-medium` | `bg-muted` | `''` |

- [ ] **Step 3: Run the smoke test — verify it passes**

Run: `bun run test client/components/RightSidebar/sections/__tests__/PositionSection.test.tsx`
Expected: PASS — all 4 assertions green.

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: PASS — no regressions.

---

### Task 5: Write smoke test for LayoutSection (will fail — old classes)

**Files:**
- Create: `client/components/RightSidebar/sections/__tests__/LayoutSection.test.tsx`

- [ ] **Step 1: Write the test file**

LayoutSection has many props. Only the layout type toggle (lines 306-354) is in scope.
Mock unused callbacks as no-ops.

```tsx
// @bun-test-env happy-dom
import { describe, expect, it } from 'bun:test';
import { render } from '@testing-library/react';
import { LayoutSection } from '../LayoutSection';

const defaultProps = {
  selectedLayout: 'layout' as const,
  width: '100',
  height: '100',
  gap: '0',
  justifyContent: 'flex-start',
  alignItems: 'flex-start',
  columnGap: '0',
  rowGap: '0',
  gridJustifyItems: 'stretch',
  gridAlignItems: 'stretch',
  gridCols: '3',
  gridRows: '3',
  paddingTop: '0',
  paddingRight: '0',
  paddingBottom: '0',
  paddingLeft: '0',
  clipContent: false,
  projectUIKit: 'tailwind' as const,
  isStyleSyncing: false,
  onLayoutChange: () => {},
  onWidthChange: () => {},
  onHeightChange: () => {},
  onWidthBlur: () => {},
  onHeightBlur: () => {},
  onGapChange: () => {},
  onJustifyContentChange: () => {},
  onAlignItemsChange: () => {},
  onColumnGapChange: () => {},
  onRowGapChange: () => {},
  onGridJustifyItemsChange: () => {},
  onGridAlignItemsChange: () => {},
  onGridColsChange: () => {},
  onGridRowsChange: () => {},
  onPaddingChange: () => {},
  onClipContentChange: () => {},
  onNumericKeyDown: () => {},
  syncStyleChange: () => {},
};

describe('LayoutSection toggle classes', () => {
  it('wraps layout type buttons in toggle-container', () => {
    const { container } = render(<LayoutSection {...defaultProps} />);
    const toggleGroup = container.querySelector('.toggle-container');
    expect(toggleGroup).not.toBeNull();
  });

  it('applies toggle-active to selected layout button', () => {
    const { container } = render(
      <LayoutSection {...defaultProps} selectedLayout="col" />,
    );
    const colButton = container.querySelector(
      `[data-testid="hyper-inspector-layout-flex-direction"]`,
    );
    expect(colButton?.classList.contains('toggle-active')).toBe(true);
  });

  it('does not apply bg-muted or bg-background to inactive buttons', () => {
    const { container } = render(
      <LayoutSection {...defaultProps} selectedLayout="layout" />,
    );
    const colButton = container.querySelector(
      `[data-testid="hyper-inspector-layout-flex-direction"]`,
    );
    expect(colButton?.classList.contains('bg-muted')).toBe(false);
    expect(colButton?.classList.contains('bg-background')).toBe(false);
  });

  it('does not apply old border classes to active button', () => {
    const { container } = render(
      <LayoutSection {...defaultProps} selectedLayout="row" />,
    );
    const rowButton = container.querySelector(
      `[data-testid="hyper-inspector-view-row"]`,
    );
    expect(rowButton?.classList.contains('border-border')).toBe(false);
    expect(rowButton?.classList.contains('bg-background')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test — verify it fails for the right reason**

Run: `bun run test client/components/RightSidebar/sections/__tests__/LayoutSection.test.tsx`

Expected: FAIL — `toggle-container` not found, active button has `border-border` instead of `toggle-active`.

---

### Task 6: Swap toggle classes in LayoutSection (test passes)

**Files:**
- Modify: `client/components/RightSidebar/sections/LayoutSection.tsx:306-353`

- [ ] **Step 1: Add `toggle-container` to the layout type button group container**

Line 306, change:

```tsx
// Before:
<div className="flex items-center mb-3">

// After:
<div className="toggle-container flex items-center mb-3">
```

- [ ] **Step 2: Swap active/inactive classes on all layout type buttons**

4 buttons: layout, col, row, grid. Each uses `cn()`:

```tsx
// Before (layout button, lines 311-313):
className={cn(
  'flex-1 h-6 px-1 rounded-l flex items-center justify-center',
  selectedLayout === 'layout' ? 'border border-border bg-background' : 'bg-muted',
)}

// After:
className={cn(
  'flex-1 h-6 px-1 rounded-l flex items-center justify-center',
  selectedLayout === 'layout' && 'toggle-active',
)}
```

Apply to all 4 buttons:

| Button | Line | Active before | Active after | Inactive before | Inactive after |
|--------|------|---------------|--------------|-----------------|----------------|
| layout | 311-313 | `border border-border bg-background` | `toggle-active` | `bg-muted` | (nothing) |
| col | 322-324 | `border border-border bg-background` | `toggle-active` | `bg-muted` | (nothing) |
| row | 333-336 | `border border-border bg-background` | `toggle-active` | `bg-muted` | (nothing) |
| grid | 346-348 | `border border-border bg-background` | `toggle-active` | `bg-muted` | (nothing) |

Note: `font-medium` is NOT present in LayoutSection's active state (unlike PositionSection), so don't add it.

- [ ] **Step 3: Run the smoke test — verify it passes**

Run: `bun run test client/components/RightSidebar/sections/__tests__/LayoutSection.test.tsx`
Expected: PASS — all 4 assertions green.

- [ ] **Step 4: Run full test suite**

Run: `bun run test`
Expected: PASS — no regressions.

---

### Task 7: Extension CSS theme variant tests

**Files:**
- Create: `vscode-extension/hypercanvas-preview/src/__tests__/toggle-theme-variants.test.ts`

- [ ] **Step 1: Write theme variant tests**

Load the extension CSS source into happy-dom, set body class per theme, verify toggle token values.

```ts
// @bun-test-env happy-dom
import { afterEach, describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cssPath = resolve(
  import.meta.dir,
  '../../src/webview/styles.css',
);
const cssContent = readFileSync(cssPath, 'utf-8');

function applyTheme(themeClass: string) {
  document.head.innerHTML = '';
  document.body.className = themeClass;
  const style = document.createElement('style');
  style.textContent = cssContent;
  document.head.appendChild(style);
}

function getToken(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

afterEach(() => {
  document.head.innerHTML = '';
  document.body.className = '';
});

describe('extension toggle tokens per theme', () => {
  it('dark theme: container has rgba overlay', () => {
    applyTheme('vscode-dark');
    expect(getToken('--toggle-container-bg')).toContain('rgba(255');
  });

  it('light theme: active pill is white', () => {
    applyTheme('vscode-light');
    expect(getToken('--toggle-active-bg')).toBe('#fff');
  });

  it('high-contrast dark: container is transparent', () => {
    applyTheme('vscode-high-contrast');
    expect(getToken('--toggle-container-bg')).toBe('transparent');
    expect(getToken('--toggle-active-bg')).toBe('transparent');
  });

  it('high-contrast light: container is transparent', () => {
    applyTheme('vscode-high-contrast-light');
    expect(getToken('--toggle-container-bg')).toBe('transparent');
    expect(getToken('--toggle-active-bg')).toBe('transparent');
  });
});
```

- [ ] **Step 2: Run the test — verify it passes**

Run: `bun run test vscode-extension/hypercanvas-preview/src/__tests__/toggle-theme-variants.test.ts`

Expected: PASS — if Task 1 CSS is already applied. If running before Task 1, it fails
(tokens not defined). Adjust test order if needed.

- [ ] **Step 3: Run full test suite**

Run: `bun run test`
Expected: PASS — no regressions.

---

### Task 8: Extension build verification, lint, self-review, commit

- [ ] **Step 1: Build extension CSS and verify output**

Run:
```bash
cd vscode-extension/hypercanvas-preview && npm run build:css
grep -q 'toggle-container' out/webview.css && echo "OK: toggle-container found" || echo "FAIL: toggle-container missing"
grep -q 'toggle-active' out/webview.css && echo "OK: toggle-active found" || echo "FAIL: toggle-active missing"
```

Expected: both selectors present in compiled `out/webview.css`.

- [ ] **Step 2: Run `bunx knip`**

Run: `bunx knip`
Expected: no new unused exports from changed files.

- [ ] **Step 3: Run `bun run lint`**

Run: `bun run lint`
Expected: PASS — no warnings, no errors.

- [ ] **Step 4: Self-review diff**

Run: `git diff`

Check:
- `--background` fix is the only change in the variable block (no accidental edits)
- SYNC comments in both CSS files reference each other correctly
- `body.vscode-high-contrast-light` is present alongside `body.vscode-high-contrast`
- PositionSection: 5 buttons changed, each ternary replaced
- LayoutSection: 4 buttons changed, each `cn()` call updated
- No `bg-muted` or `bg-background` left on toggle buttons (input fields still use `bg-muted` — that's correct)
- No unrelated changes

- [ ] **Step 5: Run AI code review**

Run: `codex exec review --uncommitted`
Address any findings.

- [ ] **Step 6: Commit**

Use `/commit` skill for the full checklist.
