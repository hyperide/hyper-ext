/**
 * Canvas Engine - main facade class
 */

import { loadPersistedState, savePersistedState } from '../../storage';
import { EventEmitter } from '../events/EventEmitter';
import type { CanvasEngineEvents, CanvasEventName } from '../events/events';
import type {
  CanvasEngineConfig,
  ComponentDefinition,
  ComponentInstance,
  FieldsMap,
  HistoryState,
  DocumentTree as IDocumentTree,
  SelectionState,
} from '../models/types';
import { ASTBatchDeleteOperation } from '../operations/ASTBatchDeleteOperation';
import { ASTDeleteOperation } from '../operations/ASTDeleteOperation';
import { ASTDuplicateOperation } from '../operations/ASTDuplicateOperation';
import { ASTEditConditionOperation } from '../operations/ASTEditConditionOperation';
import { ASTInsertOperation } from '../operations/ASTInsertOperation';
import { ASTPasteOperation } from '../operations/ASTPasteOperation';
import { ASTStyleOperation } from '../operations/ASTStyleOperation';
import { ASTUpdateOperation } from '../operations/ASTUpdateOperation';
import { ASTUpdatePropsOperation } from '../operations/ASTUpdatePropsOperation';
import { BatchOperation } from '../operations/BatchOperation';
import { FileSnapshotOperation, type FileSnapshotOperationParams } from '../operations/FileSnapshotOperation';
import type { Operation as BaseOperation, Operation } from '../operations/Operation';
import type { ASTApiService } from '../services/ASTApiService';
import { ASTApiServiceImpl } from '../services/ASTApiServiceImpl';
import type { ASTNode } from '../types/ast';
import { deserialize, serialize } from '../utils/serialization';
import { ClipboardManager } from './ClipboardManager';
import { ComponentRegistry } from './ComponentRegistry';
import { DocumentTree } from './DocumentTree';
import { HistoryManager } from './HistoryManager';
import { ServerSyncManager } from './ServerSyncManager';

interface LoadInstanceChild {
  type: string;
  props: Record<string, unknown>;
  children?: LoadInstanceChild[];
}

/**
 * Main Canvas Engine class
 */
export class CanvasEngine {
  // Core components
  public readonly events: EventEmitter;
  public readonly registry: ComponentRegistry;
  private tree: DocumentTree;
  private history: HistoryManager;
  private clipboard: ClipboardManager;
  private serverSync: ServerSyncManager | null;

  // State
  private selection: SelectionState = {
    selectedIds: [],
    hoveredId: null,
    hoveredItemIndex: null,
    selectedItemIndices: new Map(),
  };
  private mode: 'design' | 'interact' | 'code' = (() => {
    const persistedMode = loadPersistedState().mode;
    // Filter out 'board' mode - it's handled at UI level
    return (persistedMode === 'board' ? 'interact' : persistedMode) || 'design';
  })();

  // Config
  private config: CanvasEngineConfig;
  private debug: boolean;

  // Batch mode for bulk operations
  private _isBatchMode: boolean = false;
  private _batchedEvents: Array<{
    eventName: CanvasEventName;
    payload: CanvasEngineEvents[CanvasEventName];
  }> = [];

  // Undo/redo debounce to prevent concurrent operations
  private _undoRedoInProgress: boolean = false;

  // AST API service for operations
  private api: ASTApiService;

  constructor(config: CanvasEngineConfig = {}) {
    this.config = config;
    this.debug = config.debug ?? false;

    // Initialize components
    this.events = new EventEmitter();
    this.registry = new ComponentRegistry();
    this.tree = new DocumentTree(config.initialTree);
    this.history = new HistoryManager(config.maxHistoryLength ?? 100);
    this.clipboard = new ClipboardManager();
    this.serverSync = config.serverSync ? new ServerSyncManager(config.serverSync) : null;
    this.api = new ASTApiServiceImpl();

    this.log('CanvasEngine initialized');
  }

  // ============================================
  // Component Registration
  // ============================================

