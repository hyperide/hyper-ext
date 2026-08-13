---
id: dec-20260513-class-f-et17-tree-scroll
kind: DecisionRecord
version: 2
status: active
title: "Fix ET-17 — leaf tree item click doesn't scroll canvas from scrolled-to-bottom viewport"
mode: standard
created_at: 2026-05-13T11:30:00Z
updated_at: 2026-05-13T11:30:00Z
links:
  - ref: prob-20260513-class-f-et17-tree-scroll
    type: addresses
  - ref: ES.ARCH.001
    type: governs
---

# Fix ET-17 — leaf tree item click doesn't scroll canvas from scrolled-to-bottom viewport

## 1. Problem Frame

`"ET-17: clicking a small leaf tree item from scrolled-down viewport scrolls canvas to it"` fails in S1 (2 failures, `[independent]` project). The B8 fix in v0.1.45 (hypercanvas:treeSelect → goToVisual → scrollIntoView) made ET-16 pass but ET-17 still fails.

ET-17 specifically: forces iframe `scrollTop` to maximum, stubs `Element.prototype.scrollIntoView` for instant behavior, clicks a leaf tree item (short label ≤2 chars or last item), polls 8s for `document.scrollTop !== initialScrollY`. The test FAILS (not skips) — `initialScrollY > 0` but scroll doesn't change.

**4 hypotheses:**
- **H1:** `data-uniq-id` not present on the leaf element — goToVisual can't find the DOM target
- **H2:** scrollIntoView stub set on wrong frame origin — nested iframe bypasses the stub, smooth scroll loses the race
- **H3:** selected "leaf" is near viewport top despite scroll-to-bottom — scrollIntoView moves scrollTop back near 0, assertion compares against wrong baseline
- **H4:** `hypercanvas:goToVisual` bridge message dropped — listener lost after iframe reload

## 2. Decision

**Selected:** Add diagnostics to goToVisual handler (console.log of found element + whether scrollIntoView fires) and run ET-17 in isolation to capture which hypothesis holds. Then fix based on findings.

**Why selected:** The fix differs completely for each hypothesis — diagnosing first avoids shipping the wrong fix. The diagnostic pass costs one isolated E2E run.

**Affected files (diagnostic):**
- `vscode-extension/hypercanvas-preview/src/services/scripts/iframe-interaction.ts`

**Affected files (fix, conditional on hypothesis):**
- H1: `ext-test-projects/e2e/tests/project-independent/elements-tree-selection.spec.ts` (pick leaf with confirmed data-uniq-id) or `iframe-interaction.ts` (fallback to parent)
- H2: `elements-tree-selection.spec.ts` (remove scrollIntoView stub, use longer poll)
- H3: `elements-tree-selection.spec.ts` (pick guaranteed off-screen leaf)
- H4: `vscode-extension/hypercanvas-preview/src/services/usePreviewBridge.ts` (re-register listener after reload)

**Forbidden:**
- Changes to ET-16

**Evidence requirements:**
- `HYPER_E2E_SHARDS=1 bun run test:docker --grep "ET-17"` — passes with retry rate 0
- ET-17-before-click.png: iframe scrolled to bottom
- ET-17-after-click.png: leaf visible, scroll position changed

## 3. Rationale

**Counterargument:** Trying all 4 fixes sequentially without diagnostics would be faster if one of them is obviously correct. Rejected: H1–H4 are mutually exclusive in their fixes; applying H1 fix when H2 is the cause leaves the test flaky.

**Rejected alternatives:**
| Variant | Verdict | Reason |
|---------|---------|--------|
| Increase poll from 8s to 20s | Rejected | If scrollIntoView is never called, no amount of polling helps. |
| Skip ET-17 as flaky | Rejected | It was written explicitly to catch the gap left by the ET-16 fix. |

**Weakest link:** Diagnostic console.log must be reachable in Docker E2E — iframe console output goes to `docker.log` only if the bridge relays it. Verify with `grep "[goToVisual]" docker.log`.

## 4. Consequences

**Rollback plan:**
- If diagnostics can't be read from docker.log: add `postMessage` from iframe to extension host to surface the log, or add a test-visible attribute to the found element.

**Refresh triggers:**
- Changes to goToVisual handler or hypercanvas:treeSelect dispatch
- Changes to ElementsTree click handling
- New leaf element types added (text nodes, icons without wrapper)
