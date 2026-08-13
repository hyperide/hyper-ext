/**
 * @file AST update utilities — style and prop updates.
 *
 * HYP-901 verify-and-retry: when the style-write target is a custom component that doesn't
 * forward `style`/`className` to the DOM (the canonical repro: `<HostRoutePage>`, a layout
 * wrapper with no `style` prop and no `...rest` spread — a background-color edit landed in a
 * dead prop and never rendered), this used to WARN after writing the dead prop anyway. Alex
 * rejected that (tg#6243): the master spec (docs/specs/2026-06-12-styles-system-master-spec.md
 * §8.1 "VTSWR" / §9.2a "A1 forward-detector") already covers this — try a candidate, verify it
 * actually landed, and if not, roll back and try the NEXT candidate automatically. A warning is
 * the LAST resort, not the first response. `updateStyles` now runs that chain:
 *   1. Static pre-write check (style-forwarding-check.ts): a high-confidence "doesn't forward"
 *      verdict is a pre-write EXCLUSION (§9.2a) — skip the direct write, it would be dead code.
 *   2. Direct write (today's only path) when the static check says `forwards` or can't tell
 *      (`unknown`) — unchanged behavior, no runtime verify gating (see NOTE below).
 *   3. Auto-wrap candidate (style-wrap-retry.ts) when the static check says `not-forwarding`:
 *      wrap the JSX call site itself in a transparent `<div style={...}>` (never the component's
 *      OWN definition, which would leak the change to every other usage) and verify THAT landed.
 *   4. Only once wrap is ineligible or fails to verify does this surface the last-resort warning
 *      — and by then the file is restored to its pre-edit content, never left with debris.
 *   5. HYP-1162 — cascade-inert utility escalation (direct path, verify-gated): a dev server
 *      whose stylesheets nest the Tailwind preflight inside a cascade layer that OUTRANKS the
 *      top-level `utilities` layer (live-verified on conloca: cms-spa main.css declares
 *      `@layer …, utilities, cms-admin, …` and nests the whole Tailwind stack — preflight's
 *      `* { margin:0; padding:0 }` included — inside `@layer cms-admin`) makes every NEWLY
 *      WRITTEN utility class cascade-inert: the HMR round-trip works end-to-end (vite pushes
 *      the css-update, the iframe swaps the stylesheet, the DOM class appears) but the rule
 *      never wins the cascade, so the computed style never changes. When the live preview
 *      verify PROVES the class write did not land, the same edit is escalated to an inline
 *      `style={{…}}` override on the element (inline beats all cascade layers) — the same
 *      redirect style-write-executor already applies for inline/var/module-driven writes.
 *      The class write is NOT rolled back (it is inert but harmless, and a future stylesheet
 *      fix reactivates it); the escalation only fires on a PROVEN failure (verify provider
 *      wired + value unchanged after the poll budget), so a slow-HMR false positive costs an
 *      inline duplicate of the intended value, never a lost edit.
 *
 * NOTE on scope: step 2 does NOT gate on runtime verify even when `deps.verifyComputedStyle` is
 * available. This repo's only computed-style read today is a simple before/after diff (no HMR-
 * settle retries, no cascade-owner toggle-probe — the master spec's §9.3 "settle handshake" and
 * §9.2 "proof level" are explicitly PLANNED, not built). Gating the COMMON case (`forwards`) on
 * that weak signal would trade a real regression (rolling back correct edits on slow HMR) for a
 * rare upside. Verify is used ONLY where step 1 already gives a high-confidence reason to
 * distrust the write (`not-forwarding`) — there, a false "didn't land" just costs a wrapper we
 * fall back from; a false "landed" costs nothing worse than today's baseline.
 */

import generate from '@babel/generator';
import type * as t from '@babel/types';
import { applyInlineStyleUpdate } from '@lib/ast/inline-style-mutator';
import { findElementByPosition } from '@lib/ast/position-finder';
import { executeStyleWriteRequest } from '@lib/style-write/style-write-executor';
import { runStyleWriteTransaction } from '@lib/style-write/transaction/index.node';
import { isJsxSourceFile, jsxOpeningTagName } from './ast-utils';
import type { ColorProbeCandidate } from './color-probe-types';
import { buildNonForwardingWarningMessage, checkStyleForwarding } from './style-forwarding-check';
import {
  applyWrapCandidate,
  hasOnlyChildVerifiableProperties,
  isWrapEligible,
  unwrapStyleWrapper,
} from './style-wrap-retry';
import type { NodeRef } from '@shared/element-tracing/types';
import type { CssSystemId } from '@lib/style-read/types';
import type { FileIO } from '@lib/ast/file-io';
import { parseCode } from '@lib/ast/parser';
import type { StyleForwardingWarning } from '@shared/types/style-forwarding-warning';
import { resolveWorkspacePath } from './workspace-path';
import type { FindElementResult } from '@lib/types';

