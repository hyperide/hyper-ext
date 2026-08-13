/**
 * @file Selection state manager for CanvasEngine
 *
 * Accessed via: CanvasEngine selection methods (select, hover, map context)
 * Assumptions: single source of truth for selection state; consumers read via getSelection()
 * Past bugs: HYP-290b — map-iteration context resolution
 */

import { toggleItemIndex } from '@shared/canvas-interaction/selection-utils';
import type { EventEmitter } from '../events/EventEmitter';
import type { CanvasEngineEvents, CanvasEventName } from '../events/events';
import type { ComponentInstance, MapIterationContext, SelectionState } from '../models/types';
import type { ASTNode } from '../types/ast';

interface SelectionManagerDeps {
  events: EventEmitter;
  tree: {
    getInstance(id: string): ComponentInstance | undefined;
    getRoot(): ComponentInstance;
    getChildren(id: string): ComponentInstance[];
  };
  getRenderedAstTrees: () => ASTNode[][];
  findASTNode: (nodes: ASTNode[], id: string) => ASTNode | null;
  getActiveTracer?: () => { getSourceByNodeRef(id: string): { line: number; column: number } | null } | null;
  findAstNodeBySourceLoc?: (nodes: ASTNode[], line: number, column: number) => ASTNode | null;
}

export class SelectionManager {
  private selection: SelectionState = {
    selectedIds: [],
    hoveredId: null,
    hoveredItemIndex: null,
    selectedItemIndices: new Map(),
  };

  private emitEvent: <K extends keyof CanvasEngineEvents>(eventName: K, payload: CanvasEngineEvents[K]) => void;

  constructor(deps: SelectionManagerDeps) {
    this.emitEvent = (eventName, payload) => {
      deps.events.emit(eventName as CanvasEventName, payload);
    };
  }

  /**
   * Select instance (supports both regular instances and AST nodes)
   */
  select(id: string, deps: SelectionManagerDeps): void {
    const previousIds = [...this.selection.selectedIds];
    const instance = deps.tree.getInstance(id);

    if (!instance) {
      const root = deps.tree.getRoot();
      const astStructure = root.metadata?.astStructure;
      if (Array.isArray(astStructure)) {
        const astNode = deps.findASTNode(astStructure as ASTNode[], id);
        if (astNode) {
          this.selection.selectedIds = [id];
          this.selection.selectedItemIndices.clear();
          this.emitEvent('selection:change', { selectedIds: this.selection.selectedIds, previousIds });
          return;
        }
      }
      console.warn(`[CanvasEngine] Selecting unknown ID: ${id}`); // nosemgrep: unsafe-formatstring
    }

    this.selection.selectedIds = [id];
    this.selection.selectedItemIndices.clear();
    this.emitEvent('selection:change', { selectedIds: this.selection.selectedIds, previousIds });
  }

  selectMultiple(ids: string[]): void {
    const previousIds = [...this.selection.selectedIds];
    this.selection.selectedIds = ids;
    this.emitEvent('selection:change', { selectedIds: this.selection.selectedIds, previousIds });
  }

  addToSelection(id: string): void {
    if (!this.selection.selectedIds.includes(id)) {
      const previousIds = [...this.selection.selectedIds];
      this.selection.selectedIds = [...this.selection.selectedIds, id];
      this.emitEvent('selection:change', { selectedIds: this.selection.selectedIds, previousIds });
    }
  }

  /**
   * Additive selection that preserves the element's itemIndex (HYP-691).
   *
   * ADDS to the current selection (vs selectWithItemIndex which replaces). The
   * itemIndex must survive — without it a composite-component instance resolves
   * via findElements(id, null) -> [] and no overlay frame is drawn.
   *
   * itemIndex bookkeeping is delegated to the shared toggleItemIndex helper (the
   * SAME one the extension's iframe path uses), so the two realms cannot diverge
   * on selection semantics again — that divergence WAS this bug.
   */
  addToSelectionWithItemIndex(id: string, itemIndex: number | null): void {
    if (this.selection.selectedIds.includes(id)) return;
    const previousIds = [...this.selection.selectedIds];
    const nextIds = [...this.selection.selectedIds, id];
    this.selection.selectedIds = nextIds;
    this.syncItemIndices(id, nextIds, itemIndex);
    this.emitEvent('selection:change', { selectedIds: nextIds, previousIds });
  }

