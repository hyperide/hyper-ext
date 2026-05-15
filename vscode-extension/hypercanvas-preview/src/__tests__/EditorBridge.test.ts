import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { goToCode, handleEditorMessage, setMovePreviewToRight } from '../EditorBridge';

function createMockWebview() {
  const messages: unknown[] = [];
  return {
    postMessage: mock((msg: unknown) => {
      messages.push(msg);
      return Promise.resolve(true);
    }),
    messages,
  };
}

function resetMocks() {
  (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockReset();
  (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(() =>
    Promise.resolve({ getText: () => '', uri: vscode.Uri.file('/test') }),
  );

  const mockEditor = { selection: null, revealRange: mock() };
  (vscode.window.showTextDocument as ReturnType<typeof mock>).mockReset();
  (vscode.window.showTextDocument as ReturnType<typeof mock>).mockImplementation(() => Promise.resolve(mockEditor));

  // Reset tabGroups for getNonPreviewColumn
  (vscode.window as { tabGroups: { all: unknown[] } }).tabGroups = { all: [] };

  return mockEditor;
}

describe('EditorBridge', () => {
  let mockEditor: ReturnType<typeof resetMocks>;

  beforeEach(() => {
    mockEditor = resetMocks();
    setMovePreviewToRight(null);
  });

  describe('handleEditorMessage', () => {
    it('opens file on editor:openFile', async () => {
      const wv = createMockWebview();
      await handleEditorMessage({ type: 'editor:openFile', path: '/src/App.tsx' }, wv as never);
      expect(vscode.workspace.openTextDocument).toHaveBeenCalled();
      expect(vscode.window.showTextDocument).toHaveBeenCalled();
    });

    it('opens file at specific line/column on editor:openFile', async () => {
      const wv = createMockWebview();
      await handleEditorMessage({ type: 'editor:openFile', path: '/src/App.tsx', line: 10, column: 5 }, wv as never);
      expect(mockEditor.selection).not.toBeNull();
      // line 10, column 5 → Position(9, 4) (1-based → 0-based)
      expect(mockEditor.selection).toEqual(
        expect.objectContaining({
          start: expect.objectContaining({ line: 9, character: 4 }),
        }),
      );
    });

    it('sends active file on editor:getActiveFile', async () => {
      const wv = createMockWebview();
      (vscode.window as { activeTextEditor: unknown }).activeTextEditor = {
        document: { uri: { fsPath: '/test-workspace/src/Button.tsx' } },
      };

      await handleEditorMessage({ type: 'editor:getActiveFile', requestId: 'req-1' }, wv as never);

      expect(wv.messages).toContainEqual({
        type: 'editor:activeFileChanged',
        path: 'src/Button.tsx',
      });

      // Clean up
      (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;
    });

    it('sends null path when no active editor', async () => {
      const wv = createMockWebview();
      (vscode.window as { activeTextEditor: unknown }).activeTextEditor = undefined;

      await handleEditorMessage({ type: 'editor:getActiveFile', requestId: 'req-2' }, wv as never);

      expect(wv.messages).toContainEqual({
        type: 'editor:activeFileChanged',
        path: null,
      });
    });
  });

  describe('goToCode', () => {
    it('navigates to line:column (both 1-based input)', async () => {
      await goToCode('/src/App.tsx', 15, 8);
      // line=15, col=8 → Position(14, 7)
      expect(mockEditor.selection).toEqual(
        expect.objectContaining({
          start: expect.objectContaining({ line: 14, character: 7 }),
        }),
      );
      expect(mockEditor.revealRange).toHaveBeenCalled();
    });

    it('resolves relative paths against workspace root', async () => {
      await goToCode('src/Button.tsx', 1, 1);
      const call = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const uri = call[0] as { fsPath: string };
      expect(uri.fsPath).toBe('/test-workspace/src/Button.tsx');
    });

    it('uses absolute path as-is', async () => {
      await goToCode('/abs/path/File.tsx', 1, 1);
      const call = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const uri = call[0] as { fsPath: string };
      expect(uri.fsPath).toBe('/abs/path/File.tsx');
    });

    it('restores leading slash for Turbopack-stripped absolute paths (HYP-268)', async () => {
      // Turbopack source maps normalize 'file:///abs/path' → 'abs/path' (strips leading '/').
      // resolveFilePath must detect this and restore the slash rather than prepending workspaceRoot.
      // Workspace root is '/test-workspace', so first component is 'test-workspace'.
      // A path 'test-workspace/app/page.tsx' should become '/test-workspace/app/page.tsx'.
      await goToCode('test-workspace/app/page.tsx', 5, 3);
      const call = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const uri = call[0] as { fsPath: string };
      expect(uri.fsPath).toBe('/test-workspace/app/page.tsx');
    });

    it('shows error message on failure', async () => {
      // Suppress console.error — goToCode logs the caught error, and bun test
      // runner treats Error objects in console.error as uncaught errors in full suite
      const origError = console.error;
      console.error = mock();
      try {
        (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mockImplementation(async () => {
          throw new Error('not found');
        });
        await goToCode('/missing.tsx', 1, 1);
        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      } finally {
        console.error = origError;
      }
    });
  });

  describe('getNonPreviewColumn (via goToCode)', () => {
    it('opens file in the group without preview', async () => {
      (vscode.window as { tabGroups: { all: unknown[] } }).tabGroups = {
        all: [
          { viewColumn: 1, tabs: [{ input: {} }] },
          {
            viewColumn: 2,
            tabs: [{ input: new vscode.TabInputWebview('hypercanvas.previewPanel') }],
          },
        ],
      };

      await goToCode('/src/App.tsx', 1, 1);
      const call = (vscode.window.showTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const options = call[1] as { viewColumn: number };
      expect(options.viewColumn).toBe(1);
    });

    it('calls movePreviewToRight and returns column One when all groups have preview', async () => {
      const moveCallback = mock();
      setMovePreviewToRight(moveCallback);

      (vscode.window as { tabGroups: { all: unknown[] } }).tabGroups = {
        all: [
          {
            viewColumn: 1,
            tabs: [{ input: new vscode.TabInputWebview('hypercanvas.previewPanel') }],
          },
        ],
      };

      await goToCode('/src/App.tsx', 1, 1);

      expect(moveCallback).toHaveBeenCalledTimes(1);
      const call = (vscode.window.showTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const options = call[1] as { viewColumn: number };
      expect(options.viewColumn).toBe(1);
    });

    it('does not call movePreviewToRight when a code-only group exists', async () => {
      const moveCallback = mock();
      setMovePreviewToRight(moveCallback);

      (vscode.window as { tabGroups: { all: unknown[] } }).tabGroups = {
        all: [
          { viewColumn: 1, tabs: [{ input: {} }] },
          {
            viewColumn: 2,
            tabs: [{ input: new vscode.TabInputWebview('hypercanvas.previewPanel') }],
          },
        ],
      };

      await goToCode('/src/App.tsx', 1, 1);
      expect(moveCallback).not.toHaveBeenCalled();
    });
  });
});
