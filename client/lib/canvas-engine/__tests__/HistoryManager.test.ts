/**
 * HistoryManager unit tests
 */

import { beforeEach, describe, expect, it } from 'bun:test';
import { DocumentTree } from '../core/DocumentTree';
import { HistoryManager } from '../core/HistoryManager';
import type { OperationResult } from '../models/types';
import type { Operation } from '../operations/Operation';

/** Create a stub operation for testing */
function createStubOperation(
  name: string,
  options?: {
    undoResult?: OperationResult;
    redoResult?: OperationResult;
    canUndoValue?: boolean;
  },
): Operation {
  const undoResult = options?.undoResult ?? { success: true };
  const redoResult = options?.redoResult ?? { success: true };
  const canUndoValue = options?.canUndoValue ?? true;

  return {
    name,
    execute: () => ({ success: true }),
    undo: () => undoResult,
    redo: () => redoResult,
    canUndo: () => canUndoValue,
  };
}

describe('HistoryManager', () => {
  let history: HistoryManager;
  let tree: DocumentTree;

  beforeEach(() => {
    history = new HistoryManager();
    tree = new DocumentTree();
  });

  describe('initial state', () => {
    it('should start with empty stack', () => {
      expect(history.size).toBe(0);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
    });

    it('should return correct initial state', () => {
      const state = history.getState();
      expect(state).toEqual({
        canUndo: false,
        canRedo: false,
        position: -1,
        length: 0,
      });
    });
  });

  describe('record', () => {
    it('should record operation and enable undo', () => {
      const op = createStubOperation('test-op');
      history.record(op);

      expect(history.size).toBe(1);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
    });

    it('should record multiple operations', () => {
      history.record(createStubOperation('op-1'));
      history.record(createStubOperation('op-2'));
      history.record(createStubOperation('op-3'));

      expect(history.size).toBe(3);
      expect(history.getState().position).toBe(2);
    });
  });

  describe('undo', () => {
    it('should return false when nothing to undo', () => {
      expect(history.undo(tree)).toBe(false);
    });

    it('should undo last operation', () => {
      history.record(createStubOperation('op-1'));
      const result = history.undo(tree);

      expect(result).toBe(true);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);
    });

    it('should undo multiple operations in reverse order', () => {
      const undoOrder: string[] = [];

      const makeOp = (name: string): Operation => ({
        name,
        execute: () => ({ success: true }),
        undo: () => {
          undoOrder.push(name);
          return { success: true };
        },
        redo: () => ({ success: true }),
        canUndo: () => true,
      });

      history.record(makeOp('op-1'));
      history.record(makeOp('op-2'));
      history.record(makeOp('op-3'));

      history.undo(tree);
      history.undo(tree);
      history.undo(tree);

      expect(undoOrder).toEqual(['op-3', 'op-2', 'op-1']);
      expect(history.canUndo()).toBe(false);
    });
  });

  describe('redo', () => {
    it('should return false when nothing to redo', () => {
      expect(history.redo(tree)).toBe(false);
    });

    it('should redo after undo', () => {
      let redoCalled = false;
      const op: Operation = {
        name: 'test',
        execute: () => ({ success: true }),
        undo: () => ({ success: true }),
        redo: () => {
          redoCalled = true;
          return { success: true };
        },
        canUndo: () => true,
      };

      history.record(op);
      history.undo(tree);
      const result = history.redo(tree);

      expect(result).toBe(true);
      expect(redoCalled).toBe(true);
      expect(history.canRedo()).toBe(false);
      expect(history.canUndo()).toBe(true);
    });

    it('should discard redo stack after new record', () => {
      history.record(createStubOperation('op-A'));
      history.undo(tree);
      expect(history.canRedo()).toBe(true);

      // Record new operation — should discard redo branch
      history.record(createStubOperation('op-B'));
      expect(history.canRedo()).toBe(false);
      expect(history.size).toBe(1);
    });
  });

  describe('canUndo/canRedo states', () => {
    it('should track states through full lifecycle', () => {
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);

      history.record(createStubOperation('op-1'));
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);

      history.undo(tree);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(true);

      history.redo(tree);
      expect(history.canUndo()).toBe(true);
      expect(history.canRedo()).toBe(false);
    });
  });

  describe('maxLength overflow', () => {
    it('should drop oldest operations when exceeding max', () => {
      const smallHistory = new HistoryManager(5);

      for (let i = 0; i < 8; i++) {
        smallHistory.record(createStubOperation(`op-${i}`));
      }

      expect(smallHistory.size).toBe(5);
      // The oldest operations (op-0, op-1, op-2) should be gone
      // Current position should point to last operation
      const state = smallHistory.getState();
      expect(state.length).toBe(5);
    });

    it('should still function correctly after overflow', () => {
      const smallHistory = new HistoryManager(3);

      smallHistory.record(createStubOperation('op-1'));
      smallHistory.record(createStubOperation('op-2'));
      smallHistory.record(createStubOperation('op-3'));
      smallHistory.record(createStubOperation('op-4'));

      expect(smallHistory.size).toBe(3);
      expect(smallHistory.canUndo()).toBe(true);

      // Should be able to undo all remaining
      expect(smallHistory.undo(tree)).toBe(true);
      expect(smallHistory.undo(tree)).toBe(true);
      expect(smallHistory.undo(tree)).toBe(true);
      expect(smallHistory.canUndo()).toBe(false);
    });
  });

  describe('clear', () => {
    it('should reset all state', () => {
      history.record(createStubOperation('op-1'));
      history.record(createStubOperation('op-2'));
      history.clear();

      expect(history.size).toBe(0);
      expect(history.canUndo()).toBe(false);
      expect(history.canRedo()).toBe(false);
      expect(history.getState().position).toBe(-1);
    });
  });

  describe('failed operations', () => {
    it('should not poison stack on failed undo', () => {
      const failingOp = createStubOperation('failing', {
        undoResult: { success: false, error: 'undo failed' },
      });
      const goodOp = createStubOperation('good');

      history.record(goodOp);
      history.record(failingOp);

      // Undo failing op — returns false but moves position
      const result1 = history.undo(tree);
      expect(result1).toBe(false);

      // Next undo should still work for goodOp
      const result2 = history.undo(tree);
      expect(result2).toBe(true);
    });

    it('should not poison stack on failed redo', () => {
      const failingOp = createStubOperation('failing', {
        redoResult: { success: false, error: 'redo failed' },
      });

      history.record(failingOp);
      history.undo(tree);

      // Redo failing op — returns false but moves position
      const result = history.redo(tree);
      expect(result).toBe(false);

      // Position should have moved past the failing op
      expect(history.canRedo()).toBe(false);
    });

    it('should skip non-undoable operations', () => {
      const nonUndoable = createStubOperation('non-undoable', {
        canUndoValue: false,
      });
      const undoable = createStubOperation('undoable');

      history.record(undoable);
      history.record(nonUndoable);

      // First undo — skips non-undoable, returns false
      const result1 = history.undo(tree);
      expect(result1).toBe(false);

      // Second undo — should undo the undoable operation
      const result2 = history.undo(tree);
      expect(result2).toBe(true);
    });
  });

  describe('getState', () => {
    it('should return correct state after operations', () => {
      history.record(createStubOperation('op-1'));
      history.record(createStubOperation('op-2'));

      expect(history.getState()).toEqual({
        canUndo: true,
        canRedo: false,
        position: 1,
        length: 2,
      });

      history.undo(tree);

      expect(history.getState()).toEqual({
        canUndo: true,
        canRedo: true,
        position: 0,
        length: 2,
      });
    });
  });

  describe('getCurrentOperation', () => {
    it('should return null when empty', () => {
      expect(history.getCurrentOperation()).toBeNull();
    });

    it('should return current operation', () => {
      const op = createStubOperation('current-op');
      history.record(op);

      expect(history.getCurrentOperation()).toBe(op);
    });

    it('should return previous operation after undo', () => {
      const op1 = createStubOperation('op-1');
      const op2 = createStubOperation('op-2');

      history.record(op1);
      history.record(op2);
      history.undo(tree);

      expect(history.getCurrentOperation()).toBe(op1);
    });
  });

  describe('getOperationName', () => {
    it('should return null when empty', () => {
      expect(history.getOperationName()).toBeNull();
    });

    it('should return name at current position', () => {
      history.record(createStubOperation('my-op'));
      expect(history.getOperationName()).toBe('my-op');
    });

    it('should return name at offset', () => {
      history.record(createStubOperation('op-1'));
      history.record(createStubOperation('op-2'));

      // Current position is 1 (op-2), offset +1 would be out of bounds
      expect(history.getOperationName(0)).toBe('op-2');
      expect(history.getOperationName(-1)).toBe('op-1');
      expect(history.getOperationName(1)).toBeNull();
    });
  });
});
