/**
 * AST Bridge - handles AST-related messages from webview
 *
 * Routes ast:* messages to AstService and sends responses back.
 */

import * as fsSync from 'node:fs';
import path from 'node:path';
import { discoverLayout } from '@shared/i18n-text/resolve-i18n-resource';
import { writeI18nResource } from '@shared/i18n-text/write-i18n-resource';
import type * as vscode from 'vscode';
import type {
  AstOperationResult,
  DuplicateElementResult,
  InsertElementResult,
  WrapElementResult,
} from '../services/AstService';
import { AstService } from '../services/AstService';
import type { ErrorSnapshot, PostEditDiagnosticWatcher } from '../services/PostEditDiagnosticWatcher';
import type { NodeRef } from '@shared/element-tracing/types';
import type { StyleForwardingWarning } from '@shared/types/style-forwarding-warning';
import { UndoRedoService, type RedoResult, type UndoResult } from '../services/UndoRedoService';
import type { AstMessage, AstResponse } from '../types';
import { VSCodeFileIO } from '../vscode-file-io';
import { resolveWorkspacePath } from '../services/workspace-path';
import { toRepoRelativeElementId, toRepoRelativePath } from './monorepo-path-translate';

/**
 * HYP-991 — the AST message types that MUTATE source and therefore warrant a post-edit
 * language-server diagnostic check. Every handled `ast:*` type is a mutation today, but gating on
 * an explicit allowlist keeps a future read-only handler (which may still carry a `filePath`) from
 * triggering a check and broadcasting a spurious "cleared" that dismisses a still-valid warning.
 */
// `satisfies` pins every entry to a real AstMessage type, so a typo or a removed type fails the
// build (guards against the allowlist silently drifting from the union — review).
const POST_EDIT_CHECKED_MUTATION_TYPES = [
  'ast:updateStyles',
  'ast:updateProps',
  'ast:insertElement',
  'ast:deleteElements',
  'ast:duplicateElement',
  'ast:updateText',
  'ast:wrapElement',
  'ast:moveElement',
  'ast:swapElements',
  'ast:writeI18nResource',
] as const satisfies ReadonlyArray<AstMessage['type']>;
const POST_EDIT_CHECKED_MUTATIONS: ReadonlySet<string> = new Set(POST_EDIT_CHECKED_MUTATION_TYPES);

// File sink only when explicitly requested or in CI — never in normal production use
const _BRIDGE_DEBUG_LOG: string | null =
  process.env.HYPERIDE_AST_DEBUG_LOG ?? (process.env.CI === 'true' ? '/artifacts/ast-debug.log' : null);
