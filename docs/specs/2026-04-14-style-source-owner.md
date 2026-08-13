> **⚠️ SUPERSEDED** by the [2026-06-12 Styles System Master Spec](./2026-06-12-styles-system-master-spec.md) (see Part/§ 2.1, 3.3, 7.3). Retained for history; do not follow for new work.

# Style Source Owner

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Source ownership identity for inspector style reads/writes.
**Parent spec:** `docs/specs/2026-04-14-style-write-unification-plan.md`

## Goal

Define the minimal source ownership model used by read results, source tabs, and
write planning.

The owner needs two style identity fields:

```text
cssSystem:
  which styling system owns this source.

sourceForm:
  which broad source surface is mutated: element class, CSS style rule, script
  React-style rule, script native-CSS rule, adapter-known element prop, or
  arbitrary element prop.
```

There is no separate `adapterId` or detailed `sourceKind` enum. Adapter lookup
is derived from `cssSystem`; detailed AST location belongs in source metadata or
the concrete write plan.

## Types

```typescript
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

type CssSyntaxId = 'css' | 'scss' | 'sass' | 'less' | 'stylus';

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

`StylePseudoState`, `StyleCondition`, `CascadeContext`, and `SourceConfidence`
are defined by the parent spec. Theme runtime/source semantics are detailed in
`docs/specs/2026-04-15-style-theme-resolution.md`. The confidence model is
detailed in `docs/specs/2026-04-14-style-source-confidence.md`.

`arbitraryElementProp` is part of `SourceForm` because prop write plans need to
classify explicit prop edits. It is not an automatic `StyleSourceOwner` for the
standard style inspector because no `cssSystem` owns the semantics.

## Field Semantics

### `cssSystem`

`cssSystem` answers:

```text
Which styling system owns the semantics and should select the framework adapter?
```

Examples:

```text
tailwind-v4       -> Tailwind class generation/token semantics
css-modules       -> local CSS Module class rule
plain-css         -> imported/global CSS selector rule
inline-style      -> JSX style object
emotion           -> Emotion css/styled source
styled-components -> styled-components declaration
vanilla-extract   -> typed .css.ts style declaration
mui-system        -> MUI sx/system style declaration
chakra-ui         -> Chakra style prop declaration
mantine           -> Mantine style prop/styles declaration
tamagui           -> Tamagui style prop
```

### `sourceForm`

`sourceForm` answers:

```text
Which broad source surface will be mutated?
```

Values:

```text
elementClass:
  class/className token on the selected element. Example: Tailwind utility
  class generated into a JSX `className` string/expression.

cssStyleRule:
  rule in a CSS-like stylesheet. Examples: CSS Modules `.card`, plain CSS
  `.globalCard`, SCSS/Less/Stylus rules after syntax-aware parsing.

scriptReactStyleRule:
  style rule defined in script source with React-style object syntax and
  camelCase property names. Examples: JSX `style={{ paddingLeft: 16 }}`,
  Emotion `css={{ paddingLeft: 16 }}`, Emotion `css({ paddingLeft: 16 })`,
  vanilla-extract `style({ ... })`.

scriptNativeStyleRule:
  style rule defined in script source with native CSS syntax and kebab-case
  property names. Examples: styled-components template literals,
  Emotion ``css`padding-left: 16px;` ``.

adapterKnownElementProp:
  component style prop on the selected element where style is represented as
  component props and a registered mapper knows the semantics. Examples:
  Tamagui `padding="$4"`, Chakra `p={4}`, future library-specific style props.

arbitraryElementProp:
  component prop with no registered style mapper. Examples: `color`, `size`,
  `theme`, `variant`, or any app-specific prop on an unsupported component.
  These props are editable through the recursive props editor or explicit prop
  selection. The standard style inspector must not infer that `color` means CSS
  `color` or that `size` means width/height without a mapper.
