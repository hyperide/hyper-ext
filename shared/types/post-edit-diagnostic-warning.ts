/**
 * @file HYP-991 — shared shape for the "this visual edit left a code error" warning.
 *
 * Surfaced when a HyperIDE AST mutation (style/prop/text write, wrap, move, delete, duplicate)
 * commits to disk and the TypeScript / language-server then reports a NEW error-severity
 * diagnostic that was not present before the edit. This is the general safety net requested by
 * the CTO (HYP-991) — distinct from and complementary to HYP-987 M1's narrow non-forwarding
 * StyleForwardingWarning (which fires from the style-write RPC response itself, pre-settle).
 *
 * Accessed via:
 *  - Produced host-side by the VS Code extension (services/PostEditDiagnosticWatcher.ts) after
 *    it diffs `vscode.languages.getDiagnostics` error snapshots before vs after the edit and the
 *    TS server has settled.
 *  - Surfaced two ways (CTO UX directive tg#9122): the warning MESSAGE is a STANDARD platform
 *    notification raised host-side (`vscode.window.showWarningMessage` + "Auto fix via AI"), NOT a
 *    custom in-Inspector banner; and the AFFECTED ELEMENT is highlighted on the preview canvas via
 *    an error-state overlay driven by the `diagnostic:postEditError` StateHub broadcast.
 *
 * Assumptions: by the time this value exists the edit HAS committed to disk and the diagnostic is
 * genuinely NEW (present in the after-snapshot, absent from the before-snapshot). Pre-existing
 * errors the user already had are excluded, so a warning always points at damage this edit did.
 */

/** A single new error-severity diagnostic attributed to a post-edit source file. */
export interface PostEditDiagnostic {
  /** Repo-relative (or absolute, as provided by the host) path of the file the error is in. */
  filePath: string;
  /** The language-server diagnostic message, e.g. "Type 'string' is not assignable to 'number'". */
  message: string;
  /** 1-based line the error range starts on (for display / go-to-code). */
  line: number;
  /** 0-based column the error range starts on. */
  column: number;
}

/**
 * The broadcast payload. `elementId` + `componentPath` identify the element the mutation targeted
 * so the preview canvas can flag it; `componentPath` + `diagnostics` feed the native notification
 * message and the AI-fix prompt. `diagnostics` carries the new errors (at least one; first = headline).
 */
export interface PostEditDiagnosticWarning {
  /**
   * NodeRef of the element the committed mutation targeted, used to anchor the canvas overlay and
   * scope the clear. `null` when the mutation's target could not be resolved (the native
   * notification still shows; the overlay simply has nothing to anchor to).
   */
  elementId: string | null;
  /** Path of the component file the edit primarily targeted (for the AI-fix prompt + display). */
  componentPath: string;
  /** The mutation kind that introduced the error, e.g. "ast:updateStyles" (for the AI-fix prompt). */
  mutationType: string;
  /**
   * The new error-severity diagnostics the edit introduced (non-empty), CAPPED for payload size.
   * When `totalErrorCount` exceeds `diagnostics.length`, the extra errors are not carried here.
   */
  diagnostics: PostEditDiagnostic[];
  /** TOTAL count of new errors this edit introduced — may exceed `diagnostics.length` (the cap). */
  totalErrorCount: number;
}

/** StateHub broadcast message type carrying a PostEditDiagnosticWarning. */
export interface PostEditDiagnosticErrorMessage {
  type: 'diagnostic:postEditError';
  warning: PostEditDiagnosticWarning;
}

/**
 * StateHub broadcast that clears a standing post-edit error flag once the exact diagnostics it
 * reported are actually GONE (a later edit fixed them, or the user hand-fixed / accepted the AI
 * fix). `elementId` is the STANDING warning's element (the one that was flagged), so a consumer
 * clears ONLY its own matching highlight — an unrelated standing highlight is never wiped. `null`
 * when the original warning had no resolved element (the overlay had nothing anchored anyway).
 */
export interface PostEditDiagnosticClearMessage {
  type: 'diagnostic:postEditErrorCleared';
  /** The flagged element of the now-resolved warning; consumers clear only their matching highlight. */
  elementId: string | null;
}
