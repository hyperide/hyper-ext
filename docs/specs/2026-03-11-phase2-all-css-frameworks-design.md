# Phase 2 — All CSS Frameworks: Design Specification

**Date:** 2026-03-11
**Author:** Alex Ultra + Claude
**Status:** Approved
**Parent:** [HyperIDE Next Level Design](../plans/2026-03-09-hyperide-next-level-design.md)
**Linear:** TBD

## Vision

Make HyperIDE's visual inspector work with **any CSS framework**, not just Tailwind.
Deterministic per-framework adapters (not AI-based), composable for hybrid projects.
AI used only for Plain CSS cascade distribution.

## Subphases

| Subphase | Scope | Deliverable |
|----------|-------|-------------|
| **2a** | Foundation + InlineStyleAdapter | Adapter infra in `lib/`, route refactor, inline-style works e2e |
| **2b** | CSS-in-JS | EmotionAdapter (styled/css/sx), StyledComponentsAdapter |
| **2c** | CSS files | CSSModulesAdapter, PlainCSSAdapter (+ AI cascade) |
| **2d** | TW4 + CompositeAdapter | TailwindV4Adapter, per-property routing, auto-detection |

Each subphase = separate branch, separate PR, independently releasable.

---

## 1. Architecture

### Adapter Layer

Adapters move from `vscode-extension/.../color-token-provider.ts` to `lib/style-adapters/`.
Single source of truth for MCP tools, inspector (RightSidebar), and server.

```
lib/style-adapters/
  types.ts              -- StyleAdapter interface, ParsedStyles, detection types
  registry.ts           -- adapter registry + factory
  detection.ts          -- project-level + element-level detection
  inline-style/         -- InlineStyleAdapter
  tailwind-v3/          -- TailwindV3Adapter (refactor from current)
  tailwind-v4/          -- TailwindV4Adapter
  tamagui/              -- TamaguiAdapter (refactor from current)
  emotion/              -- EmotionAdapter
  styled-components/    -- StyledComponentsAdapter
  css-modules/          -- CSSModulesAdapter
  plain-css/            -- PlainCSSAdapter
  composite/            -- CompositeAdapter (per-property routing)
  shared/               -- shared utilities (template-literal-css, object-style-mutator, etc.)
```

### Interface

Two `StyleAdapter` interfaces exist in the codebase today:

- **Client-side** (`client/lib/canvas-engine/adapters/StyleAdapter.ts`):
  `read()`, `write()`, `writeBatch()`, `convertToProps()`, `changeLayout()`.
  Injected with `AstOperations` via constructor. Consumed by `useStyleSync`,
  `useElementStyleData`, RightSidebar.

- **Extension-side** (`vscode-extension/.../color-token-provider.ts`):
  `applyStyles()`, `resolveStyles()`. Takes `AstService` per call.
  Consumed by MCP tools.

Phase 2 unifies them into a single interface in `lib/style-adapters/types.ts`:

```typescript
interface StyleAdapter {
  readonly framework: FrameworkId;
  readonly writeMode: 'className' | 'props' | 'style-prop' | 'styled' | 'css-file';

  /** Read styles from AST node / DOM element */
  read(node: ASTNode, domElement?: HTMLElement): ParsedStyles;

  /** Write single style property */
  write(ctx: WriteContext): Promise<WriteResult>;

  /** Write multiple style properties in one operation (batch for undo) */
  writeBatch(ctx: WriteBatchContext): Promise<WriteResult>;

  /** Resolve styles for MCP (className string or style props -> CSS properties) */
  resolveStyles(params: ResolveInput): ResolveResult;

  /** Convert ParsedStyles to framework-specific props (Tamagui: CSS -> RN props) */
  convertToProps?(styles: Partial<ParsedStyles>): Record<string, unknown>;

  /** Change component layout type (e.g. Tamagui: Stack -> YStack -> XStack) */
  changeLayout?(ctx: ChangeLayoutContext): Promise<void>;
}

type FrameworkId =
  | 'tailwind-v3' | 'tailwind-v4'
  | 'tamagui'
  | 'emotion' | 'styled-components'
  | 'css-modules' | 'plain-css'
  | 'inline-style';
```

