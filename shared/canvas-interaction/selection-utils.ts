/**
 * @file Selection toggle helpers for canvas multi-selection.
 *
 * Accessed via: iframe-interaction.ts, useCanvasInteraction.ts, canvas-interaction.ts
 * Assumptions: nodeRef strings are stable unique identifiers (fileName:line:col)
 */

/**
 * Toggle a nodeRef in the current selection array.
 * - If nodeRef is null → return empty array (replace with nothing).
 * - If nodeRef is already in selectedIds → remove it.
 * - Otherwise → add it.
 *
 * Does not mutate the input array.
 */
export function toggleNodeRefInSelection(selectedIds: string[], nodeRef: string | null): string[] {
  if (nodeRef === null) return [];
  if (selectedIds.includes(nodeRef)) {
    return selectedIds.filter((id) => id !== nodeRef);
  }
  return [...selectedIds, nodeRef];
}

/**
 * Produce an updated selectedItemIndices map after toggling nodeRef.
 * - If nodeRef was removed from selection → drop its entry.
 * - If nodeRef was added → record itemIndex (if non-null).
 * - Otherwise (null nodeRef) → return empty map.
 */
export function toggleItemIndex(
  selectedItemIndices: Record<string, number | null>,
  nodeRef: string | null,
  nextSelectedIds: string[],
  itemIndex: number | null,
): Record<string, number | null> {
  if (nodeRef === null) return {};
  if (!nextSelectedIds.includes(nodeRef)) {
    // nodeRef was removed — drop its entry
    const result = { ...selectedItemIndices };
    delete result[nodeRef];
    return result;
  }
  // nodeRef was added
  if (itemIndex !== null && itemIndex !== undefined) {
    return { ...selectedItemIndices, [nodeRef]: itemIndex };
  }
  return selectedItemIndices;
}
