> **⚠️ SUPERSEDED** by the [2026-06-12 Styles System Master Spec](./2026-06-12-styles-system-master-spec.md) (see Part/§ 7.2, 11). Retained for history; do not follow for new work.

# #270 D2 — multi-select source-tab routing & write-target semantics (build-ready)

**Ticket:** HYP-581 (impl) / HYP-271 (PR #270) / HYP-535 (transport gate).
**Decided design:** "Auto intent chip + intersection-only homogeneous override + per-element
edit-in-place." Source decision in `/tmp/d2d3-decisions.md` (D2 section); pressure-test consensus
(named-fixes D2.SRE1-7 + codex top-10) in `/tmp/d2d3-review.md` Final-synthesis.
**Depends on / reads with:** `docs/specs/2026-06-04-hyp535-270-read-write-transport-findings.md`
(the transport reality this design writes through — read it first). D1 (Mixed placeholder,
write-to-all-N) is decided separately and is orthogonal; this doc composes with it, does not own it.
**Status:** design, build-ready. Building is a separate TDD-first task. Paths are relative to repo root.

---

## 0. TL;DR

Under N>1 selection, the source-tab row collapses to a single **Auto** intent chip (default), PLUS
— only when every selected element shares exactly one concrete CSS system and none differs — a single
concrete **override** chip ("Tailwind" / "Props" / "CSS Module (`<basename>.module.css`)"). A
heterogeneous selection shows **no tab row at all**. Writing is **per-element edit-in-place**: Auto
carries `selectedSourceTabId = undefined` per element, each element routes against its own AST node
(existing `getElementCssSystems` / `resolveRequestCssSystem` per-element fallback — already live).

The pressure-test added the load-bearing guardrails this doc treats as **hard requirements**, not
nice-to-haves: a **priority cascade that ALWAYS writes** (CTO 2026-06-11 — see §1/§2/§4.4; the cascade
supersedes the earlier "skip unresolvable into a banner" model), a **frozen `BatchStyleWritePlan`**
applied verbatim, a **stale guard** (`STALE_PLAN`), **same-source dedupe**, intersection at
**`cssSystem + property + condition`** (not tab-label), **partial results first-class**
(`applied | skipped | failed` per element), and **scoped file-snapshot undo**.

> **CTO REDESIGN — cascade-with-guaranteed-write, NOT skip (2026-06-11).** The earlier D2 model
> ("unknown / inexpressible → skip into the D3 banner, never inline") is **rejected and replaced**.
> The correct model is a **priority cascade that always writes**; inline is a legitimate last rung,
> not dirt. Unknown is not a skip (cascade element → project priority → prompt → inline).
> Inexpressible is not a skip (**per-property** fallback down the priority order → ultimately inline;
> TW v4 arbitrary values like `shadow-[…]` make even that uncommon). The only remaining skip is
> **STALE/safety** (source changed between read and write). Transparency replaces silence: a property
> that lands lower carries a small "where it landed" badge ("shadow → inline (outside TW scale)"). The
> hazard was never inline — it was _silent_ inline over a class (two sources of truth that drift on
> the next edit). §1/§2/§4.4 below are written to the cascade model; anything in older revisions that
> says "skip" for unknown/inexpressible is stale.

---

## 1. What is v1 vs deferred (read this before estimating)

**v1 (ships in #270):**

- The N>1 source-tab row: Auto chip + intersection-only concrete override; heterogeneous → no row.
- Per-element edit-in-place write routing via per-element `selectedSourceTabId = undefined` (§4).
- The frozen `BatchStyleWritePlan` contract (§5) and its application by the host (§6).
- **Priority cascade that ALWAYS writes (CTO 2026-06-11, §4.4).** Unknown is never a skip — the write
  cascades `element-own system → project priority system → (no project system → prompt the user) →
inline`. Inexpressible is never an element-level skip — it falls **per-property** down the priority
  order to inline (only that property, the rest stay in the system; prefer TW v4 arbitrary values
  first). inline is a legitimate last rung. The cascade resolver is `resolveWriteCascade`
  (`style-write-request-context.ts`) and the per-property inexpressible split lives in
  `executeStyleWriteRequest` (`style-write-executor.ts`).
- **"Where it landed" transparency badge (§4.4).** When a property lands on a lower-priority system or
  inline, the host returns `landedOn` per applied element and the inspector renders a small badge
  ("shadow → inline (outside the system's scale)"). Visibility, not prohibition — the silent-inline
  hazard is removed without forbidding inline.
- Stale guard (`STALE_PLAN`), same-source dedupe, intersection at `cssSystem+property+condition` (§5).
- Partial results (`applied | skipped | failed` per element/property) returned authoritatively (§6.2).
- Scoped file-snapshot undo: one undo step, one `FileEdit` per **unique mutated** file (§6.3).
- The UIKit-derived surfaceless-floor change to `resolveRequestCssSystem` (§4.3), now the
  `project-default` rung of the cascade.

**Deferred (NOT in #270 v1 — explicit follow-up tickets):**

- **Audit log** for every batch write (D2.SRE7) — who/where, request id, applied/skipped/failed counts,
  files touched, routing mode, reasons. v1 returns the per-element results to the UI; persisting an
  audit trail is its own ticket.
- **Blast-radius UI** — "selected N, source affects M" when a selected DOM instance maps to a repeated
  source template / shared selector / component definition (codex idea #5). v1 ships same-source
  **dedupe** (collapse to one mutation, §5.4) which is the correctness floor; surfacing the affected-vs-
  selected count as UI is deferred.
- **Observability counters** (batch attempts, skips-by-reason, stale aborts, etc.) — D2 has no SRE
  counter item of its own; the D3 doc owns D3.SRE6. Out of v1.
- **AI-configured Auto routing branch** and an explicit **per-project priority-styling-system config** —
  the Auto chip is forward-compatible (a later iteration inserts "AI-chosen target before the UIKit
  floor" with zero row-UI rework). v1 uses a deterministic UIKit-derived floor only.
- **Auto-chip resolution-preview popover** ("Tailwind ×4 · card.module.css ×2" before write). The data
  is cheap (it falls out of the N reads + the frozen plan) and the codex synthesis wants it, but it is
  a UI affordance on top of the plan, not the correctness contract. **Recommended fast-follow, not a
  v1 blocker.** The plan itself (§5) is the v1 requirement; rendering a preview of it is the follow-up.

---

## 2. The one open product call

**CONCRETE-OVERRIDE CHIP under a homogeneous selection — keep it `[Auto, <System>]`, or always hide
the tab row under all multi-select?**

- **Default chosen here: KEEP it.** Auto + one provably-safe override (intersection-only). A row of
  5 identical Tailwind divs is the common case and the user legitimately may want a confirmable target.
- If the CTO prefers the multi-select row be uniformly absent for visual simplicity, **drop the override
  chip** — this collapses to "Auto-only → no row" for all N>1. It is a one-line change in the row-derive
  memo (§3) and **touches no write semantics**. This is the only genuine UX taste call.

Everything else is decided and needs no CTO input: no coverage badges, edit-in-place via per-element
undefined, intersection-only concrete chips, hide-row-when-Auto-only, the priority cascade (§4.4), and
all of the §5 guardrails.

> Note (not an open call, resolved): the original D2 residual "surfaceless-floor default" question is
> answered — v1 uses the deterministic UIKit-derived default as the `project-default` rung of the
> cascade (§4.3/§4.4). When the project has NO styling system at all (no UIKit default, no detected
> system), the cascade resolver flags `needsProjectSystemPrompt` so the client can offer "set up
> Tailwind?"; declined → inline. A richer AI/priority-config is the deferred layer above. Do not
> reopen it in v1.

---

## 3. Source-tab row (UI) under N>1

**N=1: byte-identical to today.** `resolveInspectorStyleSourceTabs` + `visibleSourceTabs`
(`RightSidebar.tsx:168-171`) + the single-system auto-select effect (`:179-190`) run as today. The
single-select auto-select effect MUST be gated to `selectedIds.length === 1` so it cannot fire under
multi-select. Add a regression test that N=1 routing is byte-identical (load-bearing path).

**N>1:** build the internal per-element tab union, then derive a DISPLAY row:

1. Always render exactly one chip `{ id: 'auto', label: 'Auto', isDefault: true }`, default-selected.
   `'auto'` is a net-new id; treat it like `'computed'` for write purposes (§4).
2. Compute `sharedConcreteSystem` = the single `CssSystemId` such that EVERY selected element's tab set
   contains it AND no element has any DIFFERENT concrete (non-computed) system. Match on **value-bearing
   identity, not raw tab id** (findings §6.3 — avoids the D5 css-modules `classKey`-only collision):
   `cssClass` for tailwind, `classKey + filePath` for css-modules, `cssSystem` for inline/props. If it
   exists, render a SECOND chip: "Tailwind" / "Props" / "CSS Module (`<basename>.module.css`)".
3. If elements span >1 concrete system → render ONLY the Auto chip. Do NOT render any per-system chip
   and do NOT render coverage badges. (D2-b union+badges is rejected — it forces bespoke foreign-tab
   routing, the exact wrong-write surface this design refuses to expose.)
4. **HIDE-ROW RULE:** extend the existing `visibleSourceTabs` memo (`:168-171`): under N>1, if the only
   chip is Auto (no `sharedConcreteSystem`), feed `[]` to `StyleSourceTabsSection` (it already returns
   null on empty, `:20-22`). Net: heterogeneous multi-select shows NO tab row; homogeneous shows
   "Auto" + the one override.
5. `StyleSourceTabsSection.tsx`: NO new coverage/mixed field on `StyleSourceTab`, NO badge UI. The only
   change it may need is rendering the `'auto'` chip label; everything else is the existing flat render.

**Cross-file override availability (D4 × D5 named-fix):** intersection for the concrete override is at
`cssSystem` granularity, NOT the full D5 file-discriminated id. If every selected element is writable
via css-modules through **its own** module file, offer one "CSS Modules" override. Do NOT make the
override silently vanish in the cross-file case D4 promises in v1. (If product later prefers the honest
"cross-file → Auto only" message instead, that is a label change, not a routing change — but the default
is: offer the system-level override.)

REQUIREMENT — the cross-file CSS Modules override needs a **system-level override id**, NOT a single
`css-modules:<classKey>` id carried to all N. Today `getRequestRoutableCssSystem` strips the
`css-modules:` prefix and matches the suffix against `reference.classKey`
(`style-write-request-context.ts:119-125`), so one shared `css-modules:<classKey>` id sent to elements
in different module files (or with different class keys) would miss the other owners or point at the
wrong one. The chip therefore carries a **system-level intent** — a non-class-specific `css-modules`
override (e.g. `selectedSourceTabId = 'css-modules'` with no class suffix, treated as "route this
property to each element's OWN css-modules owner") — and each element resolves to ITS OWN module file +
class via its per-element `elementRef`, exactly like Auto but pinned to the css-modules system. The plan
entry's per-element `route` (§5.1) holds the resolved file-qualified owner; the chip id never encodes one
element's class key as a shared target. (Tailwind/inline/props overrides do not hit this — their
routable id is system-only already.)

---

## 4. Write semantics (the load-bearing part)

The write goes through the new `ast:updateStylesBatch` handler (findings §6 steps 5-7). The webview
sends N entries, each carrying its OWN `{ elementId, filePath, elementRef, selectedSourceTabId }`.
Per-element `filePath` is REQUIRED (D4 cross-file = v1; `useStyleSync` today sends `selectedIds[0]` +
one `filePath` — that plumbing is a D4 cost the batch handler needs regardless).

### 4.1 Auto selected (default / heterogeneous)

Carry `selectedSourceTabId = undefined` for every element. Each element independently hits
`resolveRequestCssSystem` (`lib/style-write/style-write-request-context.ts:108-117`). Because
`getRequestRoutableCssSystem(undefined) → undefined`, it falls to the per-element fallback.
`getElementCssSystems` (`style-write-executor.ts:542-586`) derives that element's system FROM ITS OWN
AST NODE: existing `className → tailwind-v4`, css-module class → `css-modules`, inline style attr →
`inline-style`, Tamagui-style prop → `tamagui`, none → floor (§4.3). This IS edit-in-place and runs
today — no new routing code. A 3-Tailwind + 2-inline selection writes Tailwind classes to the 3 and
inline style to the 2, in ONE undo step. Satisfies "edit in place if the style exists" and "do not
coerce to one system" structurally.

Ordering note (documented, acceptable): an element with BOTH a `className` AND an inline style resolves
to `tailwind-v4` first under Auto (edit-in-place prefers the class). No override is offered to change
this under multi-select unless the WHOLE selection is homogeneous.

### 4.2 Concrete override selected (homogeneous only)

Carry the shared tab id (e.g. `'tailwind-v4:elementClass'`) for ALL N. `getRequestRoutableCssSystem`
resolves it identically per element; no throw, no no-op, because the chip was only offered under full
intersection. For the css-modules override the file-qualified id must round-trip through
`createCssModuleSourceOwnersFromReferences` (`request-context.ts:119-125`) — only offer this override
when all elements reference writable css-modules (system-level intersection per §3).

### 4.3 The priority-cascade floor — `resolveWriteCascade` (CTO 2026-06-11)

The Auto/computed write target is resolved by `resolveWriteCascade`
(`lib/style-write/style-write-request-context.ts`), which `resolveRequestCssSystem` now delegates to.
It ALWAYS returns a system — the cascade never refuses to write — plus the rung it landed on and an
`isFallback` flag (drives the badge). Priority order:

1. `element` — the element's own system (`elementCssSystems[0]`). Edit-in-place. `isFallback: false`.
2. `project-default` — the UIKit-derived `projectDefaultCssSystem`, threaded from the client
   (`inspectorUIKit`: tailwind → `tailwind-v4`, tamagui → `tamagui`, else undefined). The surfaceless
   element floors here. `isFallback: true`.
3. `project-system` — a detected (non-UIKit) project system (`projectCssSystems[0]`). `isFallback: true`.
4. `inline` — the universal last rung. When NOTHING above applies the project genuinely has no styling
   system: the resolver returns `inline-style` AND flags `needsProjectSystemPrompt` so the client can
   offer "set up Tailwind?" before accepting it; declined → inline. Never a skip.

This is one resolver, not a config system. The earlier "surfaceless → silent inline" is now the
explicit `project-default`/`inline` rungs with `isFallback`/`needsProjectSystemPrompt` surfaced.

### 4.4 PRIORITY CASCADE — ALWAYS WRITE, NEVER SKIP FOR UNKNOWN/INEXPRESSIBLE (CTO 2026-06-11)

**This supersedes the earlier "no silent inline fallback → skip into the banner" model.** That model
was wrong: an empty/surfaceless element is NOT "nowhere to write" — the project has a priority styling
system, and inline is a legitimate last rung. The cascade ALWAYS lands a value. The real hazard was
never inline itself — it was **silent** inline over a class (two sources of truth that drift on the
next edit). We remove the silence (a transparency badge), not the inline.

- **UNKNOWN (element has no detected system) is NOT a skip.** The write cascades via §4.3:
  `element-own → project-default → project-system → (no system at all → prompt "set up Tailwind?" →
declined →) inline`. Guaranteed write.
- **INEXPRESSIBLE (a property not representable in the element's system) is NOT an element-level skip.**
  It is a **PER-PROPERTY** fallback: only the inexpressible property falls down the priority order to
  inline; every expressible property stays in the element's system. Implemented in
  `executeStyleWriteRequest` (`style-write-executor.ts`) via `splitInexpressibleProperties` — for
  Tailwind, a property the generator can't emit any class for (even an arbitrary value) is split out and
  written inline on the same element; the rest are written as classes. **TW v4 arbitrary values
  (`shadow-[…]`, `text-[#…]`) make this rare — prefer arbitrary-value expression before falling lower.**
- **TRANSPARENCY, not silence.** When a property lands on a lower-priority system or inline, the host
  returns `landedOn: [{ property, system, reason }]` on the applied element (§6.2), and the inspector
  renders a small badge ("shadow → inline (outside the system's scale)"), via `describeLandedSystem` /
  `describeLandedReason`. The element is **applied**, not skipped.

**SKIP narrows to STALE/safety ONLY.** The only remaining skip is when the source changed between the
inspector read and the write flush so the writer can't safely target the node (a different node could be
corrupted). That is a safety concern, not a "where to write" concern. The canonical code is
`STALE_SOURCE` (internal plan-guard state `STALE_PLAN`, mapped at the result boundary, §5.3). The route
emits it when a nodeRef no longer resolves (`updateComponentStylesBatch.ts`).

> Retained `SkipReasonCode` values (`NO_WRITABLE_TARGET`, `OWNER_MASKED`, `EXPRESSION_BACKED_SOURCE`,
> `DS_ADAPTER_UNMAPPED_PROPERTY`, …) stay in the canonical enum (D3 §5.3) for the D3 stylability ladder
> and deferred follow-ups, but D2's Auto write path no longer EMITS them for unknown/inexpressible —
> those cascade and write. `NO_WRITABLE_TARGET` is now only a genuinely-terminal structural blocker
> (e.g. an explicit pinned tab the project can't honor), which under Auto effectively never happens.

---

## 5. The frozen `BatchStyleWritePlan` (D2.SRE1-6 / codex #1-6) — REQUIREMENT

No planless batch writes. Every batch edit gesture produces ONE frozen, inspectable plan; the host
applies **exactly** that plan and nothing else.

### 5.1 Shape (per-gesture, immutable once frozen)

```
BatchStyleWritePlan {
  requestId: string                 // operation id, unique per gesture
  sequence: number                  // monotonic; later plan supersedes earlier (slider ticks)
  selectionRevision: number         // from the selection store at read time
  sourceSnapshot: Map<filePath, snapshotId>  // per-file content/version captured at read time
  condition: ActiveCondition        // single global condition applied uniformly (findings §5)
  routingMode: 'auto' | 'override'
  entries: BatchStyleWriteEntry[]
}
BatchStyleWriteEntry {
  elementId: string
  filePath: string                  // per-element (D4 cross-file v1)
  elementRef: NodeRef               // per-element source node
  property: string
  oldValue: string | MIXED
  newValue: string
  route: {
    cssSystem: CssSystemId
    sourceOwnerKind
    channel: 'styles' | 'props'     // D3 ladder rung → write channel: L1 ⇒ 'styles', L0/L2 ⇒ 'props'
  } | null                          // null ⇒ skip
  status: 'planned' | 'skipped'     // pre-write; skipped carries skipReason
  skipReason?: SkipReasonCode       // canonical enum, D3 doc §5.3
}
// 'auto' is carried explicitly per entry for inspectability; the executor guard accepts it (D2 §8).
// The css-modules system-level override (§3) sets route per element from its own elementRef, not a
// shared class-keyed id.
// route.channel dispatches each entry inside the batch handler: 'styles' ⇒ updateStyles path,
// 'props' ⇒ updateProps path (D3 §6). One plan may mix channels; all accumulate into one undo step.
```

### 5.2 Freeze per gesture (codex #3 / pragmatic R3)

Slider drags and debounced inputs MUST NOT re-route between ticks. Resolve the route ONCE at the start
of the gesture, then keep writing the SAME owner until the gesture ends or the plan goes stale. A new
owner created by the first write of a gesture must not flip the route for subsequent ticks of the same
gesture.

### 5.3 Stale guard → `STALE_PLAN` (D2.SRE2 / codex #3)

Before flush, the host compares the plan's `selectionRevision` + `sourceSnapshot` against current state.
If selection, source map, preview build, or a touched file's snapshot changed between inspector read and
write flush, that entry (or the whole plan if interdependent) is **aborted with the internal guard state
`STALE_PLAN`**, not re-routed. No best-effort writes from stale inspector state; the user agreed to a
resolution that no longer holds, so it degrades into the banner, never silently re-resolves. The
host-emitted / banner-rendered reason CODE is the canonical `STALE_SOURCE` (D3 §5.3); map
`STALE_PLAN → STALE_SOURCE` at the result boundary.

### 5.4 Same-source dedupe (D2.SRE3 / codex #5) — REQUIREMENT

Multiple selected RENDERED instances that resolve to the SAME JSX source node (e.g. two renders of one
`items.map(...)` element, two instances of one component definition) MUST collapse to ONE mutation in
the plan. Without dedupe the same class/style is double-applied (or appended twice). Dedupe key =
`(filePath, elementRef)`. The selected-rendered count and the source-mutation count differ here; v1
collapses correctly (the affected-vs-selected **UI** surfacing is the deferred blast-radius item, §1).

### 5.5 Concrete override must prove coverage (D2.SRE4 / codex #4)

The intersection that gates the override chip (§3) is computed at `cssSystem + property + condition +
writable capability`, NOT same tab-label. An override is offered only if EVERY selected element has a
writable owner for that property in that source under the active condition. Same label is not enough.

---

## 6. Host application + results + undo

### 6.1 Atomic handler

New host handler `ast:updateStylesBatch` modeled on `_handleMoveElement` (`AstBridge.ts:526-584`): ONE
`beginTracking()/try/finally endTracking()`, loop calling `astService.updateStyles(...)` DIRECTLY
(bypassing `_withUndoTracking`), applying ONLY the frozen plan's `planned` entries. `updateStyles`
re-resolves the element and refreshes the NodeMap per mutated file on every call (findings §3), so
sequential looping does not corrupt later elements' offsets.

### 6.2 Partial results are first-class (D2.SRE5 / codex #6) — REQUIREMENT

The host returns an AUTHORITATIVE per-element/per-property result array — `applied | skipped | failed |
applied_but_ineffective` — with reason codes. The UI MUST NOT infer success from "request returned 200".
`applied_but_ineffective` covers the masked-owner case where the write landed in source but is proven
not to change the rendered value (§4.4 `OWNER_MASKED`). Skipped/failed entries carry their reason code.
An **applied** entry additionally carries `landedOn: [{ property, system, reason }]` (CTO 2026-06-11)
when the priority cascade put one or more properties on a lower-priority system than the element's
primary one (§4.4) — this drives the "where it landed" badge. Under the cascade, the dominant outcome
is `applied` (often with `landedOn`); `skipped`/`failed` narrow to STALE/safety.

### 6.3 Scoped file-snapshot undo (D2.SRE6 / codex #6) — REQUIREMENT

One undo batch via the existing `recordBatchEdit` primitive (`UndoRedoService.ts:67`), with **exactly
one `FileEdit` per UNIQUE mutated file** and snapshots only for files actually changed:

- Capture `contentBefore` per unique file BEFORE its FIRST mutation.
- Read `contentAfter` per unique file AFTER the LAST mutation.
- Failed/skipped elements contribute no `FileEdit`.

This avoids the same-file dedup trap (findings §4.3 — naive per-element before/after pushes N
overlapping `FileEdit`s for one path → last-write-wins, reverting only element N). On partial failure:
do NOT abort; record successful edits as the one `recordBatchEdit`; return per-element results (§6.2).

---

## 7. Composition with D1 (Mixed) — orthogonal

Independent axes (findings §2). D1 inputs render `placeholder="Mixed"` on differing properties (via
`effectiveParsed`/`usePopulateStyleState`); section selects get a `'mixed'` `<option>`. Typing/selecting
enqueues ONE `{ prop: value }` in `useStyleSync`'s queue exactly as single-select; flush builds the
frozen plan (§5) and fans the SAME value to all N, each routed by §4. The user sees Mixed hints, types
once, routing is automatic (Auto) or one safe override. Auto's edit-in-place reads the SAME per-element
`ParsedStyles` ownership the Mixed sentinel is computed from — shared data direction, no shared state,
no ordering hazard. `MIXED` lives on the value path and is only produced for N>1, so N=1 stays
byte-identical.

---

## 8. Files touched (v1)

- `client/components/RightSidebar/source-tabs.ts`: add `mergeForMultiSelect(perElementTabs)` — derive
  Auto + optional intersection-only concrete chip with value-bearing-identity dedup.
- `RightSidebar.tsx`: gate single-select auto-select effect (`:179-190`) to `length === 1`; feed the
  derived display row to `visibleSourceTabs` with the Auto-only → hide rule; default
  `selectedSourceTabId = 'auto'` for N>1; thread `projectDefaultCssSystem` (from `inspectorUIKit`
  `:86-87`) into the batch RPC.
- `StyleSourceTabsSection.tsx`: render the `'auto'` chip label; NO badge/coverage field.
- `lib/style-write/style-write-request-context.ts`: treat `'auto'` identically to `'computed'` in
  `getRequestRoutableCssSystem`/`resolveRequestCssSystem`; the surfaceless floor is the priority cascade
  `resolveWriteCascade` (element → project-default → project-system → inline + `needsProjectSystemPrompt`),
  exported for testing and badge data (CTO 2026-06-11, §4.3/§4.4). Edit-in-place untouched.
- `lib/style-write/style-write-executor.ts`: the pre-context guard in `executeStyleWriteRequest` rejects
  any non-routable `selectedSourceTabId` EXCEPT `'computed'` BEFORE the request-context resolution runs.
  `'auto'` MUST be accepted there too (add it to the allowed-non-routable set alongside `'computed'`, OR
  map `'auto' → undefined` on the client before the RPC so it never reaches the guard). Without this,
  Auto batch writes throw at the executor guard before the new floor/fallback logic in §4.3 ever runs.
  Pick one (recommended: accept `'auto'` at the guard, symmetric with `'computed'`, so the plan can
  carry an explicit `'auto'` route for inspectability) and apply it consistently.
- `client/lib/platform/types.ts` + `vscode-extension/hypercanvas-preview/src/.../types.ts`: add the
  `ast:updateStylesBatch` message + response to the platform `AstMessage`/transport unions, and add an
  `astOps.updateStylesBatch` method to the `AstOperations` adapter interface (and both adapter impls).
  Without the message-union + adapter-method additions, the shared inspector can build a `BatchStyleWritePlan`
  but VS Code/Platform message routing will reject/never-dispatch the new type (the project's known
  message-union pitfall). The handler case lives in `AstBridge.handleMessage` (`:94-130`).
- `lib/style-write/style-write-executor.ts`: the per-property inexpressible cascade —
  `splitInexpressibleProperties` (Tailwind: a property the generator emits no class for falls out) +
  `applyInlineFallbackWrite` (land the inexpressible props inline on the same element), returning
  `landedOn` on the success result (CTO 2026-06-11, §4.4). Only under Auto/computed; an explicit pinned
  unsupported tab still errors.
- `lib/style-write/types.ts`: `StyleWriteResult` success branch carries `landedOn?: StyleLandedFallback[]`.
- `lib/style-write/skip-reason-codes.ts`: `describeLandedSystem` / `describeLandedReason` badge labels.
- `server/routes/updateComponentStylesBatch.ts` + `client/lib/canvas-engine/services/ASTApiService.ts`:
  thread `landedOn` from the executor result through to the per-element batch result.
- `useStyleSync.ts` + `RightSidebar.tsx`: `onBatchResults` carries `landedOn`; the inspector dedupes
  and renders the "where it landed" badge (`inspector-style-landed-badge`).
- `useStyleSync.ts` + the `ast:updateStylesBatch` handler (needed by #270 anyway): build/freeze the
  `BatchStyleWritePlan`, gesture-freeze the route, stale-guard, same-source dedupe, per-element
  `filePath` + `selectedSourceTabId` (undefined/`'auto'` for Auto), return per-element results.
- NO changes to section value components beyond D1's own work.

---

## 9. Edge cases (decided — do not re-decide)

- **0 shared / fully disjoint systems** (A all-Tailwind, B css-modules+inline): Auto-only row → hidden.
  Editing alive; each element writes its own system. Never a dead-end.
- **All-same-system** (all Tailwind): row = `[Auto, Tailwind]`; Auto and Tailwind behave identically
  here; default Auto; user may pin Tailwind. No behavioral difference, just an affordance.
- **Cross-file (D4=v1):** per-element `filePath`/`elementRef` in the batch payload; host
  `recordBatchEdit` loop spans files with one `FileEdit` per UNIQUE file (§6.3). Auto resolves each
  element against its own file's AST.
- **Surfaceless DS element in selection:** Auto floor → project default (UIKit-derived). STOPGAP that
  D3's wrapper escalation will later override for those elements (D3 L3 is opt-in, single-element — see
  the D3 doc). Do NOT block this on D3.
- **Element with both className and inline under Auto:** resolves to `tailwind-v4` first (edit-in-place
  prefers the class). Documented and acceptable.
- **Partial write failure:** do not abort; record successful edits in the one `recordBatchEdit`; return
  per-element results (§6.2). Offsets stay safe via per-call re-resolve (findings §3).
- **N=1:** byte-identical to today, no Auto chip, full row + explicit routing.

---

## 10. Why the rejected shapes stay rejected

- **D2-b (union of all tabs + per-tab coverage badges "2/3"):** REJECTED. A selectable partial-coverage
  chip forces bespoke "non-owning element" routing (forward a foreign tab id to an element that doesn't
  own it → no-op or relies on perfect throw-avoidance) — exactly where a wrong write to the wrong
  system/element creeps in. Also needs a net-new coverage field on `StyleSourceTab` and badge-clutter.
  The union is kept INTERNALLY to compute the intersection; partial chips are never exposed.
- **D2-a (always hide the row):** KEPT only as the fallback shape behind the §2 product call. It removes
  the safe homogeneous override and gives the surfaceless floor as silent inline with no UIKit
  awareness. The Auto+intersection synthesis is a marginal cost on top and is meaningfully more
  predictable.
- **AI-configured Auto routing / first-detected-system-as-priority:** REJECTED for v1. AI-config makes
  the write target depend on a workspace setting changed for an unrelated reason (one gesture → different
  diffs for two people on one repo). Detection order is not a stable priority. v1 uses a deterministic
  UIKit-derived floor; AI/priority-config is the deferred layer behind the same Auto chip with zero
  row-UI rework.