**writeMode routing in `useStyleSync`:**

| writeMode | Engine method | What happens |
|---|---|---|
| `'className'` | `engine.updateASTStyles()` | Tailwind: generates classes, mutates className attr |
| `'props'` | `engine.updateASTProps()` | Tamagui: converts to RN props, mutates JSX attrs |
| `'style-prop'` | `engine.updateASTProps()` | InlineStyle: mutates `style={{}}` object expression |
| `'styled'` | `engine.updateASTStyledDef()` | Emotion/SC: mutates styled() definition or css/sx prop |
| `'css-file'` | `engine.updateCSSFile()` | CSS Modules/Plain: mutates external `.css` file via PostCSS |

`'styled'` and `'css-file'` require new engine methods added in 2b and 2c respectively.

**Migration (Task 1 of Subphase 2a):**

1. Create unified interface in `lib/style-adapters/types.ts`
2. Refactor client-side `TailwindAdapter` and `TamaguiAdapter` to implement new interface
3. Refactor extension-side `TailwindStyleAdapter` and `TamaguiStyleAdapter` into thin wrappers
   that delegate to `lib/` adapters (adapting `AstService` calls)
4. Update `useStyleSync` to handle all 5 writeMode values (initially only `'className'`
   and `'props'` have implementations; others throw "not yet supported")
5. `ColorTokenProvider` also moves to `lib/style-adapters/` alongside its adapter

### Per-Property Write Logic

For each CSS property when writing:

1. **Property already exists** -> write where it currently lives (determined via `read()` from each active adapter)
2. **New property** -> priority chain:

   ```
   tailwind-v4 > tailwind-v3 > tamagui > emotion > styled-components > inline-style > css-modules > plain-css
   ```

3. **Conflict (property exists in multiple places)** -> remove from all, write by priority from #2
   (reduces to "new property" case)

### Element-Level Detection

For each selected element, analyze AST node:

| AST pattern | Adapter |
|---|---|
| `style={{ }}` prop | InlineStyleAdapter |
| `className={styles.foo}` + object CSS import | CSSModulesAdapter |
| `className="flex gap-4 ..."` (TW pattern) | TailwindAdapter |
| `styled(X)` / `css={}` / `sx={}` | Emotion or StyledComponents |
| Tamagui style props as JSX props | TamaguiAdapter |
| `className="some-class"` + side-effect CSS import | PlainCSSAdapter |
| `className="some-class"` without CSS import | PlainCSSAdapter (fallback, class in global styles) |

CSS Modules vs Plain CSS is distinguished by **import pattern**, not file extension:

- Object import (`import styles from './X.css'`) + `className={styles.bar}` -> CSS Modules
- Side-effect import (`import './X.css'`) + `className="bar"` -> Plain CSS

Extensions `.css`, `.scss`, `.less`, `.sass`, `.styl` all supported for both.

### FastPatchService

Universal for all frameworks — no framework-aware logic needed:

```typescript
element.style.setProperty(cssProp, value, 'important');
```

Inline `!important` overrides any cascade (CSS-in-JS runtime styles, CSS Modules, etc.).
Temporary — disappears after HMR re-render. Commit path writes to the correct place.

---

## 2. Subphase 2a — Foundation + InlineStyleAdapter

### Goal

Extract adapter pattern from extension, create infrastructure for all future adapters,
implement InlineStyleAdapter (simplest), refactor server route.

### Tasks

**1. Extract adapters to `lib/style-adapters/`**

- Move `StyleAdapter` interface, `ParsedStyles`, `ResolveInput`/`ResolveResult` from extension
- Move `TailwindStyleAdapter` and `TamaguiStyleAdapter` — make framework-agnostic
  (no dependency on extension API)
- Extension and client import from `lib/style-adapters/`
- Existing tests move along

**2. Adapter Registry**

```typescript
// lib/style-adapters/registry.ts
const adapters = new Map<FrameworkId, StyleAdapter>();

function registerAdapter(adapter: StyleAdapter): void;
function getAdapter(framework: FrameworkId): StyleAdapter;
function getAvailableAdapters(projectFrameworks: FrameworkId[]): StyleAdapter[];
```