```

`sourceForm` is intentionally coarse. It should not encode every mutation
variant such as static Tailwind string vs dynamic `cn()` expression. Those
details belong in `sourceRef`, adapter-specific source metadata, and the final
`StyleWritePlan`.

### `cssSyntax`

`cssSyntax` answers:

```text
Which parser/mutator syntax is required for a cssStyleRule source?
```

Values:

```text
css
scss
sass
less
stylus
```

It is required when `sourceForm: 'cssStyleRule'` and omitted for element class,
script rule, and element prop sources.

Examples:

```typescript
{ cssSystem: 'plain-css', sourceForm: 'cssStyleRule', cssSyntax: 'scss' }
{ cssSystem: 'css-modules', sourceForm: 'cssStyleRule', cssSyntax: 'less' }
```

`cssSystem` should not encode preprocessor information. `plain-css` means
selector/rule ownership; `cssSyntax` says whether the concrete file is `.css`,
`.scss`, `.sass`, `.less`, or `.styl`.

### `condition`

`condition` answers:

```text
Under which theme, state, responsive, media, or container condition does this owner
apply?
```

It is shared by Tailwind responsive/theme/selector variants, CSS `@media` /
`@container` / `@supports`, CSS-in-JS nested conditions, MUI `sx` responsive
values, and adapter-known responsive props such as MUI Grid
`size={{ xs: 12, md: 6 }}`.

`StyleCondition` is extensible. It should not try to enumerate every library
feature as a closed enum. Common axes are first-class; uncommon or future
adapter-specific conditions can be preserved through `selector` or `raw` until
they receive explicit UI/editor support. A `raw` condition is preservation
metadata, not permission for blind writes; the owning adapter must validate it
before mutation.

Examples:

```typescript
{ condition: { state: 'base' } }
{ condition: { state: 'hover' } }
{
  condition: {
    state: 'hover',
    viewport: { kind: 'viewport', key: 'md', minWidthPx: 768, source: 'tailwind-screens' },
  },
}
{
  condition: {
    state: 'base',
    media: [{ kind: 'media', query: '@media print', source: 'css-media-query' }],
  },
}
{
  condition: {
    state: 'base',
    container: {
      kind: 'container',
      key: 'md',
      containerName: 'card',
      minWidthPx: 480,
      source: 'css-container-query',
    },
  },
}
{
  condition: {
    state: 'base',
    theme: [
      {
        axis: 'color-scheme',
        value: 'dark',
        source: 'tailwind-dark-selector',
        selector: '.dark &',
      },
    ],
    selector: [
      {
        kind: 'group-selector',
        selector: '.group:hover &',
        label: 'group-hover',
        source: 'tailwind-variant',
      },
    ],
  },
}
{
  condition: {
    state: 'base',
    selector: [
      {
        kind: 'data-attribute',
        selector: "[data-state='open'] &",
        label: 'data-state=open',
        source: 'css-selector',
      },
      {
        kind: 'structural-selector',
        selector: ':has(input:checked)',
        label: ':has(input:checked)',
        source: 'css-selector',
      },
    ],
  },
}
```

The inspector may render this as a condition row above source tabs and
pseudo-state tabs. It should expose common editable axes directly and render
selector-context conditions as chips/source metadata until there is a dedicated
editor for that family.

Theme conditions are source ownership metadata. The product runtime context may
come from HyperIDE or VS Code as `light`, `dark`, or `system`, but `system` is
resolved to light/dark before routing and does not become a source condition.

CSS variable example:

```css
.dark {
  --card-bg: #111827;
}

.card {
  background: var(--card-bg);
}
```

```typescript
{
  cssSystem: 'plain-css',
  sourceForm: 'cssStyleRule',
  filePath: 'src/styles.css',
  selector: '.card',
  property: 'background',
  condition: { state: 'base' },
  confidence: 'exact',
}
{
  cssSystem: 'plain-css',
  sourceForm: 'cssStyleRule',
  filePath: 'src/styles.css',
  selector: '.dark',
  property: '--card-bg',
  condition: {
    state: 'base',
    theme: [{ axis: 'color-scheme', value: 'dark', source: 'class-selector', selector: '.dark &' }],
  },
  confidence: 'exact',
}
```

The first owner is the usage declaration. The second owner is the theme value
owner. A linked token/theme write should target the value owner; a source-tab
edit of `.card` may target the usage declaration.

### `cascadeContext`

`cascadeContext` answers:

```text
Inside which cascade container does this owner live?
```

It is separate from `condition` because `@layer`, `@scope`, and some at-rule
stacks are source-placement/cascade ownership, not user-facing responsive or
state filters.

Examples:

```typescript
{
  condition: { state: 'base' },
  cascadeContext: { layer: 'components' },
}
{
  condition: { state: 'hover' },
  cascadeContext: {
    layer: 'components',
    scope: { rootSelector: '.card' },
    atRuleStack: [{ name: 'layer', params: 'components' }],
  },
}
```

For CSS-rule writes, the executor must preserve the matched cascade context and
write inside it instead of recreating a rule at top level.

## Tamagui

GitHub: [tamagui/tamagui](https://github.com/tamagui/tamagui)

There is no `tamagui-props` CSS system.

Tamagui can appear in two capability arrays with the same string and different
roles:

```typescript
projectCssSystems: ['tamagui'];
projectUiKits: ['tamagui'];
```

Meaning:

```text
CssSystemId `tamagui`:
  style writes are represented as adapter-known Tamagui props.