export interface UpdateStylesDeps {
  workspaceRoot: string;
  /** HYP-1012 monorepo follow-up — widens containment past `workspaceRoot` (see workspace-path.ts). */
  additionalWorkspaceRoot?: string;
  fileIO: FileIO;
  resolveElementInCorrectFile: (
    absolutePath: string,
    nodeRef: NodeRef,
  ) => Promise<{ result: FindElementResult; ast: t.File; resolvedPath: string } | null>;
  updateNodeMap: (filePath: string) => Promise<void>;
  /** HYP-544 Phase 3 — ranked driving candidates from the empirical color-probe (unresolvable case). */
  probeDriving?: ColorProbeCandidate[];
  /**
   * UIKit-derived project default CSS system (e.g. a Tailwind project → 'tailwind-v4'). Threaded from
   * the extension host's project capabilities so a SURFACELESS element (no existing className/style)
   * floors to the project's system under Auto/Computed routing instead of a silent inline `style={{}}`
   * (D2 §4.3). Mirrors the SaaS batch route, which already carries this from the inspector's UIKit.
   * Undefined for non-UIKit projects — the write cascade falls through to a detected system, then inline.
   */
  projectDefaultCssSystem?: CssSystemId;
  /** HYP-901 — tsconfig path-alias map lookup, threaded to the non-forwarding-component pre-write
   *  check so it resolves imports the same way "Go to main component" (HYP-563) does. */
  getAliasMap?: (importerFilePath: string) => Record<string, string>;
  /**
   * HYP-901 B1-lite — reads live computed style for `cssProperties` on `elementId` from the
   * preview iframe (VS Code: host→preview-panel→iframe RPC; see PreviewPanel.requestComputedStyleSnapshot).
   * Returns null when unavailable (no live preview, timeout, unsupported realm) — absence is NOT
   * a verify failure, it means "can't verify", and the auto-wrap candidate is then kept
   * best-effort (still strictly better than the direct write it replaced, which we already know
   * is dead). Always reads occurrence 0 — repeated-list (`.map()`) disambiguation is a known,
   * explicitly deferred gap (see the ticket's follow-up note).
   */
  verifyComputedStyle?: (elementId: string, cssProperties: string[]) => Promise<Record<string, string> | null>;
  /** Test seam: override the HMR-settle poll budget (defaults VERIFY_POLL_DELAY_MS/MAX_ATTEMPTS). */
  verifyPollBudget?: { delayMs: number; maxAttempts: number };
  /**
   * HYP-987 P1 #3 — the iframe-relative (pre-re-root) elementId to address the preview iframe's
   * `findElementsByRef` for the write-verify RPC, threaded per call from PanelRouter. In a
   * monorepo this differs from the RE-ROOTED `elementId` the AST write uses; verify must use this
   * one or the iframe resolves nothing and the verify silently no-ops. Falls back to `elementId`
   * when absent (non-monorepo, or a direct PreviewPanel call that bypasses PanelRouter).
   */
  verifyElementId?: string;
}

export type UpdateStylesResult =
  | {
      success: true;
      resolvedPath: string;
      contentBeforeWrite: string | undefined;
      /** HYP-901 — present ONLY once direct write + auto-wrap have both been tried/excluded and
       *  rolled back; the file is unchanged from before this edit. */
      warning?: StyleForwardingWarning;
      /** HYP-987 P1 (codex) — set on a warn/rollback exit so `_withUndoTracking` records no undo
       *  entry (the op does not own the file's final content; see ast-types.ts). */
      skipUndoTracking?: boolean;
    }
  | { success: false; error: string };

