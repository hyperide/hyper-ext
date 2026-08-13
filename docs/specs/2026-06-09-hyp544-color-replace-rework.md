> **⚠️ SUPERSEDED** by the [2026-06-12 Styles System Master Spec](./2026-06-12-styles-system-master-spec.md) (see Part/§ 3.8, 3.12, 12.3–12.4). Retained for history; do not follow for new work.

# HYP-544 — Color-replace rework: binding-kind classifier, not blanket twMerge

**Status:** Phase 1 IMPLEMENTED + Phase 2 IMPLEMENTED + Phase 3 Tier 1 IMPLEMENTED (`HYP-544-color-dom-anchor`, rebased onto main + HYP-575); probe Tiers 2/3 design only. Supersedes the same-file-const branch of PR #381.

> **Phase 3 (Tier 1) implementation note (2026-06-10):** the empirical color-probe is built and wired
> end-to-end — RPC `hypercanvas:probeColorCandidates` (mirrors `requestLiveClassName`), candidate
> detection + Tier-1 off-screen-clone verification in `iframe-color-probe.ts`, PanelRouter eager-thread
> on a live same-group conflict, and an inline-style-override redirect for an inline/var/module driver
> (a twMerge wrap is a no-op for those — that's the whole point of the probe). **Tier 2 (CDP
> `CSS.getMatchedStylesForNode`) is NOT reachable from page JS in the preview-iframe realm** — that
> realm communicates only via `postMessage`; there is no `chrome.debugger`/CDP session there (verified:
> zero CDP refs in `services/scripts/`). §5.2's "CDP is already reachable in the preview-panel realm" is
> **wrong for page JS**; Tier 2 needs a host-side CDP connection and is deferred. **Tier 3 (single-rAF
> mutate-restore on the real node)** is feasible in page JS but deferred as a follow-up (Tier 1 covers
> utility/inline/var-on-`:root` — the common cases). Tier 1's clone is appended under `document.body`, so
> it inherits `:root`/html/body vars but **loses a `--brand` scoped to an intermediate ancestor**; such a
> wrapper-scoped var correctly reports "none driving" → §7 floor (that's the Tier-3 limitation, not a bug).

**Date:** 2026-06-09
**Author:** research + design pass (read-only)
**Scope:** how an inspector color edit on an element is routed to _direct find-replace at a const definition_ vs _twMerge override_ vs _empirical computed-style probe_ vs _per-CSS-approach last-resort_ — and the fate of PR #381 (`HYP-544-color-dom-anchor`, commits `2c07a12f`, `43b59237`, `fe3f4207`, `3ef15052`).

---

## 0. TL;DR

- **The current PR #381 escalates to a `twMerge(...)` wrap whenever a same-group color reaches the element from a source the static walker calls "opaque."** A same-file `const OPAQUE_BG = 'bg-blue-600'` is "opaque" to that walker **only because the walker never resolves identifier bindings** — it does raw recursive node traversal with zero `getBinding`/`VariableDeclarator` resolution (`lib/ast/dynamic-classname-mutator.ts` — no `scope`, no binding lookup anywhere). So a value we _can_ find-replace at its definition gets wrapped instead. That is the bug the CTO reframed.
- **The "old logic that always worked" — find the value at its definition and replace it — depended on an AI locator (`analyzeClassNameWithAI`, Anthropic key) that was orphaned by the style-write unification migration and then deleted as dead code** (commit `929aa1c4`). The new executor passes `locations: []` always (`lib/style-write/style-write-executor.ts:167`), so the AI-fed find-replace path (`modifyByLocations` in the mutator) is now never reached. **But the _same-file const_ case does NOT need AI** — it is a deterministic babel binding-resolution problem the mutator simply never attempts.
- **Fix shape:** route by **babel binding _kind_** of the className-contributing identifier. Same-file `const = literal` → find-replace at definition (deterministic, AI-free). Imported from another file (master component) → twMerge override (req 1, already correct in #381). Unresolvable/param/prop/computed → empirical **computed-style probe** (req 3), then per-CSS-approach last-resort.
- **#381: REWORK, do not close.** Keep the live-className RPC (`fe3f4207`), `projectResolvesTailwindMerge` gate, and the external-master twMerge path. Insert binding resolution _ahead of_ the twMerge escalation so a same-file const is caught and find-replaced before it is ever classified opaque. Bounded insertion, not a re-cut.

---

## 1. Confirmed truths (research, with file:line)

### 1.1 The static walker never resolves bindings

`lib/ast/dynamic-classname-mutator.ts` walks className expressions with hand-rolled recursion (`replaceConflictingInStaticLiterals`, `stripConflictInLiterals`, the `traverse*` helpers). It matches `StringLiteral` nodes structurally and handles `cn/clsx/twMerge/cva/tw` calls, ternaries, logical `&&`/`||`, concat `+`, template quasis. It has **no** `path.scope.getBinding`, no `VariableDeclarator` lookup, no `@babel/traverse` (`parseCode` returns a plain `t.File` via recast; the mutator never wraps it in a `NodePath`). Therefore any identifier — `OPAQUE_BG`, `titleClassName`, `props.className`, `variants.primary` — is uniformly "unanalyzable / opaque." Verified: `grep -n 'scope\|getBinding\|VariableDeclarator' lib/ast/dynamic-classname-mutator.ts` → 0 hits.

### 1.2 The find-replace-at-definition path was AI-fed, and the AI was deleted

- `modifyByLocations` (mutator:410) consumes `ClassNameLocation[]` (`lib/types.ts:137`: `variableName`, `codeLine`, `literalValue`, `containsClasses`, `startLine`) and find-replaces the string literal at that location (`findStringLiteralByCodeLine`, mutator:116). This is the "old logic that always worked."
- Those `locations` were produced by `analyzeClassNameWithAI()` — introduced in `22c3ef2c` (`server/services/dynamic-classname-analyzer.ts`), `new Anthropic({ apiKey: config.apiKey })`, prompt that returns `variableName`/`codeLine`/`literalValue`. **It required an API key.**
- The style-write unification (`32c3312c`, `executeStyleWriteRequest`) re-routed all inspector writes through the new executor, which calls `modifyDynamicClassName(ast, sourceCode, element, /*locations*/[], …)` — `lib/style-write/style-write-executor.ts:167` literally `const locations: LegacyClassNameLocation[] = [];`. The AI analyzer was no longer called from the live path.
- The knip dead-code pass `929aa1c4` then gutted `dynamic-classname-analyzer.ts` from 343 lines to 9 (cache-only), deleting `analyzeClassNameWithAI`. Classic "orphaned by migration, then reaped." `git log --all -S analyzeClassNameWithAI` → introduced `22c3ef2c`, removed `929aa1c4`.

**Answer to the CTO's question ("does same-file find-replace really need an API key?"):**
**No.** The _general_ AI locator (for cva variant objects, cross-file refs, gnarly nested ternaries) needed a key and is gone. The _same-file const with a literal init_ is a pure static binding-resolution problem — `ast.program.body` → top-level `VariableDeclarator` whose `id.name` matches the identifier and whose `init` is a `StringLiteral`. The current code simply never tries. So req-2's "old logic that always worked" can be reconstructed **AST-only, no key**, and is strictly more reliable than the AI ever was for this specific shape.

### 1.3 The twMerge escalation and its gate (PR #381)

On `HYP-544-color-dom-anchor`, `wrapInConcatenation` (mutator) gained `ast`, `domClasses`, `canInjectTwMerge`. It computes `staticRemoved` (classes it stripped from analyzable literals) and `liveDomConflictClasses(domClasses)` (same-group classes present in the live applied className). The **set-diff gate**: `opaqueConflict = liveDomConflictClasses(...).some(cls => !staticRemoved.has(cls))`. If `opaqueConflict && canInjectTwMerge` → wrap in `twMerge((expr), 'bg-red-600')`, injecting/aliasing a `tailwind-merge` import (`findExistingTwMergeBinding`, `collectTopLevelBindings` via `t.getBindingIdentifiers`). Else → concat-append. `canInjectTwMerge` = does the **edited** project resolve `tailwind-merge` (`projectResolvesTailwindMerge`, executor — reads the project's own `package.json`).

- **The flaw:** a same-file `const OPAQUE_BG = 'bg-blue-600'` shows `bg-blue-600` in `domClasses` but is NOT in `staticRemoved` (the walker never followed the binding) ⇒ `opaqueConflict = true` ⇒ twMerge wrap. The const's literal is left untouched; the file now reads `twMerge(clsx('p-2', OPAQUE_BG), 'bg-red-600')` instead of the clean `const OPAQUE_BG = 'bg-red-600'`.

### 1.4 The live-className RPC (`fe3f4207`) — what it gives us

The inspector write originates in the **right-panel webview** (`RightPanelApp` / `useStyleSync`) which has no iframe and no ElementTracer. So `domClasses` is empty there. The RPC fixes that: on `ast:updateStyles` with empty `domClasses`, `PanelRouter` calls `setLiveClassNameProvider` → `PreviewPanel.requestLiveClassName` (wired in `extension.ts`, mirrors `onScreenshot`) → host postMessage → `usePreviewBridge` → iframe `hypercanvas:requestLiveClassName` → `iframe-interaction.ts` reads `el.className` via `findElementsByRef(elementId, itemIndex)` → round-trips back, resolved against an 800 ms timeout. Uses the **pre-re-root** (iframe-relative) elementId for the RPC and threads `StateHub.selectedItemIndices` so a `.map()` row anchors on the right instance. Degrades gracefully (null → write proceeds with `domClasses=''`).
**This RPC is the reusable spine for the probe in §5** — it already round-trips into the realm that owns the live element, and already reads off the element. We extend it from "read className" to "read computed style under a candidate swap."

### 1.5 Preview render model (constrains req-3's literal reading)

The preview `<iframe>` is loaded **directly from the user's dev-server URL** (`buildComponentPreviewUrl` → `${devServerUrl}/test-preview?component=…`, `usePreviewBridge.ts:62`; `postToPreviewIframe.ts` header). There is **no srcdoc / virtual-file / override-source mechanism** — the iframe renders real on-disk files through Vite/webpack HMR. Consequence: the CTO's literal "render a variant of the file in an invisible iframe" requires _either_ a new dev-server virtual-file route _or_ a disk write + HMR cycle — both heavy, both risk visible flicker / HMR races (violates "invisible"). See §5 for the cheaper realization that satisfies the _intent_.

### 1.6 Webview realms (AGENTS.md note absent on main, but established in memory/branch)

Two webview realms: **preview-panel** (owns the iframe, ElementTracer, `findElementsByRef`, computed DOM) and **right-panel** (owns the inspector, `useStyleSync`, where the write fires). They are separate JS contexts with separate stores; cross-realm coordination goes through the **host** (`PanelRouter`) — never direct. Any probe that needs the live element MUST run in the preview-panel realm and be reached via a host-mediated RPC (exactly the `fe3f4207` pattern). The companion design doc `docs/specs/2026-06-04-crossrealm-webview-bridge.md` (branch `HYP-535-crossrealm-webview-bridge`) is the canonical reference.

---

## 2. The decision tree (the spine)

Given a color edit (new class e.g. `bg-red-600`, `changedStyleKeys`, optional `state`) on element `E` in file `F`:

```
1. detectClassNameType(E)  →  'string' | 'template' | 'call' | 'expression'
   - 'string' (className="…")           → modifyStaticClassName  (unchanged; always worked)
   - others → continue to binding classification

2. Walk E's className expression. For EACH same-group color token that the live DOM
   shows (liveDomConflictClasses(domClasses)) but a static literal did NOT already carry,
   find the IDENTIFIER that contributes it and classify by babel BINDING KIND:

   (a) resolves to a SAME-FILE top-level `VariableDeclarator` whose init is a
       StringLiteral (or a literal reachable through a trivially-analyzable init —
       string concat / ternary of literals)
         → DIRECT FIND-REPLACE AT DEFINITION
           rewrite the const's literal: bg-blue-600 → bg-red-600, in place.
           (req 2 — deterministic, AI-FREE). Do NOT also append; do NOT twMerge.

   (b) resolves to an `ImportSpecifier` / import binding (value lives in ANOTHER file —
       a master component you must not edit), OR a same-file binding whose init is
       genuinely non-literal (a call, a cva() object we won't surgically edit)
         → TWMERGE OVERRIDE  (req 1 — keep #381 path)
           wrap to override in place; gated by canInjectTwMerge (Tailwind only).

   (c) cannot statically resolve the contributing token at all — param, prop
       (props.className), member/computed (variants[key]), spread, or a binding whose
       value we cannot read (re-assigned, imported-and-rebound, env-driven)
         → EMPIRICAL COMPUTED-STYLE PROBE  (req 3, §5)
           detect candidate value-bearing tokens, swap each on the live element clone,
           read computed style, pick FIRST that drives the requested color.
           - exactly one works → apply at that candidate's location
           - multiple work     → warn, take FIRST (§6)
           - none work         → PER-CSS-APPROACH LAST RESORT (§7)
                                  Tailwind: twMerge override (if canInjectTwMerge)
                                  else inline-style override on the element ref.

3. Inline literal in the JSX itself (className="…bg-blue-600…" or a literal arg of
   cn/clsx) is just case (a)'s degenerate form — already handled by the existing
   static-literal rewrite (replaceConflictingInStaticLiterals); no binding hop needed.
```

**Why binding-kind is the right axis:** the CTO's three paragraphs of intent map 1:1 onto babel binding kinds. "Same-file constant with a replaceable value" = a same-file `VariableDeclarator` with literal init. "External master component you must not edit" = an `ImportSpecifier`. "Opaque indirection / no key" = unresolvable binding. Routing on binding kind turns prose into a deterministic classifier and demotes the expensive probe to a genuine last resort instead of the main path.

---

## 3. Binding resolution (case a) — the AI-free centerpiece

The mutator works on a plain `t.File` (recast). We do NOT need full `@babel/traverse` scope; a bounded top-level scan suffices for the motivating case and avoids pulling scope analysis into a hot path:

```
resolveSameFileLiteralBinding(ast: t.File, name: string):
  { literal: t.StringLiteral, declarator: t.VariableDeclarator } | null
  - scan ast.program.body for VariableDeclaration whose declarators include
    id Identifier === name (use t.getBindingIdentifiers per node — already imported
    on the branch — to also catch `const { primary: X } = …`? NO: keep v1 to plain
    `const X = '...'`; destructured/object-member is case (b)/(c)).
  - if init is StringLiteral → return it.
  - if init is a trivially-literal expression (concat of string literals, ternary whose
    branches are all string literals) → return the specific branch literal carrying the
    conflicting token (reuse replaceConflictingInStaticLiterals' visitor on the init).
  - exclude: re-assigned bindings (a later AssignmentExpression to `name` at top level →
    bail to (c), value not statically certain); function-scoped/block-scoped shadows
    (v1 only resolves top-level module bindings — the common real-world shape).
```

Then the rewrite is the SAME `removeConflictingClasses` + inject the existing code already does on inline literals — applied to the resolved literal. No new mutation primitive.

**Scope boundary for v1 (be honest):** resolve only **top-level `const`/`let` = StringLiteral** in the same file. `cva({...})` variant objects, destructured bindings, and function-local consts are deferred to case (c)'s probe or stay twMerge. This is a deliberate narrowing — it covers the CTO's exact example and the bulk of real code, without resurrecting the AI locator.

---

## 4. Candidate detection (for the probe, case c)

When the contributing token can't be statically resolved, enumerate **candidate value-bearing tokens** on/around the element. Reuse existing parsers; do not hand-roll a color regex from scratch where a parser exists.

Token forms to detect:

- **Tailwind color classes** in the live `className`: any class matching the changed property's conflict prefixes (`getConflictingPrefixes(changedStyleKeys)` from `lib/tailwind/generator.ts`; the same set the stripper already uses) — `bg-*`, `text-*`, `border-*`, plus arbitrary `bg-[#…]`, `bg-[rgb(...)]`.
- **Inline `style` color values** on the element (`style="background:#1e40af"`): parse via the existing inline-style path (`applyInlineStyleUpdate` / `stringifyTargetStyles`, `style-write-executor.ts`).
- **Hex / rgb() / hsl() literals** anywhere in the element's class/style attributes.
- **CSS custom properties / variables** the element reads (`var(--brand)`, `--brand: …`) — detect from computed style (`getComputedStyle(el).getPropertyValue('--brand')`) and from `style`/class arbitrary values.
- **Design-token / hashed class** (CSS Modules `styles.card` → `card_abc123`, styled-components `sc-xyz`) — detect from the live `class` attribute tokens that are NOT Tailwind utilities (no conflict-prefix match) and map back to source via the approach's StyleAdapter (§7).

Detection runs where the data is: the **preview-panel realm** (live DOM + computed style). Candidates are returned to the host as a small list `{ kind, token, locationHint }`, ranked: exact same-group Tailwind class first, then inline style, then var, then hashed/module class.

---

## 5. The empirical verification mechanism (req 3) — TIERED probe

**Recommendation (multi-model converged — codex gpt-5.5 + gemini): a TIERED probe in the preview-panel realm, extending the `fe3f4207` RPC.** Each tier is cheaper/safer than the next and handles a strictly larger fraction of the remaining cases; you stop at the first tier that resolves the candidate. This replaces BOTH earlier single-mechanism proposals (the file-variant-in-an-invisible-iframe and the clone-only computed-style probe) — neither alone covered the full case distribution. Two designs were considered and **rejected**: position-shifted CSS-injection (both codex and gemini flagged it as fragile — a transient injected rule racing the cascade can leak a paint and mis-attribute specificity), and a separate hidden iframe (heavy: a second module graph + render path, with HMR-race and flicker risk identical to a source re-render).

### 5.0 Where it runs

Preview-panel webview, inside `iframe-interaction.ts`, reached by a new host RPC `hypercanvas:probeColorCandidates` that mirrors `hypercanvas:requestLiveClassName` (same `findElementsByRef(elementId, itemIndex)` resolution, same round-trip via `usePreviewBridge` + `PanelRouter` promise/timeout, same 800 ms envelope). Never runs in the right-panel realm (no DOM there). Invoked **only** when binding classification reached case (c) — same-file consts (Phase 1) and inline literals never probe.

### 5.1 Tier 1 — off-screen detached clone (≈99% of cases: utility / inline / var-on-element)

For the overwhelming majority — a Tailwind utility class, an inline `style` color, or a CSS var resolved **on the element itself** — measure a clone, never the live node:

```
probe_clone(el, candidates, requestedColor, changedProp):
  baseline = getComputedStyle(el)[cssProp(changedProp)]
  for each candidate in candidates (capped N≤8, rank-ordered §4):
    clone = el.cloneNode(true)
    apply candidate-as-requested to clone (swap class token / set style[prop] / setProperty('--x', …))
    attach clone to a reused off-screen container appended to document.body
      (position:fixed; left:-99999px; width:0; height:0; visibility:hidden; pointer-events:none —
       the clone MUST be in the document for getComputedStyle to resolve utilities/cascade)
    measure = getComputedStyle(clone)[cssProp(changedProp)]; remove clone
    if measure === normalize(requestedColor) AND baseline !== measure: record "drives the color"
  return ordered driving candidates
```

Invisibility is **structural** (off-screen + zero-size + hidden), not timing-based; no real file touched, no real preview node mutated, no HMR, no dev-server round-trip. The user sees nothing. Budget ≤ 50 ms wall-clock (clone + `getComputedStyle` are sub-ms each).

### 5.2 Tier 2 — CDP `CSS.getMatchedStylesForNode` (rule / source discovery, NO DOM mutation)

When the write **target** must be located — which CSS rule/declaration actually sets the color, where a `var(--brand)` is _defined_, or which CSS-Module / authored rule owns it — use Chrome DevTools Protocol `CSS.getMatchedStylesForNode` against the live node. It returns the ordered matched rules with their stylesheet origins **without mutating the DOM at all**, so it locates the CSS-var definition site and the CSS-Module write target via the active matched rule (feeds §7's per-approach write). Read-only: zero paint risk. (CDP is already reachable in the preview-panel realm; no clone needed for the _locate_ step.)

### 5.3 Tier 3 — real-element single-rAF mutate-then-restore (rare positional / cascade-sensitive case)

The clone (Tier 1) does NOT reproduce positional selectors (`:nth-child`, descendant combinators depending on real siblings/ancestors) or upstream-redefined CSS vars. For those rare cases, measure on the **real** element inside ONE `requestAnimationFrame` and restore **before the next paint**:

```
requestAnimationFrame(() => {
  saved = read current value;  apply candidate;  measure = getComputedStyle(el)[prop];  restore saved;
  // all synchronous within the same frame callback — the browser paints only AFTER the callback returns,
  // so the transient mutation is never composited. resolve(measure).
});
```

Because mutate + measure + restore are synchronous within a single rAF callback and the value is restored before the frame is committed, no intermediate color is painted. This is the only tier that touches the real node, and only when Tiers 1–2 cannot resolve a cascade-positional candidate.

### 5.4 "Did it change" measurement

Compare the measured value against the requested color **normalized to the same color space** (the browser always reports `rgb()/rgba()`; normalize the request through a throwaway element or a tiny rgb-parse helper). Equality on the normalized rgb tuple = the candidate drives that property; `baseline !== measure` guards against a candidate that coincidentally already equals the request. Color formats that don't normalize cleanly (`color-mix()`, relative color, `oklch()` with alpha) are treated as "no match" → §7 fallback (documented in §10).

### 5.5 Iteration bounds & fallthrough

- Hard cap **N ≤ 8** candidates, rank-ordered (§4); early-exit on first match when the multi-match warning is disabled.
- Tier escalation is per-candidate-class: utility/inline/var-on-element → Tier 1; "need the write target / var-definition / module owner" → Tier 2; positional/cascade-dependent → Tier 3. None-work after all applicable tiers → §7 per-approach last resort (Tailwind twMerge / inline override / CSS-file).

### 5.6 Future advisory candidate-suggester (NOT in scope, NOT an auto-writer)

A **bounded LLM locator** is a possible FUTURE advisory layer for shapes the static AST + DOM probe can't reach deterministically — cross-file const refs and statically-knowable `cva({...})` variant objects. It would only ever **suggest** candidate write locations for the probe/user to confirm; it **never auto-writes**. This is explicitly distinct from the deleted `analyzeClassNameWithAI` (which fed writes directly). Gated on field evidence that cross-file/cva editing is common; out of scope for Phases 1–3.

---

## 6. Multi-match warning UX + take-first

When the probe finds **>1** candidate that drives the requested color:

- Apply the change at the **first** (rank-ordered) candidate's location only.
- Surface a non-blocking inspector warning (toast/inline badge in the right-panel realm — reuse the existing inspector notification surface, do NOT invent a modal): _"Color resolved at `<first candidate>`; N other places could also control this color."_ Keep it dismissable and informational.
- Log the full candidate set + which one was chosen to the extension output channel for debugging (`dbg(...)` in AstService, same as existing write logs).
- Single match → apply silently. Zero matches → §7 last resort (no warning, it's expected fallback).

Rationale: "take first" matches the CTO's rule and avoids a decision modal mid-edit; the warning gives the power-user a breadcrumb without blocking.

---

## 7. Non-Tailwind last-resort (per CSS approach)

When find-replace can't locate the value AND the probe finds no driving candidate, the override-of-last-resort per approach. **Reuse the executor's existing plan machinery — do NOT invent new override mechanisms.**

| Approach                          | Last-resort override                                                                                                              | Mechanism (existing code)                                                                                                                                                                  |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Tailwind**                      | `twMerge((expr), 'bg-red-600')` in place                                                                                          | #381 path; gated by `canInjectTwMerge` (`projectResolvesTailwindMerge`). If `tailwind-merge` not resolvable → fall to inline-style below.                                                  |
| **Inline styles**                 | set `style={{ backgroundColor: '…' }}` on the element ref                                                                         | `executeInlineStylePlan` / `applyInlineStyleUpdate` (`style-write-executor.ts:202`). Inline wins specificity universally — this is the cross-approach equivalent of twMerge.               |
| **CSS Modules**                   | new/append declaration in the element's own module rule, or a higher-specificity local override rule                              | `executeCssFilePlan` (`style-write-executor.ts:184`) — postcss `createRule`/`findRule` + `applyDeclarations`. Resolve the hashed class → source selector via the CSS-Modules StyleAdapter. |
| **styled-components / CSS-in-JS** | append a `${prop}: value;` to the styled template, or an inline `style` override                                                  | inline-style override (above) is the safe universal fallback when the template literal can't be surgically edited.                                                                         |
| **vanilla CSS**                   | `executeCssFilePlan` — add/override declaration in the matched rule; if selector ambiguous, inline-style override on the element. |
| **Tamagui / token systems**       | adapter prop override (`executeAdapterPropPlan`, `style-write-executor.ts:222`); else inline.                                     |

**Universal floor:** an **inline `style` override on the element ref** is the always-available last resort for any approach (highest specificity short of `!important`, no import needed, no project-config dependency). When even the Tailwind twMerge path is unavailable (no `tailwind-merge`), drop to inline rather than writing an unresolvable import — this preserves #381's conservative `projectResolvesTailwindMerge=false → safe path` invariant.

---

## 8. Reconciliation with PR #381 — REWORK

**Verdict: rework on the same branch. Do not close, do not re-cut.**

### Salvage as-is (keep)

- `fe3f4207` live-className RPC end-to-end: `PanelRouter.setLiveClassNameProvider` / `requestLiveClassName`, `PreviewPanel` round-trip, `usePreviewBridge` forwarding, `iframe-interaction` `hypercanvas:requestLiveClassName` reading `el.className`, pre-re-root elementId, item-index threading, 800 ms timeout, graceful null degrade. **This is the transport the probe (§5) extends.**
- `projectResolvesTailwindMerge` gate + `canInjectTwMerge` plumbing through executor → `modifyDynamicClassName` → `wrapInConcatenation`.
- `findExistingTwMergeBinding` / `collectTopLevelBindings` / import-injection helpers.
- `liveDomConflictClasses` + the `staticRemoved` set-diff gate — **still the correct mechanism for detecting "a conflict came from a source we didn't rewrite."**
- The external-master-component twMerge path (req 1) — correct, unchanged.
- `domClasses` field on executor options/request — needed by both the set-diff gate and the probe.

### Change (the bounded insertion)

1. **Insert binding resolution (§3) ahead of the twMerge escalation** in `modifyDynamicClassName` / `wrapInConcatenation`. The set-diff already tells us _which_ tokens are unaccounted-for (`opaqueConflict` residual). For each residual token, find the identifier contributing it and `resolveSameFileLiteralBinding`. If it resolves to a same-file literal → find-replace there (case a) and remove that token from the "opaque" residual. Only tokens that remain opaque _after_ binding resolution proceed to twMerge.
2. **Add the probe (§5)** as a new RPC + a new fallback branch for case (c) — invoked only when binding resolution did not account for the residual and (for non-Tailwind) twMerge isn't applicable. The probe needs the contributing token's candidate set, which the preview-panel realm enumerates (§4).
3. **Add per-approach last-resort routing (§7)** — wire the executor's existing inline/CSS-file/adapter plan paths as the "none work" terminal instead of always-twMerge.
4. Multi-match warning surface (§6).

### Net

#381's diff is ~924 lines across 18 files; the rework keeps the RPC + gate + executor plumbing (~60% of it) and replaces the "escalate-to-twMerge-on-any-opaque-conflict" decision with the binding-kind classifier. The same-file-const case stops twMerging and starts find-replacing. No re-cut.

---

## 9. Phased implementation plan + verification

Each phase is independently shippable and Docker-e2e-provable.

### Phase 1 — Binding resolution for same-file const (req 2) — fixes the reported bug, AI-free — ✅ IMPLEMENTED

**Status: IMPLEMENTED on `HYP-544-color-dom-anchor` (rebased onto main with HYP-575's `spliceNodeSource`).**

- `resolveSameFileLiteralBinding(ast, name)` in the mutator (`lib/ast/dynamic-classname-mutator.ts`): top-level `const`/`let = StringLiteral`, plus literal-ternary/concat init; excludes `var`, re-assigned bindings, destructured/member ids, and imports.
- `replaceConflictingInSameFileBindings` runs in `wrapInConcatenation` BEFORE the twMerge escalation. It is **residual-driven** (spec §2): it only rewrites a const whose literal carries a class actually present in `liveDomConflictClasses(domClasses)` — a const reachable only through a runtime-false branch (`cond && X`), or any edit with no `domClasses` signal, is left untouched. On success it find-replaces at the const literal (reusing `replaceConflictingInStaticLiterals`), records the literal's source range in a `BindingLiteralRewrite[]` sink, and adds the removed classes to `staticRemoved`; only STILL-opaque tokens proceed to twMerge.
- **Surgical write (HYP-575 interop):** the const literal lives in a DISJOINT top-level statement, so the className-value splice never touches it. `executeTailwindPlan` keeps HYP-575's single `spliceNodeSource` path verbatim when there are no binding rewrites, and switches to a multi-splice (className span + each const literal span, applied in DESCENDING start order via `printNodeSource`) only when binding resolution fired — so every untouched byte (imports, JSX text children, indentation) is preserved.
- **Scope (Phase 1):** same-file const literal only. Import (`ImportSpecifier`) → keep #381's twMerge path. Prop/param/member/computed/unresolvable → existing fallback (twMerge if live conflict + `canInjectTwMerge`, else append). The empirical probe (Phase 3) and per-CSS-approach floor (Phase 2) are later phases.
- **Tests (shipped):**
  - unit `dynamic-classname-mutator.test.ts` (describe "same-file const binding resolution (HYP-544 Phase 1)"): `const OPAQUE_BG = 'bg-blue-600'; <div className={clsx('p-2', OPAQUE_BG)}>` + edit bg→red ⇒ const literal becomes `bg-red-600`, **no** `twMerge` wrap, **no** `tailwind-merge` import, className expression untouched, exactly one `BindingLiteralRewrite` recorded. Raw-identifier-bound-const variant.
  - negatives: imported `OPAQUE_BG` from `./tokens` ⇒ still twMerge (case b); `props.bg` member ⇒ not find-replaced; re-assigned `let` ⇒ bail; `cva()` call init ⇒ bail; residual-driven `cond && CONST` (absent from DOM) ⇒ not rewritten; no-`domClasses` ⇒ not rewritten.
  - unit `style-write-executor.test.ts` (describe "same-file const binding resolution + surgical splice (HYP-544 Phase 1)"): full-file BYTE-EQUALITY assertion proving only the const literal span changed (HYP-575 splice property) + no twMerge/import; and a "project lacks tailwind-merge still rewrites the const" case.
- **Docker e2e** (`react-vite-shadcn-linear` fixture, sibling of `color-opaque-twmerge-classname.spec`): same-file-const variant of `OpaqueColorFixture`; asserts the written _source file_ shows `bg-red-*` AT THE CONST (reads the file in the assertion) and the rendered DOM is red with no stacking; before/after screenshots captured.

### Phase 2 — per-approach last-resort routing (§7) — ✅ IMPLEMENTED

**Status: IMPLEMENTED on `HYP-544-color-dom-anchor`.**

- **The actual gap (most of §7 was already wired).** The CSS-Modules / vanilla-CSS / inline / Tamagui floors are the _existing_ `executeCssFilePlan` / `executeInlineStylePlan` / `executeAdapterPropPlan` plan paths the manager already routes by `sourceForm` — those approaches' last-resort writes were never missing. Phase 3's `probeDrivenInlineOverride` already redirects an inline/var/module-driven color to the inline floor. The ONE genuine gap was the **Tailwind terminal**: when an OPAQUE same-group conflict reached the element AND the project does not resolve `tailwind-merge` (`canInjectTwMerge=false`), `applyTwMergeOverride` returned `applied:false` and the code fell through to a **concat-append** — which does NOT win an opaque Tailwind conflict (Tailwind resolves by generated-CSS order, not attribute order), so the inspector edit silently did not apply.
- **The fix (universal inline floor for Tailwind, reusing existing machinery — no new override mechanism):**
  - `MutatorWriteHints.needsInlineFloor` (`lib/ast/dynamic-classname-mutator.ts`): set in `wrapInConcatenation` at the exact terminal `opaqueConflict === true && override.applied === false`, where the mutator leaves the className UNTOUCHED and returns (no concat-append). **Base-state only** — an inline `style` is unconditional and cannot express a state variant (`hover:`/`focus:`); a non-base-state edit falls through to the legacy concat-append (codex P2). If the caller passes no `writeHints` sink, it also degrades to concat-append.
  - `executeTailwindPlan` (`lib/style-write/style-write-executor.ts`): on `writeHints.needsInlineFloor`, applies the SAME write the Phase-3 probe redirect uses — `applyInlineStyleUpdate(element, requestedStyles)` + `writeAST` — using the raw requested CSS value (the TailwindPlan carries only the generated class).
- **Universal floor invariant honored:** an inline `style` override on the element ref is the always-available terminal; when even Tailwind twMerge is unavailable, the writer drops to inline rather than writing an unresolvable import (preserves #381's `projectResolvesTailwindMerge=false → safe path`).
- **Tests (shipped, `style-write-executor.test.ts` describe "per-CSS-approach last-resort floor (HYP-544 Phase 2 §7)"):** Tailwind + opaque conflict + no `tailwind-merge` → inline `style` floor, NOT an import; inline floor leaves the className expression byte-untouched (only adds `style`); no live conflict → normal class write, NO floor (load-bearing guard against flooding inline styles onto every edit); state-variant (`hover`) edit does NOT floor (falls through to concat-append); CSS Modules → postcss declaration in the source rule (existing `executeCssFilePlan` path); vanilla CSS → declaration in the matched rule. The pre-existing "lacks tailwind-merge → concat-append" assertion was FLIPPED to the inline floor (the behavior §7 replaces).
- **Deferred (honest — does NOT block the universal floor):** the §7 CSS-Modules / vanilla rows say "selector can't be resolved cleanly / ambiguous → inline floor." Today `executeCssFilePlan` returns a _failure_ when `findRule` misses, and `CssFilePlan.target` carries `cssFilePath`/`selector`/`declarations` but **no JSX element ref**, so a failed CSS-file write cannot fall to the inline floor without threading the element ref into `CssFilePlan`. This selector-miss → inline degradation is deferred as a separate robustness path. The Tailwind universal floor — the one Phase 2 must ship — is implemented and tested; for CSS-Modules/vanilla the existing CSS-file write is the floor and lands the declaration in the resolved source rule (the common case).
- **Docker e2e:** not run this pass — local `launchVSCode` is broken (VS Code 1.123 / Electron 42 vs Playwright 1.60) and the floor is fully unit-provable at the executor seam (the write target is the source file, not DOM-runtime state, unlike the Phase-3 probe). The inline write itself is the same `applyInlineStyleUpdate` already e2e-proven by Phase 3's var-driver fixture.

### Phase 3 — tiered empirical probe (req 3, §5)

- New RPC `hypercanvas:probeColorCandidates` (mirror `requestLiveClassName`): host → preview-panel → `iframe-interaction` tiered probe (Tier 1 off-screen clone → Tier 2 CDP `CSS.getMatchedStylesForNode` for target/var-definition discovery → Tier 3 single-rAF mutate-then-restore for cascade-positional) → ordered driving-candidates back.
- Candidate enumeration (§4) in the preview-panel realm.
- Invoke only in case (c); apply at first driving candidate; multi-match warning (§6); none → §7.
- **Tests:** unit for the candidate ranker + the rgb-normalize equality. Probe logic e2e (it's DOM-runtime) via Docker: a fixture where the color comes from a `var(--brand)` the static AST can't resolve; assert the probe identifies the var, the write lands at the var definition (CSS-file path) or inline, and the rendered DOM is red. Negative: a cascade-positional fixture where the probe finds nothing ⇒ falls to inline override (no crash, no flicker — assert real preview never showed an intermediate color via a screenshot diff at mid-operation).

### Verification infra (per AGENTS/memory)

- Local `launchVSCode`/Playwright is broken (VS Code 1.123 / Electron 42 vs Playwright 1.60). **Use the Docker harness:** `cd ext-test-projects/e2e && HYPER_E2E_SHARDS=1 bun run test:docker`, with `HYPER_E2E_EXTENSION_REPO=<worktree> HYPER_E2E_BUILD_IMAGE=0` to bind-mount the worktree's built `out/`. `review-screenshots.sh --context "<feature>"`.
- Each phase ships with: red-first unit tests, Docker e2e proving the branch, before/after screenshots to the PR + Linear HYP-544 + TG (per visual-proof rule).

---

## 10. Risks & unknowns (honest)

1. **Probe cascade fidelity.** A cloned element does not reproduce positional selectors (`:nth-child`, descendant combinators) or upstream-redefined CSS vars. For Tailwind-utility / inline / var-on-element (the common case) it is faithful; for cascade-dependent colors the probe may yield "none work" and fall to inline override — which may over-specify (inline wins everywhere, including states the author meant to vary). **Mitigation:** scope the inline-override floor to the changed property only; document; consider the §5.6 source-render path as a future upgrade if field data shows cascade cases are common.
2. **Binding resolution narrowness (v1).** Only top-level `const = StringLiteral`. `cva({...})` variant objects, destructured/object-member bindings, function-local consts, re-assigned bindings → still twMerge or probe. These are exactly the shapes the deleted AI locator handled; we deliberately do NOT resurrect AI. If real projects lean on cva variant editing, that's a _separate_ follow-up (AST-surgery on the variant object, still AI-free, but out of scope here).
3. **twMerge import injection in non-trivial files.** `collectTopLevelBindings`/`findExistingTwMergeBinding` guard against duplicate/colliding bindings, but a project that imports `tailwind-merge` under an unusual shape (namespace import, re-export) could still surprise the injector. Inherited from #381; the `projectResolvesTailwindMerge=false → inline floor` path bounds the blast radius.
4. **Multi-match "take first" can pick the wrong place** when the ranking heuristic is wrong (e.g. a hashed module class outranks the actual driver). The warning surfaces it, but the user must notice. Acceptable per CTO rule; ranking quality is the tunable.
5. **Color-space / format edge cases** in probe equality (named colors, `color-mix()`, `oklch()`, alpha). Normalize through the browser's computed value (always rgb/rgba); `color-mix`/relative-color may not normalize cleanly → treated as "no match" → falls to §7. Document.
6. **Non-React / non-JSX approaches** (Svelte, Vue SFC, Angular) are out of scope — the mutator is babel-JSX. The probe (DOM-runtime) is framework-agnostic in principle, but the _write_ targets are JSX/CSS only here.
7. **RPC realm assumptions** depend on the preview iframe being live and the element findable by ref+index. `fe3f4207` already degrades gracefully (null/timeout); the probe inherits the same degrade-to-static path.

---

## 11. File/line index for implementers

- Decision routing + binding resolution + twMerge escalation: `lib/ast/dynamic-classname-mutator.ts` (`modifyDynamicClassName` ~836; `wrapInConcatenation` ~776; `replaceConflictingInStaticLiterals` ~643; add `resolveSameFileLiteralBinding`). On branch `HYP-544-color-dom-anchor` the twMerge escalation + `liveDomConflictClasses` + `findExistingTwMergeBinding`/`collectTopLevelBindings` already exist (see §1.3).
- Executor plumbing (`domClasses`, `canInjectTwMerge`, `projectResolvesTailwindMerge`, inline/CSS/adapter plan paths): `lib/style-write/style-write-executor.ts` (locations `[]` at :167; `executeInlineStylePlan` :202; `executeCssFilePlan` :184; `executeAdapterPropPlan` :222).
- Live-className RPC (extend for probe): `vscode-extension/hypercanvas-preview/src/PanelRouter.ts`, `PreviewPanel.ts`, `extension.ts`, `webview-preview-panel/usePreviewBridge.ts`, `services/scripts/iframe-interaction.ts` (`hypercanvas:requestLiveClassName` handler — add `hypercanvas:probeColorCandidates` beside it).
- AstService write entry: `vscode-extension/hypercanvas-preview/src/services/AstService.ts:639` (`updateStyles`).
- Preview render model (no virtual-source): `webview-preview-panel/usePreviewBridge.ts:62` (`buildComponentPreviewUrl`), `postToPreviewIframe.ts`.
- Conflict-prefix helpers (candidate detection): `lib/tailwind/generator.ts` (`getConflictingPrefixes`), `lib/tailwind/parser.ts` (`removeConflictingClasses`).
- Deleted AI locator (history reference only — DO NOT resurrect): `analyzeClassNameWithAI` in `server/services/dynamic-classname-analyzer.ts` @ `22c3ef2c`, removed @ `929aa1c4`.
- Cross-realm reference: `docs/specs/2026-06-04-crossrealm-webview-bridge.md` (branch `HYP-535-crossrealm-webview-bridge`).
