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
| Per-property priority chain | Intentionally replaced by property owner, element owner, project policy, source tabs, and AI route decision where applicable. |
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
  InspectorValueCodec    converts inspector values <-> target values
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
className={cn(...)}       -> dynamic Tailwind write with location analysis
className={styles.app}    -> CSS Modules file write or inline fallback
className="app"           -> plain CSS selector write
```

All of those are "className" from the UI perspective, but they need different
plans, dependencies, and risk handling.

Combined solution:

```text
Do not route writes by writeMode alone.
Route through StyleWritePlan union with explicit plan kinds.
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
SaaS learns dynamic Tailwind expression writes, but VS Code still appends a
class to the wrong expression.
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
Tamagui props?
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

### `projectUIKit` is too coarse for style write strategy

`projectUIKit` currently represents only:

```text
tailwind | tamagui | none
```

But project CSS system detection already knows more:

```text
tailwind
cssmodules
styled-components
emotion
tamagui
sass
shadcn
daisyui
...
```

Style write strategy must be based on at least:

```text
cssSystem
hasTailwind
uiKit
element AST shape
style property
current source location
```

It must not be based only on `projectUIKit`.

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

Example:

```text
Inspector opacity value: "50"
Inline CSS opacity:      "0.5"
Tailwind opacity:        "50"   -> opacity-50
Tamagui prop opacity:    0.5
```

This conversion must not live inside framework adapter writer facets such as
`TailwindV3Adapter.Writer`, `TailwindV4Adapter.Writer`,
`InlineStyleAdapter.Writer`, or `TamaguiAdapter.Writer`. It belongs in a shared
value codec/normalizer used by all read and write paths.

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
  from AST + DOM + CSSOM/source files
  |
  v
StyleReadManager
  calls active framework adapter readers
  collects raw values and source ownership
  |
  v
InspectorValueCodec
  converts raw values to inspector values
  |
  v
Inspector UI
  |
  v
InspectorValueCodec
  converts inspector value to target candidate values
  |
  v
CssRuntimeNormalizer / TargetValueValidator
  validates target values using browser CSS APIs where applicable
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
Plans are inspectable in tests.
Plans can be snapshot-tested before touching files.
Platform code can add undo/snapshot around a known plan.
Shared dynamic Tailwind logic can use DI for FileIO/cache/runtime facts without
forking between VS Code and SaaS.
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

lib/style-read/
  style-read-manager.ts
  source-ownership.ts
  style-source-tabs.ts

lib/style-adapters/
  framework-style-adapter.ts
  registry.ts
  tailwind-v3/
    index.ts
    reader.ts
    writer.ts
    static-class-writer.ts
    dynamic-class-writer.ts
    dynamic-class-analyzer.ts
    token-resolver.ts
  tailwind-v4/
    index.ts
    reader.ts
    writer.ts
    static-class-writer.ts
    dynamic-class-writer.ts
    dynamic-class-analyzer.ts
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
  plain-css/
    index.ts
    reader.ts
    writer.ts
    selector-resolver.ts
  tamagui/
    index.ts
    reader.ts
    writer.ts
    layout-strategy.ts

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
  adapterId: string;
  sourceKind:
    | 'tailwind-class'
    | 'css-module-rule'
    | 'plain-css-rule'
    | 'inline-style'
    | 'emotion'
    | 'styled-components'
    | 'tamagui-prop';
  filePath: string;
  elementRef?: string;
  selector?: string;
  property: string;
  state?: 'base' | 'hover' | 'focus' | 'active' | string;
  media?: string;
  confidence: 'exact' | 'probable' | 'computed-only';
}
```

Planner rule:

```text
Prefer exact owners.
Avoid mutating probable owners unless no exact owner exists.
Computed-only values are read-only unless fallback policy allows local override.
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
  DynamicClassAnalyzer
  TokenResolver

TailwindV4Adapter:
  Reader
  Writer
    StaticClassWriter
    DynamicClassWriter
  DynamicClassAnalyzer
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
TailwindDynamicClassAnalyzer
TailwindClassGenerator
TailwindTokenResolver
```

Recommended:

```text
Keep `TailwindV3Adapter` and `TailwindV4Adapter` as top-level adapter identities.
Share internal reader/writer/analyzer/token code where behavior is identical.
Fork internal implementations only for real v3/v4 differences.
```

This avoids four top-level Tailwind adapters while still separating deterministic
static writes from higher-risk dynamic expression writes.

Dynamic Tailwind analysis itself should be shared:

```text
TailwindDynamicClassAnalyzer:
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

