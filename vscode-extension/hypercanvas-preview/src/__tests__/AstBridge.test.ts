import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock AstService — we test the bridge routing, not AST logic
const mockAstService = {
  updateStyles: mock(() => Promise.resolve({ success: true, className: 'text-red' })),
  updateProps: mock(() => Promise.resolve({ success: true })),
  insertElement: mock(() => Promise.resolve({ success: true, newId: 'new-1', index: 0 })),
  deleteElements: mock(() => Promise.resolve({ success: true, data: { deletedCount: 1 } })),
  duplicateElement: mock(() => Promise.resolve({ success: true, newId: 'dup-1' })),
  updateText: mock(() => Promise.resolve({ success: true })),
  wrapElement: mock(() => Promise.resolve({ success: true, wrapperId: 'wrap-1' })),
  pasteElement: mock(() => Promise.resolve({ success: true, newId: 'paste-1' })),
};

mock.module('../services/AstService', () => ({
  AstService: class {
    updateStyles = mockAstService.updateStyles;
    updateProps = mockAstService.updateProps;
    insertElement = mockAstService.insertElement;
    deleteElements = mockAstService.deleteElements;
    duplicateElement = mockAstService.duplicateElement;
    updateText = mockAstService.updateText;
    wrapElement = mockAstService.wrapElement;
    pasteElement = mockAstService.pasteElement;
  },
}));

// Real UndoRedoService is used — do NOT mock it (mock.module is global in bun,
// would poison UndoRedoService.test.ts). vscode is already mocked via test/mock-vscode.ts preload.
// VSCodeFileIO is NOT mocked — its constructor is a no-op and AstService is mocked above,
// so VSCodeFileIO methods are never called by AstService. But _withUndoTracking now calls
// readFile directly — we control this via workspace.textDocuments mock.

import * as vscode from 'vscode';

const { AstBridge } = await import('../bridges/AstBridge');

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

/**
 * Simulate file content changes for undo tracking.
 * The first readFile call (before operation) returns `before`,
 * the second call (after operation) returns `after`.
 * VSCodeFileIO.readFile checks textDocuments first, then falls back to workspace.fs.readFile.
 * We use textDocuments to control the return value.
 */
function setupFileSnapshotsForPath(filePath: string, before: string, after: string): void {
  let callCount = 0;
  const mockDoc = {
    uri: { fsPath: filePath } as vscode.Uri,
    getText: () => {
      callCount++;
      return callCount <= 1 ? before : after;
    },
  };
  (vscode.workspace.textDocuments as unknown[]).push(mockDoc);
}