export async function updateStyles(
  filePath: string,
  elementId: string,
  styles: Record<string, string>,
  state: string | undefined,
  nodeRef: NodeRef | undefined,
  selectedSourceTabId: string | undefined,
  domClasses: string | undefined,
  deps: UpdateStylesDeps,
): Promise<UpdateStylesResult> {
  const absolutePath = resolveWorkspacePath(
    deps.workspaceRoot,
    filePath,
    undefined,
    deps.additionalWorkspaceRoot ? [deps.additionalWorkspaceRoot] : [],
  );
  const effectiveNodeRef = nodeRef ?? (elementId as NodeRef);

  const resolved = await deps.resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
  if (!resolved) {
    return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
  }
  const { result, ast, resolvedPath } = resolved;

  let contentBeforeWrite: string | undefined;
  if (resolvedPath !== absolutePath) {
    try {
      contentBeforeWrite = await deps.fileIO.readFile(resolvedPath);
    } catch {}
  }

  const forwardCheck = await checkStyleForwarding({
    ast,
    filePath: resolvedPath,
    element: result.element,
    fileIO: deps.fileIO,
    aliasMap: deps.getAliasMap?.(resolvedPath) ?? {},
  });

  if (forwardCheck.kind !== 'not-forwarding') {
    return writeDirectCandidate(
      { elementId, styles, state, selectedSourceTabId, domClasses, ast, result, resolvedPath },
      deps,
      contentBeforeWrite,
    );
  }

  return retargetNonForwardingWrite(
    {
      elementId,
      styles,
      state,
      displayName: forwardCheck.displayName,
      ast,
      result,
      resolvedPath,
    },
    deps,
    contentBeforeWrite,
  );
}

interface DirectCandidateInput {
  elementId: string;
  styles: Record<string, string>;
  state: string | undefined;
  selectedSourceTabId: string | undefined;
  domClasses: string | undefined;
  ast: t.File;
  result: FindElementResult;
  resolvedPath: string;
}

/**
 * Candidate 1 — write through the shared style-write planner/executor, B0-transactional.
 * HYP-1162: when a live-preview verify is wired and PROVES the write never changed the computed
 * style (cascade-inert utility — see the file header step 5), escalate the same edit to an
 * inline `style={{…}}` override, the only write that beats an arbitrarily hostile layer stack.
 */
async function writeDirectCandidate(
  input: DirectCandidateInput,
  deps: UpdateStylesDeps,
  contentBeforeWrite: string | undefined,
): Promise<UpdateStylesResult> {
  const cssProperties = Object.keys(input.styles);
  // HYP-987 P1 #3 — verify addresses the iframe by its PRE-re-root id (threaded per call), same
  // as the non-forwarding path; both ids coincide outside a monorepo sub-project.
  const verifyElementId = deps.verifyElementId ?? input.elementId;
  const canVerify = !!deps.verifyComputedStyle && isBaseState(input.state) && cssProperties.length > 0;
  // Snapshot BEFORE the class write — the after-write polls compare against this to PROVE
  // landing (or non-landing) instead of assuming it.
  const beforeSnapshot = canVerify
    ? await deps.verifyComputedStyle?.(verifyElementId, verifyRequestKeys(cssProperties)).catch(() => null)
    : null;

  const writeResult = await runStyleWriteTransaction({
    execute: executeStyleWriteRequest,
    baseFileIO: deps.fileIO,
    request: {
      ast: input.ast,
      sourceFilePath: input.resolvedPath,
      element: input.result.element,
      styles: input.styles,
      state: input.state,
      selectedSourceTabId: input.selectedSourceTabId,
      domClasses: input.domClasses,
      probeDriving: deps.probeDriving,
      projectDefaultCssSystem: deps.projectDefaultCssSystem,
      runtimeThemeContext: { ideThemePreference: 'system', resolvedColorScheme: 'light', source: 'vscode' },
      projectRoot: deps.workspaceRoot,
      additionalProjectRoots: deps.additionalWorkspaceRoot ? [deps.additionalWorkspaceRoot] : undefined,
    },
  });
  if (writeResult.success === false) return { success: false, error: writeResult.error };

  for (const mutatedFile of writeResult.mutatedFiles) {
    if (isJsxSourceFile(mutatedFile)) await deps.updateNodeMap(mutatedFile);
  }

  // HYP-1162 — the class write is on disk but that says nothing about the CASCADE. Only escalate
  // on a PROVEN non-landing (`false`); `null` (no verify capability / read error) keeps today's
  // best-effort behavior, and `true` means HMR delivered — nothing more to do. A transaction that
  // mutated nothing is a no-op repeat write — verifying it would read an unchanged-computed edit
  // as "didn't land" and escalate a duplicate, so it skips verify entirely.
  if (beforeSnapshot && writeResult.mutatedFiles.length > 0) {
    // Ownership baseline for the escalation's CAS check, captured BEFORE the verify window
    // opens: the escalation re-reads the file ~VERIFY_POLL_DELAY_MS × VERIFY_POLL_MAX_ATTEMPTS
    // later and must refuse to write when the bytes no longer match — a concurrent save in
    // that window is foreign content this op must not absorb (P1, HYP-1023 family).
    const postClassWriteContent = await deps.fileIO.readFile(input.resolvedPath).catch(() => null);
    const landed = await verifyLanded(deps, verifyElementId, cssProperties, beforeSnapshot);
    if (landed === false) {
      const escalation = await escalateCascadeInertWrite(
        input,
        deps,
        cssProperties,
        verifyElementId,
        beforeSnapshot,
        postClassWriteContent,
      );
      if (escalation) {
        return {
          success: true,
          resolvedPath: input.resolvedPath,
          contentBeforeWrite,
          ...(escalation.warning ? { warning: escalation.warning } : {}),
          ...(escalation.skipUndoTracking ? { skipUndoTracking: true } : {}),
        };
      }
    }
  }
  return { success: true, resolvedPath: input.resolvedPath, contentBeforeWrite };
}