If an optional AI ambiguity resolver exists, it is separate from the core
analyzer and injected as an optional dependency. Core dynamic Tailwind behavior
must not fork into separate server/local implementations.

### High-level flow

```text
Inspector UI
  |
  v
InspectorValueCodec
  converts source/runtime values <-> canonical inspector values
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

Responsible for conversion between source/runtime values and inspector values.

```typescript
type StyleValueSource =
  | 'computed-css'
  | 'inline-css'
  | 'css-file'
  | 'tailwind'
  | 'tamagui-prop'
  | 'emotion'
  | 'styled-components';

type StyleValueTarget =
  | 'inline-css'
  | 'css-file'
  | 'tailwind'
  | 'tamagui-prop'
  | 'emotion'
  | 'styled-components';

interface InspectorValueCodec {
  toInspector(input: {
    key: string;
    value: unknown;
    source: StyleValueSource;
  }): NormalizedInspectorValue;

  fromInspector(input: {
    key: string;
    value: string;
    target: StyleValueTarget;
  }): TargetStyleValue;
}
```

Examples:

```text
computed-css opacity "0.5" -> inspector "50"
inline-css opacity "0.5"   -> inspector "50"
tailwind opacity "50"      -> inspector "50"
tamagui opacity 0.5        -> inspector "50"

inspector opacity "50" -> inline-css "0.5"
inspector opacity "50" -> tailwind "50"
inspector opacity "50" -> tamagui-prop 0.5
```

### `CssRuntimeNormalizer`

Browser-backed validator/normalizer for CSS targets.

```typescript
interface CssRuntimeNormalizer {
  normalize(input: {
    cssProperty: string;
    value: string;
  }): CssNormalizationResult;
}
```

Expected browser implementation:

```typescript
function normalizeCssValue(cssProperty: string, value: string) {
  if (value === '') return { kind: 'remove' };

  if (CSS.supports(cssProperty, value)) {
    return { kind: 'value', value };
  }

  if (/^-?\d+(\.\d+)?$/.test(value) && CSS.supports(cssProperty, `${value}px`)) {
    return { kind: 'value', value: `${value}px` };
  }

  return { kind: 'invalid', reason: `${cssProperty}: ${value}` };
}
```

`CSSStyleValue.parse()` can enrich diagnostics and type metadata. `CSS.supports`
should be the primary validity check because it is simple and matches CSS parser
acceptance.

### `StyleWriteManager`

Orchestrates planning and execution.

```typescript
interface StyleWriteManager {
  createPlan(ctx: StyleWriteContext): Promise<StyleWritePlan>;
  execute(plan: StyleWritePlan): Promise<StyleWriteResult>;
}
```

It must be shared by VS Code and SaaS. Platform composition roots inject file IO,
undo integration, FastPatch wiring, runtime normalizer, and framework adapter
instances.

### Framework adapter umbrella

Each CSS framework or styling system has one top-level adapter identity. Read,
write, token resolution, selector resolution, and layout behavior are facets
under that adapter, not separate framework identities.

```typescript
interface FrameworkStyleAdapter {
  readonly id: FrameworkId;
  readonly reader?: FrameworkStyleReader;
  readonly writer?: FrameworkStyleWriter;
  readonly sourceResolver?: FrameworkSourceResolver;
  readonly tokenResolver?: FrameworkTokenResolver;
  readonly layoutStrategy?: LayoutMutationStrategy;
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
}
```

This keeps `TailwindV3Adapter`, `TailwindV4Adapter`, `CssModulesAdapter`, and
other adapters as the visible extension points while still avoiding one huge
class.

### `StyleWritePlanner`

Selects source owner and framework adapter writer facet in priority order.

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

Top-level adapters:

```text
TailwindV3Adapter
TailwindV4Adapter
```

Each Tailwind adapter owns reader, writer, analyzer, and token/theme resolver
facets. Static and dynamic class handling are writer strategies under the
Tailwind adapter, not separate top-level adapters.

Static class writer handles:


```tsx
<div className="p-4 flex" />
```

Requirements:

```text
hasTailwind === true
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
```

Requirements:

```text
hasTailwind === true
className is a dynamic expression
```

Writes:

```text
Use location analysis where available.
Use DOM classes and current property-to-Tailwind map.
Use AI/cache only when deterministic location matching is ambiguous.
Fallback must remain Tailwind-aware.
```

This writer is intentionally separate inside the Tailwind adapter because it has
different dependencies and risk.

### CssModulesAdapter

Handles:

```tsx
import styles from './App.module.css';