function _dbgBridge(msg: string) {
  if (!_BRIDGE_DEBUG_LOG) return;
  console.log(msg);
  try {
    fsSync.appendFileSync(_BRIDGE_DEBUG_LOG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {}
}

export class AstBridge {
  private _astService: AstService;
  private _fileIO: VSCodeFileIO;
  private _undoRedoService: UndoRedoService;
  private _workspaceRoot: string;
  /** HYP-1012 monorepo follow-up — see `setAdditionalWorkspaceRoot`. */
  private _additionalWorkspaceRoot?: string;
  private _webview: vscode.Webview | null = null;
  /**
   * Sub-project path prefix for a monorepo opened at the repo ROOT (e.g.
   * `targets/conloca-app/`). Empty for single-package projects. Set by
   * PreviewPanel on (re)select; applied to every iframe-supplied `filePath` /
   * `elementId` so the repo-rooted AstService resolves the correct source file
   * even when two sub-projects share a path suffix (HYP-430).
   */
  private _subProjectPrefix = '';
  /**
   * HYP-991 — optional post-edit diagnostic watcher. When set, every successful mutation is
   * checked against the language server for NEW errors it introduced. Optional so tests and the
   * public direct-call paths that don't wire it keep working unchanged.
   */
  private _postEditWatcher?: PostEditDiagnosticWatcher;

  /**
   * CTO tg#9122/#9125 — host presenter for the non-forwarding style warning. When set, a warning is
   * routed to the extension host (which shows the NATIVE `vscode.window.showWarningMessage` toast +
   * "Details"/"Auto fix via AI" actions). The warning STILL travels to the webview, but flagged
   * `presentedNatively`, so the webview reverts its optimistic Inspector value yet renders no
   * duplicate card. Absent (tests / no host) → the warning stays in the response un-flagged and the
   * webview renders its own toast. Fire-and-forget: this callback returns immediately (the native
   * toast awaits user clicks); it must not be relied on to signal success — see the guard below.
   */
  private _onStyleForwardingWarning: ((warning: StyleForwardingWarning) => boolean) | null = null;

  /** Wire the host-native presenter for the non-forwarding style warning (see field doc). */
  setOnStyleForwardingWarning(handler: (warning: StyleForwardingWarning) => boolean): void {
    this._onStyleForwardingWarning = handler;
  }

  /**
   * @param astService Optional pre-built AstService. Production passes nothing
   *   and gets the real repo-rooted service. Tests inject a fake here instead of
   *   `mock.module('../services/AstService')`, whose process-global, irreversible
   *   module mock leaked into AstService's own tests under a non-isolated run
   *   (HYP-579). The default preserves the original construction exactly.
   */
  constructor(workspaceRoot: string, astService?: AstService) {
    this._workspaceRoot = workspaceRoot;
    this._fileIO = new VSCodeFileIO();
    this._astService = astService ?? new AstService(workspaceRoot, this._fileIO);
    this._undoRedoService = new UndoRedoService(workspaceRoot);
  }

  get astService(): AstService {
    return this._astService;
  }

  /**
   * Set the webview for sending responses
   */
  setWebview(webview: vscode.Webview): void {
    this._webview = webview;
  }

  /**
   * Handle AST message from webview.
   * If targetWebview is provided, responses go to that webview
   * instead of the default one (fixes cross-panel response routing).
   */
  /**
   * Pin the monorepo sub-project prefix (e.g. `targets/conloca-app/`). Empty
   * string for single-package projects (the default). PreviewPanel calls this
   * whenever the active component changes so subsequent iframe-driven AST ops
   * re-root their paths correctly (HYP-430).
   */
  setSubProjectPrefix(prefix: string): void {
    this._subProjectPrefix = prefix;
  }

  /**
   * HYP-991 — attach the post-edit diagnostic watcher. Re-applied by PanelRouter after a
   * workspace-switch rebuilds this bridge, so the check never goes stale on the old instance.
   */
  setPostEditWatcher(watcher: PostEditDiagnosticWatcher | undefined): void {
    this._postEditWatcher = watcher;
  }

  /**
   * Widen the undo/redo workspace boundary to also accept paths under `root`
   * (or narrow back to just the opened folder with null). Set from
   * ComponentsData.monorepoRoot whenever the Explorer's ancestor-fallback scan
   * surfaces sibling sub-projects living outside the opened leaf folder — those
   * sibling paths resolve outside `_workspaceRoot` by design, and without this
   * the undo/redo snapshot for editing them was silently rejected (HYP-909
   * follow-up).
   *
   * HYP-1012 monorepo follow-up: also widens `AstService`'s containment allowlist
   * (`resolveWorkspacePath`'s `additionalRoots`) and this bridge's own `_resolvePath` the
   * same way — otherwise the HYP-1012 containment check rejects the exact sibling reads/
   * writes this widened undo boundary exists to track, regressing the supported
   * opened-leaf-monorepo workflow (review round 1, HYP-1012 follow-up).
   */
  setAdditionalWorkspaceRoot(root: string | null): void {
    this._undoRedoService.setAdditionalWorkspaceRoot(root);
    this._astService.setAdditionalWorkspaceRoot(root);
    this._additionalWorkspaceRoot = root ?? undefined;
  }

  async handleMessage(
    message: AstMessage,
    targetWebview?: vscode.Webview,
    verifyElementId?: string,
    // HYP-990 M2 §9.4 — the selected occurrence index at a repeated `.map()` JSX site, threaded
    // per call (mirrors `verifyElementId`) for the confidence × verifiability matrix.
    itemIndex?: number | null,
  ): Promise<void> {
    // Path re-rooting for monorepo sub-projects happens upstream in
    // PanelRouter.routeMessage (the single ingress for ast:/editor:/styles:),
    // so `message` already carries repo-relative paths here. The public
    // direct-call methods below DO translate, because PreviewPanel invokes them
    // directly, bypassing PanelRouter (HYP-435).
    _dbgBridge(`[AstBridge.handleMessage] type=${message.type}`);

    // HYP-991 — snapshot workspace error diagnostics BEFORE the mutation (cheap, in-memory) so
    // the after-check can report only errors this edit newly introduced. Gated on the mutation
    // allowlist so a read-type message never pays the snapshot cost (review). `undefined` when no
    // watcher is wired (tests / direct-call paths), which short-circuits the after-check.
    const preEditErrors = POST_EDIT_CHECKED_MUTATIONS.has(message.type) ? this._postEditWatcher?.snapshot() : undefined;

    let response: AstResponse;

    try {
      switch (message.type) {
        case 'ast:updateStyles':
          response = await this._handleUpdateStyles(message, verifyElementId, itemIndex);
          break;

        case 'ast:updateProps':
          response = await this._handleUpdateProps(message);
          break;

        case 'ast:insertElement':
          response = await this._handleInsertElement(message);
          break;

        case 'ast:deleteElements':
          response = await this._handleDeleteElements(message);
          break;

        case 'ast:duplicateElement':
          response = await this._handleDuplicateElement(message);
          break;

        case 'ast:updateText':
          response = await this._handleUpdateText(message);
          break;

        case 'ast:wrapElement':
          response = await this._handleWrapElement(message);
          break;

        case 'ast:moveElement':
          response = await this._handleMoveElement(message);
          break;

        case 'ast:swapElements':
          response = await this._handleSwapElements(message);
          break;

        case 'ast:writeI18nResource':
          response = await this._handleWriteI18nResource(message);
          break;

        default:
          response = {
            type: 'ast:response',
            requestId: (message as { requestId: string }).requestId,
            success: false,
            error: `Unknown AST message type: ${(message as { type: string }).type}`,
          };
      }
    } catch (error) {
      console.error('[AstBridge] Error handling message:', error);
      response = {
        type: 'ast:response',
        requestId: (message as { requestId: string }).requestId,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    this._sendResponse(response, targetWebview);

    // HYP-991 — after a successful MUTATION (explicit allowlist — never a read, which would
    // broadcast a spurious "cleared" and dismiss a still-valid warning), fire-and-forget a
    // language-server diagnostic check for NEW errors the edit introduced. Never awaited (must
    // not delay the response) and never throws out (best-effort safety net).
    if (preEditErrors && response.success) {
      this._schedulePostEditDiagnosticCheck(message, preEditErrors);
    }
  }

  /**
   * HYP-991 — kick off the debounced post-edit diagnostic diff for a committed mutation.
   * Resolves the edited file to an absolute path (to compare with diagnostic URIs) and derives a
   * best-effort target elementId for the canvas overlay. Deliberately fire-and-forget.
   *
   * Overlay caveat: the derived id is the element's PRE-edit `file:line:col`. For position-shifting
   * mutations (wrap/move/insert, and delete whose target is gone) the post-render overlay id may no
   * longer match, so the canvas highlight is best-effort and can be absent for those — the native
   * notification (the primary surface) always fires. Style/prop/text edits (the common case, and
   * the CTO's dimensional-on-non-forwarding repro) keep a stable position and highlight reliably.
   */
  private _schedulePostEditDiagnosticCheck(message: AstMessage, baseline: ErrorSnapshot): void {
    const m = message as {
      filePath?: string;
      elementId?: string;
      sourceId?: string;
      aId?: string;
      parentId?: string;
      elementIds?: string[];
    };
    if (!m.filePath) return;
    // Best-effort target across the mutation shapes (updateStyles/Props/wrap: elementId; move/swap:
    // sourceId/aId; delete: elementIds[0]; insert: parentId). `null` when unresolved — the native
    // notification still fires, the overlay simply has nothing to anchor (never the empty string).
    // The id is whatever namespace the mutation carried (re-rooted repo-relative on the PanelRouter
    // path); the preview overlay reconciles it via `elementIdsMatch`'s `/`-boundary tolerance.
    // Truthiness fallback (NOT `??`): an empty-string id must fall through to `null`, else the
    // scoped clear's `elementIdsMatch(current, '')` never matches and a real clear is lost (review).
    const elementId = m.elementId || m.sourceId || m.aId || m.elementIds?.[0] || m.parentId || null;
    // This runs only after a successful mutation, so `m.filePath` already passed AstService's own
    // containment check — but `_resolvePath` can now throw (HYP-1012), and this call sits outside
    // handleMessage's top-level try/catch (fire-and-forget, must not delay the response). Guard
    // defensively rather than let a throw here crash message handling for an otherwise-successful edit.
    let resolvedFilePath: string;
    try {
      resolvedFilePath = this._resolvePath(m.filePath);
    } catch (error) {
      console.warn(
        `[AstBridge] _schedulePostEditDiagnosticCheck: path rejected by containment check: ${m.filePath}`,
        error,
      );
      return;
    }
    void this._postEditWatcher?.checkAfterEdit(baseline, resolvedFilePath, elementId, m.filePath, message.type);
  }

  // === Undo tracking helpers ===

  /**
   * Resolve + validate `filePath` against the same containment boundary `AstService` enforces
   * (`_workspaceRoot`, widened by `_additionalWorkspaceRoot` — see `setAdditionalWorkspaceRoot`).
   *
   * HYP-1012 follow-up, fixes two review-round-1 findings:
   *  - (P1) Previously used native `path.resolve`/`path.isAbsolute` instead of
   *    `resolveWorkspacePath`, so on Windows this returned a BACKSLASH path while AstService's
   *    `resolveWorkspacePath`-derived `resolvedPath` is always forward-slash (HYP-1012 Windows
   *    follow-up). `_withUndoTracking`'s `actualPath !== absolutePath` same-file check then
   *    false-mismatched on every Windows same-file write, misclassifying it as cross-file and
   *    skipping `contentBeforeWrite` capture — undo silently stopped working. Delegating to the
   *    shared `resolveWorkspacePath` makes both sides produce the identical forward-slash form.
   *  - (P1) Previously never validated containment at all, so every `_withUndoTracking`/
   *    `deleteElements`/`moveElement`/`swapElements` call site read the RAW untrusted
   *    `filePath` off disk for its undo pre-snapshot BEFORE `AstService` got a chance to reject
   *    it — an attacker-controlled nodeRef could exfiltrate file contents outside the workspace
   *    via the undo snapshot even though the eventual WRITE was correctly blocked. Now throws
   *    the same containment error `AstService` throws; every caller below catches it and runs
   *    the underlying operation untracked (identical to the pre-existing "file doesn't exist
   *    locally" fallback), so `AstService`'s own containment check still fires and the read
   *    never happens.
   */
  private _resolvePath(filePath: string): string {
    return resolveWorkspacePath(
      this._workspaceRoot,
      filePath,
      undefined,
      this._additionalWorkspaceRoot ? [this._additionalWorkspaceRoot] : [],
    );
  }

  private async _withUndoTracking<T extends AstOperationResult>(
    filePath: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    let absolutePath: string;
    try {
      absolutePath = this._resolvePath(filePath);
    } catch (error) {
      // Containment rejection — no pre-read, run untracked so AstService's own containment
      // check produces the user-facing `{ success: false }` (see method doc, HYP-1012 P1).
      console.warn(`[AstBridge] _withUndoTracking: path rejected by containment check: ${filePath}`, error);
      return await operation();
    }
    // Clear redo stack before ANY write — even when readFile fails.
    // If beginTracking() were called only after a successful readFile(), a
    // readFile() error (e.g. VS Code in-flight document update) would skip it,
    // leaving the redo stack non-empty. CMD_REDO would then replay a stale
    // entry from before the new edit. beginTracking() must always run first.
    this._undoRedoService.beginTracking();
    try {
      // Pre-read for the LEGACY fallback tracking only. Its failure (file not on disk yet) must NOT
      // discard a successful op's authoritative undoSnapshot (codex full panel #9) — so we do not
      // early-return here; we run the operation and inspect its result first.
      let contentBefore: string | undefined;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
      } catch {
        console.warn(`[AstBridge] _withUndoTracking: cannot pre-read file for undo tracking: ${absolutePath}`);
        contentBefore = undefined;
      }
      const result = await operation();
      if (result.success) {
        // HYP-987 P1 (codex) — the op took a warn-and-roll-back path and does NOT own the final
        // content (a concurrent edit may have landed in the verify window and been preserved by
        // the CAS rollback). Recording an undo entry here would let Undo erase that concurrent
        // edit. Skip tracking entirely for this op. Checked FIRST (Opus #6) so a "skip" can never be
        // overridden by a snapshot, even if a future path sets both.
        if (result.skipUndoTracking) return result;
        // HYP-990 P1 (codex full panel) — prefer the AUTHORITATIVE undo snapshot the operation
        // captured INSIDE its per-path serialization lock. `contentBefore` read above is BEFORE the
        // lock, so two overlapping same-file edits both read the pre-edit content and the second's
        // undo would erase the first. The lock-captured before/after has no such race — and is used
        // even when the pre-read failed.
        if (result.undoSnapshot) {
          const { path: snapPath, before, after } = result.undoSnapshot;
          if (before !== after) this._undoRedoService.recordEdit(snapPath, before, after);
          return result;
        }
        // The legacy fallback below needs the pre-read; if it failed, skip tracking rather than
        // recording against an undefined baseline.
        if (contentBefore === undefined) return result;
        // For cross-file writes (e.g. twitter: requested App.tsx but wrote to Feed.tsx),
        // the operation returns resolvedPath pointing to the actual mutated file.
        const actualPath = result.resolvedPath ?? absolutePath;
        const needsSnapshot = actualPath !== absolutePath;

        // For cross-file writes the operation captures contentBeforeWrite before the mutation.
        // For same-file writes contentBefore (read above) is authoritative.
        const contentBeforeActual = needsSnapshot ? result.contentBeforeWrite : contentBefore;
        if (contentBeforeActual === undefined) {
          // contentBeforeWrite read failed in AstService — skip undo snapshot rather
          // than recording an empty string which would erase the file on undo.
          console.warn(
            `[AstBridge] _withUndoTracking: contentBeforeWrite unavailable for cross-file write to ${path.basename(actualPath)}, skipping undo snapshot`,
          );
          return result;
        }

        let contentAfter: string;
        try {
          // Use readFileFromDisk to bypass document cache — doc.save() may not have synced yet
          contentAfter = await this._fileIO.readFileFromDisk(actualPath);
        } catch {
          try {
            contentAfter = await this._fileIO.readFile(actualPath);
          } catch {
            contentAfter = contentBeforeActual;
          }
        }
        if (contentBeforeActual !== contentAfter) {
          this._undoRedoService.recordEdit(actualPath, contentBeforeActual, contentAfter);
        } else {
          console.warn(
            `[AstBridge] _withUndoTracking: content unchanged after operation — NO undo entry recorded for ${path.basename(actualPath)}`,
          );
        }
      }
      return result;
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  // === Public mutation methods (with undo tracking, for PreviewPanel direct calls) ===

  async deleteElements(rawFilePath: string, rawElementIds: string[]): Promise<AstOperationResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementIds = rawElementIds.map((id) => toRepoRelativeElementId(id, this._subProjectPrefix));
    let absolutePath: string;
    try {
      absolutePath = this._resolvePath(filePath);
    } catch (error) {
      // Containment rejection — no pre-read, run untracked (see _resolvePath's doc, HYP-1012 P1).
      console.warn(`[AstBridge] deleteElements: path rejected by containment check: ${filePath}`, error);
      return this._astService.deleteElements(filePath, elementIds);
    }
    // Clear redo stack before ANY write — even when readFile fails (same invariant as _withUndoTracking).
    this._undoRedoService.beginTracking();
    try {
      // contentBefore: dirty buffer (preserves unsaved edits for undo snapshot).
      // diskContentBefore: disk-only read used for change-detection to avoid treating
      // a dirty buffer as a "modification" when the delete touched a different file.
      let contentBefore: string;
      let diskContentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
        diskContentBefore = await this._fileIO.readFileFromDisk(absolutePath);
      } catch {
        return this._astService.deleteElements(filePath, elementIds);
      }
      const result = await this._astService.deleteElements(filePath, elementIds);
      if (result.success) {
        // Collect all file modifications into a single atomic undo entry so that
        // one Cmd+Z restores every file that was changed by this delete operation.
        const batchEdits: Array<{ filePath: string; contentBefore: string; contentAfter: string }> = [];

        let mainAfter: string;
        try {
          mainAfter = await this._fileIO.readFileFromDisk(absolutePath);
        } catch {
          try {
            mainAfter = await this._fileIO.readFile(absolutePath);
          } catch {
            mainAfter = contentBefore;
          }
        }
        // Compare disk-to-disk to detect actual modification by the delete operation.
        // Using contentBefore (dirty buffer) vs mainAfter (disk) would produce false
        // positives when the file has unsaved edits but was not touched by this delete.
        if (diskContentBefore !== mainAfter) {
          batchEdits.push({ filePath: absolutePath, contentBefore, contentAfter: mainAfter });
        }

        for (const { resolvedPath: xPath, contentBefore: xBefore } of result.allCrossFileSnapshots ?? []) {
          let xAfter: string;
          try {
            // Disk-first to match the main-file path and avoid stale dirty-buffer reads
            // when the applyEdit sync in writeFile fails or lags behind the disk write.
            xAfter = await this._fileIO.readFileFromDisk(xPath);
          } catch {
            try {
              xAfter = await this._fileIO.readFile(xPath);
            } catch {
              xAfter = xBefore;
            }
          }
          if (xBefore !== xAfter) {
            batchEdits.push({ filePath: xPath, contentBefore: xBefore, contentAfter: xAfter });
          }
        }

        if (batchEdits.length > 0) {
          this._undoRedoService.recordBatchEdit(batchEdits);
        }
      }
      return result;
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  async duplicateElement(rawFilePath: string, rawElementId: string): Promise<DuplicateElementResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    return this._withUndoTracking(filePath, () => this._astService.duplicateElement(filePath, elementId));
  }

  async wrapElement(rawFilePath: string, rawElementId: string, wrapperType: string): Promise<WrapElementResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    return this._withUndoTracking(filePath, () => this._astService.wrapElement(filePath, elementId, wrapperType));
  }

  async pasteElement(rawFilePath: string, rawTargetId: string | null, tsxCode: string): Promise<InsertElementResult> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const targetId = rawTargetId === null ? null : toRepoRelativeElementId(rawTargetId, this._subProjectPrefix);
    return this._withUndoTracking(filePath, () => this._astService.pasteElement(filePath, targetId, tsxCode));
  }

  /** `panel` is optional — the content-based stack lives in UndoRedoService, not the panel. */
  async undo(panel?: vscode.WebviewPanel): Promise<UndoResult> {
    return this._undoRedoService.undo(panel);
  }

  async redo(panel?: vscode.WebviewPanel): Promise<RedoResult> {
    return this._undoRedoService.redo(panel);
  }

  /**
   * Whether the content-based undo/redo stack currently has an entry.
   * `undo()`/`redo()` both now return a tri-state (`UndoResult`/`RedoResult`:
   * `'undone'|'redone'` / `'empty'` / `'busy'`, HYP-990) that self-reports
   * "in progress"/"write failed" as `'busy'`, distinct from a genuinely
   * `'empty'` stack — callers should route off THAT return value, not this
   * getter, to decide whether a native undo/redo fallback is safe (falling
   * back on `'busy'` can revert/replay unrelated editor content — Codex P1,
   * PR #673 follow-up). `canUndo()`/`canRedo()` remain useful as a pre-call
   * inspection (e.g. UI enablement), just not as the busy/empty decision.
   */
  canUndo(): boolean {
    return this._undoRedoService.canUndo();
  }

  canRedo(): boolean {
    return this._undoRedoService.canRedo();
  }

  // === Read-only query methods (with sub-project prefix translation) ===

  /**
   * Resolve the full JSX range for `rawElementId` so the editor can select the
   * element's source (not just a caret). Wraps AstService.getElementRange() with
   * the same sub-project prefix translation the mutation methods apply, so Go-to-Code
   * resolves correctly for monorepo previews (HYP-771).
   *
   * Callers that bypass PanelRouter.routeMessage (PreviewPanel.goToCodeSelected,
   * preview-panel-context-menu, and PanelRouter._goToDefinitionViaLsp) must go through
   * this method instead of `astBridge.astService.getElementRange()` directly, which
   * skips translation and produces wrong paths under a non-empty sub-project prefix.
   */
  async getElementRange(rawFilePath: string, rawElementId: string): ReturnType<AstService['getElementRange']> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    return this._astService.getElementRange(filePath, elementId);
  }

  /**
   * Resolve the start cursor position for `rawElementId`. Wraps
   * AstService.getElementLocation() with sub-project prefix translation,
   * matching the same re-rooting that every mutation method applies (HYP-771).
   */
  async getElementLocation(
    rawFilePath: string,
    rawElementId: string,
    rawNodeRef?: NodeRef,
  ): ReturnType<AstService['getElementLocation']> {
    const filePath = toRepoRelativePath(rawFilePath, this._subProjectPrefix);
    const elementId = toRepoRelativeElementId(rawElementId, this._subProjectPrefix);
    const nodeRef = rawNodeRef ? (toRepoRelativeElementId(rawNodeRef, this._subProjectPrefix) as NodeRef) : undefined;
    return this._astService.getElementLocation(filePath, elementId, nodeRef);
  }

  // === Message handlers (routed from webview via handleMessage) ===

  /**
   * Handle updateStyles message
   */
  private async _handleUpdateStyles(
    message: Extract<AstMessage, { type: 'ast:updateStyles' }>,
    verifyElementId?: string,
    itemIndex?: number | null,
  ): Promise<AstResponse> {
    _dbgBridge(
      `[AstBridge._handleUpdateStyles] filePath=${message.filePath} elementId=${message.elementId} styles=${JSON.stringify(message.styles)}`,
    );
    // elementId from the client is in nodeRef format ("fileName:line:col") — pass as nodeRef for element resolution
    const nodeRef = message.elementId?.includes(':') ? message.elementId : undefined;
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateStyles(
        message.filePath,
        message.elementId,
        message.styles,
        message.state,
        nodeRef,
        message.selectedSourceTabId,
        message.domClasses,
        message.probeDriving,
        // HYP-987 P1 #3 — the iframe-relative id for the write-verify RPC, threaded per call
        // (not baked into a shared-mutable provider) so overlapping edits can't race.
        verifyElementId,
        // HYP-990 M2 §9.4 — threaded per call for the confidence × verifiability matrix.
        itemIndex,
      ),
    );

    // CTO tg#9122/#9125 — when a host presenter is wired, present the warning as the NATIVE VS Code
    // notification (no custom in-Inspector card). The warning still travels to the webview, FLAGGED
    // `presentedNatively`, so the webview reverts its optimistic Inspector value (the write was rolled
    // back) but does NOT render its own toast — keeping the Inspector in sync without a duplicate card
    // (review, Opus #3). The warning (with full structured diagnosis) is produced host-side, so the
    // host has everything it needs to present natively AND to hand the complete context to the AI flow.
    // The `presentedNatively` flag is set ONLY when the presenter returns a synchronous `true`
    // ACK that it accepted the warning for native presentation (codex full panel — the flag must not
    // be claimed merely because a callback is wired). A presenter that can't present (returns falsy) or
    // throws synchronously falls back to the webview toast. (An async rejection of the fire-and-forget
    // presenter is still a residual: showWarningMessage does not reject in practice, and the presenter
    // logs it — see extension.ts; a fully-robust confirm handshake is deferred to HYP-1004.)
    let hostPresentedWarning = false;
    if (result.success && result.warning && this._onStyleForwardingWarning) {
      try {
        hostPresentedWarning = this._onStyleForwardingWarning(result.warning) === true;
      } catch (err) {
        console.error('[AstBridge] style-forwarding warning presenter threw:', err);
      }
    }

    const responseWarning =
      result.success && result.warning
        ? hostPresentedWarning
          ? { ...result.warning, presentedNatively: true }
          : result.warning
        : undefined;

    return {
      type: 'ast:response',
      requestId: message.requestId,
      // HYP-901: spread `warning` only when present so a clean write's response shape
      // (`{ className }`) is unchanged — never `{ className, warning: undefined }`.
      success: result.success,
      data: result.success
        ? {
            className: result.className,
            ...(responseWarning ? { warning: responseWarning } : {}),
            // HYP-1292 — thread the best-effort className-sync warning to the webview response,
            // same spread-only-when-present shape as `warning` above.
            ...(result.classSyncWarning ? { classSyncWarning: result.classSyncWarning } : {}),
          }
        : undefined,
      error: result.error,
    };
  }

  /**
   * Handle updateProps message
   */
  private async _handleUpdateProps(message: Extract<AstMessage, { type: 'ast:updateProps' }>): Promise<AstResponse> {
    _dbgBridge(
      `[AstBridge._handleUpdateProps] filePath=${message.filePath} elementId=${message.elementId} props=${JSON.stringify(message.props)}`,
    );
    const nodeRef = message.elementId?.includes(':') ? message.elementId : undefined;
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateProps(message.filePath, message.elementId, message.props, nodeRef),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Handle updateText message
   */
  private async _handleUpdateText(message: Extract<AstMessage, { type: 'ast:updateText' }>): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.updateText(message.filePath, message.elementId, message.text),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      error: result.error,
    };
  }

  /**
   * Handle insertElement message
   */
  private async _handleInsertElement(
    message: Extract<AstMessage, { type: 'ast:insertElement' }>,
  ): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.insertElement(
        message.filePath,
        message.parentId,
        message.componentType,
        message.props,
        message.index,
        message.targetId,
        message.componentFilePath,
      ),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { newId: result.newId, index: result.index } : undefined,
      error: result.error,
    };
  }

  /**
   * Handle deleteElements message
   */
  private async _handleDeleteElements(
    message: Extract<AstMessage, { type: 'ast:deleteElements' }>,
  ): Promise<AstResponse> {
    const result = await this.deleteElements(message.filePath, message.elementIds);
    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.data,
      error: result.error,
    };
  }

  /**
   * Handle duplicateElement message
   */
  private async _handleDuplicateElement(
    message: Extract<AstMessage, { type: 'ast:duplicateElement' }>,
  ): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.duplicateElement(message.filePath, message.elementId),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { newId: result.newId } : undefined,
      error: result.error,
    };
  }

  /**
   * Handle wrapElement message
   */
  private async _handleWrapElement(message: Extract<AstMessage, { type: 'ast:wrapElement' }>): Promise<AstResponse> {
    const result = await this._withUndoTracking(message.filePath, () =>
      this._astService.wrapElement(message.filePath, message.elementId, message.wrapperType, message.wrapperProps),
    );

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: result.success,
      data: result.success ? { wrapperId: result.wrapperId } : undefined,
      error: result.error,
    };
  }

  /**
   * Handle moveElement message — moves any JSX element to any place.
   * Source and target need NOT share a direct JSX parent: same-parent,
   * cross-parent, cross-component, and cross-file moves are all supported.
   * Cross-file moves return `allCrossFileSnapshots`
   * covering BOTH the source and target file pre-write contents, so undo
   * needs the same batch-edit treatment as `deleteElements`.
   *
   * Internal failures (file I/O, parse errors, unresolvable nodeRefs) throw
   * out of `AstService.moveElement` per its contract — caught here and
   * surfaced as `success: false` to the iframe via the standard ast:response
   * envelope. From the iframe's standpoint moveElement otherwise always
   * succeeds.
   */
  private async _handleMoveElement(message: Extract<AstMessage, { type: 'ast:moveElement' }>): Promise<AstResponse> {
    let absolutePath: string;
    try {
      absolutePath = this._resolvePath(message.filePath);
    } catch (error) {
      // Containment rejection — no pre-read, run untracked (see _resolvePath's doc, HYP-1012 P1).
      console.warn(`[AstBridge] _handleMoveElement: path rejected by containment check: ${message.filePath}`, error);
      const r = await this._astService.moveElement(
        message.filePath,
        message.sourceId,
        message.targetId,
        message.position,
      );
      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: r.success,
        data: r.adjustments ? { adjustments: r.adjustments } : undefined,
      };
    }
    this._undoRedoService.beginTracking();
    try {
      // Snapshot the source file BEFORE the move so single-file moves can
      // record the standard contentBefore→contentAfter edit. For cross-file
      // moves the source-file snapshot also lives in `allCrossFileSnapshots`
      // (captured by AstService at write time) so we don't double-count below.
      let contentBefore: string;
      let diskContentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
        diskContentBefore = await this._fileIO.readFileFromDisk(absolutePath);
      } catch {
        // File doesn't exist locally — run the operation untracked.
        const r = await this._astService.moveElement(
          message.filePath,
          message.sourceId,
          message.targetId,
          message.position,
        );
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: r.success,
          data: r.adjustments ? { adjustments: r.adjustments } : undefined,
        };
      }

      let result: Awaited<ReturnType<AstService['moveElement']>>;
      try {
        result = await this._astService.moveElement(
          message.filePath,
          message.sourceId,
          message.targetId,
          message.position,
        );
      } catch (error) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'moveElement failed',
        };
      }

      // Cross-file moves carry their own per-file snapshots. Record those
      // (source AND target). Same-file moves carry no snapshots, so fall back
      // to the disk-vs-disk comparison on `absolutePath`.
      const batchEdits: Array<{ filePath: string; contentBefore: string; contentAfter: string }> = [];
      const snapshots = result.allCrossFileSnapshots;
      if (snapshots && snapshots.length > 0) {
        for (const { resolvedPath: xPath, contentBefore: xBefore } of snapshots) {
          let xAfter: string;
          try {
            xAfter = await this._fileIO.readFileFromDisk(xPath);
          } catch {
            try {
              xAfter = await this._fileIO.readFile(xPath);
            } catch {
              xAfter = xBefore;
            }
          }
          if (xBefore !== xAfter) {
            batchEdits.push({ filePath: xPath, contentBefore: xBefore, contentAfter: xAfter });
          }
        }
      } else {
        // Same-file move — diff `absolutePath` (or `result.resolvedPath` if it
        // diverged, mirroring `_withUndoTracking`).
        const actualPath = result.resolvedPath ?? absolutePath;
        let mainAfter: string;
        try {
          mainAfter = await this._fileIO.readFileFromDisk(actualPath);
        } catch {
          try {
            mainAfter = await this._fileIO.readFile(actualPath);
          } catch {
            mainAfter = contentBefore;
          }
        }
        // Use disk-vs-disk on the original absolutePath only when the operation
        // resolved to that same file. Cross-file resolution (different file)
        // would have produced an `allCrossFileSnapshots` entry above already.
        const sameFile = actualPath === absolutePath;
        const beforeForDiff = sameFile ? diskContentBefore : (result.contentBeforeWrite ?? contentBefore);
        const beforeForUndo = sameFile ? contentBefore : (result.contentBeforeWrite ?? contentBefore);
        if (beforeForDiff !== mainAfter) {
          batchEdits.push({ filePath: actualPath, contentBefore: beforeForUndo, contentAfter: mainAfter });
        }
      }

      if (batchEdits.length > 0) {
        this._undoRedoService.recordBatchEdit(batchEdits);
      }

      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: true,
        data: result.adjustments ? { adjustments: result.adjustments } : undefined,
      };
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  /**
   * Handle swapElements message (spec Task 8 container swap). Same-file only,
   * so undo tracking is a single-file diff — simpler than `_handleMoveElement`,
   * which also handles the cross-file branch. Internal failures throw out of
   * `AstService.swapElements` and surface as `success: false` to the iframe.
   */
  private async _handleSwapElements(message: Extract<AstMessage, { type: 'ast:swapElements' }>): Promise<AstResponse> {
    let absolutePath: string;
    try {
      absolutePath = this._resolvePath(message.filePath);
    } catch (error) {
      // Containment rejection — no pre-read, run untracked (see _resolvePath's doc, HYP-1012 P1).
      console.warn(`[AstBridge] _handleSwapElements: path rejected by containment check: ${message.filePath}`, error);
      const r = await this._astService.swapElements(message.filePath, message.aId, message.bId);
      return { type: 'ast:response', requestId: message.requestId, success: r.success };
    }
    this._undoRedoService.beginTracking();
    try {
      let contentBefore: string;
      let diskContentBefore: string;
      try {
        contentBefore = await this._fileIO.readFile(absolutePath);
        diskContentBefore = await this._fileIO.readFileFromDisk(absolutePath);
      } catch {
        // File not present locally — run untracked.
        const r = await this._astService.swapElements(message.filePath, message.aId, message.bId);
        return { type: 'ast:response', requestId: message.requestId, success: r.success };
      }

      let result: Awaited<ReturnType<AstService['swapElements']>>;
      try {
        result = await this._astService.swapElements(message.filePath, message.aId, message.bId);
      } catch (error) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: error instanceof Error ? error.message : 'swapElements failed',
        };
      }

      const actualPath = result.resolvedPath ?? absolutePath;
      const sameFile = actualPath === absolutePath;
      let after: string;
      try {
        after = await this._fileIO.readFileFromDisk(actualPath);
      } catch {
        try {
          after = await this._fileIO.readFile(actualPath);
        } catch {
          after = contentBefore;
        }
      }
      const beforeForDiff = sameFile ? diskContentBefore : (result.contentBeforeWrite ?? contentBefore);
      const beforeForUndo = sameFile ? contentBefore : (result.contentBeforeWrite ?? contentBefore);
      if (beforeForDiff !== after) {
        this._undoRedoService.recordBatchEdit([
          { filePath: actualPath, contentBefore: beforeForUndo, contentAfter: after },
        ]);
      }

      return { type: 'ast:response', requestId: message.requestId, success: true };
    } finally {
      this._undoRedoService.endTracking();
    }
  }

  /**
   * Handle writeI18nResource message.
   * Writes a translated value for the given key in the active locale dictionary.
   * If the key itself changes (previousKey provided), also updates the JSX child expression.
   */
  private async _handleWriteI18nResource(
    message: Extract<AstMessage, { type: 'ast:writeI18nResource' }>,
  ): Promise<AstResponse> {
    // Library whitelist mirrors the SaaS HTTP route. The webview message channel
    // does not enforce the I18nLibrary union at runtime, so a spoofed message
    // could pass any string here — guard before forwarding to writeI18nResource.
    const VALID_LIBRARIES = new Set<string>([
      'react-i18next',
      'i18next',
      'next-intl',
      'react-intl',
      'lingui',
      'custom',
    ]);
    if (!VALID_LIBRARIES.has(message.library)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid library' };
    }
    if (typeof message.newText !== 'string' || message.newText.length > 10_000) {
      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: false,
        error: 'newText exceeds maximum length of 10000 characters',
      };
    }
    // Reject path traversal via locale/namespace — same guard as the SaaS HTTP route.
    // Key validation prevents JSX injection when key is interpolated into {t("...")} expressions.
    const SAFE_SEGMENT = /^[\w-]{1,64}$/;
    if (!SAFE_SEGMENT.test(message.activeLocale)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid activeLocale' };
    }
    if (message.namespace !== undefined && !SAFE_SEGMENT.test(message.namespace)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid namespace' };
    }
    // Reject control chars (would break JSON parsing) and JSX-structural chars
    // ({, }, <, >). Curly braces in particular corrupt the source: the JSX-rewrite
    // path below builds `{t("KEY")}` and routes through parseMixedContent's
    // regex `/\{([^}]+)\}/g`, which is naïve about string literals — a `}` inside
    // the key prematurely closes the expression and the rest leaks into JSXText.
    const keyLen = message.key.length;
    if (keyLen === 0 || keyLen > 256 || /[\n\r\0{}<>]/.test(message.key)) {
      return { type: 'ast:response', requestId: message.requestId, success: false, error: 'Invalid key' };
    }

    const localeLayout = await discoverLayout(
      this._workspaceRoot,
      message.namespace,
      message.activeLocale,
      this._fileIO,
    ).catch(() => null);
    const localeFilePath = localeLayout?.getLocaleFilePath(message.activeLocale) ?? null;

    // When skipResourceWrite is set, skip the locale dictionary write — only update JSX below.
    // Used when the user switches to an existing key from the dropdown: we don't want to
    // overwrite the existing translation under the new key.
    let writeResult: AstOperationResult & { filePath: string | null };
    if (message.skipResourceWrite) {
      writeResult = { success: true, filePath: null };
    } else {
      const doWrite = async (): Promise<AstOperationResult & { filePath: string | null }> => {
        const r = await writeI18nResource({
          projectRoot: this._workspaceRoot,
          library: message.library,
          key: message.key,
          namespace: message.namespace,
          activeLocale: message.activeLocale,
          newText: message.newText,
          fileIO: this._fileIO,
        });
        return { success: r.success, error: r.error, filePath: r.filePath };
      };
      writeResult = localeFilePath ? await this._withUndoTracking(localeFilePath, doWrite) : await doWrite();
    }

    if (!writeResult.success) {
      return {
        type: 'ast:response',
        requestId: message.requestId,
        success: false,
        error: writeResult.error,
      };
    }

    // Always attempt to update the key literal in JSX when a previousKey is provided,
    // even if previousKey === message.key. The client can hold stale state (HMR clears
    // selectedIds briefly; ?? prev.i18nText preserves the pre-write key), so the file
    // may have a different key than what the client reports. updateI18nKey's fallback
    // handles this: when previousKey is not found, it replaces the first StringLiteral.
    const { filePath: i18nFilePath, elementId: i18nElementId } = message;
    const previousKey = message.previousKey;
    let newElementId: string | undefined;
    _dbgBridge(
      `[writeI18nResource] key=${message.key} previousKey=${previousKey} filePath=${i18nFilePath} elementId=${i18nElementId} skipResourceWrite=${message.skipResourceWrite}`,
    );
    if (i18nFilePath && i18nElementId && previousKey) {
      // HYP-1012 review round 2 (codex) P2: this debug snippet read the raw, untrusted
      // `i18nFilePath` unconditionally — even when `_BRIDGE_DEBUG_LOG` is unset and the
      // resulting snippet is never logged anywhere. Resolve through the same containment
      // check every other read/write in this class goes through FIRST; a rejected path
      // skips the debug read entirely (and the real mutation below still independently
      // rejects via AstService's own containment, so no functional change there).
      if (_BRIDGE_DEBUG_LOG) {
        try {
          const resolvedI18nPath = this._resolvePath(i18nFilePath);
          const preContent = await this._fileIO.readFile(resolvedI18nPath);
          const lines = preContent.split('\n');
          const snippet = lines
            .slice(109, 145)
            .map((l, i) => `L${i + 110}:${l}`)
            .join(' | ')
            .substring(0, 2000);
          _dbgBridge(`[pre-updateI18nKey] lines 110-145: ${snippet}`);
        } catch {}
      }
      const updateResult = await this._withUndoTracking(i18nFilePath, () =>
        this._astService.updateI18nKey(i18nFilePath, i18nElementId, previousKey, message.key),
      );
      _dbgBridge(
        `[updateI18nKey] result=${JSON.stringify({ success: updateResult.success, error: (updateResult as { error?: string }).error })}`,
      );
      if (!updateResult.success) {
        return {
          type: 'ast:response',
          requestId: message.requestId,
          success: false,
          error: updateResult.error,
        };
      }
      // JSX element opening tag position is invariant under key-only rewrites.
      // Return i18nElementId as canonical post-write ID for Path A selection re-attach.
      newElementId = i18nElementId;
    }

    return {
      type: 'ast:response',
      requestId: message.requestId,
      success: true,
      data: { filePath: writeResult.filePath, newElementId },
    };
  }

  /**
   * Send response back to webview.
   * Uses targetWebview if provided, otherwise falls back to default webview.
   */
  private _sendResponse(response: AstResponse, targetWebview?: vscode.Webview): void {
    const webview = targetWebview ?? this._webview;
    if (!webview) {
      console.warn('[AstBridge] No webview set, cannot send response');
      return;
    }

    console.log('[AstBridge] Sending response:', response.type, response.success);
    webview.postMessage(response);
  }
}
