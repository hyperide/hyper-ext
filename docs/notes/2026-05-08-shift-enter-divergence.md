# Shift+Enter selection-rect regression — divergence analysis (Task 2)

Plan: `docs/plans/2026-05-08-shift-enter-rect-ralphex-plan.md`
RED spec: `ext-test-projects/e2e/tests/project-dependent/bulka-shift-enter-rect-survives.spec.ts`

## Symptom recap

User on bulka, hero portrait `<GalleryImage src={images.ps_portrait} … />`:

1. Click the inner `<img>` rendered by GalleryImage → selection rect appears on
   the GalleryImage callsite (the `<button data-gallery-image>`).
2. Press **Shift+Enter** (parent walk in this codebase — not "step into child";
   plan title is misleading). Inspector right-pane updates to the new element
   ("div"), but the **canvas selection rectangle vanishes** instead of moving
   onto the new element.

`b94077019 / e514c6f1 / f33e5ff0 / 355321c5 / 06913a91 / 20fe6ed6` already
chased adjacent symptoms: each fixed one direction (inspector keeps state;
rect anchor follows tree-driven selection; cross-format path matching). The
rect path keeps drifting back out of sync.

## Architecture map (extension preview)

```
                              ┌──────────────────────────────────────┐
        Shift+Enter           │ vscode-extension/.../iframe-          │
        keystroke ─────────►  │ interaction.ts (IIFE in preview      │
        (in iframe)           │ iframe, NOT shared/canvas-interaction │
                              │ as the plan claims)                   │
                              └──────────────────────────────────────┘
                                     │
                                     ▼
shared/canvas-interaction/keyboard-handler.ts::createDesignKeydownHandler
   • Shift+Enter case (line 178)  → findParentNodeRef(selectedId, lookup)
                                     │
                                     ▼
domNodeMapLookup.getEntry(selectedId)   (iframe-interaction.ts:1130)
   1. el = findElementsByRef(selectedId, 0)[0]      ← rect-overlay path too!
   2. parent = findTraceableParent(el)              ← walks DOM ancestors
   3. parentRef = getSourceKey(ancestor)            ← key derivation
   return entry.parentRef                            (string | null)
                                     │
                                     ▼
callbacks.onSelectElement(parentRef)
   → window.parent.postMessage({type:'hypercanvas:elementClick',
                                elementId: parentRef, itemIndex: null})
                                     │
                                     ▼
useCanvasInteraction.ts:197  hypercanvas:elementClick handler
   patch.selectedIds = [elementId];   patch.selectedItemIndices = {}
   patch.selectedElementRuntimeStyle = null  ← no computedStyle delivered
   ↑ Inspector right-pane reads selectedIds + selectedElementRuntimeStyle.
     The element TYPE ("div") is decoded from the `file:line:col` ref alone
     — no DOM lookup needed → inspector keeps working even when the rect
     vanishes.
                                     │
                                     ▼
state.selectedIds = [parentRef]      (synced back to iframe)
                                     │
                                     ▼
sendOverlayRects() → computeOverlayRects(state, iframeElementResolver)
                                     │
                                     ▼
iframeElementResolver.findElements(parentRef, null)
   = findElementsByRef(parentRef, null)
                                     │
                                     ▼
FiberSourceIndex.findDOMElements(source)   → MUST find ≥1 HTMLElement
                                              (otherwise rect = nothing)
```

## Two key derivations in play

### 1. `getSourceKey(el)` — used by `findTraceableParent`

`iframe-interaction.ts:1081`
```ts
function getSourceKey(el: HTMLElement): string | null {
  const fiber = getFiberFromDOM(el);
  if (!fiber) return null;
  let loc = resolveSourceIndexFiberSource(fiber);          // ── A
  if (!loc) return null;
  if (renderedComponentPath) {
    loc = resolveCallSiteSource(loc, fiber, renderedComponentPath); // ── B
  }
  return `${loc.fileName}:${loc.line}:${loc.column}`;
}
```