<div className={styles.app} />
<div className={styles['app']} />
<div className={clsx(styles.app, active && styles.active)} />
```

Primary write:

```text
Resolve CSS module import.
Resolve class key.
Parse CSS file.
Update matching selector block.
```

Fallback:

```text
If selector resolution is ambiguous or style maps to multiple module keys,
delegate to InlineStyleAdapter.
```

Important:

```text
Do not append Tailwind classes unless hasTailwind is true and planner explicitly
selects a Tailwind adapter for that write.
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

It must receive target-ready CSS values from `InspectorValueCodec` plus
`CssRuntimeNormalizer`. It must not know inspector semantics such as
`opacity 50 -> 0.5`.

### EmotionAdapter

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
```

Primary write:

```text
Resolve side-effect CSS/Sass imports.
Find selector matching className.
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
  - expose selectors as Style Source Tabs

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

### TamaguiAdapter

Handles:

```tsx
<YStack padding="$4" opacity={0.5} />
```

Writes:

```text
JSX props via updateProps-style mutation.
```

It receives target-ready prop values from `InspectorValueCodec`.

## CSS File Utilities

CSS Modules and plain CSS adapters share CSS file infrastructure:

```text
lib/style-write/mutations/css-file-resolver.ts
  resolve CSS file paths from JSX imports

lib/style-write/mutations/css-rule-finder.ts
  find matching selectors and pseudo/media contexts

lib/style-write/mutations/css-rule-mutator.ts
  add/modify/remove declarations with PostCSS

lib/style-read/cascade-resolver.ts
  sort matching declarations by specificity, order, media, and active state
```

PostCSS is required for CSS file parsing and mutation. Additional syntax plugins
may be required for SCSS/Less/Stylus; `.css` is the baseline parser target, and
preprocessor support must be covered by fixtures before release.

## Tailwind v3/v4 Strategy

Tailwind top-level adapter identity is split by version first:

```text
TailwindV3Adapter
  Reader
  Writer.StaticClassWriter
  Writer.DynamicClassWriter
  TokenResolver

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
  -> InspectorValueCodec.toInspector
  -> ParsedStyles for UI
```

Desired read flow:

```text
Selected element
  -> source AST + DOM element/computed style
  -> active framework adapter readers read raw values
  -> source tabs are built from class/selector/style owners
  -> conflict resolver chooses displayed value per property
  -> InspectorValueCodec.toInspector
  -> RightSidebar state
```

Read output must include style source tabs, not only `ParsedStyles`:

```typescript
interface StyleSourceTab {
  id: string;
  // UI label. Must be CSS class/selector identity, never a local JS variable
  // expression such as `styles.card`.
  label: string;
  kind:
    | 'computed'
    | 'tailwind'
    | 'css-module-class'
    | 'plain-css-selector'
    | 'inline-style'
    | 'emotion'
    | 'styled-components'
    | 'tamagui-props';
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
  state?: string;
  isDefault: boolean;
  confidence: 'exact' | 'probable' | 'computed-only';
}

interface PropertySource {
  property: string;
  value: string;
  sourceTabId: string;
  specificity?: number;
  active: boolean;
}
```

`Computed` is the default tab. It is an aggregate view, not a source by itself.
Writes from Computed must be routed to a concrete source tab by the planner and
source router.

## Style Source Tabs

The inspector needs source tabs for class/selector-based systems.

```text
[Computed] [Tailwind] [.card] [.featured] [.globalCard] [Inline override]
[Base]     [Hover]    [Focus] [Active]
```

Rules:

```text
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

Explicit source tab:
  user intent is authoritative.
  planner writes to that source.
  AI routing is skipped.

Inline override tab:
  explicitly selects InlineStyleAdapter.
  plan must include reason "explicit-local-override".
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

```typescript
interface StyleWritePlanBase {
  id: string;
  kind: StyleWritePlanKind;
  projectRoot: string;
  sourceElement: {
    filePath: string;
    elementRef: string;
    tagName?: string;
  };
  requestedStyles: Record<string, string>;
  targetStyles: Record<string, unknown>;
  selectedSourceTabId?: string;
  routeDecision?: {
    sourceTabId: string;
    router: 'explicit-user-selection' | 'ai-style-source-router' | 'deterministic-owner-router';
    reason: string;
    confidence: 'exact' | 'probable' | 'ai-assisted' | 'fallback';
  };
  state?: 'base' | 'hover' | 'focus' | 'active' | string;
  reason:
    | 'existing-owner'
    | 'project-primary-system'
    | 'element-primary-system'
    | 'mixed-system-tailwind-priority'
    | 'css-module-selector-ambiguous'
    | 'css-rule-not-found'
    | 'dynamic-source-ambiguous'
    | 'explicit-local-override';
  confidence: 'exact' | 'probable' | 'fallback';
  diagnostics: Array<{
    level: 'info' | 'warning' | 'error';
    message: string;
  }>;
}
```

`requestedStyles` are inspector-level keys/values. `targetStyles` are already
converted for the selected target by `InspectorValueCodec` and target validators.

### Plan union

Plan kinds describe the mutation shape and execution target. They are not
top-level framework adapter identities. For example, `tailwind-static-class` and
`tailwind-dynamic-class` are plan kinds emitted by `TailwindV3Adapter.Writer` or
`TailwindV4Adapter.Writer`.

```typescript
type StyleWritePlan =
  | TailwindStaticClassPlan
  | TailwindDynamicClassPlan
  | CssModuleFilePlan
  | PlainCssFilePlan
  | InlineStylePlan
  | CssInJsPlan
  | PropsPlan;

interface TailwindStaticClassPlan extends StyleWritePlanBase {
  kind: 'tailwind-static-class';
  target: {
    filePath: string;
    elementRef: string;
    removeForProperties: string[];
    addClasses: string;
    state?: string;
  };
}

interface TailwindDynamicClassPlan extends StyleWritePlanBase {
  kind: 'tailwind-dynamic-class';
  target: {
    filePath: string;
    elementRef: string;
    locations: ClassNameLocation[];
    addClasses: string;
    removeForProperties: string[];
    fallbackStrategy: 'append-to-template' | 'wrap-expression' | 'location-only';
    analysis: {
      engine: 'shared-deterministic-analyzer';
      ambiguityResolverUsed?: boolean;
    };
  };
}

interface CssModuleFilePlan extends StyleWritePlanBase {
  kind: 'css-module-file';
  target: {
    cssFilePath: string;
    importSource: string;
    importLocalName: string;
    classKey: string;
    selector: string;
    declarations: Record<string, string>;
    pseudo?: string;
    media?: string;
  };
}

interface PlainCssFilePlan extends StyleWritePlanBase {
  kind: 'plain-css-file';
  target: {
    cssFilePath: string;
    selector: string;
    declarations: Record<string, string>;
    pseudo?: string;
    media?: string;
    cascadeOwner: StyleSourceOwner;
  };
}

interface InlineStylePlan extends StyleWritePlanBase {
  kind: 'inline-style';
  target: {
    filePath: string;
    elementRef: string;
    styles: Record<string, string>;
    mergeMode: 'object' | 'spread-existing-expression';
  };
}

interface CssInJsPlan extends StyleWritePlanBase {
  kind: 'css-in-js';
  target: {
    filePath: string;
    owner: 'emotion' | 'styled-components';
    mutation:
      | { kind: 'object-expression'; objectPath: string; styles: Record<string, unknown> }
      | { kind: 'template-literal'; quasiPath: string; declarations: Record<string, string>; pseudo?: string };
  };
}

