/**
 * @file Selection toggle helpers for canvas multi-selection.
 *
 * Accessed via: iframe-interaction.ts, useCanvasInteraction.ts, canvas-interaction.ts
 * Assumptions: nodeRef strings are stable unique identifiers (fileName:line:col)
 */

import type { SourceLocation } from '../element-tracing/types';

/**
 * True when a click should ADD/TOGGLE the clicked element in the current
 * selection instead of replacing it. Universal multi-select modifiers across
 * every element kind: Cmd (mac), Ctrl (win/linux), and Shift.
 *
 * Shift was historically omitted (only Cmd/Ctrl were handled), which silently
 * broke multi-select for users reaching for the conventional Shift modifier.
 */
export function isAdditiveSelectionEvent(e: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean }): boolean {
  return Boolean(e.metaKey || e.ctrlKey || e.shiftKey);
}

/**
 * Resolve the effective nodeRef for optimistic selection update.
 *
 * When nodeRef is null (server round-trip pending), synthesize a ref from source
 * so state.selectedIds is populated immediately. The synthetic key matches the
 * format produced by sourceToElementId() in the extension host, ensuring
 * keyboard shortcuts (Cmd+D, Delete) can act on the selection without waiting.
 *
 * Used by BOTH the single-click and additive (multi-select) paths to synthesize a
 * stable ref from source when nodeRef is null, so elements that resolve to a source
 * location but have no cached nodeRef can still be selected/toggled.
 */
export function computeEffectiveRef(nodeRef: string | null, source: SourceLocation): string {
  return nodeRef ?? `${source.fileName}:${source.line}:${source.column}`;
}

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