**3. Project-level detection**

- Extend `detectUIKit()` -> `detectFrameworks()`: returns `FrameworkId[]` instead of single value
- Scans `package.json` deps:
  - `tailwindcss` v3.x -> `'tailwind-v3'`
  - `tailwindcss` v4.x -> `'tailwind-v4'`
  - `@emotion/react` or `@emotion/styled` -> `'emotion'`
  - `styled-components` -> `'styled-components'`
  - `tamagui` / `@tamagui/core` -> `'tamagui'`
- CSS Modules / Plain CSS / Inline Style — always available (no deps required)
- Update `SharedEditorState.projectUIKit` -> `projectFrameworks: FrameworkId[]`
- **Both detection paths must be updated:**
  - VS Code: `ProjectDetector.ts` `detectUIKit()` -> `detectFrameworks()`, result stored
    in `stateHub` via `applyUpdate('extension-host', { projectFrameworks: [...] })`
  - SaaS: `useProjectUIKit` hook -> `useProjectFrameworks`, calls same
    `/api/projects/:id/dependencies` endpoint but maps to `FrameworkId[]`
  - 19 files reference `projectUIKit` — all updated via backward-compat getter (see Section 5)

**4. InlineStyleAdapter**

```typescript
class InlineStyleAdapter implements StyleAdapter {
  framework = 'inline-style' as const;
  writeMode = 'style-prop' as const;

  read(node: ASTNode): ParsedStyles {
    // Parse style={{ backgroundColor: 'red', padding: '16px' }}
    // JSX expression -> object -> ParsedStyles
  }

  write(ctx: WriteContext): Promise<WriteResult> {
    // AST mutation: add/modify property in style={{}} object
    // If style={{}} doesn't exist — create it
  }

  resolveStyles({ styleProps }): ResolveResult {
    // styleProps -> CSS properties (1:1 mapping, camelCase -> kebab-case)
  }
}
```

**5. Refactor `updateComponentStyles` route**

- Replace hardcoded `generateTailwindClasses()` with adapter dispatch
- Client sends `projectFrameworks` in request (or detect on server)
- Element-level detection: analyze AST node, determine applicable adapters
- Per-property routing by rules from Section 1

**6. Update MCP tools**

- `getStyleAdapter()` and `getColorTokenProvider()` in extension import from `lib/style-adapters/`
- `ColorTokenProvider` interface and implementations (TailwindColorTokenProvider,
  TamaguiColorTokenProvider) also move to `lib/style-adapters/` alongside their adapters
- Thin wrappers in extension for MCP-specific logic (stateHub, astService)

**7. Add PostCSS dependency**

- PostCSS is needed in `lib/style-adapters/` for CSS file parsing (CSS Modules, Plain CSS)
  and template literal CSS parsing (Emotion, styled-components). Currently PostCSS is only
  in the Tailwind toolchain, not a direct `lib/` dependency.
- Add `postcss` to root `package.json` dependencies (used server-side and in extension,
  not bundled into client — CSS file operations happen on the backend)

### Result

- Any new adapter = file in `lib/style-adapters/<name>/adapter.ts`, register in registry, done
- InlineStyle works end-to-end (inspector reads/writes `style={{}}`)
- Server route is framework-agnostic
- Existing TW3 and Tamagui continue working as before

---

## 3. Subphase 2b — CSS-in-JS (Emotion + styled-components)

### Emotion — Three APIs

**a) `styled()` API:**

```tsx
// Template literal
const Button = styled.button`
  background-color: ${theme.colors.primary};
  padding: 16px;
`;
// Object syntax
const Button = styled.button({ backgroundColor: 'blue', padding: 16 });
```

**b) `css` prop (JSX Pragma):**

```tsx
<div css={{ backgroundColor: 'blue', padding: 16 }} />
<div css={css`background-color: blue; padding: 16px;`} />
```

**c) `sx` prop (MUI):**

```tsx
<Box sx={{ bgcolor: 'primary.main', p: 2, borderRadius: 1 }} />
```