UiKitId `tamagui`:
  component semantics and layout strategy may also matter.
```

For a concrete style source owner, the model stays simple:

```typescript
{
  cssSystem: 'tamagui',
  sourceForm: 'adapterKnownElementProp',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'padding',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

## Adapter-Known vs Arbitrary Props

`adapterKnownElementProp` means a registered component prop mapper can explain
how an inspector style property maps to source props.

```tsx
<YStack padding="$4" opacity={0.5} />
```

```typescript
{
  cssSystem: 'tamagui',
  sourceForm: 'adapterKnownElementProp',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'padding',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

```tsx
<Box p={4} bg="blue.500" _hover={{ bg: 'blue.600' }} />
```

```typescript
{
  cssSystem: 'chakra-ui',
  sourceForm: 'adapterKnownElementProp',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'background-color',
  condition: { state: 'hover' },
  confidence: 'exact',
}
```

`scriptReactStyleRule` is still the correct source form when the mutable prop is
a React-style object rule:

```tsx
<Box sx={{ paddingLeft: 2 }} />
<Button styles={{ root: { paddingLeft: 16 } }} />
<div style={{ paddingLeft: 16 }} />
```

```typescript
{
  cssSystem: 'mui-system',
  sourceForm: 'scriptReactStyleRule',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

`arbitraryElementProp` is explicit prop editing, not automatic CSS routing. It
does not need `cssSystem` because no style adapter owns the semantics:

```typescript
interface ComponentPropSource {
  sourceForm: 'arbitraryElementProp';
  filePath: string;
  elementRef: string;
  propPath: string[];
  confidence: SourceConfidence;
}
```

```tsx
<ThirdPartyCard color="red" size="lg" variant="solid" theme={{ mode: 'dark' }} />
```

```typescript
{
  sourceForm: 'arbitraryElementProp',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  propPath: ['variant'],
  confidence: 'exact',
}
```

This record belongs to the recursive props editor or an explicit prop write
plan. A normal standard-inspector style write must not infer that `color`,
`size`, `variant`, or `theme` corresponds to a CSS property unless a mapper owns
that conversion.

## Examples

### Tailwind Static Class

GitHub: [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)

```tsx
<div className="pl-4 text-primary" />
```

```typescript
{
  cssSystem: 'tailwind-v4',
  sourceForm: 'elementClass',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

The source metadata can still say the token lives in a static string literal.
That detail is not part of source identity.

### Tailwind Dynamic Class

GitHub: [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)

```tsx
<div className={cn('pl-4', active && 'bg-primary')} />
<div className={size === 'lg' ? 'p-6' : 'p-4'} />
```

```typescript
{
  cssSystem: 'tailwind-v4',
  sourceForm: 'elementClass',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'background-color',
  condition: { state: 'base' },
  confidence: 'probable',
}
```

The shared ClassExpressionAnalyzer records expression details in `sourceRef` or the
write plan. The owner still says only: Tailwind element class source.

Tailwind dynamic class writes are valid only for complete Tailwind class tokens
that are scanner-visible or safelisted. Interpolated utility fragments are not
supported:

```tsx
<div className={`p-${p}`} />
```

That expression is incompatible with Tailwind's static generation model because
the generated CSS is not guaranteed to exist. Do not support it as a Tailwind
write target; route to another owner/fallback or emit an unsupported diagnostic.

### CSS Modules Class

GitHub: [css-modules/css-modules](https://github.com/css-modules/css-modules)

```tsx
import styles from './Card.module.css';

<div className={styles.card} />;
```

```css
.card {
  padding-left: 16px;
}
```

```typescript
{
  cssSystem: 'css-modules',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'css',
  filePath: 'src/Card.module.css',
  selector: '.card',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

The tab label should be `.card`, not `styles.card`. Import variable names are
implementation metadata.

### CSS Modules Mixed Classes

GitHub: [css-modules/css-modules](https://github.com/css-modules/css-modules)

```tsx
<div className={`${styles.card} ${styles.featured}`} />
```

```css
.card {
  padding: 12px;
}

.featured {
  background: gold;
}
```

For a computed background value:

```typescript
{
  cssSystem: 'css-modules',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'css',
  filePath: 'src/Card.module.css',
  selector: '.featured',
  property: 'background-color',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

For a new border value from the Computed tab with AI routing enabled, AI may
choose `.card` as the semantic target:

```typescript
{
  cssSystem: 'css-modules',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'css',
  filePath: 'src/Card.module.css',
  selector: '.card',
  property: 'border-color',
  condition: { state: 'base' },
  confidence: 'probable',
}
```

The write is still deterministic after routing: mutate `.card` in the CSS Module
file.

### CSS Modules Dynamic Key

GitHub: [css-modules/css-modules](https://github.com/css-modules/css-modules)

```tsx
<div className={styles[style]} />
```

If runtime/source analysis proves `style === 'card'` for the selected element:

```typescript
{
  cssSystem: 'css-modules',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'css',
  filePath: 'src/Card.module.css',
  selector: '.card',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

If several module keys are possible, the owner remains a candidate source tab
with `confidence: 'probable'` until the user selects the tab, AI routing chooses
one, or deterministic runtime facts upgrade it.

### Generated vs Source Class Names

Runtime class names are not always source identities.

```text
CSS Modules:
  runtime class may be `_card_ab12x`; source identity is `.card`.

vanilla-extract:
  runtime class may include generated hashing; source identity is the exported
  style name such as `card`.

Emotion / MUI / styled-components:
  runtime classes such as `css-...` or `sc-...` are implementation output;
  source identity should be `sx prop`, `css prop`, a local styled component
  name, or a local css/styled definition when fiber/source tracing can resolve
  it.
```

The read path must use fiber tracing, node refs, JSX source location, imports,
and AST expressions to recover original class keys or source definitions before
showing generated class names. Generated runtime classes may remain in source
metadata for matching and diagnostics, but they should not be the primary tab
label when source identity is available.

### Mixed Dynamic Class Expression

```tsx
<div className={cn('foo', { bar: isBar, [styles.baz]: isBaz })} />
<div className={`block_${mod}`} />
```

The same `className` expression can produce multiple source owners:

```typescript
[
  {
    cssSystem: 'plain-css',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/global.css',
    selector: '.foo',
    property: 'color',
    condition: { state: 'base' },
    confidence: 'probable',
  },
  {
    cssSystem: 'plain-css',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/global.css',
    selector: '.bar',
    property: 'color',
    condition: { state: 'base' },
    confidence: 'probable',
  },
  {
    cssSystem: 'css-modules',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/Card.module.css',
    selector: '.baz',
    property: 'color',
    condition: { state: 'base' },
    confidence: 'probable',
  },
];
```

Dynamic class expression analysis is shared. It does not imply Tailwind and it
does not decide the final write target by itself. Unlike Tailwind partial
utility templates, non-Tailwind class systems can use patterns such as
`` `block_${mod}` `` as valid routing inputs when they can be resolved to
concrete selectors like `.block_primary` or `.block_secondary`.

### Plain CSS Selector

```tsx
import './global.css';

<div className="card featured" />;
```

```typescript
{
  cssSystem: 'plain-css',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'css',
  filePath: 'src/global.css',
  selector: '.card',
  property: 'border-color',
  condition: { state: 'base' },
  confidence: 'probable',
}
```

`sourceForm: 'cssStyleRule'` covers selector-backed CSS sources. The exact
selector is carried by `selector`.

### Plain SCSS Selector

```tsx
import './App.scss';

<div className={`block_${mod}`} />;
```

```typescript
{
  cssSystem: 'plain-css',
  sourceForm: 'cssStyleRule',
  cssSyntax: 'scss',
  filePath: 'src/App.scss',
  selector: '.block_primary',
  property: 'border-color',
  condition: { state: 'base' },
  confidence: 'probable',
}
```

The CSS system is still `plain-css`; `cssSyntax: 'scss'` selects the SCSS parser
and mutator path.

### Inline Style

```tsx
<div style={{ paddingLeft: 16 }} />
```

```typescript
{
  cssSystem: 'inline-style',
  sourceForm: 'scriptReactStyleRule',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

JSX `style={{ ... }}` is syntactically a prop, but its mutable style surface is
a React-style object rule. It is not `adapterKnownElementProp` and not
`arbitraryElementProp`.

### Emotion CSS Prop

GitHub: [emotion-js/emotion](https://github.com/emotion-js/emotion)

```tsx
<div css={{ paddingLeft: 16 }} />
```

```typescript
{
  cssSystem: 'emotion',
  sourceForm: 'scriptReactStyleRule',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

Emotion `css` is syntactically a JSX prop, but it produces CSS-in-JS rule
semantics rather than an inline element prop. That is why its source form is
`scriptReactStyleRule`; the exact JSX prop/object location belongs in source
metadata.

### Styled Components Template Literal

GitHub: [styled-components/styled-components](https://github.com/styled-components/styled-components)

```tsx
const Card = styled.div`
  padding-left: 16px;
`;
```

```typescript
{
  cssSystem: 'styled-components',
  sourceForm: 'scriptNativeStyleRule',
  filePath: 'src/Card.tsx',
  selector: 'Card',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

The template literal stores native CSS syntax in a script file, so it is
`scriptNativeStyleRule`.

### Vanilla Extract

GitHub: [vanilla-extract-css/vanilla-extract](https://github.com/vanilla-extract-css/vanilla-extract)

```typescript
export const card = style({
  paddingLeft: 16,
});
```

```typescript
{
  cssSystem: 'vanilla-extract',
  sourceForm: 'scriptReactStyleRule',
  filePath: 'src/Card.css.ts',
  selector: 'card',
  property: 'padding-left',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

`selector` is a normalized owner label here, not necessarily a literal CSS
selector in source. The source surface is still React-style object syntax.

### Tamagui Prop

GitHub: [tamagui/tamagui](https://github.com/tamagui/tamagui)

```tsx
<YStack padding="$4" opacity={0.5} />
```

```typescript
{
  cssSystem: 'tamagui',
  sourceForm: 'adapterKnownElementProp',
  filePath: 'src/Card.tsx',
  elementRef: 'src/Card.tsx:8:4',
  property: 'opacity',
  condition: { state: 'base' },
  confidence: 'exact',
}
```

## Source Tabs

Source tabs can reuse the same simplified model:

```typescript
interface StyleSourceTab {
  id: string;
  label: string;
  cssSystem?: CssSystemId;
  sourceForm?: SourceForm;
  cssSyntax?: CssSyntaxId;
  filePath?: string;
  selector?: string;
  condition: StyleCondition;
  cascadeContext?: CascadeContext;
  confidence: SourceConfidence;
}
```

Examples:

```typescript
[
  {
    id: 'computed',
    label: 'Computed',
    condition: { state: 'base' },
    confidence: 'computed-only',
  },
  {
    id: 'css-modules:card',
    label: '.card',
    cssSystem: 'css-modules',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/Card.module.css',
    selector: '.card',
    condition: { state: 'base' },
    confidence: 'exact',
  },
  {
    id: 'plain-css:globalCard',
    label: '.globalCard',
    cssSystem: 'plain-css',
    sourceForm: 'cssStyleRule',
    cssSyntax: 'css',
    filePath: 'src/global.css',
    selector: '.globalCard',
    condition: { state: 'base' },
    confidence: 'probable',
  },
  {
    id: 'emotion:css-prop',
    label: 'css prop',
    cssSystem: 'emotion',
    sourceForm: 'scriptReactStyleRule',
    filePath: 'src/Card.tsx',
    condition: { state: 'base' },
    confidence: 'exact',
  },
  {
    id: 'styled-components:Card',
    label: 'Card',
    cssSystem: 'styled-components',
    sourceForm: 'scriptNativeStyleRule',
    filePath: 'src/Card.tsx',
    selector: 'Card',
    condition: { state: 'base' },
    confidence: 'exact',
  },
  {
    id: 'inline',
    label: 'Inline override',
    cssSystem: 'inline-style',
    sourceForm: 'scriptReactStyleRule',
    filePath: 'src/Card.tsx',
    condition: { state: 'base' },
    confidence: 'exact',
  },
  {
    id: 'tamagui:props',
    label: 'Props',
    cssSystem: 'tamagui',
    sourceForm: 'adapterKnownElementProp',
    filePath: 'src/Card.tsx',
    condition: { state: 'base' },
    confidence: 'exact',
  },
];
```

`Computed` is identified by reserved `id: 'computed'` and by the absence of
`cssSystem` / `sourceForm`. It is an aggregate read view, not a source owner and
not a write target. A write from Computed must be routed to one concrete source.

Source tabs should include `adapterKnownElementProp` only when a mapper supports
standard style writes for the selected component. They should not include
`arbitraryElementProp`; arbitrary props belong in the recursive props editor.

## Invariants

```text
Do not add adapterId to StyleSourceOwner.
  Adapter lookup is derived from cssSystem.

Do not add a detailed sourceKind enum for every framework/source variant.
  Use sourceForm for broad write surface and source metadata for precise AST
  details.

Do not encode local JS import variable names in tab labels.
  Show `.card`, not `styles.card`.

Do not add a tab kind enum just to distinguish Computed from source tabs.
  Computed is the reserved tab with no cssSystem/sourceForm; source tabs have
  both fields.

Do not split Tamagui into `tamagui` and `tamagui-props`.
  The CSS system is `tamagui`; the source form is `adapterKnownElementProp`.

Do not use arbitraryElementProp as a standard style inspector target.
  It is only for explicit recursive prop edits where the user chose a prop path.
```
