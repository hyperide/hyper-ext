# Plan — CSS-in-JS Full-Edit Support (render + inspect + EDIT, not readonly)

- **Status:** Draft (planning only — no adapter code written yet)
- **Date:** 2026-06-28
- **Owner:** Styles System working group
- **Authoritative spec:** [`docs/specs/2026-06-12-styles-system-master-spec.md`](../specs/2026-06-12-styles-system-master-spec.md) (Rev 0.3, HYP-722, single source of truth; supersedes the 2026-03/2026-04 style plans per its §14.5)
- **Epic:** **HYP-600** "Build Phase 2: All CSS Frameworks" (children HYP-606/607/608/609). Convergence umbrella **HYP-299**. Safety-net + Tier-2: HYP-704/705/706. Render precondition already merged: **PR #541** (HYP-782).
- **Goal (CTO direction):** Make every mainstream CSS-in-JS framework FULLY work — render + inspect + **edit styles in its native paradigm** — and stop degrading them to readonly: **mantine, MUI, Chakra, Ant Design, emotion, styled-components, stitches, vanilla-extract, stylex**.

> This plan does NOT invent a new architecture. It maps the CSS-in-JS edit work onto the master
> spec's ratified targets (OD-5/item-3 "build ALL 12 CssSystemIds", §3.3; the L0–L3 stylability
> ladder §11.2; VTSWR §8–9; the Tier-2 "where in source" framing §12.4 / OD-7; the all-dimensions
> ProjectDetector §5.6) and fills the three concrete gaps the spec leaves open for CSS-in-JS edit:
> (a) the per-framework write-target design, (b) the per-CSS-approach Tier-2 source resolution
> (OD-7, undesigned), (c) the provider-faithful verify substrate (the spec gives
> `runtimeThemeContext` in the reader signature but never says who materializes it).

---

## 0. The corrected direction and what changes

The master spec already RATIFIES full edit support: §3.3's "TO-BE target (RATIFIED, per OD-5/item 3)"
is **all twelve `CssSystemId`s IMPLEMENTED (reader + writer + detection)**, not "4 built, 8
typed-only". So "make CSS-in-JS fully editable" is not a new ask — it is the unbuilt remainder of
HYP-600. Two things this plan corrects relative to today's code and relative to PR #541:

1. **#541 fixed RENDER, not EDIT — and its readonly framing must be reworked toward full support.**
   #541 (HYP-782) added a generic provider-wrap so provider-heavy apps (`MantineProvider`,
   `ThemeProvider`, `NextUIProvider`) paint instead of timing out. That closed the _render_ hole.
   It left every one of these frameworks **readonly in the inspector**. Readonly is correct only as
   an _interim per-system state until that system's adapter lands_ — it is NOT the target. The
   target is L0/L1 native edit. So #541's readonly is a temporary floor, and the writable gate that
   sits on top of it has to be reworked (see §3.2).

2. **The `WRITABLE_CSS_SYSTEMS` gate currently LIES and must become registry-derived.**
   `vscode-extension/hypercanvas-preview/src/types.ts:92` lists
   `['tailwind','cssmodules','styled-components','emotion','tamagui','shadcn','daisyui','sass']` as
   writable, but **emotion and styled-components have no adapter**: an emotion write silently falls
   to the inline-style floor (file pollution), and a styled-components write hits
   `default → unsupported()` in `style-write-executor.ts`. Claiming-writable without an adapter is
   worse than honest readonly — it teaches the editor to write into the wrong channel. The gate must
   be _derived_ from "a real writer + detection + a passing VTSWR conformance fixture exists", never
   a hand-maintained list (all three brainstorm models converged on this independently).

Add the three systems the master taxonomy is missing: **`ant-design` (designSystem),
`stitches` (cssFramework), `stylex` (cssFramework)** are not in the 12-`CssSystemId` union at all.
They get first-class ids; do not shoehorn Ant into "plain-css" or stitches into "emotion" (that
leaks an abstraction the detector cannot honor — Ant is `@ant-design/cssinjs`, its own pair).

---

## 1. Master-spec implementation status (answers "что с реализацией мастер-спеки по кор-редактированию стилей")

### 1.1 Per-subsystem (from master spec §3.15 AS-IS roll-up, verified against code)

