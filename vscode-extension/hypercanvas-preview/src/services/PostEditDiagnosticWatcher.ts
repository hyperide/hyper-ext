/**
 * @file HYP-991 — PostEditDiagnosticWatcher.
 *
 * The CTO safety net: after a HyperIDE visual-editor AST mutation commits to disk, ask the
 * TypeScript / language server whether the edit introduced a NEW error-severity diagnostic
 * (a red underline). If so, broadcast a `diagnostic:postEditError` warning to every webview
 * panel so the preview canvas flags the element, and (host-side) raise a standard platform
 * notification for the warning message.
 *
 * Reached at runtime from: AstBridge.handleMessage — `snapshot()` is called synchronously
 * BEFORE the mutation dispatch (cheap, in-memory), and `checkAfterEdit(...)` is fired-and-
 * forgotten AFTER a successful mutation (never blocks the RPC response).
 *
 * Invariants:
 *  - Baseline is a WORKSPACE-WIDE snapshot of current error diagnostics, so a NEW error in ANY
 *    file (including a cross-file cascade or an importer) is detected — not only the edited file.
 *  - Diagnostics are compared as a per-file MULTISET keyed by `code::message` (NOT position): an
 *    AST edit routinely shifts line numbers, and a position-keyed signature would report a
 *    pre-existing error that merely moved as "new". Only a genuine count increase counts as new,
 *    so a warning always points at damage THIS edit did (review: false-positive).
 *  - Rapid sequential edits: a superseded in-flight check hands its (older) baseline to the newer
 *    one via `_pendingBaseline`, so the newer check diffs against the OLDEST un-reported baseline
 *    and never drops an error the superseded check would have reported (review: dropped warning).
 *  - The CLEAR is signature-based, not "no new errors": a standing warning is cleared only once the
 *    exact diagnostics it reported are actually GONE — a later edit that leaves the error in place
 *    (or is on a different element) never wipes a still-valid warning (review). A persistent
 *    diagnostics listener also clears it when the user fixes the error BY HAND or via the AI (no
 *    AST mutation fires in that case).
 *
 * Past bug this guards: HYP-987 M1 caught only ONE class of silently-broken edit (a style write
 * on a non-forwarding component). The CTO saw many run screenshots where an edit left red TS
 * errors with no warning at all — this is the general catch-all.
 */

import * as vscode from 'vscode';
import type {
  PostEditDiagnostic,
  PostEditDiagnosticClearMessage,
  PostEditDiagnosticErrorMessage,
  PostEditDiagnosticWarning,
} from '@shared/types/post-edit-diagnostic-warning';

/** Error snapshot: normalized file key → multiset (signature → count) of Error-severity diagnostics. */
export type ErrorSnapshot = Map<string, Map<string, number>>;

/** The overlay-driving messages this watcher broadcasts to the webviews via StateHub. */
type WatcherBroadcast = PostEditDiagnosticErrorMessage | PostEditDiagnosticClearMessage;

/**
 * The watcher's two sinks. `broadcast` drives the on-canvas element highlight (StateHub → the
 * preview webview's overlay). `notifyError` raises the standard PLATFORM notification for the
 * warning MESSAGE (extension host `vscode.window.showWarningMessage` + "Auto fix via AI"), per the
 * CTO UX directive that the message be a native notification, not a custom banner.
 */
export interface PostEditDiagnosticSink {
  broadcast: (message: WatcherBroadcast) => void;
  notifyError: (warning: PostEditDiagnosticWarning) => void;
}

/** One newly-introduced error, carrying both its display shape and its match key for clear-tracking. */
interface NewError {
  diagnostic: PostEditDiagnostic;
  fileKey: string;
  signature: string;
}

/** What the last broadcast warning reported, so we can clear it once those exact errors are gone. */
interface LastReported {
  elementId: string | null;
  entries: Array<{ fileKey: string; signature: string }>;
}

/** Trailing-debounce quiet window after the last diagnostics change before we consider it settled. */
const DEFAULT_SETTLE_DEBOUNCE_MS = 450;
/** Hard cap on how long we wait for the TS server to settle before diffing whatever we have. */
const DEFAULT_MAX_SETTLE_MS = 3500;
/** Cap on how many new errors we carry in the warning payload (headline + a few for context). */
const MAX_REPORTED_DIAGNOSTICS = 5;