interface PropsPlan extends StyleWritePlanBase {
  kind: 'props';
  target: {
    filePath: string;
    elementRef: string;
    props: Record<string, unknown>;
  };
}
```

### Examples

Tailwind static class:

```typescript
{
  id: 'plan-1',
  kind: 'tailwind-static-class',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:12:4', tagName: 'div' },
  requestedStyles: { paddingLeft: '16', paddingRight: '16' },
  targetStyles: { paddingLeft: '16', paddingRight: '16' },
  reason: 'project-primary-system',
  confidence: 'exact',
  diagnostics: [],
  target: {
    filePath: 'src/App.tsx',
    elementRef: 'src/App.tsx:12:4',
    removeForProperties: ['paddingLeft', 'paddingRight'],
    addClasses: 'px-[16px]',
  },
}
```

CSS Modules file write:

```typescript
{
  id: 'plan-2',
  kind: 'css-module-file',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:20:6', tagName: 'div' },
  requestedStyles: { paddingLeft: '16', paddingRight: '16' },
  targetStyles: { paddingLeft: '16px', paddingRight: '16px' },
  reason: 'existing-owner',
  confidence: 'exact',
  diagnostics: [],
  target: {
    cssFilePath: 'src/App.module.css',
    importSource: './App.module.css',
    importLocalName: 'styles',
    classKey: 'app',
    selector: '.app',
    declarations: {
      'padding-left': '16px',
      'padding-right': '16px',
    },
  },
}
```

Inline fallback:

```typescript
{
  id: 'plan-3',
  kind: 'inline-style',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/App.tsx', elementRef: 'src/App.tsx:20:6', tagName: 'div' },
  requestedStyles: { backgroundColor: '#4285f4' },
  targetStyles: { backgroundColor: '#4285f4' },
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
    styles: { backgroundColor: '#4285f4' },
    mergeMode: 'object',
  },
}
```

CSS Modules hover state:

```typescript
{
  id: 'plan-4',
  kind: 'css-module-file',
  projectRoot: '/project',
  sourceElement: { filePath: 'src/Card.tsx', elementRef: 'src/Card.tsx:8:4', tagName: 'div' },
  requestedStyles: { backgroundColor: '#ef4444' },
  targetStyles: { backgroundColor: '#ef4444' },
  state: 'hover',
  reason: 'existing-owner',
  confidence: 'exact',
  diagnostics: [],
  target: {
    cssFilePath: 'src/Card.module.css',
    importSource: './Card.module.css',
    importLocalName: 'styles',
    classKey: 'card',
    selector: '.card',
    pseudo: ':hover',
    declarations: {
      'background-color': '#ef4444',
    },
  },
}
```

### Plan validation

Before execution:

```text
Validate target file paths are inside project root.
Validate target values are already normalized for the target.
Validate fallback plans include a fallback reason and warning diagnostic.
Validate state plans have a real source target for that state.
Validate executor supports the plan kind.
```

### Test requirements

Planner tests should assert plans directly:

```text
Input fixture -> expected StyleWritePlan
```

Executor tests should assert mutations:

```text
StyleWritePlan + source fixture -> expected file diff
```

E2E tests should assert:

```text
UI action -> expected plan kind logged/diagnosed -> expected source mutation -> no DOM runtime error
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

## Policy Rules

### Framework adapter selection priority

Priority:

```text
1. TamaguiAdapter writer facet, when the element is Tamagui-owned
2. Existing exact source owner for the property and state
3. Existing primary style-system owner for the element
4. TailwindV3Adapter/TailwindV4Adapter writer facet for new properties only
   when Tailwind is part of the element's mixed owners, or the element has no
   owner and Tailwind is available/applicable
5. CssModulesAdapter writer facet when className references CSS module import and the
   element is CSS Modules-owned
6. EmotionAdapter/StyledComponentsAdapter writer facet when element maps to
   local declarations
7. PlainCssAdapter writer facet when selector can be resolved
8. InlineStyleAdapter writer facet as explicit fallback with reason/confidence
```

### Mixed Tailwind + CSS Modules

Mixed projects need explicit policy.

Policy:

```text
Existing property owner wins.
If the property is new but the element has a single style-system owner, that
element owner wins.
If the property is new and the element is already mixed, the strongest applicable
style system among the element owners wins.
Tailwind is the strongest style system when it is already one of the element
owners, or when the element has no style owner and Tailwind is available for the
project and applicable to the element.
Conflicts are not automatically removed; cleanup requires a separate safe proof.
```

