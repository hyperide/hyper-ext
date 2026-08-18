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
import {
  buildNonForwardingShortMessage,
  buildNonForwardingWarningMessage,
  checkStyleForwarding,
} from './style-forwarding-check';
import {
  applyWrapCandidate,
  describeEnclosingAutoWrap,
  hasOnlyChildVerifiableProperties,
  isWrapEligible,
  restoreOwnedWrapStyle,
  restoreWrapStyleByMarker,
  stripWrapperMarker,
  unwrapByMarker,
  unwrapStyleWrapper,
  updateExistingWrap,
} from './style-wrap-retry';
import { encodeMarkerVerifyId, NO_ELEMENT_ROOT_SENTINEL, WRITE_MARKER_ATTR } from './style-verify-marker';
import { PathKeyedMutex } from './path-keyed-mutex';
import type { NodeRef } from '@shared/element-tracing/types';
import type { CssSystemId } from '@lib/style-read/types';
import type { FileIO } from '@lib/ast/file-io';
import { parseCode } from '@lib/ast/parser';
import type {
  StyleForwardingDiagnosis,
  StyleForwardingReason,
  StyleForwardingWarning,
} from '@shared/types/style-forwarding-warning';
import * as nodePath from 'node:path';
import { resolveWorkspacePath } from './workspace-path';

/** Read a file's DISK content for an undo snapshot, bypassing the editor buffer when the FileIO
 *  supports it (VS Code) — so a failed dirty-buffer sync can't make the snapshot read stale text
 *  (HYP-990 P1-2). Falls back to `readFile` for FileIOs with no separate buffer (Node/in-memory).
 *  Returns undefined on read failure. */
async function readFromDisk(deps: UpdateStylesDeps, absolutePath: string): Promise<string | undefined> {
  const io = deps.fileIO;
  try {
    return io.readFileFromDisk ? await io.readFileFromDisk(absolutePath) : await io.readFile(absolutePath);
  } catch {
    return undefined;
  }
}

/** Canonicalize a resolved file path for use as the per-path mutex KEY (codex full panel P1-3).
 *  `path.resolve` collapses `..`/`.` segments and normalises separators, so two spellings of the same
 *  file (`a/b.tsx` vs `a/x/../b.tsx`) map to ONE lock key and cannot bypass serialization. (Symlink
 *  canonicalization via realpath is a further hardening tracked in HYP-1004; the flagged `../`-spelling
 *  bypass is closed here.) */
function canonicalizeLockKey(p: string): string {
  return nodePath.resolve(p);
}
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
  /**
   * HYP-990 M2 §9.4 — the selected occurrence index at a repeated `.map()` JSX site (same value
   * `PanelRouter` threads to the live-className/color-probe providers), threaded per call so the
   * confidence × verifiability matrix can classify this write's confidence (see
   * {@link classifyWriteConfidence}). `undefined`/`null`/`0` (no repeated site, or the first
   * occurrence) ⇒ `exact`; a defined nonzero index ⇒ `probable`, because `verifyComputedStyle`'s
   * DOM read always queries occurrence 0 (HYP-1011) and so provably cannot confirm THIS occurrence.
   */
  itemIndex?: number | null;
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
      /**
       * HYP-990 P1 (codex full panel) — the authoritative undo snapshot of the mutated file, captured
       * INSIDE the per-path serialization lock (before + after the write). `_withUndoTracking` MUST
       * prefer this over its own pre-lock `readFile`, which races: two overlapping edits to the same
       * file both read the pre-edit content before either acquires the lock, so the second's undo
       * would erase the first. Present whenever the op mutated `resolvedPath`; absent means the op
       * changed nothing there (the caller records no entry).
       */
      undoSnapshot?: { path: string; before: string; after: string };
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

  // Resolve once up front ONLY to learn the target file, so the whole write/verify/rollback saga can
  // be serialized on it (HYP-990 C1). The authoritative AST/positions are re-resolved fresh INSIDE
  // the lock below — a serialized sibling edit to this same file may commit between here and our turn.
  const firstResolve = await deps.resolveElementInCorrectFile(absolutePath, effectiveNodeRef);
  if (!firstResolve) {
    return { success: false, error: `Element not found (nodeRef=${nodeRef}, elementId=${elementId})` };
  }

  // HYP-990 C1 (master spec §9.1 path-keyed mutation queue) — two overlapping style edits to the SAME
  // resolved file must not interleave: an unserialized second edit could nest its wrapper inside the
  // first's, or the coarse whole-file undo tracker could absorb its bytes into the first's undo entry.
  // Serializing per resolved path makes them strictly sequential; different files still run concurrently.
  const input: ExclusiveStyleWriteInput = {
    absolutePath,
    effectiveNodeRef,
    elementId,
    styles,
    state,
    selectedSourceTabId,
    domClasses,
    nodeRef,
  };

  // RELEASE-then-ACQUIRE loop (review, Opus/Fable HIGH — deadlock): the exclusive body re-resolves
  // fresh and, if the target file diverged from the lock key (monorepo re-root, or a committed sibling
  // moved the element), it returns a `relock` signal INSTEAD of acquiring the new key while still
  // holding the old one. Re-acquiring nested would hold lock A while waiting for lock B — two sagas
  // crossing paths (A→B, B→A) would deadlock the host forever. Here the outer `runExclusive` RETURNS
  // (releasing lock A) before we acquire lock B, so no lock is ever held while acquiring another.
  let lockKey = canonicalizeLockKey(firstResolve.resolvedPath);
  for (let attempt = 0; attempt < MAX_RELOCK_ATTEMPTS; attempt++) {
    const outcome = await styleWriteMutex.runExclusive(lockKey, () => runStyleWriteExclusive(input, deps, lockKey));
    if (outcome.kind === 'done') return outcome.result;
    // `relock`: the fresh resolve pointed elsewhere. Loop with the new (canonical) key (lock A already
    // released). The body NEVER mutates under a diverged lock (review, Opus #4) — it always signals relock.
    lockKey = canonicalizeLockKey(outcome.resolvedPath);
  }
  // The resolved path kept diverging every pass (astronomically unlikely for a style edit, which never
  // relocates an element cross-file). Refuse rather than write outside the lock (review, Opus #4).
  return { success: false, error: `Could not serialize style write: resolved path kept diverging (${lockKey})` };
}