/** What the cascade-inert escalation resolved about the file's ownership: an advisory warning
 *  when one needs surfacing, and skipUndoTracking whenever the op cannot PROVE it owns the final
 *  content — the same rule the wrap path applies (a coarse whole-file undo entry recorded over
 *  foreign content would erase that content on the next Undo). Undefined means the escalation
 *  never touched the file and the plain class-write undo entry is correct. */
interface EscalationOutcome {
  warning?: StyleForwardingWarning;
  skipUndoTracking?: boolean;
}

/**
 * HYP-1162 — the direct class write provably lost the cascade (see file header step 5). Re-parse
 * the current file, re-find the SAME element by position (the class write only touched its
 * className, so the opening-element start position is stable), and merge the edit into its
 * inline `style` — the universal floor that no stylesheet layer stack can outrank. The inert
 * class is kept (harmless; reactivates if the stylesheet's layer order is ever fixed), matching
 * the executor's documented literal-className + inline-style coexistence contract.
 *
 * The element name for the persistent-failure warning comes from the opening tag. The outcome
 * carries a StyleForwardingWarning when the escalation was aborted (concurrent save) or when even
 * the inline override could not be proven to land — the strongest possible write is on disk by
 * then, so the file is kept and the warning is advisory.
 */
async function escalateCascadeInertWrite(
  input: DirectCandidateInput,
  deps: UpdateStylesDeps,
  cssProperties: string[],
  verifyElementId: string,
  beforeSnapshot: Record<string, string>,
  postClassWriteContent: string | null,
): Promise<EscalationOutcome | undefined> {
  const tagName = jsxOpeningTagName(input.result.element.openingElement.name) ?? 'element';
  const currentContent = await deps.fileIO.readFile(input.resolvedPath).catch(() => null);
  const targetLoc = input.result.element.loc;
  if (currentContent === null || !targetLoc) return undefined;

  // Ownership CAS over the verify window between the class write and now (P1, HYP-1023 family):
  // this path writes a WHOLE-FILE reprint, so if a user/formatter save landed in that window the
  // reprint would fold their edit into this op's result and the undo tracker would record the
  // pre-op snapshot against the combined content — the next Undo would erase their save. A
  // line-shifting save can also make targetLoc resolve a DIFFERENT element. Abort instead: the
  // inert-but-harmless class write stays, the concurrent edit is preserved, the node map is
  // refreshed to the foreign content, and undo tracking is skipped because this op no longer
  // owns the file's final content. A null baseline (the post-write read failed) fails closed.
  if (postClassWriteContent === null || currentContent !== postClassWriteContent) {
    await deps.updateNodeMap(input.resolvedPath);
    return {
      warning: {
        componentName: tagName,
        message:
          `The style was written as a utility class on <${tagName}>, but the live preview did not show the ` +
          `change, and the file was modified by a concurrent save before the inline-style escalation could ` +
          `be applied. The escalation was skipped so that save is not overwritten — re-apply the style edit to retry.`,
      },
      skipUndoTracking: true,
    };
  }

  let freshAst: t.File;
  try {
    freshAst = parseCode(currentContent);
  } catch {
    return undefined; // unparseable concurrent save — never touch a file we can't read safely.
  }
  const freshResult = findElementByPosition(freshAst, targetLoc.start.line, targetLoc.start.column);
  if (!freshResult) return undefined;

  const applied = applyInlineStyleUpdate(freshResult.element, input.styles);
  if (applied.length === 0) return undefined;
  // Plain @babel/generator reprint, deliberately NOT the format-preserving recast
  // fileParser.writeAST pair: recast's incremental reuse-original-bytes heuristic corrupts this
  // mutation shape (verified live in AstServiceCascadeInertEscalation — closing tags dropped,
  // `}}Git identity` glue), the same failure mode the wrap candidate documents. Correct-but-
  // reformatted beats byte-faithful-but-corrupted.
  const generatedCode = generate(freshAst).code;
  await deps.fileIO.writeFile(input.resolvedPath, generatedCode);
  await deps.updateNodeMap(input.resolvedPath);

  const landed = await verifyLanded(deps, verifyElementId, cssProperties, beforeSnapshot);

  // The wrap path's clean-land ownership rule, applied to the escalation's OWN verify window: a
  // concurrent save landing after our write is not clobbered (it reached disk after us), but the
  // coarse whole-file undo tracker would absorb it into this op's undo entry and Undo would erase
  // it — so skip undo tracking whenever ownership is not PROVEN clean, and refresh the node map
  // (refreshed to our output above) when the disk diverged.
  const postContent = await deps.fileIO.readFile(input.resolvedPath).catch(() => null);
  const cleanLand = postContent === generatedCode;
  if (!cleanLand && postContent !== null) await deps.updateNodeMap(input.resolvedPath);

  return {
    ...(landed === false
      ? {
          warning: {
            componentName: tagName,
            message:
              `The style was written as an inline style override on <${tagName}> because the project's stylesheet ` +
              `layers made the utility class lose the cascade, but the live preview still does not show the change. ` +
              `The element may be re-rendered from cached data or covered by another layer.`,
          },
        }
      : {}),
    ...(cleanLand ? {} : { skipUndoTracking: true }),
  };
}

