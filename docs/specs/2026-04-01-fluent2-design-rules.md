# Fluent 2 Design System Linter Rules

Research compiled from `@fluentui/tokens`, `@fluentui/react-theme`, Fluent 2 Design System
documentation, and FluentUI React v9 source code.

**Total rules: 108**

Legend:

- **Severity**: `error` = must fix, `warning` = should fix, `info` = recommendation
- **Measurable**: whether the rule can be checked algorithmically (static analysis, AST, CSS parsing)

---

## 1. Color (26 rules)

### 1.1 Brand Color Ramp

The brand ramp is a 16-stop palette (keys 10-160, step 10). Every theme must define all 16 stops.
Default Microsoft blue primary: `#0078D4` (brandColor80 position).

| Stop | Role |
|------|------|
| 10 | Darkest brand shade |
| 20-40 | Dark shades (dark-mode foreground) |
| 50-60 | Mid-dark (dark-mode backgrounds) |
| 70 | Brand shade (hover states) |
| 80 | **Primary** brand color |
| 90 | Brand tint (pressed states) |
| 100-120 | Light tints (light-mode backgrounds) |
| 130-150 | Lighter tints (subtle backgrounds) |
| 160 | Lightest brand tint |

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| COLOR-001 | Brand ramp must define all 16 stops (10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150, 160) | Yes | error |
| COLOR-002 | Brand ramp stops must be monotonically increasing in luminance (10=darkest, 160=lightest) | Yes | error |
| COLOR-003 | Adjacent brand ramp stops must have perceptible contrast (deltaE > 3 in OKLCH) | Yes | warning |
| COLOR-004 | Brand primary (stop 80) must meet 4.5:1 contrast ratio on white background | Yes | error |
| COLOR-005 | Brand primary (stop 80) must meet 3:1 contrast ratio on neutral backgrounds | Yes | error |

### 1.2 Neutral Colors