/** Bound on the C1 release-then-acquire relock loop. A style edit never relocates an element to a
 *  different file, so >1 relock effectively never happens; the bound just prevents a pathological spin. */
const MAX_RELOCK_ATTEMPTS = 3;

interface ExclusiveStyleWriteInput {
  absolutePath: string;
  effectiveNodeRef: NodeRef;
  elementId: string;
  styles: Record<string, string>;
  state: string | undefined;
  selectedSourceTabId: string | undefined;
  domClasses: string | undefined;
  nodeRef: NodeRef | undefined;
}

/** Result of one locked pass: either a finished write, or a request to re-run under a different key
 *  (the fresh resolve diverged from the lock key) — see the deadlock-free loop in {@link updateStyles}. */
type ExclusiveOutcome = { kind: 'done'; result: UpdateStylesResult } | { kind: 'relock'; resolvedPath: string };

/** The serialized body of {@link updateStyles}: re-resolves fresh (so it sees any just-committed
 *  sibling edit to this file), classifies forwarding, and dispatches to the direct or auto-wrap
 *  candidate. Runs under the per-path {@link styleWriteMutex} lock keyed on `lockedPath`. When the
 *  fresh resolve diverges from `lockedPath`, returns `relock` WITHOUT mutating, so the caller can
 *  release this lock before acquiring the correct one (deadlock-free) — it NEVER writes under a lock
 *  keyed on a different file than the one it mutates (review, Opus #4). */
async function runStyleWriteExclusive(
  input: ExclusiveStyleWriteInput,
  deps: UpdateStylesDeps,
  lockedPath: string,
): Promise<ExclusiveOutcome> {
  const resolved = await deps.resolveElementInCorrectFile(input.absolutePath, input.effectiveNodeRef);
  if (!resolved) {
    return {
      kind: 'done',
      result: {
        success: false,
        error: `Element not found (nodeRef=${input.nodeRef}, elementId=${input.elementId})`,
      },
    };
  }
  const { result, ast, resolvedPath } = resolved;

  // Divergence: ask the caller to re-run under the correct key (it releases THIS lock first). We NEVER
  // proceed to mutate `resolvedPath` while the lock is held on a different `lockedPath`. Compared on the
  // CANONICAL key (P1-3) so a `../`-equivalent spelling of the same file is not treated as divergence.
  if (canonicalizeLockKey(resolvedPath) !== lockedPath) {
    return { kind: 'relock', resolvedPath };
  }

  let contentBeforeWrite: string | undefined;
  if (resolvedPath !== input.absolutePath) {
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
    // HYP-1162 (main) needs `elementId` on DirectCandidateInput to address the live-preview verify
    // RPC; HYP-990 (this branch) needs the `result2`/ExclusiveOutcome wrapping for the saga's
    // relock loop. Both must be threaded through the same call.
    const result2 = await writeDirectCandidate(
      {
        elementId: input.elementId,
        styles: input.styles,
        state: input.state,
        selectedSourceTabId: input.selectedSourceTabId,
        domClasses: input.domClasses,
        ast,
        result,
        resolvedPath,
      },
      deps,
      contentBeforeWrite,
    );
    return { kind: 'done', result: result2 };
  }

  const retargetResult = await retargetNonForwardingWrite(
    {
      elementId: input.elementId,
      styles: input.styles,
      state: input.state,
      displayName: forwardCheck.displayName,
      // HYP-990 M2 — structured facts for the AI-fix diagnosis: where the component is DEFINED (to add
      // forwarding) and the CALL SITE where the edit was attempted.
      definition: forwardCheck.definition,
      callSite: result.element.loc ? { filePath: resolvedPath, line: result.element.loc.start.line } : undefined,
      ast,
      result,
      resolvedPath,
    },
    deps,
    contentBeforeWrite,
  );
  return { kind: 'done', result: retargetResult };
}

/** HYP-990 C1 — process-wide per-resolved-path lock serializing the non-forwarding style-write saga.
 *  Module-level so every AstService.updateStyles call in this extension host shares it.
 *
 *  The critical section includes the multi-second verify poll, but it is BOUNDED, so a hung preview
 *  can never wedge the file for the session (review, Fable #3): each `verifyComputedStyle` provider
 *  call resolves `null` on an 800ms timeout in production (PreviewPanel.requestComputedStyleSnapshot),
 *  and `verifyLanded` caps the poll at {@link VERIFY_POLL_MAX_ATTEMPTS} — so the lock is held for at
 *  most a few seconds even if the iframe never answers, then released.
 *
 *  SCOPE of the key (codex full panel). The lock is keyed on the resolved JSX SOURCE path. This FULLY
 *  serializes the auto-wrap (retarget) saga — HYP-990's new, non-atomic code — which mutates exactly
 *  `resolvedPath`, and every same-file edit. It does NOT cover the case where the shared planner routes
 *  a DIRECT write to a DIFFERENT file (a CSS module / token file): two edits from different JSX files
 *  into one stylesheet take different lock keys. KNOWN LIMITATION, unchanged from before this lock and
 *  NOT closed here: the transaction's compare-and-swap runs only on ROLLBACK, not on the forward write
 *  (`write-transaction.ts` / `snapshot-file-io.ts`), so two concurrent forward writes to one shared
 *  stylesheet are last-writer-wins, and a CSS-only write gets no undo entry. Closing this needs the
 *  full spec §9.1 mechanism — lock every frozen-plan mutation path in canonical order (or forward-CAS
 *  + retry) plus a per-mutated-path undo entry — tracked in HYP-1004, deliberately out of this bounded
 *  C1 slice (whose target is the auto-wrap serialization). */
const styleWriteMutex = new PathKeyedMutex();

/** HYP-990 C2 — monotonic-per-process generator for the write-scoped verify marker (styleVersion
 *  sentinel). Timestamp + counter so a marker is unique even across rapid successive wraps and can
 *  never collide with a stale marker left by a prior (crashed) attempt. */
