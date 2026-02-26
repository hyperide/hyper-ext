import { beforeEach, describe, expect, it, mock } from 'bun:test';

// Mock AstService — we test the bridge routing, not AST logic
const mockAstService = {
  updateStyles: mock(() => Promise.resolve({ success: true, className: 'text-red' })),
  updateProps: mock(() => Promise.resolve({ success: true })),
  insertElement: mock(() => Promise.resolve({ success: true, newId: 'new-1', index: 0 })),
  deleteElements: mock(() => Promise.resolve({ success: true, data: { deleted: ['e1'] } })),
  duplicateElement: mock(() => Promise.resolve({ success: true, newId: 'dup-1' })),
  updateText: mock(() => Promise.resolve({ success: true })),
  wrapElement: mock(() => Promise.resolve({ success: true, wrapperId: 'wrap-1' })),
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
  },
}));
mock.module('../vscode-file-io', () => ({
  VSCodeFileIO: class {},
}));

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
});