describe('AstBridge', () => {
  let bridge: InstanceType<typeof AstBridge>;

  beforeEach(() => {
    bridge = new AstBridge('/workspace');
    for (const fn of Object.values(mockAstService)) {
      fn.mockClear();
    }
    // vscode mocks are reset in mock-vscode.ts preload beforeEach
    // Restore defaults
    mockAstService.updateStyles.mockImplementation(() => Promise.resolve({ success: true, className: 'text-red' }));
    mockAstService.updateProps.mockImplementation(() => Promise.resolve({ success: true }));
    mockAstService.deleteElements.mockImplementation(() =>
      Promise.resolve({ success: true, data: { deletedCount: 1 } }),
    );
    mockAstService.duplicateElement.mockImplementation(() => Promise.resolve({ success: true, newId: 'dup-1' }));
    mockAstService.wrapElement.mockImplementation(() => Promise.resolve({ success: true, wrapperId: 'wrap-1' }));
    mockAstService.pasteElement.mockImplementation(() => Promise.resolve({ success: true, newId: 'paste-1' }));
  });

  it('routes ast:updateStyles and returns className', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      {
        type: 'ast:updateStyles',
        requestId: 'r1',
        filePath: 'f.tsx',
        elementId: 'e1',
        styles: { color: 'red' },
      } as never,
      wv as never,
    );
    expect(mockAstService.updateStyles).toHaveBeenCalled();
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({
        type: 'ast:response',
        requestId: 'r1',
        success: true,
        data: { className: 'text-red' },
      }),
    );
  });

  it('passes selected source tab ID through ast:updateStyles', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      {
        type: 'ast:updateStyles',
        requestId: 'r1-source-tab',
        filePath: 'f.tsx',
        elementId: 'e1',
        styles: { color: 'red' },
        selectedSourceTabId: 'tailwind-v4:elementClass',
      } as never,
      wv as never,
    );

    expect(mockAstService.updateStyles).toHaveBeenCalledWith(
      'f.tsx',
      'e1',
      { color: 'red' },
      undefined,
      undefined,
      'tailwind-v4:elementClass',
    );
  });

  it('routes ast:updateProps', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      {
        type: 'ast:updateProps',
        requestId: 'r2',
        filePath: 'f.tsx',
        elementId: 'e1',
        props: { disabled: true },
      } as never,
      wv as never,
    );
    expect(mockAstService.updateProps).toHaveBeenCalled();
    expect(wv.messages[0]).toEqual(expect.objectContaining({ requestId: 'r2', success: true }));
  });

  it('routes ast:insertElement and returns newId', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      {
        type: 'ast:insertElement',
        requestId: 'r3',
        filePath: 'f.tsx',
        parentId: 'p1',
        componentType: 'div',
        props: {},
      } as never,
      wv as never,
    );
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({ requestId: 'r3', success: true, data: { newId: 'new-1', index: 0 } }),
    );
  });

  it('routes ast:deleteElements', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      { type: 'ast:deleteElements', requestId: 'r4', filePath: 'f.tsx', elementIds: ['e1'] } as never,
      wv as never,
    );
    expect(mockAstService.deleteElements).toHaveBeenCalled();
    expect(wv.messages[0]).toEqual(expect.objectContaining({ requestId: 'r4', success: true }));
  });

  it('routes ast:duplicateElement and returns newId', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      { type: 'ast:duplicateElement', requestId: 'r5', filePath: 'f.tsx', elementId: 'e1' } as never,
      wv as never,
    );
    expect(wv.messages[0]).toEqual(expect.objectContaining({ requestId: 'r5', data: { newId: 'dup-1' } }));
  });

  it('routes ast:updateText', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      { type: 'ast:updateText', requestId: 'r6', filePath: 'f.tsx', elementId: 'e1', text: 'Hello' } as never,
      wv as never,
    );
    expect(mockAstService.updateText).toHaveBeenCalledWith('f.tsx', 'e1', 'Hello');
  });

  it('routes ast:wrapElement and returns wrapperId', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage(
      { type: 'ast:wrapElement', requestId: 'r7', filePath: 'f.tsx', elementId: 'e1', wrapperType: 'div' } as never,
      wv as never,
    );
    expect(wv.messages[0]).toEqual(expect.objectContaining({ requestId: 'r7', data: { wrapperId: 'wrap-1' } }));
  });

  it('returns error response for unknown ast message type', async () => {
    const wv = createMockWebview();
    await bridge.handleMessage({ type: 'ast:unknown', requestId: 'r8' } as never, wv as never);
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({ requestId: 'r8', success: false, error: expect.stringContaining('Unknown') }),
    );
  });

  it('catches exceptions and returns error response', async () => {
    // Suppress console.error — handleMessage logs the caught error, and bun test
    // runner treats Error objects in console.error as uncaught errors in full suite
    const origError = console.error;
    console.error = mock();
    try {
      mockAstService.updateStyles.mockImplementation(async () => {
        throw new Error('parse fail');
      });
      const wv = createMockWebview();
      await bridge.handleMessage(
        { type: 'ast:updateStyles', requestId: 'r9', filePath: 'f.tsx', elementId: 'e1', styles: {} } as never,
        wv as never,
      );
      expect(wv.messages[0]).toEqual(expect.objectContaining({ requestId: 'r9', success: false, error: 'parse fail' }));
    } finally {
      console.error = origError;
    }
  });

  it('sends to default webview when no target provided', async () => {
    const defaultWv = createMockWebview();
    bridge.setWebview(defaultWv as never);

    await bridge.handleMessage({
      type: 'ast:updateProps',
      requestId: 'r10',
      filePath: 'f',
      elementId: 'e',
      props: {},
    } as never);
    expect(defaultWv.messages).toHaveLength(1);
  });

  it('prefers target webview over default', async () => {
    const defaultWv = createMockWebview();
    const targetWv = createMockWebview();
    bridge.setWebview(defaultWv as never);

    await bridge.handleMessage(
      { type: 'ast:updateProps', requestId: 'r11', filePath: 'f', elementId: 'e', props: {} } as never,
      targetWv as never,
    );
    expect(targetWv.messages).toHaveLength(1);
    expect(defaultWv.messages).toHaveLength(0);
  });

  it('warns when no webview available', async () => {
    // No setWebview, no target — should not throw
    await bridge.handleMessage({
      type: 'ast:updateProps',
      requestId: 'r12',
      filePath: 'f',
      elementId: 'e',
      props: {},
    } as never);
    // Just verify it doesn't throw
  });

  // === Undo tracking tests (uses real UndoRedoService with mocked vscode) ===

  describe('undo tracking via handleMessage', () => {
    it('enables undo after successful ast:updateStyles with content change', async () => {
      // Setup: file content changes from 'before' to 'after' during the operation
      setupFileSnapshotsForPath('/workspace/f.tsx', 'before-content', 'after-content');

      const wv = createMockWebview();
      await bridge.handleMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r20',
          filePath: '/workspace/f.tsx',
          elementId: 'e1',
          styles: {},
        } as never,
        wv as never,
      );
      // Real UndoRedoService should now have an entry
      const panel = { reveal: mock(() => {}) } as never;
      const canUndo = await bridge.undo(panel);
      expect(canUndo).toBe(true);
    });

    it('does not enable undo on failed operation', async () => {
      mockAstService.updateProps.mockImplementation(() => Promise.resolve({ success: false, error: 'fail' }));
      setupFileSnapshotsForPath('/workspace/f.tsx', 'content', 'content');

      const wv = createMockWebview();
      await bridge.handleMessage(
        {
          type: 'ast:updateProps',
          requestId: 'r21',
          filePath: '/workspace/f.tsx',
          elementId: 'e1',
          props: {},
        } as never,
        wv as never,
      );
      const panel = { reveal: mock(() => {}) } as never;
      const canUndo = await bridge.undo(panel);
      expect(canUndo).toBe(false);
    });
  });

  describe('public mutation methods', () => {
    it('deleteElements delegates to astService and enables undo', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'before', 'after');
      const result = await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      expect(mockAstService.deleteElements).toHaveBeenCalledWith('/workspace/comp.tsx', ['e1']);
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });

    it('deleteElements with multiple elements records single undo entry', async () => {
      mockAstService.deleteElements.mockImplementation(() =>
        Promise.resolve({ success: true, data: { deletedCount: 3 } }),
      );
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'before', 'after');
      await bridge.deleteElements('/workspace/comp.tsx', ['e1', 'e2', 'e3']);
      const panel = { reveal: mock(() => {}) } as never;
      // Content-based: single undo entry captures the entire before/after diff
      expect(await bridge.undo(panel)).toBe(true);
      // Second undo should fail — only one snapshot entry
      expect(await bridge.undo(panel)).toBe(false);
    });

    it('deleteElements does not enable undo on failure', async () => {
      mockAstService.deleteElements.mockImplementation(() => Promise.resolve({ success: false }));
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'before', 'before');
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(false);
    });

    it('duplicateElement delegates and enables undo', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'before', 'after');
      const result = await bridge.duplicateElement('/workspace/comp.tsx', 'e1');
      expect(mockAstService.duplicateElement).toHaveBeenCalledWith('/workspace/comp.tsx', 'e1');
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });

    it('wrapElement delegates and enables undo', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'before', 'after');
      const result = await bridge.wrapElement('/workspace/comp.tsx', 'e1', 'div');
      expect(mockAstService.wrapElement).toHaveBeenCalledWith('/workspace/comp.tsx', 'e1', 'div');
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });

    it('pasteElement delegates and enables undo', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'before', 'after');
      const result = await bridge.pasteElement('/workspace/comp.tsx', 'target-1', '<div />');
      expect(mockAstService.pasteElement).toHaveBeenCalledWith('/workspace/comp.tsx', 'target-1', '<div />');
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });
  });

  describe('undo/redo delegation', () => {
    it('undo writes contentBefore via WorkspaceEdit', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'original', 'modified');
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;
      const result = await bridge.undo(panel);
      expect(result).toBe(true);
      // Should have used workspace.applyEdit (via UndoRedoService._writeContent)
      // instead of commands.executeCommand('undo')
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });

    it('redo writes contentAfter after undo', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'original', 'modified');
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;
      await bridge.undo(panel);
      (vscode.workspace.applyEdit as ReturnType<typeof mock>).mockClear();
      const result = await bridge.redo(panel);
      expect(result).toBe(true);
      expect(vscode.workspace.applyEdit).toHaveBeenCalled();
    });

    it('redo works after undo (content-based, not native VS Code redo)', async () => {
      setupFileSnapshotsForPath('/workspace/comp.tsx', 'v1', 'v2');
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;

      // Undo should work
      expect(await bridge.undo(panel)).toBe(true);
      // Redo should work — this is the key fix!
      expect(await bridge.redo(panel)).toBe(true);
      // Undo again should work (entry moved back to undo stack)
      expect(await bridge.undo(panel)).toBe(true);
    });
  });
});