/** Settle-timing overrides. Production uses the defaults; tests pass tiny values to run fast. */
export interface PostEditDiagnosticWatcherOptions {
  settleDebounceMs?: number;
  maxSettleMs?: number;
}

/** Only macOS/Windows have case-insensitive filesystems; Linux (CI, containers) is case-sensitive. */
const CASE_INSENSITIVE_FS = process.platform === 'darwin' || process.platform === 'win32';

/**
 * Normalize a path for use as a snapshot key: unify separators, and lowercase ONLY on a
 * case-insensitive filesystem. Lowercasing unconditionally would collapse `Card.tsx` and
 * `card.tsx` into one key on Linux, merging their diagnostics (review).
 */
function normalizeFsPath(p: string): string {
  const unified = p.replace(/\\/g, '/');
  return CASE_INSENSITIVE_FS ? unified.toLowerCase() : unified;
}

/**
 * Position-INDEPENDENT signature: the diagnostic code plus its message. Line/column are excluded
 * on purpose so an unchanged error that merely shifted lines after an edit still matches its
 * baseline entry (see file header). VS Code's `code` may be a primitive or `{ value }`.
 */
function diagnosticSignature(d: vscode.Diagnostic): string {
  const code = typeof d.code === 'object' && d.code !== null ? d.code.value : d.code;
  return `${code ?? ''}::${d.message}`;
}

export class PostEditDiagnosticWatcher {
  private _generation = 0;
  /** Oldest un-reported baseline while one or more checks are in flight (rapid-edit handoff). */
  private _pendingBaseline: ErrorSnapshot | null = null;
  /** The diagnostics of the currently-standing warning, so it clears only once they are gone. */
  private _lastReported: LastReported | null = null;
  private readonly _settleDebounceMs: number;
  private readonly _maxSettleMs: number;
  /** Persistent listener that clears a standing warning when its errors are fixed WITHOUT an edit. */
  private readonly _resolveSub: vscode.Disposable;
  private _resolveTimer: ReturnType<typeof setTimeout> | undefined;
  private _disposed = false;

  /**
   * @param _sink overlay broadcaster + native-notification raiser (the watcher's only side effects).
   * @param options settle-timing overrides (tests pass small values; production uses defaults).
   */
  constructor(
    private readonly _sink: PostEditDiagnosticSink,
    options?: PostEditDiagnosticWatcherOptions,
  ) {
    this._settleDebounceMs = options?.settleDebounceMs ?? DEFAULT_SETTLE_DEBOUNCE_MS;
    this._maxSettleMs = options?.maxSettleMs ?? DEFAULT_MAX_SETTLE_MS;
    // Clear a standing warning when its errors vanish outside our edit path (hand-fix / AI-fix).
    // Skipped while a post-edit check is in flight (`_pendingBaseline !== null`) — that check owns
    // the outcome, and the TS server's transient mid-revalidation empties must not race it into a
    // false clear (review).
    this._resolveSub = vscode.languages.onDidChangeDiagnostics(() => {
      if (!this._lastReported || this._pendingBaseline !== null) return;
      if (this._resolveTimer) clearTimeout(this._resolveTimer);
      this._resolveTimer = setTimeout(() => this._maybeClearResolved(), this._settleDebounceMs);
    });
  }

  /**
   * Tear down the persistent listener AND neutralize any in-flight `checkAfterEdit`: bumping the
   * generation + setting `_disposed` makes a post-settle continuation no-op, so a native toast can
   * never pop after the extension/panel has torn down (review). Wired into the ext's disposables.
   */
  dispose(): void {
    this._disposed = true;
    this._generation++;
    if (this._resolveTimer) clearTimeout(this._resolveTimer);
    this._resolveSub.dispose();
  }

  /**
   * Forget any standing warning and clear its highlight — called on a workspace switch, where the
   * old project's diagnostics no longer apply and a stale highlight/clear would target a file that
   * is no longer displayed (review). The persistent listener stays live for the new workspace.
   */
  reset(): void {
    if (this._resolveTimer) clearTimeout(this._resolveTimer);
    this._generation++; // supersede any in-flight check from the old workspace
    this._pendingBaseline = null;
    if (this._lastReported) {
      const { elementId } = this._lastReported;
      this._lastReported = null;
      this._sink.broadcast({ type: 'diagnostic:postEditErrorCleared', elementId });
    }
  }

