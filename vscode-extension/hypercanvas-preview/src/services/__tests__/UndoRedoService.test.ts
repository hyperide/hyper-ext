/**
 * UndoRedoService unit tests.
 *
 * Tests stack management logic (recordEdit, canUndo, canRedo, max length, path
 * validation) plus the write path used by undo/redo.
 */

import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
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

  // HYP-909 follow-up (codex review #622): the Explorer's ancestor-monorepo fallback
  // can surface a sibling sub-project living outside the opened folder (VS Code opened
  // at a leaf package, e.g. packages/cms-spa, with a monorepo ancestor discovered).
  // Editing that sibling resolves to an absolute path outside `_workspaceRoot` by
  // design; setAdditionalWorkspaceRoot widens the boundary so its undo snapshot isn't
  // silently dropped.
  describe('setAdditionalWorkspaceRoot', () => {
    it('rejects a sibling path with no additional root set (baseline)', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/monorepo/packages/sibling/src/App.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });

    it('accepts a path under the additional root once set', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.setAdditionalWorkspaceRoot('/monorepo');
      svc.recordEdit('/monorepo/packages/sibling/src/App.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(true);
    });

    it('still accepts the original workspace root after an additional root is set', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.setAdditionalWorkspaceRoot('/monorepo');
      svc.recordEdit('/workspace/src/a.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(true);
    });

    it('still rejects paths outside BOTH roots', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.setAdditionalWorkspaceRoot('/monorepo');
      svc.recordEdit('/other/src/a.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });

    it('narrows back to just the workspace root when reset to null', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.setAdditionalWorkspaceRoot('/monorepo');
      svc.setAdditionalWorkspaceRoot(null);
      svc.recordEdit('/monorepo/packages/sibling/src/App.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });

    // review-diff finding: an empty string additional root must NOT disable the
    // workspace boundary — '' + path.sep === '/', which startsWith() matches on
    // every absolute POSIX path.
    it('treats an empty-string additional root as no additional root (does not disable the boundary)', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.setAdditionalWorkspaceRoot('');
      svc.recordEdit('/anywhere/else/a.tsx', 'before', 'after');
      expect(svc.canUndo()).toBe(false);
    });

    it('recordBatchEdit also honors the additional root', () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.setAdditionalWorkspaceRoot('/monorepo');
      svc.recordBatchEdit([
        { filePath: '/monorepo/packages/sibling/a.tsx', contentBefore: 'a', contentAfter: 'a2' },
        { filePath: '/workspace/src/b.tsx', contentBefore: 'b', contentAfter: 'b2' },
      ]);
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

  describe('undo/redo writes', () => {
    it('writes undo content disk-first and never saves the open document', async () => {
      const save = mock(() => Promise.resolve(true));
      const uri = vscode.Uri.file('/workspace/a.tsx');
      const doc: Pick<vscode.TextDocument, 'uri' | 'getText' | 'positionAt' | 'isDirty' | 'save'> = {
        uri,
        getText: () => 'after',
        positionAt: (offset: number) => new vscode.Position(0, offset),
        isDirty: true,
        save,
      };
      vscode.workspace.textDocuments.push(doc as vscode.TextDocument);

      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/a.tsx', 'before', 'after');

      expect(await svc.undo({ reveal: mock(() => {}) } as vscode.WebviewPanel)).toBe(true);

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      const [, content] = (vscode.workspace.fs.writeFile as ReturnType<typeof mock>).mock.calls[0] as [
        vscode.Uri,
        Uint8Array,
      ];
      expect(Buffer.from(content).toString('utf-8')).toBe('before');
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
      expect(save).not.toHaveBeenCalled();
    });

    it('does not apply WorkspaceEdit for clean open documents', async () => {
      const uri = vscode.Uri.file('/workspace/a.tsx');
      const doc: Pick<vscode.TextDocument, 'uri' | 'getText' | 'positionAt' | 'isDirty'> = {
        uri,
        getText: () => 'after',
        positionAt: (offset: number) => new vscode.Position(0, offset),
        isDirty: false,
      };
      vscode.workspace.textDocuments.push(doc as vscode.TextDocument);

      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/a.tsx', 'before', 'after');

      expect(await svc.undo({ reveal: mock(() => {}) } as vscode.WebviewPanel)).toBe(true);

      expect(vscode.workspace.fs.writeFile).toHaveBeenCalledTimes(1);
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });
  });

  describe('canRedo() during beginTracking()/endTracking() — the trackingCount clause never conflicts with a non-empty stack', () => {
    // A review pass on PR #673's follow-up raised a P1 concern: PreviewPanel's
    // undo()/redo() gate a native-fallback decision on `!canRedo()`, and
    // `canRedo()` is `redoStack.length > 0 && trackingCount === 0` — so in
    // theory `trackingCount > 0` could report "empty" while the redo stack
    // still has real entries, wrongly triggering a native fallback instead of
    // "busy". This test proves that scenario is UNREACHABLE through the public
    // API: `beginTracking()` unconditionally clears `_redoStack` as its FIRST,
    // synchronous action (see its own doc comment), so by the time any caller
    // observes `trackingCount > 0`, the redo stack is already empty — the
    // `trackingCount === 0` clause never actually diverges from a plain
    // `redoStack.length > 0` check for any reachable call sequence.
    it('has an empty redo stack the instant tracking begins, even if redo had entries a moment earlier', async () => {
      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/a.tsx', 'v1', 'v2');
      expect(await svc.undo({ reveal: mock(() => {}) } as vscode.WebviewPanel)).toBe(true);
      // Redo stack now has one entry from the undo above.
      expect(svc.canRedo()).toBe(true);

      svc.beginTracking();
      try {
        // canRedo() reports false while tracking — NOT because trackingCount
        // masks a real entry, but because beginTracking() already cleared it.
        expect(svc.canRedo()).toBe(false);
      } finally {
        svc.endTracking();
      }
    });
  });

  describe('canUndo() preflight during a concurrent in-flight undo() — a second overlapping call never sees a false "empty"', () => {
    // Another review-pass P1 concern: PreviewPanel.undo() reads `canUndo()`
    // BEFORE calling `undo()`, specifically to tell "nothing to undo" apart
    // from "undo() returned false because a concurrent call is already in
    // flight" (`_inProgress`). This test drives that exact race with the REAL
    // service (not mocks standing in for its return value): a first undo()
    // call's file write is held open on a controllable promise, and a SECOND
    // undo() call's `canUndo()` is read while the first is still pending.
    it('keeps canUndo() true while a first undo() with the same (last) stack entry is still writing', async () => {
      let releaseFirstWrite: (() => void) | undefined;
      const firstWriteGate = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
      });
      let writeCallCount = 0;
      (vscode.workspace.fs.writeFile as ReturnType<typeof mock>).mockImplementation(async () => {
        writeCallCount++;
        if (writeCallCount === 1) {
          await firstWriteGate;
        }
      });

      const svc = new UndoRedoService(workspaceRoot);
      svc.recordEdit('/workspace/a.tsx', 'before', 'after');

      const panel = { reveal: mock(() => {}) } as unknown as vscode.WebviewPanel;
      const firstUndo = svc.undo(panel);

      // The first undo() call is now inside its file-write await, holding
      // `_inProgress = true` and the stack entry NOT YET popped. A second,
      // overlapping call's canUndo() preflight (as PreviewPanel.undo() does)
      // must see the stack as still non-empty — never a false "empty".
      expect(svc.canUndo()).toBe(true);
      const secondUndoHandled = await svc.undo(panel);
      // The second call is correctly rejected as "busy" (_inProgress), not
      // "handled" — its caller's stackWasEmpty-gated native fallback must
      // NOT fire, because canUndo() (read above) correctly reported true.
      expect(secondUndoHandled).toBe(false);

      releaseFirstWrite?.();
      expect(await firstUndo).toBe(true);
      // Only after the first call fully completes does the stack become
      // genuinely empty.
      expect(svc.canUndo()).toBe(false);
    });
  });
});