  /**
   * Register component definition
   */
  registerComponent<F extends FieldsMap>(definition: ComponentDefinition<F>): void {
    this.registry.register(definition);
    this.log(`Component registered: ${definition.type}`);
  }

  /**
   * Unregister component definition
   */
  unregisterComponent(type: string): void {
    this.registry.unregister(type);
    this.log(`Component unregistered: ${type}`);
  }

  // ============================================
  // Tree Operations
  // ============================================

  /**
   * Execute batch operation
   */
  async executeBatch(operations: Operation[]): Promise<void> {
    const batch = new BatchOperation(operations);
    await this.executeOperation(batch);
  }

  // ============================================
  // Selection
  // ============================================

  /**
   * Select instance (supports both regular instances and AST nodes)
   */
  select(id: string): void {
    const previousIds = [...this.selection.selectedIds];

    // Check if ID exists as a regular instance
    const instance = this.tree.getInstance(id);

    // If not found as instance, check if it's an AST node ID
    if (!instance) {
      const root = this.tree.getRoot();
      const astStructure = root.metadata?.astStructure;
      if (Array.isArray(astStructure)) {
        const astNode = this.findASTNode(astStructure as ASTNode[], id);
        if (astNode) {
          // Valid AST node - allow selection
          this.selection.selectedIds = [id];
          this.emitEvent('selection:change', {
            selectedIds: this.selection.selectedIds,
            previousIds,
          });
          return;
        }
      }
      // ID not found as instance or AST node - log warning but still select
      console.warn(`[CanvasEngine] Selecting unknown ID: ${id}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    }

    // Normal instance selection
    this.selection.selectedIds = [id];
    this.selection.selectedItemIndices.clear();

    this.emitEvent('selection:change', {
      selectedIds: this.selection.selectedIds,
      previousIds,
    });
  }

  /**
   * Select instance with specific item index (for map-rendered elements)
   * When itemIndex is provided, only that specific item will be highlighted
   */
  selectWithItemIndex(id: string, itemIndex: number | null): void {
    const previousIds = [...this.selection.selectedIds];

    this.selection.selectedIds = [id];
    this.selection.selectedItemIndices.clear();

    if (itemIndex !== null) {
      this.selection.selectedItemIndices.set(id, itemIndex);
    }

    this.emitEvent('selection:change', {
      selectedIds: this.selection.selectedIds,
      previousIds,
    });
  }

  /**
   * Select multiple instances
   */
  selectMultiple(ids: string[]): void {
    const previousIds = [...this.selection.selectedIds];
    this.selection.selectedIds = ids;

    this.emitEvent('selection:change', {
      selectedIds: this.selection.selectedIds,
      previousIds,
    });
  }

  /**
   * Add to selection
   */
  addToSelection(id: string): void {
    if (!this.selection.selectedIds.includes(id)) {
      const previousIds = [...this.selection.selectedIds];
      this.selection.selectedIds = [...this.selection.selectedIds, id];

      this.emitEvent('selection:change', {
        selectedIds: this.selection.selectedIds,
        previousIds,
      });
    }
  }

  /**
   * Remove from selection
   */
  removeFromSelection(id: string): void {
    const previousIds = [...this.selection.selectedIds];
    this.selection.selectedIds = this.selection.selectedIds.filter((selectedId) => selectedId !== id);

    this.emitEvent('selection:change', {
      selectedIds: this.selection.selectedIds,
      previousIds,
    });
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    const previousIds = [...this.selection.selectedIds];
    this.selection.selectedIds = [];
    this.selection.selectedItemIndices.clear();

    this.emitEvent('selection:change', {
      selectedIds: [],
      previousIds,
    });
  }

  /**
   * Set hovered instance
   */
  setHovered(id: string | null): void {
    const previousId = this.selection.hoveredId;
    this.selection.hoveredId = id;
    this.selection.hoveredItemIndex = null;

    this.emitEvent('hover:change', {
      hoveredId: id,
      previousId,
    });
  }

  /**
   * Set hovered instance with specific item index (for map-rendered elements)
   */
  setHoveredWithItemIndex(id: string | null, itemIndex: number | null): void {
    const previousId = this.selection.hoveredId;
    this.selection.hoveredId = id;
    this.selection.hoveredItemIndex = itemIndex;

    this.emitEvent('hover:change', {
      hoveredId: id,
      previousId,
    });
  }

  /**
   * Get selection state
   */
  getSelection(): SelectionState {
    return {
      ...this.selection,
      selectedItemIndices: new Map(this.selection.selectedItemIndices),
    };
  }

  /**
   * Get selected instances
   */
  getSelectedInstances(): ComponentInstance[] {
    return this.selection.selectedIds
      .map((id) => this.tree.getInstance(id))
      .filter((instance): instance is ComponentInstance => instance !== undefined);
  }

  // ============================================
  // Mode (Design/Interact)
  // ============================================

  /**
   * Set mode
   */
  setMode(mode: 'design' | 'interact' | 'code'): void {
    const previousMode = this.mode;
    if (previousMode === mode) {
      return;
    }

    this.mode = mode;

    // Persist mode to localStorage
    savePersistedState({ mode });

    this.emitEvent('mode:change', {
      mode,
      previousMode,
    });

    this.log(`Mode changed: ${previousMode} -> ${mode}`);
  }

  /**
   * Get current mode
   */
  getMode(): 'design' | 'interact' | 'code' {
    return this.mode;
  }

  // ============================================
  // History (Undo/Redo)
  // ============================================

  /**
   * Undo last operation
   */
  async undo(): Promise<boolean> {
    // Prevent concurrent undo/redo operations
    if (this._undoRedoInProgress) {
      console.log('[CanvasEngine] Undo already in progress, ignoring');
      return false;
    }

    this._undoRedoInProgress = true;

    try {
      const operation = this.history.getCurrentOperation();
      const success = this.history.undo(this.tree);

      if (success) {
        // Wait for any pending async work (API calls) in the operation
        if (operation && '_pendingPromise' in operation && operation._pendingPromise instanceof Promise) {
          try {
            await operation._pendingPromise;
          } catch {
            // Operation failure is already handled by HistoryManager
          }
        }

        this.notifyStateChange();
        this.emitHistoryChange();

        if (operation) {
          this.emitEvent('history:undo', {
            operationName: operation.name,
          });
        }

        this.log('Undo successful');
      }

      return success;
    } finally {
      this._undoRedoInProgress = false;
    }
  }

  /**
   * Redo next operation
   */
  async redo(): Promise<boolean> {
    // Prevent concurrent undo/redo operations
    if (this._undoRedoInProgress) {
      console.log('[CanvasEngine] Redo already in progress, ignoring');
      return false;
    }

    this._undoRedoInProgress = true;

    try {
      const success = this.history.redo(this.tree);

      if (success) {
        const operation = this.history.getCurrentOperation();

        // Wait for any pending async work (API calls) in the operation
        if (operation && '_pendingPromise' in operation && operation._pendingPromise instanceof Promise) {
          try {
            await operation._pendingPromise;
          } catch {
            // Operation failure is already handled by HistoryManager
          }
        }

        this.notifyStateChange();
        this.emitHistoryChange();

        if (operation) {
          this.emitEvent('history:redo', {
            operationName: operation.name,
          });
        }

        this.log('Redo successful');
      }

      return success;
    } finally {
      this._undoRedoInProgress = false;
    }
  }

  /**
   * Can undo?
   */
  canUndo(): boolean {
    // Can't undo if operation is in progress
    if (this._undoRedoInProgress) {
      return false;
    }
    return this.history.canUndo();
  }

  /**
   * Can redo?
   */
  canRedo(): boolean {
    // Can't redo if operation is in progress
    if (this._undoRedoInProgress) {
      return false;
    }
    return this.history.canRedo();
  }

  /**
   * Get history state
   */
  getHistoryState(): HistoryState {
    return this.history.getState();
  }

  /**
   * Execute an annotation operation and record it in history.
   * Annotation operations work with external AnnotationStore passed in params,
   * not with the internal DocumentTree.
   *
   * @param operation - The annotation operation to execute
   * @returns true if operation succeeded
   */
  executeAnnotationOperation(operation: BaseOperation): boolean {
    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`Annotation operation "${operation.name}" executed`);
      return true;
    }

    console.error('[CanvasEngine] Annotation operation failed:', result.error);
    return false;
  }

  /**
   * Update AST element prop (for iframe components)
   * This executes an ASTUpdateOperation and records it in history
   */
  updateASTProp(elementId: string, filePath: string, propName: string, propValue: unknown): void {
    const operation = new ASTUpdateOperation(this.api, {
      elementId,
      filePath,
      propName,
      propValue,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST prop "${propName}" updated for element ${elementId}`);
    } else {
      console.error('[CanvasEngine] Failed to update AST prop:', result.error);
    }
  }