interface RetargetInput {
  elementId: string;
  styles: Record<string, string>;
  /** HYP-987 P1 #4 — the edited pseudo-state. A wrapper `<div>` carries only inline `style`,
   *  which is BASE-STATE only (master spec §8.3): a `:hover`/`:focus`/… edit CANNOT be a
   *  wrapper-inline write, so a non-base state must warn instead of silently wrapping (which
   *  would make a hover edit a permanently-active base-state background). */
  state: string | undefined;
  displayName: string;
  ast: t.File;
  result: FindElementResult;
  resolvedPath: string;
}

/** Base state = no pseudo-state, i.e. what a wrapper's inline `style` can legitimately carry.
 *  Same predicate as `style-write-executor.ts`'s inline `isBaseState` (kept local rather than
 *  exported from that shared module to avoid touching the core executor for a one-line guard);
 *  any real pseudo-state (`hover`, `focus`, `active`, `focus-visible`, `disabled`) is
 *  inexpressible as inline (master spec §8.3). */
function isBaseState(state: string | undefined): boolean {
  return !state || state === 'base';
}

/**
 * `backgroundColor` is the ONE edited key whose wrap-landing is judged by `effectiveBackgroundColor`
 * (painted-through) rather than the element's own never-inheriting computed value (HYP-987 P1 #1).
 * Deliberately NOT `background`/`backgroundImage` (HYP-987 P1 codex): `effectiveBackgroundColor`
 * resolves only colours — it ignores images/gradients — so using it for an image wrap would
 * false-rollback a genuinely-visible image. Those fall through to the own-value comparison, which
 * for a non-inheriting property on the covered/uninjectable child rarely changes, so an
 * image/gradient wrap fails-closed to the warning rather than being kept unverified. That is the
 * documented floor: image/gradient auto-wraps warn instead of silently keeping.
 */
const EFFECTIVE_BG_VERIFY_PROPERTIES: ReadonlySet<string> = new Set(['backgroundColor']);

