# HYP-1042 — Element-resolution consolidation map (slice 1)

Date: 2026-08-05. Scope: read-only map of every element-resolution variant,
the divergence classes between them, and the consolidation seam. Companion
deliverables: component-zoo fixture corpus (`ext-test-projects/component-zoo/`)
and `shared/canvas-interaction/component-zoo-conformance.test.ts`.

## 1. The moving parts

### 1.1 Read-side (DOM/fiber → source)

| Variant                                           | Module                                                                               | Used by                                                  | Mapper into React-19 `_debugStack` walk?                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `resolveCallSiteTarget` / `resolveCallSiteSource` | `shared/canvas-interaction/resolve-source.ts`                                        | Everything below                                         | Optional 5th arg (`resolveLocation`); mapped-only when provided, raw `parseDebugStack` fallback when absent            |
| `findTraceableParent`                             | `shared/canvas-interaction/find-traceable-parent.ts`                                 | Extension Shift+Enter only (`iframe-interaction.ts:654`) | n/a (DOM walk; keys via `getSourceKey`)                                                                                |
| `resolveDragSource`                               | `shared/canvas-interaction/drag-source-resolver.ts`                                  | Extension drag only (`iframe-drag-handlers.ts`)          | Via injected `getMappedSourceLocation` (provenance-safe: never raw `_debugStack`)                                      |
| `FiberSourceIndex`                                | `shared/element-tracing/fiber-source-index.ts`                                       | Both platforms (source→DOM reverse lookup)               | Per-platform `resolveFiberSource`/`mapSource` options                                                                  |
| Extension click/hover                             | `vscode-extension/.../iframe-resolver.ts` (`createIframeResolver.resolveClickLocal`) | Extension canvas                                         | `mapOrWarmCallSite` — 3-state (hit / definitive-miss / cold+warm), warm side-effects                                   |
| SaaS click/hover                                  | `client/lib/element-tracing/element-tracer.ts` (`ElementTracer.resolveClickLocal`)   | SaaS canvas                                              | `ModuleSourceMapResolver.resolveFiberSource` — mapped-only, pure                                                       |
| `getItemIndexFromFiber`                           | `shared/element-tracing/fiber-internals.ts`                                          | Both platforms                                           | Optional `resolveLocation`; **priority inverted** vs the call-site walk (raw `parseDebugStack` first, mapper fallback) |
| `getAncestorItemIndex`                            | `shared/canvas-interaction/resolve-source.ts:40`                                     | Own-source (editable-leaf) branch                        | **Deliberately mapper-free** (React-19 siblings share one compiled position; raw counting is correct)                  |

### 1.2 Write-side (nodeRef → AST)