This policy must be encoded in the planner, not in individual adapters.

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
- [ ] Explicit source tab selection skips AI routing.
- [ ] Computed tab uses AI source routing first for CSS Modules/plain CSS when AI is enabled.
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

- [ ] Add `TailwindV3Adapter` with reader, writer, analyzer, and token resolver facets.
- [ ] Add `TailwindV4Adapter` with reader, writer, analyzer, token resolver, and theme resolver facets.
- [ ] Extract deterministic static Tailwind class mutation into each adapter's writer facet.
- [ ] Extract shared deterministic dynamic Tailwind analyzer used by both adapters.
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
- [ ] Write to CSS module file as the primary path.
- [ ] Use InlineStyleAdapter fallback only when no safe CSS Modules plan can be produced.
- [ ] Ensure non-Tailwind CSS Modules never append Tailwind classes.

### Phase 5b: Add Style Source Tabs and routing

- [ ] Add Computed tab as default aggregate view.
- [ ] Add source tabs for Tailwind, CSS Modules classes, plain CSS selectors, inline style, CSS-in-JS, and Tamagui props where applicable.
- [ ] Add selected source tab to write context and `StyleWritePlan`.
- [ ] Add AI StyleSourceRouter for Computed-tab CSS Modules/plain CSS routing.
- [ ] Ensure explicit source tab selection bypasses AI routing.

### Phase 6: Wire VS Code and SaaS through shared manager

- [ ] VS Code `AstService.updateStyles` delegates to `StyleWriteManager`.
- [ ] SaaS `/api/update-component-styles` delegates to `StyleWriteManager`.
- [ ] Platform-specific code injects file IO, undo/snapshot, FastPatch wiring, shared analyzer infrastructure, cache, and logging.
- [ ] Remove duplicated Tailwind mutation code from platform endpoints.

### Phase 7: Update read path

- [ ] Replace VS Code `styles:readClassName` with framework-aware style read.
- [ ] Add `StyleReadManager`.
- [ ] Let framework adapter reader facets read raw source values.
- [ ] Let `InspectorValueCodec.toInspector` canonicalize display values.
- [ ] Preserve computed style fallback for CSS Modules/generic CSS.

### Phase 8: Add CSS-in-JS and CSS file adapter facets

- [ ] EmotionAdapter writer facet: object `css` prop, template literals, and pseudo-state writes where resolvable.
- [ ] StyledComponentsAdapter writer facet: styled template declaration edits.
- [ ] PlainCssAdapter writer facet: side-effect import and class selector edit.
- [ ] Planner-level composite routing for per-property routing across multiple active systems.

## Acceptance Criteria

- [ ] `className={styles.app}` in non-Tailwind CSS Modules project is never
      rewritten by appending Tailwind classes.
- [ ] Tailwind projects still use Tailwind class writes.
- [ ] Mixed Tailwind + CSS Modules project behavior is explicit and tested.
- [ ] `opacity` inspector conversions are centralized in `InspectorValueCodec`.
- [ ] CSS unit normalization uses browser CSS APIs where available.
- [ ] VS Code and SaaS use the same planner and framework adapter selection.
- [ ] Platform code no longer owns style write strategy.
- [ ] Style Source Tabs are available for class/selector-based systems.
- [ ] AI source routing has first priority on Computed tab for CSS Modules/plain CSS when enabled.
- [ ] Explicit source tab selection always beats AI routing.
- [ ] InlineStyleAdapter is a permanent universal fallback with reason/confidence diagnostics.
- [ ] Dynamic Tailwind analyzer logic is shared; DI supplies only infrastructure.
- [ ] FastPatch is retained as optimistic preview and is never used as write success criteria.
- [ ] E2E tests detect rendered runtime error overlays in the DOM.

## Open Questions

1. Read conflict resolution:
   if the same property exists in Tailwind and CSS Modules, which value should
   the inspector display and which source should writes update by default?

2. AI source routing UX:
   when AI is enabled but low confidence, should the UI ask for confirmation or
   apply the route and expose diagnostics/history?
