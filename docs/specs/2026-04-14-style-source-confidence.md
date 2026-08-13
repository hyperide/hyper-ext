> **⚠️ SUPERSEDED** by the [2026-06-12 Styles System Master Spec](./2026-06-12-styles-system-master-spec.md) (see Part/§ 9.4). Retained for history; do not follow for new work.

# Style Source Confidence

**Date:** 2026-04-14
**Status:** Draft
**Scope:** Confidence semantics for inspector style source ownership.
**Parent spec:** `docs/specs/2026-04-14-style-write-unification-plan.md`
**Related spec:** `docs/specs/2026-04-15-style-theme-resolution.md`

## Goal

Define how the style system should classify confidence when it maps a displayed
style value back to source code.

This matters because the inspector can always read a browser computed value, but
it cannot always prove which project source declaration should be edited.

## Types

```typescript
type SourceConfidence = 'exact' | 'probable' | 'computed-only';
```

`SourceConfidence` belongs to source ownership records such as
`StyleSourceOwner` and source tabs. It is not a user-facing label by default.

## Exact

Use `exact` when the system can identify the source owner precisely enough for
automatic writes.

Examples:

```text
Inline style:
  <div style={{ paddingLeft: '16px' }} />
  -> exact owner for padding-left is the JSX style object property.

CSS Modules:
  <div className={styles.card} />
  Card.module.css contains `.card { padding-left: 16px; }`
  -> exact owner for padding-left is `.card` in Card.module.css.

Tailwind:
  <div className="pl-4" />
  -> exact owner for padding-left is `pl-4` in the className string.

Tamagui:
  <YStack paddingLeft="$4" />
  -> exact owner for padding-left is the adapter-known Tamagui prop.

Theme CSS variable:
  .dark { --card-bg: #111827 }
  .card { background: var(--card-bg) }
  -> exact theme value owner for --card-bg under color-scheme=dark when the
     variable scope and active theme condition are both resolved.
```

Default write behavior:

```text
The planner may write to an exact owner automatically when policy allows the
selected source and state.
```

## Probable

Use `probable` when the system has a strong candidate source owner but cannot
prove that it is the correct write target.

`probable` should still be visible to routing and UI source tabs. It is not safe
enough for silent mutation as if it were exact.

Common sources of `probable`:

```text
Cascade ambiguity:
  Multiple matching CSS selectors set the same property and the resolver cannot
  fully prove selector intent, source order, media/container context, or semantic
  ownership.

Dynamic className branches:
  className is built from runtime conditions, arrays, templates, helper calls,
  or props. DOM classes may identify the active branch, but writing into that
  branch still needs location proof.

Tailwind partial utilities:
  `p-${p}` or `text-${color}-500` are unsupported Tailwind write targets because
  Tailwind static generation will not reliably produce CSS for interpolated
  utility fragments.

Non-Tailwind dynamic selector patterns:
  `block_${mod}`, `styles[style]`, or conditional plain CSS class maps may be
  valid source-routing candidates when runtime/source facts can map them to
  concrete selectors or CSS Modules keys.

CSS Modules expression ambiguity:
  className combines multiple module keys and more than one key could be the
  semantic owner for a new property.

Plain CSS side-effect imports:
  A global class exists in more than one imported stylesheet or global CSS
  context, and the selected component does not uniquely identify the source file.

CSS-in-JS wrapper indirection:
  The selected DOM element maps to a styled wrapper or imported component, but
  the resolver has not proven the local definition that should be edited.

Source-map/runtime-only evidence:
  Runtime CSSOM or source maps suggest a source file, but the AST/CSS source
  resolver cannot produce a deterministic edit target yet.

Theme branch ambiguity:
  A value comes from a ternary, if branch, theme callback, or provider config,
  but the resolver cannot prove which branch corresponds to the active theme.

CSS variable fallback ambiguity:
  var(--card-bg-dark, var(--card-bg, #fff)) resolves visually, but the system
  cannot prove whether the write should create/update --card-bg-dark, update
  --card-bg, or replace the usage declaration.
```