| Subsystem                                                                             | Status on `main`                                                                                         | Anchor                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Single-element Tailwind read+write (static+dynamic, format-preserving)                | **WORKS**                                                                                                | `executeTailwindPlan` (HYP-575/544); 41+95+27 tests                                          |
| System-B planner (6-step) + css-modules / inline / tamagui writers                    | **WORKS** (except CSS-file findRule-miss)                                                                | `style-write-planner.ts`; 22 planner + 31 executor tests                                     |
| CSS-file write on `findRule` MISS                                                     | **BROKEN** (hard-fail = dead click)                                                                      | `style-write-executor.ts:348`; HYP-706 fix PLANNED                                           |
| Non-tailwind/tamagui adapters (emotion/styled/mui/chakra/mantine/plain-css/v3/**ve**) | **PLANNED** — typed, never produced; no writer dirs/tests                                                | HYP-606/607/608/600                                                                          |
| VS Code `ElementFacts` (sourceOwners/propMappers/themeCaps)                           | **PARTIAL** — hardcoded empty/`true`                                                                     | `buildElementFacts:704` (`acceptsClassName/Style:true`, `sourceOwners:[]`)                   |
| Color probe Tier-1 ("what drives")                                                    | **WORKS**                                                                                                | `_maybeProbeColorCandidates`; 22 tests                                                       |
| Color probe Tier-2 ("where in source") + per-CSS strategies                           | **PLANNED / UNDESIGNED**                                                                                 | §12.4, OD-7; HYP-704/705/706                                                                 |
| Runtime-verify (did the write land) + rollback transaction (B0/B1)                    | **PLANNED** — `lib/style-write/runtime-verify/` absent; B0 transaction infra partially built but unwired | D19; B0 snapshot/journal `run-style-write-transaction.ts` exists, not wired into 3 callsites |
| A1 forward-detector (real per-channel forwarding facts)                               | **PLANNED**                                                                                              | §9.2a                                                                                        |
| Multi-select style write                                                              | **PLANNED** — #270 branch v1, starved on A1; single-element gate on `main`                               | `RightSidebar.tsx:111`                                                                       |
| System A / System B convergence (delete `ParsedStyles`/`classNameToStyles`)           | **PLANNED**                                                                                              | HYP-299, OD-3                                                                                |
| `stylability-ladder.ts` (L0–L3 resolver)                                              | **STAGED, not on live write path**                                                                       | self-described "NOT yet consulted on the live write path"                                    |

**One-line verdict for the CTO:** the _write spine_ for Tailwind/css-modules/inline/tamagui WORKS;
everything that makes CSS-in-JS editable — the 8 missing adapters, the verify+transaction safety net
(B0/B1), the forward-detector (A1), the per-CSS Tier-2 source resolver, the multi-select
generalization, and the provider-faithful verify substrate — is **PLANNED/UNBUILT**. The master spec
is a ratified design with a 4-of-12 implementation floor.

### 1.2 Per-phase (master spec §14.2 phase map)

Seven sequenced phases (0–6) + one cross-phase track. CSS-in-JS edit is the **cross-phase
"build ALL 12 CssSystemIds" track (HYP-600 umbrella)**, which _rides_ the safety-net phases — it
must not ship an adapter ahead of B0/B1/A1.

| Phase                                         | Capability                                                                                                | Status today                                                    |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| **0 — Hygiene & taxonomy**                    | kill stale facts (D19); `uiKit→designSystem` rename + orthogonal axes (D26); draft B0/B1/A1/B2/B3 tickets | **NOT STARTED**                                                 |
| **1 — Safety net + unified read**             | B0 transaction (snapshot-all, one-undo); SelectionStyleRead normalized-IR read-merge                      | B0 partially built (unwired); read-merge NOT STARTED            |
| **2 — Verify + fallback**                     | B1 verify-everywhere (dual settle); VTSWR; fail-closed matrix; HYP-706 inline floor                       | **NOT STARTED** (B1 absent)                                     |
| **3 — AI ladder + Tier-2 + color UI**         | A1 forward-detector; Tiers 0–5 ladder; host-side Tier-2 CSS resolution; cva resolver                      | **NOT STARTED**                                                 |
| **4 — Multi-select + journal undo**           | `StyleWriteEngine.apply(selection[], patch)`; frozen BatchPlan                                            | #270 branch (starved), NOT on main                              |
| **5 — Wrapper promotion + visual-regression** | B2 opt-in L3; B3 screenshot diff                                                                          | **NOT STARTED**                                                 |
| **6 — AI-vision verification**                | required primary visual judge                                                                             | tickets exist (HYP-734/735/737/739), NOT STARTED                |
| **Cross — build ALL 12 adapters**             | reader+writer+detection for the 8 missing systems                                                         | **4/12 done** (tailwind-v4, css-modules, inline-style, tamagui) |

**Implication for CSS-in-JS:** the adapters cannot be the first thing built. B0 (transaction) and B1
(verify) are the rails. The phase map explicitly resists the temptation to ship the most-asked
features (multi-select, Tier-2 color) on top of garbage facts — "the dependency edges are the
difference between widening the engine and widening the hole." This plan honors that: CSS-in-JS
adapters land **after** the minimal B0/B1 rails exist for the channels they use, but the _cheap
deterministic_ ones (designSystem props, same-file css-prop/sx) can land early because they ride the
existing `ASTUpdatePropsOperation`/inline machinery and need only single-element B1.

---

## 2. Per-framework matrix — render / inspect / edit (today → target)

Detection ids today live in `ProjectDetector.detectCssSystem` (`:443`); the writable gate in
`computeCapabilities` (`:580`) = `WRITABLE_CSS_SYSTEMS.includes(css) && FULL_EDIT_BUNDLERS.includes(type)`.

| Framework                        | Axis                               | RENDER (post #541) | INSPECT (detect + read)                    | EDIT today                                        | EDIT target                        | Target rung / surface                                                          | Source mode                                                                                              |
| -------------------------------- | ---------------------------------- | ------------------ | ------------------------------------------ | ------------------------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| **MUI** (`@mui/material`)        | designSystem (on emotion)          | OK (provider-wrap) | detected `mui`; read via computed          | **readonly**                                      | **native**                         | **L1** `sx={{}}` object-literal; L0 system props on `Box`/`Stack` when present | deterministic (local literal); probe for imported/callback `sx`                                          |
| **Chakra** (`@chakra-ui/react`)  | designSystem                       | OK                 | detected `chakra` (HYP-786 order fix)      | **readonly**                                      | **native**                         | **L0** native style props (`bg`, `color`, `p`, `_hover`)                       | deterministic JSX attr (reuses `ASTUpdatePropsOperation`)                                                |
| **Mantine** (`@mantine/core`)    | designSystem                       | OK                 | detected `mantine`                         | **readonly**                                      | **native**                         | **L0** style props (`c`, `bg`, `p`), then `style`/`styles={{root}}`            | deterministic JSX attr; probe `styles` callbacks                                                         |
| **Ant Design** (`antd`)          | designSystem                       | OK                 | detected `antd` (**not in 12-taxonomy**)   | **readonly**                                      | **partial native**                 | **L1** inline `style`/`className`; semantic props where known                  | deterministic inline; `ConfigProvider.theme.token` = **readonly v1** (needs slot manifest)               |
| **emotion** (`@emotion/react`)   | cssFramework                       | OK                 | detected `emotion`                         | **claims-writable → silently lands inline (BUG)** | **native**                         | **L1** `css` prop object/template; local `styled` def                          | deterministic (same-file object literal); probe for shared const / interpolation                         |
| **styled-components**            | cssFramework                       | OK                 | detected `styled-components`               | **claims-writable → `unsupported()` (BUG)**       | **native**                         | **L1** css-text in `styled`` template def                                      | deterministic (same-file static); probe/readonly for imported/`${p=>p.theme}`                            |
| **stitches** (`@stitches/react`) | cssFramework                       | OK                 | **not detected (no branch)** → readonly    | **readonly**                                      | **native**                         | **L0** variant prop or **L1** `css={{}}` object                                | deterministic local object; theme tokens opt-in                                                          |
| **vanilla-extract**              | cssFramework (compile-time)        | OK                 | detected `vanilla-extract`                 | **readonly**                                      | **conditional native**             | **L1/L2** `style({})` export in `.css.ts`                                      | deterministic-with-recompile ONLY with build manifest (hash→export key) + `bundleSettled`; else readonly |
| **stylex** (`@stylexjs/stylex`)  | cssFramework (compile-time atomic) | OK                 | detected `stylex` (**not in 12-taxonomy**) | **readonly**                                      | **honest readonly v1 + deep-link** | **L2/readonly** `stylex.create({})`                                            | atomic classes not round-trippable without babel manifest; L1 is a telemetry-gated v2 bet                |

Reference rungs (master §11.2): **L0** = native design-system prop; **L1** = generic
className/style/css/sx channel the element forwards; **L2** = partial (only some patched props
expressible); **L3** = no in-place channel → opt-in wrapper-promotion (NEVER automatic).

**Two product rungs the brainstorm adds between readonly and native edit (the spec binarizes
writable/readonly — this is an under-spec flag):**

- **readonly + deep-link to source** — one-click open the exact source AST node (file:line) via the
  already-imported `ModuleSourceMapResolver` + `FiberSourceIndex`. Cheapest lever; turns every
  readonly tail framework from a dead-end into a handoff and is shippable for all 9 immediately.
- **L3 wrapper-promotion with explicit consent** — the general escape hatch for the long tail
  (stylex / imported components / vanilla-extract without manifest): "can't edit in place → offer a
  reviewable refactor that wraps it in a styled element". Separate `TreeMutationPlan` lifecycle
  (§11.3/11.4), never a side effect of a value edit.

---

## 3. Architecture for the gaps (grounded in spec §3.3/§5.5/§5.6/§8/§9/§11/§12.4 + brainstorm)

### 3.1 Adapter contract — extend `FrameworkStyleAdapter` with capability metadata

Keep the spec's unit (`FrameworkStyleAdapter { id; reader?; writer? }`, `style-write/types.ts:285`)
but add declarative capability metadata so the writable gate, the verify-settle signal, and the
probe cost-budget all _derive_ from the adapter instead of from hand-maintained lists:

```ts
interface FrameworkStyleAdapter {
  id: CssSystemId;
  axis: 'cssFramework' | 'designSystem' | 'fallback'; // orthogonal taxonomy (§5.5)
  reader?: FrameworkStyleReader; // → FrameworkReadResult
  writer?: FrameworkStyleWriter; // → StyleWritePlan (no execute)
  verification: 'render-echo' | 'style-epoch' | 'full-rebuild'; // which B1 settle signal (§9.3)
  costClass: 'cheap-static' | 'hmr' | 'rebuild' | 'probe' | 'readonly';
  requiresProviderFaithfulPreview: boolean; // designSystem token reads need real providers
  defaultEditTarget(elementFacts): RungChannel; // L0/L1 surface this adapter prefers
}
```

`WRITABLE_CSS_SYSTEMS` is replaced by a derived predicate: _writable iff `writer` exists AND
detection exists AND a VTSWR conformance fixture passes._ The ext `computeCapabilities` reads that
predicate, not the static array. This kills the emotion/styled-components "lie" structurally.

Adapters **emit ranked `StyleWriteCandidate[]`** (source identity + confidence + blast radius +
required settle signal + rollback inverse); they do NOT execute. B0/B1 owns patch/verify/keep/rollback.

### 3.2 The provider-faithful verify substrate (precondition — the spec's missing piece)

This is the gap the master spec leaves open and the brainstorm flagged as the **#1 systemic failure
mode**. The reader signature carries `runtimeThemeContext`, but on `main` nobody materializes it:
the preview harness renders `<Component {...fallback}/>` in `single`/`multi` mode **without a
provider wrap**, and `theme` is a `Proxy` stub returning `{}`. Consequence for a designSystem token
edit: the patch is correct, but `brand.500` does not resolve (no provider), `computed != intended`,
and **VTSWR rolls back a correct edit** (false-negative). Tailwind works today only because it is
class-based and resolves from the global stylesheet without React context — "works by coincidence of
the dogfood paradigm."

Two builds, v1 takes the pragmatic one:

- **v1 (pragmatic):** _gate token-resolving-property verification to `app`-mode_, where the real
  root + providers mount. `single`/`multi` mode stays "render + inspect + edit class/style channel"
  but is NOT a source of truth for computed token values. The inspector must know its `mode` and
  gate verify accordingly.
- **BLOCKER the brainstorm surfaced:** `appEntrySet` is currently **empty** (`new Set([])`), so
  app-mode always fails in `_AppRouteDriver` — making "verify tokens only in app-mode"
  **non-functional today**. So Phase 0 must EITHER populate `appEntrySet` / reconstruct the real
  provider stack in the substrate (reuse #541's provider detection — `extension-provider-detection.ts`
  already walks the entry's provider chain) OR explicitly mark token-resolving props "unverifiable"
  and degrade to deep-link rather than false-rollback. **This is an open decision (see §7).**

Substrate hardening that gates everything else (brainstorm, all three models):

- **Source-position re-identify, not className.** After a CSS-in-JS patch the DOM hash changes
  (`css-1ab2c3 → css-9zy8x7`, `Card_card__h1 → __h2`). VTSWR's "re-identify element" must key off
  `fiber-source-index` / `element-tracer`, never the class. Audit the re-id pipeline first.
- **Recompile settle handshake.** `retryCount`/`hypercanvas:retryRender` only remounts React — it
  reads stale computed for compile-time systems. Add `postMessage({type:'hypercanvas:bundleSettled',
writeId})` emitted by the dev-server bridge, which MUST precede the verify `getComputedStyle` read
  for `verification:'full-rebuild'` adapters. The `writeId` ties the settle to _this_ write.
- **Harness diet + semantic component filter.** The generator globs non-components
  (`EventEmitter`, `BaseOperation`, `NetworkError`) into the registry; verify must select only real
  components. Remove the `picsum.photos` external dep (breaks air-gapped / enterprise — the Ant
  audience). Lazy per-component imports so probe iframes are cheap.

### 3.3 The edit-write path (per rung)

- **L0 designSystem props (Chakra / Mantine / MUI system props):** deterministic — a JSX attribute
  edit on the already-traced fiber element, reusing `ASTUpdatePropsOperation` / `updateProps`. No
  CSS channel, no Tier-2 probe. Cheapest and safest; build first.
- **L1 css/sx object on usage-site (MUI sx / emotion css / stitches css):** deterministic AST
  object-literal mutation when local; route through the Tier-2 B resolver when the `css`/`sx` is a
  shared const or imported.
- **L1 styled`` template (styled-components / emotion styled):** mutate the template-literal CSS in
  the same-file definition, preserving `${}` interpolations (reuse the spec's
  `template-literal-css-mutator`). Imported or interpolation-dynamic defs → probe or readonly+deep-link.
- **L1/L2 compile-time (vanilla-extract `style({})`):** mutate the export in `.css.ts`, then await
  `bundleSettled` before verify. Requires the hash→source-key manifest (§3.4).
- **L2/readonly (stylex):** honest readonly v1 + deep-link; L1 only behind a babel-plugin manifest
  and a telemetry-gated decision.

### 3.4 Tier-2 "where in source" for CSS-in-JS (OD-7, undesigned) — build B before A

The hard problem for runtime CSS-in-JS: the DOM class is an opaque hash, so "where in source" cannot
be read off the element. Master §12.4 frames the algorithm (enumerate source-AST candidates incl.
`rgb()↔#hash↔token↔atomic-class` transforms → patch each in an invisible duplicate → prove which
flips computed → write there) and recommends **B (ext-side AST/sourcemap/manifest resolver) before
A (browser probe)**. Per-approach strategies (OD-7) this plan must design:

- **emotion / styled-components / stitches (runtime hash):** map element → fiber → the `css`/`styled`
  call-site AST node; sourcemap from the emitted stylesheet rule back to the source template/object.
- **vanilla-extract / stylex (compile-time atomic):** sourcemaps are **insufficient** — they give the
  file, not the object key. Require a **build-time manifest** (vanilla-extract `identifiers:'debug'`
  or a plugin manifest; stylex babel-plugin manifest) mapping runtime class/hash → `(file, exportName,
objectKeyPath)`. Without the manifest → readonly.
- **theme tokens (mantine/MUI/Chakra/Ant/stitches):** when a value resolves to a token, default to
  the **local override** (smallest blast radius); editing the token DEFINITION is a separate explicit
  mode with a blast-radius preview ("used by N components"). Generalize OD-6 binding-kind (same-file
  const vs imported vs prop-from-parent vs provider theme vs CSS var vs runtime callback) to JS theme
  objects; classify by where the binding RESOLVES, not by call-site syntax.

**Cost discipline (brainstorm):** the hidden-iframe probe is a _last-resort_ resolver, never the
normal path — on the fat preview bundle, `candidates × properties × iframes × rebuilds` is a local
DoS. Source-index / manifest first; probe with concurrency cap + debounce + cancellation only when
source ownership is genuinely ambiguous.

### 3.5 The second verify oracle — idiom-correctness (under-spec flag)

`computed(property) == intended` is necessary but NOT sufficient. Injecting a `css` prop into a
styled-components project, or `style={{}}` into a Chakra app, passes VTSWR but produces a diff a
reviewer rejects — a foreign styling paradigm in the file. Add an **idiom-correctness check**: does
the write match the file's authored paradigm? When the only rendering write is non-idiomatic, prefer
**honest readonly + deep-link** over a foreign L1 injection. Whether this is a formal VTSWR gate or a
deep-link trigger is an open question (§7); the plan treats it as a candidate-ranking penalty for
v1.

### 3.6 Detection (§5.6) — pair-aware, evidence-returning, user-correctable

Extend the existing `ProjectDetector` (do NOT stand up a second detector). It must return the
COMPLETE set of `(cssFramework, designSystem)` in use with **per-system evidence**, distinguishing
**direct authoring from transitive deps** (MUI pulls emotion; Ant pulls `@ant-design/cssinjs` — that
does not mean the user authored emotion/cssinjs). Hybrid: static (package.json + import scan) +
runtime (fiber-type / framework globals introspection in the preview). Detect designSystem first,
then its underlying cssFramework (the HYP-786/787 chakra-before-emotion ordering bug is the symptom).
Because transitive-dep pair-detection cannot be 100%, **surface the detection result in the UI and
let the user correct it** ("HyperIDE detected MUI + emotion. Not right? [change]") — turns a fragile
heuristic into a confirmable setting.

---

## 4. Phased implementation plan (ordered work items for a swarm)

Each item is sized for one subagent + a PR. Items within a phase that touch disjoint files
parallelize; cross-phase order is the dependency spine. Map to HYP tickets in §6.

> **Cross-cutting requirement (CTO directive, master spec §0.3) — applies to EVERY work item that
> writes `lib/` code.** New code ships with a **spec-linked doc comment on every function**: (a) cite
> the relevant master-spec section + a short excerpt, and (b) explain the user-facing impact. For
> reader/writer adapters and the style pipeline this is mandatory; for **mapping** functions
> (inspector↔target value, `CssSystemId`→`sourceForm`, computed↔source-owner, rung→channel, token↔hex,
> className↔CSS) the comment ALSO names which **ownership domains collide** (realms §5.4 / cssFramework
> vs designSystem §5.5 / System A vs System B §5.3 / rungs L0–L3 §11.2 / confidence×verifiability §9.4)
> and WHY the mapping resolves that way. **AST functions additionally** (in `lib/ast`, `lib/style-write`,
> `lib/tailwind/parser`, `lib/services/component-parser`, `lib/services/tree-adapter`, and any AST
> read/write/generate site) carry, AT THE SITE of each check/read/generation, an inline **visual
> example** — an ASCII sketch of the node shape + the source snippet it maps to (before→after for a
> transform), e.g. `JSXExpressionContainer > CallExpression(.map) > ArrowFunction > JSXElement` ↔
> `{items.map(i => <Item/>)}`. This is a **review-gate item** on every adapter PR — a `lib/`
> style function without the spec citation + user-impact note (and, for AST sites, the visual example)
> is incomplete. See work item **G1** for the retroactive pass over existing code.

### Phase A — Hygiene, taxonomy, honest gate (no new adapters; unblocks everything)

- **A1.** Add `ant-design`, `stitches`, `stylex` to the `CssSystemId` union + the orthogonal-axis
  model (`axis: cssFramework|designSystem`); rename `uiKit→designSystem` behind an alias (D26). _(master §5.5; HYP-299/Phase-0)_
- **A2.** Replace `WRITABLE_CSS_SYSTEMS` with a registry-derived predicate (writer + detection +
  conformance-fixture present). Remove emotion/styled-components from "writable" until their adapters
  land. Add the adapter capability-metadata fields (§3.1). _(closes the #541 readonly-framing rework)_
- **A3.** Extend `ProjectDetector` to all-12 + the 3 new ids, pair-aware with evidence + direct-vs-
  transitive; add a `stitches` detection branch; reconcile per-element `getCssSystems` (D5). Surface
  - make user-correctable. _(master §5.6; HYP-786/787)_
- **A4.** Ship the **deep-link-to-source** rung (readonly + one-click open exact AST node via
  `ModuleSourceMapResolver`/`FiberSourceIndex`) + a per-framework **support-matrix UI** (native /
  deep-link / defer). This makes honest-readonly shippable for all 9 immediately.
- **A5.** **Structural consolidation — one home under `lib/style-adapters/` (see §10).** Establish the
  single css-system home, migrate `lib/tailwind/` + `lib/tamagui/` into it (careful import migration,
  not a blind `mv`), dedupe the duplicate client tailwind parser (D37), and make it the mandatory
  landing zone for the 9 new writers. _(master OD-3 / §5.3 convergence; D23/D37; §3.3)_

### Phase B — Substrate + minimal safety net (precondition for any verified edit)

- **B1.** Harden the verify substrate: source-position re-identify (audit + fix any className-keyed
  re-id), harness diet (semantic component filter, drop `picsum`, lazy imports), `targetOrigin`/
  nonce on the VTSWR `postMessage` channel. _(master §9; brainstorm security pass)_
- **B2.** Provider-faithful verify: reconstruct the project provider stack in the substrate (reuse
  #541 `extension-provider-detection.ts`) and/or gate token-prop verify to app-mode + populate
  `appEntrySet`. Resolve the open decision in §7 first. _(spec §9.2 + the `runtimeThemeContext` hole)_
- **B3.** Wire the **B0 transaction** (snapshot-all-touched + one-undo journal — infra exists in
  `run-style-write-transaction.ts`, unwired) into the 3 write callsites. _(master §9.1; HYP-544 §4)_
- **B4.** Build **B1 verify-everywhere** for single-element: dual settle signal (render-echo for TSX,
  style-epoch for CSS, `bundleSettled+writeId` for compile-time), fail-closed (`?? false`) matrix.
  _(master §9.2–9.4)_

### Phase C — Cheap deterministic adapters (quick wins, ride existing rails)

- **C1.** **Chakra** + **Mantine** L0 native-prop reader+writer (reuse `ASTUpdatePropsOperation`). _(HYP-606)_
- **C2.** **MUI** `sx={{}}` L1 object-literal reader+writer; L0 system props on `Box`/`Stack` when present. _(HYP-606)_
- **C3.** **emotion** `css` prop (object + template, same-file) reader+writer — replaces the silent-inline path. _(HYP-606)_
- **C4.** **stitches** `css={{}}` / variant-prop reader+writer (local object). _(new id, HYP-606-sibling)_
- **C5.** **styled-components** same-file static `styled`` template reader+writer (preserve interpolations). _(HYP-606)_
- Each Cn ships with a VTSWR conformance fixture; the registry gate (A2) flips that system writable only when its fixture is green.

### Phase D — Tier-2 host resolver + imported/dynamic + theme tokens

- **D1.** Build the **ext-side Tier-2 B resolver** (computed → fiber → source AST node; sourcemap from
  emitted rule → source template/object) for emotion/styled/stitches imported & shared-const cases.
  _(master §12.4; HYP-704; OD-7)_
- **D2.** **A1 forward-detector** (real per-channel forwarding facts) replacing the hardcoded
  `acceptsClassName:true` — the planner stops picking targets that cannot land. _(master §9.2a; HYP-704)_
- **D3.** Theme-token edit mode: local-override default + explicit "edit token definition" with
  blast-radius preview; OD-6 binding-kind classification for JS theme objects. _(HYP-686; OD-6)_
- **D4.** **Ant Design** L1 inline `style`/`className` + slot manifest for `styles`/`classNames`;
  `ConfigProvider.theme.token` explicit-only. _(new id; HYP-606-sibling)_

### Phase E — Compile-time + long tail (manifest-gated)

- **E1.** Build-time hash→source-key **manifest** integration (vanilla-extract `identifiers:'debug'` /
  plugin; stylex babel-plugin manifest). _(master §12.4; OD-7)_
- **E2.** **vanilla-extract** `style({})` reader+writer with `bundleSettled` recompile-settle + manifest
  mapping; readonly when no manifest. _(HYP-607-sibling)_
- **E3.** **stylex** — keep readonly v1 + deep-link; build L1 only behind the manifest, gated on real
  client-demand telemetry (do not block "all-12 done" on stylex L1). _(new id; telemetry-gated)_
- **E4.** **L3 wrapper-promotion with consent** as the general tail escape hatch (separate
  `TreeMutationPlan`, opt-in, separately undoable). _(master §11.4; HYP-660)_

### Phase F — Multi-select + acceptance gate

- **F1.** Generalize to N-element via the frozen `BatchPlan` (single = `length===1`) once A1 + B0
  exist; per-element rung resolution + skip-banner. _(master §11; HYP-271/596/664)_
- **F2.** Close the acceptance-gate test debt (D30–D38): per-adapter unit read+write tests, idiom +
  computed round-trip e2e de-skip-guarded across CSS systems, multi-select batch tests. _(master §14.4)_

### Phase G — Spec-linked documentation pass over existing `lib/` (CTO directive, master §0.3)

- **G1.** Retroactively add the spec-linked doc comment (cite-section + user-impact; mappings +
  ownership-collision rationale) to **existing** `lib/` style code, **style pipeline FIRST**:
  `lib/style-adapters/{<system>}/{reader,writer}`, `lib/style-read/`, `lib/style-write/`,
  `lib/style-values/`, the canonical `lib/tailwind` parser/generator, `lib/tamagui`, and every mapping
  function (planner `defaultSourceFormForSystem`, the `sourceForm`/rung→channel maps, the
  className↔CSS and token↔hex converters). **AST sites get the inline visual example** (ASCII node
  shape + source snippet, before→after for transforms) at each check/read/generate point —
  `lib/ast`, `lib/tailwind/parser`, `lib/services/component-parser`, `lib/services/tree-adapter`, and
  the AST mutators in `lib/style-write`. Sequenced in the program **after the authoritative matrix
  run**, executed in **worktrees**, **reviewed** (each chunk its own PR). This is documentation-only —
  no behavior change — and pairs with §10 (the consolidation moves the code; G1 documents it in its
  new home so the two land coherently). _(master §0.3; couples to §10 / HYP-299)_

---

## 5. Test / proof strategy

- **VTSWR conformance fixture per adapter (the writable gate input).** For each framework: select a
  fixture element → edit a property → assert the write landed in the framework's native paradigm
  (idiom check) AND `computed(property) == intended` after settle AND a no-op rollback restores the
  exact bytes. A system is `writable` only when its fixture is green (A2). This is the mechanical
  truth behind "readonly until adapter lands."
- **Unit:** reader (element+facts → source owners), writer (canonical value + owner → `StyleWritePlan`),
  Tier-2 resolver (candidate enumeration + winner selection), detector (pair + direct-vs-transitive).
- **e2e:** extend `tests/unsupported-project/unsupported-css-smoke.spec.ts` from "renders + readonly
  stub" to "renders + edits land" per framework as each adapter ships; de-skip-guard the opacity /
  color round-trip (D35) and the pseudo/responsive write (D33) across CSS systems.
- **Proof discipline (mandatory):** every "X is now editable" claim needs a Playwright/Docker capture
  of the edit landing in source + the preview reflecting it (per the repo's visual-proof rule), never
  a green unit test alone. Compile-time systems must prove the `bundleSettled` settle, not a remount.
- **Idiom oracle:** assert the produced diff uses the file's authored paradigm (no `css` prop injected
  into a `styled` file, no `style={{}}` into a Chakra file).

---

## 6. Ticket map

- **Epic (exists — reference, do not recreate):** **HYP-600** "Build Phase 2: All CSS Frameworks".
- **Children (exist):** HYP-606 (CSS-in-JS adapters: emotion/styled/system-prop), HYP-607
  (CSS-modules + plain-css), HYP-608 (Tailwind v4 + composite routing), HYP-609 (source-tabs/ownership UI).
- **New child tickets to file** (under HYP-600; orchestrator/CTO to create — gated for subagents):
  - "Add ant-design/stitches/stylex CssSystemIds + orthogonal axis model + registry-derived writable gate" (Phase A1/A2).
  - "Provider-faithful verify substrate + source-position re-identify + bundleSettled handshake" (Phase B1/B2) — the spec's `runtimeThemeContext` hole; depends on resolving §7.
  - "Deep-link-to-source rung + per-framework support-matrix UI" (Phase A4).
  - "stitches adapter", "ant-design adapter + slot manifest", "vanilla-extract adapter + manifest", "stylex deep-link (L1 telemetry-gated)".
- **Cross-references:** HYP-299 (convergence/delete System A), HYP-704/705/706 (Tier-2 + findRule-miss
  floor), HYP-660 (L3 wrapper), HYP-786/787 (detector ordering), HYP-782 / PR #541 (render precondition).

---

## 7. Open decisions to escalate (do not silently pick)

1. **Provider materialization in the verify substrate (the blocker).** App-mode-only token verify is
   non-functional today because `appEntrySet` is empty. Pick one: (a) populate `appEntrySet` /
   reconstruct the real provider stack in single/multi mode (reuse #541 detection); (b) mark
   token-resolving props "unverifiable" and degrade to deep-link instead of false-rollback. (a) is
   correct long-term but heavier; (b) ships sooner. → feeds Phase B2. _(spec under-specifies who
   materializes `runtimeThemeContext`.)_
2. **OD-7 — per-CSS-approach Tier-2 design into Phase 3 (priority-ratification, yes/no).** Master
   recommendation: YES, after B0/B1. Without it Tier-2 works only for Tailwind.
3. **Idiom-correctness oracle: formal VTSWR gate vs deep-link trigger vs ranking penalty.** v1 default
   here = ranking penalty + deep-link fallback; confirm.
4. **"Build all 12" vs market-weighted commitment.** The brainstorm's product view: stitches is in
   maintenance and stylex is ~Meta-internal; spending the most expensive engineering (atomic manifest
   - probe) on them is roadmap-smell. Recommendation: deliver native edit for the high-coverage tier
     (MUI ≫ styled/emotion ≫ Chakra/Mantine ≫ Ant), ship honest readonly+deep-link for the tail, and
     gate stylex/stitches _writers_ on real client-demand telemetry — while still counting "inspect +
     deep-link for all 9" as the shippable v1. This is a deliberate softening of OD-5/item-3's literal
     "all twelve writers"; CTO to confirm whether the ratified target stands as-is or accepts the
     coverage-tiered reading.

---

## 8. Whether #541's readonly framing needs rework — yes

#541 (HYP-782) is a **render** fix and must stay. Its readonly OUTCOME for these frameworks is an
interim, not the target. The rework is concrete and lives in Phase A: (1) the writable gate becomes
registry-derived so a system is readonly _only until its adapter+fixture exist_, not by a frozen list;
(2) the emotion/styled-components "claims-writable-but-no-adapter" bug is fixed (they go honestly
readonly, then become writable when C3/C5 land); (3) readonly stops being a dead-end — the deep-link
rung (A4) gives every readonly framework a one-click handoff to source. Net: #541's provider-wrap is
the render floor the full-edit ladder is built on top of, and "readonly" is reframed from a product
verdict into a per-system build state.

---

## 9. Support-dimension coverage — make "gracefully-unsupported" first-class AND tested

The master spec's capability taxonomy (§5.5) is **six orthogonal axes**: `cssFramework`,
`designSystem`, `jsFramework`, `router`, `bundler`, `packageManager`. The §5.6 ProjectDetector must
report the value of EVERY axis independently. "Support" is a per-axis-value property, and it cuts
both ways:

1. **Supported axis values become fully editable** (the body of this plan): the cssFramework values
   emotion / styled-components / vanilla-extract / **stylex** / **pandacss** / **unocss** and the
   designSystem values mui / chakra / mantine / tamagui / **fluentui** / **nextui** / ant. (pandacss
   & unocss are utility/atomic-CSS cssFrameworks already present as fixtures — they fold into the
   className/atomic edit path, not a CSS-in-JS object path; fluentui & nextui are designSystems on
   emotion-like runtimes, same L0/L1 treatment as mui/chakra.)
2. **Genuinely-unsupported axis values must STAY supported as "gracefully-unsupported" — detected,
   honestly shown, never crashing — and that behavior must be TESTED.** The honest boundary is the
   `jsFramework` axis: the selection/preview engine is **React-fiber based**, so it fundamentally
   cannot component-edit **vue / svelte / solidjs / angular / unknown (jQuery, plain HTML)**. That is
   a real limit, not a bug to fix. The product duty for these is: detect the dimension correctly
   (§5.6), show the correct unsupported/partial state, and not crash.

### 9.1 The coverage-evaporation gap (must be called out)

Today the e2e `unsup:` bucket is `UNSUPPORTED_PROJECTS` in `e2e/playwright.config.ts:50` — **12
fixtures, ALL React + CSS-in-JS/atomic** (stylex, vanilla-extract, pandacss, unocss, mui, fluentui,
antd, chakra, mantine, nextui, remix-mui, remix-antd). There are **ZERO non-React-jsFramework
fixtures in any lane.** The sample dirs `vue-sample`, `svelte-sample`, `solidjs-sample`,
`html-sample`, `jquery-sample` exist on disk in `ext-test-projects` but are **wired into no
Playwright project** (only referenced in a `Dockerfile.e2e` lockfile comment) — orphan fixtures.

So as the CSS-in-JS fixtures flip from "unsupported readonly" to "supported editable", the
`unsupported` test bucket **empties out** unless it is repopulated with the genuinely-unsupported
dimensions. The non-React boundary would then be entirely untested — a silent coverage hole exactly
where a regression (a crash on a vue/svelte project) is most embarrassing.

### 9.2 Per-dimension test-project matrix (EXISTS vs MUST-CREATE)

For each axis × representative value, a fixture and the assertion lane it belongs to. `E` = exists in
`ext-test-projects`, `C` = must be created, `O` = exists on disk but orphaned (not in any lane).

| Axis                               | Value                           | Fixture                                                           | State            | Lane / assertion                                          |
| ---------------------------------- | ------------------------------- | ----------------------------------------------------------------- | ---------------- | --------------------------------------------------------- |
| **cssFramework**                   | tailwind                        | `react-vite-*-tw4-*` / dogfood                                    | E                | `dep:` — editable (baseline)                              |
|                                    | css-modules                     | `react-vite-emotion-cssmodules-calendar`                          | E                | `dep:` — editable                                         |
|                                    | emotion                         | `react-vite-emotion-dashboard`, `webpack-react-emotion-dashboard` | E (now `unsup:`) | **flip → `dep:` editable** once C3 lands                  |
|                                    | styled-components               | `react-vite-styled-shopify`, `react-vite-styled-tw4-drive`        | E                | **flip → editable** once C5 lands                         |
|                                    | vanilla-extract                 | `react-vite-vanilla-extract-reddit`                               | E                | flip → editable (manifest) / else readonly+deep-link      |
|                                    | stylex                          | `react-vite-stylex-chat`                                          | E                | readonly+deep-link v1 (assert deep-link, not crash)       |
|                                    | pandacss                        | `react-vite-pandacss-weather`                                     | E                | editable via atomic/className path                        |
|                                    | unocss                          | `react-vite-unocss-github`                                        | E                | editable via atomic/className path                        |
|                                    | stitches                        | `react-vite-stitches-*`                                           | **C**            | editable once C4 lands                                    |
| **designSystem**                   | mui                             | `react-vite-mui-gmail`, `remix-mui-gmail`                         | E                | **flip → editable** (C2)                                  |
|                                    | chakra                          | `react-vite-chakra-airbnb`                                        | E                | **flip → editable** (C1)                                  |
|                                    | mantine                         | `react-vite-mantine-discord`                                      | E                | **flip → editable** (C1)                                  |
|                                    | ant-design                      | `react-vite-antd-jira`, `remix-antd-jira`                         | E                | partial-editable (D4) / token readonly                    |
|                                    | tamagui                         | `*-tamagui-*`                                                     | E                | editable (baseline)                                       |
|                                    | fluentui                        | `react-vite-fluentui-outlook`                                     | E                | editable (L0/L1, mui-like)                                |
|                                    | nextui                          | `react-vite-nextui-netflix`                                       | E                | editable (L0/L1, mui-like)                                |
| **jsFramework (unsupported edge)** | vue                             | `vue-sample`                                                      | **O → wire**     | **NEW `unsup-fw:` lane — graceful-unsupported**           |
|                                    | svelte                          | `svelte-sample`                                                   | **O → wire**     | NEW `unsup-fw:` — graceful-unsupported                    |
|                                    | solidjs                         | `solidjs-sample`                                                  | **O → wire**     | NEW `unsup-fw:` — graceful-unsupported                    |
|                                    | angular                         | `angular-sample`                                                  | **C**            | NEW `unsup-fw:` — graceful-unsupported                    |
|                                    | unknown (jQuery)                | `jquery-sample`                                                   | **O → wire**     | NEW `unsup-fw:` — graceful-unsupported                    |
|                                    | unknown (plain HTML)            | `html-sample`                                                     | **O → wire**     | NEW `unsup-fw:` — graceful-unsupported                    |
| **bundler**                        | vite / webpack / remix / nextjs | covered transitively by the above                                 | E (nextjs thin)  | `dep:`/`mono:` detection asserts bundler axis             |
| **packageManager**                 | bun / npm / pnpm / yarn         | lockfile-driven (§5.6 / OD-5)                                     | E                | detection unit asserts lockfile→pm axis (not ProjectType) |

### 9.3 Expected graceful behavior per unsupported `jsFramework` (and the two screens)

The product already has two distinct honest states — keep the distinction, route by axis:

- **`UnsupportedProjectScreen`** (`types.ts:33` `UnsupportedProjectError`; tested by
  `unsupported-project.spec.ts`, HYP-342) — a blocking "can't operate here" screen. Today used for
  react-native / tamagui-without-rnw.
- **`ReadonlyStubScreen`** (`TID.preview.readonlyStub` + readonly badge + "Continue in Readonly";
  tested by `unsupported-css-smoke.spec.ts`, HYP-782) — preview renders, inspector is readonly.

Routing the unsupported `jsFramework` axis:

- **React-fiber-incompatible frameworks (vue / svelte / solidjs / angular / jQuery / plain HTML):**
  detect `jsFramework` ≠ react → show **`UnsupportedProjectScreen`** with a framework-specific
  message ("HyperIDE's visual editor supports React projects; detected Vue"), OR a **preview-only
  partial** state (render the dev-server URL in an iframe with NO fiber selection / NO inspector) —
  this partial-vs-blocking choice is a product decision (§7). Hard requirement either way: **detect
  correctly + show the honest state + do not crash, hang, or fall through to a React-only code path**
  (no fiber walk on a non-React DOM, no `__canvas_preview__` React harness mount).
- **Acceptance:** each `unsup-fw:` fixture asserts (a) the detector reports the right `jsFramework`
  value with evidence, (b) the correct screen/partial appears within the render budget (no 360–840s
  timeout like the HYP-782 class), (c) no uncaught error in the extension host or webview, (d) the
  app is NOT mis-detected as a supported React project.

### 9.4 Lane restructuring (e2e)

- **Flip the CSS-in-JS lanes from "assert readonly" to "assert editability"** as each adapter lands:
  the `unsup:` entries for emotion/styled/mui/chakra/mantine/fluentui/nextui/pandacss/unocss migrate
  out of `UNSUPPORTED_PROJECTS` into `SUPPORTED_PROJECTS` (`dep:` lane) and their
  `unsupported-css-smoke` assertion (readonly stub present) is replaced by an editability assertion
  (edit lands + idiom + computed round-trip per §5). Gate each flip on that system's green VTSWR
  conformance fixture (§3.1 / A2) so a lane never flips ahead of the adapter.
- **Add a new `unsup-fw:` Playwright project group** (`testDir: ./tests/unsupported-project`, a new
  `unsupported-framework-smoke.spec.ts`) driven by a `UNSUPPORTED_FRAMEWORKS` list
  (`vue-sample`/`svelte-sample`/`solidjs-sample`/`angular-sample`/`jquery-sample`/`html-sample`),
  asserting the §9.3 graceful behavior. This **repopulates the unsupported bucket** with genuinely-
  unsupported dimensions so coverage does not evaporate.
- **Keep `unsup:` for the still-genuinely-unsupported CSS edge** (stylex / vanilla-extract-without-
  manifest) asserting readonly+deep-link, until/unless their writers land.

### 9.5 Detection grounding (§5.6)

All of the above depends on the ProjectDetector reporting the `jsFramework` axis correctly. **Extend
the existing `vscode-extension/hypercanvas-preview/src/services/ProjectDetector.ts`** (`detectProjectType`
already exists) to report `jsFramework ∈ {react-vanilla, nextjs, remix, vue, svelte, solidjs, angular,
unknown}` as a first-class axis value with evidence — **do NOT build a parallel detector** (the spec
is explicit). The non-React detection signal (vue/svelte/solid/angular deps + entry/config
signatures; jQuery/plain-HTML = no framework) is the input that routes to the graceful-unsupported
screen. This is work-item **A3** extended: detection must cover not just all-12 cssFramework/
designSystem values but the full `jsFramework` axis including its unsupported edge.

### 9.6 New tickets for this scope

Under HYP-600 (or a sibling test-coverage epic; orchestrator/CTO to file):

- "Wire orphan non-React fixtures (vue/svelte/solidjs/jquery/html-sample) + create angular-sample into
  a new `unsup-fw:` lane asserting graceful-unsupported (detect + honest screen + no crash)."
- "Extend ProjectDetector to report the full `jsFramework` axis (incl. vue/svelte/solid/angular/unknown)
  with evidence; route non-React → UnsupportedProjectScreen/preview-only partial" (A3-extended).
- "Flip CSS-in-JS `unsup:` lanes to `dep:` editability lanes per adapter as each conformance fixture
  greens" (couples to Phase C/D/E).

---

## 10. Structural consolidation — one home for css-system code (CTO directive, master OD-3 / §5.3)

The CTO flagged the current `lib/` layout as structurally wrong, and it maps exactly onto the
convergence the master spec already ratified (OD-3 §5.3 "System A and System B become one", and the
D23/D37 dedupe). This is a **planning item only** — no code moves yet (the repo is mid-run on the
authoritative matrix); it is sequenced into the convergence track (Phase A5, alongside HYP-299), and
it is a **careful import migration, not a blind `mv`**.

### 10.1 The current placement (verified on `main`)

- `lib/style-adapters/` holds **only 4** css-system adapters — `css-modules/`, `inline-style/`,
  `tailwind-v4/`, `tamagui/` (the 4-of-12 floor, §3.3). The 9 new writers (emotion,
  styled-components, stitches, mui-system, chakra-ui, mantine, vanilla-extract, ant-design, +
  stylex-as-readonly) are not yet built.
- `lib/tailwind/` (the canonical className↔CSS converter — `parser.ts` + `generator.ts`, **95
  parser tests**) and `lib/tamagui/` (shared token/value logic, used ext↔SaaS) sit at **`lib/`
  top-level**, as siblings of `lib/style-adapters/` rather than inside it — even though
  `lib/style-adapters/tailwind-v4` and `lib/style-adapters/tamagui` are thin consumers of them.
- `lib/tailwind/` is imported by many sites across realms (ext `PanelRouter`, the MCP color-token
  path, client color-utils, `lib/tokens`, `lib/style-write/style-write-executor`, and
  `style-adapters/tailwind-v4` itself) — a 7+-call-site, ext+client+server+mcp surface.
- The duplicate **client** tailwind parser `client/lib/canvas-engine/utils/tailwindParser.ts`
  (2 tests) shadows the canonical `lib/tailwind/parser.ts` (95 tests) — this is **D37**, the parser
  pair underneath the System-A/System-B converter pair (D23).

**These are NOT literal duplicates of the thin adapters** — `lib/tailwind/`/`lib/tamagui/` are the
shared _converter/token_ layer, the thin adapters are the _reader/writer_ layer on top. The problem
is **placement + fragmentation**, the same System-A/System-B split OD-3 exists to collapse.

### 10.2 The target — one consistent css-system home

- Establish a single home for all css-system-specific code under the **`lib/style-adapters/`
  namespace** (e.g. a shared sub-home such as `lib/style-adapters/_shared/{tailwind,tamagui}/` — exact
  sub-path is an implementation detail; the invariant is "one home, under style-adapters, not
  scattered top-level `lib/` siblings").
- **Migrate `lib/tailwind/` and `lib/tamagui/` into that home** via a **careful import migration**
  across all 7+ call sites (ext + client + server + mcp), updating every importer in lockstep —
  **never a blind `mv`**, and **preserve the canonical parser as the single source** (do not fork it;
  the 95-test `parser.ts` stays authoritative).
- **Dedupe the duplicate client tailwind parser (D37):** delete
  `client/lib/canvas-engine/utils/tailwindParser.ts` and route the client through the one canonical
  parser, so there is one converter with one test surface. This is the System-A→System-B convergence
  for the parser layer (OD-3; ratified DELETE, not `@deprecated`).
- **Mandate the landing zone:** every one of the 9 new writers (Phases C/D/E) lands **under**
  `lib/style-adapters/<system>/` in this one home — the plan's Phase C/D/E items are amended so no new
  adapter is created as a top-level `lib/` sibling.

### 10.3 Sequencing & risk

- Runs in the convergence track (Phase A5) **alongside / under HYP-299**, before the bulk of the 9
  writers land, so they are authored directly into the consolidated home rather than migrated later.
- The import migration is the risk, not the move: a 7+-call-site, 4-realm surface. Do it as its own
  reviewed PR with the full test matrix green (the 95 parser tests + the consumers), **decoupled
  from** any behavior change — pure relocation + import rewrite, verified by an unchanged test suite.
- Cross-references: master OD-3, §5.3 (convergence target — System B `lib/` is canonical; System A
  styling code + duplicate converter DELETED), D23 (converter pair), D37 (parser pair), §3.3 (the
  4-of-12 adapter home). Ticket: under **HYP-299** (convergence umbrella, In Progress).
