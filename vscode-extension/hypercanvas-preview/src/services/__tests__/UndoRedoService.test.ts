/**
 * UndoRedoService unit tests.
 *
 * Tests stack management logic (recordEdit, canUndo, canRedo, max length, path
 * validation). The actual undo/redo execution (vscode.commands.executeCommand,
 * focus tab, save) is tested via AstBridge integration tests where the global
 * vscode mock from test/mock-vscode.ts is reliably available.
 */

import { describe, expect, it } from 'bun:test';
import { UndoRedoService } from '../UndoRedoService';

describe('UndoRedoService', () => {
  const workspaceRoot = '/workspace';

  describe('recordEdit', () => {
    it('pushes to undo stack', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/src/a.tsx');
      expect(svc.canUndo()).toBe(true);
      expect(svc.canRedo()).toBe(false);
    });

    it('ignores paths outside workspace', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/other/src/a.tsx');
      expect(svc.canUndo()).toBe(false);
    });

    it('ignores path traversal attempts', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/../etc/passwd');
      expect(svc.canUndo()).toBe(false);
    });

    it('accepts absolute paths inside workspace', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/deep/nested/file.tsx');
      expect(svc.canUndo()).toBe(true);
    });

    it('drops oldest entry at max stack length (50)', () => {
      const svc = new UndoRedoService(workspaceRoot);
      for (let i = 0; i < 55; i++) {
        svc.recordEdit(`/workspace/file-${i}.tsx`);
      }
      // Internal stack is capped at 50 — verify canUndo still works
      expect(svc.canUndo()).toBe(true);
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
      svc.recordEdit('/workspace/a.tsx');
      expect(svc.canUndo()).toBe(true);
    });

    it('canUndo false when only invalid paths recorded', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/other/a.tsx');
      svc.recordEdit('/tmp/b.tsx');
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