- A: `resolveOwnServerSourceMap(fiber) ?? resolveViaClientSourceMap(fiber) ?? getOwnFiberSourceLocation(fiber)`
- B: walks `fiber.return._debugSource` looking for the first cross-file source
  (ignores `_debugStack` — see "React 19" below).

Result: per-element mappedSource. **No deduplication** — a chain of nested
HostComponent fibers under the same component callsite all return the same
key K from this function.

### 2. `FiberSourceIndex.ensureBuilt` — used by `findElementsByRef`

`shared/element-tracing/fiber-source-index.ts:248`
```ts
walkFibers(rootFiber, (fiber) => {
  const source = this.resolveFiberSource(fiber);            // == A above
  if (source === null) return;
  const mappedSource = this.mapSource(source, fiber);       // == B above
  if (this.shouldSkipNestedMappedSource(fiber, source, mappedSource)) return;
                                    // ↑ DEDUP: skip when an ancestor fiber
                                    //   already maps to the same key.
  const host = findHostFiber(fiber);
  …
  newIndex.set(key, [host.stateNode]);                      // OUTERMOST wins
});
```

### Asymmetry → divergence

`getSourceKey(X)` returns K for **any** DOM ancestor X whose fiber maps to K.
`findElementsByRef(K)` returns **only** the outermost HostComponent stateNode
indexed under K (or `[]` if that outermost host has been unmounted between
state updates).

So `findTraceableParent` may walk DOM and pick an intermediate ancestor whose
mappedSource collides with the GalleryImage callsite K already occupied by
the outermost button host. Three failure modes:

| Mode | Result for rect overlay |
|------|-------------------------|
| (a) Outermost host fiber for K is alive and is a different element than the walk-up landed on | Rect renders on the outermost host (may overlap the wrapper, may scroll out of view → user reads as "rect on something other than the new selection"). Test asserts `dist > 2px` — would catch this only if the rect doesn't move. |
| (b) Outermost host for K has been unmounted (HMR / re-render between Shift+Enter dispatch and rect repaint) | `findDOMElements(K)` returns `[]` → `findElementsByRef` falls through closest-line / closest-source paths; if those also miss → **rect vanishes** (matches user report). |
| (c) `parentRef` is well-formed but FiberSourceIndex was rebuilt with a different `mapSource` outcome (sourcemap async warm-up race — Vite client sourcemap not yet cached when index built, but resolved by the time `getSourceKey` runs) | parentRef contains the source-mapped path; index keys contain the unmapped fallback path. Exact lookup misses; cross-format closest-source fallback may rescue OR may pick a sibling. |

### React 19 wrinkle (cross-ref `project_ext_click_debug.md`)

`resolveCallSiteSource` walks `fiber.return._debugSource`. React 19 sets
`_debugStack`, **not** `_debugSource`, on host fibers — so the walk-up
typically returns `null` and the function falls back to `directSource`. Both
`getSourceKey` and `FiberSourceIndex.mapSource` use the same chain so they
should agree, **but**:

- For the OUTERMOST host fiber of a component (e.g. GalleryImage's button),
  its OWN `_debugStack` carries the JSX site inside GalleryImage.tsx.
  `resolveOwnServerSourceMap` resolves that to the GalleryImage source.
- For an intermediate host fiber (e.g. a `<span>` inside button), its own
  `_debugStack` may resolve to a DIFFERENT GalleryImage line.
- Walking `fiber.return._debugSource` from either fiber is a no-op in React
  19 (the chain is empty), so no callsite lift happens. Both keys collapse
  to GalleryImage.tsx leaf positions, NOT the Index.tsx callsite. The dedup
  in (1) keeps the outermost. The walk-up in (2) returns the leaf for the
  ancestor it landed on. Mismatch.

This is the same bug class `06913a91` aligned for the inspector path; the
rect-overlay path's `getSourceKey` was not updated at the same time.

## Diagnostic instrumentation added (Task 2)

`vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`:

- New tag `[shiftparent]` (filterable in DevTools console alongside the
  existing `[selsurv]` tag).
- `findTraceableParent(el, trace?)` now accepts an optional `trace[]`
  collector — every DOM ancestor walked is pushed with `{tag, ref}`.
- `domNodeMapLookup.getEntry(nodeRef)` now logs a single
  `parent-walk` entry per call:
  ```
  [shiftparent] parent-walk {
    selectedId, renderedComponentPath,
    steps: [{tag, ref}, …],            // every walked ancestor
    parentRef, parentTag,
    parentLookupStatus                  // 'indexed' when parent !== null, else null
                                        // (walk-up's predicate already proved
                                        // findElementsByRef.includes(parent) — no
                                        // need to recall it just for the diagnostic)
  }
  ```
  Plus `getEntry missing-base` when `findElementsByRef(selectedId)` itself
  returns nothing — surfaces the "the rect overlay ALREADY couldn't find the
  base element before Shift+Enter" case (which would explain why parent-walk
  silently no-ops, returns null entry, and the keyboard handler clears
  selection).
- Existing `[selsurv] findElements miss` still logs from the rect path. The
  cross-tag timeline reveals which side first sees the miss.

These logs are gated by neither env nor build flag — they are unconditional
`console.debug` calls already in style with the in-file `[selsurv]` family.
Volume is one log per Shift+Enter / Tab / Enter keystroke (i.e. low),
acceptable for shipped code while we close the regression.

## Likely fix shape (for Task 3, not landed here)

Make the two paths use the same dedup-aware key derivation. Either:

A. **Index-aware `getSourceKey`**: when walking up the DOM, don't return the
   per-element `mappedSource` — instead resolve to `findElementsByRef`-able
   key by querying the FiberSourceIndex directly (give me the indexed key
   for THIS DOM element if any). Walk-up returns the first ancestor that the
   index actually has an entry for.

B. **Don't dedup in FiberSourceIndex**: register every host under its
   mappedSource (multi-value index). Rect picks the first DOM-contained
   element. Risk: explodes the index for `.map()` rows; may break itemIndex
   semantics.

(A) is smaller, scoped to extension iframe, doesn't touch shared
   FiberSourceIndex tests, mirrors the alignment `355321c5 / 06913a91`
   already did for click resolution.

If the *cause* turns out to be the React 19 `_debugStack` gap (Task 3 last
checkbox in the plan), the same fix shape applies: extend `resolveCallSite-
Source` to consult `_debugStack` as a fallback for missing `_debugSource`,
and ensure both `mapSource` and `getSourceKey` use the same chain.

## How to gather the dump (when local debug session is feasible)

In the rendered preview iframe DevTools console:

1. Filter: `[shiftparent]` OR `[selsurv]`
2. Click the GalleryImage hero `<img>`  → `[selsurv] selectedIds change` +
   `[selsurv] overlay paint domElementFound:true`
3. Press Shift+Enter → expect exactly one `[shiftparent] parent-walk` entry,
   immediately followed by `[selsurv] selectedIds change` (the round-trip
   from extension host) and either `overlay paint domElementFound:true` (rect
   visible — bug is mode (a)) or `findElements miss` + `overlay paint
   domElementFound:false` (rect invisible — bug is mode (b)/(c)).
4. Cross-check: take `parentRef` from the parent-walk log and compare against
   the `findElements miss` selectedId from the rect path — they MUST match
   exactly (same string). Any divergence (path format, line/col difference)
   is the smoking gun.

Per CLAUDE.md, full e2e is run only via `HYPER_E2E_SHARDS=1 bun run
test:docker`. The plan's "run locally" instruction conflicts with that hard
rule; documenting the dump procedure here so anyone can reproduce in a live
preview without a Docker round-trip. Task 3 verifies via Docker.
