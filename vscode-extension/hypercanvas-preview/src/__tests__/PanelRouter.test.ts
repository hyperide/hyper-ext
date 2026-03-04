import { beforeEach, describe, expect, it, mock } from 'bun:test';

/**
 * PanelRouter test.
 *
 * We mock leaf dependencies (AstService, ComponentService, etc.)
 * but let AstBridge and EditorBridge stay real — this avoids
 * mock.module conflicts with their own test files (bun mock.module
 * is global and can't be scoped per-file).
 */

// Leaf mocks — these don't have their own test files that would conflict
mock.module('../services/AstService', () => ({
  AstService: class {
    updateStyles = mock(() => Promise.resolve({ success: true, className: 'c' }));
    updateProps = mock(() => Promise.resolve({ success: true }));
    insertElement = mock(() => Promise.resolve({ success: true, newId: 'n', index: 0 }));
    deleteElements = mock(() => Promise.resolve({ success: true, data: {} }));
    duplicateElement = mock(() => Promise.resolve({ success: true, newId: 'd' }));
    updateText = mock(() => Promise.resolve({ success: true }));
    wrapElement = mock(() => Promise.resolve({ success: true, wrapperId: 'w' }));
  },
}));
mock.module('../services/ComponentService', () => ({
  ComponentService: class {
    _root: string;
    _getApiKey: () => Promise<string | undefined>;
    constructor(root: string, getApiKey: () => Promise<string | undefined>) {
      this._root = root;
      this._getApiKey = getApiKey;
    }
    scanComponentGroups = mock(() => Promise.resolve({ data: [], needsSetup: false }));
    scanComponents = mock(() => Promise.resolve([]));
    scanComponentTests = mock(() => Promise.resolve([]));
    getComponent = mock(() => Promise.resolve(null));
    parseStructure = mock(() => Promise.resolve(null));
  },
}));
mock.module('../services/StyleReadService', () => ({
  StyleReadService: class {
    readElementClassName = mock(() => Promise.resolve({ className: 'test' }));
  },
}));
// VSCodeFileIO is NOT mocked — its constructor is a no-op and AstService/StyleReadService
// are mocked above, so VSCodeFileIO methods are never called. Mocking it with `class {}`
// would poison VSCodeFileIO.test.ts (mock.module is global).
mock.module('node:fs/promises', () => ({
  readFile: mock(() => Promise.resolve('file content')),
}));

const { PanelRouter } = await import('../PanelRouter');

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

function createMockStateHub() {
  return {
    applyUpdate: mock(),
    register: mock(),
    unregister: mock(),
    onChange: mock(() => () => {}),
    sendInit: mock(),
    dispose: mock(),
  };
}

function createMockContext() {
  return {
    secrets: {
      get: mock(() => Promise.resolve(undefined)),
      store: mock(() => Promise.resolve()),
      delete: mock(() => Promise.resolve()),
      onDidChange: mock(),
    },
  };
}

describe('PanelRouter', () => {
  let router: InstanceType<typeof PanelRouter>;
  let stateHub: ReturnType<typeof createMockStateHub>;

  beforeEach(() => {
    stateHub = createMockStateHub();
    router = new PanelRouter({
      workspaceRoot: '/test-workspace',
      stateHub: stateHub as never,
      context: createMockContext() as never,
    });
  });

  it('returns false for messages without type', async () => {
    const wv = createMockWebview();
    const handled = await router.routeMessage('p1', {}, wv as never);
    expect(handled).toBe(false);
  });

  it('routes state:update to stateHub', async () => {
    const wv = createMockWebview();
    const handled = await router.routeMessage('p1', { type: 'state:update', patch: { hoveredId: 'x' } }, wv as never);
    expect(handled).toBe(true);
    expect(stateHub.applyUpdate).toHaveBeenCalledWith('p1', { hoveredId: 'x' });
  });

  it('routes editor:* messages', async () => {
    const wv = createMockWebview();
    // editor:getActiveFile sends response back to webview
    const msg = { type: 'editor:getActiveFile', requestId: 'r1' };
    const handled = await router.routeMessage('p1', msg, wv as never);
    expect(handled).toBe(true);
    // Response goes to webview.postMessage
    expect(wv.messages[0]).toEqual(expect.objectContaining({ type: 'editor:activeFileChanged' }));
  });

  it('routes ast:* to AstBridge', async () => {
    const wv = createMockWebview();
    const msg = {
      type: 'ast:updateStyles',
      requestId: 'r1',
      filePath: 'f',
      elementId: 'e',
      styles: {},
    };
    const handled = await router.routeMessage('p1', msg, wv as never);
    expect(handled).toBe(true);
    // AstBridge sends response via webview.postMessage
    expect(wv.messages[0]).toEqual(expect.objectContaining({ type: 'ast:response', requestId: 'r1', success: true }));
  });

  it('routes ai:openChat and calls callback', async () => {
    const wv = createMockWebview();
    const cb = mock();
    router.setOnOpenAIChat(cb);

    await router.routeMessage('p1', { type: 'ai:openChat', prompt: 'fix button' }, wv as never);
    expect(cb).toHaveBeenCalledWith('fix button');
  });

  it('ignores ai:openChat without prompt', async () => {
    const wv = createMockWebview();
    const cb = mock();
    router.setOnOpenAIChat(cb);

    await router.routeMessage('p1', { type: 'ai:openChat' }, wv as never);
    expect(cb).not.toHaveBeenCalled();
  });

  it('routes command:execute to vscode.commands', async () => {
    const vscode = await import('vscode');
    const wv = createMockWebview();
    await router.routeMessage(
      'p1',
      { type: 'command:execute', command: 'workbench.action.files.save', args: [] },
      wv as never,
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.save');
  });

  it('routes component:listGroups and sends response', async () => {
    const wv = createMockWebview();
    await router.routeMessage('p1', { type: 'component:listGroups', requestId: 'r1' }, wv as never);
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({ type: 'component:response', requestId: 'r1', success: true }),
    );
  });

  it('routes file:read and returns file content', async () => {
    const wv = createMockWebview();
    await router.routeMessage('p1', { type: 'file:read', requestId: 'r2', filePath: 'src/App.tsx' }, wv as never);
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({
        type: 'file:response',
        requestId: 'r2',
        success: true,
        data: 'file content',
      }),
    );
  });

  it('routes styles:readClassName and returns result', async () => {
    const wv = createMockWebview();
    await router.routeMessage(
      'p1',
      { type: 'styles:readClassName', requestId: 'r3', elementId: 'e1', componentPath: 'c.tsx' },
      wv as never,
    );
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({ type: 'styles:response', requestId: 'r3', success: true }),
    );
  });

  it('returns false for unknown message types', async () => {
    const wv = createMockWebview();
    const handled = await router.routeMessage('p1', { type: 'unknown:stuff' }, wv as never);
    expect(handled).toBe(false);
  });

  it('setAstResponseTarget delegates to AstBridge', () => {
    const wv = createMockWebview();
    router.setAstResponseTarget(wv as never);
    // No crash — AstBridge.setWebview was called
  });
});