/**
 * Candidate 2 — the static check already excluded the direct write (it would be dead code on a
 * component that doesn't forward style/className). Try wrapping the call site in a transparent
 * `<div style={...}>` instead, verify it actually rendered the change, and fall back to the
 * last-resort warning (file left untouched) only once that's exhausted.
 *
 * Deliberately does NOT reuse `input.ast`/`input.result` for the mutation — it re-parses the
 * file's current content fresh and re-finds the target element by position first. `input.ast`'s
 * NodePath came from an EARLIER resolve/traverse pass (`updateStyles`'s own
 * `resolveElementInCorrectFile` call, before the static forward-check ran); reusing it here to
 * drive `NodePath.replaceWith` produced GARBLED output — mangled attributes, stripped child
 * tags — but ONLY when this code path ran as the second (or later) `AstService` operation within
 * the same test process, never in isolation (confirmed via extensive bisection: identical
 * source content is not the trigger, real-vs-fake timers are not the trigger, generate() call
 * count is not the trigger — only "an earlier resolve+traverse happened first in this process"
 * correlates). `@babel/traverse` keeps a process-wide NodePath cache
 * (`@babel/traverse/lib/path/cache.js`, a module-level WeakMap) precisely so repeated traversals
 * of structurally-similar trees can reuse NodePath wrappers; the leading theory is a stale/
 * incorrectly-shared entry from that cache, though the exact mechanism wasn't fully isolated
 * within this fix's budget — flagged as a follow-up for whoever owns `lib/ast/traverser.ts`.
 * Re-parsing fresh right before this specific mutation sidesteps it entirely: a brand new
 * `t.File` and a brand new position-based find guarantee this NodePath was never touched by any
 * earlier operation in the process.
 */