### EmotionAdapter

```typescript
class EmotionAdapter implements StyleAdapter {
  framework = 'emotion' as const;
  writeMode = 'styled' as const;

  read(node: ASTNode): ParsedStyles {
    // 1. styled() — parse template literal (PostCSS) or object
    // 2. css prop — parse object or template literal
    // 3. sx prop — map MUI shorthand (bgcolor->backgroundColor, p->padding, etc.)
    // Return unified ParsedStyles
  }

  write(ctx: WriteContext): Promise<WriteResult> {
    // Mutate AST: update property in object / template literal
    // Write format matches read format (object -> object, template -> template)
  }
}
```

**MUI `sx` shorthand mapping** (`lib/style-adapters/emotion/sx-mapping.ts`):

```
p -> padding, px -> paddingLeft+paddingRight, py -> paddingTop+paddingBottom
m -> margin, mx, my, mt, mr, mb, ml
bgcolor -> backgroundColor
```

Bidirectional mapping: read `p: 2` -> `padding: '16px'` (x default 8px grid),
write `padding: '24px'` -> `p: 3`.

Note: MUI spacing is configurable via `theme.spacing` (default 8px). Phase 2b assumes
the default. Reading actual theme spacing factor is deferred to Phase 4 (theme token resolution).

### StyledComponentsAdapter

Supports both template literals and object syntax (object syntax since styled-components v4).
Reuses `template-literal-css.ts` and `object-style-mutator.ts` — same shared code as
EmotionAdapter.

```typescript
class StyledComponentsAdapter implements StyleAdapter {
  framework = 'styled-components' as const;
  writeMode = 'styled' as const;

  read(node: ASTNode): ParsedStyles {
    // Detect: template literal or object syntax
    // Template: parseTemplateLiteralCSS()
    // Object: parseObjectStyles()
  }

  write(ctx: WriteContext): Promise<WriteResult> {
    // Mutate in matching format (template -> template, object -> object)
    // Template: carefully preserve ${} expressions
    // Object: mutateObjectStyle()
  }
}
```

### Shared: Template Literal CSS Utilities

Reusable for Emotion `styled()` and styled-components:

```typescript
// lib/style-adapters/shared/template-literal-css.ts

/** Parse CSS from tagged template literal, skipping interpolations */
function parseTemplateLiteralCSS(quasi: TemplateLiteral): ParsedStyles;

/** Mutate CSS property inside template literal, preserving interpolations */
function mutateTemplateLiteralCSS(quasi: TemplateLiteral, prop: string, value: string): TemplateLiteral;
```

PostCSS parses static parts; interpolations replaced with placeholder
(`__EXPR_0__: inherit;`), after mutation — substituted back.

### Shared: Object Style Mutator

Reusable for Emotion `css={{}}`, `sx={{}}`, `styled.div({})`, and InlineStyleAdapter:

```typescript
// lib/style-adapters/shared/object-style-mutator.ts

/** Parse ObjectExpression from AST -> ParsedStyles */
function parseObjectStyles(expr: ObjectExpression): ParsedStyles;

/** Mutate: add/modify/remove property in ObjectExpression */
function mutateObjectStyle(expr: ObjectExpression, prop: string, value: string): void;
```

### Dynamic Styles

We already handle dynamic expressions in template literals and JSX props
(see `dynamic-classname-mutator.ts`, `mutator.ts`). The same approach applies:

- `${props => ...}` interpolations in template literals — existing
  `modifyStringLiteralInPlace()`, `appendToLastString()`, `wrapInConcatenation()` patterns
- Dynamic values in object syntax (`padding: isLarge ? 16 : 8`) — `setAttribute()` +
  `valueToJSXAttribute()` handles all expression types

Existing utilities from `lib/ast/dynamic-classname-mutator.ts` and `lib/ast/mutator.ts`
will be generalized, extracted into reusable classes in `lib/style-adapters/shared/`,
and covered with tests.

### Element-Level Detection for CSS-in-JS

1. **Component declared via `styled()`** — look at component definition (by name from JSX),
   find `styled.div`/`styled(Base)` in scope
