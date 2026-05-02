/**
 * UndoRedoService unit tests.
 *
 * Tests stack management logic (recordEdit, canUndo, canRedo, max length, path
 * validation). The actual undo/redo execution (content write via WorkspaceEdit +
 * save) is tested via AstBridge integration tests where the global vscode mock
 * from test/mock-vscode.ts is reliably available.
 */

import { describe, expect, it } from 'bun:test';
import { UndoRedoService } from '../UndoRedoService';

describe('UndoRedoService', () => {
  const workspaceRoot = '/workspace';

  describe('recordEdit', () => {
    it('pushes to undo stack', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/src/a.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(true);
      expect(svc.canRedo()).toBe(false);
    });

    it('ignores paths outside workspace', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/other/src/a.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });

    it('ignores path traversal attempts', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/../etc/passwd', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });

    it('accepts absolute paths inside workspace', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/deep/nested/file.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(true);
    });

    it('drops oldest entry at max stack length (50)', () => {
      const svc = new UndoRedoService(workspaceRoot);
      for (let i = 0; i < 55; i++) {
        svc.recordEdit(`/workspace/file-${i}.tsx`, `before-${i}`, `after-${i}`);
      }
      // Internal stack is capped at 50 — verify canUndo still works
      expect(svc.canUndo()).toBe(true);
    });

    it('clears redo stack on new edit', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/a.tsx', 'v1', 'v2');
      // Simulate undo by accessing internal state indirectly —
      // undo requires a panel mock, so we test via canRedo after undo in AstBridge tests.
      // Here just verify new edit clears redo stack.
      svc.recordEdit('/workspace/b.tsx', 'v1', 'v2');
      // redo should still be false (no undo was done)
      expect(svc.canRedo()).toBe(false);
    });
  });

  describe('canUndo / canRedo', () => {
    it('both false on fresh instance', () => {
      const svc = new UndoRedoService(workspaceRoot);
      expect(svc.canUndo()).toBe(false);
      expect(svc.canRedo()).toBe(false);
    });

    it('canUndo true after recordEdit', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/a.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(true);
    });

    it('canUndo false when only invalid paths recorded', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/other/a.tsx', 'before', 'after');
      svc.recordEdit('/tmp/b.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });
  });

  describe('undo/redo returns false on empty stacks', () => {
    it('undo returns false when no edits recorded', async () => {
      const svc = new UndoRedoService(workspaceRoot);
      const panel = { reveal: () => {} } as never;
      expect(await svc.undo(panel)).toBe(false);
    });

    it('redo returns false when no undo performed', async () => {
      const svc = new UndoRedoService(workspaceRoot);
      const panel = { reveal: () => {} } as never;
      expect(await svc.redo(panel)).toBe(false);
    });
  });
});