  /**
   * Update Tailwind styles on an element (records in history for undo/redo)
   */
  updateASTStyles(
    elementId: string,
    filePath: string,
    styles: Record<string, string>,
    options?: {
      domClasses?: string;
      instanceProps?: Record<string, unknown>;
      instanceId?: string;
      state?: string;
    },
  ): Promise<void> | undefined {
    const operation = new ASTStyleOperation(this.api, {
      elementId,
      filePath,
      styles,
      domClasses: options?.domClasses,
      instanceProps: options?.instanceProps,
      instanceId: options?.instanceId,
      state: options?.state,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST styles updated for element ${elementId}`);
      return operation._pendingPromise;
    }
    console.error('[CanvasEngine] Failed to update AST styles:', result.error);
  }

  /**
   * Edit a condition or map expression (records in history for undo/redo)
   */
  editASTCondition(params: {
    type: 'condition' | 'map';
    boundaryId: string;
    elementId: string;
    filePath: string;
    oldExpression: string;
    newExpression: string;
  }): void {
    const operation = new ASTEditConditionOperation(this.api, params);

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST ${params.type} expression edited for element ${params.elementId}`);
    } else {
      console.error('[CanvasEngine] Failed to edit condition:', result.error);
    }
  }

  /**
   * Update multiple AST element props at once (for iframe components)
   * This executes an ASTUpdatePropsOperation and records it in history
   */
  updateASTProps(elementId: string, filePath: string, props: Record<string, unknown>): void {
    const operation = new ASTUpdatePropsOperation(this.api, {
      elementId,
      filePath,
      props,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST props updated for element ${elementId}: ${Object.keys(props).join(', ')}`);
    } else {
      console.error('[CanvasEngine] Failed to update AST props:', result.error);
    }
  }

  /**
   * Insert AST element (for iframe components)
   * This executes an ASTInsertOperation and records it in history
   */
  insertASTElement(
    parentId: string | null,
    filePath: string,
    componentType: string,
    props: Record<string, unknown>,
    componentFilePath?: string,
  ): void {
    const operation = new ASTInsertOperation(this.api, {
      parentId,
      filePath,
      componentType,
      props,
      componentFilePath,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST element "${componentType}" inserted`);
    } else {
      console.error('[CanvasEngine] Failed to insert AST element:', result.error);
    }
  }

