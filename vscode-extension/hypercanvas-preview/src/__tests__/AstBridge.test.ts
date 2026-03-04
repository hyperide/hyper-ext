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
// so VSCodeFileIO methods are never called. Mocking it with `class {}` would poison
// VSCodeFileIO.test.ts (mock.module is global).

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
    mockAstService.updateStyles.mockImplementation(() => Promise.reject(new Error('parse fail')));
    const wv = createMockWebview();
    await bridge.handleMessage(
      { type: 'ast:updateStyles', requestId: 'r9', filePath: 'f.tsx', elementId: 'e1', styles: {} } as never,
      wv as never,
    );
    expect(wv.messages[0]).toEqual(expect.objectContaining({ requestId: 'r9', success: false, error: 'parse fail' }));
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
    it('enables undo after successful ast:updateStyles', async () => {
      const wv = createMockWebview();
      // filePath must resolve inside /workspace for recordEdit to accept it
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
      const result = await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      expect(mockAstService.deleteElements).toHaveBeenCalledWith('/workspace/comp.tsx', ['e1']);
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });

    it('deleteElements with multiple elements records N undo entries', async () => {
      mockAstService.deleteElements.mockImplementation(() =>
        Promise.resolve({ success: true, data: { deletedCount: 3 } }),
      );
      await bridge.deleteElements('/workspace/comp.tsx', ['e1', 'e2', 'e3']);
      const panel = { reveal: mock(() => {}) } as never;
      // Should be able to undo 3 times (one per deleted element / write)
      expect(await bridge.undo(panel)).toBe(true);
      expect(await bridge.undo(panel)).toBe(true);
      expect(await bridge.undo(panel)).toBe(true);
      // 4th undo should fail — stack exhausted
      expect(await bridge.undo(panel)).toBe(false);
    });

    it('deleteElements does not enable undo on failure', async () => {
      mockAstService.deleteElements.mockImplementation(() => Promise.resolve({ success: false }));
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(false);
    });

    it('duplicateElement delegates and enables undo', async () => {
      const result = await bridge.duplicateElement('/workspace/comp.tsx', 'e1');
      expect(mockAstService.duplicateElement).toHaveBeenCalledWith('/workspace/comp.tsx', 'e1');
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });

    it('wrapElement delegates and enables undo', async () => {
      const result = await bridge.wrapElement('/workspace/comp.tsx', 'e1', 'div');
      expect(mockAstService.wrapElement).toHaveBeenCalledWith('/workspace/comp.tsx', 'e1', 'div');
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });

    it('pasteElement delegates and enables undo', async () => {
      const result = await bridge.pasteElement('/workspace/comp.tsx', 'target-1', '<div />');
      expect(mockAstService.pasteElement).toHaveBeenCalledWith('/workspace/comp.tsx', 'target-1', '<div />');
      expect(result.success).toBe(true);
      const panel = { reveal: mock(() => {}) } as never;
      expect(await bridge.undo(panel)).toBe(true);
    });
  });

  describe('undo/redo delegation', () => {
    it('undo executes vscode undo command', async () => {
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;
      const result = await bridge.undo(panel);
      expect(result).toBe(true);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('undo');
    });

    it('redo executes vscode redo command after undo', async () => {
      await bridge.deleteElements('/workspace/comp.tsx', ['e1']);
      const panel = { reveal: mock(() => {}) } as never;
      await bridge.undo(panel);
      (vscode.commands.executeCommand as ReturnType<typeof mock>).mockClear();
      const result = await bridge.redo(panel);
      expect(result).toBe(true);
      expect(vscode.commands.executeCommand).toHaveBeenCalledWith('redo');
    });
  });
});