2. **Which package** — trace `styled` import to `@emotion/styled` or `styled-components`
3. **`css` prop** — find `css` JSX attribute, trace `css` import to `@emotion/react`
4. **`sx` prop** — find `sx` JSX attribute, check component is from `@mui/material`

### Reading Styles — Two Sources

1. **AST** — parse template literal or object, get static values
2. **DOM** — `getComputedStyle()` for dynamic values (interpolations, theme tokens)

Inspector shows AST value if static, computed value if dynamic.
On write — mutate AST (replace dynamic with static, or add new property).

### Limitations (Phase 2b scope)

- **Theme tokens** (`${theme.colors.primary}`) — show resolved value from DOM,
  on write set literal. Theme token mapping -> Phase 4 (AI Integration).
- **MUI `sx` responsive** (`sx={{ p: { xs: 1, md: 2 } }}`) — show as "complex",
  don't edit. Support in future.

---

## 4. Subphase 2c — CSS Modules + Plain CSS

### Key Difference

Styles live in **separate CSS files**, not in JSX. Requires:

1. Find CSS file by import in component
2. Find rule by selector
3. Mutate CSS file (PostCSS)
4. Link JSX `className` to CSS rule

### CSS Modules

**Reading:**

```tsx
import styles from './Component.module.css';
<div className={styles.card} />
```

1. AST: `styles.card` -> find import `./Component.module.css` -> resolve path
2. Parse CSS file via PostCSS, find `.card { ... }`
3. Read properties from rule -> `ParsedStyles`

**Writing:**

1. Find rule `.card` in CSS file
2. PostCSS mutation: add/modify property
3. Write CSS file
4. HMR picks up changes

**Nuances:**

- CSS Modules auto-scopes classes — no specificity problems
- One class = one rule (usually), almost no cascade within module
- `composes: base from './base.module.css'` — resolve compose-chain on read.
  Note: `composes` can chain recursively across files. If this causes a complexity spike,
  defer recursive resolution and only resolve single-level `composes` in Phase 2c.
- Nested selectors (`:hover`, `&__title`) — support read, write to correct nested block
- SCSS/Less/Stylus — PostCSS parses with corresponding syntax plugin
  (`postcss-scss`, `postcss-less`). Support as stretch goal for Phase 2c;
  core delivery targets `.css` files only. SCSS/Less add per-preprocessor testing burden.

**CSSModulesAdapter:**

```typescript
class CSSModulesAdapter implements StyleAdapter {
  framework = 'css-modules' as const;
  writeMode = 'css-file' as const;

  read(node: ASTNode): ParsedStyles {
    // 1. Find className={styles.X} in JSX
    // 2. Trace import -> resolve CSS file path
    // 3. PostCSS parse -> find .X rule -> extract properties
  }

  write(ctx: WriteContext): Promise<WriteResult> {
    // 1. Resolve CSS file path (cached from read)
    // 2. PostCSS parse -> find rule -> mutate property
    // 3. Write CSS file
  }
}
```

### Plain CSS

**Reading:**

```tsx
import './styles.css';
<div className="card hero-card" />
```

1. AST: `className="card hero-card"` -> side-effect import `./styles.css`
2. Parse CSS file, find `.card`, `.hero-card`
3. **Cascade**: may be multiple rules matching element (`.card`, `.card.hero-card`,
   `div.card`, media queries)
4. Collect all rules -> computed values respecting specificity

**Writing — two modes:**

**a) Inspector (RightSidebar) — AI distributes across cascade:**

1. User changes `backgroundColor` in inspector
2. AI receives context: all matching rules + current computed value
3. AI decides where to write: existing rule or create new one
4. PostCSS mutation of chosen rule
5. If AI unavailable — fallback: write to most specific rule

**b) DevTools CSS Panel — user picks rule directly:**

1. Show all rules like Chrome DevTools
2. User clicks on property in specific rule
3. Direct mutation of that rule (no AI)

**PlainCSSAdapter:**