| Variant                                               | Module                                    | Semantics                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AstService._resolveElementInCorrectFile` (extension) | `vscode-extension/.../AstService.ts:1278` | Ladder: refIndex hit (cross-file guard) → `NodeMapService.resolveSourceLocation` tolerant ladder (exact → projectRoot-normalized → column=0 → line-only scan → React-19 suffix match) → fingerprint-guarded position-forwarding cache → raw `findElementByPosition` (exact → same-line → ±2 lines). Primary-file miss → one cross-file retry via the file embedded in the nodeRef. |
| `resolveElement` (SaaS server)                        | `server/lib/resolve-element.ts`           | Same `NodeMapService`, **stricter**: `elementLoc` fallback requires EXACT line+col (HYP-593 guard), no tolerant line-only match.                                                                                                                                                                                                                                                   |

NodeRef format: `file:line:col`, 1-based line, **0-based column of the JSX
element's opening `<`** (Babel `JSXElement.loc.start`). All ingress
conversions agree: `_debugSource.columnNumber` −1, V8 `Error.stack` col −1.
`itemIndex` is DOM-side only (selects among `.map()` instances in
`FiberSourceIndex.findDOMElement`); **write-side ignores it** — all instances
share one source range by design.

## 2. What's duplicated

1. **Two platform resolution shells around the same shared primitives.** SaaS
   `ElementTracer.resolveClickLocal` and extension `createIframeResolver.resolveClickLocal`
   implement the same pipeline (leaf seed → HYP-974 unsymbolicated-guard →
   `resolveCallSiteTarget` with mapper → editable/synthetic guards) with
   different cold-race machinery (SaaS `ClickRetryQueue` 3 s vs extension
   boxed `pendingClickElement` TTL 5 s). The shells are NOT shareable as-is:
   the SaaS mapper is pure/sync-from-cache, the extension mapper has warm
   side-effects on chunk caches. The composition seam already exists
   (`ReactAdapterOptions.resolveFiberSource`, `ElementTracer` 3rd arg,
   `TracingResolver` contract).
2. **itemIndex counting lives in two places with inverted mapper priority**:
   `getItemIndexFromFiber` (raw-first, mapper fallback — incl.
   `readComponentCallSite` at `fiber-internals.ts:335`) vs the call-site walk
   in `resolveCallSiteTarget` (mapper-only when provided, raw fallback when
   not). Plus `getAncestorItemIndex` (mapper-free by design). Three counting
   strategies, each individually justified — this is the riskiest
   consolidation candidate and is NOT consolidated in slice 1.
3. **Decorative (aria-hidden) ancestor walk duplicated 3× inside
   `resolveDragSource`** (steps 2a, 2b, 3 each re-implement "skip aria-hidden
   ancestors"). Consolidated in slice 1 → `nearestNonDecorativeAncestor` (see
   §4). Extension's `resolveOpaqueTarget` (SVG→container) is a fourth
   DOM-walk variant with different acceptance (tag-based, not attribute-based).
4. **`getSourceKey` (extension, `iframe-interaction.ts:615`) vs
   `FiberSourceIndex` key derivation (`iframe-resolver.ts:385`)**: both are
   `resolveSourceIndexFiberSource` + `resolveCallSiteSource(..., mapOwnFiberSource)`
   - `file:line:col` template. Same construction, two call sites — but both
     already compose the SAME shared primitives; the duplication is two lines of
     platform composition, not divergent logic. Documented, not consolidated.
5. **Select-parent has TWO implementations, one per platform, neither shared:**
   extension = index-aware `findTraceableParent` (fiber keys);
   SaaS context menu = naive DOM walk on `dataset.uniqId`
   (`CanvasElementContextMenu.tsx:333`, NOT index-aware, NOT fiber-based);
   SaaS Shift+Enter = **dead code** (`useHotkeysSetup.ts:626` gates on
   `nodeMapLookup`, sole caller `CanvasEditor.tsx:551` never passes it).
   Consolidating SaaS onto `findTraceableParent` is a behavior change (SaaS
   keys off uniqId, not fiber sources) — flagged for a follow-up ticket, not
   slice 1.

## 3. Where semantics genuinely differ (divergence classes)

- **D1 — mapped-list itemIndex**: shared call site → one nodeRef; itemIndex
  disambiguates DOM instances only. Nested `.map()`: index counts within the
  INNER sibling group; the outer index is unrecoverable from host-sibling
  counting (documented ambiguity, pinned by corpus test).
- **D2 — call-site walk-up**: only fires when the own source is NOT editable
  (node_modules primitive internals). Editable own source always wins,
  depth-independent (HYP-1006). Workspace-package realpaths (no
  `node_modules` segment) are editable; preserved-symlink paths are not →
  call-site collapse. Both expectations are in the zoo.
- **D3 — React-19 `_debugStack`**: raw frames are COMPILED positions
  (Vite/jsxDEV module, possibly past the on-disk EOF). Commit rules:
  click leaf seed → suppress + warm-retry (HYP-974); call-site ancestor →
  mapped-only, skip unmappable (HYP-970); index keys → folded (mapped ?? own
  compiled) because the index needs a stable per-element key (SaaS
  `forSourceIndex`); drag decorative → provenance-safe resolver, fail-safe
  null (HYP-49).
- **D4 — dedup asymmetry**: `FiberSourceIndex.shouldSkipNestedMappedSource`
  keeps the OUTERMOST host per mapped source; per-element `getSourceKey` has
  no dedup. `findTraceableParent` exists precisely to bridge this
  (index-aware walk: only accept an ancestor whose key resolves back to
  itself).
- **D5 — cold/warm race**: SaaS queues one retry gated on
  `isFiberSourceWarming`; extension defers via pending-click + TTL. Both fail
  closed (no commit) on genuine unmappability — the typed-failure contract the
  corpus asserts.
- **D6 — write-side tolerance**: extension `AstService` tolerates line drift
  (±2, line-only scans); SaaS server resolver requires exact match (HYP-593).
  Same nodeRef can resolve on one platform and miss on the other.

## 4. Consolidation verdict (slice 1)

**Clean (done in this slice):**

- `nearestNonDecorativeAncestor(el)` extracted in
  `shared/canvas-interaction/drag-source-resolver.ts` — the three identical
  aria-hidden skip loops become one helper. Pure dedup, zero behavior change;
  equivalence proven by the corpus conformance tests (decorative drag cases)
  plus the pre-existing `drag-source-resolver.test.ts` suite.

**Not clean (mapped, deliberately untouched):**

- Merging the SaaS/extension `resolveClickLocal` shells — the mappers have
  different side-effect contracts; a shared shell would need a
  cold-race abstraction neither platform's tests pin today. Candidate for
  slice 2 behind the existing `TracingResolver` contract.
- Unifying the three itemIndex counters — inverted mapper priorities are
  individually load-bearing (see comments at `resolve-source.ts:33` and
  `fiber-internals.ts:335`); needs corpus coverage of every counter first.
- SaaS select-parent → `findTraceableParent` — behavior change on a platform
  whose parent navigation is currently uniqId-based (and whose Shift+Enter is
  unwired). Follow-up ticket material.

## 5. Regression net

`ext-test-projects/component-zoo/` — 34 `data-zoo-id` anchors across 8
shapes + real Vite jsxDEV compiled output, with
`fixtures.manifest.json` declaring expected click/select-parent/drag-source/
style-write behavior per anchor (machine-verified positions via
`verify-manifest.mts`).

`shared/canvas-interaction/component-zoo-conformance.test.ts` — unit-level
mirror: mock fiber/DOM trees in each zoo shape (React 18 `_debugSource` and
React 19 `_debugStack` variants) run through `resolveCallSiteTarget`,
`findTraceableParent`, `resolveDragSource`, and `FiberSourceIndex`. Ambiguous
cases assert typed failures (null / fail-safe), never a silent guess.
