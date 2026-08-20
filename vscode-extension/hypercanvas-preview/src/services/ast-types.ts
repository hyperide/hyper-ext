import type { StyleForwardingWarning } from '@shared/types/style-forwarding-warning';

export interface AstOperationResult {
  success: boolean;
  error?: string;
  data?: unknown;
  /** Absolute path of the file that was actually mutated (may differ from the requested filePath for cross-file writes) */
  resolvedPath?: string;
  /** Content of resolvedPath read BEFORE the write (for undo tracking in cross-file scenarios) */
  contentBeforeWrite?: string;
  /** All cross-file paths mutated, with pre-write content — for multi-file undo tracking in batch operations */
  allCrossFileSnapshots?: ReadonlyArray<{ readonly resolvedPath: string; readonly contentBefore: string }>;
  /**
   * HYP-987 P1 (codex) — the operation did NOT end up owning the file's final content (it took a
   * verify-failed / warn-and-roll-back path). `_withUndoTracking` MUST NOT record an undo entry
   * in that case: if a concurrent edit landed in the (multi-second) verify window and the CAS
   * rollback therefore left that foreign content in place, recording the diff would attribute the
   * concurrent edit to THIS operation and Undo would erase it. A verified-landed write leaves this
   * unset so it still gets a proper undo entry.
   */
  skipUndoTracking?: boolean;
  /**
   * HYP-990 P1 (codex full panel) — an authoritative undo snapshot of the mutated file, captured
   * INSIDE the operation's per-path serialization lock (before + after). `_withUndoTracking` prefers
   * this over its own pre-lock `readFile`, which races two overlapping same-file edits (both read the
   * pre-edit content before either locks, so the second's undo would erase the first). Present when
   * the op mutated `path`; `before === after` means it changed nothing there (no entry recorded).
   */
  undoSnapshot?: { path: string; before: string; after: string };
}

export interface UpdateStylesResult extends AstOperationResult {
  className?: string;
  /** HYP-901 — present ONLY once the direct write + auto-wrap retry are both tried/excluded and
   *  rolled back; the file is unchanged from before this edit. See ast-update-utils.ts. */
  warning?: StyleForwardingWarning;
  /**
   * HYP-1292 — set when the probe-driven inline-style redirect's best-effort className sync
   * threw and was caught. The write above it still landed; this is visibility into a class-sync
   * near-miss, not a write failure. See ast-update-utils.ts.
   */
  classSyncWarning?: string;
}

export interface MoveResult {
  success: true;
  /** Human-readable list of best-effort adjustments (e.g. "added import: Foo from './Foo'", "inlined prop value `theme.primary`"). Omitted when the move was clean. */
  adjustments?: string[];
  /** Absolute path of the file that received the moved subtree (may differ from the source file for cross-file moves). */
  resolvedPath?: string;
  /** Pre-write content of the target file (for undo tracking). */
  contentBeforeWrite?: string;
  /** Pre-write content of every file mutated (source file + target file for cross-file moves). */
  allCrossFileSnapshots?: ReadonlyArray<{ readonly resolvedPath: string; readonly contentBefore: string }>;
}

export interface InsertElementResult extends AstOperationResult {
  newId?: string;
  index?: number;
}

export interface DuplicateElementResult extends AstOperationResult {
  newId?: string;
}

export interface WrapElementResult extends AstOperationResult {
  wrapperId?: string;
}

export interface UpdateTextResult extends AstOperationResult {
  data?: { updatedText: string };
  newLocation?: { line: number; column: number };
}