async function retargetNonForwardingWrite(
  input: RetargetInput,
  deps: UpdateStylesDeps,
  contentBeforeWrite: string | undefined,
): Promise<UpdateStylesResult> {
  const cssProperties = Object.keys(input.styles);
  const warning: StyleForwardingWarning = {
    componentName: input.displayName,
    message: buildNonForwardingWarningMessage(input.displayName),
  };
  // Every warn/rollback exit is a no-op from the user's intent, so it must NOT record an undo
  // entry (HYP-987 P1 codex): a wrap that landed leaves `skipUndoTracking` unset below.
  const warned: UpdateStylesResult = {
    success: true,
    resolvedPath: input.resolvedPath,
    contentBeforeWrite,
    warning,
    skipUndoTracking: true,
  };

  // HYP-987 P3 (codex) — an empty style set has nothing to apply; never insert an empty
  // `<div style={{}}>` wrapper (which would be permanent debris the verify treats as unverifiable).
  if (cssProperties.length === 0) return warned;

  // HYP-987 P1 #4 — a wrapper's inline `style` is base-state only; a pseudo-state edit
  // (`:hover`/`:focus`/…) cannot be expressed by wrapping (master spec §8.3), so wrapping it
  // would silently turn a hover edit into a permanently-active base-state background. Warn
  // instead of writing an inexpressible wrap.
  if (!isBaseState(input.state)) return warned;

  if (!hasOnlyChildVerifiableProperties(input.styles) || !isWrapEligible(input.result)) {
    // Only auto-wrap properties whose landing is observable from the wrapped child (so the verify
    // can actually prove it applied). A property the child never reflects (opacity, borders,
    // shadow) or a layout-affecting one (master spec §11.4 guards 4/5/12) surfaces the warning
    // instead of an unverifiable wrap. Same treatment for a `ref`/`key`-bearing element or a
    // structurally-constrained parent.
    return warned;
  }

  // HYP-987 P1 #3 — verify addresses the iframe by its PRE-re-root id (threaded per call), not the
  // re-rooted `elementId` the AST write uses. Both are the same outside a monorepo sub-project.
  const verifyElementId = deps.verifyElementId ?? input.elementId;
  // HYP-987 P1 (codex/fable) — request the SAME keys we compare (bg maps to effectiveBackgroundColor),
  // so verify does not depend on the provider returning a key it was never asked for.
  const requestKeys = verifyRequestKeys(cssProperties);

  // Snapshot BEFORE mutating — this is what a failed verify restores, so the wrap candidate
  // never leaves debris (surgical rollback, master spec §8.1 property 3).
  const originalContent = await deps.fileIO.readFile(input.resolvedPath);
  const beforeSnapshot = await deps.verifyComputedStyle?.(verifyElementId, requestKeys).catch(() => null);

  const targetLoc = input.result.element.loc;
  if (!targetLoc) return warned;
  const freshAst = parseCode(originalContent);
  const freshResult = findElementByPosition(freshAst, targetLoc.start.line, targetLoc.start.column);
  if (!freshResult) return warned;

  const wrapped = applyWrapCandidate(freshResult, input.styles);
  if (!wrapped) return warned;
  // Plain @babel/generator, NOT the format-preserving recast `printAST`/`fileParser.writeAST`
  // the rest of this codebase uses: re-nesting an EXISTING node one level deeper (inside the new
  // wrapper) is exactly the shape recast's incremental "reuse original source bytes" heuristic
  // gets wrong — it spliced stale byte ranges from the pre-wrap position and corrupted the
  // output (confirmed while building this feature; see style-wrap-retry.ts's file header for the
  // full repro). A full reprint reformats the whole file, which is an acceptable, explicitly-
  // scoped trade-off for this rare last-resort path — correct-but-reformatted beats byte-
  // faithful-but-corrupted.
  const generatedCode = generate(freshAst).code;
  await deps.fileIO.writeFile(input.resolvedPath, generatedCode);
  // Refresh the NodeMap to the wrapped state right after the write (HYP-987 P2, codex): a
  // concurrent AST operation during the multi-second verify window would otherwise resolve
  // nodeRefs against pre-wrap line/column positions.
  await deps.updateNodeMap(input.resolvedPath);

  const landed = await verifyLanded(deps, verifyElementId, cssProperties, beforeSnapshot ?? null);
  if (landed !== false) {
    // Verified-landed wrap: a real edit that should be undoable — record a normal undo entry.
    // BUT if a concurrent edit landed during the verify window (disk no longer matches our wrap
    // output) OR the ownership read FAILED (unknown), the coarse whole-file undo tracker would
    // absorb that foreign content into THIS op's undo entry, so Undo would erase the concurrent
    // edit; skip undo tracking whenever ownership is not PROVEN clean (HYP-987 P1 codex).
    const postContent = await deps.fileIO.readFile(input.resolvedPath).catch(() => null);
    const cleanLand = postContent === generatedCode;
    // A concurrent edit landed during the verify window → the NodeMap (refreshed to our wrapped
    // output after the write) is stale vs the on-disk content; refresh it (HYP-987 P2 codex).
    if (!cleanLand && postContent !== null) await deps.updateNodeMap(input.resolvedPath);
    return {
      success: true,
      resolvedPath: input.resolvedPath,
      contentBeforeWrite,
      ...(cleanLand ? {} : { skipUndoTracking: true }),
    };
  }

  // Wrap didn't visibly help — roll it back (HYP-987 P1). Cases, in order:
  //  - Read of the current file FAILED → leave it untouched (a blind restore could clobber a
  //    concurrent edit).
  //  - File is still byte-for-byte our wrap output (nothing else touched it) → restore the exact
  //    pre-edit content and refresh the NodeMap.
  //  - File DIFFERS (a formatter reformatted our write, or a concurrent edit landed) → do NOT trust
  //    a byte-for-byte CAS (it would misread a reformat as foreign and leave the wrapper as dead
  //    debris). SURGICALLY remove exactly the wrapper we inserted, preserving unrelated concurrent
  //    edits (master spec §8.1 property 3). If the wrapper is not uniquely findable (ambiguous
  //    duplicate) or the content no longer parses, leave the file untouched — a stale rollback must
  //    never clobber a newer edit (§9.4 supersession); the wrapper MAY remain.
  // HYP-987 P1 (codex): this whole warn/rollback exit ALWAYS skips undo tracking. The coarse undo
  // tracker records the net whole-file diff, so recording anything when a concurrent edit is (or may
  // be) present would let Undo erase that foreign content. A leftover wrapper in the rare uncertain
  // case (read/parse failure, ambiguous) is surfaced by the warning and covered by HYP-990 (the
  // atomic-transaction + precise-inverse follow-up); it is the lesser evil than erasing user work.
  const childTag = jsxOpeningTagName(input.result.element.openingElement.name);
  const currentContent = await deps.fileIO.readFile(input.resolvedPath).catch(() => null);
  if (currentContent === generatedCode) {
    await deps.fileIO.writeFile(input.resolvedPath, originalContent);
    await deps.updateNodeMap(input.resolvedPath);
  } else if (currentContent !== null && childTag) {
    await surgicallyRollBack(deps, input.resolvedPath, currentContent, input.styles, childTag);
  }
  return warned;
}

/**
 * Re-parse `currentContent`, surgically remove the `<div style={styles}>` wrapper around `childTag`,
 * and write the result:
 *  - `removed`   → unwrap it and write the result.
 *  - `absent`    → no matching wrapper present (a concurrent edit already removed it) → nothing to
 *                  write, but the disk content differs from the wrapped state the NodeMap was last
 *                  refreshed to, so REFRESH the NodeMap (HYP-987 P2 codex — a stale map would resolve
 *                  later nodeRefs against the discarded wrapper's positions).
 *  - `ambiguous` → the wrapper may still be on disk; leave the file untouched (a stale rollback must
 *                  never clobber a newer edit — §9.4 supersession), but still refresh the NodeMap to
 *                  the current on-disk content.
 * parse-failure → cannot touch the file; the NodeMap stays as-is (the content is unparseable).
 */