  /**
   * Delete AST element (for iframe components)
   * This executes an ASTDeleteOperation and records it in history
   */
  deleteASTElement(elementId: string, filePath: string): void {
    const operation = new ASTDeleteOperation(this.api, {
      elementId,
      filePath,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST element ${elementId} deleted`);

      // Clear selection after delete
      this.clearSelection();
    } else {
      console.error('[CanvasEngine] Failed to delete AST element:', result.error);
    }
  }

  /**
   * Delete multiple AST elements in batch (for iframe components)
   * This executes an ASTBatchDeleteOperation and records it in history
   * More efficient than multiple deleteASTElement calls
   */
  deleteASTElements(elementIds: string[], filePath: string): void {
    console.log(
      // nosemgrep: javascript.lang.security.audit.unsafe-formatstring.unsafe-formatstring
      `[CanvasEngine.deleteASTElements] Called with ${elementIds.length} elements:`,
      elementIds.map((id) => id.substring(0, 8)),
    );

    if (elementIds.length === 0) {
      console.warn('[CanvasEngine] No elements to delete');
      return;
    }

    // Use single delete for one element
    if (elementIds.length === 1) {
      console.log('[CanvasEngine.deleteASTElements] Using single delete');
      this.deleteASTElement(elementIds[0], filePath);
      return;
    }

    // Use batch delete for multiple elements
    console.log('[CanvasEngine.deleteASTElements] Using batch delete for', elementIds.length, 'elements');
    const operation = new ASTBatchDeleteOperation(this.api, {
      elementIds,
      filePath,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST elements deleted: ${elementIds.length} elements`);

      // Clear selection after delete
      this.clearSelection();
    } else {
      console.error('[CanvasEngine] Failed to delete AST elements:', result.error);
    }
  }

