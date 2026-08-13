/**
 * @file History controller for CanvasEngine
 *
 * Accessed via: CanvasEngine undo/redo methods
 * Assumptions: HistoryManager is the single source of truth for operation history
 * Past bugs: HYP-XXX — concurrent undo/redo race condition (fixed with guard)
 */

import type { EventEmitter } from '../events/EventEmitter';
import type { CanvasEngineEvents, CanvasEventName } from '../events/events';
import type { HistoryState } from '../models/types';
import { FileSnapshotOperation, type FileSnapshotOperationParams } from '../operations/FileSnapshotOperation';
import type { Operation } from '../operations/Operation';
import type { DocumentTree } from './DocumentTree';
import type { HistoryManager } from './HistoryManager';

export class HistoryController {
  private history: HistoryManager;
  private events: EventEmitter;
  private _undoRedoInProgress: boolean = false;

  constructor(history: HistoryManager, events: EventEmitter) {
    this.history = history;
    this.events = events;
  }

  async undo(tree: DocumentTree): Promise<boolean> {
    if (this._undoRedoInProgress) {
      console.log('[CanvasEngine] Undo already in progress, ignoring');
      return false;
    }
    this._undoRedoInProgress = true;
    try {
      const operation = this.history.getCurrentOperation();
      const success = this.history.undo(tree);
      if (success) {
        if (operation && '_pendingPromise' in operation && operation._pendingPromise instanceof Promise) {
          try {
            await operation._pendingPromise;
          } catch {
            /* handled by HistoryManager */
          }
        }
        this.emitHistoryChange();
        if (operation) {
          this.events.emit(
            'history:undo' as CanvasEventName,
            { operationName: operation.name } as CanvasEngineEvents['history:undo'],
          );
        }
      }
      return success;
    } finally {
      this._undoRedoInProgress = false;
    }
  }

  async redo(tree: DocumentTree): Promise<boolean> {
    if (this._undoRedoInProgress) {
      console.log('[CanvasEngine] Redo already in progress, ignoring');
      return false;
    }
    this._undoRedoInProgress = true;
    try {
      const success = this.history.redo(tree);
      if (success) {
        const operation = this.history.getCurrentOperation();
        if (operation && '_pendingPromise' in operation && operation._pendingPromise instanceof Promise) {
          try {
            await operation._pendingPromise;
          } catch {
            /* handled by HistoryManager */
          }
        }
        this.emitHistoryChange();
        if (operation) {
          this.events.emit(
            'history:redo' as CanvasEventName,
            { operationName: operation.name } as CanvasEngineEvents['history:redo'],
          );
        }
      }
      return success;
    } finally {
      this._undoRedoInProgress = false;
    }
  }

  canUndo(): boolean {
    if (this._undoRedoInProgress) return false;
    return this.history.canUndo();
  }

  canRedo(): boolean {
    if (this._undoRedoInProgress) return false;
    return this.history.canRedo();
  }

  getHistoryState(): HistoryState {
    return this.history.getState();
  }

  executeAnnotationOperation(tree: DocumentTree, operation: Operation): boolean {
    const result = operation.execute(tree);
    if (result.success) {
      this.history.record(operation);
      this.emitHistoryChange();
      return true;
    }
    console.error('[CanvasEngine] Annotation operation failed:', result.error);
    return false;
  }

  recordExternalFileChange(tree: DocumentTree, api: unknown, params: FileSnapshotOperationParams): void {
    const operation = new FileSnapshotOperation(api as never, params);
    this.history.record(operation);
    this.emitHistoryChange();
  }

  clearHistory(): void {
    this.history.clear();
    this.emitHistoryChange();
  }

  private emitHistoryChange(): void {
    this.events.emit(
      'history:change' as CanvasEventName,
      { state: this.history.getState() } as CanvasEngineEvents['history:change'],
    );
  }

  getCurrentOperation(): Operation | null {
    return this.history.getCurrentOperation();
  }
}
