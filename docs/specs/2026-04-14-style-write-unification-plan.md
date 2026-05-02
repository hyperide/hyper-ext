# Style Write Unification Plan

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Inspector style reads/writes for VS Code extension and SaaS
**Related specs:**
- `docs/specs/2026-03-10-universal-styling-adapters.md` — earlier adapter
  direction; retained where it argues for shared framework-aware style
  infrastructure, superseded where it implies one broad adapter surface.
- `docs/specs/2026-03-11-phase2-all-css-frameworks-design.md` — original
  all-CSS-frameworks Phase 2 design; fully superseded for style-write
  architecture by this document, with coverage mapped below.
- `docs/specs/2026-04-09-shared-error-overlays-design.md` — related runtime
  diagnostics design; kept as the source for rendered DOM error detection
  expectations in E2E and preview verification.
- `docs/specs/2026-04-14-style-source-confidence.md` — source ownership
  confidence semantics for `exact`, `probable`, and `computed-only`.
- `docs/specs/2026-04-14-style-source-owner.md` — detailed explanation of
  `StyleSourceOwner`, `CssSystemId`, and `sourceForm`.
- `docs/specs/2026-04-15-style-theme-resolution.md` — theme runtime context,
  theme conditions, CSS variable/token ownership, and theme-aware write routing.

**Supersession:** this document is intended to become the canonical styling
write architecture. It incorporates the March 11 Phase 2 direction, but changes
several decisions:

```text
Kept:
  - all-framework adapter direction
  - element-level detection
  - CSS Modules / plain CSS file writes
  - CSS-in-JS adapters
  - Tailwind v3/v4 support
  - composite/per-property routing
  - PostCSS-based CSS file mutation
  - framework fixture matrix

Changed:
  - old flat `StyleAdapter` interface -> framework adapter umbrellas + read/write managers
  - writeMode routing -> explicit StyleWritePlan union
  - global priority chain -> property owner / element owner / source tabs policy
  - temporary inline fallback -> permanent InlineStyleAdapter universal fallback
  - deterministic owner first for CSS classes -> explicit source tab first, then
    AI semantic routing on Computed tab when enabled
  - separate extension/server analyzer ideas -> shared analyzer with DI only for
    FileIO/cache/logger/runtime facts
```

### Coverage of March 11 Phase 2 spec

`2026-03-11-phase2-all-css-frameworks-design.md` is fully superseded by this
document for style-write architecture. The old technical scope is carried
forward as follows:

| March 11 section | Status in this spec |
|---|---|
| Vision: any CSS framework | Kept as canonical goal for unified style writes. |
| DS Core integration | Kept as dependency direction: DS Core consumes read/write services through DI; style-write does not depend on DS Core. |
| Subphase 2a foundation + InlineStyleAdapter | Replaced by Phases 1, 2, 4, and 6: value codec, write plans, permanent InlineStyleAdapter, shared manager wiring. |
| Subphase 2b CSS-in-JS | Kept in adapter taxonomy, CSS-in-JS scope, migration Phase 8, and test matrix. |
| Subphase 2c CSS Modules + plain CSS | Kept and expanded with source tabs, AI source routing, PostCSS utilities, and permanent inline fallback policy. |
| Subphase 2d Tailwind v4 + hybrid routing | Kept and refined as `TailwindV3Adapter` / `TailwindV4Adapter` umbrellas with internal static/dynamic writer facets and token/theme resolvers; the old composite-adapter idea becomes planner-level routing. |
| Single `StyleAdapter` interface | Intentionally replaced by framework adapter umbrellas such as `TailwindV3Adapter`, `TailwindV4Adapter`, `CssModulesAdapter`, each with reader/writer/resolver facets, plus orthogonal read/write managers and MCP resolver boundaries. |
| `writeMode` dispatch | Intentionally replaced by serializable `StyleWritePlan` kinds. |
| Per-property priority chain | Replaced by property owner, element owner, project policy, source tabs, and AI route decision where applicable. |
| Element-level detection | Kept and made mandatory input to planner context. |
| FastPatchService | Retained, not replaced: it is an optimistic DOM preview layer and must not hide source-write failures in tests. |
| Adapter registry / project frameworks | Kept as `ProjectStyleCapabilities`; client-sent framework lists are not authoritative. |
| PostCSS CSS file mutation | Kept as baseline CSS file infrastructure. |
| Backward compatibility | Kept as migration requirement: old extension/SaaS endpoints may remain during migration, but must delegate to shared `StyleWriteManager`; `projectUIKit` may exist only as a compatibility view over richer capabilities. |
| MCP tools | Kept as separate `McpStyleResolver`/thin platform wrappers, not as write-routing authority. |

Non-architectural process details from the March 11 document, such as exact
branch names, PR slicing, and old Linear placeholders, are not normative here.
The normative implementation order is the migration plan below.

## Goal

Unify style write behavior across VS Code extension and SaaS so the same project,
element, and inspector change produce the same source mutation.

The current codebase has legacy adapter interfaces, but framework adapter
selection and write strategy are not the single source of truth. VS Code and
SaaS still have separate Tailwind-heavy mutation paths, which causes CSS Modules
and generic CSS projects to be written as if they were Tailwind projects.

This plan updates the earlier universal styling adapter specs with findings from
the current test failures and code inspection.

## Non-Goals

- Do not make the product support old browsers. The runtime target is current
  Chrome and current VS Code webview.
- Do not solve every CSS-in-JS edge case in the first implementation chunk.
- Do not let AI mutate files. AI may choose semantic source routes for
  CSS class/selector systems and may resolve ambiguity, but deterministic
  planners and executors still build and apply the write plan.

## Findings

### Review of earlier specs

The March specs contain the right direction:

```text
Good ideas to keep:
  - deterministic per-framework adapters
  - element-level detection, not only project-level detection
  - CSS Modules and plain CSS write through CSS files
  - framework adapter registry in shared lib
  - composite/per-property routing for hybrid projects
  - Tailwind v3/v4 distinction
  - PostCSS-based CSS file mutation
  - FastPatch as preview-only optimistic feedback
```

But several details must be corrected before implementation.

#### Problem: old flat `StyleAdapter` interface has too many jobs

Earlier specs and current client code use/propose a single flat interface with:

```text
read()
write()
writeBatch()
resolveStyles()
convertToProps()
changeLayout()
```

This conflates separate domains:

```text
Inspector read
Inspector write planning
Source mutation execution
MCP style parsing
Layout/component type mutation
Target value conversion
```

Combined solution:

```text
Framework adapter umbrella:
  TailwindV3Adapter
  TailwindV4Adapter
  CssModulesAdapter
  InlineStyleAdapter
  EmotionAdapter
  StyledComponentsAdapter
  PlainCssAdapter
  TamaguiAdapter

Each framework adapter owns its framework-specific capabilities:
  Adapter.Reader
  Adapter.Writer
  Adapter.SourceResolver
  Adapter.TokenResolver
  Adapter.LayoutStrategy, where applicable

Orthogonal managers coordinate across adapters:
  StyleReadManager       asks active framework adapter readers for raw facts
  StyleWriteManager      owns planning/execution flow for durable writes
  StyleWritePlanner      chooses source owner and framework adapter writer facet
  StyleWriteExecutor     applies a plan using injected FileIO/platform services
  InspectorValueCodec    validates and normalizes user input to inspector canonical form (no target conversion)
  McpStyleResolver       parses className/styleProps for MCP tools only
```

The key rule: do not introduce standalone read/write adapter framework
identities. Read/write are capabilities under a framework adapter umbrella, and
managers are the cross-framework orchestration layer.

Adapters should not own transport, undo, snapshots, or platform RPC. They should
not be constructed with `AstOperations`.

#### Problem: `writeMode` is too coarse

Earlier specs route by:

```text
className | props | style-prop | styled | css-file
```

This is not enough to choose safe behavior:

```text
className="p-4"           -> deterministic Tailwind string write
className={cn(...)}       -> dynamic class expression analysis + routed write
className={styles.app}    -> CSS Modules file write or inline fallback
className="app"           -> plain CSS selector write
```

All of those are "className" from the UI perspective, but they need different
plans, dependencies, and risk handling.

Combined solution:

```text
Do not route writes by writeMode alone.
Route through StyleWritePlan union discriminated by (sourceForm, cssSystem).
```

#### Problem: priority chain puts inline before CSS Modules/plain CSS

Earlier spec priority for new properties:

```text
tailwind-v4 > tailwind-v3 > tamagui > emotion > styled-components > inline-style > css-modules > plain-css
```

This makes inline styles the default for many CSS-file projects and can cause
source drift: future edits land in JSX while the actual styling system remains
in `.module.css` or `.css`.

Combined solution:

```text
Existing property:
  write to the source where that property currently lives, unless that source is
  readonly/unsafe.

New property:
  write to the element's primary source system, not a global hardcoded chain.

Inline style:
  use when inline style already owns that property, or as explicit fallback when
  the primary source cannot be resolved safely.
```

#### Problem: property owner and element owner were conflated

The planner must distinguish:

```text
Property owner:
  where this exact CSS property currently comes from.

Element owner:
  which style system already owns the selected element.
```

Example:

```tsx
<div className={styles.card} />
```

If `.card` does not currently define `padding`, the selected element is still
owned by CSS Modules. A new `padding` should be written to CSS Modules, not
automatically to Tailwind just because Tailwind exists in the project.

Combined solution:

```text
1. If the property has an explicit owner, write to that owner.
2. If the property is new but the element has a style-system owner, write to the
   element's primary owner.
3. If the element is already mixed and Tailwind is one of the owners, Tailwind is
   the preferred owner for new properties.
4. If the element has no style owner, choose the strongest applicable project
   style system; Tailwind is strongest when available/applicable.
5. If no source adapter can produce a safe plan, use the universal inline fallback.
```

#### Problem: "always prefer Tailwind fallback" is unsafe

Earlier decisions include:

```text
Fallback: always prefer Tailwind when nothing detected or for new styles in
hybrid projects.
```

That is correct only for Tailwind-primary projects. It is wrong for CSS Modules,
plain CSS, Emotion, styled-components, or mixed projects where the selected
element is already owned by another style system.

Combined solution:

```text
Tailwind may be the fallback only when the project style policy says Tailwind is
primary for new properties on that element.

Otherwise fallback should be:
  element primary source -> project primary source -> explicit inline override.
```

#### Problem: conflict resolution says "remove from all"

Earlier spec says:

```text
Conflict: property exists in multiple places -> remove from all, write by priority.
```

That is too destructive. A property may exist in multiple places for valid
reasons:

```text
base style + media query
base style + :hover rule
CSS Modules base + Tailwind utility override
theme token + local override
shared styled component + usage override
```

Combined solution:

```text
Conflict is a planning state, not an automatic cleanup instruction.

Default:
  update the currently effective owner for the selected runtime state.

Optional cleanup:
  remove competing declarations only when the planner can prove they are same
  state, same breakpoint, same selector intent, and same property domain.

Ambiguous conflict:
  produce a conflict diagnostic or choose inline fallback only if product policy
  accepts local override.
```

#### FastPatch boundary: keep it as optimistic DOM feedback

Earlier spec describes FastPatch as universal:

```typescript
element.style.setProperty(cssProp, value, 'important');
```

This is still needed for low-latency inspector feedback. The problem is only
when FastPatch is treated as a style-write mechanism or as proof that the source
write succeeded.

FastPatch is not replaced by `InlineStyleAdapter`. They operate at different
layers:

```text
FastPatch:
  transient live DOM mutation for immediate preview
  does not persist through HMR/remount/refresh
  does not choose Tailwind/CSS Modules/CSS-in-JS/inline targets

InlineStyleAdapter:
  source mutation for JSX style props
  persists because it edits project files
  participates in StyleWritePlan through its framework adapter writer facet
```

Correct role:

```text
Keep FastPatch as an optimistic preview layer.
Do not register it as a standalone write framework identity.
Do not let it select a source target.
Do not use it as write success criteria.

Write success is determined by:
  1. StyleWritePlan creation
  2. source mutation by StyleWriteExecutor
  3. HMR/remount/re-read confirmation
  4. no rendered runtime error overlay

FastPatch patches should be tagged with a patch id / write plan id where
possible, then cleared or reconciled after source confirmation or write failure.
E2E tests may keep FastPatch enabled for realistic UX, but must wait for source
write + HMR/re-read confirmation before passing. Tests that specifically verify
source semantics may disable FastPatch to reduce noise.
```

#### Problem: "AI distributes plain CSS cascade" is too broad

Earlier spec makes AI the default for plain CSS cascade writes.

Current better approach:

```text
Use deterministic browser/source facts first:
  - imported CSS files
  - matching selectors
  - active media/container query state
  - CSS specificity
  - computed style
  - CSSOM rule data where available

Use AI only for:
  - ambiguous new selector creation
  - ambiguous cascade intent
  - suggesting refactors, not blindly choosing the write location
```

#### Problem: CSS Modules detection by import pattern alone is unsafe

Earlier spec says object import means CSS Modules regardless of extension.

That is not always safe. Detection should consider:

```text
file name: *.module.css/scss/less/sass/styl
bundler config where available
import shape: default import, namespace import, named export
className expression shape
runtime hashed class evidence from DOM
```

Object import is a strong signal, not the only rule.

#### Problem: project framework list must not be client-authoritative

Earlier spec suggests client sends `projectFrameworks` in write requests.

Combined solution:

```text
Client may send observed capabilities for planning hints.
Server/extension must compute or verify capabilities from project files.
The shared planner receives a trusted ProjectStyleCapabilities object from the
platform composition root.
```

#### Problem: CSS-in-JS writes need definition resolution

CSS-in-JS is not always on the selected JSX element. Often the selected element
is:

```tsx
<Root />
```

and the style lives elsewhere:

```tsx
const Root = styled.div`...`;
```

or in an imported component. The adapter needs a definition resolver before it
can mutate source safely.

Combined solution:

```text
CSS-in-JS initial local-definition support:
  support local definitions and local css/sx props only.

Imported or library components:
  read computed styles, but write through explicit local override fallback or
  produce unsupported/actionable diagnostic.
```

#### Problem: CSS class/selector systems need source-selection UI

CSS Modules and plain CSS can apply multiple class/selector sources to one DOM
element:

```tsx
<div className={`${styles.card} ${styles.featured} globalCard`} />
```

```css
.card { padding: 12px; }
.featured { background: gold; }
.globalCard { border: 1px solid red; }
.card:hover { background: blue; }
```

Computed style alone does not tell the product where the user intends to write.
The technically winning declaration can be semantically wrong for the requested
change.

Combined solution:

```text
Add Style Source Tabs above/near the existing state tabs:

  [Computed] [.card] [.featured] [.globalCard] [Inline override]
  [Base] [Hover] [Focus] [Active]

Computed is selected by default.
Explicit source tab selection overrides AI and deterministic routing.
Tab labels must be CSS classes/selectors, not local import variable expressions.
For CSS Modules, display `.card`, not `styles.card`.
```

#### Problem: deterministic source ownership is not semantic routing

For CSS Modules/plain CSS, an existing property owner is not always the right
semantic target. If AI routing is available and the user is editing from the
Computed tab, AI should choose the semantic class/selector before deterministic
owner fallback.

Combined solution:

```text
Source routing priority for CSS Modules/plain CSS:

1. Explicit user-selected source tab
   -> write there
   -> skip AI

2. Computed tab + AI routing enabled
   -> AI router chooses semantic class/selector
   -> planner emits deterministic WritePlan for that source

3. Computed tab + AI routing disabled
   -> deterministic exact owner only if unambiguous

4. Ambiguous and no AI / no explicit source
   -> ask user to select source tab or use explicit InlineStyleAdapter fallback
```

AI router chooses a source. It does not mutate files.

### Current legacy client adapter surface exists but is not authoritative

Current client-side legacy adapters exist:

```text
client/lib/canvas-engine/adapters/StyleAdapter.ts
client/lib/canvas-engine/adapters/TailwindAdapter.ts
client/lib/canvas-engine/adapters/TamaguiAdapter.ts
```

`RightSidebar` selects:

```text
projectUIKit === "tamagui" -> TamaguiAdapter
everything else            -> TailwindAdapter
```

But `useStyleSync` mostly bypasses `styleAdapter.writeBatch()` and calls
platform AST operations directly:

```text
useStyleSync
  -> astOps.updateStyles(...)
  -> astOps.updateProps(...) only when writeMode === "props"
```

That makes the current client-side `StyleAdapter.ts` interface ambiguous:

```text
It helps the UI decide which controls/props to show.
It can expose write-like methods such as writeBatch().
But it does not own the final source-write routing decision.
```

The final decision is still made later, after the request crosses into
platform-specific code:

```text
VS Code endpoint decides:
  should this become Tailwind classes?
  should this become JSX props?
  should this mutate className or style?

SaaS endpoint decides separately:
  should this become Tailwind classes?
  should this become JSX props?
  should this mutate className or style?
```

This is the core split-brain problem. If VS Code and SaaS each decide routing
locally, they can diverge for the same user action. Example failure modes:

```text
VS Code adds a CSS Modules inline fallback, but SaaS still appends Tailwind.
SaaS learns dynamic class expression writes, but VS Code still appends a class
to the wrong expression.
One path normalizes padding "16" to "16px", another path writes invalid CSS.
One path treats FastPatch success as enough, another waits for source/HMR.
```

`StyleWriteManager` must remove routing decisions from platform endpoints. It
does not remove the endpoints themselves. It moves these decisions into shared
code:

```text
Which framework adapter owns this write?
Which source tab/source owner is selected?
Is the target Tailwind, CSS Modules, inline style, CSS-in-JS, plain CSS, or
adapter-known element props such as Tamagui?
Is the value normalized for that target?
Is the write safe, ambiguous, or a fallback?
Which exact StyleWritePlan should be executed?
```

After that change, platform endpoints become executors only:

```text
VS Code endpoint:
  receive StyleWritePlan
  apply shared mutation primitive
  write through VSCodeFileIO
  record undo/snapshot metadata

SaaS endpoint:
  receive StyleWritePlan
  apply shared mutation primitive
  write through ServerFileIO
  record file snapshot metadata
```

They may inject FileIO, undo/snapshot, logging, cache, and runtime facts. They
must not choose a different adapter, fallback, source owner, or value
normalization than the shared plan selected.

### VS Code and SaaS duplicate style write logic

Current VS Code write path:

```text
Inspector control
  -> useStyleSync
  -> astOps.updateStyles
  -> canvasRPC ast:updateStyles
  -> AstBridge
  -> AstService.updateStyles
  -> generateTailwindClasses
  -> mutate className
```

Current SaaS write path:

```text
Inspector control
  -> useStyleSync
  -> engine.updateASTStyles
  -> ASTStyleOperation
  -> /api/update-component-styles
  -> updateComponentStyles route
  -> generateTailwindClasses
  -> mutate className
```

The duplicated mutation code is in:

```text
vscode-extension/hypercanvas-preview/src/services/AstService.ts
server/routes/updateComponentStyles.ts
```

These paths can diverge because strategy selection is implemented inside each
platform write endpoint instead of in a shared planner.

### `projectUIKit`, `cssSystem`, and `hasTailwind` are too coarse

`projectUIKit` currently represents only:

```text
tailwind | tamagui | none
```

That is not enough, but the replacement must also avoid a single-value enum
such as `cssSystem: CssSystemId`.

Projects and elements can use multiple styling systems at the same time. The
model must be arrays:

```typescript
interface ProjectStyleCapabilities {
  projectCssSystems: CssSystemId[];
  projectUiKits: UiKitId[];
  componentPropMappers: ComponentPropMapperId[];
  cssSyntaxes: CssSyntaxId[];
  projectThemeCapabilities: ProjectThemeCapabilities;
  packageEvidence: PackageEvidence[];
  configEvidence: ConfigEvidence[];
  sourceEvidence: SourceEvidence[];
}

interface ElementStyleFacts {
  elementCssSystems: CssSystemId[];
  elementUiKits: UiKitId[];
  elementPropMappers: ComponentPropMapperId[];
  sourceOwners: StyleSourceOwner[];
  classNameExpression?: ClassNameExpressionFacts;
  styleAttribute?: StyleAttributeFacts;
  componentFacts?: ComponentFacts;
  componentPropSurface?: ComponentPropSurfaceFacts;
  themeFacts?: ElementThemeFacts;
}

interface PackageEvidence {
  packageName: string;
  version?: string;
  dependencyKind: 'dependencies' | 'devDependencies' | 'peerDependencies' | 'unknown';
}

interface ConfigEvidence {
  filePath: string;
  kind:
    | 'tailwind-config'
    | 'postcss-config'
    | 'vite-config'
    | 'next-config'
    | 'tsconfig'
    | 'vanilla-extract-config'
    | 'theme-config'
    | 'other';
}

interface SourceEvidence {
  filePath: string;
  cssSyntax?: CssSyntaxId;
  kind:
    | 'css-import'
    | 'css-module-import'
    | 'css-in-js-import'
    | 'ui-kit-import'
    | 'style-prop'
    | 'className-expression'
    | 'theme-config'
    | 'css-variable-definition'
    | 'script-theme-branch';
}

interface ClassNameExpressionFacts {
  kind: 'literal' | 'template' | 'call-expression' | 'member-expression' | 'unknown';
  staticClasses: string[];
  dynamic: boolean;
}

interface StyleAttributeFacts {
  kind: 'object-literal' | 'identifier' | 'spread' | 'unknown';
  hasSpread: boolean;
}

interface ComponentFacts {
  importSource?: string;
  componentName?: string;
  intrinsicElement?: string;
}

interface ComponentPropSurfaceFacts {
  acceptsClassName: boolean;
  acceptsStyle: boolean;
  acceptsCssProp: boolean;
  acceptsSxProp: boolean;
  recursivePropsSchemaAvailable: boolean;
  styleLikeProps: string[];
  semanticProps: string[];
}

type IdeThemePreference =
  | 'light'
  | 'dark'
  | 'system';

type ResolvedColorScheme =
  | 'light'
  | 'dark';

type RuntimeThemeSource =
  | 'hyperide'
  | 'vscode'
  | 'browser-system'
  | 'app-runtime'
  | 'test-fixture';

interface RuntimeThemeContext {
  ideThemePreference: IdeThemePreference;
  resolvedColorScheme: ResolvedColorScheme;
  source: RuntimeThemeSource;
  selectedTheme?: ThemeCondition[];
}

type ThemeAxisId =
  | 'color-scheme'
  | 'brand'
  | 'density'
  | 'contrast'
  | 'platform'
  | (string & {});

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

interface ElementThemeFacts {
  activeRuntimeTheme: RuntimeThemeContext;
  sourceThemeConditions: ThemeCondition[];
  variableUsages: ThemeVariableUsage[];
  tokenUsages: ThemeTokenUsage[];
}

interface ThemeVariableUsage {
  name: string;
  fallbackChain: string[];
  owners: StyleSourceOwner[];
}

interface ThemeTokenUsage {
  tokenPath: string;
  source: ThemeTokenSource['kind'];
  owners: StyleSourceOwner[];
}

type StylePseudoState =
  | 'base'
  | 'hover'
  | 'focus'
  | 'active'
  | 'focus-visible'
  | 'disabled';

type StyleBreakpointKey =
  | 'base'
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'
  | 'xl'
  | (string & {});

type ResponsiveConditionSource =
  | 'tailwind-screens'
  | 'mui-theme-breakpoints'
  | 'chakra-theme-breakpoints'
  | 'mantine-theme-breakpoints'
  | 'css-media-query'
  | 'css-container-query'
  | 'custom';

interface ViewportCondition {
  kind: 'viewport';
  key: StyleBreakpointKey;
  minWidthPx?: number;
  maxWidthPx?: number;
  query?: string;
  source: ResponsiveConditionSource;
}

interface ContainerCondition {
  kind: 'container';
  key?: StyleBreakpointKey;
  containerName?: string;
  minWidthPx?: number;
  maxWidthPx?: number;
  query?: string;
  source: ResponsiveConditionSource;
}

interface MediaCondition {
  kind: 'media' | 'supports';
  query: string;
  source: ResponsiveConditionSource;
}

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

type SelectorConditionKind =
  | 'self-pseudo'
  | 'ancestor-selector'
  | 'group-selector'
  | 'peer-selector'
  | 'data-attribute'
  | 'aria-attribute'
  | 'structural-selector'
  | 'slot-selector'
  | 'arbitrary-selector'
  | 'library-variant';

interface SelectorCondition {
  kind: SelectorConditionKind;
  selector: string;
  label?: string;
  source:
    | 'css-selector'
    | 'tailwind-variant'
    | 'mui-slot'
    | 'chakra-pseudo-prop'
    | 'mantine-slot'
    | 'custom';
}

interface CascadeContext {
  layer?: string;
  scope?: {
    rootSelector: string;
    limitSelector?: string;
  };
  atRuleStack?: Array<{
    name: string;
    params: string;
  }>;
}

interface StyleCondition {
  state: StylePseudoState;
  viewport?: ViewportCondition;
  container?: ContainerCondition;
  media?: MediaCondition[];
  theme?: ThemeCondition[];
  selector?: SelectorCondition[];
  raw?: Array<{
    kind: string;
    value: string;
    source: string;
  }>;
}

type SourceConfidence =
  | 'exact'
  | 'probable'
  | 'computed-only';

type SourceForm =
  // Class/className token on the selected element, e.g. Tailwind utility.
  | 'elementClass'
  // Rule in a CSS-like stylesheet, e.g. CSS Modules, plain CSS, SCSS/Less.
  | 'cssStyleRule'
  // React/JS style object syntax in script/JSX, e.g. style={{}}, css={{}},
  // vanilla-extract style({ ... }).
  | 'scriptReactStyleRule'
  // Native CSS syntax embedded in script, e.g. styled-components template.
  | 'scriptNativeStyleRule'
  // Component style prop surface backed by a registered mapper, e.g.
  // Tamagui padding="$4" or Chakra p={4}; not style={{}}.
  | 'adapterKnownElementProp'
  // Generic component prop when no mapper knows its render semantics. Editable
  // through the recursive props editor or explicit prop selection only.
  | 'arbitraryElementProp';

type CssSystemId =
  | 'tailwind-v3'
  | 'tailwind-v4'
  | 'css-modules'
  | 'plain-css'
  | 'inline-style'
  | 'emotion'
  | 'styled-components'
  | 'vanilla-extract'
  | 'mui-system'
  | 'chakra-ui'
  | 'mantine'
  | 'tamagui';

type CssSystemTopology =
  | 'flat'
  | 'cascade';

interface CssSystemDescriptor {
  id: CssSystemId;
  topology: CssSystemTopology;
  defaultSourceForm: SourceForm;
}

type CssSyntaxId =
  | 'css'
  | 'scss'
  | 'sass'
  | 'less'
  | 'stylus';

type UiKitId =
  | 'shadcn-ui'
  | 'daisyui'
  | 'radix-ui'
  | 'mui'
  | 'chakra-ui'
  | 'ant-design'
  | 'mantine'
  | 'bootstrap'
  | 'flowbite'
  | 'headless-ui'
  | 'tamagui';

type ComponentPropMapperId =
  | 'tamagui'
  | 'chakra-ui'
  | 'mui-sx'
  | 'mantine'
  | 'ant-design'
  | 'react-bootstrap'
  | 'flowbite-react'
  | 'radix-ui'
  | 'headless-ui'
  | 'shadcn-cva';
```

No `...` in the normative type list. New systems should be added explicitly.

`ProjectStyleCapabilities` is project-level, trusted, and platform-built. It is
not sent authoritatively by the client. It answers:

```text
Which style systems are available anywhere in this project?
Which UI kits/component libraries are installed or detected?
Which component prop mappers can translate standard inspector controls?
Which CSS syntaxes can the project parse and mutate?
Which theme axes, theme mechanisms, and token sources are available?
Which packages/config files/source patterns support those conclusions?
```

It is built from project facts such as:

```text
package.json dependencies/devDependencies
tailwind.config.* / postcss.config.* / vite/next config where relevant
CSS entrypoints and imported stylesheet extensions
CSS Modules filename patterns
local source imports such as @emotion/*, styled-components, @vanilla-extract/*
UI kit packages such as @mantine/*, @mui/*, daisyui, shadcn/ui dependencies
known prop APIs such as Tamagui props, Chakra style props, MUI sx, Mantine
style props, React-Bootstrap variant/size props
theme evidence such as prefers-color-scheme rules, .dark/[data-theme]
selectors, CSS custom properties, Tailwind dark config, MUI/Chakra/Mantine/
Tamagui theme config, vanilla-extract theme contracts, and script branches
```

`ElementStyleFacts` is element-level and selection-specific. It answers:

```text
Which project style systems actually apply to this selected element?
Which element class, CSS rule, script React-style rule, script native-CSS rule,
adapter-known prop, or arbitrary prop owners were found?
Which UI kit component semantics apply to this element?
Which source tabs can be shown for this element?
Whether standard style inspector controls are allowed for this element, or only
the recursive props editor should be shown.
Which theme conditions, variable usages, and token usages affect this selected
element.
```

The planner must use both:

```text
ProjectStyleCapabilities:
  available capabilities and parser support

ElementStyleFacts:
  actual ownership and selected element source facts
```

`UiKitId` is detection/routing context, not a source-write target by itself. The
actual source-write target still comes from `projectCssSystems`,
`elementCssSystems`, selected source tab, and source ownership facts.

`hasTailwind` should not be a separate persisted fact. It is derived from
`projectCssSystems` / `elementCssSystems`:

```text
project has Tailwind:
  projectCssSystems includes 'tailwind-v3' or 'tailwind-v4'

element is Tailwind-owned:
  elementCssSystems includes 'tailwind-v3' or 'tailwind-v4'
```

Style write strategy must be based on at least:

```text
projectCssSystems
elementCssSystems
projectUiKits
elementUiKits
componentPropMappers
elementPropMappers
cssSyntaxes
projectThemeCapabilities
runtimeThemeContext
elementThemeFacts
element AST shape
component prop surface facts
style property
current source location
selected source tab
current style condition: theme + breakpoint/media/container + pseudo-state
```

Classification rules:

Reference repositories for named libraries:

- [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss)
- [CSS Modules](https://github.com/css-modules/css-modules)
- [Emotion](https://github.com/emotion-js/emotion)
- [styled-components](https://github.com/styled-components/styled-components)
- [vanilla-extract](https://github.com/vanilla-extract-css/vanilla-extract)
- [Tamagui](https://github.com/tamagui/tamagui)
- [shadcn/ui](https://github.com/shadcn-ui/ui)
- [daisyUI](https://github.com/saadeghi/daisyui)
- [Mantine](https://github.com/mantinedev/mantine)
- [Radix UI](https://github.com/radix-ui/primitives)
- [MUI](https://github.com/mui/material-ui)
- [Chakra UI](https://github.com/chakra-ui/chakra-ui)
- [Ant Design](https://github.com/ant-design/ant-design)
- [Bootstrap](https://github.com/twbs/bootstrap)
- [React-Bootstrap](https://github.com/react-bootstrap/react-bootstrap)
- [Flowbite](https://github.com/themesberg/flowbite)
- [Headless UI](https://github.com/tailwindlabs/headlessui)

```text
Tailwind v3/v4:
  CSS systems. They own Tailwind class generation and Tailwind token semantics.
  Topology: flat.

CSS Modules:
  CSS system. Syntax can be css/scss/sass/less/stylus.
  Topology: cascade.
  Source owners and write plans must carry `cssSyntax`.

Plain CSS:
  CSS system. Syntax can be css/scss/sass/less/stylus.
  Topology: cascade.
  Source owners and write plans must carry `cssSyntax`; `plain-css` alone is
  not enough to choose a parser/mutator.

Sass/SCSS/Less/Stylus:
  CSS syntaxes/preprocessors, not separate CSS systems.

Emotion / styled-components / vanilla-extract:
  CSS systems because they own CSS source declarations.
  Topology: cascade by default; a direct css prop/object source can be exact,
  but source selection still follows cascade/definition routing rules.

vanilla-extract:
  CSS-in-TypeScript system. Source of truth is usually `.css.ts` files that
  export generated class names. It is not a UI kit and not Tailwind. A future
  adapter would mutate typed style declarations in `.css.ts` files, not append
  arbitrary classes to JSX.

MUI System:
  CSS system for `sx` and MUI system props. Source form is usually
  `scriptReactStyleRule` for `sx={{ ... }}` and can be
  `adapterKnownElementProp` for supported scalar system props. MUI itself is
  also a UiKitId when component semantics matter.
  `sx` is MUI System's theme-aware style object prop: it accepts CSS properties,
  selectors, pseudo selectors, media queries, responsive values, and MUI theme
  tokens. Responsive object/array values must map to `StyleCondition.viewport`
  using MUI theme breakpoints.
  Topology: cascade-capable.

Chakra UI:
  CSS system when writing Chakra style props such as `p`, `px`, `bg`, `color`,
  `_hover`, or `_focus`. Source form is `adapterKnownElementProp` for scalar
  style props and nested pseudo-state props. Chakra is also a UiKitId.
  Topology: flat for base scalar props, cascade-capable for pseudo/state props.

Mantine:
  CSS system when a dedicated mapper writes Mantine style props or `styles`
  objects. Source form can be `adapterKnownElementProp` for supported scalar
  props or `scriptReactStyleRule` for `style`/`styles` object targets. Mantine
  is also a UiKitId.
  Topology: flat for scalar style props, cascade-capable for slot styles.

Tamagui:
  `tamagui` can appear as both CssSystemId and UiKitId. As CssSystemId it means
  style writes through adapter-known Tamagui props. As UiKitId it means
  component semantics and layout strategy may also matter.
  Topology: flat.

shadcn/ui:
  UI kit/component recipe, not a CSS system. Its CSS system is normally
  Tailwind v3/v4 plus CSS variables.

daisyUI:
  UI kit / Tailwind plugin, not a separate CSS system. Its write system is
  Tailwind v3/v4; daisyUI may add component class names and theme tokens.
  Detection evidence: npm reports 665,573 downloads for
  2026-04-07..2026-04-13 and 2,740,122 downloads for 2026-03-15..2026-04-13;
  the GitHub repo shows 40.7k stars and describes it as a Tailwind CSS
  component library.

mantine:
  UI kit/component library. It can also contribute CssSystemId `mantine` when
  the project uses Mantine style props or styles object APIs that a mapper can
  mutate.
```

Flat vs cascade topology:

```text
flat:
  Writes can be attached directly to the selected element's source surface once
  the system is selected. No selector/class semantic routing is required.
  Examples: Tailwind elementClass token, inline-style scriptReactStyleRule,
  Tamagui adapterKnownElementProp.

cascade:
  Writes must target a selector/class/definition that can affect multiple
  elements or multiple states. The system needs source routing before mutation.
  Examples: CSS Modules cssStyleRule, plain CSS cssStyleRule, CSS-in-JS
  scriptReactStyleRule/scriptNativeStyleRule, vanilla-extract
  scriptReactStyleRule.
```

`computed-only` write routing depends on topology:

```text
computed-only + flat selected/available system:
  Route as a new property write in the highest-priority supported flat system.
  Example: if Tailwind is available and selected by policy, generate Tailwind
  classes even though no previous owner existed.

computed-only + cascade selected/available system:
  First resolve a cssStyleRule, scriptReactStyleRule, or scriptNativeStyleRule
  target. That target can become exact or probable depending on resolver
  confidence. If no target can be resolved, use source tab selection,
  AI/source routing, or explicit inline fallback policy.
```

It must not be based only on `projectUIKit`, and it must not use a standalone
`hasTailwind` boolean that can drift from the actual CSS system arrays.

### Component prop surfaces and inspector gating

There are two different UI surfaces:

```text
Standard style inspector:
  the existing position/layout/margin/padding/fill/stroke/effects controls.

Recursive props editor:
  type-aware component prop editor for explicit prop values, including nested
  object props, semantic props, variants, theme props, data props, and unknown
  props.
```

Current implementation anchors:

```text
client/components/PropsEditor.tsx
  SaaS recursive component props editor. It already resolves the selected
  component file path and routes prop writes through engine.updateASTProp().

client/components/PropsFormField.tsx
  SaaS recursive field renderer for strings, numbers, booleans, enums, objects,
  arrays, functions, ReactNode, unknown values, and Tamagui token hints.

vscode-extension/hypercanvas-preview/src/webview-preview-panel/PropsForm.tsx
  VS Code recursive props form used by the preview/error flow. The shared
  inspector props editor should reuse the same schema semantics instead of
  inventing a separate prop model.
```

The recursive props editor header must keep the selected component source file
available to the user. The current SaaS implementation already resolves that
file path; the unified design must preserve it for code navigation and
diagnostics.

Inspector surface decision:

```typescript
interface InspectorSurfaceDecision {
  standardStyleInspector: 'enabled' | 'disabled';
  propsEditor: 'hidden' | 'compact' | 'full';
  reasons: Array<
    | 'intrinsic-element'
    | 'accepts-className'
    | 'accepts-style'
    | 'accepts-css-prop'
    | 'accepts-sx-prop'
    | 'adapter-known-prop-mapper'
    | 'source-owner-found'
    | 'props-schema-available'
    | 'no-standard-style-surface'
  >;
}
```

Rules:

```text
Intrinsic DOM element:
  show standard style inspector.
  hide recursive props editor unless there is an explicit component prop schema.

Component with className/style/css/sx support or an existing source owner:
  show standard style inspector.
  show compact recursive props editor at the top when a props schema is
  available.

Component with an adapter-known prop mapper:
  show compact recursive props editor at the top.
  show standard style inspector below it.
  standard controls may write adapterKnownElementProp, elementClass,
  scriptReactStyleRule, or cssStyleRule targets depending on mapper/source
  routing.

Component without className/style/css/sx support and without prop mapper:
  hide the standard style inspector completely.
  show the full recursive props editor.
  style-like arbitrary props such as `color` or `size` are editable only as
  explicit props, not as inferred CSS writes.
```

`adapterKnownElementProp` means a mapper owns the conversion from a standard
inspector property to component props. `arbitraryElementProp` means the prop is
known only as a component prop. It can be edited explicitly, but the standard
style inspector must not infer its visual semantics.

Examples:

```tsx
<YStack padding="$4" />
```

```text
Tamagui mapper exists:
  props editor: compact at top
  standard style inspector: enabled
  padding write target: cssSystem `tamagui`, sourceForm `adapterKnownElementProp`
```

```tsx
<ThirdPartyCard color="red" size="lg" variant="solid" />
```

```text
No className/style/css/sx and no mapper:
  props editor: full
  standard style inspector: disabled
  color/size/variant writes: explicit recursive props editor only
```

```tsx
<ThirdPartyCard className="card" variant="solid" />
```

```text
className exists:
  props editor: compact when schema is available
  standard style inspector: enabled through elementClass/cssStyleRule routing
  variant: recursive props editor only unless a mapper explicitly owns it
```

### Component prop mappers for popular libraries

Component prop mappers translate standard style inspector fields into known
component style APIs. They are not generic prop editors.

```typescript
interface ComponentPropMapper {
  readonly id: ComponentPropMapperId;
  readonly cssSystem?: CssSystemId;
  detect(input: {
    componentFacts: ComponentFacts;
    propSurface: ComponentPropSurfaceFacts;
    projectCapabilities: ProjectStyleCapabilities;
  }): ComponentPropMapperMatch;
  mapStyleWrite(input: {
    property: string;
    value: unknown;
    state: StylePseudoState;
    targetValue: unknown;
  }): ComponentPropStyleWriteTarget | ComponentPropMapperUnsupported;
}

type ComponentPropMapperMatch =
  | {
      matched: true;
      confidence: 'exact' | 'probable';
      supportedProps: string[];
      supportedStates: StylePseudoState[];
    }
  | {
      matched: false;
      reason: string;
    };

interface ComponentPropStyleWriteTarget {
  sourceForm: 'adapterKnownElementProp' | 'scriptReactStyleRule' | 'elementClass' | 'cssStyleRule';
  props?: Record<string, unknown>;
  propPaths?: string[][];
  sourceOwner?: StyleSourceOwner;
}

interface ComponentPropMapperUnsupported {
  supported: false;
  reason: string;
}
```

Mapper rules:

```text
Mappers may enable standard style inspector controls.
Mappers may produce adapterKnownElementProp, scriptReactStyleRule, cssStyleRule,
or elementClass targets depending on the library API.
Mappers must declare which inspector properties and pseudo states they support.
Mappers must not route semantic props such as `variant`, `theme`, `intent`, or
`tone` from standard CSS controls unless the mapper explicitly defines that
semantic mapping.
Without a mapper, arbitrary props are only explicit recursive-prop edits.
```

Initial mapper catalog:

```text
Tamagui:
  cssSystem: tamagui
  Standard inspector maps spacing, sizing, layout, color, border, opacity, and
  supported state props to Tamagui/RN-style props.
  Source form: adapterKnownElementProp.
  State mapping: hoverStyle/focusStyle/pressStyle only when the adapter supports
  those props for the component family.

Chakra UI:
  cssSystem: chakra-ui
  Standard inspector maps to Chakra style props such as p/px/py/m/bg/color/w/h,
  layout props, border props, and pseudo props such as _hover/_focus.
  Source form: adapterKnownElementProp for scalar and pseudo props.

MUI System:
  cssSystem: mui-system
  Prefer sx={{ ... }} because it is the broad MUI style surface and can express
  selectors, breakpoints, and theme values.
  Source form: scriptReactStyleRule for sx; adapterKnownElementProp only for
  supported scalar system props when the mapper can prove they are accepted.

Mantine:
  cssSystem: mantine
  Map supported Mantine style props when the component accepts them. Use
  style/styles object targets for slot styles or unsupported scalar props.
  Source form: adapterKnownElementProp for scalar style props,
  scriptReactStyleRule for style/styles objects.

Ant Design:
  Standard style writes use className/style/styles only when those props are
  accepted and the slot target is known.
  Component props such as type, variant, size, danger, theme, and status stay in
  the recursive props editor unless a dedicated semantic mapper is added.

React-Bootstrap / Bootstrap:
  Standard CSS writes route to className/plain CSS/inline style when accepted.
  Props such as variant and size are semantic props, not automatic CSS targets.

Flowbite React / daisyUI / shadcn/ui:
  Standard CSS writes route through Tailwind elementClass when Tailwind is
  available and className is accepted. Component/theme/variant props stay in the
  recursive props editor unless a dedicated mapper owns them.

Radix UI / Headless UI:
  Prefer className/style/css source routing. These libraries are behavior and
  primitive-component layers, not broad style-prop systems.
```

### Current legacy `TailwindAdapter` is too broad

The current client-side `TailwindAdapter` is being used as a default web
adapter. That is incorrect.

The following cases need different write policies:

```text
className="p-4"                         -> TailwindV3/V4Adapter.Writer.StaticClassWriter
className={cn("p-4", active && "...")}  -> TailwindV3/V4Adapter.Writer.DynamicClassWriter
className={styles.app}                  -> CssModulesAdapter.Writer
style={{ paddingLeft: 4 }}              -> InlineStyleAdapter.Writer
styled.div`...`                         -> StyledComponentsAdapter.Writer
css={{ ... }} / css={...}               -> EmotionAdapter.Writer
Tamagui props                           -> TamaguiAdapter.Writer
```

### `className={styles.app}` must not be blindly rewritten as Tailwind

For a non-Tailwind CSS Modules project:

```tsx
<div className={styles.app} />
```

this is invalid:

```tsx
<div className={(styles.app) + " px-[16px]"} />
```

It assumes Tailwind exists and that adding a runtime class string is the correct
source-level write target.

Correct behavior depends on project capabilities:

```text
Tailwind present:
  Tailwind write may be valid if policy allows mixed Tailwind + CSS Modules.

Tailwind absent:
  Do not append Tailwind classes.
  Prefer CSS Modules file write.
  Fall back to inline style when CSS selector resolution is unsafe.
```

### Inspector value normalization is a separate layer

Inspector values are not the same thing as target write values.

Two distinct responsibilities:

```text
Inspector input shape:        "50%" / "50" / 50 / "50.0"  -> canonical "50"
Per-target value space:       inline-style "0.5", tailwind "50",
                              tamagui prop number 0.5
```

`InspectorValueCodec` owns the **first** responsibility only: validate user
input and normalize it to the inspector's canonical form. It does not know
about Tailwind, CSS, Tamagui, or any other target value space.

```text
Read:
  source/runtime value -> adapter reader -> inspector canonical form
                       -> InspectorValueCodec.normalize(...)
                       -> inspector UI

Write:
  inspector UI value -> InspectorValueCodec.normalize(...)
                     -> StyleWriteContext.requestedStyles (canonical inspector form)
                     -> framework adapter writer
                     -> adapter-specific value mapping for its target
                     -> file mutation
```

Per-target value mapping (`opacity 50 -> 0.5` for CSS targets, `50 -> opacity-50`
for Tailwind, `50 -> 0.5` number for Tamagui props) lives **inside the adapter
writer**, because only the adapter knows the value space of its target. Adapters
that share a value space (for example all CSS-syntax targets share CSS opacity
0..1) may delegate to a shared CSS-value-converter library, but the dispatch
decision belongs to the adapter, not to the codec.

This is a deliberate inversion of an earlier draft that placed per-target
conversion in the codec. A central cross-target codec leaks adapter knowledge
into the shared layer and forces every codec change to touch a switch over all
known systems.

`CssRuntimeNormalizer` is a different layer still. It validates and normalizes
CSS syntax for CSS targets — converting length-like `"16"` to `"16px"` when the
browser CSS parser accepts the normalized value. It runs inside CSS-target
adapter writers, after the adapter has produced its target-specific value.

### Browser CSS tooling should be used for CSS validation

The target runtime is current Chrome / VS Code webview, so CSS Typed OM and CSS
runtime APIs are acceptable.

Verified in current Chromium via Playwright:

```text
CSS.supports("padding-left", "16")   -> false
CSS.supports("padding-left", "16px") -> true
CSS.supports("width", "16")          -> false
CSS.supports("width", "16px")        -> true
CSS.supports("opacity", "16")        -> true, but computed opacity clamps to 1
CSS.supports("opacity", "0.5")       -> true
CSSStyleValue.parse("padding-left", "16")   -> throws
CSSStyleValue.parse("padding-left", "16px") -> CSSUnitValue("16px")
```

Conclusion:

```text
Use CSS.supports and CSSStyleValue.parse for CSS target validation.
Do not keep large static LENGTH_STYLE_KEYS tables as the primary mechanism.
Keep semantic inspector conversions separate from CSS validity checks.
```

## Combined Best Solution

The best combined architecture keeps the March specs' adapter direction, but
changes the unit of abstraction from "one flat adapter performs every operation"
to "framework adapter umbrellas expose capabilities, and managers coordinate
read/write flows across those adapters".

### Combined model

```text
ProjectStyleCapabilities
  from trusted platform detector
  |
  v
ElementStyleFacts
  from AST + DOM + CSSOM/source files + component prop schema
  |
  v
RuntimeThemeContext
  from HyperIDE/VS Code theme preference + browser/system resolution
  |
  v
ThemeContextResolver
  resolves active theme conditions and theme token/value owners
  |
  v
StyleReadManager
  calls active framework adapter readers
  each reader converts raw source values to canonical inspector form
  collects source ownership and builds source tabs
  computes InspectorSurfaceDecision
  |
  v
InspectorValueCodec
  normalizes adapter reader output to canonical inspector form
  (validation only — adapter readers already converted)
  |
  v
Inspector UI
  |
  v
InspectorValueCodec
  normalizes user input to canonical inspector form
  (no target conversion — adapters do that)
  |
  v
TokenLinkResolver, when inspector value is in linked-token mode
  resolves selected design token to target-specific token reference
  e.g. var(--color-primary), text-primary, $primary, theme.colors.primary
  resolves theme-specific value owners when the token/variable is themed
  |
  v
CssRuntimeNormalizer
  normalizes CSS syntax for CSS targets using browser CSS APIs
  |
  v
TargetValueValidator
  validates the target-ready value against the selected framework adapter writer
  |
  v
StyleWriteManager
  plans durable source write
  selects source owner and framework adapter writer
  |
  v
StyleWritePlan
  explicit, serializable, platform-independent
  |
  v
StyleWriteExecutor
  injected FileIO + undo/snapshot + platform logging
```

### Why manager + plan is better than flat adapter `write()`

```text
Framework adapters keep framework identity and own their internal capabilities.
Managers make cross-framework decisions.
VS Code and SaaS can share framework adapter selection exactly.
The write operation object is built before file mutation, so platform executors
receive a concrete instruction instead of recomputing routing decisions.
Platform code can add undo/snapshot around that concrete write operation.
Shared analyzers and resolvers can use DI for FileIO/cache/runtime facts without
forking between VS Code and SaaS. Dynamic class expression analysis, CSS
selector resolution, CSS Modules source resolution, token lookup, and CSS-in-JS
definition resolution all follow the same rule.
```

### Updated module layout

```text
lib/style-values/
  inspector-value-codec.ts
  css-runtime-normalizer.ts
  css-property-names.ts
  color-normalizer.ts

lib/style-write/
  types.ts
  style-write-manager.ts
  style-write-planner.ts
  style-write-executor.ts
  project-style-capabilities.ts
  routing/
    style-source-router.ts
    ai-style-source-router.ts
  mutations/
    jsx-attribute-mutator.ts
    object-style-mutator.ts
    css-file-mutator.ts
    template-literal-css-mutator.ts
  prop-mappers/
    component-prop-mapper.ts
    registry.ts
    tamagui-prop-mapper.ts
    chakra-prop-mapper.ts
    mui-system-prop-mapper.ts
    mantine-prop-mapper.ts
    ant-design-prop-mapper.ts

lib/style-read/
  style-read-manager.ts
  source-ownership.ts
  style-source-tabs.ts
  class-expression-analyzer.ts
  inspector-surface-decision.ts

lib/style-theme/
  runtime-theme-context.ts
  theme-context-resolver.ts
  theme-token-graph.ts
  css-variable-theme-resolver.ts
  library-theme-resolver.ts

lib/style-adapters/
  framework-style-adapter.ts
  registry.ts
  tailwind-v3/
    index.ts
    reader.ts
    writer.ts
    static-class-writer.ts
    dynamic-class-writer.ts
    token-resolver.ts
    theme-resolver.ts
  tailwind-v4/
    index.ts
    reader.ts
    writer.ts
    static-class-writer.ts
    dynamic-class-writer.ts
    token-resolver.ts
    theme-resolver.ts
  css-modules/
    index.ts
    reader.ts
    writer.ts
    source-resolver.ts
  inline-style/
    index.ts
    reader.ts
    writer.ts
  emotion/
    index.ts
    reader.ts
    writer.ts
    definition-resolver.ts
  styled-components/
    index.ts
    reader.ts
    writer.ts
    definition-resolver.ts
  mui-system/
    index.ts
    reader.ts
    writer.ts
    theme-resolver.ts
  chakra-ui/
    index.ts
    reader.ts
    writer.ts
    theme-resolver.ts
  mantine/
    index.ts
    reader.ts
    writer.ts
    theme-resolver.ts
  plain-css/
    index.ts
    reader.ts
    writer.ts
    selector-resolver.ts
    theme-resolver.ts
  tamagui/
    index.ts
    reader.ts
    writer.ts
    theme-resolver.ts
    layout-strategy.ts
  vanilla-extract/
    index.ts
    reader.ts
    writer.ts
    token-resolver.ts
    theme-resolver.ts

vscode-extension/...
  composition root:
    StyleWriteManager({ fileIO: VSCodeFileIO, frameworkAdapters, normalizerBridge })

server/...
  composition root:
    StyleWriteManager({ fileIO: ServerFileIO, frameworkAdapters, normalizerBridge })
```

### Explicit ownership model

Each readable style value should carry source ownership:

```typescript
interface StyleSourceOwner {
  cssSystem: CssSystemId;
  sourceForm: SourceForm;
  cssSyntax?: CssSyntaxId;
  filePath: string;
  elementRef?: string;
  selector?: string;
  property: string;
  condition: StyleCondition;
  cascadeContext?: CascadeContext;
  confidence: SourceConfidence;
}
```

`StyleSourceOwner` has two style identity fields. The detailed rationale and
examples are defined in `docs/specs/2026-04-14-style-source-owner.md`.

```text
cssSystem:
  which styling system owns the semantics and chooses the framework adapter.

sourceForm:
  which broad source surface is mutated: element class, CSS style rule, script
  React-style rule, script native-CSS rule, adapter-known element prop, or
  arbitrary element prop.

cssSyntax:
  which CSS file syntax/parser is required when sourceForm is cssStyleRule.
  Examples: css, scss, sass, less, stylus.
```

`cssSystem` and `cssSyntax` must stay separate. `plain-css` says the owner is a
plain selector/rule system; `cssSyntax: 'scss'` says the concrete file must be
parsed and mutated with SCSS-aware rules. The same applies to CSS Modules:
`cssSystem: 'css-modules'` can pair with `cssSyntax: 'css'`, `'scss'`, `'less'`,
and so on.

`computed` is not a `SourceForm` because computed style is a read fallback, not
a source owner. It is represented by the reserved Computed source tab, not by a
source owner kind.

`arbitraryElementProp` must not appear as an automatic owner for standard style
inspector routing. It is an explicit prop-edit surface for the recursive props
editor. A normal CSS property write can target props only when the source form is
`adapterKnownElementProp` or when it is a script/style rule prop such as `style`,
`css`, or `sx` represented as `scriptReactStyleRule`.

`StyleCondition` is the common condition model for all systems. It replaces
standalone `state?: ...` plus `media?: string` fields because responsive,
theme, selector, and pseudo-state conditions compose.

It is not intended to be a closed enum of every current and future framework
feature. It is an extensible condition envelope:

```text
state:
  selected element pseudo state controlled by the inspector.

viewport/container/media:
  responsive, @container, @media, and @supports conditions.

theme:
  source theme conditions such as color-scheme=dark, brand=enterprise,
  density=compact, contrast=high, or project-defined axes.

selector:
  selector-context conditions that are not the selected element's own state:
  group-hover, peer-focus, data/aria attributes, slots, :has(), structural
  selectors, and library selector variants.

raw:
  lossless parking for adapter-known conditions not yet modeled as first-class
  fields. Raw conditions preserve reads and diagnostics, but they do not
  authorize blind automatic writes unless the owning adapter validates the raw
  condition and can place the mutation safely.
```

`CascadeContext` is separate from `StyleCondition`. CSS `@layer`, `@scope`, and
non-conditional at-rule stack ownership affect where a declaration lives in the
cascade; they are not normal inspector condition axes.

Examples:

```text
Tailwind:
  md:hover:bg-red-500
  -> condition.viewport key md + condition.state hover

Tailwind selector/theme variants:
  dark:md:group-hover:bg-red-500
  -> condition.theme color-scheme=dark + condition.viewport key md
     + condition.selector group-hover
  group-hover is not condition.state hover because the hovered node is the
  ancestor group, not the selected element.

CSS theme variables:
  .dark { --card-bg: #111827 }
  .card { background: var(--card-bg) }
  -> usage owner .card + theme value owner for --card-bg under
     condition.theme color-scheme=dark

Script theme branch:
  style={{ color: isDark ? '#fff' : '#111827' }}
  -> condition.theme color-scheme=dark with source script-condition when the
     branch is exact; otherwise probable/computed-only routing applies

CSS Modules / plain CSS:
  @media (min-width: 768px) { .card:hover { ... } }
  -> condition.viewport/media + condition.state hover

CSS selector context:
  .card[data-state='open'] .icon,
  .card:has(input:checked),
  .list > .item:nth-child(2n)
  -> condition.selector entries

CSS supports/media preferences:
  @supports (display: grid) { ... }
  @media (prefers-reduced-motion: reduce) { ... }
  -> condition.media entries with kind supports/media

CSS cascade context:
  @layer components { @scope (.card) { .title { ... } } }
  -> cascadeContext.layer/scope/atRuleStack, not a separate source tab row by
     default

MUI sx:
  sx={{ width: { xs: 100, md: 300 }, '&:hover': { color: 'primary.main' } }}
  -> condition.viewport key xs/md and condition.state hover

MUI Grid props:
  size={{ xs: 12, md: 6 }}
  -> adapter-known responsive prop values with condition.viewport key xs/md

CSS container queries:
  @container card (min-width: 480px) { .item { ... } }
  -> condition.container with optional containerName
```

The UI should expose common editable axes directly: theme conditions,
viewport/container/media, source tab, and selected-element pseudo state.
Advanced selector-context conditions may appear as chips or source-tab metadata
until the inspector has explicit controls for editing them. The planner and
executors must still preserve them and write inside the matched source context.

Theme handling is specified in
`docs/specs/2026-04-15-style-theme-resolution.md`. HyperIDE and VS Code may pass
`light`, `dark`, or `system` as the IDE theme preference. `system` must be
resolved to a concrete light/dark preview color scheme before source routing; it
is runtime context, not a durable source condition. Theme-aware writes must
distinguish usage owners from theme value owners, especially for CSS variables,
token references, component-library theme config, and script branches.

`StylePseudoState` must match the inspector state selector:

```text
base
hover
focus
active
focus-visible
disabled
```

Current UI may represent Base as `undefined`; the shared style-write model should
normalize that to `base`.

Breakpoint keys are project/theme-defined. Defaults such as `xs/sm/md/lg/xl`
are common for MUI and many design systems, but Tailwind screens and custom MUI
theme breakpoints can use different names. The detector must resolve the active
breakpoint catalog from project capabilities:

```text
Tailwind:
  tailwind.config.* screens or v4 theme/runtime facts.

MUI:
  theme.breakpoints.values and TypeScript module augmentation where available.

Chakra / Mantine:
  theme breakpoint definitions.

CSS files:
  parsed @media and @container rules, normalized to query strings and optional
  min/max width metadata when safely derivable.
```

`confidence` describes how strongly the system can tie a displayed value back to
a source owner. Detailed semantics and examples are defined in
`docs/specs/2026-04-14-style-source-confidence.md`.

```text
exact:
  source owner is known precisely enough for automatic writes.

probable:
  source owner is a strong candidate but needs confirmation, router decision,
  resolver upgrade, or diagnostic fallback before mutation.

computed-only:
  no existing source owner was found. It can still be written by routing the
  edit as a new property into a supported flat system, or by resolving a
  cascade target to exact/probable.
```

Planner rule:

```text
Prefer exact owners.
Do not silently mutate probable owners as exact; require explicit source,
router decision, resolver upgrade, or diagnostic fallback.
For computed-only values, run new-property routing:
  - flat systems can create a direct new owner;
  - cascade systems must first resolve a cssStyleRule, scriptReactStyleRule, or
    scriptNativeStyleRule target;
  - if no target can be resolved, use explicit inline fallback policy.
```

### Updated priority policy

Priority is contextual, not global.

```text
1. Existing exact source owner for the property and state.
2. Existing primary style-system owner for the element.
3. If the element is mixed and Tailwind is one of the owners, Tailwind is the
   preferred owner for new properties.
4. Project primary style system for elements with no owner.
5. Inline fallback, only when all source-specific adapters fail or user selects
   local override.
```

Project primary style system examples:

```text
Tailwind-only project:
  Tailwind static/dynamic

CSS Modules-only project:
  CSSModulesAdapter

Emotion + CSS Modules project:
  element source owner decides

Tailwind + CSS Modules project:
  existing property owner decides;
  if property is new and element is already mixed with Tailwind, Tailwind wins;
  if element is CSS Modules-only, CSS Modules remains owner for new properties.
```

### Updated CSS Modules policy

```text
Primary support:
  resolve CSS module file
  update `.classKey` rule via PostCSS
  support default import, namespace import, bracket keys, and clsx/cn expressions

Universal fallback:
  use InlineStyleAdapter only when CssModulesAdapter cannot produce a safe
  plan, e.g. selector ambiguous, rule not found, CSS file not parseable, no
  source adapter found, or user explicitly selected local override.

Advanced support:
  support composes, nested selectors, active pseudo states, and preprocessors
```

### Updated Tailwind policy

Tailwind should be split by framework/version identity at the top level:

```text
TailwindV3Adapter:
  Reader
  Writer
    StaticClassWriter
    DynamicClassWriter
  uses shared ClassExpressionAnalyzer
  TokenResolver

TailwindV4Adapter:
  Reader
  Writer
    StaticClassWriter
    DynamicClassWriter
  uses shared ClassExpressionAnalyzer
  TokenResolver
  ThemeResolver
```

The static/dynamic distinction is still real, but it lives inside the Tailwind
adapter writer facet. It must not create top-level framework adapters for static
and dynamic class handling.

Tailwind v3/v4 sharing can be modeled with base classes or shared utilities:

```text
TailwindBaseReader
TailwindBaseWriter
TailwindClassGenerator
TailwindTokenResolver
ClassExpressionAnalyzer
```

Recommended:

```text
Keep `TailwindV3Adapter` and `TailwindV4Adapter` as top-level adapter identities.
Share internal reader/writer/token code and shared analyzer integration where
behavior is identical.
Fork internal implementations only for real v3/v4 differences.
```

This avoids four top-level Tailwind adapters while still separating deterministic
static writes from higher-risk dynamic expression writes.

Dynamic class expression analysis itself should be shared and framework-neutral:

```text
ClassExpressionAnalyzer:
  shared deterministic logic
  runs in SaaS server process
  runs in VS Code extension host process

DI supplies infrastructure only:
  FileIO
  PathResolver
  ProjectCapabilitiesProvider
  CacheStore
  Logger
  RuntimeFactsProvider
```

It is not Tailwind-specific. It must parse and explain class expressions before
framework adapters decide what those classes mean:

```tsx
styles[style]                                      // CSS Modules key expression
cn('foo', { bar: isBar, [styles.baz]: isBaz })      // plain CSS + CSS Modules
`block_${mod}`                                     // probable plain CSS selector
cn('p-4', active && 'bg-blue-500')                 // Tailwind tokens
`p-${p}`                                           // Tailwind-unsafe partial utility
```

The analyzer output should include static class candidates, dynamic branches,
computed runtime classes, source locations, module member/key references, and
confidence. Tailwind, CSS Modules, plain CSS, and other class-based systems then
consume that shared output through their own reader/writer facets.

Writeability is framework-specific:

```text
Tailwind:
  Dynamic writes may only target complete Tailwind class tokens that are visible
  to Tailwind's scanner or intentionally safelisted. Examples: `"p-4"`,
  `active && "bg-blue-500"`, finite branch maps, or complete class strings
  inside `cn(...)`.

  Partial utilities such as `p-${p}` or `text-${color}-500` are unsupported as
  Tailwind write targets. Tailwind's static scanner/JIT will not reliably
  generate CSS for those interpolated fragments. Emit an unsupported diagnostic
  or choose another valid owner/fallback instead.

Non-Tailwind class/selector systems:
  Dynamic class expressions can be valid selector routing inputs. Patterns such
  as `styles[style]`, `cn('foo', { bar: isBar })`, or `block_${mod}` should be
  supported when runtime/source facts or source routing can map them to concrete
  CSS Modules keys or plain CSS selectors.
```

If an optional AI ambiguity resolver exists, it is separate from the core
analyzer and injected as an optional dependency. Core dynamic class expression
behavior must not fork into separate server/local implementations.

### High-level flow

```text
Inspector UI
  |
  v
InspectorValueCodec
  validates user input and normalizes to canonical inspector form
  (no target conversion — that lives in adapter writers)
  |
  v
StyleWriteManager
  |
  v
StyleWritePlanner
  selects source owner and framework adapter writer
  |
  v
Framework adapter writer facet
  converts canonical inspector value to its target value space
  creates WritePlan
  |
  v
Platform executor
  VS Code: VSCodeFileIO + extension undo plumbing
  SaaS:    ServerFileIO + file snapshot middleware
```

Platform differences are injected. They must not affect framework adapter
selection.

Optimistic preview is separate from this source-write flow:

```text
Inspector UI
  |
  +-- optional FastPatch
  |     applies transient DOM style for low-latency feedback
  |     never chooses source target
  |     never marks the write committed
  |
  +-- StyleWriteManager flow
        creates and executes the durable source write
        confirms through HMR/remount/re-read
```

### Source of truth boundary

```text
Shared logic owns:
  - style value normalization
  - framework adapter registry
  - framework adapter selection
  - write plan construction
  - AST/CSS mutation primitives where possible

Platform logic owns:
  - transport
  - file IO
  - undo/snapshot integration
  - optional AI/cache provider wiring
```

### Desired VS Code flow

```text
RightSidebar
  -> useStyleSync
  -> StyleWriteManager.createPlan(...)
  -> canvasRPC style-write:applyPlan
  -> extension executor
  -> shared mutation primitive
  -> VSCodeFileIO write
  -> undo tracking
```

### Desired SaaS flow

```text
RightSidebar
  -> useStyleSync
  -> StyleWriteManager.createPlan(...)
  -> /api/style-write/apply-plan
  -> server executor
  -> shared mutation primitive
  -> container/project file write
  -> file snapshot middleware
```

### Invariant

```text
Same project capabilities
Same selected element
Same inspector change
Same source state

=> same WritePlan
=> same source mutation

regardless of VS Code or SaaS runtime
```

## Core Modules

### `InspectorValueCodec`

Responsible for **inspector-form validation and normalization only**: ensures
user input matches the inspector's canonical form per property. Does not know
about framework targets or per-target value spaces.

```typescript
interface InspectorValueCodec {
  // Normalize raw user input to the inspector's canonical form for the property.
  // Examples: "50%" / "50" / 50 / "50.0" -> "50" for opacity; "16px" / "16" -> "16" for length.
  // Throws on values that cannot be canonicalized (e.g. opacity "foo").
  normalize(input: {
    key: string;
    value: unknown;
  }): NormalizedInspectorValue;

  // Format a source/runtime value back into inspector canonical form for display.
  // Adapter readers convert source value to canonical first; codec then ensures
  // display formatting (e.g. preserve trailing zeros, locale-aware decimals).
  format(input: {
    key: string;
    value: NormalizedInspectorValue;
  }): string;
}
```

Examples:

```text
normalize:
  opacity "50%" -> "50"
  opacity 50    -> "50"
  opacity "0.5" -> rejected (not inspector canonical form for opacity)
  width "16px"  -> "16"
  width "auto"  -> "auto"

format:
  opacity "50" -> "50"
  width "16"   -> "16"
```

Per-target value mapping is **not** the codec's responsibility. Each framework
adapter writer takes the canonical inspector value and converts it to its own
target value space:

```text
TailwindWriter:        opacity "50" -> token "opacity-50" or arbitrary "[0.5]"
InlineStyleWriter:     opacity "50" -> CSS "0.5"
CssFileWriter:         opacity "50" -> CSS "0.5"
TamaguiWriter:         opacity "50" -> prop number 0.5
EmotionObjectWriter:   opacity "50" -> CSS "0.5"
```

Adapter readers do the inverse for the read flow: source value -> canonical
inspector value -> codec format -> inspector UI.

Adapters that share a value space (every CSS-syntax target uses CSS opacity
0..1) may share a small `CssValueConverter` library; the dispatch decision
still belongs to the adapter, not the codec.

### `TokenLinkResolver`

Handles inspector token-linked mode. In linked mode, the inspector value is not
just a literal CSS value; it references a design token that should stay linked
in source where the target system supports token references.

```typescript
interface TokenLinkResolver {
  resolve(input: {
    tokenId: string;
    property: string;
    target: StyleValueTarget;
    adapter: FrameworkStyleAdapter;
    projectCapabilities: ProjectStyleCapabilities;
  }): TokenLinkResolution;
}
```

Examples:

```text
linked token "color.primary" -> inline/css-file var(--color-primary)
linked token "color.primary" -> tailwind text-primary / bg-primary where token exists
linked token "space.4"       -> tamagui $4
linked token "color.primary" -> emotion/styled-components theme.colors.primary
```

Rules:

```text
InspectorValueCodec validates and normalizes to inspector canonical form only.
TokenLinkResolver handles token identity preservation.
Framework adapter token resolvers provide framework-specific token lookup.
If a target cannot preserve the token link, planner must either choose a target
that can preserve it or emit a diagnostic before falling back to a literal value.
```

### `CssRuntimeNormalizer`

Browser-backed validator/normalizer for CSS targets. This is a **shared
library**, not a standalone module in the write pipeline. CSS-target adapter
writers call it after converting canonical inspector values to CSS values,
before emitting the write plan.

```text
Placement in the write flow:

  InspectorValueCodec.normalize()     ← shared, validates user input
    |
    v
  canonical inspector value "50"
    |
    v
  adapter writer converts to CSS       ← per-adapter
    e.g. InlineStyleWriter: "50" → "0.5"
    e.g. CssFileWriter:     "50" → "0.5"
    |
    v
  CssRuntimeNormalizer.normalize()     ← shared CSS-target library
    validates "0.5" is accepted by CSS.supports("opacity", "0.5")
    appends "px" to bare numbers for length properties
    |
    v
  StyleWritePlan.target.declarations    ← validated CSS value
```

Non-CSS adapters (TailwindWriter, TamaguiWriter) do NOT call
CssRuntimeNormalizer. They have their own validation logic.

```text
interface CssRuntimeNormalizer {
  normalize(input: {
    cssProperty: string;
    value: string;
  }): CssNormalizationResult;
}

type CssNormalizationResult =
  | { kind: 'value'; value: string }
  | { kind: 'remove' }
  | { kind: 'invalid'; reason: string };
```

Expected browser implementation:

```text
function normalizeCssValue(cssProperty, value) {
  if (value === '') return { kind: 'remove' };

  if (CSS.supports(cssProperty, value)) {
    return { kind: 'value', value };
  }

  if (/^-?\d+(\.\d+)?$/.test(value) && CSS.supports(cssProperty, value + 'px')) {
    return { kind: 'value', value: value + 'px' };
  }

  return { kind: 'invalid', reason: cssProperty + ': ' + value };
}
```

`CSSStyleValue.parse()` can enrich diagnostics and type metadata. `CSS.supports`
should be the primary validity check because it is simple and matches CSS parser
acceptance.

Examples:

```text
padding-left "16"   → CSS.supports false → try "16px" → true → { kind: 'value', value: '16px' }
opacity "0.5"       → CSS.supports true → { kind: 'value', value: '0.5' }
opacity "50"        → CSS.supports true (CSS clamps, not rejects) → { kind: 'value', value: '50' }
                       NOTE: this is the wrong CSS value; the adapter writer should have
                       already converted inspector "50" → CSS "0.5" before calling normalizer.
                       If it arrives as "50" the normalizer cannot catch the semantic error.
width "auto"        → CSS.supports true → { kind: 'value', value: 'auto' }
width "foo"         → CSS.supports false → try "foopx" → false → { kind: 'invalid' }
background "#4285f4"→ CSS.supports true → { kind: 'value', value: '#4285f4' }
```

Which adapters call CssRuntimeNormalizer:

```text
InlineStyleWriter:          yes — all CSS properties
CssModulesWriter:           yes — all CSS properties
PlainCssWriter:             yes — all CSS properties
EmotionObjectWriter:        yes — CSS property names, CSS shorthand expansion
StyledComponentsWriter:     yes — CSS template literal declarations
VanillaExtractWriter:       yes — TypeScript object values, validated as CSS
TailwindWriter:             NO  — uses Tailwind token validation instead
TamaguiWriter:              NO  — uses Tamagui prop type validation instead
ChakraWriter:               NO  — uses Chakra prop type validation
MUISystemWriter:            depends — sx prop with CSS values: yes; theme tokens: no
MantineWriter:              depends — styles objects with CSS values: yes; props: no
```

Node.js fallback:

```text
In browser (Playwright test, VS Code webview, SaaS preview):
  Use native CSS.supports and CSSStyleValue.parse.

In Node.js unit tests:
  Use a small static fallback that validates known property/value patterns.
  This fallback is intentionally incomplete — it covers enough for unit tests
  but should not be used as a production substitute for browser CSS APIs.
  The primary check must always be browser-backed.
```

### `TargetValueValidator`

Validates that a target-ready value is acceptable for the selected framework
adapter writer and the plan's (sourceForm, cssSystem) pair.

This is separate from `InspectorValueCodec` and `CssRuntimeNormalizer`:

```text
InspectorValueCodec:
  validates user input and normalizes to canonical inspector form
  (per-target value mapping is the adapter's job, not the codec's)

CssRuntimeNormalizer:
  validates CSS parser acceptance and normalizes CSS syntax
  (used inside CSS-target adapter writers)

TargetValueValidator:
  validates adapter-specific write constraints before a StyleWritePlan is
  executable (e.g. Tailwind class exists, Tamagui prop accepts type)
```

Examples:

```text
Tailwind:
  verify generated classes are supported by the detected Tailwind version or
  can be represented as safe arbitrary values.

cssStyleRule / inline-style scriptReactStyleRule:
  verify CSS property/value pair is accepted after CssRuntimeNormalizer.
  For cssStyleRule targets, verify `cssSyntax` is present and supported by the
  selected CSS file parser/mutator.

Tamagui:
  verify prop name/value is valid for the selected Tamagui component family.

Component prop mappers:
  verify the selected mapper supports the standard inspector property, state,
  component type, and target prop path. Without mapper support, standard style
  writes cannot target component props.

Token-linked mode:
  verify the selected target can preserve the token reference, or emit a
  diagnostic if only literal fallback is possible.
```

`TargetValueValidator` must not choose the target source. It only accepts,
rejects, or annotates the value for the target already selected by the planner.

### `StyleWriteManager`

Orchestrates planning and execution.

```typescript
interface StyleWriteManager {
  // Returns a StyleWritePlan for the given write context.
  //
  // Sync path (resolved immediately): project capabilities + element facts +
  //   source tab are already known, no AI routing or definition file read
  //   required. Caller may apply FastPatch optimistically before awaiting.
  //
  // Async path (awaitable): triggered when any of these apply:
  //   - AI StyleSourceRouter is invoked (Computed tab + CSS Modules/plain CSS
  //     + AI enabled): waits for AI route decision before building the plan.
  //   - ClassExpressionAnalyzer needs to read definition files (CSS-in-JS
  //     local definition lookup, dynamic class expression resolution).
  //   - CssModulesAdapter source resolver reads the imported .module.css file.
  //
  // UI recommendation: apply FastPatch before awaiting on the async path to
  // preserve low-latency visual feedback. Show a pending indicator on the
  // write button while the plan is resolving.
  createPlan(ctx: StyleWriteContext): Promise<StyleWritePlan>;
  execute(plan: StyleWritePlan): Promise<StyleWriteResult>;
}

interface StyleWriteContext {
  projectCapabilities: ProjectStyleCapabilities;
  elementFacts: ElementStyleFacts;
  // Per-request: the user can switch IDE/VS Code theme mid-session while
  // editing. The caller reads the current theme preference at the moment
  // of the write and passes it here. Not injected via DI composition root.
  runtimeThemeContext: RuntimeThemeContext;
  selectedSourceTabId?: string;
  condition: StyleCondition;
  requestedStyles: Record<string, string>;
}
```

It must be shared by VS Code and SaaS. Platform composition roots inject file IO,
undo integration, FastPatch wiring, runtime normalizer, framework adapter
instances, and component prop mappers. `RuntimeThemeContext` is not injected
via the composition root: each read/write request passes the current theme
preference on `StyleWriteContext` so IDE/VS Code theme switches during a
session are reflected immediately. `StyleWritePlan` carries the resolved
`StyleCondition`; `StyleWriteContext` carries the HyperIDE/VS Code
`light`/`dark`/`system` preference that produced it.

### Framework adapter umbrella

Each CSS framework or styling system has one top-level adapter identity. Read,
write, token resolution, selector resolution, and layout behavior are facets
under that adapter, not separate framework identities.

```typescript
interface FrameworkStyleAdapter {
  readonly id: CssSystemId;
  readonly reader?: FrameworkStyleReader;
  readonly writer?: FrameworkStyleWriter;
  readonly sourceResolver?: FrameworkSourceResolver;
  readonly tokenResolver?: FrameworkTokenResolver;
  readonly themeResolver?: FrameworkThemeResolver;
  readonly layoutStrategy?: LayoutMutationStrategy;
}

interface ComponentPropMapperRegistry {
  getApplicableMappers(input: {
    projectCapabilities: ProjectStyleCapabilities;
    elementFacts: ElementStyleFacts;
  }): ComponentPropMapper[];
}

// Example shape; actual implementation may use nested classes or factory fields.
class TailwindV3Adapter implements FrameworkStyleAdapter {
  readonly id = 'tailwind-v3';
  readonly reader = new TailwindV3Adapter.Reader();
  readonly writer = new TailwindV3Adapter.Writer({
    staticClassWriter: new TailwindV3Adapter.StaticClassWriter(),
    dynamicClassWriter: new TailwindV3Adapter.DynamicClassWriter(),
  });
  readonly tokenResolver = new TailwindV3Adapter.TokenResolver();
  readonly themeResolver = new TailwindV3Adapter.ThemeResolver();
}
```

This keeps `TailwindV3Adapter`, `TailwindV4Adapter`, `CssModulesAdapter`, and
other adapters as the visible extension points while still avoiding one huge
class.

### `StyleWritePlanner`

Selects source owner and framework adapter writer facet in priority order.

One inspector control change = one property = one `StyleWritePlan`. The
planner produces exactly one plan per user action. There is no batching of
multiple properties across different adapters in a single plan. This keeps
each write atomic, traceable, and undoable as a single unit.

`requestedStyles` may carry more than one key only when a single inspector
action inherently produces multiple CSS properties — for example, changing
a padding shorthand produces `padding-top`, `padding-right`, `padding-bottom`,
`padding-left` together. In that case all keys belong to the same element
owner and route to the same adapter. `selectTarget` still returns one target
for the whole batch, which is correct.

```typescript
interface StyleWritePlanner {
  selectTarget(ctx: StyleWriteContext): {
    adapter: FrameworkStyleAdapter;
    writer: FrameworkStyleWriter;
    sourceOwner: StyleSourceOwner;
  };
}
```

Framework adapter selection must use both project-level and element-level facts.

## Framework Adapter Taxonomy

### Tailwind V3/V4 adapters

GitHub: [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)

Top-level adapters:

```text
TailwindV3Adapter
TailwindV4Adapter
```

Each Tailwind adapter owns reader, writer, shared class-expression analyzer
integration, and token/theme resolver facets. Static and dynamic class handling
are writer strategies under the Tailwind adapter, not separate top-level
adapters.

Static class writer handles:


```tsx
<div className="p-4 flex" />
```

Requirements:

```text
projectCssSystems includes 'tailwind-v3' or 'tailwind-v4'
elementCssSystems includes 'tailwind-v3' or 'tailwind-v4', or the element has
  no existing style-system owner and project policy selects Tailwind
className is a string literal
```

Writes:

```text
removeConflictingClasses(existingClassName, changedKeys, state)
generateTailwindClasses(targetValues, state)
set className string literal
```

This writer must be deterministic and must not call AI.

Dynamic class writer handles:


```tsx
<div className={cn("p-4", active && "bg-blue-500")} />
<div className={`p-4 ${active ? "bg-blue-500" : "bg-gray-500"}`} />
<div className={size === 'lg' ? 'p-6' : 'p-4'} />
```

Requirements:

```text
projectCssSystems includes 'tailwind-v3' or 'tailwind-v4'
elementCssSystems includes 'tailwind-v3' or 'tailwind-v4', or the element has
  no existing style-system owner and project policy selects Tailwind
className is a dynamic expression
expression contains complete Tailwind class tokens, finite complete-token
branches, or safelisted complete classes
```

Writes:

```text
Use shared ClassExpressionAnalyzer location analysis where available.
Use DOM classes and current property-to-Tailwind map.
Use AI/cache only when deterministic location matching is ambiguous.
Fallback must remain Tailwind-aware.
Reject partial utility templates such as `p-${p}` as Tailwind write targets.
```

This writer remains a separate writer facet inside the Tailwind adapter because
dynamic class expressions require location analysis, runtime class evidence,
and ambiguity handling that static string writes do not need. The class
expression analysis itself is shared with CSS Modules, plain CSS, and any future
class-based systems; the Tailwind writer only owns Tailwind token generation and
conflict removal.

### CssModulesAdapter

GitHub: [css-modules/css-modules](https://github.com/css-modules/css-modules)

Handles:

```tsx
import styles from './App.module.css';

<div className={styles.app} />
<div className={styles['app']} />
<div className={styles[style]} />
<div className={clsx(styles.app, active && styles.active)} />
<div className={cn('foo', { [styles.baz]: isBaz })} />
```

Primary write:

```text
Resolve CSS module import.
Use shared ClassExpressionAnalyzer to resolve module member/key candidates.
Resolve exact class key or route probable candidates through source tabs/AI.
Parse CSS file.
Update matching selector block.
```

Fallback:

```text
If selector resolution is ambiguous, style maps to multiple module keys, or a
computed key such as `styles[style]` cannot be proven for the selected runtime
branch, route through source tabs/AI or delegate to InlineStyleAdapter.
```

Important:

```text
Do not append Tailwind classes unless `projectCssSystems` includes
`tailwind-v3` or `tailwind-v4` and the planner explicitly selects
`TailwindV3Adapter.Writer` or `TailwindV4Adapter.Writer` for that write.
```

### InlineStyleAdapter

Handles:

```tsx
<div style={{ paddingLeft: '4px' }} />
<div style={baseStyle} />
```

Also used as safe fallback for generic CSS when no better source target is
available.

This is a permanent universal fallback adapter, not a temporary phase. It is the
last-resort local override path when no source-specific adapter can safely write
the change, or when the user explicitly selects the Inline override source tab.

It should be named separately from plain CSS file editing:

```text
InlineStyleAdapter:
  writes JSX `style={{}}`
  sourceForm is `scriptReactStyleRule`, because the mutable surface is a
  React-style object, not a component style prop

PlainCssFileAdapter:
  writes external `.css` / `.scss` selector rules
```

Writes:

```tsx
style={{ ...baseStyle, paddingLeft: '16px', paddingRight: '16px' }}
```

It must preserve:

```text
existing className
existing non-conflicting style keys
spread expressions
custom CSS properties
```

It receives canonical inspector values from `StyleWriteContext.requestedStyles`
(normalized by `InspectorValueCodec`) and is responsible for converting them to
its target value space (`opacity 50 -> 0.5`). It must not see raw user input
that has not passed through codec normalization.

### EmotionAdapter

GitHub: [emotion-js/emotion](https://github.com/emotion-js/emotion)

Handles, incrementally:

```tsx
<div css={{ paddingLeft: 4 }} />
const block = css`padding-left: 4px;`
const Component = styled.div({ paddingLeft: 4 })
```

Fallback:

```text
InlineStyleAdapter when source target cannot be resolved safely.
```

### StyledComponentsAdapter

GitHub: [styled-components/styled-components](https://github.com/styled-components/styled-components)

Handles, incrementally:

```tsx
const Root = styled.div`
  padding-left: 4px;
`;
```

Fallback:

```text
InlineStyleAdapter when selected DOM element cannot be mapped to a styled
definition safely.
```

### PlainCssAdapter

Handles:

```tsx
import './App.scss';
<div className="app" />
<div className={cn('foo', { bar: isBar })} />
<div className={`block_${mod}`} />
```

Primary write:

```text
Resolve side-effect CSS/Sass imports.
Resolve cssSyntax from file extension/config.
Use shared ClassExpressionAnalyzer to resolve static/probable class candidates.
Find selector matching className candidate and active state/media context.
Update declaration.
```

Fallback:

```text
InlineStyleAdapter when selector resolution is ambiguous.
```

Plain CSS cascade routing:

```text
Read:
  - resolve side-effect CSS imports
  - collect matching selectors from imported CSS files
  - include active media/container query context
  - compute specificity/order metadata
  - expose selectors as Style Source Tabs under the active StyleCondition

Write from explicit selector tab:
  - write directly to that selector
  - skip AI

Write from Computed tab:
  - if AI routing enabled, AI chooses semantic selector first
  - otherwise deterministic exact owner only when unambiguous
  - otherwise ask user to pick source tab or use InlineStyleAdapter fallback
```

Global CSS not imported by the component can be read from computed styles, but
must not be mutated unless a resolver can prove the source file and selector.

### MUI System Adapter

GitHub: [mui/material-ui](https://github.com/mui/material-ui)

Handles:

```tsx
<Box sx={{ paddingLeft: 2, '&:hover': { backgroundColor: 'primary.main' } }} />
<Box sx={{ width: { xs: 100, md: 300 } }} />
<Stack p={2} bgcolor="background.paper" />
<Grid size={{ xs: 12, md: 6 }} spacing={{ xs: 2, md: 3 }} />
```

Writes:

```text
Prefer sx object mutation for standard inspector writes because it supports
theme tokens, breakpoints, selectors, and pseudo states.
Use adapterKnownElementProp only for scalar system props that the mapper can
prove are accepted by the selected component.
For MUI Grid, responsive layout props such as size, columns, spacing,
rowSpacing, columnSpacing, direction, offset are adapter-known layout props.
They should be edited by the mapper only from relevant layout inspector controls,
not inferred from arbitrary CSS property writes.
Use recursive props editor for semantic props such as variant, color, size,
disableElevation, or component-specific props unless a dedicated semantic mapper
owns that conversion.
```

### Chakra UI Adapter

GitHub: [chakra-ui/chakra-ui](https://github.com/chakra-ui/chakra-ui)

Handles:

```tsx
<Box p={4} bg="blue.500" _hover={{ bg: 'blue.600' }} />
```

Writes:

```text
Map supported standard inspector fields to Chakra style props.
Map state controls to documented pseudo props such as _hover and _focus.
Use adapterKnownElementProp for scalar style props and nested pseudo props.
Keep semantic props such as variant, size, colorScheme, and theme in the
recursive props editor unless a mapper explicitly owns them.
```

### Mantine Adapter

GitHub: [mantinedev/mantine](https://github.com/mantinedev/mantine)

Handles:

```tsx
<Box p="md" bg="blue" />
<Button styles={{ root: { paddingLeft: 16 } }} />
```

Writes:

```text
Map supported Mantine style props when the selected component accepts them.
Use style/styles object mutation for slot-level or object-style targets.
Use recursive props editor for semantic props such as variant, size, color,
radius, and theme unless a mapper explicitly owns a style conversion.
```

### TamaguiAdapter

GitHub: [tamagui/tamagui](https://github.com/tamagui/tamagui)

Handles:

```tsx
<YStack padding="$4" opacity={0.5} />
```

Writes:

```text
JSX props via updateProps-style mutation.
Source form is adapterKnownElementProp for standard style inspector writes.
```

It receives canonical inspector values from `StyleWriteContext.requestedStyles`
(normalized by `InspectorValueCodec`) and converts them to Tamagui prop values
(e.g. inspector `"50"` -> prop number `0.5`).

### VanillaExtractAdapter

GitHub: [vanilla-extract-css/vanilla-extract](https://github.com/vanilla-extract-css/vanilla-extract)

Handles:

```typescript
// Card.css.ts
import { style } from '@vanilla-extract/css';

export const card = style({
  padding: '16px',
  backgroundColor: 'blue',
});

export const cardHover = style({
  ':hover': {
    backgroundColor: 'darkblue',
  },
});
```

```tsx
import { card } from './Card.css';
<div className={card} />
```

Source identity:

```text
Runtime generated class: `Card_card__abc123`
Source identity: export `card` from Card.css.ts
```

Detection:

```text
package.json includes @vanilla-extract/css or @vanilla-extract/core.
import statement targets a .css.ts / .css.js file.
className expression references a named export from that file.
```

Primary write:

```text
Resolve vanilla-extract import to the .css.ts source file.
Identify the exported style() call that produced the runtime class via
  fiber tracing or source export name.
Mutate the TypeScript object argument of the style() call.
Source form: scriptReactStyleRule (TypeScript style object in .css.ts).
cssSyntax: not applicable — the target is TypeScript AST, not a CSS file.
```

Fallback:

```text
InlineStyleAdapter when the export cannot be resolved or the expression
is a styleVariants / recipe / createGlobalStyle call that requires
structural analysis beyond initial scope.
```

Out of initial scope:

```text
styleVariants, recipe, createGlobalTheme — route to inline fallback with
an actionable diagnostic. Add support when the initial adapter is stable.
```

Theme resolution:

```text
vanilla-extract uses createTheme / createThemeContract for typed token sets.
ThemeResolver must resolve token references from the theme contract before
mutating style() arguments; direct literal substitution bypasses the token
contract and must be avoided.
```

## CSS File Utilities

CSS Modules and plain CSS adapters share CSS file infrastructure:

```text
lib/style-write/mutations/css-file-resolver.ts
  resolve CSS file paths from JSX imports
  resolve CssSyntaxId from extension/config

lib/style-write/mutations/css-rule-finder.ts
  find matching selectors and pseudo/media contexts

lib/style-write/mutations/css-rule-mutator.ts
  add/modify/remove declarations using the parser/mutator selected by CssSyntaxId

lib/style-read/cascade-resolver.ts
  sort matching declarations by specificity, order, media, and active state
```

PostCSS is required for CSS file parsing and mutation. `CssSyntaxId` selects the
parser/mutator path. Additional syntax plugins may be required for
SCSS/Less/Stylus; `.css` is the baseline parser target, and preprocessor support
must be covered by fixtures before release.

## Tailwind v3/v4 Strategy

GitHub: [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)

Tailwind top-level adapter identity is split by version first:

```text
TailwindV3Adapter
  Reader
  Writer.StaticClassWriter
  Writer.DynamicClassWriter
  TokenResolver
  ThemeResolver

TailwindV4Adapter
  Reader
  Writer.StaticClassWriter
  Writer.DynamicClassWriter
  TokenResolver
  ThemeResolver
```

Static/dynamic behavior is split inside each adapter's writer facet. Shared base
classes/utilities should be used where v3 and v4 behavior is identical. Do not
create top-level adapters for static/dynamic behavior unless those become
independent styling systems, which they are not.

TW4 requirements carried from Phase 2:

```text
Detect tailwindcss major version from package.json.
Support v4 @theme token discovery.
Preserve arbitrary values.
Handle v4 color opacity syntax where it differs from v3.
Account for changed defaults such as border currentColor.
```

## CSS-in-JS Scope

Emotion support:

```text
styled API:
  styled.div`...`
  styled.div({ ... })

css prop:
  <div css={{ ... }} />
  <div css={css`...`} />

MUI sx prop:
  <Box sx={{ p: 2, bgcolor: 'primary.main' }} />
  <Box sx={{ width: { xs: 100, md: 300 }, '&:hover': { opacity: 0.8 } }} />
```

Styled-components support:

```text
styled.div`...`
styled(Component)`...`
styled.div({ ... })
```

Shared mutators:

```text
object-style-mutator:
  inline style objects, css prop objects, sx objects, styled object syntax

template-literal-css-mutator:
  Emotion/styled-components template literals
  preserves interpolation placeholders
```

Local definitions are the safe write target. Imported/library components are
readable through computed style, but writes require explicit local override or a
resolver that can safely navigate to the owning source.

## Read Path Requirements

Read path must mirror write path.

Current issue:

```text
VS Code styles:readClassName reads className only, then parses it as Tailwind.
```

Target:

```text
StyleReadManager
  -> framework adapter registry
  -> per-framework adapter reader facets
  -> InspectorValueCodec.normalize
  -> ParsedStyles for UI
```

Desired read flow:

```text
Selected element
  -> fiber tracing source location + source AST + DOM/computed style +
     component prop schema
  -> active framework adapter readers read raw values
  -> source tabs are built from elementClass/cssStyleRule/
     scriptReactStyleRule/scriptNativeStyleRule/adapterKnownElementProp owners
  -> runtime/generated class names are mapped back to source identities
  -> InspectorSurfaceDecision chooses standard inspector + props editor mode
  -> conflict resolver chooses displayed value per property
     (Computed tab: winning getComputedStyle() declaration)
  -> InspectorValueCodec.normalize  (raw DOM value → inspector UI value)
  -> RightSidebar state
```

Read output must include style source tabs, not only `ParsedStyles`:

```typescript
interface StyleSourceTab {
  id: string;
  // UI label. Prefer original source identity recovered via fiber/source
  // tracing. Must not be a generated runtime class when source identity is
  // known, and must not be a local JS variable expression such as `styles.card`.
  label: string;
  // Present for concrete source tabs. Omitted for the aggregate Computed tab.
  cssSystem?: CssSystemId;
  sourceForm?: SourceForm;
  cssSyntax?: CssSyntaxId;
  filePath?: string;
  // Normalized selector/class shown to the user, e.g. `.card`, `.featured`.
  selector?: string;
  cssClass?: string;
  classKey?: string;
  // Internal source resolution metadata. May contain import local names such as
  // `styles`, but this must not be used for tab display labels.
  sourceRef?: {
    importLocalName?: string;
    importSource?: string;
    expressionPath?: string;
  };
  condition: StyleCondition;
  isDefault: boolean;
  confidence: SourceConfidence;
}

interface PropertySource {
  property: string;
  value: string;
  sourceTabId: string;
  specificity?: number;
  active: boolean;
}
```

### Source class identity and fiber tracing

Runtime DOM class names are often generated and must not become the primary
source-tab label when the system can recover source identity.

Examples:

```text
CSS Modules:
  runtime `_card_ab12x`
  source identity `.card`

vanilla-extract:
  runtime `Card_card__hash`
  source identity export `card` from Card.css.ts

Emotion / MUI sx:
  runtime `css-1abc123-MuiBox-root`
  source identity `sx prop` or local css/styled definition

styled-components:
  runtime `sc-a1b2c3`
  source identity local styled component name, e.g. `CardRoot`
```

Use fiber tracing and source mapping before falling back to generated class
names:

```text
DOM element
  -> React fiber / nodeRef / debug source
  -> JSX element source location
  -> AST attributes and imports
  -> className/css/sx/style/styled source expression
  -> original class key, selector, export name, or local definition label
```

`StyleSourceTab.label` should prefer:

```text
1. original CSS selector/class key from source, e.g. `.card`
2. local styled/css definition name, e.g. `CardRoot`
3. explicit source surface label, e.g. `sx prop`, `css prop`, `Inline override`
4. generated runtime class only as diagnostic fallback with confidence probable
```

Source metadata may retain generated classes for matching and diagnostics:

```typescript
interface SourceClassIdentity {
  displayName: string;
  runtimeClassName?: string;
  sourceClassName?: string;
  sourceExportName?: string;
  generated: boolean;
  sourceRef?: {
    filePath: string;
    importLocalName?: string;
    importSource?: string;
    expressionPath?: string;
  };
  confidence: SourceConfidence;
}
```

For CSS Modules labels, keep the user-facing label as the CSS class name
`.card`, not `styles.card`; the local import variable remains only in
`sourceRef`.

`Computed` is the default tab. It is an aggregate view, not a source by itself.
Writes from Computed must be routed to a concrete source tab by the planner and
source router.

### `StyleReadManager`

Shared module. Must produce the same read result on VS Code and SaaS for the
same element/project state. Platform differences are injected as infrastructure
(file IO, runtime bridge).

```text
interface StyleReadManager {
  // Main entry point. Returns everything the inspector sidebar needs.
  read(ctx: StyleReadContext): Promise<StyleReadResult>;
}

interface StyleReadContext {
  projectCapabilities: ProjectStyleCapabilities;
  elementFacts: ElementStyleFacts;
  runtimeThemeContext: RuntimeThemeContext;
  // Computed style snapshot from the preview iframe or VS Code webview.
  computedStyle: Record<string, string>;
  // Optional: pre-resolved fiber trace for the selected element.
  fiberTrace?: FiberTraceResult;
}

interface StyleReadResult {
  // All source tabs for the selected element, including the default Computed tab.
  sourceTabs: StyleSourceTab[];
  // Per-property values, grouped by source tab.
  properties: PropertySource[];
  // Inspector surface decision: standard inspector + props editor mode.
  surfaceDecision: InspectorSurfaceDecision;
  // Active conditions (theme/viewport/media/container) detected for this element.
  activeConditions: StyleCondition;
  // Available condition axes (all breakpoints, all theme variants, all states).
  availableConditionAxes: AvailableConditionAxes;
  // Diagnostics (unresolvable sources, generated-class-only tabs, etc.)
  diagnostics: Array<{ level: 'info' | 'warning'; message: string }>;
}
```

### Read flow step-by-step

```text
1. Receive StyleReadContext
   projectCapabilities + elementFacts are already trusted from platform detector.

2. Identify active framework adapters
   Filter FrameworkStyleAdapter registry by:
     adapter.id is in projectCapabilities.projectCssSystems, AND
     adapter has a reader facet (adapter.reader is defined).
   Also identify active ComponentPropMappers for the element.

3. Call each adapter reader facet
   Each FrameworkStyleReader receives:
     elementFacts, computedStyle, fiberTrace, runtimeThemeContext.
   Each reader returns:
     raw source values in the adapter's native form
     + source ownership claims (StyleSourceOwner per property per source)
     + source class identities (SourceClassIdentity for each class/selector)
     + adapter-specific conditions (theme branches, pseudo-state targets).
   The adapter reader converts its raw values to canonical inspector form
   (e.g. CSS opacity 0.5 → inspector "50") before returning.
   This is the reader's job, not InspectorValueCodec's.

4. Build source tabs
   One StyleSourceTab per distinct (cssSystem, sourceForm, selector/class/prop)
   combination found by the adapter readers.
   Plus the default Computed tab.
   Tab labels follow the source-class-identity priority (see SourceClassIdentity).

5. Compute InspectorSurfaceDecision
   Based on:
     element is intrinsic DOM vs. component
     component accepts className / style / css / sx
     component has a registered prop mapper
     component has a props schema.
   Decision matrix is already defined (see inspector surface decision rules).

6. Resolve property values for Computed tab
   For each CSS property, the winning value is:
     getComputedStyle() declaration from the runtime preview.
   The winning value is then normalized by InspectorValueCodec.normalize()
   into canonical inspector form.
   Each property also carries its PropertySource list showing which source
   tabs contributed values for that property (for conflict display).

7. Annotate theme conditions
   ThemeContextResolver annotates source owners with:
     active theme (from runtimeThemeContext → resolved light/dark)
     available theme variants (from project theme capabilities)
     theme value owners (CSS variable definitions, theme config values).

8. Annotate responsive/state conditions
   Available breakpoints from project capabilities (Tailwind screens, MUI
   breakpoints, CSS @media rules).
   Available pseudo-states from detected source tab conditions.
   Available container queries from detected source tab conditions.

9. Return StyleReadResult
```

### `FrameworkStyleReader` interface

Each framework adapter may have a reader facet. It reads raw values from source
and converts them to canonical inspector form.

```text
interface FrameworkStyleReader {
  // Read style values for the selected element from this adapter's sources.
  // Returns source ownership claims and canonical inspector values.
  read(input: {
    elementFacts: ElementStyleFacts;
    computedStyle: Record<string, string>;
    fiberTrace?: FiberTraceResult;
    runtimeThemeContext: RuntimeThemeContext;
  }): Promise<FrameworkReadResult>;
}

interface FrameworkReadResult {
  // Source ownership claims: this adapter claims ownership of these properties
  // via these source forms, files, selectors, etc.
  sourceOwners: StyleSourceOwner[];
  // Per-property values in canonical inspector form (already converted by the
  // reader from native form). Key: CSS property name; value: inspector string.
  values: Record<string, string>;
  // Source class identities for tab label resolution.
  classIdentities: SourceClassIdentity[];
  // Conditions detected (theme branches, pseudo-states, media queries).
  conditions: StyleCondition[];
}
```

### Per-adapter reader responsibilities

```text
TailwindV3Reader / TailwindV4Reader:
  parse className expression from element AST
  resolve Tailwind utility → CSS property mapping (via Tailwind engine)
  convert Tailwind values to inspector canonical form
    e.g. opacity-50 → inspector "50", p-4 → inspector "16"
  claim source ownership: sourceForm 'elementClass', cssSystem 'tailwind-v3'/'v4'
  detect responsive/state/dark variants as conditions

CssModulesReader:
  detect CSS Module import from element AST
  resolve import → .module.css/scss/etc file
  parse module file to find class rules and their properties
  convert CSS values to inspector canonical form
    e.g. opacity: 0.5 → inspector "50"
  claim source ownership: sourceForm 'cssStyleRule', cssSystem 'css-modules'
  recover source class identity: runtime hash → source .card

PlainCssReader:
  find plain CSS rules matching the element's classes/selectors
  parse and read properties
  convert to inspector canonical form
  claim source ownership: sourceForm 'cssStyleRule', cssSystem 'plain-css'

EmotionReader / StyledComponentsReader:
  detect css/styled usage from element AST or fiber trace
  read object-expression or template-literal source values
  convert to inspector canonical form
  claim source ownership: scriptReactStyleRule or scriptNativeStyleRule

VanillaExtractReader:
  detect .css.ts imports
  resolve generated class → source export name
  read style() object argument properties
  convert to inspector canonical form

InlineStyleReader:
  read JSX style={{}} attribute values
  convert to inspector canonical form
  claim source ownership: scriptReactStyleRule, cssSystem 'inline-style'
  lowest specificity among source tabs (CSS cascade rules apply)

TamaguiReader / ChakraReader / MUIReader / MantineReader:
  read adapter-known props from element AST
  convert prop values to inspector canonical form
    e.g. Tamagui opacity={0.5} → inspector "50"
  claim source ownership: adapterKnownElementProp
```

### Conflict resolution for Computed tab

When multiple source tabs define the same property, the Computed tab must show
the winning value:

```text
Rule:
  The winning value is always from getComputedStyle() — the browser already
  resolved CSS cascade, specificity, and inheritance.

  PropertySource.active = true for the winning source, false for overridden.

  The inspector does NOT recompute CSS specificity. It reads the browser's
  answer and then maps it back to source owners via source tabs.

Display:
  Computed tab shows the winning value.
  Overridden sources show their values with strikethrough in the source tab
  detail view (same pattern as browser DevTools).
  Conflict diagnostic appears when multiple source tabs have the same property
  with different values.
```

## Style Source Tabs

The inspector needs source tabs for selectable source owners: element classes,
CSS style rules, script React-style rules, script native-CSS rules, and element
props with adapter-known style semantics.

```text
[All themes] [light] [dark] [system -> dark] [brand: enterprise]
[All] [xs] [sm] [md] [lg] [xl] [@media print] [container card/md]
[Computed] [Tailwind] [.card] [.featured] [.globalCard] [Props] [Inline override]
[Base]     [Hover]    [Focus] [Active]
```

Rules:

```text
Condition row:
  selects the active StyleCondition theme/viewport/media/container axes.
  shown only when the project or selected element has conditional owners or a
  condition-capable adapter target.
  values come from project capabilities: Tailwind screens, MUI/Chakra/Mantine
  theme breakpoints, CSS @media/@container rules, theme providers, or
  custom detected queries.
  system is shown only as runtime preview metadata, e.g. system -> dark; source
  routing receives the resolved light/dark theme condition.
  advanced selector-context conditions such as group-hover, peer-focus,
  data-state, aria-expanded, :has(), and slot selectors should not create
  permanent top-level tabs by default; show them as chips/source metadata unless
  the UI has an explicit editor for that condition family.

Labels:
  CSS Modules and plain CSS tabs display CSS class/selector names only.
  Correct: `.card`, `.featured`, `.globalCard`.
  Incorrect: `styles.card`, `classes.card`, `s.featured`.
  Import variable names are implementation metadata, not user-facing source
  identity.

Computed:
  default aggregate read view.
  not a source target.
  writes require source routing.
  displayed values = getComputedStyle() winning declaration, converted
  through InspectorValueCodec.normalize(). Not raw DOM values.
  Example: computed opacity 0.5 → inspector shows 50.

Explicit source tab:
  user intent is authoritative.
  planner writes to that source.
  AI routing is skipped.

Inline override tab:
  explicitly selects InlineStyleAdapter.
  plan must include reason "explicit-local-override".
```

Condition/source/state composition examples:

```text
Tailwind md:hover:
  condition.viewport key md
  condition.state hover
  source tab Tailwind
  write class md:hover:...

CSS Modules @media + :hover:
  condition.viewport/media query (min-width: 768px)
  condition.state hover
  source tab .card
  write inside @media block and .card:hover selector

MUI sx breakpoint:
  condition.viewport key md
  condition.state base
  source tab sx prop
  write sx={{ width: { md: ... } }}

MUI Grid breakpoint:
  condition.viewport key md
  source tab Props
  mapper writes size={{ md: ... }} or spacing={{ md: ... }}

Tailwind dark group-hover:
  condition.theme color-scheme=dark
  condition.viewport key md when the md prefix is present
  condition.selector group-hover
  source tab Tailwind
  write dark:md:group-hover:...

CSS variable dark owner:
  condition.theme color-scheme=dark
  source tab --card-bg or linked token owner when selected
  write .dark { --card-bg: ... } rather than rewriting .card usage

Script theme branch:
  condition.theme color-scheme=dark
  source tab style prop or CSS-in-JS owner
  write only the exact dark branch; probable branches require router/source
  confirmation

CSS @layer/@scope:
  condition.state/base or selected pseudo state
  cascadeContext.layer/scope
  source tab .card or matching selector
  write inside the existing layer/scope context
```

For CSS Modules/plain CSS writes from Computed:

```text
AI enabled:
  AI StyleSourceRouter has first priority because semantic target can differ
  from the currently winning CSS declaration.

AI disabled:
  deterministic exact owner is allowed only when unambiguous.
  otherwise user must pick a source tab or planner uses explicit inline fallback
  according to product policy.
```

AI routing output:

```typescript
interface StyleRouteDecision {
  sourceTabId: string;
  reason: string;
  confidence: 'ai-assisted' | 'probable' | 'fallback';
}
```

AI routing does not mutate files. It only chooses the target source for the
planner. The planner still emits a deterministic `StyleWritePlan`, and the
executor applies that plan.

## Write Plan Shape

`StyleWritePlan` is the serializable contract between the planner and the
platform executor.

It is not an agent task plan or a multi-step implementation plan. For one
inspector edit, it is a small write operation object that says exactly what
source mutation should happen.

```text
Planner responsibilities:
  - choose the write target
  - explain why that target was chosen
  - normalize values for that target
  - produce an explicit plan

Executor responsibilities:
  - resolve files and nodes
  - apply the plan exactly
  - integrate undo/snapshot/HMR plumbing
  - report execution errors

Executor must not:
  - choose a different adapter
  - reinterpret inspector semantics
  - silently fallback to another write kind
```

### Base fields

Every plan has common metadata:

// Target-ready value produced by the framework adapter writer from the canonical
// inspector value (not by InspectorValueCodec — codec only normalizes input).
// string: CSS properties, Tailwind tokens, CSS variable values, and most adapters.
// number: adapter-known numeric props (e.g. Tamagui/React-Native opacity: 0.5).
type TargetStyleValue = string | number;

```typescript
interface StyleWritePlanBase {
  // Unique plan identifier generated by StyleWritePlanner. Used to tag
  // FastPatch patches for reconciliation: when source write confirms, clear
  // the matching FastPatch; when write fails, revert it. Not persisted beyond
  // the current write cycle.
  id: string;
  // Primary discriminator for the StyleWritePlan union. Each SourceForm
  // value maps to exactly one plan type and one executor mutator.
  // CssSystemId further narrows the styling system inside each plan.
  //
  //   'elementClass'              -> TailwindPlan
  //   'cssStyleRule'              -> CssFilePlan
  //   'scriptReactStyleRule'      -> ScriptObjectStylePlan
  //   'scriptNativeStyleRule'     -> ScriptTemplateStylePlan
  //   'adapterKnownElementProp'   -> AdapterPropPlan
  //   'arbitraryElementProp'      -> ArbitraryPropPlan
  sourceForm: SourceForm;
  projectRoot: string;
  sourceElement: {
    filePath: string;
    elementRef: string;
    tagName?: string;
  };
  requestedStyles: Record<string, string>;
  targetStyles: Record<string, TargetStyleValue>;
  selectedSourceTabId?: string;
  routeDecision?: {
    sourceTabId: string;
    router: 'explicit-user-selection' | 'ai-style-source-router' | 'deterministic-owner-router';
    reason: string;
    confidence: 'exact' | 'probable' | 'ai-assisted' | 'fallback';
  };
  condition: StyleCondition;
  reason:
    | 'existing-owner'
    | 'project-primary-system'
    | 'element-primary-system'
    | 'mixed-system-tailwind-priority'
    | 'css-module-selector-ambiguous'
    | 'css-rule-not-found'
    | 'dynamic-source-ambiguous'
    | 'explicit-local-override'
    | 'explicit-prop-edit'
    | 'theme-branch-selected'
    | 'theme-value-owner-selected';
  confidence: 'exact' | 'probable' | 'fallback';
  diagnostics: Array<{
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
}
```

`requestedStyles` are inspector-level keys/values, normalized to inspector form
by `InspectorValueCodec` (validation + canonicalization only — see codec section).
`targetStyles` are already converted to the selected target's value space by the
adapter writer; the codec does not perform target conversion.

`requestedStyles` and `targetStyles` are non-empty for every `sourceForm` except
`'arbitraryElementProp'`, which carries its payload in `target.props` and has
no CSS semantics. For `ArbitraryPropPlan` both fields are intentionally empty.

### Plan union

The plan union is discriminated by `sourceForm` (inherited from
`StyleSourceOwner`), with `cssSystem` narrowing the exact styling system
inside each plan. Each sourceForm value maps one-to-one to a plan type
and one-to-one to an executor mutator.

Dynamic class expression analysis is not a separate plan — it is a
`strategy` inside `TailwindPlan`. A dynamic `className` expression can
resolve to different write targets:

```text
cn('p-4', active && 'bg-blue-500')
  -> TailwindPlan with strategy.mode 'dynamic'

`p-${p}`
  -> unsupported Tailwind dynamic source; no TailwindPlan produced

styles[style]
  -> CssFilePlan (cssSystem: 'css-modules') after source routing resolves
     the module key

cn('foo', { bar: isBar, [styles.baz]: isBaz })
  -> CssFilePlan with selected cssSystem depending on source owner

`block_${mod}`
  -> CssFilePlan (cssSystem: 'plain-css') when resolver/source routing
     identifies the selector; supported for non-Tailwind class systems.
     Otherwise route as probable/computed-only or use inline fallback.
```

```typescript
type StyleWritePlan =
  | TailwindPlan
  | CssFilePlan
  | ScriptObjectStylePlan
  | ScriptTemplateStylePlan
  | AdapterPropPlan
  | ArbitraryPropPlan;

interface TailwindPlan extends StyleWritePlanBase {
  sourceForm: 'elementClass';
  cssSystem: 'tailwind-v3' | 'tailwind-v4';
  strategy:
    | {
        mode: 'static';
        removeForProperties: string[];
        addClasses: string;
      }
    | {
        mode: 'dynamic';
        locations: ClassNameLocation[];
        addClasses: string;
        removeForProperties: string[];
        fallbackStrategy: 'append-to-template' | 'wrap-expression' | 'location-only';
        analysis: {
          engine: 'shared-deterministic-analyzer';
          ambiguityResolverUsed?: boolean;
        };
      };
  target: {
    filePath: string;
    elementRef: string;
  };
}

interface CssFilePlanBase extends StyleWritePlanBase {
  sourceForm: 'cssStyleRule';
}

// Discriminated by `cssSystem` to preserve per-system invariants.
// Single executor can still dispatch on `cssSystem` because both branches
// share cssFilePath/cssSyntax/selector/declarations.
type CssFilePlan = CssModulesFilePlan | PlainCssFilePlan;

interface CssModulesFilePlan extends CssFilePlanBase {
  cssSystem: 'css-modules';
  target: {
    cssFilePath: string;
    cssSyntax: CssSyntaxId;
    selector: string;
    declarations: Record<string, string>;
    // Import metadata is required: without it the plan cannot be mapped
    // back to a source className expression on the element.
    importSource: string;
    importLocalName: string;
    classKey: string;
    cascadeContext?: CascadeContext;
  };
}

interface PlainCssFilePlanBase extends CssFilePlanBase {
  cssSystem: 'plain-css';
}

// `target.mode` discriminates: edit an existing owner, or create a new rule.
type PlainCssFilePlan =
  | PlainCssExistingOwnerPlan
  | PlainCssCreateRulePlan;

interface PlainCssExistingOwnerPlan extends PlainCssFilePlanBase {
  target: {
    mode: 'existing-owner';
    cssFilePath: string;
    cssSyntax: CssSyntaxId;
    selector: string;
    declarations: Record<string, string>;
    cascadeOwner: StyleSourceOwner;
    cascadeContext?: CascadeContext;
  };
}

interface PlainCssCreateRulePlan extends PlainCssFilePlanBase {
  target: {
    mode: 'create-rule';
    cssFilePath: string;
    cssSyntax: CssSyntaxId;
    selector: string;
    declarations: Record<string, string>;
    createMode: {
      reason: 'no-existing-owner' | 'explicit-new-selector';
      insertionHint: 'append-to-file' | 'before-owner' | 'after-owner';
    };
    cascadeContext?: CascadeContext;
  };
}

interface ScriptObjectStylePlan extends StyleWritePlanBase {
  // JSX/TS script object-expression targets:
  //   style={{ }}, css={{ }}, sx={{ }}, styled.div({ }),
  //   vanilla-extract style({ }), Emotion object, MUI sx,
  //   Mantine style/styles object targets.
  sourceForm: 'scriptReactStyleRule';
  cssSystem:
    | 'inline-style'
    | 'emotion'
    | 'styled-components'
    | 'vanilla-extract'
    | 'mui-system'
    | 'mantine';
  target: {
    filePath: string;
    elementRef?: string;
    // AST path to the object expression being mutated.
    objectPath: string;
    styles: Record<string, TargetStyleValue>;
    mergeMode: 'object' | 'spread-existing-expression';
    cascadeContext?: CascadeContext;
  };
}

interface ScriptTemplateStylePlan extends StyleWritePlanBase {
  // JSX/TS tagged template literal targets:
  //   styled.div`...`, css`...`, Emotion/styled-components templates.
  // Currently emotion and styled-components are the only two systems with
  // tagged-template targets in scope. Other CSS-in-JS systems either use
  // object syntax (vanilla-extract, MUI sx, Mantine) routed through
  // ScriptObjectStylePlan, or are out of scope for v1.
  sourceForm: 'scriptNativeStyleRule';
  cssSystem: 'emotion' | 'styled-components';
  target: {
    filePath: string;
    // AST path to the template literal quasi being mutated.
    quasiPath: string;
    declarations: Record<string, string>;
    cascadeContext?: CascadeContext;
  };
}

interface AdapterPropPlan extends StyleWritePlanBase {
  sourceForm: 'adapterKnownElementProp';
  cssSystem: CssSystemId;
  target: {
    filePath: string;
    elementRef: string;
    mapperId: ComponentPropMapperId;
    origin: 'standard-style-inspector' | 'recursive-props-editor';
    props: Record<string, unknown>;
    propPaths?: string[][];
  };
}

interface ArbitraryPropPlan extends StyleWritePlanBase {
  sourceForm: 'arbitraryElementProp';
  // No cssSystem: arbitrary prop edits are not styling-system writes.
  // requestedStyles and targetStyles on the base are empty by design;
  // the write payload lives in target.props.
  target: {
    filePath: string;
    elementRef: string;
    origin: 'recursive-props-editor';
    props: Record<string, unknown>;
    propPaths?: string[][];
  };
}
```

`AdapterPropPlan` is used for both standard-inspector writes through
registered mappers (e.g. Tamagui, Chakra) and recursive prop edits of
adapter-known props. `ArbitraryPropPlan` handles explicit recursive prop
edits of components with no registered style mapper.

Planner enforcement:

```text
AdapterPropPlan + origin standard-style-inspector:
  mapperId is required.
  cssSystem must match the mapper's declared cssSystem.

AdapterPropPlan + origin recursive-props-editor:
  mapperId is recommended for validation.

ArbitraryPropPlan:
  origin is always 'recursive-props-editor'.
  Standard style inspector must never emit ArbitraryPropPlan.
  requestedStyles and targetStyles are empty by design.
```

### Examples

Tailwind static class:

```typescript
{
  id: 'plan-1',
  sourceForm: 'elementClass',
  cssSystem: 'tailwind-v4',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4', tagName: 'div' },
  requestedStyles: { paddingLeft: '16', paddingRight: '16' },
  targetStyles: { paddingLeft: '16', paddingRight: '16' },
  condition: { state: 'base' },
  reason: 'project-primary-system',
  confidence: 'exact',
  diagnostics: [],
  strategy: {
    mode: 'static',
    removeForProperties: ['paddingLeft', 'paddingRight'],
    addClasses: 'px-[16px]',
  },
  target: {
    filePath: 'src/App.tsx',
    elementRef: 'src/App.tsx:12:4',
  },
}
```

CSS Modules file write:

```typescript
{
  id: 'plan-2',
  sourceForm: 'cssStyleRule',
  cssSystem: 'css-modules',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:20:6', tagName: 'div' },
  requestedStyles: { paddingLeft: '16', paddingRight: '16' },
  targetStyles: { paddingLeft: '16px', paddingRight: '16px' },
  condition: { state: 'base' },
  reason: 'existing-owner',
  confidence: 'exact',
  diagnostics: [],
  target: {
    cssFilePath: 'src/App.module.css',
    cssSyntax: 'css',
    selector: '.app',
    declarations: {
      'padding-left': '16px',
      'padding-right': '16px',
    },
    importSource: './App.module.css',
    importLocalName: 'styles',
    classKey: 'app',
  },
}
```

Inline fallback:

```typescript
{
  id: 'plan-3',
  sourceForm: 'scriptReactStyleRule',
  cssSystem: 'inline-style',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:20:6', tagName: 'div' },
  requestedStyles: { backgroundColor: '#4285f4' },
  targetStyles: { backgroundColor: '#4285f4' },
  condition: { state: 'base' },
  reason: 'css-module-selector-ambiguous',
  confidence: 'fallback',
  diagnostics: [
    {
      level: 'warning',
      message: 'CSS Modules expression references multiple possible class keys; applying local inline override.',
    },
  ],
  target: {
    filePath: 'src/App.tsx',
    elementRef: 'src/App.tsx:20:6',
    objectPath: 'JSXAttribute[name=style]/JSXExpressionContainer/ObjectExpression',
    styles: { backgroundColor: '#4285f4' },
    mergeMode: 'object',
  },
}
```

CSS Modules hover state:

```typescript
{
  id: 'plan-4',
  sourceForm: 'cssStyleRule',
  cssSystem: 'css-modules',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'div' },
  requestedStyles: { backgroundColor: '#ef4444' },
  targetStyles: { backgroundColor: '#ef4444' },
  condition: { state: 'hover' },
  reason: 'existing-owner',
  confidence: 'exact',
  diagnostics: [],
  target: {
    cssFilePath: 'src/Card.module.css',
    cssSyntax: 'css',
    selector: '.card',
    declarations: {
      'background-color': '#ef4444',
    },
    importSource: './Card.module.css',
    importLocalName: 'styles',
    classKey: 'card',
  },
}
```

Theme CSS variable value owner:

```typescript
{
  id: 'plan-5',
  sourceForm: 'cssStyleRule',
  cssSystem: 'plain-css',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'div' },
  requestedStyles: { backgroundColor: '#111827' },
  targetStyles: { '--card-bg': '#111827' },
  condition: {
    state: 'base',
    theme: [{ axis: 'color-scheme', value: 'dark', source: 'class-selector', selector: '.dark &' }],
  },
  reason: 'theme-value-owner-selected',
  confidence: 'exact',
  diagnostics: [],
  target: {
    mode: 'existing-owner',
    cssFilePath: 'src/styles.css',
    cssSyntax: 'css',
    selector: '.dark',
    declarations: { '--card-bg': '#111827' },
    cascadeOwner: {
      cssSystem: 'plain-css',
      sourceForm: 'cssStyleRule',
      cssSyntax: 'css',
      filePath: 'src/styles.css',
      selector: '.dark',
      property: '--card-bg',
      condition: {
        state: 'base',
        theme: [{ axis: 'color-scheme', value: 'dark', source: 'class-selector', selector: '.dark &' }],
      },
      confidence: 'exact',
    },
  },
}
```

Adapter-known props from standard inspector:

```typescript
{
  id: 'plan-6',
  sourceForm: 'adapterKnownElementProp',
  cssSystem: 'tamagui',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'YStack' },
  requestedStyles: { opacity: '50' },
  targetStyles: { opacity: 0.5 },
  condition: { state: 'base' },
  reason: 'existing-owner',
  confidence: 'exact',
  diagnostics: [],
  target: {
    filePath: 'src/Card.tsx',
    elementRef: 'src/Card.tsx:8:4',
    mapperId: 'tamagui',
    origin: 'standard-style-inspector',
    props: { opacity: 0.5 },
    propPaths: [['opacity']],
  },
}
```

Arbitrary prop from recursive props editor:

```typescript
{
  id: 'plan-7',
  sourceForm: 'arbitraryElementProp',
  // no cssSystem — arbitrary prop edits are not styling-system writes
  projectRoot: '/project',
  sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'ThirdPartyCard' },
  // arbitraryElementProp has no CSS semantics: payload lives in target.props,
  // requestedStyles and targetStyles are empty by design
  requestedStyles: {},
  targetStyles: {},
  condition: { state: 'base' },
  reason: 'explicit-prop-edit',
  confidence: 'exact',
  diagnostics: [],
  target: {
    filePath: 'src/Card.tsx',
    elementRef: 'src/Card.tsx:8:4',
    origin: 'recursive-props-editor',
    props: { variant: 'solid' },
    propPaths: [['variant']],
  },
}
```

### Plan validation

Before execution:

```text
Validate target file paths are inside project root.
Validate target values are already normalized for the target.
Validate `CssFilePlan` includes `cssSyntax` and that the executor supports
that syntax.
Validate fallback plans include a fallback reason and warning diagnostic.
Validate condition plans have a real source target for the selected theme, state,
viewport/media/container query, and source owner.
Validate `system` theme preference has been resolved to a concrete light/dark
RuntimeThemeContext before routing.
Validate theme-token or CSS-variable writes distinguish usage owners from theme
value owners.
Validate executor supports the plan's `sourceForm` and `cssSystem` pair.
Validate `AdapterPropPlan` from the standard style inspector includes a
mapperId and that `cssSystem` matches the mapper's declared cssSystem.
Validate `ArbitraryPropPlan` comes only from explicit recursive prop edits,
never from standard style inspector or computed style routing.
Validate `requestedStyles` and `targetStyles` are empty if and only if
`sourceForm` is `arbitraryElementProp`; non-empty for every other sourceForm.
Validate `plan.confidence` is derived from the routing path:
  - deterministic resolver, unique verifiable owner -> `'exact'`
  - deterministic resolver, ambiguous/heuristic match -> `'probable'`
  - AI StyleSourceRouter picked a concrete source -> `'probable'`
  - AI StyleSourceRouter could not pick anything -> `'fallback'`
  - explicit user tab selection -> inherits from underlying resolver
    (typically `'exact'`, may be `'probable'` if owner is not verifiable)
`'ai-assisted'` never appears on `plan.confidence`. It is recorded only on
`routeDecision.confidence` as a routing-method diagnostic, orthogonal to
outcome certainty.
```

### Verification Requirements

Verification should cover the write pipeline at three levels:

Planner-level verification:
  confirms that an inspector edit becomes the expected `StyleWritePlan`.

```text
Input fixture -> expected StyleWritePlan
```

Executor-level verification:
  confirms that a `StyleWritePlan` produces the expected source mutation.

```text
StyleWritePlan + source fixture -> expected file diff
```

E2E verification:
  confirms that the UI action produces the expected source mutation and does
  not render a runtime error in the preview.

```text
UI action -> expected plan (sourceForm, cssSystem) logged/diagnosed -> expected source mutation -> no DOM runtime error
```

## Testing Matrix

Per-adapter unit tests:

```text
Read:
  source fixture -> raw style facts + source owners + tabs

Plan:
  style context -> expected StyleWritePlan

Execute:
  StyleWritePlan + source fixture -> expected file diff

Resolve/MCP:
  className/styleProps input -> resolved CSS facts or validation error
```

Fixture directories:

```text
lib/style-fixtures/
  tailwind/
    static-class.tsx
    dynamic-cn.tsx
    template-literal.tsx
  css-modules/
    component.tsx
    styles.module.css
    multiple-classes.tsx
    pseudo-state.module.css
  plain-css/
    component.tsx
    styles.css
    cascade.css
  inline-style/
    object.tsx
    spread-expression.tsx
  emotion/
    css-prop-object.tsx
    css-prop-template.tsx
    styled-object.tsx
    styled-template.tsx
    mui-sx.tsx
  styled-components/
    styled-template.tsx
    interpolation.tsx
  tamagui/
    props.tsx
  themes/
    runtime-context.tsx
    tailwind-dark.tsx
    css-variables.css
    css-variable-fallbacks.css
    script-ternary.tsx
    mui-theme.tsx
```

Integration/E2E:

```text
For each style system:
  - select element
  - verify source tabs
  - edit base property
  - edit pseudo-state property
  - verify expected WritePlan kind
  - verify expected source mutation
  - verify HMR-applied computed style
  - verify no DOM-rendered runtime error
```

### New unit tests for prop mapper and inspector gating

Add unit coverage for the shared planner/read model before wiring UI:

```text
SourceForm classification:
  - style={{ paddingLeft: 16 }} -> scriptReactStyleRule
  - css={{ paddingLeft: 16 }} -> scriptReactStyleRule
  - sx={{ paddingLeft: 2 }} -> scriptReactStyleRule with cssSystem mui-system
  - styled.div`padding-left: 16px;` -> scriptNativeStyleRule
  - <YStack padding="$4" /> -> adapterKnownElementProp with mapperId tamagui
  - <Box p={4} /> Chakra -> adapterKnownElementProp with mapperId chakra-ui
  - unsupported <Card color="red" size="lg" /> -> arbitraryElementProp only for
    explicit recursive prop edits

InspectorSurfaceDecision:
  - intrinsic div -> standardStyleInspector enabled, propsEditor hidden
  - component with className prop -> standardStyleInspector enabled,
    propsEditor compact when schema exists
  - component with style prop -> standardStyleInspector enabled through
    scriptReactStyleRule, propsEditor compact when schema exists
  - component with css/sx prop -> standardStyleInspector enabled through the
    corresponding scriptReactStyleRule adapter
  - Tamagui/Chakra/MUI/Mantine mapper match -> propsEditor compact at top and
    standardStyleInspector enabled
  - component with no className/style/css/sx and no mapper -> propsEditor full
    and standardStyleInspector disabled

Responsive/media condition routing:
  - Tailwind md:hover class -> condition.viewport md + condition.state hover
  - CSS @media + .card:hover -> condition.media/viewport + condition.state hover
  - MUI sx responsive object -> condition.viewport keys from MUI theme
  - MUI Grid size/spacing responsive props -> adapterKnownElementProp with
    condition.viewport keys
  - CSS @container rule -> condition.container with query/container name

Theme routing:
  - HyperIDE/VS Code light/dark/system -> RuntimeThemeContext with resolved
    color scheme
  - system preference never appears as a source theme condition
  - Tailwind dark class -> condition.theme color-scheme=dark
  - @media prefers-color-scheme -> condition.theme color-scheme=dark/light
  - .dark and [data-theme='dark'] CSS variable scopes -> theme value owners
  - var(--x, var(--y, fallback)) preserves fallback chain and avoids rewriting
    fallback literal while a variable owner exists
  - script ternary/if branch -> script-condition when branch is exact, probable
    otherwise
  - MUI/Chakra/Mantine/Tamagui theme tokens route only through registered
    resolver/mapper or explicit source selection

Source class identity:
  - CSS Modules runtime generated class maps to `.card` tab label
  - vanilla-extract generated class maps to source export name
  - Emotion/MUI generated class maps to css/sx source surface when fiber tracing
    resolves JSX source location
  - generated runtime class appears only as probable diagnostic fallback when
    no source identity is recoverable

Planner restrictions:
  - standard style inspector cannot emit arbitraryElementProp
  - recursive props editor can emit arbitraryElementProp with origin
    recursive-props-editor
  - standard style inspector props plan must include mapperId and
    adapterKnownElementProp
  - semantic props theme/variant/intent/status are not selected for CSS writes
    unless a mapper explicitly owns that semantic mapping
  - computed-only on unsupported component does not create props guesses for
    color/size/padding
```

Add mapper-specific unit fixtures:

```text
lib/style-fixtures/component-prop-mappers/
  tamagui-stack.tsx
  chakra-box.tsx
  mui-sx.tsx
  mantine-box.tsx
  ant-design-button.tsx
  react-bootstrap-button.tsx
  unsupported-third-party-card.tsx
```

### New VS Code E2E tests

VS Code E2E must exercise the shared logic through the extension host, not a
server endpoint:

```text
Unsupported component, props only:
  - open fixture component
  - select <ThirdPartyCard color="red" size="lg" variant="solid" />
  - assert standard style sections are not rendered
  - assert full recursive props editor is rendered
  - assert the props editor header exposes the selected component file path /
    go-to-code target
  - edit variant through recursive props editor
  - assert source file changed
  - assert preview has no DOM-rendered runtime error

Known prop mapper:
  - select <YStack padding="$4" opacity={0.5} />
  - assert compact recursive props editor appears above standard style sections
  - edit opacity in standard inspector
  - assert AdapterPropPlan has sourceForm 'adapterKnownElementProp',
    cssSystem 'tamagui', and mapperId 'tamagui'
  - assert source writes opacity prop, not className or style
  - assert preview has no DOM-rendered runtime error

MUI sx:
  - select component with sx={{ paddingLeft: 2 }}
  - assert standard inspector enabled and compact props editor visible
  - edit padding-left
  - assert plan/source mutation targets sx as scriptReactStyleRule

MUI responsive sx/Grid:
  - select component with sx={{ width: { xs: 100, md: 300 } }}
  - assert breakpoint row appears above source/state tabs
  - select md and edit width
  - assert source mutation updates only sx.width.md
  - select MUI Grid with size={{ xs: 12, md: 6 }}
  - assert md layout edit writes Grid size.md through the mapper

CSS media/container:
  - select element styled by @media and @container rules
  - assert condition row includes detected media/container entries
  - edit property under selected condition
  - assert source mutation stays inside the matching @media/@container block

Theme context:
  - set HyperIDE or VS Code theme preference to light, dark, and system
  - assert the preview/runtime manager receives RuntimeThemeContext
  - assert system resolves to light/dark before planning
  - assert source tabs and computed values match the resolved preview theme
  - assert preview has no DOM-rendered runtime error

Theme branch write:
  - select Tailwind dark branch and edit background
  - assert source mutation writes dark:<utility> only
  - select CSS variable dark owner and edit background in linked-token mode
  - assert source mutation writes the theme variable definition, not the .card
    usage declaration
  - select exact script dark branch and edit color
  - assert only that branch changes

Generated class identity:
  - select CSS Modules element with generated runtime class
  - assert source tab label is `.card`, not `_card_hash`
  - select Emotion/MUI element with generated runtime class
  - assert tab label is css/sx/styled source identity when fiber tracing resolves
    it; generated class is diagnostic-only fallback

No mapper but className accepted:
  - select custom component that accepts className and variant
  - assert standard inspector enabled through className/source routing
  - assert variant remains editable only in compact recursive props editor
  - assert standard style edit does not write variant/size/color props

Runtime error detection:
  - run the same scenarios with the DOM-rendered error overlay detector enabled
  - fail the test if vite/next/bun/custom overlay text appears in the preview
    iframe or shadowRoot
```

## Policy Rules

### Framework adapter selection priority

Priority:

```text
1. Explicit source tab selected by user
2. Existing exact source owner for the property and state
3. Adapter-known component prop mapper, when the selected component mapper owns
   the standard inspector property and state
4. Existing primary style-system owner for the element
5. TailwindV3Adapter/TailwindV4Adapter writer facet for new properties only
   when Tailwind is part of the element's mixed owners, or the element has no
   owner and Tailwind is available/applicable
6. CssModulesAdapter writer facet when className references CSS module import and the
   element is CSS Modules-owned
7. EmotionAdapter/StyledComponentsAdapter/MUISystemAdapter/MantineAdapter writer
   facets when element maps to local object/template declarations
8. PlainCssAdapter writer facet when selector can be resolved
9. InlineStyleAdapter writer facet as explicit fallback with reason/confidence
```

### Mixed Tailwind + CSS Modules

Mixed projects need explicit policy. There are three distinct cases for the
selected element/property pair.

#### Case A: only one system owns the property

```text
Single existing owner wins. Write goes to that owner.
plan.confidence: 'exact'
```

#### Case B: property is new on the element

```text
If the element has a single style-system owner already, that owner wins.
If the element has no style owner yet:
  - and Tailwind is available for the project AND applicable to the element
    (no className expression that blocks Tailwind classes)
    -> Tailwind wins as the project's strongest applicable system.
  - otherwise -> the element's css-syntax owner wins (CSS Modules / plain CSS).
plan.confidence: 'exact'
```

#### Case C: same property exists on both Tailwind and CSS Modules

This is the conflict case. Default policy:

```text
CSS Modules wins as the explicit semantic owner.
The Tailwind utility for the same property is reported as a probable
secondary owner via diagnostic, not removed automatically.

routeDecision:
  router: 'deterministic-owner-router'
  reason: 'mixed-system-css-modules-priority'

plan.confidence: 'exact' (CSS Modules write is unambiguous)

diagnostics: [
  { level: 'warning',
    message: 'Property `padding-left` also defined by Tailwind class `pl-4`.
              Inspector wrote to .module.css owner. Remove the Tailwind class
              manually if redundant.' },
]
```

Rationale:

```text
- CSS Modules is an *explicit* semantic owner: a developer wrote the rule by
  hand. Tailwind class is a *generic utility* that applied because the project
  uses Tailwind globally.
- Writing to CSS Modules preserves component locality and avoids surprising
  global-utility leaks across other elements that share the class.
- Tailwind utilities are easy to remove later; CSS Modules rules are harder to
  reconstruct after silent overwrite.
- Inspector never auto-removes the conflicting Tailwind class because that
  could affect other elements using the same className expression.
```

Inspector UI implications:

```text
Both Tailwind and CSS Modules source tabs are visible.
CSS Modules tab is highlighted as the active write target.
Tailwind tab shows a conflict diagnostic with the conflicting utility.
User can switch tab explicitly to override; explicit tab selection wins.
Computed tab shows the winning value from getComputedStyle.
```

#### Case D: same property exists on both Tailwind and inline `style={{}}`

```text
Inline style wins by CSS specificity (browser cascade rule).
Inspector writes to inline style.
diagnostics report Tailwind class as overridden but not removed.
```

This entire policy must be encoded in the planner, not in individual adapters.
The planner consults `ElementStyleFacts.elementCssSystems` and the per-property
ownership map to pick a target deterministically before any adapter is invoked.

### Style source routing priority

For CSS Modules and plain CSS, source selection is both technical and semantic.

```text
1. Explicit source tab selected by user
   -> write to that source
   -> skip AI

2. Computed tab selected and AI routing is enabled
   -> AI StyleSourceRouter chooses semantic class/selector
   -> planner emits a deterministic WritePlan for that selected source

3. Computed tab selected and AI routing is disabled
   -> deterministic exact owner only if unambiguous

4. Ambiguous and no AI / no explicit source
   -> require source-tab selection or use explicit InlineStyleAdapter fallback
```

AI source routing does not mutate files. It only returns a route decision.

### State modifiers

State controls must map to real source writes before release.

```text
Tailwind:
  hover:bg-red-500
  focus:px-4

CSS Modules / plain CSS:
  .card:hover { ... }
  .card:focus { ... }

Emotion / styled-components:
  &:hover { ... }
  "&:hover": { ... }

Inline style:
  not a valid pseudo-state target by itself
```

If state is editable in the UI, planner must have a real target for that state.
No silent no-op and no fake inline-style state support.

## DOM-Rendered Error Detection Requirement

E2E tests must fail when a runtime error is rendered in the preview DOM, not only
when Playwright assertions fail.

Required detectors:

```text
vite-error-overlay
nextjs-portal
bun-hmr
[data-error-overlay="true"]
.bun-error-overlay
root-level Error headings/alerts in preview iframe
shadowRoot text for overlays using shadow DOM
```

This is an orthogonal safety net. It should remain in the test fixture layer and
feed the same diagnostic error sink as console/test errors.

## Migration Plan

### Phase 0: Lock current behavior with tests

- [ ] Tailwind static string updates className.
- [ ] Tailwind dynamic expression updates the right string literal or template segment.
- [ ] Tamagui writes props, not className.
- [ ] CSS Modules without Tailwind does not append Tailwind classes.
- [ ] CSS Modules writes unambiguous properties to `.module.css`.
- [ ] InlineStyleAdapter is used as universal fallback only when source-specific framework adapter writer facets cannot safely plan.
- [ ] Mixed Tailwind + CSS Modules follows explicit planner policy.
- [ ] Style Source Tabs default to Computed and expose class/selector owners.
- [ ] Condition row appears when selected element has responsive/media/container/theme owners.
- [ ] RuntimeThemeContext from HyperIDE/VS Code light/dark/system is passed into shared read/write fixtures.
- [ ] Theme variable/token ownership distinguishes usage declarations from theme value owners.
- [ ] Runtime generated classes are mapped to source identities through fiber/source tracing where possible.
- [ ] Explicit source tab selection skips AI routing.
- [ ] Computed tab uses AI source routing first for CSS Modules/plain CSS when AI is enabled.
- [ ] Component with mapper shows compact recursive props editor above standard style inspector.
- [ ] Component without standard style surface or mapper shows full recursive props editor and no standard style inspector.
- [ ] Standard style inspector never writes arbitraryElementProp.
- [ ] FastPatch remains enabled as optional optimistic preview, but source-write tests wait for HMR/re-read confirmation.
- [ ] VS Code and SaaS produce the same write plan for the same fixture.
- [ ] DOM-rendered runtime errors are reported by E2E fixture.

### Phase 1: Add value normalization layer

- [ ] Create `InspectorValueCodec` shared module.
- [ ] Move opacity scale conversions into the codec.
- [ ] Move color conversions into the codec where currently duplicated.
- [ ] Add browser-backed `CssRuntimeNormalizer`.
- [ ] Add tests using `CSS.supports` in Playwright/browser environment.
- [ ] Keep a small Node fallback only for non-browser unit tests.

### Phase 2: Add shared write plan model

- [ ] Add `StyleWritePlan` union.
- [ ] Add `StyleWriteContext`.
- [ ] Add `StyleWriteResult`.
- [ ] Add `StyleWriteManager` as the shared write orchestrator.
- [ ] Add framework adapter umbrella interface with reader/writer/resolver facets.
- [ ] Add platform-independent planner tests.
- [ ] Keep old mutation endpoints but make them delegate to the planner.

### Phase 3: Build Tailwind V3/V4 adapter umbrellas

- [ ] Add `TailwindV3Adapter` with reader, writer, shared analyzer integration, and token resolver facets.
- [ ] Add `TailwindV4Adapter` with reader, writer, shared analyzer integration, token resolver, and theme resolver facets.
- [ ] Extract deterministic static Tailwind class mutation into each adapter's writer facet.
- [ ] Extract shared deterministic `ClassExpressionAnalyzer` used by Tailwind, CSS Modules, plain CSS, and future class-based adapters.
- [ ] Inject only infrastructure into the analyzer: FileIO, path resolver, cache, logger, runtime facts.
- [ ] Keep optional AI ambiguity resolver separate from the core analyzer.
- [ ] Remove Tailwind-specific fallback from generic dynamic className handling.
- [ ] Ensure state modifiers have real targets in Tailwind, CSS files, and CSS-in-JS before release.

### Phase 4: Add InlineStyleAdapter primitive

- [ ] Implement style object merge.
- [ ] Preserve existing dynamic `style={expr}` via spread.
- [ ] Preserve className.
- [ ] Use target-ready values only.
- [ ] Do not encode inspector semantics in this adapter.

### Phase 5: Add CSSModulesAdapter

- [ ] Detect CSS module imports.
- [ ] Detect member expressions referencing CSS module locals.
- [ ] Resolve module key to selector.
- [ ] Resolve and preserve cssSyntax for `.module.css/.module.scss/.module.sass/.module.less/.module.styl`.
- [ ] Write to CSS module file as the primary path.
- [ ] Use InlineStyleAdapter fallback only when no safe CSS Modules plan can be produced.
- [ ] Ensure non-Tailwind CSS Modules never append Tailwind classes.

> **Sub-phase execution order:** Phase 5d (theme context) is a prerequisite
> for theme condition rows and theme-annotated source tabs in Phase 5b.
> Recommended order: **5 → 5d → 5b → 5c**.
> Phases 5d and 5b can be developed in parallel up to the point where
> `RuntimeThemeContext` needs to flow into the condition row UI; that step
> requires 5d to be complete first.

### Phase 5b: Add Style Source Tabs and routing

- [ ] Add Computed tab as default aggregate view.
- [ ] Add source tabs for Tailwind elementClass, CSS Modules/plain CSS cssStyleRule, CSS-in-JS scriptReactStyleRule/scriptNativeStyleRule, inline-style scriptReactStyleRule, and Tamagui adapterKnownElementProp where applicable.
- [ ] Add `StyleCondition` to source tabs, source owners, and write plans.
- [ ] Add condition row above source tabs and pseudo-state controls.
- [ ] Add selected source tab to write context and `StyleWritePlan`.
- [ ] Add AI StyleSourceRouter for Computed-tab CSS Modules/plain CSS routing.
- [ ] Ensure explicit source tab selection bypasses AI routing.

### Phase 5c: Add component prop mappers and props editor gating

- [ ] Add shared `ComponentPropMapper` interface and registry.
- [ ] Add `InspectorSurfaceDecision` to the read result.
- [ ] Wire compact/full recursive props editor modes into RightSidebar.
- [ ] Preserve selected component file path in the props editor header for code navigation and diagnostics.
- [ ] Implement Tamagui prop mapper first because current code already has Tamagui style-prop read/write logic.
- [ ] Add Chakra UI, MUI System, and Mantine mapper fixtures before enabling those mappers in product.
- [ ] Keep Ant Design, React-Bootstrap, Flowbite React, daisyUI, shadcn/ui, Radix UI, and Headless UI in className/style/recursive-props mode until dedicated mappers prove a safe style-prop contract.
- [ ] Disable standard style inspector for components that do not accept className/style/css/sx and have no mapper.
- [ ] Ensure recursive props editor can edit nested props for any component schema, not only Tamagui.

### Phase 5d: Add theme context and theme source routing

- [ ] Add shared `RuntimeThemeContext` and `ThemeContextResolver`.
- [ ] Pass HyperIDE and VS Code theme preference (`light`/`dark`/`system`) into shared read/write manager calls.
- [ ] Resolve `system` to light/dark before source routing and CSS media emulation.
- [ ] Detect theme axes, mechanisms, and token sources into `ProjectThemeCapabilities`.
- [ ] Emit theme conditions on source owners for Tailwind dark, prefers-color-scheme, class/data selectors, CSS variables, script branches, and library theme config.
- [ ] Preserve CSS variable fallback chains and distinguish usage owners from theme value owners.
- [ ] Route theme token/config writes only through registered resolvers/mappers or explicit source selection.
- [ ] Add theme condition/source tabs UI for detected theme owners.

### Phase 6: Wire VS Code and SaaS through shared manager

- [ ] VS Code `AstService.updateStyles` delegates to `StyleWriteManager`.
- [ ] SaaS `/api/update-component-styles` delegates to `StyleWriteManager`.
- [ ] Platform-specific code injects file IO, undo/snapshot, FastPatch wiring, shared analyzer infrastructure, cache, and logging.
- [ ] Each write request passes the current `RuntimeThemeContext` through `StyleWriteContext` (not via composition root) so IDE/VS Code theme switches take effect immediately.
- [ ] Remove duplicated Tailwind mutation code from platform endpoints.

### Phase 7: Update read path

- [ ] Replace VS Code `styles:readClassName` with framework-aware style read.
- [ ] Add `StyleReadManager`.
- [ ] Let framework adapter reader facets read raw source values.
- [ ] Use fiber tracing/node refs/source locations to map runtime generated class names to original source identities before building labels.
- [ ] Let `ThemeContextResolver` annotate source owners with active and available theme conditions.
- [ ] Let `InspectorValueCodec.format` canonicalize display values (per-target conversion happens in adapter readers before this step).
- [ ] Preserve computed style fallback for CSS Modules/generic CSS.

### Phase 8: Add CSS-in-JS and CSS file adapter facets

- [ ] EmotionAdapter writer facet: object `css` prop, template literals, and pseudo-state writes where resolvable.
- [ ] StyledComponentsAdapter writer facet: styled template declaration edits.
- [ ] PlainCssAdapter writer facet: side-effect import and class selector edit.
- [ ] CSS file mutators select parser/mutator by CssSyntaxId.
- [ ] CSS file mutators preserve and write under selected @media/@container/theme conditions.
- [ ] Planner-level composite routing for per-property routing across multiple active systems.

## Acceptance Criteria

- [ ] `className={styles.app}` in non-Tailwind CSS Modules project is never
      rewritten by appending Tailwind classes.
- [ ] Tailwind projects still use Tailwind class writes.
- [ ] Mixed Tailwind + CSS Modules project behavior is explicit and tested.
- [ ] `opacity` per-target conversions live inside framework adapter writers, not in `InspectorValueCodec`. Codec only validates and normalizes user input to canonical inspector form.
- [ ] CSS unit normalization uses browser CSS APIs where available.
- [ ] VS Code and SaaS use the same planner and framework adapter selection.
- [ ] Platform code no longer owns style write strategy.
- [ ] Style Source Tabs are available for class/selector-based systems.
- [ ] Theme/breakpoint/media/container controls compose with source tabs and pseudo-state controls through `StyleCondition`.
- [ ] MUI sx responsive values and MUI Grid responsive props are represented through `StyleCondition`.
- [ ] HyperIDE and VS Code pass the same `RuntimeThemeContext` shape into shared read/write managers.
- [ ] `system` theme preference is resolved to light/dark before source routing and never becomes a durable source condition.
- [ ] Theme-aware reads distinguish usage owners from theme value owners for CSS variables, tokens, library theme config, and script branches.
- [ ] Theme-aware writes mutate only the selected theme branch or selected theme value owner.
- [ ] Source tabs prefer original source class/definition names over generated runtime classes recovered from DOM.
- [ ] AI source routing has first priority on Computed tab for CSS Modules/plain CSS when enabled.
- [ ] Explicit source tab selection always beats AI routing.
- [ ] InlineStyleAdapter is a permanent universal fallback with reason/confidence diagnostics.
- [ ] Adapter-known component props are written only through a registered mapper.
- [ ] Arbitrary component props are editable only through explicit recursive props editor flows.
- [ ] Components with known mappers show compact props editor plus standard inspector; unsupported components with no standard style surface show full props editor only.
- [ ] Shared analyzers/resolvers use the same logic in VS Code and SaaS; DI supplies only infrastructure.
- [ ] Tailwind dynamic writes reject partial utility templates such as `p-${p}`.
- [ ] Non-Tailwind dynamic class patterns such as `block_${mod}` and
      `styles[style]` route to concrete selectors/module keys when resolvable.
- [ ] FastPatch is retained as optimistic preview and is never used as write success criteria.
- [ ] E2E tests detect rendered runtime error overlays in the DOM.

## Open Questions

1. Read conflict resolution:
   if the same property exists in Tailwind and CSS Modules, which value should
   the inspector display and which source should writes update by default?

2. AI source routing UX:
   when AI is enabled but low confidence, should the UI ask for confirmation or
   apply the route and expose diagnostics/history?
