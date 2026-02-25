/**
 * History Manager - manages undo/redo operations
 */

import type { HistoryState } from '../models/types';
import type { Operation } from '../operations/Operation';
import type { DocumentTree } from './DocumentTree';

/**
 * History manager for undo/redo functionality
 */
export class HistoryManager {
  private stack: Operation[] = [];
  private position: number = -1;
  private maxLength: number;

  constructor(maxLength: number = 100) {
    this.maxLength = maxLength;
  }

  /**
   * Record an operation after execution
   */
  record(operation: Operation): void {
    // Remove everything after current position (branch)
    if (this.position < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.position + 1);
    }

    // Add new operation
    this.stack.push(operation);
    this.position++;

    // Trim history if exceeds max length
    if (this.stack.length > this.maxLength) {
      const excess = this.stack.length - this.maxLength;
      this.stack = this.stack.slice(excess);
      this.position -= excess;
    }
  }

  /**
   * Undo last operation
   */
  undo(tree: DocumentTree): boolean {
    if (!this.canUndo()) {
      return false;
    }

    const operation = this.stack[this.position];
    if (!operation.canUndo()) {
      // Skip non-undoable operation, move position anyway
      this.position--;
      return false;
    }

    const result = operation.undo(tree);
    // Always move position — a failed undo should not poison the stack
    this.position--;

    if (!result.success) {
      console.warn('[HistoryManager] Undo failed for operation:', operation.name, result.error);
    }

    return result.success;
  }

  /**
   * Redo next operation
   */
  redo(tree: DocumentTree): boolean {
    if (!this.canRedo()) {
      return false;
    }

    const operation = this.stack[this.position + 1];
    const result = operation.redo(tree);

    // Always move position — a failed redo should not poison the stack
    this.position++;

    if (!result.success) {
      console.warn('[HistoryManager] Redo failed for operation:', operation.name, result.error);
    }

    return result.success;
  }

  /**
   * Can undo?
   */
  canUndo(): boolean {
    return this.position >= 0;
  }

  /**
   * Can redo?
   */
  canRedo(): boolean {
    return this.position < this.stack.length - 1;
  }

  /**
   * Get current history state
   */
  getState(): HistoryState {
    return {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      position: this.position,
      length: this.stack.length,
    };
  }

  /**
   * Get operation at current position
   */
  getCurrentOperation(): Operation | null {
    if (this.position < 0 || this.position >= this.stack.length) {
      return null;
    }
    return this.stack[this.position];
  }

  /**
   * Get operation name at position
   */
  getOperationName(offset: number = 0): string | null {
    const index = this.position + offset;
    if (index < 0 || index >= this.stack.length) {
      return null;
    }
    return this.stack[index].name;
  }

  /**
   * Clear history
   */
  clear(): void {
    this.stack = [];
    this.position = -1;
  }

  /**
   * Get stack size
   */
  get size(): number {
    return this.stack.length;
  }
}
