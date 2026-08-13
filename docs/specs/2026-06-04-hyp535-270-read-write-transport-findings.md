> **⚠️ SUPERSEDED** by the [2026-06-12 Styles System Master Spec](./2026-06-12-styles-system-master-spec.md) (see Part/§ 3.4, 6.1). Retained for history; do not follow for new work.

# #270 multi-select READ/WRITE transport — deep-study findings (pre-build gate)

**Ticket:** HYP-535. **Supersedes the unverified parts of** `2026-06-04-crossrealm-webview-bridge.md` §3b.
**Method:** inline code-trace of the live ext transport + a 7-agent fan-out (6 traces + 1 adversarial
verifier). Every claim below carries a `file:line` anchor; paths are relative to the repo root.
**Status:** research. This is the gate the handoff named ("deep-study before #270"). Building #270
is a separate, TDD-first task. **Read this before touching code.**

---

## 0. TL;DR — the design survives, with ONE material correction

The CTO directive "a multi-selection is the N>1 case of the ONE style engine, not a second
subsystem" **stands up** for the _transport_ and the _write_ path. But the design spec's central
read claim is **wrong about where editable values live**:

- ❌ Spec §3b: "`mergeStyleReadResults(StyleReadResult[])` + a `mixed` flag is the **only** new read code."
- ✅ Reality: **the ext editable values do not flow through `StyleReadResult` at all.** They flow
  through a _separate_ client-side `ParsedStyles` pipeline. So the read merge is **two** merges:
  1. **Value merge** over N `ParsedStyles` (the real `8px vs 16px → Mixed` path) — _missing from the spec_.
  2. **Tab merge** `mergeStyleReadResults(StyleReadResult[])` — unions the source-tab chips only.

Everything else the spec said to do (call the single read N times, delete the `ASTBatchStyleOperation`
parallel path, per-`elementRef` write plans) is confirmed correct. The "one undo step for N elements"
requirement is **net-new** but the primitive to build it (`recordBatchEdit`) already exists.

---

## 1. The discriminating fact — answered (the good case)

> Does the ext single-select read go through `StyleReadManager` host-side and return a serializable
> result over a transport NOT coupled to "exactly one element"?

**Yes.**

- Host-side read: `StyleReadService.readElementClassName` (`vscode-extension/hypercanvas-preview/src/services/StyleReadService.ts:81`)
  → `this._styleReadManager.read(...)` (`:172`) → serializable `StyleReadResult`.
- Transport: per-`requestId` request/response over `postMessage` — webview sends
  `{type:'styles:readClassName', requestId, elementId, componentPath, ...}`
  (`PanelRouter.ts:332`), host replies `{type:'styles:response', requestId, ...result}` (`:350`).
- **Not structurally single-element.** `VSCodeAdapter.sendEvent` is fire-and-forget `postMessage`;
  `onEvent` broadcasts every reply to a `Set` of handlers, each filtering by its own `requestId`
  (`client/lib/platform/VSCodeAdapter.ts:195,203`). Firing **N** reads concurrently works with
  **zero transport change**.

So "call the existing single read N times and merge" is transport-feasible. The catch is what
"merge" actually operates on — see §2.

---

## 2. READ path reality — TWO pipelines, not one (the correction)

The ext inspector runs two _independent_ read pipelines off one `styles:response`:

| Pipeline        | Source                                                                                                                       | Drives                                                                                               | Merge needed                          |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------- |
| **Values**      | `response.className` → `classNameToStyles()` → `ParsedStyles` (`useElementStyleData.ts:442`, parser `:114`) stored at `:445` | every value Input via `effectiveParsed` (`RightSidebar.tsx:304-312`, fed at `:985`)                  | **value merge over N `ParsedStyles`** |
| **Source tabs** | `response.styleReadResult` (`useElementStyleData.ts:451`)                                                                    | the chip row via `resolveInspectorStyleSourceTabs` (`RightSidebar.tsx:257-266`, `source-tabs.ts:68`) | `mergeStyleReadResults` (tab union)   |

Hard evidence the value path is NOT `StyleReadResult`:

- `StyleReadResult.properties` is **empty in the ext** (verified directly): `buildProperties`
  (`lib/style-read/style-read-manager.ts:157`) builds per-property rows from **`readResult.sourceOwners`**
  (the readers' output) — and every live reader returns `sourceOwners: []` + `values: {}`
  (`lib/style-adapters/tailwind-v4/reader.ts:30-31`; css-modules and inline readers do likewise,
  emitting only `classIdentities`). It is **not** proven by `StyleReadService.ts:688 sourceOwners:[]` —
  that field feeds `buildSourceTabs`, not `buildProperties`. With `computedStyle:{}` (`StyleReadService.ts:180`),
  `buildProperties` maps `Object.entries(context.computedStyle)` → **zero rows**, so `properties` is `[]`
  (not even a `computed` placeholder row).
- `PropertySource` has **zero client consumers** — `rg PropertySource client/` returns nothing;
  the type lives only in `lib/style-read/types.ts:512`.
- The editing block is gated on `parsedStyles`, not on `styleReadResult`
  (`RightSidebar.tsx:1361 selectedIds.length === 1 && parsedStyles`).

**`mergeStyleReadResults` does not exist** anywhere (`rg` → only the two spec docs). It is genuinely
new — but it merges _tab chips_, not values.

### 2a. The `sourceTabId` adversarial result (corrects my own scout note)

`sourceTabId` in the live path is **a hardcoded constant per reader**, not element- or class-specific:

- `tailwind-v4:elementClass` (`lib/style-adapters/tailwind-v4/reader.ts:18`)
- `inline-style:style` (`lib/style-adapters/inline-style/reader.ts:19`)
- `css-modules:${classKey}` (`lib/style-adapters/css-modules/reader.ts:15`)

The manager _prefers_ the reader-supplied id (`style-read-manager.ts:127 identity.sourceTabId ?? …`),
so the `tabIdFromOwner` elementRef/`filePath:property` branch I flagged in the scout is **dead** in
the live read path (sourceOwners always `[]`).

Consequence: **tab union by id is correct and desirable** (one "Tailwind" chip for an all-Tailwind
selection — each element still writes its own source via its own `elementRef`). The _over-merge_ fear
(showing one element's value as shared) is a **false alarm** _as long as_ the \*_value-mixed decision
keys off per-property value inequality in the `ParsedStyles` merge, NOT off `sourceTabId` equality._

---

## 3. WRITE path + undo atomicity

Single-element write, fully traced:
`astOps.updateStyles` → `ast:updateStyles` → `AstBridge.handleMessage` (`AstBridge.ts:95`) →
`_handleUpdateStyles` (`:325`) → `_withUndoTracking(filePath, () => astService.updateStyles(...))`
(`:331`) → `AstService.updateStyles` (`AstService.ts:635`) → `executeStyleWriteRequest`
(`lib/style-write/style-write-executor.ts:260`) → `StyleWriteManager.createPlan` + `execute`
(`:304-305`) → file write.

Spec confirms single-element by design: "one inspector control change = one property = one
`StyleWritePlan` … undoable as a single unit" (`2026-04-14-style-write-unification-plan.md:2637-2640`).
The only "batch" it models is multi-_property_ within one element (padding shorthand, `:2642-2647`) —
**not** multi-element. So N elements = N independent `createPlan/execute` calls. Architecturally clean.

**`selectedSourceTabId` is resolved per-element** inside the executor
(`style-write-executor.ts:266 getRequestRoutableCssSystem`) — N elements each resolve their own
source. The webview already supplies one sourceTab per selection.

**Same-file offset safety is already handled:** `AstService.updateStyles` re-resolves the element
(`AstService.ts:651`) and refreshes the NodeMap per mutated file (`:689`) on every call. Sequential
looping does **not** corrupt later elements' source offsets (this is the `afterMutation`-in-loop
pattern that #270's own server route documented as mandatory).

---

## 4. Confirmed breaks (must handle) — with mitigations

1. **VALUE-MERGE OMITTED (central).** See §2. The spec's "only new read code" is incomplete.
   _Mitigation:_ add a **second** merge over N `ParsedStyles` (parse each `response.className`,
   merge with the `mergeStyleData` _algorithm_ — present-vs-absent → `MIXED`, `JSON.stringify` object
   compare — salvaged from `useBatchStyleData.ts:23-43`, reimplemented over `ParsedStyles`).
   `mergeStyleReadResults(StyleReadResult[])` is still needed for the tab union, but it is **not** the
   only new read code.

2. **UNDO ATOMICITY.** Looping the single write RPC N times → N undo entries (one `recordEdit` per
   `_withUndoTracking`, `AstBridge.ts:210`; `beginTracking/endTracking` is a reentrancy counter, not a
   transaction, `UndoRedoService.ts:170-180`). One multi-select edit would need N `Cmd+Z`.
   _Mitigation:_ new host handler `ast:updateStylesBatch` modeled on `_handleMoveElement`
   (`AstBridge.ts:526-584`): ONE `beginTracking()/try/finally endTracking()`, loop calling
   `astService.updateStyles(...)` **directly** (bypassing `_withUndoTracking`), accumulate into ONE
   `recordBatchEdit` (`UndoRedoService.ts:67` — the existing one-step-N-files primitive used by
   delete/move).

3. **SAME-FILE UNDO DEDUP TRAP.** For N elements in one file, naive per-element before/after pushes N
   overlapping `FileEdit`s for the same path → undo becomes last-write-wins (reverts only element N).
   `updateStyles` returns `contentBeforeWrite` only for _cross-file_ writes (`AstService.ts:663-668`).
   _Mitigation:_ capture `contentBefore` per **unique file** before its **first** mutation, read
   `contentAfter` per unique file after the **last** mutation → exactly one `FileEdit` per file in the
   single `recordBatchEdit`.

4. **PARTIAL FAILURE undefined.** If element K fails mid-loop, 1..K-1 are already on disk.
   _Mitigation:_ don't abort; record successful edits as one `recordBatchEdit`; return a per-element
   results array to the webview (like #270's `BatchElementResult[]`). Offsets stay safe (per-call
   re-resolve, §3).

---

## 5. False alarms cleared (do NOT spend build time on these)

- **surfaceDecision per-element variance** — `decideSurface` (`style-read-manager.ts:194`) has **zero
  client consumers** (`rg` empty). The inspector gates on `selectedIds.length===1 && parsedStyles`,
  not surfaceDecision. Cannot break the merged inspector because nothing reads it. (Becomes real only
  if a future build wires it into gating — see §8 Q3.)
- **condition/theme axes differing across elements** — `availableConditionAxes`/`activeConditions`
  come from `runtimeThemeContext`/project capabilities = **global** inspector context, not per-element.
  Union is safe; the one selected condition applies uniformly on write.
- **performance of N reads** — transport already fans out (§1); N concurrent reads are fine for
  typical N. The real constraint is structural, not perf (next bullet).
- **`mixed` sentinel rippling to single-select** — `MIXED` lives on the `ParsedStyles` value path and
  is only produced for `length>1`; single-select feeds raw `parsedStyles`. N=1 passes through
  unchanged → byte-identical to today. No regression.

---

## 6. Ordered build steps (when #270 is greenlit — TDD red-first each)

**READ**

1. **New orchestrator** (NOT a hook-loop): a new `useMergedElementStyleData` (or non-hook async
   helper) that does **not** reuse `useElementStyleData`'s single-latest-ref correlation
   (`latestRequestRef`/`prevElementIdRef`, `:277/:284`, which assume one in-flight read). Issues N
   `styles:readClassName` sends (one per `selectedIds[i]`, each own `requestId`, `effectiveComponentPath`
   derived as `useElementStyleData.ts:392-398`), each with its own `onEvent` subscription, collects N.
2. **Value merge:** parse each `response.className` via `classNameToStyles` (`useElementStyleData.ts:442/:114`)
   → N `ParsedStyles`; merge with the salvaged `mergeStyleData` algorithm → one merged `ParsedStyles`
   with `MIXED` sentinels. Skip the i18n/availableKeys/runtimeStyle single-element branches (`:489-537`).
3. **Tab merge:** add pure `mergeStyleReadResults(results: StyleReadResult[]): StyleReadResult` next to
   `lib/style-read/style-read-manager.ts`. Union `sourceTabs` by `tab.id` (dedupe). Do **not** touch
   `DefaultStyleReadManager.read`. For shared-vs-mixed, compare value-bearing identity
   (`cssClass` for tailwind, `classKey`+`filePath` for css-modules), not raw id.
4. **UI wiring:** in `RightSidebar.tsx` replace the single-element gate (`:211`) and the dead-end wall
   (`:1347-1352`); for `length>1` drive the orchestrator, feed merged `ParsedStyles` into the existing
   `effectiveParsed` path (`:304-312`) and merged `sourceTabs` unchanged into
   `resolveInspectorStyleSourceTabs` (`:257-266`); relax the `:1361` gate to accept the merged-multi case.

**WRITE** 5. **New atomic handler** `ast:updateStylesBatch` — `AstBridge.handleMessage` case (`:94-130`) +
`_handleUpdateStylesBatch` per the move pattern (`:526-584`): one `beginTracking/try/finally`,
loop `astService.updateStyles(...)` directly. 6. **Undo accumulation:** `Map<file, contentBefore>` captured before each file's first mutation;
`contentAfter` from disk after the loop; one `recordBatchEdit` with one `FileEdit` per unique file;
on failure continue + return per-element results. 7. **Transport types:** add `ast:updateStylesBatch` message/response to `client/lib/platform/types.ts`
and `vscode-extension/.../types.ts`; add `astOps.updateStylesBatch` (webview sends N entries in one
message); wire `useStyleSync`'s currently-SaaS-only batch branch to this RPC.

**DELETE (per spec; blast radius self-contained, no external consumers — §7)** 8. `client/lib/canvas-engine/operations/ASTBatchStyleOperation.ts` + `CanvasEngine.ts:541-575`
(`updateASTStylesBatch`) + `ASTApiService.updateStylesBatch` (interface/types/Impl) +
`server/routes/updateComponentStylesBatch.ts` + `server/index.ts:215-220` + the `useStyleSync`
batch branch's `engine.updateASTStylesBatch` call + the `multiSelectData` runtime-DOM `useMemo`
(`RightSidebar.tsx:326-355`) + ride-along tests. **Salvage only the `mergeStyleData` _algorithm_**
(not the file) into the new `ParsedStyles` value merge.

---

## 7. PR #270 (`HYP-271-multi-select-batch`, commit `f35f91a5`) — REJECT / SALVAGE ledger

**REJECT (parallel write path the spec supersedes):**

- `ASTBatchStyleOperation.ts:24` (→ `engine.updateASTStylesBatch`) — refs: `CanvasEngine.ts:18,564` only.
- `server/routes/updateComponentStylesBatch.ts:151` + `server/index.ts:215-220` — client caller
  `ASTApiServiceImpl.ts:89` only.
- `useStyleSync.ts:123-145` batch branch (`if (selectedIds.length>1 && engine)`, author comment
  ":125 'SaaS only — VS Code … not wired yet'").
- `CanvasEngine.ts:541-575`, `ASTApiService.ts:156` + types `:78-99`, `ASTApiServiceImpl.ts:88-99`.
- `multiSelectMerged` — **NOT** a `SharedEditorState` slice (the handoff hypothesis was wrong); it is
  **local** `RightSidebar` state from a `useMemo` reading the live iframe DOM
  (`RightSidebar.tsx:326-355`) — the "runtime-DOM merge" the spec rejects.

**SALVAGE as IDEAS, not code:**

- `mergeStyleData` **algorithm** (`useBatchStyleData.ts:23-43`) — reimplement over `ParsedStyles`.
- `readBrowserElementStyle` (`useElementStyleData.ts:259`) — the SaaS-side per-element read primitive
  already _extracted_ from the single-read hook by this PR; reuse as the per-element read on the
  browser side.

Selection plumbing (`selectedIds` via `useSelectionCompat`/`SharedEditorState`, the `>1` empty-state)
is 100% pre-existing on main — #270 added none.

---

## 8. Open decisions for CTO (genuine product calls — not code-derivable)

1. **MIXED-value render.** No "Mixed" UI exists. (Note: the `MIXED` sentinel + empty-string collapse
   lived on #270's branch `f35f91a5`, **not** on this branch — on HYP-535 the value gate is
   `RightSidebar.tsx:1361 selectedIds.length === 1 && parsedStyles`; section selects have no `mixed`
   `<option>`.) **Footgun of blank-on-mixed:** an empty field reads as "no value" — if the CTO edits it,
   the write overwrites all N elements (data loss). **Explicit "Mixed" placeholder/badge on inputs
   (cheap, prevents overwrite) + `mixed` option in section selects (touches section components,
   currently untouched), or blank-on-mixed for v1?**
2. **Disjoint sourceTabs** across the selection (A all-Tailwind, B css-modules+inline). `StyleSourceTab`
   has no coverage field; `StyleSourceTabsSection` renders a flat chip row. **Intersection (only tabs
   all N own — safest), union with per-tab coverage badges, or computed-only fallback?** (If
   computed-only: it must **explicitly disable** controls/writes — the `computed` tab resolves to
   `undefined` via `getExplicitStyleSourceTabId` (`source-tabs.ts:75`), which still allows default
   write routing, so "computed-only" is not read-only by itself.)
3. **Mixed stylability** (stylable + non-stylable in one selection; `surfaceDecision` not consumed
   today). **Disable editing for the whole selection, edit the stylable subset, or warn?** (Requires
   wiring `surfaceDecision` into gating, which doesn't exist.)
4. **Cross-file multi-select** in v1, or constrain selection to one component file (matching #270's
   documented single-file assumption) and defer cross-file? **Cost is bigger than host batching:** the
   host `recordBatchEdit` loop _can_ span files, but the **client** write path today picks
   `selectedIds[0]` and sends a single `filePath` (`useStyleSync.ts:109,191`) — cross-file needs new
   per-element file/source plumbing on the client, not just host changes.
5. **Reader id coarseness** (longer-term). Constant tailwind/inline ids + classKey-only css-modules id
   mean cross-file same-named module classes collide on tab id. Fixing is bigger than it looks: 3 shared
   reader files + the manager test golden ids **AND write-routing** — `getRequestRoutableCssSystem`
   strips the `css-modules:` prefix and compares the suffix to `reference.classKey`
   (`style-write-request-context.ts:119-125`), so element/file-discriminating ids touch the write path too
   (a shared-code change on both read and write). **Accept the value-merge workaround (key mixed off
   values, not ids) for v1, or invest in element-discriminating ids now?**

### CTO resolution (2026-06-04, Alex)

- **D1 → A.** "Mixed" is an input **placeholder** (the field renders empty with `placeholder="Mixed"`
  as hint text — NOT a written value, NOT a blank), so the differ-state is visible and typing writes the
  new value to all N. Show all available badges. Section selects get a `mixed` option representing the
  differ-state. No blank-on-mixed, no fake value pre-filled.
- **D2 → redesign (brainstorm).** Show all badges that exist; rethink the `computed` tab's **write**
  semantics (read is clear; on write it should behave like `auto` — when AI is configured, default to an
  `auto` tab; when AI is not configured and no such style exists, fall to the project's **priority
  styling system**); if the edited style already exists, edit it in place; do **not** coerce the
  selection to one CSS system; possibly **hide the tab row entirely** under multi-select. → design in
  `2026-06-04-multi-select-style-tabs-design.md`.
- **D3 → redesign (brainstorm).** **No non-stylable elements allowed.** A DS (design-system) element
  must be stylable via the DS's own built-in mechanisms, wired into our styling system. If a style
  cannot be applied directly or via DS, **escalate**: lift the style to a wrapper, or **create** a
  wrapper element — but only when the wrapper would contain **exactly one** of the selected elements and
  **no other elements at all** (including non-selected), **and** the wrapper has the same actual
  (computed) dimensions. → design in `2026-06-04-stylability-escalation-wrapper-design.md`.
- **D4 → A.** Cross-file multi-select **supported in v1** (accept the larger client plumbing).
- **D5 → full fix, no workaround.** Source-tab `id` includes the file path (or another discriminator)
  in the general case; on conflicting same-named classes from different modules/files, show the file in
  parentheses in the tab label. Touches read **and** write routing per §8.5.

---

## 9. Required amendment to `2026-06-04-crossrealm-webview-bridge.md` §3b

Replace the "`mergeStyleReadResults` + a `mixed` flag is the only new read code" claim with: the ext
editable values come from a client-side `ParsedStyles` pipeline separate from `StyleReadResult`
(which is empty-`properties` and tab-only in the ext); #270 needs **two** read merges (ParsedStyles
value-merge + StyleReadResult tab-union) plus a **new fan-out orchestrator** (the single-read hook's
single-latest-ref invariant forbids a hook-loop). The WRITE side is unchanged except the "one undo
grouping" is built on the existing `recordBatchEdit` primitive via a new `ast:updateStylesBatch`
handler.