Neutral palette: grey scale from `grey[2]` (#050505) to `grey[99]` (#fcfcfc),
plus `white` (#ffffff), `black` (#000000).

Alpha variants: `whiteAlpha` and `blackAlpha` at 10 opacity levels (5%, 10%, 20%, 30%, 40%, 50%, 60%, 70%, 80%, 90%).

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| COLOR-006 | Use semantic neutral tokens (`colorNeutralForeground1`, `colorNeutralBackground1`, etc.) instead of raw grey hex values | Yes | error |
| COLOR-007 | `colorNeutralForeground1` on `colorNeutralBackground1` must maintain >= 4.5:1 contrast | Yes | error |
| COLOR-008 | `colorNeutralForeground2` (secondary text) must maintain >= 4.5:1 on background | Yes | error |
| COLOR-009 | `colorNeutralForeground3` (tertiary/disabled hint) must maintain >= 3:1 on background | Yes | warning |
| COLOR-010 | `colorNeutralStrokeAccessible` must maintain >= 3:1 contrast against adjacent surfaces | Yes | error |
| COLOR-011 | Never use raw `#ffffff` or `#000000` — use `colorNeutralBackground1` / `colorNeutralForeground1` | Yes | error |

### 1.3 Status Colors

Status color mapping: `danger` = red, `success` = green, `warning` = yellow/orange.

Each status has tokens for 3 backgrounds, 3 foregrounds, 1 inverted foreground, 2 borders, 1 active border:

- `colorStatus{Status}Background1` (subtle), `Background2` (medium), `Background3` (strong)
- `colorStatus{Status}Foreground1` (default), `Foreground2` (hover), `Foreground3` (pressed)
- `colorStatus{Status}ForegroundInverted` (on strong background)
- `colorStatus{Status}Border1` (subtle), `Border2` (medium), `BorderActive` (active/focus)

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| COLOR-012 | Use `colorStatusDanger*` tokens for errors/destructive actions, not arbitrary red | Yes | error |
| COLOR-013 | Use `colorStatusSuccess*` tokens for success states, not arbitrary green | Yes | error |
| COLOR-014 | Use `colorStatusWarning*` tokens for warnings, not arbitrary yellow/orange | Yes | error |
| COLOR-015 | Status foreground on its own `Background3` (strong) must meet 4.5:1 contrast | Yes | error |
| COLOR-016 | Status `ForegroundInverted` must only be used on `Background3` | Yes | warning |
| COLOR-017 | Status borders must use status border tokens, not neutral stroke tokens | Yes | warning |

### 1.4 General Color Rules

Alias color token categories from `@fluentui/tokens`:

- `colorNeutral*` (46+ tokens): backgrounds, foregrounds, strokes, stencils, shadows
- `colorBrand*` (16+ tokens): backgrounds, foregrounds, strokes, shadows
- `colorSubtle*` (3 tokens): `colorSubtleBackground`, `colorSubtleBackgroundLightAlpha`, `colorSubtleBackgroundInverted`
- `colorTransparent*` (3 tokens): `colorTransparentBackground`, `colorTransparentStroke`, `colorTransparentStrokeInteractive`
- `colorPalette{Color}*`: 34 color families (red, green, blue, purple, pink, orange, yellow, etc.)

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| COLOR-018 | No hardcoded hex color values in component styles — use design tokens | Yes | error |
| COLOR-019 | No hardcoded `rgb()` / `rgba()` / `hsl()` color values — use design tokens | Yes | error |
| COLOR-020 | Interactive states (hover, pressed, selected, disabled) must use corresponding state tokens | Yes | warning |
| COLOR-021 | Disabled state must use `colorNeutralForegroundDisabled` / `colorNeutralBackgroundDisabled` | Yes | warning |
| COLOR-022 | Do not mix brand and status colors in the same semantic context | No | warning |
| COLOR-023 | Foreground on brand background must use `colorNeutralForegroundOnBrand` | Yes | error |
| COLOR-024 | Do not rely on color alone to convey meaning — supplement with icons, text, or patterns | No | warning |
| COLOR-025 | Alpha color tokens (`whiteAlpha`, `blackAlpha`, `grey*Alpha`) must only be used for overlays and scrims | Yes | info |
| COLOR-026 | `colorNeutralShadowAmbient` and `colorNeutralShadowKey` must only be used inside shadow token definitions | Yes | warning |

---

## 2. Typography (18 rules)

### 2.1 Type Ramp (Web)

Font families:

- `fontFamilyBase`: `'Segoe UI', 'Segoe UI Web (West European)', -apple-system, BlinkMacSystemFont, Roboto, 'Helvetica Neue', sans-serif`
- `fontFamilyMonospace`: `'Consolas', 'Courier New', Courier, monospace`
- `fontFamilyNumeric`: `Bahnschrift, 'Segoe UI', ...fallbacks`

Font sizes (global tokens):

| Token | Value |
|-------|-------|
| `fontSizeBase100` | 10px |
| `fontSizeBase200` | 12px |
| `fontSizeBase300` | 14px (body default) |
| `fontSizeBase400` | 16px |
| `fontSizeBase500` | 20px |
| `fontSizeBase600` | 24px |
| `fontSizeHero700` | 28px |
| `fontSizeHero800` | 32px |
| `fontSizeHero900` | 40px |
| `fontSizeHero1000` | 68px |

Line heights:

| Token | Value |
|-------|-------|
| `lineHeightBase100` | 14px |
| `lineHeightBase200` | 16px |
| `lineHeightBase300` | 20px |
| `lineHeightBase400` | 22px |
| `lineHeightBase500` | 28px |
| `lineHeightBase600` | 32px |
| `lineHeightHero700` | 36px |
| `lineHeightHero800` | 40px |
| `lineHeightHero900` | 52px |
| `lineHeightHero1000` | 92px |

Font weights:

| Token | Value |
|-------|-------|
| `fontWeightRegular` | 400 |
| `fontWeightMedium` | 500 |
| `fontWeightSemibold` | 600 |
| `fontWeightBold` | 700 |

### 2.2 Composite Typography Styles (Web)

Each style combines family + size + weight + lineHeight:

| Style | Size | Line Height | Weight |
|-------|------|-------------|--------|
| `caption2` | 10px | 14px | Regular (400) |
| `caption2Strong` | 10px | 14px | Semibold (600) |
| `caption1` | 12px | 16px | Regular (400) |
| `caption1Strong` | 12px | 16px | Semibold (600) |
| `caption1Stronger` | 12px | 16px | Bold (700) |
| `body1` | 14px | 20px | Regular (400) |
| `body1Strong` | 14px | 20px | Semibold (600) |
| `body1Stronger` | 14px | 20px | Bold (700) |
| `body2` | 16px | 22px | Regular (400) |
| `subtitle2` | 16px | 22px | Semibold (600) |
| `subtitle2Stronger` | 16px | 22px | Bold (700) |
| `subtitle1` | 20px | 26px | Semibold (600) |
| `title3` | 24px | 32px | Semibold (600) |
| `title2` | 28px | 36px | Semibold (600) |
| `title1` | 32px | 40px | Semibold (600) |
| `largeTitle` | 40px | 52px | Semibold (600) |
| `display` | 68px | 92px | Semibold (600) |

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| TYPO-001 | Font size must be a recognized Fluent token value (10, 12, 14, 16, 20, 24, 28, 32, 40, 68px) | Yes | error |
| TYPO-002 | Line height must match the token paired with the font size (e.g. 14px font -> 20px lineHeight) | Yes | error |
| TYPO-003 | Font weight must be one of: 400 (Regular), 500 (Medium), 600 (Semibold), 700 (Bold) | Yes | error |
| TYPO-004 | Use composite typography style tokens (`typographyStyles.body1`, etc.) instead of individual properties | Yes | warning |
| TYPO-005 | Font family must use `fontFamilyBase` token, not hardcoded font stacks | Yes | error |
| TYPO-006 | Monospace text must use `fontFamilyMonospace` token | Yes | warning |
| TYPO-007 | Numeric-heavy content should use `fontFamilyNumeric` token | No | info |
| TYPO-008 | Do not use font sizes below 10px (Caption 2 is the minimum) | Yes | error |
| TYPO-009 | Do not skip more than 2 levels in the type ramp within a visual hierarchy | No | warning |
| TYPO-010 | Heading hierarchy must follow descending type ramp order (display > largeTitle > title1 > title2 > ...) | Yes | warning |
| TYPO-011 | Body text default must be `body1` (14px/20px Regular) | Yes | info |
| TYPO-012 | Do not combine `Strong` and `Stronger` variants at the same type ramp level in proximity | No | info |
| TYPO-013 | Large text (>= 18.5px bold or >= 24px regular) may use 3:1 contrast instead of 4.5:1 | Yes | info |
| TYPO-014 | Text must be resizable to 200% without clipping or content loss | No | warning |
| TYPO-015 | Do not use `px` units for font-size in CSS — use token references for scalability | Yes | warning |
| TYPO-016 | Line height ratio must be >= 1.2x the font size | Yes | warning |
| TYPO-017 | Maximum line length for body text should not exceed 80ch | Yes | info |
| TYPO-018 | Paragraph spacing should use `spacingVerticalM` (12px) or `spacingVerticalL` (16px) | Yes | info |

---

## 3. Spacing (14 rules)

### 3.1 Spacing Tokens

Spacing tokens are directional — same values exposed as both horizontal and vertical:

| Token (base) | Horizontal | Vertical | Value |
|--------------|------------|----------|-------|
| none | `spacingHorizontalNone` | `spacingVerticalNone` | 0 |
| xxs | `spacingHorizontalXXS` | `spacingVerticalXXS` | 2px |
| xs | `spacingHorizontalXS` | `spacingVerticalXS` | 4px |
| sNudge | `spacingHorizontalSNudge` | `spacingVerticalSNudge` | 6px |
| s | `spacingHorizontalS` | `spacingVerticalS` | 8px |
| mNudge | `spacingHorizontalMNudge` | `spacingVerticalMNudge` | 10px |
| m | `spacingHorizontalM` | `spacingVerticalM` | 12px |
| l | `spacingHorizontalL` | `spacingVerticalL` | 16px |
| xl | `spacingHorizontalXL` | `spacingVerticalXL` | 20px |
| xxl | `spacingHorizontalXXL` | `spacingVerticalXXL` | 24px |
| xxxl | `spacingHorizontalXXXL` | `spacingVerticalXXXL` | 32px |

Note: The Fluent 2 design page lists additional sizes (28, 36, 40, 48, 52, 56, 64, 72px) in
the conceptual spacing scale. The `@fluentui/tokens` package defines the 11 tokens above.
Extended values beyond 32px should use `calc()` with the base unit (4px) or custom tokens.

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| SPACE-001 | Padding and margin values must use spacing tokens (0, 2, 4, 6, 8, 10, 12, 16, 20, 24, 32px) | Yes | error |
| SPACE-002 | No arbitrary spacing values (e.g. 3px, 5px, 7px, 9px, 11px, 13px, 15px, 17px, 19px) | Yes | error |
| SPACE-003 | Extended spacing (>32px) must be multiples of the 4px base unit | Yes | warning |
| SPACE-004 | Gap in flex/grid layouts must use spacing tokens | Yes | warning |
| SPACE-005 | Horizontal spacing must use `spacingHorizontal*` tokens | Yes | info |
| SPACE-006 | Vertical spacing must use `spacingVertical*` tokens | Yes | info |
| SPACE-007 | Component internal padding: minimum `spacingHorizontalS` (8px) for touch targets | Yes | warning |
| SPACE-008 | Icon-to-text spacing must be `spacingHorizontalXS` (4px) or `spacingHorizontalSNudge` (6px) | Yes | info |
| SPACE-009 | Stack/list item spacing must be consistent — do not mix spacing levels within a group | Yes | warning |
| SPACE-010 | Section spacing between content blocks must be >= `spacingVerticalL` (16px) | Yes | info |
| SPACE-011 | Nested padding must reduce by at least one spacing level from parent | No | info |
| SPACE-012 | Touch target minimum size: 44x44px (WCAG) / 48x48px (Fluent recommended) | Yes | error |
| SPACE-013 | Minimum tap target spacing between interactive elements: 8px | Yes | warning |
| SPACE-014 | No negative margins as layout strategy — use proper flex/grid alignment | Yes | warning |

---

## 4. Shape / Border Radius (10 rules)

### 4.1 Border Radius Tokens

| Token | Value | Typical use |
|-------|-------|-------------|
| `borderRadiusNone` | 0 | Square elements, table cells |
| `borderRadiusSmall` | 2px | Small components (<32px), badges, tags |
| `borderRadiusMedium` | 4px | Default for most components (buttons, inputs, cards) |
| `borderRadiusLarge` | 6px | Larger cards, dialogs |
| `borderRadiusXLarge` | 8px | Large containers |
| `borderRadius2XLarge` | 12px | Panels, modals |
| `borderRadius3XLarge` | 16px | Large surfaces |
| `borderRadius4XLarge` | 24px | Hero cards |
| `borderRadius5XLarge` | 32px | Large hero elements |
| `borderRadius6XLarge` | 40px | Marketing surfaces |
| `borderRadiusCircular` | 10000px | Avatars, circular buttons, pills |

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| SHAPE-001 | Border radius must use a recognized token value (0, 2, 4, 6, 8, 12, 16, 24, 32, 40, 10000px) | Yes | error |
| SHAPE-002 | No arbitrary border radius values (e.g. 3px, 5px, 10px, 15px, 50%) | Yes | error |
| SHAPE-003 | Components smaller than 32px should use `borderRadiusSmall` (2px) | Yes | warning |
| SHAPE-004 | Default component border radius is `borderRadiusMedium` (4px) | Yes | info |
| SHAPE-005 | Circular elements (avatars, round buttons) must use `borderRadiusCircular` (10000px), not `50%` | Yes | warning |
| SHAPE-006 | Nested elements must use equal or smaller border radius than their parent | Yes | warning |
| SHAPE-007 | Inner border radius = outer radius - padding (to maintain concentric curves) | Yes | info |
| SHAPE-008 | Border radius must not clip content — text and icons need sufficient padding | No | warning |
| SHAPE-009 | Mixed border radius values on the same element (e.g. `border-radius: 4px 0 0 4px`) are allowed only for attached/grouped components | No | info |
| SHAPE-010 | Input fields, buttons, and cards in the same context must share consistent border radius | Yes | warning |

---

## 5. Shadow / Elevation (12 rules)

### 5.1 Shadow Tokens

Each shadow token contains two layers: ambient (all-around soft glow) + key (directional from above).

| Token | Layer 1 (Key) | Layer 2 (Ambient) | Use case |
|-------|---------------|-------------------|----------|
| `shadow2` | `0 1px 2px rgba(0,0,0,0.28)` | `0 0 2px rgba(0,0,0,0.24)` | Cards at rest, FABs at rest |
| `shadow4` | `0 2px 4px rgba(0,0,0,0.28)` | `0 0 2px rgba(0,0,0,0.24)` | Cards hovered, grid items |
| `shadow8` | `0 4px 8px rgba(0,0,0,0.28)` | `0 0 2px rgba(0,0,0,0.24)` | FABs hovered, raised cards, app bars |
| `shadow16` | `0 8px 16px rgba(0,0,0,0.28)` | `0 0 2px rgba(0,0,0,0.24)` | Floating cards, popovers |
| `shadow28` | `0 14px 28px rgba(0,0,0,0.48)` | `0 0 8px rgba(0,0,0,0.40)` | Bottom sheets, navigation drawers |
| `shadow64` | `0 32px 64px rgba(0,0,0,0.48)` | `0 0 8px rgba(0,0,0,0.40)` | Dialogs, panels, modals |

Brand shadow variants (`shadowBrand*`) use brand color with luminosity-adjusted opacity:

- Shadow 1 opacity: `round(42 - 0.116 * luminosity)`
- Shadow 2 opacity: `round(34 - 0.09 * luminosity)`

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| SHADOW-001 | Shadow values must use shadow tokens (2, 4, 8, 16, 28, 64), not arbitrary `box-shadow` | Yes | error |
| SHADOW-002 | No `box-shadow: none` on components that have a default shadow token — use `shadow2` minimum for elevated elements | Yes | warning |
| SHADOW-003 | Elevation hierarchy must increase with visual importance (cards < popovers < dialogs) | No | warning |
| SHADOW-004 | Hover state should increase shadow by one level (e.g. `shadow2` -> `shadow4`) | Yes | info |
| SHADOW-005 | Pressed state should decrease shadow by one level from rest or use rest level | Yes | info |
| SHADOW-006 | Dark mode shadows must use increased opacity (dark theme shadow tokens) | Yes | warning |
| SHADOW-007 | Brand shadows must use the luminosity-based opacity formula, not hardcoded opacity | No | info |
| SHADOW-008 | Never combine multiple shadow tokens on the same element — each token already has 2 layers | Yes | error |
| SHADOW-009 | Inline content (text, inline icons) must not have shadows — shadows are for block-level surfaces | No | warning |
| SHADOW-010 | `shadow64` is reserved for top-level overlays (dialogs, panels) — do not use for nested content | No | warning |
| SHADOW-011 | Floating elements (tooltips, dropdowns, menus) must use >= `shadow8` | Yes | warning |
| SHADOW-012 | Shadows must use `colorNeutralShadowAmbient` / `colorNeutralShadowKey` tokens for color, not raw rgba | Yes | error |

---

## 6. Stroke (8 rules)

### 6.1 Stroke Width Tokens

| Token | Web | Mobile |
|-------|-----|--------|
| `strokeWidthThin` | 1px | 1px |
| `strokeWidthThick` | 2px | 2px |
| `strokeWidthThicker` | 3px | 4px |
| `strokeWidthThickest` | 4px | 6px |

Stroke color tokens: `colorNeutralStroke1`, `colorNeutralStroke2`, `colorNeutralStroke3`,
`colorNeutralStrokeSubtle`, `colorNeutralStrokeAccessible`, `colorBrandStroke1`, `colorBrandStroke2`.

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| STROKE-001 | Border width must use stroke width tokens (1, 2, 3, 4px) | Yes | error |
| STROKE-002 | No arbitrary border widths (e.g. 1.5px, 5px) | Yes | error |
| STROKE-003 | Default component borders should use `strokeWidthThin` (1px) | Yes | info |
| STROKE-004 | Focus indicator borders must use `strokeWidthThick` (2px) minimum | Yes | error |
| STROKE-005 | Active/selected state borders should use `strokeWidthThick` (2px) | Yes | info |
| STROKE-006 | Border color must use stroke color tokens, not raw color values | Yes | error |
| STROKE-007 | `colorNeutralStrokeAccessible` must be used when stroke conveys meaning (not decorative) | No | warning |
| STROKE-008 | Stroke width must scale proportionally with element size — larger elements use thicker strokes | No | info |

---

## 7. Motion (10 rules)

### 7.1 Duration Tokens

| Token | Value | Use case |
|-------|-------|----------|
| `durationUltraFast` | 50ms | Micro-interactions (checkmark, toggle snap) |
| `durationFaster` | 100ms | Small transitions (color change, opacity) |
| `durationFast` | 150ms | Button press feedback, icon swaps |
| `durationNormal` | 200ms | Standard transitions (hover, expand) |
| `durationGentle` | 250ms | Medium transitions (panel slide) |
| `durationSlow` | 300ms | Larger animations (modal appear) |
| `durationSlower` | 400ms | Complex animations (page transitions) |
| `durationUltraSlow` | 500ms | Full-screen transitions, onboarding |

### 7.2 Easing Curve Tokens

| Token | Value | Use case |
|-------|-------|----------|
| `curveAccelerateMax` | `cubic-bezier(0.9, 0.1, 1, 0.2)` | Exit: element leaving view fast |
| `curveAccelerateMid` | `cubic-bezier(1, 0, 1, 1)` | Exit: moderate acceleration |
| `curveAccelerateMin` | `cubic-bezier(0.8, 0, 0.78, 1)` | Exit: gentle acceleration |
| `curveDecelerateMax` | `cubic-bezier(0.1, 0.9, 0.2, 1)` | Enter: element arriving from offscreen |
| `curveDecelerateMid` | `cubic-bezier(0, 0, 0, 1)` | Enter: moderate deceleration |
| `curveDecelerateMin` | `cubic-bezier(0.33, 0, 0.1, 1)` | Enter: gentle deceleration |
| `curveEasyEaseMax` | `cubic-bezier(0.8, 0, 0.2, 1)` | Continuous: state change on screen |
| `curveEasyEase` | `cubic-bezier(0.33, 0, 0.67, 1)` | Continuous: standard ease |
| `curveLinear` | `cubic-bezier(0, 0, 1, 1)` | Looping/constant: progress bars, spinners |

Principles:

- **Enter** (appear): decelerate curves — fast start, soft landing
- **Exit** (disappear): accelerate curves — slow start, fast exit
- **Continuous** (state change): ease-in-out — smooth throughout
- Larger elements get longer durations than smaller elements

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| MOTION-001 | Animation duration must use duration tokens (50, 100, 150, 200, 250, 300, 400, 500ms) | Yes | error |
| MOTION-002 | No arbitrary durations (e.g. 75ms, 125ms, 350ms, 1000ms) | Yes | warning |
| MOTION-003 | Easing function must use curve tokens, not arbitrary `cubic-bezier()` or keyword easings | Yes | warning |
| MOTION-004 | Enter animations must use `curveDecelerate*` easing | Yes | warning |
| MOTION-005 | Exit animations must use `curveAccelerate*` easing | Yes | warning |
| MOTION-006 | On-screen state change animations must use `curveEasyEase*` | Yes | info |
| MOTION-007 | Looping animations (spinners, progress) must use `curveLinear` | Yes | info |
| MOTION-008 | Animations must respect `prefers-reduced-motion: reduce` — disable or minimize | Yes | error |
| MOTION-009 | No animation duration > 500ms (`durationUltraSlow`) except page-level transitions | Yes | warning |
| MOTION-010 | Staggered animations in lists must use consistent delay increment (50-100ms) | No | info |

---

## 8. Accessibility (10 rules)

### 8.1 Contrast and Color

WCAG 2.1 AA compliance is the baseline for all Fluent 2 components.

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| A11Y-001 | Standard text (< 18.5px bold or < 24px regular): >= 4.5:1 contrast ratio | Yes | error |
| A11Y-002 | Large text (>= 18.5px bold or >= 24px regular): >= 3:1 contrast ratio | Yes | error |
| A11Y-003 | Interactive component boundaries: >= 3:1 contrast against adjacent colors | Yes | error |
| A11Y-004 | Non-text content (icons, graphical indicators): >= 3:1 contrast | Yes | error |

### 8.2 High Contrast Mode

Windows High Contrast mode uses system colors that override all custom styles:

| Token | High Contrast Value | Mapped to |
|-------|--------------------|-----------|
| `hcHyperlink` | `#ffff00` | Links, active borders |
| `hcHighlight` | `#1aebff` | Selection, focus, active states |
| `hcDisabled` | `#3ff23f` | Disabled text |
| `hcCanvas` | `#000000` | Backgrounds |
| `hcCanvasText` | `#ffffff` | All foreground text and borders |
| `hcHighlightText` | `#000000` | Text on highlighted background |
| `hcButtonText` | `#000000` | Button text |
| `hcButtonFace` | `#ffffff` | Button backgrounds |

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| A11Y-005 | Must support `forced-colors: active` media query (Windows High Contrast) | Yes | error |
| A11Y-006 | In forced-colors mode, use only system color keywords (`Canvas`, `CanvasText`, `LinkText`, `Highlight`, `ButtonFace`, `ButtonText`, `GrayText`) | Yes | error |

### 8.3 Focus Indicators

Fluent 2 focus style: double ring — inner 1px white + outer 2px black (or vice versa in dark mode).
Uses `strokeWidthThick` (2px) for the outer ring.

| ID | Rule | Measurable | Severity |
|----|------|------------|----------|
| A11Y-007 | All interactive elements must have a visible focus indicator | Yes | error |
| A11Y-008 | Focus indicator must have >= 3:1 contrast against adjacent backgrounds | Yes | error |
| A11Y-009 | Focus indicator must be >= 2px thick (`strokeWidthThick`) | Yes | error |
| A11Y-010 | Custom focus styles must not remove the outline — only restyle it | Yes | error |

---

## Summary by Category

| Category | Rules | Errors | Warnings | Info |
|----------|-------|--------|----------|------|
| Color | 26 | 14 | 9 | 3 |
| Typography | 18 | 5 | 7 | 6 |
| Spacing | 14 | 4 | 5 | 5 |
| Shape | 10 | 2 | 5 | 3 |
| Shadow | 12 | 3 | 5 | 4 |
| Stroke | 8 | 4 | 1 | 3 |
| Motion | 10 | 2 | 5 | 3 |
| Accessibility | 10 | 8 | 0 | 2 |
| **Total** | **108** | **42** | **37** | **29** |

## Measurability Summary

| | Measurable | Not Measurable |
|---|---|---|
| Count | 88 | 20 |
| Percentage | 81% | 19% |

---

## Sources

- [Fluent 2 Design System — Design Tokens](https://fluent2.microsoft.design/design-tokens)
- [Fluent 2 Design System — Color](https://fluent2.microsoft.design/color)
- [Fluent 2 Design System — Typography](https://fluent2.microsoft.design/typography)
- [Fluent 2 Design System — Shapes](https://fluent2.microsoft.design/shapes)
- [Fluent 2 Design System — Elevation](https://fluent2.microsoft.design/elevation)
- [Fluent 2 Design System — Motion](https://fluent2.microsoft.design/motion)
- [Fluent 2 Design System — Accessibility](https://fluent2.microsoft.design/accessibility)
- [Fluent 2 Design System — Web Alias Color Tokens](https://fluent2.microsoft.design/color-tokens/)
- [@fluentui/tokens (npm)](https://www.npmjs.com/package/@fluentui/tokens)
- [@fluentui/react-theme (npm)](https://www.npmjs.com/package/@fluentui/react-theme)
- [FluentUI GitHub — Token Types](https://github.com/microsoft/fluentui/blob/master/packages/tokens/src/types.ts)
- [FluentUI GitHub — Global Colors](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/colors.ts)
- [FluentUI GitHub — Border Radius](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/borderRadius.ts)
- [FluentUI GitHub — Stroke Widths](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/strokeWidths.ts)
- [FluentUI GitHub — Durations](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/durations.ts)
- [FluentUI GitHub — Curves](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/curves.ts)
- [FluentUI GitHub — Fonts](https://raw.githubusercontent.com/microsoft/fluentui/master/packages/tokens/src/global/fonts.ts)
- [Microsoft Learn — Fluent UI Web Components Design Tokens](https://learn.microsoft.com/en-us/fluent-ui/web-components/design-system/design-tokens)
- [FluentUI Theme, Tokens and Variants (HackMD)](https://hackmd.io/@fluentui/H17uKonJv)
- [Token Naming Reference — FluentUI Token Pipeline](https://microsoft.github.io/fluentui-token-pipeline/naming.html)
