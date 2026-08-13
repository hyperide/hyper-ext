/**
 * Canvas Engine - main facade class
 */

import { getActiveTracer } from '../../element-tracing/active-tracer';
import { findAstNodeBySourceLoc } from '../../element-tracing/id-bridge';
import { EventEmitter } from '../events/EventEmitter';
import type { CanvasEngineEvents, CanvasEventName, TreeChangeEvent } from '../events/events';
import type {
  CanvasEngineConfig,
  ComponentDefinition,
  ComponentInstance,
  FieldsMap,
  DocumentTree as IDocumentTree,
} from '../models/types';
import { ASTBatchDeleteOperation } from '../operations/ASTBatchDeleteOperation';
import { ASTDeleteOperation } from '../operations/ASTDeleteOperation';
import { ASTDuplicateOperation } from '../operations/ASTDuplicateOperation';
import { ASTEditConditionOperation } from '../operations/ASTEditConditionOperation';
import { ASTInsertOperation } from '../operations/ASTInsertOperation';
import { ASTMapLiteralArrayOperation } from '../operations/ASTMapLiteralArrayOperation';
import { ASTMapSampleArrayOperation } from '../operations/ASTMapSampleArrayOperation';
import { ASTPasteOperation } from '../operations/ASTPasteOperation';
import { ASTStyleOperation } from '../operations/ASTStyleOperation';
import { ASTUpdateOperation } from '../operations/ASTUpdateOperation';
import { ASTUpdatePropsOperation } from '../operations/ASTUpdatePropsOperation';
import { BatchOperation } from '../operations/BatchOperation';
import { FileSnapshotOperation, type FileSnapshotOperationParams } from '../operations/FileSnapshotOperation';
import type { Operation as BaseOperation, Operation } from '../operations/Operation';
import type { ASTApiService, MapLiteralArrayOpParams, MapSampleArrayOpParams } from '../services/ASTApiService';
import { ASTApiServiceImpl } from '../services/ASTApiServiceImpl';
import { MapOpDispatchController, type MapOpDomParams } from './MapOpDispatchController';
import type { ASTNode } from '../types/ast';
import { deserialize, serialize } from '../utils/serialization';
import { ClipboardManager } from './ClipboardManager';
import { ComponentRegistry } from './ComponentRegistry';
import { DocumentTree } from './DocumentTree';
import { HistoryController } from './HistoryController';
import { HistoryManager } from './HistoryManager';
import { ModeManager } from './ModeManager';
import { SelectionManager } from './SelectionManager';
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
  private historyManager: HistoryManager;
  private historyController: HistoryController;
  private clipboard: ClipboardManager;
  private serverSync: ServerSyncManager | null;

  // State managers
  private selectionManager: SelectionManager;
  private modeManager: ModeManager;

  // Config
  private config: CanvasEngineConfig;
  private debug: boolean;

  // Batch mode for bulk operations
  private _isBatchMode: boolean = false;
  private _batchedEvents: Array<{
    eventName: CanvasEventName;
    payload: CanvasEngineEvents[CanvasEventName];
  }> = [];

  // AST API service for operations
  private api: ASTApiService;

  constructor(config: CanvasEngineConfig = {}) {
    this.config = config;
    this.debug = config.debug ?? false;

    // Initialize components
    this.events = new EventEmitter();
    this.registry = new ComponentRegistry();
    this.tree = new DocumentTree(config.initialTree);
    this.historyManager = new HistoryManager(config.maxHistoryLength ?? 100);
    this.historyController = new HistoryController(this.historyManager, this.events);
    this.clipboard = new ClipboardManager();
    this.serverSync = config.serverSync ? new ServerSyncManager(config.serverSync) : null;
    this.api = new ASTApiServiceImpl();
    this.selectionManager = new SelectionManager({
      events: this.events,
      tree: this.tree,
      getRenderedAstTrees: () => this.getRenderedAstTrees(),
      findASTNode: (nodes, id) => this.findASTNode(nodes, id),
      getActiveTracer,
      findAstNodeBySourceLoc,
    });
    this.modeManager = new ModeManager(this.events);

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

  select(id: string): void {
    this.selectionManager.select(id, this._buildSelectionDeps());
  }

  selectWithItemIndex(id: string, itemIndex: number | null): void {
    this.selectionManager.selectWithItemIndex(id, itemIndex);
  }

  selectMultiple(ids: string[]): void {
    this.selectionManager.selectMultiple(ids);
  }

  addToSelection(id: string): void {
    this.selectionManager.addToSelection(id);
  }

  removeFromSelection(id: string): void {
    this.selectionManager.removeFromSelection(id);
  }

  clearSelection(): void {
    this.selectionManager.clearSelection();
  }

  setHovered(id: string | null): void {
    this.selectionManager.setHovered(id);
  }

  setHoveredWithItemIndex(id: string | null, itemIndex: number | null): void {
    this.selectionManager.setHoveredWithItemIndex(id, itemIndex);
  }

  getSelection() {
    return this.selectionManager.getSelection();
  }

  getMapContext(id: string) {
    return this.selectionManager.getMapContext(id, this._buildSelectionDeps());
  }

  getSelectedMapContext() {
    return this.selectionManager.getSelectedMapContext(this._buildSelectionDeps());
  }

  /**
   * Dispatch the HYP-290d DOM-mode (data-mode) op for a `.map()` iteration — splices
   * the Sample-file array prop instead of editing the JSX template. Creates and executes
   * {@link ASTMapSampleArrayOperation}; this is the CanvasEngine dispatcher the engine
   * op was left "unwired" against in HYP-290d.
   *
   * Awaits the server write and records in history ONLY on success: a refused op (the
   * server reclassifies the receiver as not props-from-sample) must NOT enter history —
   * the dual-mode switch re-applies the JSX delete instead. Resolves to whether the
   * server accepted the op.
   */
  async dispatchMapSampleArrayOp(params: MapSampleArrayOpParams): Promise<boolean> {
    const operation = new ASTMapSampleArrayOperation(this.api, params);
    operation.execute(this.tree);

    // `_pendingPromise` swallows the rejection to stay non-throwing; the success signal
    // is the op's `succeeded` flag, set in executeAsync after the server responds.
    await operation._pendingPromise;

    if (operation.succeeded) {
      this.historyManager.record(operation);
      this.emitHistoryChange();
      this.log(`Map sample-array op (${params.operation}) recorded for index ${params.itemIndex}`);
      return true;
    }

    console.error('[CanvasEngine] Map sample-array op refused by server — not recorded');
    return false;
  }

  /**
   * Dispatch the HYP-290e DOM-mode (data-mode) op for a `.map()` iteration whose source is
   * an in-component `const items = [...]` literal array (classifier category `literal-array`).
   * Splices that array in the component file itself instead of editing the JSX template.
   * Mirrors {@link dispatchMapSampleArrayOp}: awaits the server write and records in history
   * ONLY on success; a refused op (server reclassifies the receiver) must not enter history.
   * Resolves to whether the server accepted the op.
   */
  async dispatchMapLiteralArrayOp(params: MapLiteralArrayOpParams): Promise<boolean> {
    const operation = new ASTMapLiteralArrayOperation(this.api, params);
    operation.execute(this.tree);

    await operation._pendingPromise;

    if (operation.succeeded) {
      this.historyManager.record(operation);
      this.emitHistoryChange();
      this.log(`Map literal-array op (${params.operation}) recorded for index ${params.itemIndex}`);
      return true;
    }

    console.error('[CanvasEngine] Map literal-array op refused by server — not recorded');
    return false;
  }

  /**
   * Build the dual-mode JSX/DOM dispatch controller for a structural op on a `.map()`
   * iteration (HYP-290c). The JSX op is applied immediately (default); the returned
   * controller drives the toast's ~3s switch window. On switch, it undoes the JSX op
   * and dispatches the DOM op with the captured params.
   *
   * `applyJsx` is the existing template op the caller already knows how to run
   * (delete/duplicate/reorder). `domEnabled` must reflect the classifier (HYP-290h):
   * true only for a supported DOM category; the server re-validates regardless.
   *
   * `applyDom` (HYP-290h) lets the caller pick the route the classifier selected — the
   * Sample-array op (category 1) or the in-component literal-array op (category 3).
   * Defaults to {@link dispatchMapSampleArrayOp} for backward compatibility.
   */
  createMapOpDispatchController(args: {
    operation: 'delete' | 'duplicate' | 'reorder';
    domEnabled: boolean;
    domParams: MapOpDomParams;
    applyJsx: () => void;
    /** Caller-selected DOM dispatch (sample vs literal). Defaults to the sample op. */
    applyDom?: (params: MapOpDomParams) => Promise<boolean>;
    windowMs?: number;
  }): MapOpDispatchController {
    return new MapOpDispatchController({
      operation: args.operation,
      domEnabled: args.domEnabled,
      domParams: args.domParams,
      applyJsx: args.applyJsx,
      // The JSX op sits at the history head after applyJsx. Undo drops it (and awaits
      // the in-flight write so the component file is restored before the DOM op's
      // server-side re-classification reads it).
      undoJsx: () => this.undo(),
      // On success the chosen dispatch records the DOM op — recording truncates the redo
      // branch (HistoryManager.record), so the JSX op is dropped and the DOM op is the
      // clean history head. On refusal it records nothing and returns false.
      applyDom: args.applyDom ?? ((params) => this.dispatchMapSampleArrayOp(params as MapSampleArrayOpParams)),
      // DOM refused → re-apply the JSX delete from the redo stack (still there because
      // the refused DOM op was never recorded). No data loss.
      redoJsx: () => this.redo(),
      windowMs: args.windowMs ?? 3000,
      schedule: (cb, ms) => {
        const handle = setTimeout(cb, ms);
        return () => clearTimeout(handle);
      },
    });
  }

  getSelectedInstances(): ComponentInstance[] {
    return this.selectionManager.getSelectedInstances(this._buildSelectionDeps());
  }

  // ============================================
  // Mode (Design/Interact)
  // ============================================

  setMode(mode: 'design' | 'interact' | 'code'): void {
    this.modeManager.setMode(mode);
    this.log(`Mode changed: ${this.modeManager.getMode()} -> ${mode}`);
  }

  getMode(): 'design' | 'interact' | 'code' {
    return this.modeManager.getMode();
  }

  // ============================================
  // History (Undo/Redo)
  // ============================================

  async undo(): Promise<boolean> {
    const success = await this.historyController.undo(this.tree);
    if (success) {
      this.notifyStateChange();
      this.log('Undo successful');
    }
    return success;
  }

  async redo(): Promise<boolean> {
    const success = await this.historyController.redo(this.tree);
    if (success) {
      this.notifyStateChange();
      this.log('Redo successful');
    }
    return success;
  }

  canUndo(): boolean {
    return this.historyController.canUndo();
  }

  canRedo(): boolean {
    return this.historyController.canRedo();
  }

  getHistoryState() {
    return this.historyController.getHistoryState();
  }

  executeAnnotationOperation(operation: BaseOperation): boolean {
    return this.historyController.executeAnnotationOperation(this.tree, operation);
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
      this.historyManager.record(operation);
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
      selectedSourceTabId?: string;
      elementLoc?: { line: number; column: number; endLine?: number; endColumn?: number };
    },
  ): Promise<void> | undefined {
    const operation = new ASTStyleOperation(this.api, {
      elementId,
      elementLoc: options?.elementLoc,
      filePath,
      styles,
      domClasses: options?.domClasses,
      instanceProps: options?.instanceProps,
      instanceId: options?.instanceId,
      state: options?.state,
      selectedSourceTabId: options?.selectedSourceTabId,
    });

    const result = operation.execute(this.tree);

    if (result.success) {
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
      this.historyManager.record(operation);
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
    this.historyManager.clear();
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
        const existing = uniqueEvents.get(eventName) as TreeChangeEvent | undefined;
        const treePayload = payload as TreeChangeEvent;
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
    this.historyManager.clear();
    this.emitHistoryChange();
  }

  /**
   * Record an external file change (AI agent, code-server, Monaco, chokidar)
   * as an undoable operation in history.
   */
  recordExternalFileChange(params: FileSnapshotOperationParams): void {
    const operation = new FileSnapshotOperation(this.api, params);
    this.historyManager.record(operation);
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
  private emitEvent<K extends keyof CanvasEngineEvents>(eventName: K, payload: CanvasEngineEvents[K]): void {
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
    this.historyManager.record(operation);

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
        this.historyManager.undo(this.tree);

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
      state: this.historyManager.getState(),
    });
  }

  /**
   * Rendered AST structures to resolve a selected node id against.
   *
   * Prefers `sampleStructure` (the tree actually rendered when a sample drives the
   * canvas) and falls back to `astStructure`, across the root document-instance and
   * its children. Mirrors the resolution used by element-tracing so map-iteration
   * lookups match the ids that selection records (spec A1/A7).
   */
  private getRenderedAstTrees(): ASTNode[][] {
    const trees: ASTNode[][] = [];
    const root = this.tree.getRoot();
    const rootAst = root.metadata?.sampleStructure ?? root.metadata?.astStructure;
    if (Array.isArray(rootAst)) trees.push(rootAst as ASTNode[]);

    for (const childId of root.children ?? []) {
      const child = this.tree.getInstance(childId);
      const childAst = child?.metadata?.sampleStructure ?? child?.metadata?.astStructure;
      if (Array.isArray(childAst)) trees.push(childAst as ASTNode[]);
    }
    return trees;
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
   * Build dependencies object for SelectionManager
   */
  private _buildSelectionDeps() {
    return {
      events: this.events,
      tree: this.tree,
      getRenderedAstTrees: () => this.getRenderedAstTrees(),
      findASTNode: (nodes: ASTNode[], id: string) => this.findASTNode(nodes, id),
      getActiveTracer,
      findAstNodeBySourceLoc,
    };
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
