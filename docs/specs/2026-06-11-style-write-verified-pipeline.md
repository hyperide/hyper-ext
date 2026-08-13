# Style-write: verified write-target resolution + landing verification

**Status:** design (umbrella) · **Continues:** HYP-544 · **Date:** 2026-06-11
**Companions (read alongside):**
`docs/specs/2026-06-11-270-d2-source-routing.md` (D2 cascade),
`docs/specs/2026-06-11-270-d3-stylability-ladder.md` (D3 ladder + the **no-auto-mutation** safety model),
`docs/specs/2026-06-09-hyp544-color-replace-rework.md` (color replace),
`docs/specs/2026-06-04-hyp535-270-read-write-transport-findings.md` (cross-realm transport).

> v11 (2026-06-12): codex re-confirmed **TICKET-READY / sound** on v10; v11 is a one-line consistency
> fix — the §B1 component's `timeout/no-edge → warn-only` now matches the pipeline's `unverifiable →
> confidence×verifiability matrix` wording (no architecture change).
> v10 (2026-06-12): codex called v9 **TICKET-READY / sound**; v10 lands its four wording nits (no
> architecture change): `none → report/fail-closed` (only A3 does a gated B1-verified floor); B1
> `timeout/no-edge` now explicitly = `unverifiable` → confidence matrix (not a silent keep); the B0
> prose now lists remount-fragile / >N-equivalent-sites alongside the surfaceless cases under
> `NO_WRITABLE_TARGET` (matching the table); and the §6 swallowing-`<Button>` acceptance now names all
> three realms instead of "both realms".
> v9 (2026-06-12): last codex nit (no architecture change): the `FORWARDING_GAP` pairing row listed
> two terminals while the table claimed "exactly one per sidecar"; v9 states the contract as "exactly
> the terminal code(s) in its row", and `FORWARDING_GAP` is the sole dual-terminal row — bounded to
> `L3_REQUIRES_OPT_IN` (wrapper offerable) else `NO_WRITABLE_TARGET`, no third option. Also scrubbed
> the last stale "D3's fallbackReason taxonomy" phrase from the v6 header note.
> v8 (2026-06-12): final tightening on codex's v7 pass (no architecture change): added a B0 table
> pairing **every** `fallbackReason` sidecar to its one allowed terminal `SkipReasonCode` (so a ticket
> can't invent pairings for `REMOUNT_FRAGILE_AMBIGUITY` / `EQUIVALENT_DEFINITION_SITES_EXCEEDED` /
> `AMBIGUOUS_VALUE_MATCH` / `CSSOM_ATTRIBUTION_DISAGREE`), and changed the frozen-plan `reasonCode`
> field + the pipeline summary to read `terminal SkipReasonCode + fallbackReason when applicable` so
> the sidecar can never be legally dropped at freeze/report.
> v7 (2026-06-12): closes the residual two-layer-code inconsistencies codex flagged on v6 (no
> architecture change): terminal codes for locked/expression-backed/masked/ambiguous cases are now
> their OWN existing terminal `SkipReasonCode`s (not funneled through `NO_WRITABLE_TARGET`), only the
> surfaceless cases use `NO_WRITABLE_TARGET` + a `fallbackReason` sidecar; the `fallbackReason` sidecar
> is now stated as NEW and owned canonically by B0 (D3 §5.3 defines only `SkipReasonCode`, so v6's
> "added to D3's fallbackReason taxonomy" was wrong); and the A2 pipeline line now says `probable`
> routes ONLY to the frozen B0/B1 source trial (never a bare write), matching §1b/§A2.
> v6 (2026-06-12): closes the two P1 + one P2 follow-on gaps codex raised on v5 (no architecture
> change): the canonical-code contract is now explicitly TWO LAYERS — a shared terminal `SkipReasonCode`
> category (D3 §5.3, not forked) + a per-case `fallbackReason` sub-tag/counter — so §1b/§A1/§6 emit
> the terminal category *carrying* the concrete sub-tag instead of collapsing it; the new sidecar
> additions reuse D3's existing terminal names (`EXPRESSION_BACKED_SOURCE`/`LOCKED_COMPONENT`, not new
> synonyms) [**superseded by v7**: `fallbackReason` is a NEW field owned by B0, not a D3 taxonomy]; the §5 transport matrix B1-settle
> row now spells out the dual settle (TSX render echo vs CSS-file stylesheet epoch) so a transport
> ticket can't implement render-echo-only CSS verify and hang.
> v5 (2026-06-12): closes the four NEW ticket-writer contract gaps codex raised on v4 (no
> architecture change): the canonical result-code/counter enum is now spelled out (no collapsing into
> `NO_WRITABLE_TARGET`); `exact`+`not-landed` source-write disposition (held pending → rollback on
> decline/TTL); A1 reconciliation (HIGH-confidence negative forwarding pre-excludes, low/inconclusive
> never blocks/authorizes alone; inline floor needs HIGH-confidence forward or B1); B1 dual settle
> (TSX render echo vs CSS-file stylesheet epoch) + don't neutralize transition/animation when that
> IS the edited property.
> v4 (2026-06-12): closes the codex+fable5 contract/wording gaps on v3 — no architecture change.
> Adds the confidence×verifiability matrix (probable+unverifiable = rollback/confirm, never a silent
> keep), value-form normalization as FILTER-not-selector (quantization-only tolerance, cascade-matched
> only), broadness-overrides-count, the `0`-case split (NO_WRITABLE_TARGET vs verified floor), the
> frozen-plan / B-probable-source-trial framing, read-frame isolation (pin-lift + transition-neutralize),
> CSSOM-only-when-it-agrees, the cascade-read transport row, remount-fragile/runtime-context routing,
> and the pre-write-exclusion vs not-landed wording. v3 (2026-06-12): folds in the multi-model
> find-where brainstorm (cascade-read is the primary resolver, the clone/iframe-pool is demoted to v2),
> the CTO's Tier-1 reframe (empirical candidate resolution), and the HYP-544 critique (A/B complementary,
> seam in the planner, fail-closed). v2 (2026-06-11): removed the auto-wrapper (no-auto-mutation
> invariant). See §7.

---

## 0. Problem, the corrected model, and the non-negotiable invariant

When a user changes a style in the canvas (e.g. a colour), HyperCanvas writes that change back
into project source. The naive "floor" was inline `style={{...}}`, assumed to "always work".
**False:** a component may not forward `className`/`style` to a host DOM node (a design-system
`<Button>` whose body is `<button className="fixed"/>` ignores the prop) → the write lands in
source and changes **nothing rendered** (silent no-op). Worse today: a CSS-file write whose
selector isn't found *hard-fails* and the colour click is **dead** (HYP-706).