```typescript
class PlainCSSAdapter implements StyleAdapter {
  framework = 'plain-css' as const;
  writeMode = 'css-file' as const;

  read(node: ASTNode, domElement?: HTMLElement): ParsedStyles {
    // 1. className="card" -> find side-effect CSS imports
    // 2. Search ALL imported CSS files for matching selectors
    // 3. Resolve cascade (specificity order)
    // 4. Return merged ParsedStyles
  }

  write(ctx: WriteContext): Promise<WriteResult> {
    // ctx.cascadeMode: 'auto' (AI) | 'manual' (DevTools panel, rule specified)
    // Auto: AI picks target rule
    // Manual: write to ctx.targetRule
  }
}
```

### Shared CSS File Utilities

```
lib/style-adapters/shared/
  css-file-resolver.ts   -- resolve CSS file path from JSX import
  css-rule-finder.ts     -- PostCSS: find rules matching selector
  css-rule-mutator.ts    -- PostCSS: add/modify/remove property in rule
  cascade-resolver.ts    -- sort rules by specificity, compute final values
```

Reused by both adapters. `CSSModulesAdapter` calls finder + mutator directly (no cascade).
`PlainCSSAdapter` adds cascade resolution + AI routing.

### Limitations (Phase 2c scope)

- **Global CSS files** (not imported in component) — not supported.
  Only CSS from direct component imports. Global styles visible via `getComputedStyle()`
  but mutating them is dangerous.
- **DevTools CSS Panel** — separate UI component, may be deferred if scope grows.
  Minimum: inspector + AI cascade for plain CSS.
- **Media queries / container queries** — read them, but write only to active rule
  (currently applied). Breakpoint switching is a separate feature.

---

## 5. Subphase 2d — TW4 + CompositeAdapter

### TW4 vs TW3 Differences

| | TW3 | TW4 |
|---|---|---|
| Config | `tailwind.config.js` | `@theme` in CSS (`app.css`) |
| Custom values | `theme.extend.colors` | `@theme { --color-brand: #xx }` |
| Arbitrary values | `bg-[#ff0000]` | `bg-[#ff0000]` (same) |
| New syntax | -- | `bg-red-500/50` (opacity modifier) |
| Default border color | `border-gray-200` | `currentColor` |
| Container queries | plugin | built-in `@container` |

### TailwindV4Adapter

Inherits 90% from TailwindV3Adapter:

```typescript
class TailwindV4Adapter extends TailwindV3Adapter {
  framework = 'tailwind-v4' as const;

  // Override: read custom tokens from @theme in CSS, not tailwind.config.js
  protected resolveCustomTokens(projectPath: string): TokenMap { ... }

  // Override: opacity modifier syntax
  protected generateColorClass(prop: string, value: string): string { ... }

  // Override: version-specific defaults
  protected getDefaults(): Defaults { ... }
}
```

### Auto-Detection TW3 vs TW4

```typescript
if (deps.tailwindcss) {
  // package.json values can be ranges (^3.4.0, ~4.0.0) — coerce to clean semver first
  const coerced = semver.coerce(deps.tailwindcss);
  const major = coerced ? semver.major(coerced) : 3;
  frameworks.push(major >= 4 ? 'tailwind-v4' : 'tailwind-v3');
}
```

### CompositeAdapter

Core of Phase 2 — per-property router between adapters.

CompositeAdapter is a router, not a framework — it does not appear in `FrameworkId`.
It implements `StyleAdapter` but its `framework` field is typed separately:

```typescript
class CompositeAdapter implements Omit<StyleAdapter, 'framework'> & { framework: 'composite' } {
  framework = 'composite' as const;

  constructor(
    private adapters: StyleAdapter[],        // adapters for this element
    private projectAdapters: StyleAdapter[],  // all project adapters (for priority)
  ) {}

  read(node: ASTNode, domElement?: HTMLElement): ParsedStyles {
    // 1. Each adapter reads its styles
    // 2. Merge: if property read by multiple — take by priority
    // 3. Track source: { backgroundColor: { value: 'red', adapter: 'tailwind-v3' } }
    return mergedStyles;
  }

  write(ctx: WriteContext): Promise<WriteResult> {
    const { property, value } = ctx;

    // 1. Property already exists -> write where it is now
    const source = this.findPropertySource(property);
    if (source) {
      // Conflict: property in multiple places -> remove from all, write by priority
      if (this.hasConflict(property)) {
        await this.removeFromAll(property);
        const target = this.pickByPriority(property);
        return target.write(ctx);
      }
      return source.adapter.write(ctx);
    }

    // 2. New property -> priority
    const target = this.pickByPriority(property);
    return target.write(ctx);
  }

  private pickByPriority(property: string): StyleAdapter {
    const priority: FrameworkId[] = [
      'tailwind-v4', 'tailwind-v3', 'tamagui',
      'emotion', 'styled-components',
      'inline-style', 'css-modules', 'plain-css',
    ];
    for (const fw of priority) {
      const adapter = this.projectAdapters.find(a => a.framework === fw);
      if (adapter) return adapter;
    }
    // fallback — inline style is always available
    return this.adapters.find(a => a.framework === 'inline-style')!;
  }
}
```

### When CompositeAdapter is Created

```typescript
function getAdapterForElement(
  node: ASTNode,
  projectFrameworks: FrameworkId[],
): StyleAdapter {
  const elementAdapters = detectElementAdapters(node);

  if (elementAdapters.length === 0) {
    // Element without styles — return highest-priority project adapter
    return getAdapter(projectFrameworks[0]);
  }
  if (elementAdapters.length === 1) {
    return elementAdapters[0];
  }
  // Multiple adapters — composite
  return new CompositeAdapter(elementAdapters, getAvailableAdapters(projectFrameworks));
}
```

### Type Updates

```typescript
// SharedEditorState — replaces projectUIKit: string
projectFrameworks: FrameworkId[];

// Backward compatibility during transition
// projectUIKit remains as computed getter:
get projectUIKit(): 'tailwind' | 'tamagui' | 'none' {
  if (this.projectFrameworks.includes('tailwind-v3') ||
      this.projectFrameworks.includes('tailwind-v4')) return 'tailwind';
  if (this.projectFrameworks.includes('tamagui')) return 'tamagui';
  return 'none';
}
```

---

## 6. Testing Strategy

### Per-Adapter Unit Tests

Each adapter tested in isolation:

- `read()` — fixtures with AST nodes, verify correct `ParsedStyles`
- `write()` — mutate AST, verify result (snapshot or string comparison)
- `resolveStyles()` — MCP-level, input -> output

### Fixtures — Real Code Patterns

```
lib/style-adapters/__fixtures__/
  inline-style/
    basic.tsx            -- <div style={{ padding: '16px' }} />
    dynamic.tsx          -- <div style={{ padding: isLarge ? '24px' : '16px' }} />
    spread.tsx           -- <div style={{ ...base, padding: '16px' }} />
  emotion/
    styled-template.tsx  -- styled.div`padding: 16px;`
    styled-object.tsx    -- styled.div({ padding: 16 })
    css-prop.tsx         -- <div css={{ padding: 16 }} />
    sx-prop.tsx          -- <Box sx={{ p: 2, bgcolor: 'primary.main' }} />
  styled-components/
    basic.tsx            -- styled.div`padding: 16px;`
    interpolation.tsx    -- styled.div`padding: ${p => p.large ? '24px' : '16px'};`
  css-modules/
    component.tsx        -- import styles from './X.module.css'
    styles.module.css    -- .card { padding: 16px; }
    styles.module.scss   -- .card { padding: 16px; &:hover { ... } }
  plain-css/
    component.tsx        -- import './styles.css'; className="card"
    styles.css           -- .card { padding: 16px; } .card.active { ... }
  tailwind-v4/
    basic.tsx            -- className="p-4 bg-red-500/50"
    theme.css            -- @theme { --color-brand: #ff0000 }
```

### Integration Tests (CompositeAdapter)

- Element with `className="flex" style={{ backgroundColor: 'red' }}` -> composite TW + Inline
- Per-property routing: `backgroundColor` writes to inline (already there),
  new `gap` writes to TW (priority)
- Conflict: `padding` in TW and inline -> remove both, write to TW

### Shared Utilities Tests