  /**
   * Synchronous, cheap, in-memory snapshot of ALL current Error-severity diagnostics in the
   * workspace, as a per-file multiset. Call this BEFORE a mutation to establish the baseline.
   */
  snapshot(): ErrorSnapshot {
    const snap: ErrorSnapshot = new Map();
    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      const counts = new Map<string, number>();
      for (const d of diags) {
        if (d.severity !== vscode.DiagnosticSeverity.Error) continue;
        const sig = diagnosticSignature(d);
        counts.set(sig, (counts.get(sig) ?? 0) + 1);
      }
      if (counts.size > 0) snap.set(normalizeFsPath(uri.fsPath), counts);
    }
    return snap;
  }

  /**
   * After a successful mutation, wait for the language server to settle, then diff current errors
   * against the oldest un-reported baseline. If NEW errors appeared, broadcast a
   * `diagnostic:postEditError` warning + native notification. Otherwise, clear a standing warning
   * ONLY if the errors it reported are now actually gone. Fire-and-forget: never awaited, never
   * throws out.
   */
  async checkAfterEdit(
    baseline: ErrorSnapshot,
    editedFilePath: string,
    elementId: string | null,
    componentPath: string,
    mutationType: string,
  ): Promise<void> {
    const generation = ++this._generation;
    if (this._pendingBaseline === null) this._pendingBaseline = baseline;
    const effectiveBaseline = this._pendingBaseline;
    // Cancel any resolve timer scheduled by the edit's own diagnostic churn — this check owns the
    // outcome now, so that timer must not fire mid-revalidation into a false clear (review).
    if (this._resolveTimer) clearTimeout(this._resolveTimer);
    try {
      await this._awaitSettle();
      // Superseded by a newer edit, or the watcher was disposed while we waited — drop this check.
      if (generation !== this._generation || this._disposed) return;
      this._pendingBaseline = null;

      const newErrors = this._collectNewErrors(effectiveBaseline, normalizeFsPath(editedFilePath));
      if (newErrors.length === 0) {
        // No NEW errors — but that is NOT "the standing error is fixed". Clear only if the exact
        // diagnostics the standing warning reported are actually gone (review: a non-fixing edit
        // must not wipe a still-valid warning).
        this._maybeClearResolved();
        return;
      }

      const diagnostics = newErrors.slice(0, MAX_REPORTED_DIAGNOSTICS).map((e) => e.diagnostic);
      // `totalErrorCount` is the REAL count; `diagnostics` is capped for payload — so the
      // notification/AI-prompt never claim "5 errors" when 8 were introduced (review).
      const baseWarning = { componentPath, mutationType, diagnostics, totalErrorCount: newErrors.length };

      if (elementId === null) {
        // No element to anchor a highlight to. Fire the native notification only — and do NOT touch
        // the overlay or the standing-warning tracking, which would strand the previous highlight
        // (a null-id clear can never match it) — review (Opus #1 / codex #4).
        this._sink.notifyError({ elementId: null, ...baseWarning });
        return;
      }

      const newSignatures = new Set(newErrors.map((e) => `${e.fileKey}::${e.signature}`));
      // Suppress a duplicate native toast only when this is a genuine repeat: the SAME element AND
      // every new error already tracked by the standing warning (review — element-scoped, not just
      // signature-scoped). The overlay is still (re)applied.
      const isRepeatOfStanding =
        this._lastReported !== null &&
        this._lastReported.elementId === elementId &&
        newErrors.every((e) =>
          this._lastReported!.entries.some((p) => p.fileKey === e.fileKey && p.signature === e.signature),
        );
      // Track ALL new errors PLUS any still-present errors from the previous standing warning, so a
      // fix of only the newest errors doesn't clear a warning whose EARLIER errors remain (review).
      const current = this.snapshot();
      const carriedOver = (this._lastReported?.entries ?? []).filter(
        (p) =>
          !newSignatures.has(`${p.fileKey}::${p.signature}`) && (current.get(p.fileKey)?.get(p.signature) ?? 0) > 0,
      );
      this._lastReported = {
        elementId,
        entries: [...newErrors.map((e) => ({ fileKey: e.fileKey, signature: e.signature })), ...carriedOver],
      };
      const warning: PostEditDiagnosticWarning = { elementId, ...baseWarning };
      // Overlay highlight (webview) + standard platform notification (native host toast). Under
      // RAPID overlapping edits the surviving check diffs against an EARLIER baseline but attributes
      // to THIS (latest) edit — a best-effort attribution favoring the most recent edit.
      this._sink.broadcast({ type: 'diagnostic:postEditError', warning });
      if (!isRepeatOfStanding) this._sink.notifyError(warning);
    } catch (err) {
      // Best-effort; never surface as a failed edit. Only reset the handoff baseline if THIS check
      // still owns it (a superseded check must not wipe the newer check's baseline — review).
      if (generation === this._generation) this._pendingBaseline = null;
      console.error('[PostEditDiagnosticWatcher] checkAfterEdit failed:', err);
    }
  }

  /**
   * Multiset diff of the current workspace errors against `baseline`, returning each Error-severity
   * diagnostic whose signature count now exceeds the baseline count (genuinely new). The edited
   * file's own new errors are ordered FIRST (most likely cause; drives the headline).
   */
  private _collectNewErrors(baseline: ErrorSnapshot, editedFileKey: string): NewError[] {
    const editedFileErrors: NewError[] = [];
    const otherFileErrors: NewError[] = [];

    for (const [uri, diags] of vscode.languages.getDiagnostics()) {
      const fileKey = normalizeFsPath(uri.fsPath);
      // A working copy of the baseline counts we decrement as we account for pre-existing errors.
      const remaining = new Map(baseline.get(fileKey) ?? []);
      for (const d of diags) {
        if (d.severity !== vscode.DiagnosticSeverity.Error) continue;
        const signature = diagnosticSignature(d);
        const left = remaining.get(signature) ?? 0;
        if (left > 0) {
          remaining.set(signature, left - 1); // accounts for a pre-existing occurrence
          continue;
        }
        const entry: NewError = {
          fileKey,
          signature,
          diagnostic: {
            filePath: uri.fsPath,
            message: d.message,
            line: d.range.start.line + 1,
            column: d.range.start.character,
          },
        };
        if (fileKey === editedFileKey) editedFileErrors.push(entry);
        else otherFileErrors.push(entry);
      }
    }
    return [...editedFileErrors, ...otherFileErrors];
  }

  /** Broadcast a scoped clear once EVERY diagnostic the standing warning reported is gone. */
  private _maybeClearResolved(): void {
    // Re-check ownership at FIRE time (not just when the timer was scheduled): a check may have gone
    // in flight since, or the watcher may have been disposed — either way, don't race a false clear.
    if (this._disposed || this._pendingBaseline !== null) return;
    const reported = this._lastReported;
    if (!reported) return;
    const current = this.snapshot();
    const stillPresent = reported.entries.some((e) => (current.get(e.fileKey)?.get(e.signature) ?? 0) > 0);
    if (stillPresent) return;
    this._lastReported = null;
    this._sink.broadcast({ type: 'diagnostic:postEditErrorCleared', elementId: reported.elementId });
  }

  /**
   * Resolve once the language server's diagnostics have settled: a trailing-debounce quiet window
   * after the last `onDidChangeDiagnostics`, bounded by MAX_SETTLE_MS. We do NOT filter events by
   * URI — an edit can cascade errors into importer files — so any diagnostics activity keeps the
   * window open; the hard cap keeps unrelated background churn from stalling us.
   */
  private _awaitSettle(): Promise<void> {
    return new Promise((resolve) => {
      let settled = false;
      let debounceTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        if (debounceTimer) clearTimeout(debounceTimer);
        clearTimeout(maxTimer);
        sub.dispose();
        resolve();
      };
      const sub = vscode.languages.onDidChangeDiagnostics(() => {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(finish, this._settleDebounceMs);
      });
      const maxTimer = setTimeout(finish, this._maxSettleMs);
    });
  }
}
