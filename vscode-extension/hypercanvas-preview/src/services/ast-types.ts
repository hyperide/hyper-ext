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
}

export interface UpdateStylesResult extends AstOperationResult {
  className?: string;
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