  /**
   * Duplicate AST element (for iframe components)
   * This executes an ASTDuplicateOperation and records it in history
   * Returns promise that resolves to new element ID
   */
  async duplicateASTElement(elementId: string, filePath: string): Promise<string | null> {
    const operation = new ASTDuplicateOperation(this.api, {
      elementId,
      filePath,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST element ${elementId} duplicated`);

      // Wait for sync to complete and get new ID
      return await operation.waitForCompletion();
    } else {
      console.error('[CanvasEngine] Failed to duplicate AST element:', result.error);
      return null;
    }
  }

  /**
   * Paste AST element from TSX code (for iframe components)
   * This executes an ASTPasteOperation and records it in history
   * Returns promise that resolves to new element ID
   */
  async pasteASTElement(parentId: string | null, filePath: string, tsxCode: string): Promise<string | null> {
    const operation = new ASTPasteOperation(this.api, {
      parentId,
      filePath,
      tsxCode,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      this.log(`AST element pasted into ${parentId || 'root'}`);

      // Wait for sync to complete and get new ID
      return await operation.waitForCompletion();
    } else {
      console.error('[CanvasEngine] Failed to paste AST element:', result.error);
      return null;
    }
  }

  // ============================================
  // Clipboard
  // ============================================

  /**
   * Copy instance to clipboard
   */
  copy(id: string): boolean {
    return this.clipboard.copy(this.tree, id);
  }

  /**
   * Paste instance from clipboard
   */
  paste(parentId?: string | null): string | null {
    const pastedId = this.clipboard.paste(this.tree, parentId ?? this.tree.getRootId());

    if (pastedId) {
      this.notifyStateChange();
    }

    return pastedId;
  }

  /**
   * Has clipboard content?
   */
  hasClipboard(): boolean {
    return this.clipboard.hasContent();
  }

  // ============================================
  // Queries
  // ============================================

  /**
   * Get instance by ID
   */
  getInstance(id: string): ComponentInstance | undefined {
    return this.tree.getInstance(id);
  }

  /**
   * Get root instance
   */
  getRoot(): ComponentInstance {
    return this.tree.getRoot();
  }

  /**
   * Get children of instance
   */
  getChildren(parentId: string): ComponentInstance[] {
    return this.tree.getChildren(parentId);
  }

  /**
   * Get parent of instance
   */
  getParent(id: string): ComponentInstance | null {
    return this.tree.getParent(id);
  }

  /**
   * Get ancestors of instance
   */
  getAncestors(id: string): ComponentInstance[] {
    return this.tree.getAncestors(id);
  }

  /**
   * Get descendants of instance
   */
  getDescendants(id: string): ComponentInstance[] {
    return this.tree.getDescendants(id);
  }

  /**
   * Get all instances
   */
  getAllInstances(): ComponentInstance[] {
    return this.tree.getAllInstances();
  }

  // ============================================
  // Serialization
  // ============================================

  /**
   * Serialize to JSON
   */
  serialize(): string {
    return serialize(this.tree.toSnapshot());
  }

  /**
   * Deserialize from JSON
   */
  deserialize(json: string): void {
    const tree = deserialize(json);
    this.tree = new DocumentTree(tree);
    this.history.clear();
    this.clearSelection();
    this.notifyStateChange();
    this.log('Tree deserialized');
  }

  /**
   * Get tree snapshot
   */
  getSnapshot(): IDocumentTree {
    return this.tree.toSnapshot();
  }

  // ============================================
  // Batch Mode
  // ============================================

  /**
   * Start batch mode - defer all events until finalizeBatch()
   * Useful for multiple operations that should trigger single UI update
   */
  startBatch(): void {
    this._isBatchMode = true;
    this._batchedEvents = [];
    this.log('Batch mode started');
  }

  /**
   * Finalize batch mode - emit all deferred events
   */
  finalizeBatch(): void {
    if (!this._isBatchMode) {
      this.log('Warning: finalizeBatch called without startBatch');
      return;
    }

    this._isBatchMode = false;

    // Emit all batched events
    const events = this._batchedEvents;
    this._batchedEvents = [];

    // Emit unique events (deduplicate by event name)
    const uniqueEvents = new Map<string, CanvasEngineEvents[CanvasEventName]>();
    for (const { eventName, payload } of events) {
      // For tree:change events, merge changedIds
      if (eventName === 'tree:change') {
        const existing = uniqueEvents.get(eventName) as import('../events/events').TreeChangeEvent | undefined;
        const treePayload = payload as import('../events/events').TreeChangeEvent;
        if (existing) {
          const mergedIds = new Set([...(existing.changedIds || []), ...(treePayload.changedIds || [])]);
          uniqueEvents.set(eventName, { changedIds: Array.from(mergedIds) });
        } else {
          uniqueEvents.set(eventName, payload);
        }
      } else {
        // For other events, keep last payload
        uniqueEvents.set(eventName, payload);
      }
    }

    // Always emit at least one tree:change event to trigger store update
    // This ensures UI updates even if metadata was changed directly without events
    if (!uniqueEvents.has('tree:change')) {
      const rootId = this.tree.getRootId();
      const rootChildren = this.tree.getChildren(rootId);
      const changedIds = rootChildren.map((child) => child.id);
      uniqueEvents.set('tree:change', {
        changedIds,
      });
    }

    // Emit deduplicated events directly (bypass emitEvent to avoid recursion)
    for (const [eventName, payload] of uniqueEvents.entries()) {
      this.events.emit(eventName as CanvasEventName, payload as CanvasEngineEvents[CanvasEventName]);
    }
  }

  // ============================================
  // Bulk Loading (without history)
  // ============================================

  /**
   * Load instances directly without creating operations
   * Useful for initial load from server/AST parsing
   */
  loadInstances(
    type: string,
    props: Record<string, unknown>,
    parentId: string | null = null,
    children?: Array<{
      type: string;
      props: Record<string, unknown>;
      children?: LoadInstanceChild[];
    }>,
  ): string {
    const actualParentId = parentId ?? this.tree.getRootId();

    // Insert directly into tree without operation
    const instance = this.tree.insert(type, props, actualParentId);
    const instanceId = instance.id;

    // Recursively insert children
    if (children && children.length > 0) {
      for (const child of children) {
        this.loadInstances(child.type, child.props, instanceId, child.children);
      }
    }

    return instanceId;
  }

  /**
   * Clear all instances except root (without history)
   */
  clearInstances(): void {
    const rootId = this.tree.getRootId();
    const rootChildren = this.tree.getChildren(rootId);
    const deletedIds = rootChildren.map((child) => child.id);

    for (const child of rootChildren) {
      this.tree.delete(child.id);
    }

    // Emit tree change event so Zustand store updates
    // Note: notifyStateChange() removed - it bypasses batch mode
    this.emitEvent('tree:change', {
      changedIds: deletedIds,
    });
  }

  /**
   * Clear undo/redo history (e.g. when switching components)
   */
  clearHistory(): void {
    this.history.clear();
    this.emitHistoryChange();
  }

  /**
   * Record an external file change (AI agent, code-server, Monaco, chokidar)
   * as an undoable operation in history.
   */
  recordExternalFileChange(params: FileSnapshotOperationParams): void {
    const operation = new FileSnapshotOperation(this.api, params);
    this.history.record(operation);
    this.emitHistoryChange();
    this.log(`External file change recorded: ${operation.name}`);
  }

  /**
   * Finalize bulk load - emits tree change event
   * Call this after using loadInstances() to trigger UI updates
   */
  finalizeBulkLoad(): void {
    const rootId = this.tree.getRootId();
    const rootChildren = this.tree.getChildren(rootId);
    const changedIds = rootChildren.map((child) => child.id);

    // Notify state change
    this.notifyStateChange();

    // Emit tree change event so Zustand store updates
    this.emitEvent('tree:change', {
      changedIds,
    });
  }

  // ============================================
  // Internal Methods
  // ============================================

  /**
   * Emit event or batch it if in batch mode
   */
  private emitEvent<K extends keyof import('../events/events').CanvasEngineEvents>(
    eventName: K,
    payload: import('../events/events').CanvasEngineEvents[K],
  ): void {
    if (this._isBatchMode) {
      this._batchedEvents.push({ eventName, payload });
    } else {
      this.events.emit(eventName, payload);
    }
  }

  /**
   * Execute operation and record in history
   */
  private async executeOperation(operation: Operation): Promise<void> {
    const result = operation.execute(this.tree);

    if (!result.success) {
      throw new Error(`Operation failed: ${result.error}`);
    }

    // Record in history
    this.history.record(operation);

    // Sync to server if configured
    if (this.serverSync) {
      try {
        await this.syncOperationToServer(operation);
      } catch (error) {
        // Rollback operation if server sync failed
        this.log('Server sync failed, rolling back operation');

        // Undo the operation
        operation.undo(this.tree);

        // Remove from history
        this.history.undo(this.tree);

        // Notify error
        if (this.config.serverSync?.onSyncError) {
          this.config.serverSync.onSyncError(error instanceof Error ? error : new Error(String(error)), operation);
        }

        throw error;
      }
    }

    // Notify state change
    this.notifyStateChange();

    // Emit history change
    this.emitHistoryChange();

    // Emit tree change
    if (result.changedIds) {
      this.emitEvent('tree:change', {
        changedIds: result.changedIds,
      });
    }

    this.log(`Operation executed: ${operation.name}`);
  }

  /**
   * Sync operation to server
   */
  private async syncOperationToServer(_operation: Operation): Promise<void> {
    if (!this.serverSync) return;
    // Tree operations (Insert, Delete, Update) were removed — sync is a no-op for now.
    // AST operations handle their own server communication.
  }

  /**
   * Notify state change callback
   */
  private notifyStateChange(): void {
    if (this.config.onStateChange) {
      this.config.onStateChange(this.tree.toSnapshot());
    }
  }

  /**
   * Emit history change event
   */
  private emitHistoryChange(): void {
    this.emitEvent('history:change', {
      state: this.history.getState(),
    });
  }

  /**
   * Find AST node by ID in tree structure (recursive)
   */
  private findASTNode(nodes: ASTNode[], id: string): ASTNode | null {
    for (const node of nodes) {
      if (node.id === id) {
        return node;
      }
      if (node.children && Array.isArray(node.children)) {
        const found = this.findASTNode(node.children, id);
        if (found) {
          return found;
        }
      }
    }
    return null;
  }

  /**
   * Debug logging
   */
  private log(message: string, ...args: unknown[]): void {
    if (this.debug) {
      console.log(`[CanvasEngine] ${message}`, ...args); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    }
  }
}
