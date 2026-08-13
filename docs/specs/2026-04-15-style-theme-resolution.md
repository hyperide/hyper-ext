> **⚠️ SUPERSEDED** by the [2026-06-12 Styles System Master Spec](./2026-06-12-styles-system-master-spec.md) (see Part/§ 7, 8). Retained for history; do not follow for new work.

# Style Theme Resolution and Write Routing

**Date:** 2026-04-15
**Status:** Draft
**Scope:** Theme-aware inspector reads/writes for VS Code extension and SaaS
**Parent spec:** `docs/specs/2026-04-14-style-write-unification-plan.md`

## Problem

Theme-aware style writes cannot be modeled as only `dark` / `light` tabs.
Projects can express themes through:

```text
CSS prefers-color-scheme media queries
class or data selectors such as .dark, [data-theme='dark']
CSS variables with different values per theme
different CSS variables with fallback chains
Tailwind dark variants and theme tokens
MUI/Chakra/Mantine/Tamagui theme providers and config objects
React ternaries and if branches
CSS-in-JS callbacks that receive a theme object
component props such as colorScheme, theme, variant, or size
```

The inspector must distinguish:

```text
runtime theme context:
  which theme the preview is currently rendering

source theme condition:
  which source branch/rule/config entry owns a declaration

theme token/value graph:
  how the rendered value was resolved from variables, tokens, fallbacks, and
  library theme config

write target:
  the concrete source location to mutate
```

## Terminology

```text
IDE theme preference:
  user selection from HyperIDE or VS Code: light, dark, or system.

Resolved color scheme:
  the effective preview color scheme after resolving system against the browser
  or OS setting. Values are light or dark.

Theme condition:
  a source condition such as color-scheme=dark, brand=acme, density=compact, or
  contrast=high.

Theme axis:
  the dimension being selected. Common axes are color-scheme, brand, density,
  contrast, and platform. Projects may define custom axes.

Theme token:
  a symbolic value such as var(--color-primary), theme.colors.primary,
  $background, text-primary, or a vanilla-extract theme contract property.

Theme value owner:
  the source location that defines a token or variable value for a theme branch.

Usage owner:
  the source location that uses the token, variable, class, style prop, or CSS
  declaration on the selected element.
```

`system` is an IDE preference, not a durable source condition. A preview with
`ideThemePreference: 'system'` must resolve to `resolvedColorScheme: 'light'` or
`'dark'` before read/write routing.

## Runtime Context

VS Code and SaaS must pass the same runtime theme context into the shared read
and write managers.

```typescript
type IdeThemePreference = 'light' | 'dark' | 'system';

type ResolvedColorScheme = 'light' | 'dark';

type RuntimeThemeSource = 'hyperide' | 'vscode' | 'browser-system' | 'app-runtime' | 'test-fixture';

interface RuntimeThemeContext {
  ideThemePreference: IdeThemePreference;
  resolvedColorScheme: ResolvedColorScheme;
  source: RuntimeThemeSource;
  selectedTheme?: ThemeCondition[];
}
```

Rules:

```text
HyperIDE/SaaS:
  pass the selected HyperIDE theme preference into the preview and shared
  manager calls.

VS Code:
  pass the VS Code color theme kind/preference into the preview and shared
  manager calls.

system:
  resolve to light/dark for CSS media emulation and read/write routing.
  keep ideThemePreference='system' only as UI/runtime metadata.

tests:
  fixtures must be able to inject RuntimeThemeContext without depending on the
  developer's real OS theme.
```

## Theme Condition Model

The parent spec's `StyleCondition.theme` field uses this shape:

```typescript
type ThemeAxisId = 'color-scheme' | 'brand' | 'density' | 'contrast' | 'platform' | (string & {});

type ThemeConditionSource =
  | 'prefers-color-scheme'
  | 'tailwind-dark-selector'
  | 'mui-color-scheme'
  | 'chakra-color-mode'
  | 'mantine-color-scheme'
  | 'tamagui-theme'
  | 'data-attribute'
  | 'class-selector'
  | 'css-variable-scope'
  | 'script-condition'
  | 'theme-provider'
  | 'library-theme-config'
  | 'custom';

interface ThemeCondition {
  axis: ThemeAxisId;
  value: string;
  source: ThemeConditionSource;
  selector?: string;
  query?: string;
  expression?: string;
  provider?: string;
  configPath?: string;
}
```

Examples:

```typescript
{ axis: 'color-scheme', value: 'dark', source: 'prefers-color-scheme', query: '(prefers-color-scheme: dark)' }
{ axis: 'color-scheme', value: 'dark', source: 'tailwind-dark-selector', selector: '.dark &' }
{ axis: 'brand', value: 'enterprise', source: 'data-attribute', selector: "[data-brand='enterprise'] &" }
{ axis: 'density', value: 'compact', source: 'theme-provider', provider: 'mantine' }
```