- `template-literal-css.ts` — parse/mutate CSS in template literals with interpolations
- `object-style-mutator.ts` — parse/mutate JS style objects
- `css-file-resolver.ts` — resolve CSS file path from JSX imports
- `css-rule-finder.ts` / `css-rule-mutator.ts` — PostCSS operations

### E2E Verification (Manual + MCP)

- For each adapter: open test project, select element, change style in inspector, verify file
- Test projects in `templates/` (create minimal project for each framework if missing)

---

## 7. Migration Path

### Backward Compatibility

Phase 2 does not break existing functionality:

1. **`projectUIKit`** remains as computed property over `projectFrameworks[]`
2. **TailwindV3Adapter** — refactored (moved to `lib/`), but API identical
3. **TamaguiAdapter** — same
4. **updateComponentStyles route** — dispatch via adapter, but for TW3 calls same
   `generateTailwindClasses()`
5. **MCP tools** — `getStyleAdapter()` / `getColorTokenProvider()` import from `lib/`,
   but behavior is the same

### Migration Order

```
2a: Extract adapters + InlineStyle + route refactor
    -> everything works as before + new adapter
2b: Emotion + styled-components
    -> CSS-in-JS projects start working
2c: CSS Modules + Plain CSS
    -> coverage of all CSS approaches
2d: TW4 + CompositeAdapter
    -> hybrid projects + TW4
```

Each subphase = separate branch, separate PR, mergeable and releasable independently.

---

## Decisions Log

Key decisions from the original brainstorming session (2026-03-09) and this design session:

1. **Deterministic adapters per framework** (not AI-based universal adapter).
   AI only for Plain CSS cascade distribution. User explicitly chose this over AI-first approach.
2. **Element-level detection** (not project-level). Project knows available frameworks,
   but each element uses its own adapter based on AST analysis.
3. **Per-property write routing** with priority chain.
   Properties write where they already exist; new properties follow priority.
4. **Conflict resolution**: remove from all locations, write by priority (reduce to new-property case).
5. **FastPatchService**: universal `element.style.setProperty(prop, value, 'important')` for all
   frameworks. No framework-aware logic needed.
6. **Fallback**: always prefer Tailwind when nothing detected or for new styles in hybrid projects.
7. **Tamagui high priority** (partner's interest).
8. **Subphase split**: 2a (foundation) -> 2b (CSS-in-JS) -> 2c (CSS files) -> 2d (TW4 + composite).

## Current Codebase Readiness

**Framework-agnostic (no changes needed):**

- `ParsedStyles` — common currency (~40 CSS properties)
- `StyleAdapter` client interface: `read()`, `write()`, `writeBatch()`, `convertToProps()`
- `useStyleSync` — routes via `styleAdapter.writeMode`
- `useElementStyleData` — calls `styleAdapter.read()` abstractly
- RightSidebar sections — all use `syncStyleChange(key, value)`
- Style verification — reads computed CSS from DOM
- CanvasEngine — routes to API, framework-agnostic

**Server route — significant Tailwind coupling:**

- `server/routes/updateComponentStyles.ts` (276 lines) — deeply TW-specific:
  - Static className: `generateTailwindClasses()`, `removeConflictingClasses()` (lines 112-143)
  - Dynamic className: AI analysis via `getCachedOrAnalyze()`, `modifyDynamicClassName()`
    with location-based and fallback strategies (lines 146-245)
  - Instance props and state handling

  **Refactoring plan:** Static className dispatch is straightforward (adapter.write).
  The dynamic className AI analysis path stays Tailwind-specific (behind framework check)
  until a generic dynamic-value mutation strategy is designed per-framework.
  Other frameworks start with static-only write, dynamic support added incrementally.

## References

- [HyperIDE Next Level Design](../plans/2026-03-09-hyperide-next-level-design.md) — parent design doc
- [Universal Styling Adapters Spec](2026-03-10-universal-styling-adapters.md) — HYP-283 (Phase 2 precursor)
- [Phase 1 Visual Foundation Plan](../plans/2026-03-09-phase1-visual-foundation.md) — predecessor
- Original brainstorm session: `228174ff-6165-4045-83b0-7028e3712240` (2026-03-08/09)
