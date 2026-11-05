/**
 * false (nothing written) requires a full view reset; true means every change was applied. Nothing is rolled back: an
 * exception from beforeApply leaves the rows unwritten, one from apply may leave earlier rows written, and either way
 * the caller must render in full. Changes are passed through unchanged, so a caller may extend immutableRowDelta's.
 */
export function patchKeyedRows<Change, Target>(
  changes: readonly Change[] | null,
  handlers: {
    /** Return the verified view target for a change, or null, undefined or false if the view does not match. */
    locate(change: Change): Target | null | undefined | false;
    apply(change: Change, target: Exclude<Target, null | undefined | false>): void;
    /** Runs once after every target is verified and before the first write; must not replace or detach a located target. */
    beforeApply?(): void;
  },
): boolean;