async function surgicallyRollBack(
  deps: UpdateStylesDeps,
  resolvedPath: string,
  currentContent: string,
  styles: Record<string, string>,
  childTag: string,
): Promise<void> {
  let rollbackAst: t.File;
  try {
    rollbackAst = parseCode(currentContent);
  } catch {
    return; // partial/dirty save — cannot safely roll back; wrapper may remain.
  }
  if (unwrapStyleWrapper(rollbackAst, styles, childTag) === 'removed') {
    await deps.fileIO.writeFile(resolvedPath, generate(rollbackAst).code);
  }
  // Refresh the NodeMap for every parseable outcome: on `removed` it now reflects the unwrapped
  // file; on `absent`/`ambiguous` the file was left as the concurrent content, which differs from
  // the wrapped state the map was refreshed to after the wrap write.
  await deps.updateNodeMap(resolvedPath);
}

/** Wait budget for HMR to actually apply a write before reading computed style — mirrors the
 *  SaaS realm's `POST_HMR_DELAY_MS`/`HMR_VERIFY_MAX_RETRIES` (client/lib/style-change-detector.ts).
 *  The master spec's real settle handshake (§9.3 — a writeId-stamped sentinel, correlated to the
 *  exact edit) is PLANNED, not built; this is the same pragmatic fixed-delay poll already shipped
 *  for the SaaS toast path, not a new invented mechanism. */
const VERIFY_POLL_DELAY_MS = 300;
const VERIFY_POLL_MAX_ATTEMPTS = 4;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * The computed-style key whose CHANGE proves an edited property landed on the wrapped child:
 * `backgroundColor` maps to `effectiveBackgroundColor` (painted-through — the child's OWN
 * backgroundColor never changes since bg does not inherit; HYP-987 P1 #1); every other verifiable
 * property (inherited props, custom properties) is proven by its own computed value changing.
 */
function verifyComparisonKey(property: string): string {
  return EFFECTIVE_BG_VERIFY_PROPERTIES.has(property) ? 'effectiveBackgroundColor' : property;
}

/** The deduped set of computed-style keys to REQUEST from the provider for `cssProperties`. */
function verifyRequestKeys(cssProperties: string[]): string[] {
  return [...new Set(cssProperties.map(verifyComparisonKey))];
}

/**
 * Compares live computed style before/after a candidate write, polling a few times so a normal
 * HMR round-trip isn't misread as "didn't land" (see {@link VERIFY_POLL_DELAY_MS}). `null` before-
 * snapshot (no verify capability, or the pre-write read failed) means "can't verify" → `null`
 * (keep, best-effort). Otherwise `true` as soon as EVERY edited property's proof key has changed
 * from the before-snapshot, `false` when they still match after every poll attempt.
 *
 * HYP-987 P1 (codex) — the landed check is `every`, not `some`. For a multi-property edit like
 * `{ color, backgroundColor }` on a component with an opaque root, the inherited `color` can change
 * while the covered `backgroundColor` (via `effectiveBackgroundColor`) does not; a `some` check
 * would wrongly keep a wrap whose background never became visible. Requiring every edited property
 * to verify is the honest fail-closed rule.
 */
async function verifyLanded(
  deps: UpdateStylesDeps,
  elementId: string,
  cssProperties: string[],
  beforeSnapshot: Record<string, string> | null,
): Promise<boolean | null> {
  if (!deps.verifyComputedStyle || beforeSnapshot === null || cssProperties.length === 0) return null;
  const requestKeys = verifyRequestKeys(cssProperties);
  const delayMs = deps.verifyPollBudget?.delayMs ?? VERIFY_POLL_DELAY_MS;
  const maxAttempts = deps.verifyPollBudget?.maxAttempts ?? VERIFY_POLL_MAX_ATTEMPTS;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await delay(delayMs);
    const after = await deps.verifyComputedStyle(elementId, requestKeys).catch(() => null);
    if (after === null) return null;
    const allChanged = cssProperties.every((prop) => {
      const key = verifyComparisonKey(prop);
      return beforeSnapshot[key] !== after[key];
    });
    if (allChanged) return true;
  }
  return false;
}
