# Plan — Extension Bug Blitz 2026-07

- **Status:** Active
- **Date:** 2026-07-18
- **Umbrella:** [HYP-1029](https://linear.app/glide-vc/issue/HYP-1029)
- **Label:** `bug-blitz` (new team-level label on HYP; applied to every ticket in this plan)
- **Goal:** Close every ext bug reachable within 1-6 UI clicks. Extension is the target platform for
  this blitz; SaaS is paused, but roughly 90% of the underlying logic is shared (`shared/`, `lib/`),
  so most fixes here land on both surfaces per the extension/SaaS parity rule.
- **How this plan was produced:** four recon agents in parallel (Linear ticket inventory, git-history
  repo mining for repeat-offender bug classes, a live QA sweep on a fresh 0.1.71 build, and this
  synthesis/decision pass), followed by a 3-model panel (opus-4.8, codex, fable-5) asked to converge
  on root causes and an ordering rule. The agent transcripts (`final-ticket-registry.md`,
  `report-brainstorm-and-decisions.md`, `report-ticket-inventory.md`, `report-repo-mining.md`,
  `report-qa-sweep.md`) were session-local scratchpad files, not committed to this repo — they are
  not retrievable after the session ended; this document is the durable record of their conclusions.

## 1. Current state (pre-blitz snapshot)

| Metric | Value |
| --- | --- |
| Open Linear issues, team HYP | 413 total, 148 are ext-relevant bugs |
| New tickets filed this pass | 22 (repo-mining candidates + systemic tickets + QA-sweep finds) |
| Duplicates closed | 2 — HYP-887 (dup of HYP-888), HYP-813 (dup of HYP-782) |
| Existing tickets labeled + prioritized into this cohort | 30 |
| Dominant bug found by live QA | Click-selection inside any imported child component collapses to
  the child's call-site (one overlay covers the whole subtree, writes silently no-op). Already fixed
  in **HYP-1006** (PR #668, branch `hyp-1006-composed-root-resolve`, review round 2). Confirmed NOT a
  harness artifact — per-click measured rects matched the intended elements independently. |

## 2. The systemic thesis

Every recurring bug class mined from git history (drag-source resolution: 6+ fixes; React-19
compiled `_debugStack` resolution: 7 fixes, the most-patched mechanism in the repo; selection-rect vs
inspector divergence: 6+ fixes; webview node-global leaks: 5 fixes) shares one root shape: **the
failure is silent.** A write no-ops, a resolver picks the wrong element, a preview never materializes
— and nothing surfaces it. Point-fixing the same class a 4th or 5th time is not progress; the panel's
converged move is to make failures loud first, then encode the invariant as a CI gate so the class
cannot quietly regress.

The panel's four consensus moves (all three models converged independently):

1. **Webview→host structured error channel.** `window.onerror` + `unhandledrejection` + `console.error`
   piped to the Extension Host output channel and a diagnostics buffer; every e2e journey asserts zero
   entries. (~1 day, HYP-1041.)
2. **One canonical element resolver + a component-zoo fixture corpus.** Idempotent, only returns
   writable/indexed nodes, ambiguous resolution is a typed failure — never a best-effort guess.
   (HYP-1042; build-time JSX-tagging alternative spiked separately, HYP-1043.)
3. **Mutation success = verified read-back.** `writeAndConfirm()` becomes the only sanctioned write
   path (generalizes HYP-987's verify-and-retry). Per the master spec's frozen-plan doctrine
   ([§7.4](../specs/2026-06-12-styles-system-master-spec.md)), it must NOT re-invoke
   `StyleWritePlanner.selectTarget()` reactively after a failure — that is exactly the "second engine"
   the spec forbids. Instead `selectTarget()` resolves a frozen, ORDERED candidate list once, up front;
   `writeAndConfirm()` is a dumb dispatcher that walks that pre-authorized list (write → verify →
   rollback → next candidate), never deciding a new fallback itself. Visible failure once the frozen
   list is exhausted (HYP-1045). Paired with an op registry where every op declares apply+invert and a
   conformance test proves an execute/undo/redo round-trip returns to the prior state exactly
   (HYP-1044) — "forgot undo" becomes a CI failure instead of a shipped regression.
4. **Demo-path journey e2e as the actual demo-readiness metric**, not raw bug count: script the exact
   demo clicks (open → preview → click → restyle → undo → redo) as one blocking merge gate (HYP-1047).

## 3. Ordering rule

Score = `frequency × click-proximity × demo-criticality × blast-radius ÷ cost`. Click-proximity is
**steep** — a 1-click bug outweighs a 6-click bug by more than the raw distance ratio, because 1-click
bugs are what a first-time demo hits. Blank-preview and crash bugs get a blast-radius override (jump
the queue regardless of score) because they block re-QA of everything downstream. Any bug that sits on
the literal demo path (open → preview → click → restyle → undo → redo) also jumps the queue.

## 4. Phase 0 — Make failures visible, protect the demo

| Ticket | Priority | What | TDD first step |
| --- | --- | --- | --- |
| HYP-1041 | High | Webview→host structured error channel: pipe `window.onerror` / `unhandledrejection` / `console.error` from iframe+webview to the Extension Host output channel + a diagnostics buffer. | Journey e2e asserts zero entries in the new channel during a scripted demo click sequence — fails today because the channel doesn't exist. |
| HYP-1047 | High | Demo-path journey e2e (open→preview→click→restyle→undo→redo) as a required, blocking merge-gate CI check. | New `demo-path-journey.spec.ts`: run the full sequence, assert each step's DOM/state. First run is red (spec doesn't exist yet). |
| HYP-1048 | High | Preview materialization as a total state machine: `RENDERED \| ERROR_SHOWN \| FALLBACK_SHOWN` plus a watchdog — "blank" must not be a representable state. | Unit test: force materialization to throw/time out, assert the state machine lands on `ERROR_SHOWN`, never stays unresolved. |
| HYP-1030 | High | Webview-bundle gate scans only 5 of 8 browser bundles — `iframe-interaction.js`, `iframe-error-detection.js`, `iframe-console-capture.js` (`esbuild.js:247,259,271`) are unguarded against node-global leaks. | Gate test: `BROWSER_BUNDLES` must ⊇ every `platform:'browser'` esbuild outfile — currently fails, 3 entries missing. |

## 5. Phase 1 — 1-2-click product bugs

| Ticket(s) | Priority | What | TDD first step |
| --- | --- | --- | --- |
| HYP-1006 (re-QA gate) | In review → merge | Click-selection inside an imported child component collapsed to the child's call-site (root cause of the QA sweep's severe finding). Fix is in PR #668, review round 2. | New `imported-component-selection.spec.ts` (dep: react-vite-tw4-twitter): click `article span` inside `<Tweet>`, nodeRef must resolve into `Tweet.tsx` not `Feed.tsx:46`; distinct elements get distinct nodeRefs; itemIndex differs between tweet #1 and #3. After merge: re-run resize, undo/redo, drag-move, and window-reload flows — all four were blocked by this bug during the QA sweep. |
| HYP-1050 | Normal | nodeRef format mismatch: click path emits relative `file:line:col`, Select Parent emits an absolute path with no column — overlay can desync from `selectedIds[0]`. | Extend `find-traceable-parent.test.ts` / `bulka-shift-enter-parent.spec.ts`: Select Parent's nodeRef must match the click-path regex; overlay `data-element-id === selectedIds[0]`. |
| HYP-966 | High | Overlay mis-anchors an imported component wrapped in the same file — click-distance 1. Ticket already carries a TDD acceptance criterion. | Per ticket AC. |
| HYP-885 + HYP-904 | High / Normal | cms-spa preview never materializes; HYP-904 shares the same nx-resolution root cause (commented, not closed — do not close as dup, root cause differs enough to track separately). | e2e: open cms-spa preview, assert iframe body is non-empty within timeout. |
| HYP-923 | Normal | cms-spa: second launch in the same session fails (~same flake family as HYP-885). | e2e: launch cms-spa preview twice in one session, assert the second launch also renders. |
| HYP-782 (HYP-813 closed as dup) | High | Unsupported-CSS project preview never paints — ~16 e2e specs red from the same origin PR #540. | Pick one of the 16 red specs, assert it goes green. |
| HYP-853 | High, in progress | Twitter-project preview non-materialization, 20+ specs affected. | Representative spec: assert iframe body non-empty within N ms on cold start. |
| HYP-768 | Normal | Explorer tree click ignores Cmd/Shift modifiers (no multi-select via tree). | e2e: Cmd+click a second tree item, assert it adds to selection instead of replacing it. |
| HYP-774 → HYP-777 | Normal (sequential, not a dup pair) | Inspector's element list breaks when the Explorer panel is closed. | e2e: close Explorer, open inspector, assert the list still renders correctly. |
| HYP-775 | Normal | "Setup MCP" command has been dead in production since PR #383. | e2e: invoke Setup MCP, assert it actually writes the MCP config (not a silent no-op). |
| HYP-776 | Normal | "Go to Code" is dead via MCP, keyboard, and context-menu entry points. | e2e: trigger Go to Code from each of the three entry points, assert the editor navigates to the source line. |
| HYP-971 | Normal | Pending-click retry is dead-wired — a click during a cold source-map state never retries. | Unit: simulate a click while source maps are cold, assert the retry actually re-fires. |
| HYP-978 | Normal | Cold React-19 drag resolves to the compiled seed position instead of source, on the very first drag after a cold start. | e2e: first drag on a React-19 project right after preview cold-start resolves the real source location. |
| HYP-921 | Normal | Ancestor call-site walk-up returns the compiled stack position instead of the source-map-mapped one. | Unit: ancestor walk-up through a mapped call-site returns the mapped original position. |
| HYP-1026 | High | Undo: an empty undo stack silently does nothing; the native VS Code undo fallback may revert DOM state instead of the source file. | e2e: one style write, undo once — assert the SOURCE file reverted (not just the DOM); undo on an empty stack is a true no-op with no side effects. |

## 6. Phase 2 — Style-write cluster (session:2 triage batch)

Backbone already in progress and gating this cluster: **HYP-995 / HYP-990 / HYP-989 / HYP-988**
(the verify-and-retry chain). Do not schedule the tickets below ahead of that chain landing.

| Ticket | Priority | What | TDD first step |
| --- | --- | --- | --- |
| HYP-1012 | High — **security** | Workspace containment is not enforced at the AST write boundary. | Unit: attempt a write whose resolved path escapes the workspace root, assert it's rejected before any disk I/O. |
| HYP-1023 | Normal | Finalize/rollback can clobber concurrent typing. | Unit: simulate a keystroke arriving during the finalize/rollback window, assert it isn't lost or overwritten. |
| HYP-1022 | Normal | Cleanup failure reports silent success instead of a failure. | Unit: force the cleanup step to throw, assert the caller observes a failure. |
| HYP-1021, HYP-1019, HYP-1017, HYP-1010, HYP-1028, HYP-1004 | Normal | Remaining style-write follow-ups from the same session:2 batch; each carries its own acceptance criteria on its Linear ticket. | Apply the same rule per ticket at pickup time: write the named failing test from the ticket's AC first. |

## 7. Phase 3 — Systemic class-eliminators

| Ticket | Priority | What | TDD first step |
| --- | --- | --- | --- |
| HYP-1042 | Normal | One canonical element resolver + a component-zoo fixture corpus (nested custom components, fragments, mapped lists, HOCs, forwardRef, spread props, React-19 compiled output). | Corpus test: run the resolver over every fixture, assert each returns either a definite node or a typed ambiguous-failure — never a silently wrong node. |
| HYP-1043 | Normal, tech-debt spike | Spike build-time JSX tagging (`data-hyp-loc` via a Babel/Vite plugin, LocatorJS technique) as a structural alternative to source-map drift; source-map path stays as fallback either way. | Spike deliverable: a prototype that passes the component-zoo corpus, plus a written keep/discard recommendation. |
| HYP-1044 | Normal | Op registry: every AST operation declares `execute`/`undo`/`redo` (matching the browser's actual `Operation` contract in `client/lib/canvas-engine/operations/Operation.ts`, not an `apply`/`invert` naming this repo doesn't use) — an idempotent-setter op still needs a REAL undo, not a no-op that trivially "round-trips". Category mismatch for the extension's file-snapshot-based `UndoRedoService` (`vscode-extension/hypercanvas-preview/src/services/UndoRedoService.ts`), where every mutation ingress opts into `_withUndoTracking` (`AstBridge.ts:158`) individually rather than through one registry. **First deliverable is the explicit decision**: migrate the extension to the op registry, or enumerate every extension mutation ingress and prove each one records an undo entry. Do not start the conformance test until that decision is recorded on the ticket. | Op-registry side: `S0 → execute → S1`, then assert `undo → S0` (real prior state, not the idempotent-setter false pass) and `redo → S1`, awaiting async writes. Extension side: per the decision above, either the same round-trip test on the migrated registry, or a test enumerating every mutation handler and asserting each one recorded an undo entry. |
| HYP-1045 | Normal (refs HYP-299) | `writeAndConfirm()` as the only sanctioned dispatcher — per the master spec's frozen-plan doctrine ([§7.4](../specs/2026-06-12-styles-system-master-spec.md)), `StyleWritePlanner.selectTarget()` resolves a frozen, ordered candidate list ONCE, up front; `writeAndConfirm()` never re-invokes `selectTarget()` reactively (that would be the "second engine" the spec forbids) — it walks the frozen list (write → verify → rollback → next), visible failure once the list is exhausted. Open decision for ticket pickup: whether Tailwind may ever appear as a later (non-first) candidate in that frozen list, since `style-write-planner.ts`'s current ordering already prefers it in some paths. | Unit: force every candidate in a frozen list to fail in turn, assert the caller gets a visible failure only once the list is exhausted, never a silent no-op — and assert the dispatcher never calls `selectTarget()` a second time mid-dispatch. |
| HYP-1049 | Normal, tech-debt | Core-purity dependency-cruiser gate (bans host-only imports — vscode API, node builtins — from shared/core browser-bundle logic); existing legitimate Node adapters (e.g. `shared/i18n-text/retarget/node-file-store.ts`, which does NOT follow a `*.node.ts` naming convention) are carved out via an explicit path/glob allowlist in the dependency-cruiser config, not a filename convention; keep the paused SaaS adapter typechecking in CI. | Gate test, two cases: (1) a deliberately added `import * as vscode` (or a bare Node builtin) inside a browser-bundle file under `shared/` fails the rule; (2) the existing `node-file-store.ts` Node import is NOT flagged because it's on the allowlist. Follow-up [HYP-1052](https://linear.app/glide-vc/issue/HYP-1052) tracks hardening this further (reachability fixtures proving browser-reachable code CANNOT transitively import the exempt module, not just that the exempt module itself is allowed). |

## 8. Phase 4 — Harness reliability (enables everything above)

| Ticket | Priority | What | TDD first step |
| --- | --- | --- | --- |
| HYP-769 | High | Playwright's pinned Chromium (145) is behind the system Chrome (148) — undermines every e2e result. | Pin versions to match; a smoke e2e run is green on the pinned version. |
| HYP-936 (cluster owner) + HYP-941 (blocked by 936) + GH hyper-ext-e2e #53/#54/#74 (cross-linked, not closed — distinct theories) | High / open | `closeVSCode` pid-capture returns 0 — orphaned Electron processes accumulate across runs. | Harness test: after `closeVSCode`, assert the launched Electron pid is no longer in the process list. |
| HYP-854 | Normal | e2e shard 1 wedges (hangs) partway through the suite. | Identify the wedging spec, add timeout/isolation, assert the shard completes without hanging. |
| HYP-938 | Normal | Demo-capture script hangs instead of failing loudly. | Run demo-capture under a hard timeout, assert it completes or fails loudly rather than hanging silently. |
| HYP-982 | Normal | Harness `clickInIframe` helper mis-targets elements (click-distance 1-3 downstream). | Unit: `clickInIframe` resolves the intended element's coordinates, not an offset target. |
| HYP-1031 | High | Drag onto a `col-span-2` grid cell reorders 0% of the time — `setPointerCapture` redirects the drag. | Unit sim: `setPointerCapture` + `pointerup` on the drag source, assert `elementFromPoint` resolves correctly (symptom already documented in `bulka-drag-rect-no-stale-lag.spec.ts:188-217`). |
| HYP-1032 | High | `drag-reorder.spec.ts` carries ~25 `test.skip`s with a false reason ("no pointer handlers" — handlers have existed since `13ff83fb`). | Un-skip `PI-5-DR-3` first; each un-skip is itself the next failing test to fix. |
| HYP-1033 | Normal | `hyper_delete_elements` MCP tool: 3 skipped e2e tests (`mcp-tools.spec.ts:262,285,308`). | Apply the documented `openExplorerAndSelect()` fix pattern, un-skip the first of the three. |
| HYP-1037 | Normal | Zoom controls have no `data-testid` (`PI-16-28`/`29` unconditionally `fixme`). | Add `data-testid` to the zoom controls, un-`fixme` both visual-regression cases. |
| HYP-1038 | Normal | bun-shadcn window-reload re-materialization was likely fixed by `0a539849` but never re-verified with a spec. | New spec: reload the VS Code window mid-session on the bun-shadcn project, assert preview re-materializes. |
| HYP-1039 | Low | 4 + 1 test files hardcode absolute paths: 4 confirmed (`fiber-utils.test.ts:414,432`; `react-adapter.test.ts:32`; `resolve-i18n-resource.test.ts:518`; `ComponentService-union-types.test.ts:20`) plus 1 lower-priority bonus (`bun-editing-demo.spec.ts:17`, self-referential). | Replace each hardcoded path with a computed/relative one; test still passes under a different home directory. |

## 9. CI debt sidebar

| Ticket | Priority | What | TDD first step |
| --- | --- | --- | --- |
| HYP-574 / HYP-892 / HYP-947 / HYP-888 (typecheck-gate chain; HYP-887 already closed as dup of HYP-888) | Ticket-hygiene cleanup (stale, not in-progress) | **Corrected 2026-07-18:** the extension `tsc` CI gate already landed (`ci.yml`'s `extension-build` job runs `npx tsc --noEmit -p ./` as its "Typecheck extension" step, merged in #638 for HYP-947) and is currently green on `main`. HYP-574/HYP-888/HYP-892/HYP-947 are all still open in Linear (Backlog/Backlog/Todo/In Progress respectively) despite the gate already shipping. | Not a new failing test — close out the four tickets referencing #638 as the landing commit, and confirm whether HYP-892's broader ask (root `bun run typecheck` itself covering the extension, vs. a separate CI job) is still wanted or now redundant. |
| HYP-1034 | Normal | `detectFrontendRoot` (`extension-provider-detection.ts:499`) has zero unit tests, and its regex only matches `/<dir>/main.[jt]sx?` — but hyperide's OWN `index.html` loads `/client/App.tsx`, a filename this pattern does NOT match, so it silently falls through to the `src/` default (wrong dir). `lib/preview-generator/preview-file-manager.ts:236` already carries a documented fix for this exact historical bug (filename-agnostic match, with a comment explaining the blank-preview regression it caused) — `extension-provider-detection.ts` never got the same fix, so the two detectors have diverged. A test file of the same name (`extension-provider-detection.test.ts`) already exists but covers a different function (`detectPreviewProviders`, HYP-782) — this is an EXTEND, not a new file. | Extend `extension-provider-detection.test.ts` with the LITERAL failing case first: `index.html` containing `<script type="module" src="/client/App.tsx">` must resolve to `client`, not `src` — this fails today. Then port `preview-file-manager.ts`'s filename-agnostic fix (or consolidate to one shared implementation) and add `src/` + malformed-`index.html` coverage. |
| HYP-1035 | Normal | The `NumericInput` convention (see AGENTS-CORE) is unenforced repo-wide; a known violation already exists (`PaddingControls.tsx:49` uses a raw `<Input type="text">` for a numeric padding value). **Caution:** `NumericInput`'s own arrow-key handler unconditionally clamps to `Math.max(0, …)` (`numeric-input.tsx:47`), unlike the existing property-aware helper (`RightSidebar/utils.ts`'s `NON_NEGATIVE_LENGTH_KEYS` set) which only clamps opacity/non-negative-length keys and allows negative margin/position values — a blanket migration would silently break negative-margin/position editing via arrow keys. | Static grep/AST-test over `client/components/RightSidebar/**/*.tsx` (recursive) asserting no raw numeric `<Input>`, distinguishing numeric CSS inputs from legitimate text/color inputs — first red case is the existing `PaddingControls.tsx:49` violation. Before migrating any negative-capable property (margin, position, inset, etc.), first fix `NumericInput`'s clamp to be property-aware like `utils.ts`, with a regression test for negative margin/position, non-negative dimensions, and bounded opacity. |
| HYP-1036 | Normal | The "keydown reaches the right target" invariant is untested on both platforms, and the two platforms redispatch differently — SaaS forwards a synthetic keydown from the iframe directly onto the host `document.body`; the extension's iframe posts a `hypercanvas:keydown` message that `useCanvasInteraction.ts` redispatches on the **webview `window`**, not `document.body`. | Two platform-specific tests, not one shared assertion: SaaS asserts the keydown lands on `document.body`; the extension asserts the redispatched event lands on the webview `window`. |
| HYP-1040 | Normal | `autonomous-interactive-bug-discovery.md` plan was never implemented (no `qa-matrix.yaml`, no `window.__hyperide__` contract). | Not a code ticket — decision ticket. Acceptance criterion: either build v1 (§1 of the plan) or formally close the plan doc. |
| HYP-1046 | Low | Hyper Logs user-facing panel is noisy — 112 entries, 39 visible, mostly `[selsurv]` overlay-paint debug and `[vite]` hot-update spam (no false errors, that part passes). | e2e: assert Hyper Logs shows 0 debug-tagged entries by default (filter behind a dev-only toggle). |

## 10. Definition of done for this blitz

1. The demo-path journey suite (HYP-1047) is green on consecutive cold-start runs.
2. Zero entries in the webview→host error channel (HYP-1041) during the journey run.
3. Every Phase 0 and Phase 1 ticket is closed with failing-test-first evidence attached.
4. Post-HYP-1006 re-QA of resize, undo/redo, drag-move, and window-reload flows is clean (all four
   were blocked by the imported-component-selection bug during this pass's QA sweep).

## 11. Process rules going forward

- **Bug → fixture rule.** No bug fix merges without a corpus fixture (component-zoo, HYP-1042) or a
  journey-test addition. A fix with no regression artifact is not considered closed.
- **Three-strikes rule.** The third point-fix in the same bug class (per the repeat-offender classes
  in §2) mandates opening the systemic ticket for that class instead of a fourth point-fix.
- **Class tag at triage.** Every new bug ticket gets tagged with its bug class (drag-resolution,
  source-mapping, selection-divergence, dev-server-lifecycle, injection-pollution, webview-bundle-leak,
  AST-traversal, style-write-routing, or "new class") at the moment it's triaged, not after the fact.

## 12. TDD discipline note

Every ticket in this plan falls into one of three buckets: it names a failing test directly in its
"TDD first step" column; it defers — where that column instead says "Per ticket AC", "pick one of N",
or describes a spike/decision — to acceptance criteria already written on its own Linear ticket, which
must itself name a concrete red test before work starts; or (the one exception, the §9 typecheck-gate
chain row) it is pure ticket-hygiene cleanup with no code change and therefore no test to name. Write
the test, confirm it fails for the stated reason, then implement the minimal fix that makes it pass.
Deferring to a ticket's own AC is not an exemption from naming a test, it is a pointer to where that
test is named; the ticket-hygiene exception is not a loophole for anything that touches code.
