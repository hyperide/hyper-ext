# #270 D3 — stylability ladder & honest partial-batch skip-banner (build-ready)

**Ticket:** HYP-581 (impl) / HYP-271 (PR #270) / HYP-535 (transport gate).
**Decided design:** "Stylability ladder (L0 DS-native prop → L1 → L2 → L3 opt-in single-element wrapper)
with an honest partial-batch skip-banner." Source decision in `/tmp/d2d3-decisions.md` (D3 section);
pressure-test consensus (named-fixes D3.SRE1-7 + codex top-10) in `/tmp/d2d3-review.md` Final-synthesis.
**Reads with:** `docs/specs/2026-06-04-hyp535-270-read-write-transport-findings.md` (transport reality)
and the D2 doc `2026-06-11-270-d2-source-routing.md` (the banner's "Fix →" CTA routes into D2 per-element
edit-in-place; the frozen `BatchStyleWritePlan` and reason-code enum are shared).
**Status:** design, build-ready. Building is a separate TDD-first task. Paths are relative to repo root.

---

## 0. TL;DR

Resolve write target **per element, per property** down a ladder:
- **L0 DS-NATIVE PROP** — element has adapter-declared `elementPropMappers`; write the property through
  the existing prop-mapper path (`writeMode 'props' → convertToProps → updateProps`,
  `useStyleSync.ts:184-247`). The live Tamagui/RN flow, generalized.
- **L1 STYLE CHANNEL** — element accepts a generic channel
  (`acceptsClassName/acceptsStyle/acceptsCssProp/acceptsSxProp`, `ComponentPropSurfaceFacts`
  `types.ts:443-446`); route through it (`className` / `style=` / `css` / `sx`).
- **L2 PARTIAL PROP** — `styleLikeProps`/`semanticProps` (`types.ts:448-449`) covers THIS property; write
  that one property as a prop. Properties not covered are reported per-property as unwritable.
- **L3 ESCALATE** — no surface for this property. **Do NOT auto-wrap.** Surface an explicit, single-
  element, opt-in, feature-flagged, allowlisted "Wrap to style" action with a blocking preflight, exact
  AST round-trip rollback, and an independent kill switch.

Batch (N>1) runs the ladder per element. L0-L2 elements get the write; **L3 / unresolvable elements are
EXCLUDED pre-write and reported by name + machine reason** into a **post-authoritative skip-banner**.
A value edit can NEVER trigger a tree mutation. **L3 is explicitly DEFERRED out of #270 v1** into its own
guarded follow-up (§7).

---

## 1. What is v1 vs deferred (read this before estimating)

**v1 (ships in #270):**
- Wire `surfaceDecision` into the orchestrator/gate (§2). It is already produced host-side and serialized
  on `StyleReadResult` (`types.ts:536`) with ZERO client consumers today — v1 consumes it.
- The pure ladder resolver L0 / L1 / L2 (§3) + unit tests, including `decideSurface` verdict coverage.
- Partition + value-merge over `writable[]` + tab-union (§4), composed with D1's Mixed placeholder.
- The honest **post-authoritative** skip-banner with **machine reason codes** (§5), disabled-with-reason
  inputs, and the empty state when nothing is writable.
- Batch write over the resolved plan as ONE undo step via `ast:updateStylesBatch` + `recordBatchEdit`
  (§6) — the D2 `BatchStyleWritePlan` contract.
- Banner invalidation on undo / selection change / HMR / re-read / input-value change (§5.4).

**Deferred (NOT in #270 v1 — explicit guarded follow-up tickets):**
- **L3 wrapper escalation entirely** (§7). Single-element, opt-in, feature-flagged, allowlisted, with a
  blocking preflight, exact AST round-trip rollback, wrapper attribution, and an independent kill switch.
  NEVER batch, NEVER banner-triggered. It ships in its own ticket behind its own flag — out of #270 v1.
  (The wrap primitive `wrapElementInAST` / `ast:wrapElement` already exists, so the follow-up reuses it;
  the hard part is the predicate + preflight, not the mutation.)
- **Wrapper attribution / unwrap / lift-back-to-DS** — the stable source marker for HyperIDE-created
  wrappers, plus the future "unwrap" / "lift to DS prop" tooling. Decided in spirit now (§7.4) so it is
  not retrofitted, but it lands with L3, not in #270 v1.
- **Observability counters** (D3.SRE6) — batch attempts, skips by reason, failures by adapter, files
  touched, undo failures, stale-write aborts, L3 wrapper aborts. The single biggest long-term product
  signal of the ladder (which DS properties lack L0 mappings), but a follow-up, not a v1 blocker.
- **Audit log** (shared with D2) — persisted per-batch trail. Deferred.
- **Blast-radius UI** (shared with D2) — affected-vs-selected count surfacing. Deferred.
- **Adapter-coverage expansion (L0 maps)** — sequencing note (§8): broaden L0 prop-mapper coverage for
  supported UI kits **before or alongside** any L3 enablement, so the ladder does not invert into
  "escape hatch is the default path." Own backlog.
- **DX polish on the banner** — virtualized details panel for high skip volume, "request adapter support"
  CTA, L3 surgery-consent dialog. The v1 banner is correct and honest; these are follow-ups.

---

## 2. The one open product call (cross-reference)

This decision's only genuine residual product call is **escalation policy** — confirm that L3 wrapping
is OPT-IN, single-element, NEVER automatic and NEVER inside a batch write. This doc treats that as
**decided** (the consensus is unanimous and codex's recommendation is explicit: "do not ship batch L3").
The literal D3 directive ("no non-stylable elements allowed … escalate: create a wrapper") is honored in
spirit by maximizing writability non-destructively (L0-L2) and demoting the unsafe remainder to opt-in.
An automatic, batch-triggered tree mutation is the one thing that violates "never silently destructive,"
so it is refused for v1.

> The other live #270 open call (the homogeneous-override chip: keep `[Auto, <System>]` vs always-hide
> the multi-select tab row) belongs to **D2** — see `2026-06-11-270-d2-source-routing.md` §2. It does not
> affect D3.

---

## 3. The ladder (pure resolver, new)

Add a pure `resolveStyleSurface(surfaceDecision, propSurfaceFacts, property) → { rung: 'L0'|'L1'|'L2'|
'L3', channel }`, evaluated PER element, PER property:
- **L0** if `surfaceDecision.reasons` includes `'adapter-known-prop-mapper'` (`elementPropMappers.length
  > 0`). DS-native writes MUST be **adapter-declared only** (D3.SRE / codex #8) — no "this prop looks
  like style" inference. Missing mappings produce `DS_ADAPTER_UNMAPPED_PROPERTY` (§5.3), not automatic
  wrapper escalation.
- **L1** else if `propSurfaceFacts.acceptsClassName/acceptsStyle/acceptsCssProp/acceptsSxProp` is true
  for a channel that can carry `property`. Route via the normal `updateStyles` path. The selected DOM
  element must be the actual forwarded target, not just the component root.
- **L2** else if `styleLikeProps ∪ semanticProps` covers `property`. Write that one property as a prop;
  properties NOT in the set → unwritable-for-this-property.
- **L3** else: no surface → escalation candidate. Deferred out of v1 (§7). In v1, an L3-for-P element is
  EXCLUDED and reported (`NO_WRITABLE_TARGET`), never wrapped.

L0/L1/L2 are non-destructive (no tree change). Only L3 can mutate the tree, and L3 is opt-in and
deferred. Expression-backed sources (`clsx`/`cva`/conditional props/`items.map(...)`/spread) are NOT
plain editable slots → treated as non-stylable for direct write (`EXPRESSION_BACKED_SOURCE`).

---

## 4. Classification & merge (orchestrator, new)

In the new fan-out orchestrator `useMergedElementStyleData` (findings §6.1 — NOT a hook-loop; the
single-read hook's single-latest-ref invariant forbids it), partition the N responses by
`surfaceDecision.standardStyleInspector`:
- `writable[]` = `'enabled'` (L0/L1) plus elements where L2 covers the property being read for display.
- `nonStandard[]` = `'disabled'` with reasons `['props-schema-available','no-standard-style-surface']`
  (`propsEditor:'full'`) — styleable via props only; banner copy "styled via props only".
- `noSurface[]` = `'disabled'` reasons `['no-standard-style-surface']` only — true L3.

The `ParsedStyles` value-merge (findings §4.1, salvage the `mergeStyleData` ALGORITHM from
`useBatchStyleData.ts:23-43` — the `8px vs 16px → MIXED` path) runs ONLY over `writable[]`.
`mergeStyleReadResults` tab-union (findings §4.2) unions tabs from `writable[]` only. Skipped elements
contribute NO write target and NO value, so `MIXED` can never represent a value on an element that
can't take it.

`decideSurface` accuracy is the one thing that, if wrong, reintroduces silent under-edit (a false
`'disabled'` silently excludes a writable element). Mitigation REQUIRED: unit-test the **verdict itself**
(`decideSurface`, `style-read-manager.ts:194-236`) against representative DS cases (intrinsic behind
`forwardRef`, untraced source-owner), not just the banner.

---

## 5. The honest skip-banner (D3.SRE4-5 / codex #9) — REQUIREMENT

### 5.1 Post-authoritative, not client-prediction
The banner shows ACTUAL host results from the per-element results array (D2 §6.2:
`applied | skipped | failed | applied_but_ineffective`), NOT a client guess. A pre-flight count estimate
may render immediately from cached classification, but the authoritative banner reflects the host's
returned per-element status after the write.

### 5.2 Persistent, non-blocking, reason-driven
Whenever `(nonStandard.length + noSurface.length) > 0`: a muted, persistent (not toast) banner at the
top of the style area, e.g. "2 of 5 selected elements can't be styled here (Button, Icon) and were
excluded." Copy is reasons-driven (`surfaceDecision.reasons` → human string) and distinguishes "styled
via props only" (`nonStandard`) from "no style surface" (`noSurface`). When `writable.length === 0`:
honest empty state — "None of the 3 selected elements can be styled here." — no editable inspector.

### 5.3 Machine reason codes — REQUIREMENT (D3.SRE5 / codex) — CANONICAL ENUM
Stable machine-readable reasons underneath the user-friendly text, NOT prose-only. **This is the single
canonical `SkipReasonCode` enum shared by D2 and D3** — the D2 doc emits into it, the banner renders
from it. Do not maintain two enums.
- `NO_WRITABLE_TARGET` — no L0/L1/L2 surface (D3) or Auto resolved to nothing concrete and the UIKit
  floor does not apply (D2). Under v1 this is also the terminal state for what would be L3 (escalation
  deferred).
- `STALE_SOURCE` — selection/source/snapshot changed between read and flush. (D2's internal plan-guard
  STATE is named `STALE_PLAN` in `BatchStyleWritePlan` handling, §D2.5.3; the host-emitted/banner-rendered
  reason CODE is `STALE_SOURCE`. One concept, two layers: internal guard state vs the canonical wire/UI
  code. Implementations MUST map `STALE_PLAN → STALE_SOURCE` at the result boundary.)
- `OWNER_MASKED` — the existing owner is masked by inline style / later class order / higher-specificity
  CSS such that editing it is a visual no-op; skip rather than write an invisible change. (Emitted by
  D2 §4.4; paired with the `applied_but_ineffective` result status, D2 §6.2.)
- `EXPRESSION_BACKED_SOURCE` — the style comes from `clsx` / `cva` / a conditional prop / `items.map(…)`
  / spread props — not a plain editable slot. (Emitted by D2 §4.4 and D3 §3.)
- `DS_ADAPTER_UNMAPPED_PROPERTY` — an **adapter gap**: the DS adapter doesn't map this property *yet*
  (our roadmap, not a property of the world). Distinct from the structural blockers above; see §5.3a.
- `L3_REQUIRES_OPT_IN` — reserved for the deferred L3 path; in v1 an L3 candidate reports
  `NO_WRITABLE_TARGET`. Allocated now so the follow-up does not renumber.
- `AMBIGUOUS_OWNER` — multiple plausible owners with no deterministic pick (e.g. masked / conflicting).
- `LOCKED_COMPONENT` — element is a locked/read-only component.

### 5.3a Adapter gap vs structural blocker — REQUIREMENT
The banner MUST distinguish **adapter gaps** (`DS_ADAPTER_UNMAPPED_PROPERTY` — "DS adapter doesn't map
this property *yet*", our roadmap signal) from **structural blockers** (`NO_WRITABLE_TARGET` /
`L3_REQUIRES_OPT_IN` / `EXPRESSION_BACKED_SOURCE` — property of the world). They are different product
signals and must not be collapsed (the adapter-gap class is what drives the deferred observability
counters and "request adapter support" CTA, §1 deferred).

### 5.4 Invalidation — REQUIREMENT
The banner (counts, reasons, CTAs) MUST invalidate and refresh on: **undo**, **selection change**, source
file modification (**HMR**), explicit **re-read**, and **input value change**. Stale remediation CTAs are
a wrong-write vector: a user sees "applied 7, skipped 3", hits Cmd+Z, and a stale "fix individually" CTA
must NOT re-apply a value into a reverted context. Expired CTAs refuse to act and prompt re-evaluation.

### 5.5 Remediation convergence with D2 — REQUIREMENT
The banner's "Fix →" / "Inspect" CTA routes into **D2's per-element edit-in-place** with the pending
value prefilled and the skip reason shown. D2 routing IS the remediation UX for D3 skips — recording it
here so the two UIs are not built separately.

### 5.6 Disabled-with-reason, never fake-writable — REQUIREMENT
If the active target/property is unwritable for ALL selected elements, the input is DISABLED with the
inline reason — a keystroke must never vanish into a no-op.

---

## 6. Batch write semantics (v1)

On a value edit of property P to the selection: run the ladder per element. Build the frozen
`BatchStyleWritePlan` (D2 §5) addressing ONLY elements that resolve L0/L1/L2 for P, each with its
per-element `selectedSourceTabId` resolved in the executor (`style-write-executor.ts:467-500`). Flush
through `ast:updateStylesBatch` grouped as ONE undo step via existing `recordBatchEdit` (findings
§6.5/§9, one `FileEdit` per unique mutated file). Elements at L3-for-P (or otherwise unresolvable) are
EXCLUDED from the plan and reported (§5). Never abort the whole batch because one element is L3; never
auto-wrap inside the batch. The D2 stale guard, same-source dedupe, and gesture-freeze all apply.

**Per-rung write channel inside the batch handler — REQUIREMENT.** The ladder rung determines the WRITE
CHANNEL, and a single `BatchStyleWritePlan` may mix channels (one selection can hold L0/L2 prop-write
elements AND L1 style-write elements). `ast:updateStylesBatch` must NOT funnel every entry through the
style executor / `updateStyles`:
- **L1 (style channel)** entries → the `updateStyles` path (className / `style=` / `css` / `sx`).
- **L0 (DS-native prop) and L2 (partial prop)** entries → the `updateProps` path
  (`writeMode 'props' → convertToProps → updateProps`, the same flow single-select uses at
  `useStyleSync.ts:184-247`). The plan entry's `route.channel` (D2 §5.1 `route`) carries which path each
  entry takes; the batch handler dispatches per entry. Without an `updateProps` branch in the batch
  handler, L0/L2 DS elements that the ladder marked writable would be silently skipped or written to the
  wrong channel — re-introducing the under-edit the ladder exists to prevent. All channels still
  accumulate into the ONE `recordBatchEdit` (one `FileEdit` per unique mutated file) for the single
  undo step. (Main already has `updateComponentPropsBatch` for the props batch path — reuse/route into
  it from the batch handler rather than rebuilding prop writes.)

UI gate (`RightSidebar.tsx:957`): relax from `selectedIds.length === 1 && parsedStyles` to
`(selectedIds.length === 1 || writable.length >= 1) && mergedParsedStyles`. Replace the dead-end
placeholder (`:943-948`) with the real multi-select editor.

---

## 7. L3 escalation — DEFERRED out of #270 v1 (its own guarded follow-up)

L3 wrapper escalation is **NOT part of #270 v1.** It ships in a separate ticket behind its own feature
flag and kill switch. This section is the spec for that follow-up so the v1 ladder, gate, and banner are
built as the foundation it layers onto — NOT a v1 deliverable.

### 7.1 Single-element, opt-in, feature-flagged, allowlisted (D3.SRE1 / codex #7)
- **SINGLE-ELEMENT ONLY.** No batch wrapper promotion — ever. Not from the skip banner, not from an
  "advanced mode", not from a power-user CTA. NEVER batch, NEVER banner-triggered.
- **OPT-IN** explicit "Wrap to style" action on the affected single element. NEVER auto-triggered by a
  value edit (a value edit can never restructure JSX).
- **FEATURE-FLAGGED** behind a dedicated flag, OFF by default.
- **ALLOWLISTED** — permit only structurally-safe simple JSX elements (block-flow, not flex/grid item,
  not table/SVG, no `key`, not a map-item, not a form control, not selector-sensitive, not an unknown
  component root). Everything else is BLOCKED, not best-effort.
- **INDEPENDENT KILL SWITCH** (D3.SRE7) — disable L3 wrapper writes independently from L0-L2 style
  writes if production reports semantic breakage, without disabling the ladder.

### 7.2 Blocking preflight, not advisory (D3.SRE2) — REQUIREMENT for the follow-up
The preflight BLOCKS (does not warn-then-proceed). It rejects wrapping around:
- **keyed `.map()` children** unless key migration is explicitly handled (wrapping `<Item key={id}/>`
  without moving the key to the wrapper breaks React identity);
- **refs** (`ref`-sensitive components), **labels** (`htmlFor`/`id` association),
- **table / SVG** subtrees, **absolute/fixed-positioned** elements,
- **selector-sensitive children** (`:first-child`/`:nth-child`, sibling/child combinators),
- **form controls**, and **unknown component roots**.

Dimension identity is necessary but NOT sufficient: "same computed dimensions" is checked in one
viewport / one state; equal at 1440px ≠ equal at 375px (flex-wrap, media queries), and a wrapper that
becomes a flex/grid child inherits `gap`/`flex`/`grid-column`/margin-collapse/percentage-height — the
guard passes in the demo and breaks on resize (the worst class: the user visually APPROVED the
regression). Hence the allowlist gates on structurally-safe parents (block flow), and L3 is presented
as a **code refactor with a diff preview**, not a style apply. `display: contents` is NOT an allowed
escape hatch (it dodges layout but fails box styling/background and has a11y/runtime quirks).

The predicate also requires: (a) UNIQUENESS — the wrapper would contain EXACTLY ONE selected element and
NO other element at all; (b) REUSE-BEFORE-CREATE — if E already has a stylable single-purpose parent
wrapping ONLY E with matching dims, edit THAT in place (no wrapper stacking). If the predicate fails →
the button is DISABLED with the failing reason ("shares a row with other elements" / "wrapping would
change layout" / `STRUCTURAL_BLOCKER`).

### 7.3 Exact AST round-trip rollback (D3.SRE3) — REQUIREMENT for the follow-up
Store before/after snapshots and VERIFY the AST round-trip. Undo MUST remove the wrapper and restore
imports/classes EXACTLY. ONE undo step (the existing `wrapElement` op already wraps in undo tracking).
Selection overlay stays on E (or "E (wrapped)"); the tree must not silently reshape with no UI
explanation. On success, insert a minimal stylable wrapper (intrinsic `<div>` web / `<View>` RN per
`projectUIKit` adapter, `RightSidebar.tsx:102-104`) carrying the project priority/Auto CSS system; write
the style there.

### 7.4 Wrapper attribution — decide now, ship with L3
Every HyperIDE-created wrapper carries a stable, machine-readable source marker from day one (it cannot
be retrofitted onto wrappers created without it). This enables the later "unwrap" / "lift back to DS
prop" tooling and an audit of our wrappers. The marker decision is made now; the tooling ships with L3.

### 7.5 Cross-realm dimension measurement (v1-style deferral, not a dead-end)
The dimension-identity check needs `getBoundingClientRect` from the preview-iframe realm, not the
inspector realm (same class that made #258/#260 SaaS-only). When computed dims are unavailable to the
inspector realm, the "Wrap to style" action is DISABLED with reason "can't measure layout here" — never
guessed. Disabled-with-reason is correct (never wrong); it narrows escalation availability until the
measurement bridge lands. The ladder L0/L1/L2 and the honest batch do NOT depend on this.

### 7.6 Existing primitive (so the follow-up is cheap)
USE THE EXISTING PRIMITIVE — do NOT build new AST surgery. The wrap op already ships: `wrapElementInAST`
(`lib/ast/operations.ts`), `wrapElement` (`ast-element-ops.ts:193`, format-preserving, undo-tracked via
`AstBridge`), ext RPC `ast:wrapElement` (`client/lib/platform/types.ts:136`), client caller
`client/utils/wrapElement.ts` (already used by `CanvasElementContextMenu.tsx:420` with `'div'`). The
genuinely-new work in the L3 follow-up is the PREDICATE + blocking preflight + attribution + round-trip
verification, NOT the mutation.

---

## 8. Build order (v1) & sequencing

1. Wire `surfaceDecision` into the orchestrator/gate (§2, §4).
2. Pure ladder resolver L0/L1/L2 + unit tests INCLUDING `decideSurface` verdict coverage (§3, §4).
3. Partition + value-merge over `writable[]` + tab-union (§4) — composes with D1.
4. Honest skip-banner + machine reason codes + disabled-with-reason + invalidation + MIXED
   placeholder/option (§5, D1).
5. `ast:updateStylesBatch` one-undo-step batch write over the resolved plan / frozen `BatchStyleWritePlan`
   (§6, D2 §5-6).

**Sequencing note (deferred but flagged):** broaden L0 adapter prop-mapper coverage for supported UI
kits BEFORE/ALONGSIDE any L3 enablement, so the ladder does not invert into "escape hatch is the default
path" and the honest banner does not read as "skipped 7 of 9" on real DS-heavy projects. Today
`componentPropMappers: []` / `elementPropMappers: []` are empty in many request-context paths
(`style-write-request-context.ts:70,155`).

---

## 9. Composition with D1 (Mixed) & D2 (routing)

- **D1:** the Mixed placeholder sits on genuinely-writable differing fields ONLY (the `writable[]`
  value-merge). `usePopulateStyleState` (`hooks/usePopulateStyleState.ts:147-298`) renders empty +
  `placeholder="Mixed"`; section selects get an explicit `mixed` `<option>`. Single-select (N=1) feeds
  raw `parsedStyles` unchanged → MIXED never leaks (findings §5). L3/excluded elements never enter the
  merge.
- **D2:** the ladder produces the resolved write plan; D2's frozen `BatchStyleWritePlan`, gesture-freeze,
  stale guard, same-source dedupe, no-silent-inline-fallback, and scoped undo all apply to the batch
  write. D2's per-element edit-in-place is the banner's "Fix →" remediation target (§5.5).

---

## 10. Why the rejected shapes stay rejected

- **D3-a alone (skip + warn, no ladder writes):** KEPT as the floor (the partition + persistent banner
  are mandatory), REJECTED as the whole — it leaves L0/L2-writable elements (prop-mappers, partial style
  props) lumped into "skipped." The ladder writes through surfaces D3-a ignores.
- **D3-b alone (auto-wrapper escalation in the write path):** REJECTED. (i) Auto-escalation inside a
  batch means a single value edit can restructure JSX under several DS components at once — destructive
  on typing. (ii) The dimension-identity check predicts a post-insert box that doesn't exist yet and lies
  in flex/grid layouts. Retained ONLY as the opt-in, single-element, predicate-gated, DEFERRED L3 rung
  (§7).
- **Auto-wrap-everything to literally satisfy "no non-stylable elements":** REJECTED — guaranteeing every
  DS element becomes writable in one automatic step requires auto-wrapping the residue (the destructive
  footgun, frequently changes layout). The ladder honors the directive's spirit and demotes the unsafe
  remainder to opt-in.
- **Blank-on-mixed:** REJECTED, settled by D1 (empty reads as "no value"; an edit silently overwrites all
  N = data loss).
