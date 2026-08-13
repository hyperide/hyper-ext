/**
 * Shared keyboard handler for design-mode element navigation.
 *
 * Used by both SaaS editor (useHotkeysSetup.ts) and VS Code extension
 * (iframe-interaction.ts). Handles:
 * - Tab/Shift+Tab: sibling navigation with wrapping
 * - Delete/Backspace: delete selected elements (300ms debounce)
 * - Enter: select all direct children (150ms debounce)
 * - Shift+Enter: select parent element
 * - Escape: clear selection
 *
 * Uses NodeMap-based navigation (fiber tree structure).
 */

import type { NodeMapEntry, SourceLocation } from '../element-tracing/types';

/**
 * Lookup interface for NodeMap-based keyboard navigation.
 * Keyboard handler uses fiber tree structure for element navigation.
 */
export interface NodeMapLookup {
  /** Get NodeMapEntry by nodeRef */
  getEntry: (nodeRef: string) => NodeMapEntry | null;
  /** Find DOM element by source location (for keyboard navigation focus) */
  findDOMElement: (source: SourceLocation, itemIndex: number) => HTMLElement | null;
}

interface KeyboardHandlerCallbacks {
  onSelectElement: (id: string, itemIndex?: number | null) => void;
  onSelectMultiple: (ids: string[]) => void;
  onClearSelection: () => void;
  onDeleteElements: (ids: string[]) => void;
  onDuplicateElement?: (id: string) => void;
}

// ============================================================================
// NodeMap-based navigation (fiber tree structure)
// ============================================================================

/** Find parent nodeRef from the node map. */
export function findParentNodeRef(nodeRef: string, lookup: NodeMapLookup): string | null {
  const entry = lookup.getEntry(nodeRef);
  return entry?.parentRef ?? null;
}

/** Find direct child nodeRefs from the node map. */
export function findDirectChildNodeRefs(nodeRef: string, lookup: NodeMapLookup): string[] {
  const entry = lookup.getEntry(nodeRef);
  return entry?.children ?? [];
}

/** Find next/prev sibling nodeRef from parent's children, with wrapping. */
export function findSiblingNodeRef(nodeRef: string, direction: 'next' | 'prev', lookup: NodeMapLookup): string | null {
  const entry = lookup.getEntry(nodeRef);
  if (!entry?.parentRef) return null;

  const parent = lookup.getEntry(entry.parentRef);
  if (!parent) return null;

  const siblings = parent.children;
  const currentIndex = siblings.indexOf(nodeRef);
  if (currentIndex === -1) return null;

  let targetIndex: number;
  if (direction === 'prev') {
    targetIndex = currentIndex === 0 ? siblings.length - 1 : currentIndex - 1;
  } else {
    targetIndex = currentIndex === siblings.length - 1 ? 0 : currentIndex + 1;
  }

  return siblings[targetIndex] ?? null;
}

// ============================================================================
// Handler configuration
// ============================================================================

interface DesignKeydownConfig {
  getState: () => {
    selectedIds: string[];
    activeInstanceId?: string | null;
    /** itemIndex per selected nodeRef — used by Shift+Enter to pin parent to the correct .map() row */
    selectedItemIndices?: Record<string, number | null>;
  };
  getDocument: () => Document | null;
  callbacks: KeyboardHandlerCallbacks;
  /** If provided, handler only fires when this returns true */
  isDesignMode?: () => boolean;
  /** NodeMap lookup for fiber-based navigation */
  nodeMapLookup: NodeMapLookup;
}

/**
 * Create a keydown handler for design-mode element navigation.
 * Returns the handler function and a dispose function to clear timers.
 *
 * The handler returns true if the event was consumed.
 */
export function createDesignKeydownHandler(config: DesignKeydownConfig): {
  handler: (e: KeyboardEvent) => boolean;
  dispose: () => void;
} {
  const { getState, getDocument, callbacks, isDesignMode, nodeMapLookup } = config;

  let deleteDebounceTime = 0;
  let enterDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!target || !(target instanceof HTMLElement)) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function handler(e: KeyboardEvent): boolean {
    if (isDesignMode && !isDesignMode()) return false;
    if (isTypingTarget(e.target)) return false;

    const { selectedIds } = getState();
    const selectedId = selectedIds[0];
    if (!selectedId) {
      // Escape with no selection
      if (e.key === 'Escape') {
        callbacks.onClearSelection();
        return true;
      }
      return false;
    }

    const doc = getDocument();
    if (!doc) return false;

    // === Escape: clear selection ===
    if (e.key === 'Escape') {
      e.preventDefault();
      callbacks.onClearSelection();
      return true;
    }

    // === Tab/Shift+Tab: sibling navigation ===
    if (e.key === 'Tab') {
      e.preventDefault();

      const direction = e.shiftKey ? 'prev' : 'next';
      const targetRef = findSiblingNodeRef(selectedId, direction, nodeMapLookup);
      if (targetRef) {
        callbacks.onSelectElement(targetRef);
      }
      return true;
    }

    // === Delete/Backspace: delete elements ===
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (selectedIds.length === 0) return false;

      const now = Date.now();
      if (now - deleteDebounceTime < 300) {
        return true; // Swallow event during debounce
      }

      e.preventDefault();
      deleteDebounceTime = now;
      callbacks.onDeleteElements(selectedIds);
      return true;
    }

    // === Enter / Shift+Enter: child/parent navigation ===
    if (e.key === 'Enter') {
      e.preventDefault();

      if (enterDebounceTimer) {
        clearTimeout(enterDebounceTimer);
      }

      const shiftKey = e.shiftKey;
      enterDebounceTimer = setTimeout(() => {
        const { selectedIds: freshIds, selectedItemIndices } = getState();
        const freshId = freshIds[0];
        if (!freshId) return;

        if (shiftKey) {
          const parentRef = findParentNodeRef(freshId, nodeMapLookup);
          if (parentRef) {
            const itemIndex = selectedItemIndices?.[freshId];
            callbacks.onSelectElement(parentRef, itemIndex);
          } else {
            callbacks.onClearSelection();
          }
        } else {
          const childRefs = findDirectChildNodeRefs(freshId, nodeMapLookup);
          if (childRefs.length > 0) {
            callbacks.onSelectMultiple(childRefs);
          }
        }
      }, 150);

      return true;
    }

    // === Cmd+D / Ctrl+D: duplicate selected element ===
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd' && !e.shiftKey) {
      if (callbacks.onDuplicateElement) {
        e.preventDefault();
        callbacks.onDuplicateElement(selectedId);
        return true;
      }
    }

    return false;
  }

  function dispose(): void {
    if (enterDebounceTimer) {
      clearTimeout(enterDebounceTimer);
      enterDebounceTimer = null;
    }
  }

  return { handler, dispose };
}