**The model is a sequence of responsibilities, NOT two orthogonal axes** (review P0-2). A failed
write must not silently feed back into "pick another target":

```
plan (WHERE) → write → verify (DID it land) → classify → [explicit, opt-in repair plan]
```

- **WHERE-to-write** (D2 cascade): pick the highest-preference *styling system* the element
  actually forwards — element-own → project-default → detected → reported inline floor.
  "Tier-2" = the *second-preference styling system*, **not** inline.
- **Verify/classify** (the new authoritative half): after a real settle, read the live DOM and
  classify `landed | not-landed | ambiguous | unverifiable`, with a canonical result code. This
  half **only classifies and reports** — it never mutates source on its own.
- **Repair** is a *new, explicit plan* a human or AI opts into — not an automatic continuation.

**INVARIANT (from D3 §0, P0-1): a value edit can NEVER auto-trigger a tree mutation.** Wrapper
insertion is an L3 repair: opt-in, single-element, preflighted, feature-flagged, behind explicit
confirmation. `not-landed` surfaces a reason + *offers* a repair; it does not perform one.

**Degradation ladder (corrected, P2-1).** Per decision, deterministic resolution OUTRANKS AI:
**exact-semantic+algo → probable-deterministic (write only with runtime verification) → heuristic
(only with rollback + verify) → AI (advisory / explicit repair, never auto-authoritative).** AI is
the *repair* tier, not the default. `inconclusive`/`unverifiable` never decides alone — it reports.

**Universality (hard req):** identical behaviour across SaaS-Docker, SaaS-NodePod/OPFS, and the VS
Code extension. Decision core in `lib/`; realm-specific code is thin transports enumerated in §5.

---

## 1. Current reality (grounded)

D2/D3 is **built but fed garbage facts**:
- `lib/style-write/style-write-request-context.ts:149` `resolveWriteCascade()` — live D2 cascade,
  **zero forwarding awareness**: `elementPropMappers: []` hardcoded (`:222`), no `componentPropSurface`.
- `lib/style-write/style-write-executor.ts:687` `getElementCssSystems()` — writes Tailwind wherever
  it sees `className` on the JSX usage, **never checking forwarding** → the silent no-op.
- `lib/style-write/stylability-ladder.ts:49` `resolveStyleSurface()` — the D3 ladder; correct,
  tested, but **a pure consumer**, "STAGED, NOT yet consulted on the live write path". **Starved.**
- `vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts:708` `buildElementFacts()`
  — **hardcodes** `acceptsClassName:true, acceptsStyle:true` for every element (`:723-731`). The
  read path is plumbed (`createDefaultStyleReadManager` runs `decideSurface` live) — needs honest facts.

Verification is **lopsided**:
- SaaS: ~70% verifier (`client/lib/style-change-detector.ts:120` `startStyleVerification`) but
  **equality-only** (`detectUnchangedProperties:76`, not intended-match) and on `not-applied`
  **jumps straight to AI** (`RightSidebar.tsx:254`), skipping classification.
- Ext: better settle primitive (`DevServerManager.ts:613` `armRecompileGate`/`:634` `awaitRecompile`)
  but **zero verification on style writes**; finishes immediately after `astOps.updateStyles`
  (`useStyleSync.ts:226`); gate armed only on entry-file patches.
- A pre-write probe exists (ext `iframe-color-probe.ts` `probeDrivingCandidates`) — predicts the
  colour *source before* writing, does NOT confirm landing *after* HMR.

---

## 1b. Find-where resolver — the v3 core (2026-06-12 multi-model brainstorm + Tier-1 reframe + HYP-544 critique)

The resolver for the `plan (WHERE)` step. Recommended end-to-end shape:

> static attribution index → cascade **READ** → frozen plan → transactional write → correlated verify

**Primary resolver = read the cascade; do NOT experiment by default.** The shipped off-screen-clone
probe and any DOM-mutation / hidden-iframe pool are NOT the spine — a non-destructive read of the
active cascade wins the common case and avoids the trust-boundary + state-divergence cost. The DOM
side is the *easy* side (the current value is read from `getComputedStyle`, the node is given by the
browser); the hard part is **where in the CODE**, where the code form ≠ the DOM form.

1. **Static attribution engine** (`lib/style-attribution/`, shared, FS-injected): enumerate every
   source candidate that could set the property — className utility tokens, `clsx/cn/twMerge`, local
   consts, `cva({variants})`, inline `style`, imported CSS / CSS-Module rules (Vite module graph),
   CSS vars, Tailwind utilities→config (JS config **and** Tailwind v4 CSS-first `@theme`),
   CSS-in-JS (adapter metadata only). Keep the provenance chain (`text-blue-500 → theme token →
   oklch → computed`).
   **Value-form normalization is a FILTER, NEVER a selector** (review P1, fable §3). It only
   *confirms* a candidate already tied by provenance (property/channel, selector/class/source span,
   state/media/`@layer`, var chain, alpha) — a colour match **alone never establishes ownership**.
   - Run value-match **ONLY against cascade-matched candidates** (step 2), not "every source
     candidate" — else a stray `#3b82f6` literal in an unrelated file matches.
   - Distinct candidates routinely collapse to the same colour: `text-blue-500` vs `--brand-primary`,
     token aliases, OKLCH rounding, `currentColor`/`inherit` resolving to a literal, light/dark
     tokens equal in the *current* theme, `twMerge`-deduped duplicates (one emitted rule, two
     sources). When **≥2 distinct candidates** fall within tolerance, value-match gives **zero
     discrimination** → cap confidence at `probable` / demote to ambiguous (never silently pick one).
   - **Form-equivalence tolerance is quantization-only, not perceptual.** Compare in 8-bit sRGB by
     exact match after explicit CSS Color 4 → sRGB conversion, OR ΔE < ~0.3 strictly for
     oklch→sRGB→8-bit round-trip error. **Never a perceptual ΔE 2–3** (that false-matches
     `gray-500` vs `slate-500` and adjacent brand colours). Compare **specified channels** incl.
     alpha (`#RRGGBBAA` vs an `opacity` blend are not equal — compare the authored channels, not the
     composited pixel), and expand shorthands (`background` vs `background-color`) before matching.
   So a candidate stored as `#3b82f6` matches a DOM `rgb(59,130,246)` (bundler/Tailwind/CSS-Modules
   transform the form) — but only as corroboration of a provenance-tied, cascade-winning candidate.