Default write behavior:

```text
The planner should not silently mutate a probable owner as if it were exact.

A probable owner can become writable when one of these happens:
  - user explicitly selects the source tab;
  - AI/source router selects it with sufficient confidence;
  - deterministic resolver upgrades it to exact;
  - product policy allows a local fallback and the write plan includes a
    diagnostic explaining the fallback.
```

Examples:

```css
.card {
  padding-left: 12px;
}
.sidebar .card {
  padding-left: 16px;
}
```

If the selected element computes to `16px`, `.sidebar .card` may be the current
technical owner. It is still `probable` if the resolver cannot prove that this
selector is the semantic target for future writes.

```tsx
<div className={clsx(styles.card, active && styles.featured)} />
```

If `styles.featured` is active at runtime and both `.card` and `.featured` are
valid tabs, a new `backgroundColor` write from Computed can be `probable` until
the user selects a tab or source routing chooses one.

## Computed-Only

Use `computed-only` when the system can read the browser computed value but
cannot map it to a project source owner.

Examples:

```text
Third-party library CSS:
  Computed style comes from node_modules or injected runtime CSS that should not
  be edited by default.

Remote/runtime stylesheet:
  CSSOM contains a rule but no editable project file can be resolved.

Unsupported source syntax:
  Value is visible in the browser, but the source file cannot be parsed safely.

Theme runtime only:
  The preview renders a themed value, but the system cannot map it to an editable
  usage owner, theme value owner, token config, or script branch.

Inherited/default browser value:
  The value appears in computed style but was not set by an editable project
  declaration for this element.
```

Default write behavior:

```text
computed-only is not a source owner.

The inspector may display it, but the planner must not mutate "computed style"
as if it were source. Instead, computed-only starts new-property routing:
  - if a supported flat system is selected/available, create a new owner there;
  - if a cascade system is selected/available, resolve a cssStyleRule,
    scriptReactStyleRule, or scriptNativeStyleRule target first;
  - if no target can be resolved, use explicit InlineStyleAdapter local override
    policy with diagnostics.
```

Flat systems can often turn computed-only into an exact write target:

```text
Tailwind available and selected by policy:
  computed-only padding-left -> generate `pl-*` class on the element.

Inline override selected:
  computed-only padding-left -> write JSX style property.

Tamagui element selected:
  computed-only padding-left -> write Tamagui prop if valid for component.

Unsupported component selected:
  computed-only padding-left -> do not infer arbitrary `padding`/`size`/`color`
  props. If no className/style/css/sx source and no mapper exists, standard
  style inspector is disabled and the recursive props editor is the only write
  surface.
```

Cascade systems must route first:

```text
CSS Modules:
  computed-only background-color -> choose `.card` / `.featured` / another
  class source, then write exact or probable based on resolver confidence.

Plain CSS:
  computed-only border-color -> resolve imported selector target or request
  source tab / AI routing.

vanilla-extract / CSS-in-JS:
  computed-only color -> resolve exported class or styled/css definition before
  writing.
```

## Routing Summary

```text
exact:
  safe candidate for automatic source write under normal policy.

probable:
  show as candidate, but require confirmation, router decision, resolver upgrade,
  or diagnostic fallback before mutation.

computed-only:
  no existing source owner; route as a new write through flat-system priority or
  cascade target resolution.
```

## Diagnostics

Write plans using a non-exact path should record why:

```typescript
diagnostics: [
  {
    level: 'warning',
    message: 'Multiple CSS selectors could own padding-left; writing to selected .card source tab.',
  },
];
```

Diagnostics should distinguish:

```text
probable -> selected by user
probable -> selected by AI/source router
probable -> upgraded to exact by resolver
computed-only -> routed to a new owner in the selected/primary system
computed-only -> fallback to inline override when no safer owner is available
```

## Invariant

The confidence value is an input to write routing, not a styling system identity.
It must not replace `CssSystemId` or `SourceForm`.