Theme conditions may compose with viewport, container, media/supports, selector,
and pseudo-state conditions.

```text
dark:md:hover:bg-red-500
  -> theme color-scheme=dark
  -> viewport md
  -> state hover

@media (prefers-color-scheme: dark) {
  @container card (min-width: 480px) {
    .card:hover { ... }
  }
}
  -> theme color-scheme=dark
  -> container card
  -> state hover
```

## Project Theme Capabilities

Project theme capabilities are detected from packages, config files, CSS files,
JS/TS source, and runtime facts. They are project-level facts, not user-facing
source tabs.

```typescript
interface ProjectThemeCapabilities {
  axes: ThemeAxisCapability[];
  mechanisms: ThemeMechanism[];
  tokenSources: ThemeTokenSource[];
}

interface ThemeAxisCapability {
  id: ThemeAxisId;
  values: string[];
  defaultValue?: string;
  source: 'config' | 'css' | 'runtime' | 'library' | 'inferred';
}

type ThemeMechanism =
  | 'prefers-color-scheme'
  | 'class-selector'
  | 'data-attribute'
  | 'css-custom-properties'
  | 'tailwind-dark-variant'
  | 'tailwind-theme'
  | 'mui-theme'
  | 'chakra-theme'
  | 'mantine-theme'
  | 'tamagui-theme'
  | 'vanilla-extract-theme'
  | 'css-in-js-theme-callback'
  | 'script-branch';

interface ThemeTokenSource {
  kind:
    | 'css-custom-property'
    | 'tailwind-token'
    | 'mui-theme-token'
    | 'chakra-theme-token'
    | 'mantine-theme-token'
    | 'tamagui-token'
    | 'vanilla-extract-token'
    | 'css-in-js-theme-token';
  filePath?: string;
  owner?: string;
}
```

## Source Patterns

### CSS Variable, Same Name Per Theme

```css
:root {
  --card-bg: #ffffff;
}

.dark {
  --card-bg: #111827;
}

.card {
  background: var(--card-bg);
}
```

Read model:

```text
usage owner:
  .card background uses var(--card-bg)

theme value owner:
  :root defines --card-bg for base/light
  .dark defines --card-bg for color-scheme=dark
```

Write policy:

```text
selected source tab .card:
  change the usage declaration only when the user intends to stop using the
  token/variable.

linked token mode or selected theme value owner:
  mutate the theme-specific variable definition.

Computed tab with AI enabled:
  route color edits to the semantically appropriate variable when confidence is
  high; otherwise require source selection or fallback.
```

### CSS Variable, Different Names And Fallbacks

```css
.card {
  background: var(--card-bg-dark, var(--card-bg, #ffffff));
}
```

Read model must preserve the full fallback chain:

```text
var(--card-bg-dark)
  fallback var(--card-bg)
    fallback #ffffff
```

Write policy:

```text
Do not blindly rewrite the fallback literal.
Prefer the first resolvable variable definition for the active theme.
If no variable definition exists, create one only when the selected source
owner or adapter policy permits variable creation.
Otherwise route to explicit source selection or InlineStyleAdapter fallback.
```

### Tailwind Dark Variant

```tsx
<div className="bg-white dark:bg-gray-950" />
```

Read model:

```text
bg-white:
  condition theme empty/base

dark:bg-gray-950:
  condition theme color-scheme=dark with source tailwind-dark-selector or
  prefers-color-scheme depending on Tailwind config
```

Write policy:

```text
dark theme tab selected:
  write dark:<utility> class.

All/base selected:
  write non-dark utility.

system selected:
  resolve to light/dark in RuntimeThemeContext, then route as that branch.
```

### Script Branches

```tsx
<div style={{ color: isDark ? '#ffffff' : '#111827' }} />
```

or:

```tsx
const cardStyle = isDark ? { color: '#ffffff' } : { color: '#111827' };
```

Read model:

```text
condition source:
  script-condition

condition expression:
  isDark or theme.mode === 'dark' when statically recoverable
```

Write policy:

```text
Exact branch:
  mutate only the selected branch.

Probable branch:
  require explicit source tab, AI route, or diagnostic confirmation.

Unknown expression:
  preserve as computed/probable; do not create a new branch automatically.
```

### CSS-in-JS Theme Callback

```tsx
const Card = styled.div(({ theme }) => ({
  color: theme.palette.mode === 'dark' ? theme.palette.grey[100] : theme.palette.grey[900],
}));
```

Read model:

```text
usage owner:
  scriptReactStyleRule or scriptNativeStyleRule

theme condition:
  script-condition or library-theme-config depending on resolver confidence

token graph:
  theme.palette.grey[100] / theme.palette.grey[900]
```

Write policy:

```text
Token-linked edit:
  write theme token/config when selected and resolvable.

Local override edit:
  write the selected branch inside the style callback.

Unsupported callback:
  computed-only/probable; require source tab or fallback.
```

### Component Library Theme Config

Examples:

```text
MUI:
  createTheme({ palette: { mode: 'dark', primary: { main: ... } } })
  CssVarsProvider color schemes

Chakra:
  semanticTokens and color mode conditions

Mantine:
  theme.colors, colorScheme, variantColorResolver

Tamagui:
  themes and tokens in Tamagui config
```

Write policy:

```text
Standard inspector property:
  may write library theme config only through a registered mapper/resolver and
  explicit token/source ownership.

Semantic component props:
  theme, variant, colorScheme, size, intent, and status stay in the recursive
  props editor unless a mapper explicitly owns their visual conversion.

No mapper:
  do not infer writes to arbitrary theme props from computed CSS.
```

## UI

Theme controls sit above source tabs and pseudo-state controls when the selected
element or project has theme owners.

```text
[All themes] [light] [dark] [system -> dark] [brand: enterprise]
[Computed] [Tailwind] [.card] [sx prop] [Props] [Inline override]
[Base] [Hover] [Focus] [Active]
```

Rules:

```text
All themes:
  write the base/non-themed owner when exact, or ask the router to choose a
  source. It must not duplicate writes into every known theme branch by default.

light/dark:
  write the explicit color-scheme branch.

system:
  preview selection only. Resolve to light/dark before routing.

brand/density/contrast:
  shown only when detected from project capabilities or source owners.

Computed tab:
  AI routing has priority for ambiguous theme token/value owners when AI is
  available. Explicit source tab still wins.
```

## Manager Responsibilities

```text
ThemeContextResolver:
  combines RuntimeThemeContext, ProjectThemeCapabilities, ElementStyleFacts, and
  preview runtime facts into active ThemeCondition values.

StyleReadManager:
  reads values under the active runtime theme context and emits source owners
  with theme conditions and optional token/value graph metadata.

InspectorValueCodec:
  validates and normalizes user input to canonical inspector form only.
  No per-target value mapping and no theme routing decisions. It must not
  decide whether a color should write to a variable, token, class, or
  theme config.

TokenLinkResolver:
  resolves linked token mode to target-specific references and theme value
  owners.

StyleWriteManager:
  routes a write to usage owner, theme value owner, component mapper, or fallback
  according to source tab, condition, confidence, and project policy.
```

## Test Matrix

Unit tests:

```text
RuntimeThemeContext:
  - HyperIDE light/dark/system resolves deterministically
  - VS Code light/dark/system resolves deterministically
  - system never appears as a source condition

ThemeCondition classification:
  - Tailwind dark class -> theme color-scheme=dark
  - @media prefers-color-scheme -> theme color-scheme=dark/light
  - .dark and [data-theme='dark'] -> class/data theme conditions
  - script ternary -> script-condition with expression when recoverable

CSS variables:
  - same variable name per theme maps to usage owner + theme value owners
  - fallback chain is preserved in order
  - fallback literal is not selected for writes when a variable definition exists

Library themes:
  - MUI sx/theme tokens preserve token graph and condition
  - Chakra/Mantine/Tamagui theme values route only through mapper/resolver
  - unsupported theme/variant/colorScheme props remain recursive-props only
```

VS Code / SaaS E2E:

```text
Preview theme propagation:
  - set product preference to light/dark/system
  - select themed element
  - assert read values match the resolved preview theme
  - assert no DOM-rendered runtime error overlay appears

Theme branch write:
  - select dark condition
  - edit color/background
  - assert source mutation touches only the dark owner

CSS variable write:
  - select linked token/theme value owner
  - edit color
  - assert source mutation changes the variable definition, not the usage
    declaration

Script branch write:
  - select exact dark script branch
  - edit value
  - assert only that branch changes
```

## Acceptance Criteria

- Runtime theme context is shared by VS Code and SaaS through the same manager
  inputs.
- `system` is resolved to light/dark before source routing.
- Theme conditions are represented as source ownership metadata, not as a
  separate CSS system.
- CSS variable usage owners and theme value owners are distinguishable.
- Fallback chains are preserved and not blindly rewritten.
- Component library theme config writes require registered mappers/resolvers.
- Unsupported theme/variant props remain in the recursive props editor.
- E2E tests fail on DOM-rendered runtime error overlays during theme scenarios.