2. **Cascade read** (CSSOM matched-rules; an injected probe in the iframe/webview realms — **CDP is
   diagnostics-only, page JS cannot reach it in prod**; CSSOM is *not* a complete `getMatchedStyles`).
   **CSSOM + static attribution yield an exact owner ONLY WHEN THEY AGREE; otherwise fail closed**
   (review P1, codex §5). CSSOM is a useful active-cascade read, but a *single active winning
   declaration → single writable candidate* holds only when source ownership is unambiguous —
   cross-origin / foreign / constructable stylesheets, shadow DOM, animations, shorthands,
   custom-property chains, missing/partial sourcemaps, and CSS-in-JS can each break the
   declaration→source link. Where the CSSOM winner and static attribution disagree (or attribution
   can't tie the winner to a writable span), do NOT pick a candidate — demote to ambiguous / report.
   Reading suffices for exact active owners; experimentation is only needed for collisions / var
   ambiguity / expression-backed / masked owners / animations / foreign sheets / broad-token intent.
3. **B = host-side source attribution is the WRITER** (AST + css-module refs + postcss + sourcemaps),
   confidence `exact | probable | none`. **Only `exact` auto-writes.** `probable` writes ONLY behind
   runtime verification (B1). `none` → report / fail-closed; only A3 may then perform a **gated,
   reported, B1-verified** inline floor (never a bare inline). **fail-CLOSED**: absent verification
   must NEVER promote to `exact` (`rafVerified ?? false`, never `?? true` — the single most dangerous line).

   **Confidence × verifiability matrix (the authoritative B1-outcome contract — resolves the
   §1b↔§2-B1 contradiction, fable's worst finding):** B1 returning `unverifiable` is NOT a free
   "keep". The keep/rollback decision is a function of *both* the pre-write confidence and the
   verify verdict:

   | confidence | `landed` | `not-landed` | `ambiguous` | `unverifiable` |
   |---|---|---|---|---|
   | **exact**    | commit | B2 offer (real edge) | report, keep | **keep + report** (write was already trusted) |
   | **probable** | commit | rollback | report, demote | **ROLLBACK or explicit confirmation — NEVER silently keep** |
   | **none**     | (no write — reported floor / `NO_WRITABLE_TARGET`) | — | — | — |

   `probable` is admitted *only because* B1 will verify it; if B1 can't verify (state-variant, realm
   can't read, remount), the gate is unmet and a silent keep is exactly the `?? true` this section
   forbids. Roll back, or surface explicit confirmation showing the unverified target. Only `exact`
   (already trusted pre-write) keeps an unverifiable write, and only with a surfaced report.

   **`exact` + `not-landed` transaction disposition** (codex v4 gap — a real implementation fork): the
   source write already happened, B1 saw a real render edge, and the value is still ≈ before, so B2
   *offers* a wrapper. The source write is **held pending under the open `writeId`** while the offer
   stands; on **decline or offer-TTL it is ROLLED BACK** (the value didn't land — leaving an invisible
   edit is a silent no-op). It is kept only behind an explicit "keep the unverified source edit"
   confirmation. The transaction never commits an edit that B1 proved didn't render without that opt-in.
4. **A = runtime experiment is COMPLEMENTARY, not the authority, and DEMOTED to v2.** A (in-page
   rule-mutate-measure / the deferred hidden-iframe pool) answers *"this rule affects the rendered
   value"* — which is **NOT** *"this is the safe source declaration to edit"*. So **A is never in the
   auto-write path.** It owns runtime-context cases (CSS-var on an ancestor wrapper, authored-CSS
   descendant selectors). Build B+floor first; instrument fallback-reason COUNTERS so A is later
   justified by telemetry (do runtime-context fallbacks dominate?), not anxiety. **trust > coverage.**

   **Where A's domain routes in v1 (A is demoted, so v1 must name the owner): fail-closed → report +
   increment a fallback-reason counter — there is NO v1 owner for these, by design.** The taxonomy:
   - `runtime-context` (CSS-var on an ancestor wrapper, authored-CSS descendant selectors,
     JS-runtime styles) → report + counter; the counter is what later justifies building A.
   - `remount-fragile-ambiguity` (fable §2) — a TSX-side candidate edit (cva-token / inline /
     className) triggers an HMR **remount**; the element's transient state (open modal, expanded
     dropdown) is destroyed → B1 can't find E → `unverifiable`. **CSS-file writes hot-swap stylesheets
     without remounting and do NOT hit this.** v1 routes these to report under this dedicated counter
     (it is precisely the case only a *pre-write* in-page experiment could disambiguate — A's future
     domain), not a silent keep.
   - `>N-equivalent-definition-sites` (a CSS var defined at root + theme + media + scope, exceeding
     the max-2 circuit breaker) → report + counter. A coverage gap, not a safety gap.

**Resolution by candidate count — BROADNESS OVERRIDES COUNT** (the CTO's 3-case, made safe). The
count is read *after* classifying each candidate's blast radius: a single broad owner is not a
"1-candidate write".
- **exactly 1 NARROW/LOCAL** writable candidate the cascade confirms drives the value → write it.
  (A single *broad* owner — even if it's the only candidate — falls into the **broad** case below,
  review P1/codex §3.)
- **>1 narrow** → a **B-PROBABLE SOURCE TRIAL under B0/B1** (review codex §1) — a transactional
  *source* trial, **NOT** a runtime/clone/hidden-iframe experiment; the demoted-A ban is on
  DOM-mutation probes only, this writes real source under transaction + verify + rollback. Pin the
  user's display patch on the clicked element, write the top candidate, await the *correlated* HMR,
  verify under the pin; hit = final, miss = rollback + ≤1 more. Hard gates: clean file / server CAS /
  one writer lock / document-version check / verified rollback / pin TTL / max 2 / circuit breaker.
  Demote to `probable`; never let enumeration order silently pick a winner under `@layer`/`!important`.
  **Pin must not mask the verify** (fable §"pin masks verification"): if the optimistic display patch
  sets the *same* property inline, B1's computed-style read returns the **pin** value regardless of
  whether the source write landed → B1 would verify the pin, not the write. Required: **lift the pin
  for the verify frame** (no flicker if the write actually landed), OR pin via a dedicated,
  *excludable* stylesheet and read matched rules *under* it. Additionally B1 must **neutralize
  transition/animation on the read frame** (inject `transition:none`/`animation:none`) — else a 2 s
  transition still mid-flight yields a false `not-landed` and rolls back a CORRECT write.
- **broad** owners (theme tokens, Tailwind config, shared CSS vars, broad `cva` branches) → NOT
  silently trialed **even when they are the only candidate**: show scope + consumer blast-radius +
  diff preview + require confirmation.
- **0** → diagnose the concrete reason → route by whether a writable channel actually exists.
  An inline floor is the answer **ONLY** when a concrete forwarded style channel exists **OR** B1
  verifies the floor landed. For these there is **no legitimate inline floor** → emit a terminal
  `SkipReasonCode` per B0's two-layer contract, **never** a silent or unverifiable inline (review
  P1/codex §2, aligns with D2 §4.4 and §3 A3):
  - locked file → terminal `LOCKED_COMPONENT`; expression-backed source → terminal
    `EXPRESSION_BACKED_SOURCE` (these existing terminal codes already name the cause — no sidecar).
  - forwarding-gap / foreign-stylesheet / forced-colors (surfaceless, no more-specific terminal) →
    terminal `NO_WRITABLE_TARGET` (or `L3_REQUIRES_OPT_IN` if an L3 wrapper is offerable) **carrying
    the `fallbackReason` sidecar** (`FORWARDING_GAP` / `FOREIGN_STYLESHEET` / `FORCED_COLORS`) so the
    distinct counter survives.
  - JS-runtime styles / animations → terminal `NO_WRITABLE_TARGET` + `fallbackReason: RUNTIME_CONTEXT`.

**The plan is FROZEN at the planner** (resolves the §0/P0-2 contradiction — fable §5). The whole
resolution above — the **ordered** candidate list, the max-2, every gate, the confidence, the
`verificationPolicy`, the `blastRadius`, the `reasonCode` (terminal `SkipReasonCode` **+
`fallbackReason` when applicable** — never the terminal code alone), and source snapshots — is
**materialized in the frozen plan at planner time**. A retry (the `>1 narrow` "≤1 more") executes ONE pre-approved
plan step, NOT reactive replanning — so "miss = try the next candidate" is *not* a failed write
silently feeding back into target-selection (which §0/P0-2 forbids); it is a pre-authorized,
pre-ordered second step of one plan. **The executor MUST NOT synthesize new fallbacks after freeze.**

**The seam is the PLANNER, not the Tailwind branch** (HYP-544 fatal-seam fix): intercept at
`getRequestSourceOwners` / `createSyntheticOwner` in `style-write-request-context.ts`, NOT
`style-write-executor.ts:216` (only the `elementClass` source-form reaches `:216`; the interesting
var / module / descendant cases go to `executeCssFilePlan` and never hit it). **This is an empirical
claim about the current code** (fable §4) — lock it with a regression test *"all source-forms route
through the planner"* so a future refactor can't reintroduce a Tailwind-only seam. The planner emits
a **frozen owner** `{confidence, verificationPolicy, blastRadius, reasonCode: {terminal, fallbackReason?}, source-snapshots}`.
**Forward-detection (A1) is a fact PREDICTOR** — it ranks/prunes candidates; the cascade read + B1
verify are authoritative.

## 2. The pipeline (end-to-end)

```
user edits style on E (nodeRef + itemIndex)
│
├─ B0. OPEN a transaction: snapshot every file the plan may touch (per-file before-hash),
│      assign a writeId. All subsequent source edits are attributed to it for one-undo rollback.
│
├─ A1. FORWARD-DETECT (lib/stylability/forward-detector.ts) — per-channel
│      {forwardsClassName, forwardsStyle, hostProp, confidence, rung, valueMerged}. AST-first;
│      LSP/type backstop; DS-allowlist heuristic (low); else `inconclusive`. Advisory pre-filter only.
│
├─ A2. RESOLVE WHERE (D2 resolveWriteCascade, fed A1 facts): highest-preference styling SYSTEM
│      whose channel E forwards. className-channel only if forwardsClassName; style-channel only if
│      forwardsStyle. host-side CSS-Module/CSS-var/authored-CSS resolve → HYP-704 (exact|probable|none:
│      `exact` auto-writes; `probable` routes ONLY to the frozen B0/B1 source trial — never a bare
│      write; `none` reports, fail-closed). cva({variants}) token → HYP-705.
│      value-merged channel → apply the §3 transform (NOT blind replace).
│
├─ A3. WRITE at the resolved target. CSS-file selector miss → NOT a hard-fail and NOT a silent
│      inline (D2 §4.4): emit a REPORTED, verified inline floor with a canonical code (HYP-706,
│      gated on A1 forwarding-awareness OR B1 verification — see §3).
│
├─ B1. VERIFY (lib/style-write/runtime-verify) — after a CORRELATED settle: a TSX render echo for
│      TSX-side writes, OR a stylesheet/style epoch for CSS-file writes (CSS HMR does not re-render E)
│      — never compile-success/timeout. Neutralize transition/animation on the read frame (inject
│      transition:none; EXCEPT when the edited property itself is transition/animation) and lift any
│      optimistic pin so the read reflects the SOURCE write, not an in-flight transition or the pin.
│      Read live computed style + class-list/inline-attr of E. Classify against INTENDED value:
│         landed       → commit the transaction. done.
│         ambiguous    → report (value transformed/clamped/cascade). Do NOT repair automatically.
│         unverifiable → state variant (hover/focus) or realm can't read → resolve via the §1b
│                        confidence×verifiability matrix: exact = keep+report; probable = ROLLBACK
│                        or explicit confirmation (NEVER a silent keep).
│         not-landed   → (real settle edge, value still ≈ before) → B2 OFFER. timeout/no-edge → treat
│                        as `unverifiable` (no repair) and resolve via the confidence×verifiability
│                        matrix — NOT a silent keep of a probable write.
│
├─ B2. REPAIR — OFFER (never auto). A canonical `not-landed` reason + an explicit, single-element,
│      feature-flagged L3 wrapper proposal: property-gated (only properties valid on a parent box),
│      preflighted. If accepted: write wrapper under the same writeId, then RE-RUN B1; pixel-diff
│      (B3) is a guard, not the proof the element got styled.
│
├─ B3. VISUAL-REGRESSION guard (runtime, in-session) — before/after screenshot via the realm's
│      live transport (SaaS browser capture; ext preview-panel screenshot RPC — NOT Docker, §5).
│      ImageMagick `compare` masked to the intended region. LARGE diff (repair broke layout) →
│      ROLLBACK the whole writeId transaction (value + wrapper + any file), then: AI present → an
│      explicit AI repair attempt with full context (component source, diff magnitude, before/after);
│      no AI → warning. Docker-based pixel diff is ACCEPTANCE-test only (§6), not the product path.
│
└─ every non-write surfaces a canonical terminal SkipReasonCode + fallbackReason (when applicable,
       per B0's pairing table); nothing is ever a silent no-op and no sidecar is ever dropped.
```

---

## 3. Components

### B0 — Result codes + rollback/snapshot transaction (BUILD FIRST) · NEW
A `WriteResult` shape (the terminal `SkipReasonCode` from D3 §5.3 + the NEW `fallbackReason` sidecar
defined below — NOT a second terminal enum) + a write transaction: open per edit,
snapshot the before-content/hash of every file any stage may touch (A3 CSS/TSX, B2 wrapper),
attribute every mutation to the `writeId`, expose `rollback(writeId)` that restores all touched
files via exact AST/text revert and collapses to **one** editor undo step. Without this, "rollback
the value" (review P0-3) can leave a wrapper behind or revert only one of several files. Everything
below depends on B0.

**Canonical codes — TWO LAYERS, not free-text (ticket-writer contract).** There is ONE canonical
terminal enum, the `SkipReasonCode` defined in **D3 §5.3** and shared by D2/D3
(`NO_WRITABLE_TARGET`, `STALE_SOURCE`, `OWNER_MASKED`, `EXPRESSION_BACKED_SOURCE`,
`DS_ADAPTER_UNMAPPED_PROPERTY`, `L3_REQUIRES_OPT_IN`, `AMBIGUOUS_OWNER`, `LOCKED_COMPONENT`). Do
**NOT** fork a second terminal enum. Layer 2 is a **NEW sidecar field `fallbackReason`, defined
canonically HERE in B0** (D3 §5.3 today defines only `SkipReasonCode` — B0 adds the sidecar; it is not
a pre-existing D3 taxonomy). The two layers:

- **Terminal `SkipReasonCode`** (layer 1) = what the banner/wire renders. Each §1b case maps to its
  **most specific existing** terminal code — do NOT funnel everything through `NO_WRITABLE_TARGET`:
  locked file → `LOCKED_COMPONENT`; expression-backed source → `EXPRESSION_BACKED_SOURCE`; masked
  owner → `OWNER_MASKED`; ambiguous owner / value-collision → `AMBIGUOUS_OWNER`. `NO_WRITABLE_TARGET`
  (or `L3_REQUIRES_OPT_IN` when an L3 wrapper is offerable) is reserved for **surfaceless or
  coverage-unverifiable** cases with no more-specific terminal code: forwarding-gap, foreign-sheet,
  forced-colors, runtime-context, remount-fragile, and >N-equivalent-definition-sites (see the table).
- **`fallbackReason` sidecar** (layer 2, NEW in B0 — distinct `fallback.<reason>` counter each, this
  is what must NOT be collapsed). These are NOT terminal codes and NOT renames of D3's terminal names
  — each rides alongside **exactly the terminal code(s) in its table row** (a ticket MUST NOT invent
  other pairings or drop the sidecar). All rows pin a single terminal code except `FORWARDING_GAP`,
  whose terminal depends solely on L3-offerability — `L3_REQUIRES_OPT_IN` when a single-element
  wrapper repair is offerable (§B2), else `NO_WRITABLE_TARGET`; those are the ONLY two it may take:

  | `fallbackReason` (sidecar) | allowed terminal `SkipReasonCode` |
  |---|---|
  | `FORWARDING_GAP` | `L3_REQUIRES_OPT_IN` if a wrapper repair is offerable, else `NO_WRITABLE_TARGET` (no third option) |
  | `FOREIGN_STYLESHEET` | `NO_WRITABLE_TARGET` |
  | `FORCED_COLORS` | `NO_WRITABLE_TARGET` |
  | `RUNTIME_CONTEXT` | `NO_WRITABLE_TARGET` |
  | `REMOUNT_FRAGILE_AMBIGUITY` | `NO_WRITABLE_TARGET` |
  | `EQUIVALENT_DEFINITION_SITES_EXCEEDED` | `NO_WRITABLE_TARGET` |
  | `AMBIGUOUS_VALUE_MATCH` | `AMBIGUOUS_OWNER` |
  | `CSSOM_ATTRIBUTION_DISAGREE` | `AMBIGUOUS_OWNER` |

  A terminal code that already pinpoints the cause (`LOCKED_COMPONENT`, `EXPRESSION_BACKED_SOURCE`,
  `OWNER_MASKED`) needs no sidecar; its own counter suffices.

So `{terminal: NO_WRITABLE_TARGET, fallbackReason: FORWARDING_GAP}` and
`{terminal: NO_WRITABLE_TARGET, fallbackReason: FORCED_COLORS}` share a banner category but increment
**different** `fallback.<reason>` counters — the telemetry that later justifies building A. A ticket
that drops the `fallbackReason` and reports only the terminal `NO_WRITABLE_TARGET` is a contract
violation: the sub-tag must survive to its own counter even though the banner shows one category.

### A1 — Forward-detection (fact producer, advisory) · NEW `lib/stylability/forward-detector.ts`
`{ forwardsClassName, forwardsStyle, hostProp, hostTag, confidence: high|medium|low, rung, valueMerged?, trace[] }`,
**per-channel** (className/style never collapsed — DS components forward className, swallow style).
Algorithm: lowercase-host short-circuit → resolve def (`lib/ast/master-component-resolver.ts:35`) →
HOC-unwrapped body (`lib/services/component-parser.ts:163` `findLocalComponentDefinition`) → identify
binding (destructure/alias/`props.x`/`{...rest}`) → trace render JSX (direct / value-merged clsx·cva·
twMerge → set `valueMerged` / spread + attribute-order override / recurse 1 level + cycle-guard /
conditional branch / swallow-negative). LSP tier behind injected `SymbolResolver` (ext
`executeDefinitionProvider` `PanelRouter.ts:543`; server `ts.createProgram`
`getComponentPropsTypes.ts:480`) — keeps `lib/` free of `vscode`/`ts`. **Advisory, with one exception
(codex v4 gap):** A1 is advisory for *positive* forwarding (it ranks/prunes, B1 is authoritative on
whether a write landed) — but a **HIGH-confidence NEGATIVE** forwarding fact (the channel is provably
swallowed) **does pre-exclude** the write (§6 swallowing-`<Button>` → terminal `NO_WRITABLE_TARGET`
with `fallbackReason: FORWARDING_GAP`, before any attempt — see B0's two-layer code contract).
Low/medium/`inconclusive` A1 never blocks and never authorizes alone; only high-confidence
*swallow* short-circuits to a pre-write exclusion. Seam: replaces the hardcoded surface (`StyleReadService.ts:708`,
`style-write-request-context.ts:222`); feeds the starved D3 ladder; threads `forwardsToHostForChannel`
into `resolveWriteCascade` so a className write to a swallowing component reports a code, not a no-op.

### A2 — Where-to-write (honest D2) · HYP-704, HYP-705
- **HYP-704** — host-side CSS write-target resolve (CSS-Module/CSS-var/authored-CSS), gate
  `exact | probable | none`: write only on `exact`; `probable` writes **only with B1 verification**;
  `none` → report-and-stop, fail-closed. Corrected Tier-2 (8 fixes).
- **HYP-705** — static `cva()` variant resolver. **Blast radius (P1-8):** editing a variant token
  changes ALL consumers of that variant; HYP-705 must resolve the *exact* active variant branch and
  surface the consumer count; ambiguous branch → `probable` (verify) or `none`, never a blind token edit.

### A2/A3 — value-merged transform strategy (P1-8) · part of HYP-704/705
A1 `valueMerged` is not enough; the writer picks ONE concrete transform, else fails-closed:
`replace-literal` (static class string) · `append-merge-arg` (clsx/cn last-wins) · `wrap-twMerge`
(when precedence needs it) · `edit-cva-token` (HYP-705, exact branch only) · `fail → report`.

### A3 — CSS-miss floor (gated) · HYP-706
NOT independent and NOT "~15 lines" (review P1-4). Reconciles with D2 §4.4 "no silent inline": the
floor is a **reported, verified** inline write (canonical code surfaced in the inspector), allowed
ONLY when A1 says the style channel forwards **at HIGH confidence**, OR B1 verifies it landed;
otherwise report `none` (codex v4 gap — required A1 confidence pinned). Low/medium/`inconclusive`
positive forwarding does NOT authorize an inline floor on its own — it must be B1-verified before the
write is kept (else it's exactly the unverified inline this gate exists to prevent).
Flipping hard-fail→floor *without* that gate just trades a dead click for a silent no-op.

### B1 — Runtime verify (authoritative) · NEW `lib/style-write/runtime-verify/`
Core `verifyStyleLanded({elementId, itemIndex, intendedStyles, beforeSnapshot, settle, readComputed})
→ {verdict, perProperty, settleSignal}`. Intended-value match (reuse `iframe-color-probe.ts`
`normalizeColor`/`colorsEqual`), compares class-list/inline-attr too (avoid cascade false-neg).
**Read-frame isolation (fable "pin masks verification" + "transition false-negative"):** before
reading computed style, (a) **lift any optimistic display pin** so the read reflects the SOURCE write
— if the pin set the same property inline, the computed read would otherwise return the pin value
regardless of whether the source write landed (B1 would verify the pin, not the write); lifting it
causes no flicker iff the write actually landed; alternatively pin via a dedicated *excludable*
stylesheet and read matched rules under it. (b) **Neutralize transition/animation** (inject
`transition:none`/`animation:none` for the read frame) — else a still-running 2 s transition yields a
false `not-landed` and rolls back a CORRECT write in the optimistic-apply loop. **Exception (codex v4
gap): when the edited property IS `transition`/`animation`/`animation-*`/`transition-*`, DO NOT blanket-
neutralize it** — that would erase the very value under test; instead read the longhand directly and
skip the override for that channel.
**Settle is a correlated render handshake (P1-5), not compile/timeout:** the write carries a
`styleVersion`/`writeId`; the iframe reports back the version it actually rendered on E
(`requestComputedStyle` extended with the observed version). **Two settle signals (codex v4 gap):**
a **TSX render echo** (the version actually rendered on E) for TSX-side writes, and a distinct
**stylesheet/style EPOCH** for CSS-file writes — a CSS-only HMR hot-swaps the stylesheet **without
re-rendering** E, so waiting for a render echo would hang. CSS-file settle = the iframe observing the
new stylesheet epoch applied; TSX settle = the render echo. `settleSignal` gates B2: real
edge (render echo OR stylesheet epoch) + value≈before → `not-landed`; timeout/no-edge →
`unverifiable` (no repair — never repair a slow build; disposition via the confidence×verifiability
matrix, NOT a silent keep of a probable write).
**`unverifiable` is NOT a blanket keep** — resolve via the §1b confidence×verifiability matrix
(`exact` keeps+reports; `probable` rolls back or asks for explicit confirmation, never silently keeps).

### B2 — Repair (opt-in L3 wrapper) · NEW, behind feature flag + confirmation
Property-gated (P1-7): a wrapper styles a *new parent box*, not E's host — only properties that are
valid/inheritable on a parent (background on a block, color via inheritance, spacing) may be offered;
layout-affecting props that won't reach E are refused with a reason. Preflight + single-element +
explicit opt-in (D3). On apply: write under `writeId`, **re-run B1** to confirm E (not the wrapper)
got the intended value; B3 is only the layout-safety guard.

### B3 — Visual-regression guard (runtime ≠ acceptance) · frames-check/ImageMagick family
Runtime product path uses the **in-session** transport (P1-6): SaaS browser screenshot; ext
preview-panel screenshot RPC (right-panel → host → preview-panel → iframe). **Docker e2e pixel diff
is acceptance-test infra only (§6), never the live fallback.** Large diff → rollback `writeId` → AI
repair (explicit) or warning.

---

## 4. Implementation ticket graph (corrected order, P1-9)

```
B0 result-codes + rollback/snapshot transaction  ← FOUNDATION, build first
   └─→ B1 runtime verify (single-write, authoritative)   ← safety net before broadening targets
         └─→ A1 forward-detect facts (read-side first — unblocks the starved D3 ladder)
               ├─→ HYP-706 CSS-miss floor (ONLY behind A1/B1 + reported code)
               ├─→ HYP-704 host-side CSS resolve (exact-only; probable needs B1)
               └─→ HYP-705 cva resolver (+ blast-radius/exact-branch)
                     └─→ B2 wrapper REPAIR (opt-in L3, preflight, re-verify)  ← last, gated
                           └─→ B3 visual-regression guard (runtime) + acceptance harness
HYP-707 Semgrep full rule-id — INDEPENDENT (gate integrity, not style). Do out of band.
```
Rationale: B1 is the authoritative net; it and the rollback contract (B0) must exist *before* HYP-704/
705 broaden write targets, and long before any tree mutation (B2).

---

## 5. Realm transport matrix (P2-2)

| Concern | SaaS-Docker | SaaS-NodePod/OPFS | VS Code ext |
|---|---|---|---|
| A1 LSP/type backstop | server `ts.createProgram` (`getComponentPropsTypes.ts`) | **no server program** → AST-only + DS-allowlist; flag gap | `executeDefinitionProvider` (`PanelRouter.ts:543`) |
| §1b CASCADE-READ (matched-rules) | iframe `document.styleSheets` traversal + matched-rules per realm | same (in-browser pod iframe) | host→preview-panel→iframe matched-rules RPC |
| B1 computed-style read | iframe same-origin `getComputedStylesFromIframe` (`client/lib/dom-utils.ts:38`) | same (in-browser pod iframe) | host→preview-panel→iframe `requestComputedStyle` RPC |
| B1 settle handshake — DUAL | TSX: `import.meta.hot` afterUpdate + render echo · CSS-file: stylesheet/style **epoch** observed (CSS HMR ≠ re-render) | same | TSX: `awaitRecompile` + rendered-version echo · CSS-file: stylesheet-epoch echo (do NOT wait on render echo for CSS-only HMR) |
| B3 screenshot | browser canvas capture | browser canvas capture | preview-panel screenshot RPC (NOT Docker) |
| B0/A2/A3 source write | server FS | OPFS/pod FS | `vscode-file-io` |

NodePod/OPFS is the realm most likely to lose the A1 type backstop — call it out, degrade to
AST-only + heuristic + B1, never block.

**The §1b cascade-read is a distinct primitive from B1's computed-style read** (fable §4): it
traverses `document.styleSheets`, enumerates *matched rules* per element, and resolves declaration
ownership — whereas B1 reads the single resolved computed value. Cross-origin sheets throw on
`cssRules` access (the "foreign sheets" §1b names) — that throw is a fail-closed signal (demote to
ambiguous/report), not an error to swallow. Each realm owns this transport explicitly (row above);
it is NOT a free side-effect of the computed-style read.

---

## 6. Acceptance
- Swallowing `<Button>` (`<button className="fixed"/>`): A1=swallow **at HIGH confidence** (the one
  case where A1 short-circuits — a high-confidence *negative* forwarding fact; see §A1). With no
  forwarded channel, this is a **PRE-WRITE exclusion** — the pipeline reports the terminal
  `NO_WRITABLE_TARGET` / `L3_REQUIRES_OPT_IN` **with `fallbackReason: FORWARDING_GAP`** (B0 two-layer
  contract — distinct counter survives) and **offers** (does not perform) a wrapper repair; it does **NOT** attempt a
  className write and does **NOT** classify `not-landed` (`not-landed` is reserved for a write that
  *was attempted* after inconclusive facts and failed B1 — codex §7). A *low/inconclusive* swallow
  signal does NOT pre-exclude — it writes and lets B1 classify. The className is never silently landed.
  If opted in, B1 re-verifies E got styled and B3 confirms no layout break. All three realms
  (SaaS-Docker, SaaS-NodePod/OPFS, VS Code extension — Docker harness covers the ext realm in CI).
- Forwarding `<Button>`: write lands, B1 verifies via real DOM after a correlated render edge.
- CSS-Module colour: HYP-704 resolves the authored rule on `exact`, writes there (not inline).
- shadcn `cva` colour: HYP-705 edits the exact variant branch, surfaces consumer blast radius.
- Unresolvable selector: HYP-706 reports + (if channel verified) floors to inline — never a dead
  click, never a silent no-op.
- **Value-form false-match:** two distinct candidates that normalize to the same colour
  (`text-blue-500` + `--brand-primary`, or a `twMerge`-deduped duplicate token) → confidence capped at
  `probable`/ambiguous, never auto-written by colour match alone.
- **`probable`+`unverifiable`:** a probable-confidence write whose B1 verdict is `unverifiable`
  (state-variant / remount) → rolled back or surfaced for explicit confirmation, never silently kept.
- **Planner-seam regression test:** all source-forms (elementClass, CSS-var, CSS-Module, descendant,
  cva token, inline) route through `getRequestSourceOwners`/`createSyntheticOwner`, not the Tailwind
  `executor.ts:216` branch.
- **Invariant test:** a value edit never mutates the JSX tree without explicit opt-in.
- Rollback: any failed/large-diff write restores ALL touched files in one undo step.

## 7. Changelog
- **2026-06-12 v11** (codex re-review of v10 — re-confirmed **TICKET-READY / sound**): one-line
  consistency fix so the §B1 component's settle-timeout wording (`warn-only`) matches the §2 pipeline's
  `unverifiable → confidence×verifiability matrix` disposition; no architecture change.
- **2026-06-12 v10** (codex re-review of v9 — verdict **TICKET-READY / sound**, four wording nits
  landed, no architecture change): `none → report/fail-closed` with only A3 performing a gated,
  reported, B1-verified inline floor (no bare inline); B1 `timeout/no-edge` explicitly classified
  `unverifiable` and routed through the confidence×verifiability matrix (closes a "warn-only = silent
  keep" misread); B0 prose now lists `remount-fragile` / `>N-equivalent-definition-sites` alongside the
  surfaceless cases mapped to `NO_WRITABLE_TARGET` (matches the pairing table); §6 swallowing-`<Button>`
  acceptance names all three realms (SaaS-Docker / SaaS-NodePod-OPFS / VS Code ext) not "both realms".
- **2026-06-12 v9** (codex re-review of v8 — one residual table nit, no architecture change): the
  `FORWARDING_GAP` row paired two terminals (`NO_WRITABLE_TARGET` / `L3_REQUIRES_OPT_IN`) while the
  table asserted "exactly one allowed terminal per sidecar" — a self-contradiction. v9 restates the
  contract as "exactly the terminal code(s) in its row" and makes `FORWARDING_GAP` the single
  explicitly-bounded dual-terminal row (L3-offerable → `L3_REQUIRES_OPT_IN`, else `NO_WRITABLE_TARGET`,
  no third option); every other sidecar stays pinned to one terminal. Scrubbed the last stale "D3's
  fallbackReason taxonomy" phrase from the v6 header note.
- **2026-06-12 v8** (codex re-review of v7 — final sidecar-pairing tightening, no architecture
  change): added a B0 table mapping every `fallbackReason` to its single allowed terminal
  `SkipReasonCode` (the four ambiguity/report-only sidecars had no canonical terminal pairing —
  `AMBIGUOUS_VALUE_MATCH`/`CSSOM_ATTRIBUTION_DISAGREE` → `AMBIGUOUS_OWNER`, the rest →
  `NO_WRITABLE_TARGET`); tightened the frozen-plan `reasonCode` field and the pipeline summary to
  `terminal SkipReasonCode + fallbackReason when applicable` so an implementation can't freeze or
  surface the terminal code while dropping the sidecar; marked the stale "D3's fallbackReason
  taxonomy" phrase in the v6 changelog as superseded.
- **2026-06-12 v7** (codex re-review of v6 — residual two-layer-code inconsistencies, no architecture
  change): v6's two-layer contract still funneled locked/expression-backed through
  `NO_WRITABLE_TARGET` AND listed them as terminal codes (a ticket could pick either shape), and it
  claimed D3 §5.3 already had a `fallbackReason` taxonomy (it has only `SkipReasonCode`). v7: each case
  maps to its **most specific existing terminal** code (`LOCKED_COMPONENT` / `EXPRESSION_BACKED_SOURCE`
  / `OWNER_MASKED` / `AMBIGUOUS_OWNER`); `NO_WRITABLE_TARGET` is reserved for genuinely surfaceless
  cases that then carry the `fallbackReason` sidecar; the `fallbackReason` field is declared NEW and
  owned canonically by B0 (not D3); and the A2 pipeline line now routes `probable` only to the frozen
  B0/B1 source trial (never a bare write), matching §1b/§A2.
- **2026-06-12 v6** (codex re-review of v5 — two P1 + one P2 follow-on contract gaps, no architecture
  change): the canonical-code contract introduced in v5 had created its own collapse risk + name
  collisions; v6 makes it **two explicit layers** — a shared terminal `SkipReasonCode` category
  (D3 §5.3, single canonical enum, not forked) plus a per-case `fallbackReason` sub-tag with its own
  `fallback.<reason>` counter — and rewrites §1b/§A1/§6 to emit the terminal category *carrying* the
  sub-tag (`NO_WRITABLE_TARGET` + `FORWARDING_GAP`, etc.) instead of the bare generic code; the new
  members reuse D3's existing terminal names (`EXPRESSION_BACKED_SOURCE`, `LOCKED_COMPONENT` — no
  `EXPRESSION_BACKED`/`LOCKED_OR_READONLY` synonyms) [**superseded by v7**: v6 wrongly placed the new
  sidecar members "in D3's fallbackReason taxonomy"; v7 declares `fallbackReason` a NEW field owned by
  B0 — D3 §5.3 holds only `SkipReasonCode`]; the §5 transport-matrix B1-settle row now states the dual
  settle (TSX render echo vs CSS-file stylesheet epoch) so a transport ticket can't ship
  render-echo-only CSS verify and hang.
- **2026-06-12 v5** (codex re-review of v4 — four new ticket-writer contract gaps, no architecture
  change): spelled out the canonical `WriteResultCode`/`SkipReasonCode` enum + per-code `fallback.<code>`
  counters in B0 (so a ticket can't collapse `FORWARDING_GAP`/`REMOUNT_FRAGILE_AMBIGUITY`/… into a
  single `NO_WRITABLE_TARGET`); defined `exact`+`not-landed` transaction disposition (source write held
  pending under the `writeId`, rolled back on decline/offer-TTL, kept only behind explicit
  keep-unverified confirmation); reconciled A1 "advisory" with pre-write exclusion (only a
  HIGH-confidence *negative* forwarding fact short-circuits; low/medium/inconclusive never blocks and
  never authorizes a floor without B1; the CSS-miss floor requires HIGH-confidence forward or B1);
  split B1 settle into a TSX render echo vs a CSS-file stylesheet/style epoch (CSS HMR doesn't
  re-render E) and exempted the edited property from transition/animation neutralization when it IS
  `transition`/`animation`.
- **2026-06-12 v4** (codex+fable5 re-review of v3 — contract/wording only, no architecture change):
  resolved the §1b↔§2-B1 `unverifiable` contradiction with an explicit **confidence×verifiability
  matrix** (`probable`+`unverifiable` = rollback/confirm, never silently keep — the `?? true` fable
  flagged); value-form normalization is now a **FILTER, never a selector** — quantization-only
  tolerance (8-bit sRGB exact / ΔE < ~0.3, never perceptual 2–3), run **only on cascade-matched**
  candidates, ≥2 distinct matches → cap at `probable`, with alpha/shorthand/Tailwind-v4-`@theme`
  handling; **broadness overrides count** (a lone broad owner still needs blast-radius + confirm);
  the **`0`-case split** (`NO_WRITABLE_TARGET`/`L3_REQUIRES_OPT_IN` for forwarding-gap/locked/foreign/
  forced-colors/expression-backed; verified inline floor only when a forwarded channel exists or B1
  confirms); the `>1 narrow` case named a **B-probable SOURCE trial under B0/B1** (not a runtime/clone
  probe) with the whole ordered list + gates **materialized in the frozen plan** (executor synthesizes
  no new fallbacks post-freeze — resolves §0/P0-2); **read-frame isolation** (lift the pin + neutralize
  transition/animation so B1 verifies the write, not the pin or an in-flight transition); **CSSOM +
  static attribution = exact owner only WHEN THEY AGREE, else fail closed**; a **cascade-read transport
  row** in §5 (distinct primitive; cross-origin `cssRules` throws = fail-closed); explicit v1 routing
  for **remount-fragile / runtime-context** cases (report + dedicated counters, no v1 owner); swallowing
  `<Button>` reclassified as a **pre-write exclusion**, not `not-landed`; planner-seam locked with a
  regression test.
- **2026-06-12 v3** (find-where brainstorm codex+fable5+gemini + Tier-1 reframe + HYP-544 critique):
  added §1b — cascade-READ is the primary resolver (the clone / hidden-iframe pool is demoted to v2,
  used only for residual ambiguity, never the spine); static **attribution engine** with value-form
  normalization (rgb↔hex↔oklch↔token, OKLab/ΔE); **A and B are complementary**, A (runtime experiment)
  is never in the auto-write path ("affects the value" ≠ "safe to edit here"); **B writes, exact-only,
  fail-closed**; seam at the PLANNER (`getRequestSourceOwners`), not `executor.ts:216`; the 3-case
  resolution made safe (optimistic-apply+pinning for >1 narrow, scope-selector for broad, verified
  floor for 0); CDP is diagnostics-only (page JS can't reach it), CSSOM ≠ full getMatchedStyles.
- **2026-06-11 v2** (post codex review): removed auto-wrapper (now opt-in L3, INVARIANT in §0);
  reframed two-axes → phased responsibilities; added B0 rollback/snapshot transaction as foundation;
  HMR settle → correlated render handshake; B3 runtime-transport vs Docker-acceptance split; wrapper
  property-gated + re-verify; value-merged transform table; cva blast-radius; corrected ticket order
  (B0→B1→A1→floor→704/705→wrapper→B3); corrected ladder (deterministic-exact > … > AI-advisory);
  realm transport matrix incl. NodePod/OPFS gap.