let writeMarkerCounter = 0;
function nextWriteMarker(): string {
  writeMarkerCounter += 1;
  return `${Date.now()}-${writeMarkerCounter}`;
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
  // HYP-990 P1 (codex) — capture the pre-write content of resolvedPath INSIDE the lock, so the undo
  // "before" snapshot is authoritative and does not race the pre-lock read in `_withUndoTracking`.
  // BUFFER-preferring `readFile` (Opus): the style-write transaction ALSO reads the buffer and rewrites
  // `userUnsavedEdits + styleChange` to disk, so "before" must be the user's unsaved buffer state —
  // reading disk here would record `original` and a single undo would silently discard the user's
  // unsaved edits. Only the AFTER read is disk-authoritative (below).
  const undoBefore = await deps.fileIO.readFile(input.resolvedPath).catch(() => undefined);
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
    // `verifyLanded` returns the fine-grained VerifyOutcome (master spec §9.4 matrix, HYP-990); this
    // escalation only fires on a PROVEN negative — `not-landed` — never on `unverifiable` (matches the
    // pre-§9.4 `landed === false` gate, which never fired on the old `null` "can't verify" result either).
    if (toMatrixOutcome(landed) === 'not-landed') {
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
  // Only produce an undo snapshot when resolvedPath was ACTUALLY mutated (Opus): a frozen plan can
  // write a DIFFERENT file (a CSS module/token file) and leave resolvedPath untouched. Since `before`
  // is a buffer read and `after` is a disk read, an untouched-but-dirty resolvedPath would show
  // `before !== after` and record a bogus entry for a file this op never changed (whose undo would
  // then destroy the user's unsaved buffer edits). Gate on `mutatedFiles`. The CSS/other file's own
  // undo entry is the HYP-1011 multi-file scope.
  const mutatedResolved = writeResult.mutatedFiles.some(
    (f) => canonicalizeLockKey(f) === canonicalizeLockKey(input.resolvedPath),
  );
  // After-snapshot of resolvedPath, still inside the lock — pairs with `undoBefore` for a race-free
  // undo entry. Read from DISK (codex full panel P1-2 / Opus): if a dirty-buffer sync failed after the
  // write, a buffer-preferred read would return the STALE old text (before === after → non-undoable).
  const undoAfter = mutatedResolved ? await readFromDisk(deps, input.resolvedPath) : undefined;
  const undoSnapshot =
    mutatedResolved && undoBefore !== undefined && undoAfter !== undefined
      ? { path: input.resolvedPath, before: undoBefore, after: undoAfter }
      : undefined;
  return { success: true, resolvedPath: input.resolvedPath, contentBeforeWrite, undoSnapshot };
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
    // See the matching comment in `writeDirectCandidate` — only a PROVEN `not-landed` (not
    // `unverifiable`) surfaces the persistent-failure warning here.
    ...(toMatrixOutcome(landed) === 'not-landed'
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
  /** HYP-990 M2 — where the non-forwarding component is DEFINED (for the AI-fix diagnosis). */
  definition?: { filePath: string; line: number };
  /** HYP-990 M2 — the JSX call site where the edit was attempted (for the AI-fix diagnosis). */
  callSite?: { filePath: string; line: number };
  ast: t.File;
  result: FindElementResult;
  resolvedPath: string;
}

/** Build the structured AI-fix diagnosis (reason + edited properties + definition/call-site) shared by
 *  every warn/keep-report exit of the auto-wrap path. */
function buildDiagnosis(
  reason: StyleForwardingReason,
  input: RetargetInput,
  editedProperties: string[],
): StyleForwardingDiagnosis {
  return {
    reason,
    componentName: input.displayName,
    editedProperties,
    ...(input.definition ? { componentDefinition: input.definition } : {}),
    ...(input.callSite ? { callSite: input.callSite } : {}),
  };
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
  // Every warn/rollback exit is a no-op from the user's intent, so it must NOT record an undo entry
  // (HYP-987 P1 codex): a wrap that landed leaves `skipUndoTracking` unset below. HYP-990 M2 — each
  // exit also carries a STRUCTURED diagnosis (why it couldn't apply, where the component is defined vs
  // used, what was edited) so the "Auto fix via AI" flow inspects with real facts, not a generic string.
  const warnedWith = (reason: StyleForwardingReason): UpdateStylesResult => ({
    success: true,
    resolvedPath: input.resolvedPath,
    contentBeforeWrite,
    warning: {
      componentName: input.displayName,
      shortMessage: buildNonForwardingShortMessage(input.displayName),
      message: buildNonForwardingWarningMessage(input.displayName, reason),
      diagnosis: buildDiagnosis(reason, input, cssProperties),
    },
    skipUndoTracking: true,
  });

  // HYP-987 P3 (codex) — an empty style set has nothing to apply; never insert an empty
  // `<div style={{}}>` wrapper (which would be permanent debris the verify treats as unverifiable).
  if (cssProperties.length === 0) return warnedWith('component-does-not-forward');

  // HYP-987 P1 #4 — a wrapper's inline `style` is base-state only; a pseudo-state edit
  // (`:hover`/`:focus`/…) cannot be expressed by wrapping (master spec §8.3), so wrapping it
  // would silently turn a hover edit into a permanently-active base-state background. Warn
  // instead of writing an inexpressible wrap.
  if (!isBaseState(input.state)) return warnedWith('pseudo-state-not-wrappable');

  // Only auto-wrap properties whose landing is observable from the wrapped child (so the verify can
  // actually prove it applied). A property the child never reflects (opacity, borders, shadow) or a
  // layout-affecting one (master spec §11.4 guards 4/5/12) surfaces the warning instead.
  if (!hasOnlyChildVerifiableProperties(input.styles)) return warnedWith('property-not-verifiable');
  // A `ref`/`key`-bearing element or a structurally-constrained parent cannot be safely wrapped.
  if (!isWrapEligible(input.result)) return warnedWith('component-does-not-forward');

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
  if (!targetLoc) return warnedWith('component-does-not-forward');
  const freshAst = parseCode(originalContent);
  const freshResult = findElementByPosition(freshAst, targetLoc.start.line, targetLoc.start.column);
  if (!freshResult) return warnedWith('component-does-not-forward');

  // HYP-990 C2 — a per-write sentinel (master spec §9.3) stamped on the wrapper. Runtime verify and
  // rollback both key on it: verify addresses the marked wrapper's CHILD deterministically (no fuzzy
  // nodeRef match onto the injected wrapper), and rollback removes exactly THIS wrapper (never a
  // pre-existing identical user `<div style>`).
  const writeMarker = nextWriteMarker();
  // HYP-990 C1 anti-nesting — if the target already sits inside one of our bare `<div style>`
  // auto-wraps (a prior verified-keep whose transient marker was stripped), UPDATE that wrapper in
  // place instead of nesting a second one around it. `priorStyles` is captured for rollback. (A stale
  // ref that resolves onto the `<div data-hc-autowrap>` ITSELF is classified `forwards` — it's a real
  // native div — and takes the DIRECT inline-write path, which updates its style with no nesting, so
  // no separate self-guard is needed here.)
  const enclosing = describeEnclosingAutoWrap(freshResult);
  if (enclosing) {
    const mergedStyles = { ...enclosing.priorStyles, ...input.styles };
    // No-op guard (review, Opus): re-applying the SAME values our wrapper already carries (e.g. the
    // tail of a slider drag) would produce an unchanged computed style, verify `false`, and a wrong
    // "could not apply" warning + rollback. Nothing to write — return a clean success.
    if (stylesShallowEqual(mergedStyles, enclosing.priorStyles)) {
      // Nothing written → no undo entry should be recorded for this no-op (review, Fable #10).
      return { success: true, resolvedPath: input.resolvedPath, contentBeforeWrite, skipUndoTracking: true };
    }
    // MERGE onto the wrapper's existing inline styles, never REPLACE them (review, fable H1): the
    // wrapper may already carry a prior verified-kept edit; a keep must not silently delete them.
    // Rollback restores the captured `priorStyles`. Only OUR auto-wraps (persistent ownership marker)
    // reach here — a user's own `<div style>` is never updated in place (review, Opus).
    updateExistingWrap(enclosing.wrapper, mergedStyles, writeMarker);
  } else if (!applyWrapCandidate(freshResult, input.styles, writeMarker)) {
    return warnedWith('component-does-not-forward');
  }
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
  // Refresh the NodeMap to the wrapped state right after the write (HYP-987 P2, codex). The C1 mutex
  // serializes STYLE writes per path, but non-style AstService mutations, user typing, and a
  // formatter-on-save still race this multi-second verify window — so the defensive divergence
  // handling below (and this refresh) remains load-bearing, it is not made redundant by the lock.
  await deps.updateNodeMap(input.resolvedPath);

  // HYP-990 C2 — verify via the marker, NOT the pre-write nodeRef. NO fallback nodeRef: it would
  // fuzzy-resolve to the injected wrapper and false-prove "landed" (codex full panel). A component with
  // no element root is left unverifiable → keep-report (see verifyLanded).
  const markerVerifyId = encodeMarkerVerifyId(writeMarker);
  const outcome = await verifyLanded(deps, markerVerifyId, cssProperties, beforeSnapshot ?? null);

  // HYP-990 M2 §9.4 — the confidence × verifiability matrix. `confidence` is this write's §9.4
  // `Confidence` row (see {@link classifyWriteConfidence}); `matrixOutcome` collapses the fine-grained
  // {@link VerifyOutcome} onto the spec's column axis (see {@link toMatrixOutcome}). Both `exact` and
  // `probable` land the write identically (§9.4's `landed` column is `commit` on every row) — the
  // matrix only forks behavior on `not-landed` and `unverifiable`.
  const confidence = classifyWriteConfidence(deps.itemIndex);
  const matrixOutcome = toMatrixOutcome(outcome);

  if (matrixOutcome === 'landed') {
    return finalizeKeptWrap(deps, input, writeMarker, generatedCode, originalContent, contentBeforeWrite);
  }

  if (matrixOutcome === 'unverifiable') {
    if (confidence === 'exact') {
      // §9.4 load-bearing cell: `exact + unverifiable = keep + report` — the ONLY unverifiable write
      // that survives, and only because the write target was already trusted (`exact`) BEFORE the
      // write. The keep is NEVER silent (this reverses M2's earlier "keep silently for no-preview/
      // slow-HMR" reading — that behavior conflated §9.3, which governs classifying a slow settle as
      // `unverifiable` rather than a false `not-landed`, with §9.4's separate keep/rollback decision,
      // which the spec states plainly always reports for this cell).
      const kept = await finalizeKeptWrap(deps, input, writeMarker, generatedCode, originalContent, contentBeforeWrite);
      if (kept.success) {
        kept.warning = {
          componentName: input.displayName,
          kept: true,
          shortMessage: `Style applied to <${input.displayName}>, but could not verify it's visible.`,
          message: buildNonForwardingWarningMessage(input.displayName, 'kept-unverified'),
          diagnosis: buildDiagnosis('kept-unverified', input, cssProperties),
        };
      }
      return kept;
    }
    // §9.4 load-bearing cell: `probable + unverifiable = ROLLBACK — never silently keep`. There is no
    // `ask`/`confirm` disposition for this cell (§9.4); `probable` is admitted into the write path
    // only because the verify was expected to confirm it, and here it provably can't (HYP-1011's
    // occurrence-0-only DOM read against a non-zero `itemIndex`), so the precondition for keeping a
    // `probable` write is unmet.
    await rollBackWrap(deps, input, {
      writeMarker,
      generatedCode,
      originalContent,
      updateInPlace: enclosing !== null,
      priorStyles: enclosing?.priorStyles ?? {},
    });
    return warnedWith('probable-unverifiable');
  }

  // `matrixOutcome === 'not-landed'` (`covered` C3 opaque cover, or `no-effect` verified-no-change).
  // §9.4's `exact + not-landed` cell is the spec's own OPEN decision (OD-11: hold-pending-repair is
  // the recommendation, immediate rollback the "live alternative" the spec explicitly names for when
  // the B2 hold-pending flow does not exist yet — it doesn't, in this codebase). `probable +
  // not-landed` is an unconditional rollback regardless. So both rows collapse to the same action
  // here; only the OD-11 provisional status differs, which is why this is not read as "confidence made
  // no difference" — a future B2 hold-pending implementation changes ONLY the exact row.
  await rollBackWrap(deps, input, {
    writeMarker,
    generatedCode,
    originalContent,
    updateInPlace: enclosing !== null,
    priorStyles: enclosing?.priorStyles ?? {},
  });
  // Reason-accurate (codex/Opus): `wrap-not-visible` ONLY for the genuine opaque-cover case;
  // everything else verified-no-change → `wrap-had-no-effect`.
  return warnedWith(outcome === 'covered' ? 'wrap-not-visible' : 'wrap-had-no-effect');
}

/**
 * HYP-990 — a verified-landed wrap is kept, but its transient `data-hc-writeid` marker must NOT
 * persist in committed source: strip it, leaving the clean `<div style={…}>`. Records a normal undo
 * entry ONLY when the disk still matches our exact write (no formatter-on-save reformatted it) — a
 * non-clean landing skips undo tracking so the coarse whole-file tracker cannot absorb foreign bytes
 * into this op's undo entry (HYP-987 P1 codex).
 *
 * The marker is removed TEXTUALLY (review, fable M5), not via reparse + `@babel/generator` reprint:
 * a full regenerate would clobber a formatter-on-save that reformatted our write during the verify
 * window (and would need `skipUndoTracking` to hide that clobber). The marker value is unique, so the
 * targeted attribute removal matches exactly one occurrence and preserves everything else byte-for-byte.
 */
async function finalizeKeptWrap(
  deps: UpdateStylesDeps,
  input: RetargetInput,
  writeMarker: string,
  generatedCode: string,
  originalContent: string,
  contentBeforeWrite: string | undefined,
): Promise<UpdateStylesResult> {
  // Read DISK (Opus): we are reasoning about the content we just WROTE to disk (to strip the transient
  // marker). A buffer-preferring read of a stale dirty buffer would miss the marker and leave it
  // committed on disk.
  const current = (await readFromDisk(deps, input.resolvedPath)) ?? null;
  if (current === null) {
    // Can't READ back the file — a failed read is AMBIGUOUS (deleted / renamed / transiently locked),
    // so leave it UNTOUCHED, exactly as the rollback path does: a blind write here could resurrect a
    // deleted file or clobber a formatter reflow / concurrent edit we never observed (review, Opus vs
    // Fable — reconciled toward the no-clobber policy the rest of the design follows). The transient
    // marker may briefly remain in this extremely rare case; skip undo (uncertain final state).
    return { success: true, resolvedPath: input.resolvedPath, contentBeforeWrite, skipUndoTracking: true };
  }
  const cleanLand = current === generatedCode;
  let finalContent = current;
  const stripped = stripMarkerAttributeText(current, writeMarker);
  if (stripped !== current) {
    finalContent = stripped;
    await deps.fileIO.writeFile(input.resolvedPath, stripped);
  } else if (current.includes(WRITE_MARKER_ATTR)) {
    // The textual strip missed (a formatter-on-save re-quoted/reflowed the attribute during the verify
    // window) yet the marker is still present — it MUST NOT be committed (review, Opus/Fable). Fall
    // back to the AST strip. The `generate` reprint reformats the file, so skip undo tracking (already
    // the non-clean case). Parse failure leaves the marker rather than corrupting; it is our OWN
    // synthetic attribute, the lesser evil than clobbering an unparseable dirty buffer.
    try {
      const ast = parseCode(current);
      if (stripWrapperMarker(ast, writeMarker) === 'stripped') {
        finalContent = generate(ast).code;
        await deps.fileIO.writeFile(input.resolvedPath, finalContent);
      }
    } catch {}
  }
  await deps.updateNodeMap(input.resolvedPath);
  // On a CLEAN landing (no formatter raced our write) record a race-free undo entry via the
  // lock-captured before/after (HYP-990 P1, codex). A non-clean landing still skips undo tracking so
  // the coarse tracker can't absorb the formatter's foreign bytes into this op's entry.
  return {
    success: true,
    resolvedPath: input.resolvedPath,
    contentBeforeWrite,
    ...(cleanLand
      ? { undoSnapshot: { path: input.resolvedPath, before: originalContent, after: finalContent } }
      : { skipUndoTracking: true }),
  };
}

/** Escape a string for literal use inside a RegExp. */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when two style maps have identical keys and values (order-independent). */
function stylesShallowEqual(a: Record<string, string>, b: Record<string, string>): boolean {
  const keysA = Object.keys(a);
  if (keysA.length !== Object.keys(b).length) return false;
  return keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && a[k] === b[k]);
}

/** Remove exactly the (unique) `data-hc-writeid=<marker>` attribute (and its leading whitespace) from
 *  source TEXT, without reparsing/reprinting — see {@link finalizeKeptWrap}. Tolerates BOTH quote
 *  styles (a formatter with `jsxSingleQuote` re-quotes it) so the strip does not silently miss. */
function stripMarkerAttributeText(content: string, writeMarker: string): string {
  const m = escapeRegExp(writeMarker);
  const pattern = new RegExp(`\\s*${escapeRegExp(WRITE_MARKER_ATTR)}=(?:"${m}"|'${m}')`);
  return content.replace(pattern, '');
}

interface RollBackWrapContext {
  writeMarker: string;
  generatedCode: string;
  originalContent: string;
  /** True when this write UPDATED an existing auto-wrap in place (rollback restores {@link priorStyles});
   *  false when it CREATED a new wrapper (rollback removes the wrapper entirely). An EXPLICIT flag, not
   *  `priorStyles` truthiness, so an update whose prior style was `{}` still restores rather than being
   *  misread as a create and left as debris (review, Opus #5). */
  updateInPlace: boolean;
  /** The style to restore on an update-in-place rollback (only meaningful when `updateInPlace`). */
  priorStyles: Record<string, string>;
}

/**
 * HYP-990 — roll back a non-landed wrap. Cases:
 *  - current read FAILS → leave untouched (a blind restore could clobber something).
 *  - current is byte-for-byte our write (nothing else touched it — the common case under the C1 lock)
 *    → blind-restore the exact pre-edit content.
 *  - current DIFFERS (a formatter-on-save reformatted it) → surgical, MARKER-precise: restore the
 *    prior style (update-in-place) or unwrap our exact wrapper (create), so a reformat is not misread
 *    as debris and a pre-existing identical user wrapper is never touched. Falls back to the M1
 *    structure-based unwrap only if the marker is somehow gone.
 */
async function rollBackWrap(deps: UpdateStylesDeps, input: RetargetInput, ctx: RollBackWrapContext): Promise<void> {
  // Read DISK (Opus): we are reasoning about the wrapper we just WROTE to disk. A stale dirty buffer
  // would make `current !== generatedCode` (→ surgical) find no marker and leave the wrapper on disk.
  const current = (await readFromDisk(deps, input.resolvedPath)) ?? null;
  if (current === null) return; // can't read (deleted/renamed/locked) — leave untouched.
  if (current === ctx.generatedCode) {
    // Common case (nothing else touched our write) → exact restore of the pre-edit content.
    await deps.fileIO.writeFile(input.resolvedPath, ctx.originalContent);
    await deps.updateNodeMap(input.resolvedPath);
    return;
  }
  await surgicallyRollBack(deps, input, current, ctx);
}

/**
 * Re-parse `currentContent` and surgically undo our marked wrapper, then write the result:
 *  - update-in-place → restore the wrapper's `priorStyles` and strip the marker.
 *  - create          → unwrap our exact wrapper by marker (fallback: the M1 structure match by
 *                      style + child tag, in case the marker attribute was dropped).
 * A parse failure — or an unrecognisable wrapper (marker gone AND structure changed) — leaves the file
 * UNTOUCHED: a stale rollback must never clobber a formatter reflow / user typing that landed in the
 * verify window (§9.4 supersession), and the whole warn/rollback exit skips undo tracking so that
 * foreign content can never be attributed to this op (HYP-987 P1).
 *
 * On the leftover-debris concern (Opus medium #3). This is UNREACHABLE in the common case: under the
 * C1 lock nothing else touches our write, so `current === ctx.generatedCode` and {@link rollBackWrap}
 * exact-restores the pre-edit content with ZERO debris. `surgicallyRollBack` is reached only when a
 * formatter-on-save reflowed our write mid-verify — and a formatter preserves JSX semantics, so the
 * wrapper's element child survives and `unwrapByMarker` cleanly removes it. The residual "marker gone
 * AND element child replaced" path is not producible by a formatter. Were it ever hit, the leftover is
 * a TRANSPARENT wrapper carrying the style we just proved is NOT visible — so the warning's "could not
 * be applied (visibly)" stays honest — and leaving it (vs blind-restoring over possibly-foreign
 * formatter output) is the M1-consistent foreign-content-safe choice. The NodeMap is refreshed for
 * every parseable outcome.
 */
async function surgicallyRollBack(
  deps: UpdateStylesDeps,
  input: RetargetInput,
  currentContent: string,
  ctx: RollBackWrapContext,
): Promise<void> {
  let ast: t.File;
  try {
    ast = parseCode(currentContent);
  } catch {
    return; // dirty/unparseable — leave untouched (never clobber user typing).
  }
  let mutated = false;
  if (ctx.updateInPlace) {
    mutated = restoreWrapStyleByMarker(ast, ctx.writeMarker, ctx.priorStyles) === 'restored';
    if (!mutated) {
      // Transient write marker dropped (formatter) → fall back to the persistent ownership marker so
      // the merged (new) styles are still reverted, never left applied under a "could not apply"
      // warning (Opus). Keyed on childTag + data-hc-autowrap, so a user div is never touched.
      const childTag = jsxOpeningTagName(input.result.element.openingElement.name);
      if (childTag) mutated = restoreOwnedWrapStyle(ast, childTag, ctx.priorStyles) === 'restored';
    }
  } else if (unwrapByMarker(ast, ctx.writeMarker) === 'removed') {
    mutated = true;
  } else {
    const childTag = jsxOpeningTagName(input.result.element.openingElement.name);
    if (childTag && unwrapStyleWrapper(ast, input.styles, childTag) === 'removed') mutated = true;
  }
  if (mutated) await deps.fileIO.writeFile(input.resolvedPath, generate(ast).code);
  await deps.updateNodeMap(input.resolvedPath);
}

/** Wait budget for HMR to actually apply a write before reading computed style — mirrors the
 *  SaaS realm's `POST_HMR_DELAY_MS`/`HMR_VERIFY_MAX_RETRIES` (client/lib/style-change-detector.ts).
 *  The master spec's real settle handshake (§9.3 — a writeId-stamped sentinel, correlated to the
 *  exact edit) is PLANNED, not built; this is the same pragmatic fixed-delay poll already shipped
 *  for the SaaS toast path, not a new invented mechanism. */
const VERIFY_POLL_DELAY_MS = 300;
const VERIFY_POLL_MAX_ATTEMPTS = 4;

/**
 * Discriminated verify result (codex full panel / Opus). This is the FINE-GRAINED B1 classification
 * ONLY — it does not by itself decide keep-vs-rollback. {@link toMatrixOutcome} collapses it onto
 * the master spec §9.4 three-column axis, and the confidence × verifiability matrix in
 * {@link retargetNonForwardingWrite} (§9.4, `classifyWriteConfidence` × `toMatrixOutcome`) makes the
 * actual disposition call — see that dispatch for the current keep/report/rollback behavior:
 *  - `landed`              → the edit's rendered value changed. Matrix column: `landed` (commit,
 *                            every confidence row).
 *  - `covered`             → C3: an actual opaque background-image/gradient was observed covering the
 *                            child — a genuine NEGATIVE landing signal. Matrix column: `not-landed`.
 *  - `no-effect`           → read the element, but no edited property's value changed — also a
 *                            NEGATIVE landing signal. Matrix column: `not-landed`.
 *  - `proof-unavailable`   → the snapshot is MISSING the `backgroundImage` field entirely (a broken/
 *                            version-skewed provider) — an ABSENT signal, not a negative one. Matrix
 *                            column: `unverifiable`.
 *  - `unverifiable-silent` → the BEFORE snapshot itself was unavailable (no live preview, or the
 *                            pre-write read timed out during a rebuild — §9.3 "never repair a slow
 *                            build", which governs classifying this as `unverifiable` rather than a
 *                            false `not-landed`, NOT whether the keep is silent). Matrix column:
 *                            `unverifiable`.
 *  - `unverifiable-report` → the preview WAS live (before read succeeded) but the wrapper rendered no
 *                            element root to read (text/fragment/portal). Matrix column:
 *                            `unverifiable` — same as `unverifiable-silent` now that §9.4 governs the
 *                            keep/report decision (both sub-causes surface identically for `exact`
 *                            confidence; the internal split survives only because the two sub-causes
 *                            are diagnostically distinct, not because they disposition differently).
 */
type VerifyOutcome =
  | 'landed'
  | 'covered'
  | 'proof-unavailable'
  | 'no-effect'
  | 'unverifiable-silent'
  | 'unverifiable-report';

/**
 * HYP-990 M2 — master spec §9.4's pre-write `Confidence` axis (`exact` / `probable` / `none`),
 * bounded to this write path. `none` never reaches here: an unresolvable target already returns
 * `success: false` before any of this runs (the §9.4 `NO_WRITABLE_TARGET` row), so only the two
 * write-admitted rows apply. The AST WRITE target itself is always unambiguous in this path — a
 * `nodeRef` resolves to exactly one JSX element via `resolveElementInCorrectFile`, never a
 * fuzzy/heuristic DOM match — so there is exactly one source of imprecision here: a repeated
 * `.map()` list instance. See {@link classifyWriteConfidence}.
 */
type WriteConfidence = 'exact' | 'probable';

/**
 * Classify this write's confidence for the §9.4 matrix. `verifyComputedStyle`'s DOM read always
 * queries occurrence 0 of a repeated element (HYP-1011, tracked separately — threading the
 * selected `itemIndex` through the computed-style RPC itself is out of THIS bounded slice). So
 * when the user edited a DIFFERENT occurrence (a defined, nonzero `itemIndex`), the verify read is
 * PROVABLY reading the wrong DOM node — its outcome cannot be trusted at `exact` confidence.
 * Downgrading to `probable` routes it through the matrix's fail-closed `probable` row, which never
 * silently keeps an unverifiable or not-landed result (§9.4 load-bearing cells) — directly closing
 * the gap codex's full-panel review flagged (an itemIndex-mismatched verify was previously kept
 * exactly like a trustworthy one).
 */
function classifyWriteConfidence(itemIndex: number | null | undefined): WriteConfidence {
  return typeof itemIndex === 'number' && itemIndex !== 0 ? 'probable' : 'exact';
}

/**
 * Collapse this write path's fine-grained {@link VerifyOutcome} onto the master spec §9.4
 * three-column axis (`landed` / `not-landed` / `unverifiable`) the confidence matrix is keyed on.
 * The spec's fourth column, `ambiguous` (a value read back TRANSFORMED/clamped, not simply
 * changed-or-not), has no detector in this write path — M2's verify only compares byte-equal
 * before/after strings — so it never applies here; adding it is future work, not a gap this
 * mapping papers over.
 *  - `covered` (C3: a real opaque `background-image` was observed covering the child) is a genuine
 *    NEGATIVE signal — we KNOW the edit did not visibly land — so it maps to `not-landed`, same as a
 *    verified no-effect.
 *  - `proof-unavailable` (the snapshot is MISSING the `backgroundImage` field entirely — a broken or
 *    version-skewed provider) is not a negative signal, it is an ABSENT one — we simply could not
 *    get a trustworthy read — so it maps to `unverifiable`, same as no-preview/timeout/no-DOM-root.
 */
function toMatrixOutcome(outcome: VerifyOutcome): 'landed' | 'not-landed' | 'unverifiable' {
  switch (outcome) {
    case 'landed':
      return 'landed';
    case 'covered':
    case 'no-effect':
      return 'not-landed';
    case 'proof-unavailable':
    case 'unverifiable-silent':
    case 'unverifiable-report':
      return 'unverifiable';
  }
}

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
 *
 * HYP-990 C3 — a `backgroundColor` edit is judged by `effectiveBackgroundColor`, which walks ancestor
 * background-COLORS only and is BLIND to a `background-image`/gradient painted on the covering child
 * root. When the wrapped child carries a non-`none` background-image, the wrapper's colour can "change"
 * `effectiveBackgroundColor` (the color walk skips the transparent child) while the image visually hides
 * it — a false landed. So a `backgroundColor` wrap whose read element reports a non-`none`
 * `backgroundImage` FAILS CLOSED (returns `false` → rollback + warn) rather than being kept unverified.
 *
 * HYP-990 disposition of `null` (codex full panel #5, reconciling Opus #1). `null` = "cannot verify",
 * and the caller (`landed !== false`) KEEPS the wrap. This is a DELIBERATE `keep-report` disposition,
 * not a silent false-positive: the auto-wrap only runs AFTER the direct write was statically excluded
 * as dead (§9.2a), so an unverifiable wrap is strictly better than the dead prop it replaced, and
 * §9.3 mandates "never repair a slow build" (timeout ⇒ keep, not roll back). `null` is reached ONLY
 * when verification is genuinely impossible: no live preview (`beforeSnapshot === null`), or the
 * component renders no element root to read (text/fragment/portal — the marker wrapper has no element
 * child, so every poll reads `null`). A component WITH an element root verifies correctly via the
 * wrapper's `firstElementChild` (→ `true`/`false`), so `null` never masks a real failure. Crucially
 * there is NO fallback nodeRef: it would fuzzy-resolve to the injected wrapper and report a false
 * `true` — the opposite hazard — which is why the honest `null` keep-report is preferred over a
 * fabricated verified-keep.
 */
async function verifyLanded(
  deps: UpdateStylesDeps,
  elementId: string,
  cssProperties: string[],
  beforeSnapshot: Record<string, string> | null,
): Promise<VerifyOutcome> {
  // No verify capability / no live preview / the before-read failed (slow rebuild) → `unverifiable`.
  // NAME is a HISTORICAL ARTIFACT (Fable, round-G review): this used to keep SILENTLY per §9.3 "never
  // repair a slow build", but the §9.4 confidence × verifiability matrix now decides the disposition —
  // for `exact` confidence this is ALWAYS surfaced (`keep + report`, never silent); only `probable`
  // confidence rolls it back. Do not re-read this variant name as "the silent case" — see the matrix
  // dispatch in `retargetNonForwardingWrite` for the actual (report-always) behavior.
  if (!deps.verifyComputedStyle || beforeSnapshot === null || cssProperties.length === 0) return 'unverifiable-silent';
  const requestKeys = verifyRequestKeys(cssProperties);
  const delayMs = deps.verifyPollBudget?.delayMs ?? VERIFY_POLL_DELAY_MS;
  const maxAttempts = deps.verifyPollBudget?.maxAttempts ?? VERIFY_POLL_MAX_ATTEMPTS;
  const judgesBackgroundColor = cssProperties.some((prop) => EFFECTIVE_BG_VERIFY_PROPERTIES.has(prop));

  // HYP-990 C2 addresses the marked wrapper's child, which does NOT exist in the DOM until HMR applies
  // the wrap — so early polls legitimately read `null` (marker not rendered yet). A `null` read must
  // RETRY, not abort (review, fable H2): aborting on the first null would keep unverified before the
  // wrap ever rendered, silently defeating the verification. We only conclude `unverifiable` if EVERY
  // attempt read null (the wrapper never rendered / no live preview / no DOM element root); once any
  // attempt reads the element, a persistent no-change is an honest `no-effect`.
  let everRead = false;
  let sawNoElementRoot = false;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await delay(delayMs);
    const after = await deps.verifyComputedStyle(elementId, requestKeys).catch(() => null);
    if (after === null) continue; // marker wrapper not in the DOM yet (HMR pending) — keep polling.
    if (after[NO_ELEMENT_ROOT_SENTINEL]) {
      // Wrapper IS in the DOM but has no element child — a genuine no-DOM-root component (Opus). Record
      // it, but keep polling in case a later frame renders a child (some components render null first).
      sawNoElementRoot = true;
      continue;
    }
    everRead = true;
    // C3 fail-closed, with an HONEST reason (Opus): an actual non-`none` background-IMAGE covering the
    // child → `covered` (the "opaque root/background-image covers it" diagnosis is true). A snapshot
    // MISSING the field entirely (a broken/version-skewed provider) → `proof-unavailable`: still
    // fail-closed, but the reason is "could not verify", not a false "something covers it".
    if (judgesBackgroundColor) {
      const status = bgProofStatus(after);
      if (status === 'image-cover') return 'covered';
      if (status === 'field-absent') return 'proof-unavailable';
    }
    const allChanged = cssProperties.every((prop) => {
      const key = verifyComparisonKey(prop);
      return beforeSnapshot[key] !== after[key];
    });
    if (allChanged) return 'landed';
  }
  // Read the element but no edited property's value changed → the wrapper had no effect (roll back).
  if (everRead) return 'no-effect';
  // The wrapper was PRESENT but never had an element root ('unverifiable-report') vs every read was
  // `null` — the wrapper never appeared, HMR slower than the poll budget, or no live preview
  // ('unverifiable-silent'). Both sub-causes are diagnostically distinct (kept for that reason — see
  // the `VerifyOutcome` doc comment above), but as of the §9.4 matrix BOTH map to the same
  // `unverifiable` column and get the SAME disposition (report-always for `exact`, rollback for
  // `probable`) — neither variant name should be read as "the case that stays silent" anymore.
  return sawNoElementRoot ? 'unverifiable-report' : 'unverifiable-silent';
}

/**
 * HYP-990 C3 — classifies whether the effectiveBackgroundColor proof can be trusted for a
 * backgroundColor wrap, returning a DISTINCT status per untrusted cause (Opus round-E #4) so the
 * caller can surface an honest reason rather than a blanket false "an opaque root covers it":
 *  - `image-cover`  — a non-`none` `background-image` is present on the read (covering) element →
 *                     the cover diagnosis is TRUE → `covered` → `wrap-not-visible`.
 *  - `field-absent` — the snapshot does NOT report `backgroundImage` at all (a broken/version-skewed
 *                     provider or test double). FAIL CLOSED (`proof-unavailable`), but the reason is
 *                     "could not verify" (`property-not-verifiable`), NOT a false cover claim. Without
 *                     this the guard would silently disable and restore the false-landed bug C3 exists
 *                     to prevent.
 *  - `trustworthy`  — an explicit `'none'`/`''` (image reported, and there is none) → normal verify.
 * Conservative by design: whether a gradient/image is fully opaque is not statically decidable, so any
 * image at all refuses the wrap rather than keeping it possibly invisible.
 *
 * SCOPE of the absent-field fail-closed (Opus medium #4). The auto-wrap verify is VS-Code-only today,
 * and the sole production provider (the preview iframe, `extractComputedStyleForProperties`) ALWAYS
 * emits `backgroundImage`, so this branch only trips for a broken/test provider — the intended
 * conservative default, NOT a regression for real backgroundColor edits. When the warning/verify path
 * is extended to SaaS/NodePod (HYP-1004 parity), those providers MUST likewise report `backgroundImage`
 * or every backgroundColor wrap would fail closed there; that requirement is carried on the parity ticket.
 */
function bgProofStatus(snapshot: Record<string, string>): 'image-cover' | 'field-absent' | 'trustworthy' {
  if (!('backgroundImage' in snapshot)) return 'field-absent'; // broken provider → can't confirm no cover
  const image = snapshot.backgroundImage;
  return !!image && image !== 'none' ? 'image-cover' : 'trustworthy';
}
