import { beforeEach, describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { goToCode, handleEditorMessage, isBundleArtifactPath, setMovePreviewToRight } from '../EditorBridge';

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

    it('SELECTS the full element range when an end position is supplied (Go-to-Code)', async () => {
      // BUG C: Go-to-Code must highlight the element's JSX, not drop a zero-width caret.
      await goToCode('/src/App.tsx', 5, 9, { endLine: 7, endColumn: 17 });
      expect(mockEditor.selection).toEqual(
        expect.objectContaining({
          start: expect.objectContaining({ line: 4, character: 8 }), // 5:9 → (4,8)
          end: expect.objectContaining({ line: 6, character: 16 }), // 7:17 → (6,16)
        }),
      );
      // A real range, not a caret.
      const sel = mockEditor.selection as unknown as { start: { line: number }; end: { line: number } };
      expect(sel.end.line).not.toBe(sel.start.line);
    });

    it('places a caret (zero-width) when no end position is supplied', async () => {
      await goToCode('/src/App.tsx', 5, 9);
      const sel = mockEditor.selection as unknown as {
        start: { line: number; character: number };
        end: { line: number; character: number };
      };
      expect(sel.start).toEqual(sel.end);
    });

    it('focuses the editor tab on editor:goToCode (preserveFocus false)', async () => {
      const wv = createMockWebview();
      await handleEditorMessage(
        { type: 'editor:goToCode', path: '/src/App.tsx', line: 5, column: 9, endLine: 5, endColumn: 20 },
        wv as never,
      );
      const call = (vscode.window.showTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const options = call[1] as { preserveFocus: boolean };
      expect(options.preserveFocus).toBe(false);
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

    it('strips the Vite /@fs/ serving prefix from a cross-package library path (HYP-443)', async () => {
      // A cross-package library file is served via `/@fs/<absolute>`; that URL leaks
      // into the fiber path the iframe reports for navigation. resolveFilePath must
      // strip `/@fs/` to recover the real absolute file, not resolve it relative to
      // the workspace root (which produced `<repo>/@fs/...` → "cannot open").
      await goToCode('/@fs/Users/alice/repo/packages/ui/src/Card.tsx', 12, 3);
      const call = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const uri = call[0] as { fsPath: string };
      expect(uri.fsPath).toBe('/Users/alice/repo/packages/ui/src/Card.tsx');
    });

    it('strips a slash-dropped @fs/ prefix (webview hop drops the leading slash)', async () => {
      // The webview→extension message hop can drop the leading slash, yielding
      // `@fs/Users/...`. Both forms must resolve to the same real absolute file.
      await goToCode('@fs/Users/alice/repo/packages/ui/src/Card.tsx', 12, 3);
      const call = (vscode.workspace.openTextDocument as ReturnType<typeof mock>).mock.calls[0];
      const uri = call[0] as { fsPath: string };
      expect(uri.fsPath).toBe('/Users/alice/repo/packages/ui/src/Card.tsx');
    });

    it('skips bundle artifact paths without opening or erroring', async () => {
      // Bun's hashed _bun/client/<hash>.js rotates on every rebuild — opening
      // it produces "cannot open file:///.../_bun/client/index-<hash>.js"
      // because the file is gone by the time the click resolves. Skip silently.
      const origLog = console.log;
      console.log = mock();
      try {
        await goToCode('/workspace/proj/_bun/client/index-abc123.js', 10, 5);
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      } finally {
        console.log = origLog;
      }
    });

    it('skips Next.js static chunks and node_modules paths', async () => {
      const origLog = console.log;
      console.log = mock();
      try {
        await goToCode('/proj/_next/static/chunks/main-abc.js', 1, 1);
        await goToCode('node_modules/react-dom/cjs/react-dom.development.js', 1, 1);
        expect(vscode.workspace.openTextDocument).not.toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      } finally {
        console.log = origLog;
      }
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

  describe('isBundleArtifactPath', () => {
    it('detects bun, Next.js, and node_modules bundle paths', () => {
      expect(isBundleArtifactPath('/workspace/proj/_bun/client/index-abc.js')).toBe(true);
      expect(isBundleArtifactPath('_bun/client/index-abc.js')).toBe(true);
      expect(isBundleArtifactPath('/proj/_next/static/chunks/main.js')).toBe(true);
      expect(isBundleArtifactPath('node_modules/react/index.js')).toBe(true);
      expect(isBundleArtifactPath('/abs/node_modules/react/index.js')).toBe(true);
    });

    it('does not flag user source files', () => {
      expect(isBundleArtifactPath('src/App.tsx')).toBe(false);
      expect(isBundleArtifactPath('/abs/path/Button.tsx')).toBe(false);
      expect(isBundleArtifactPath('app/page.tsx')).toBe(false);
      // Files that *contain* the string "_bun" but not as the segment are user code.
      expect(isBundleArtifactPath('src/my_bundle.ts')).toBe(false);
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