  removeFromSelection(id: string): void {
    const previousIds = [...this.selection.selectedIds];
    const nextIds = this.selection.selectedIds.filter((selectedId) => selectedId !== id);
    this.selection.selectedIds = nextIds;
    // id is absent from nextIds, so the shared helper drops its itemIndex entry.
    this.syncItemIndices(id, nextIds, null);
    this.emitEvent('selection:change', { selectedIds: nextIds, previousIds });
  }

  /**
   * Apply an itemIndex toggle through the shared selection-utils helper, adapting
   * between this manager's Map store and the helper's Record shape. Keeping the
   * toggle logic in ONE shared place (also used by the extension) is what stops
   * the realms drifting apart on selection bookkeeping.
   */
  private syncItemIndices(nodeRef: string, nextSelectedIds: string[], itemIndex: number | null): void {
    const record: Record<string, number | null> = {};
    for (const [key, value] of this.selection.selectedItemIndices) record[key] = value;
    const next = toggleItemIndex(record, nodeRef, nextSelectedIds, itemIndex);
    this.selection.selectedItemIndices = new Map(Object.entries(next));
  }

  clearSelection(): void {
    const previousIds = [...this.selection.selectedIds];
    this.selection.selectedIds = [];
    this.selection.selectedItemIndices.clear();
    this.emitEvent('selection:change', { selectedIds: [], previousIds });
  }

  setHovered(id: string | null): void {
    const previousId = this.selection.hoveredId;
    this.selection.hoveredId = id;
    this.selection.hoveredItemIndex = null;
    this.emitEvent('hover:change', { hoveredId: id, previousId });
  }

  setHoveredWithItemIndex(id: string | null, itemIndex: number | null): void {
    const previousId = this.selection.hoveredId;
    this.selection.hoveredId = id;
    this.selection.hoveredItemIndex = itemIndex;
    this.emitEvent('hover:change', { hoveredId: id, previousId });
  }

  selectWithItemIndex(id: string, itemIndex: number | null): void {
    const previousIds = [...this.selection.selectedIds];
    this.selection.selectedIds = [id];
    this.selection.selectedItemIndices.clear();
    if (itemIndex !== null) {
      this.selection.selectedItemIndices.set(id, itemIndex);
    }
    this.emitEvent('selection:change', { selectedIds: this.selection.selectedIds, previousIds });
  }

  getSelection(): SelectionState {
    return {
      ...this.selection,
      selectedItemIndices: new Map(this.selection.selectedItemIndices),
    };
  }

  getSelectedInstances(deps: SelectionManagerDeps): ComponentInstance[] {
    return this.selection.selectedIds
      .map((id) => deps.tree.getInstance(id))
      .filter((instance): instance is ComponentInstance => instance !== undefined);
  }

  /**
   * Resolve the map-iteration context for a given AST node id (HYP-290b).
   */
  getMapContext(id: string, deps: SelectionManagerDeps): MapIterationContext | null {
    let astNode: ASTNode | null = null;
    for (const tree of deps.getRenderedAstTrees()) {
      astNode = deps.findASTNode(tree, id);
      if (astNode) break;
    }
    if (!astNode) {
      const tracer = deps.getActiveTracer?.();
      const source = tracer?.getSourceByNodeRef(id);
      if (source && deps.findAstNodeBySourceLoc) {
        for (const tree of deps.getRenderedAstTrees()) {
          astNode = deps.findAstNodeBySourceLoc(tree, source.line, source.column);
          if (astNode) break;
        }
      }
    }
    const mapItem = astNode?.mapItem;
    if (!mapItem) return null;
    const itemIndex = this.selection.selectedItemIndices.get(id);
    if (itemIndex === undefined || itemIndex === null) return null;
    return {
      parentMapId: mapItem.parentMapId,
      itemIndex,
      mapExpression: mapItem.expression ?? '',
      // Data-source category (HYP-290h) — drives DOM-mode op routing in useMapOpToast.
      category: mapItem.category,
    };
  }

  getSelectedMapContext(deps: SelectionManagerDeps): MapIterationContext | null {
    if (this.selection.selectedIds.length !== 1) return null;
    return this.getMapContext(this.selection.selectedIds[0], deps);
  }

  /** Expose selectedIds for internal consumers */
  getSelectedIds(): string[] {
    return [...this.selection.selectedIds];
  }

  /** Expose hoveredId for internal consumers */
  getHoveredId(): string | null {
    return this.selection.hoveredId;
  }
}
