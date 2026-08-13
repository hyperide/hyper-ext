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
    ensureInitialized = mock(() => Promise.resolve());
    updateStyles = mock(() => Promise.resolve({ success: true, className: 'c' }));
    updateProps = mock(() => Promise.resolve({ success: true }));
    insertElement = mock(() => Promise.resolve({ success: true, newId: 'n', index: 0 }));
    deleteElements = mock(() => Promise.resolve({ success: true, data: {} }));
    duplicateElement = mock(() => Promise.resolve({ success: true, newId: 'd' }));
    updateText = mock(() => Promise.resolve({ success: true }));
    wrapElement = mock(() => Promise.resolve({ success: true, wrapperId: 'w' }));
    get nodeMapService() {
      return { resolveNodeRef: () => null, resolveSourceLocation: () => null };
    }
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
  parseComponentSource: () => null,
}));
// StyleReadService is NOT mocked — it's a leaf class with its own test file (StyleReadService.test.ts).
// Mocking it here would poison that test file (bun mock.module is global).
// AstService mock above provides nodeMapService returning null so StyleReadService
// returns empty results without file I/O.
// VSCodeFileIO is NOT mocked — its constructor is a no-op and AstService resolves
// before VSCodeFileIO.readFile is reached. Mocking it with `class {}` would poison
// VSCodeFileIO.test.ts (mock.module is global).
mock.module('node:fs/promises', () => ({
  readFile: mock(() => Promise.resolve('file content')),
  mkdir: mock(() => Promise.resolve(undefined)),
  writeFile: mock(() => Promise.resolve(undefined)),
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
    broadcast: mock(),
    broadcastTracingMessage: mock(),
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
    const handled = await router.routeMessage({}, wv as never);
    expect(handled).toBe(false);
  });

  it('routes state:update to stateHub', async () => {
    const wv = createMockWebview();
    const handled = await router.routeMessage({ type: 'state:update', patch: { hoveredId: 'x' } }, wv as never);
    expect(handled).toBe(true);
    expect(stateHub.applyUpdate).toHaveBeenCalledWith({ hoveredId: 'x' });
  });

  it('broadcasts iframe:scrollToElement through stateHub instead of echoing to sender', async () => {
    // Regression: prior implementation called webview.postMessage(message) which only
    // echoed back to the sending panel (LeftPanel webview). The PreviewPanel webview
    // — where the iframe lives — never received the scroll message. Fixed by routing
    // through StateHub.broadcast which posts to every registered panel.
    const wv = createMockWebview();
    const message = { type: 'iframe:scrollToElement', elementId: '/src/App.tsx:42:8' };
    const handled = await router.routeMessage(message, wv as never);
    expect(handled).toBe(true);
    expect(stateHub.broadcast).toHaveBeenCalledWith(message);
    // Sender no longer receives a direct echo — the broadcast reaches it via StateHub.
    expect(wv.messages).toHaveLength(0);
  });

  it('routes editor:* messages', async () => {
    const wv = createMockWebview();
    // editor:getActiveFile sends response back to webview
    const msg = { type: 'editor:getActiveFile', requestId: 'r1' };
    const handled = await router.routeMessage(msg, wv as never);
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
    const handled = await router.routeMessage(msg, wv as never);
    expect(handled).toBe(true);
    // AstBridge sends response via webview.postMessage
    expect(wv.messages[0]).toEqual(expect.objectContaining({ type: 'ast:response', requestId: 'r1', success: true }));
  });

  it('routes ai:openChat and calls callback', async () => {
    const wv = createMockWebview();
    const cb = mock();
    router.setOnOpenAIChat(cb);

    await router.routeMessage({ type: 'ai:openChat', prompt: 'fix button' }, wv as never);
    expect(cb).toHaveBeenCalledWith('fix button');
  });

  it('ignores ai:openChat without prompt', async () => {
    const wv = createMockWebview();
    const cb = mock();
    router.setOnOpenAIChat(cb);

    await router.routeMessage({ type: 'ai:openChat' }, wv as never);
    expect(cb).not.toHaveBeenCalled();
  });

  it('routes command:execute to vscode.commands', async () => {
    const vscode = await import('vscode');
    const wv = createMockWebview();
    await router.routeMessage(
      { type: 'command:execute', command: 'workbench.action.files.save', args: [] },
      wv as never,
    );
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.save');
  });

  it('routes component:listGroups and sends response', async () => {
    const wv = createMockWebview();
    await router.routeMessage({ type: 'component:listGroups', requestId: 'r1' }, wv as never);
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({ type: 'component:response', requestId: 'r1', success: true }),
    );
  });

  it('routes file:read and returns file content', async () => {
    const wv = createMockWebview();
    await router.routeMessage({ type: 'file:read', requestId: 'r2', filePath: 'src/App.tsx' }, wv as never);
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
      { type: 'styles:readClassName', requestId: 'r3', elementId: 'e1', componentPath: 'c.tsx' },
      wv as never,
    );
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({ type: 'styles:response', requestId: 'r3', success: true }),
    );
  });

  it('routes styles:fetchI18nKeys and returns keys response', async () => {
    const wv = createMockWebview();
    await router.routeMessage(
      {
        type: 'styles:fetchI18nKeys',
        requestId: 'r-keys',
        library: 'react-i18next',
        namespace: undefined,
        activeLocale: 'en',
      },
      wv as never,
    );
    expect(wv.messages[0]).toEqual(
      expect.objectContaining({
        type: 'styles:i18nKeysResponse',
        requestId: 'r-keys',
        success: true,
        keys: [],
      }),
    );
  });

  it('returns false for unknown message types', async () => {
    const wv = createMockWebview();
    const handled = await router.routeMessage({ type: 'unknown:stuff' }, wv as never);
    expect(handled).toBe(false);
  });

  it('setAstResponseTarget sets default webview for unsolicited AstBridge responses', async () => {
    const target = createMockWebview();
    router.setAstResponseTarget(target as never);
    // Route directly through AstBridge without a target webview — response must go to the set target
    await router.astBridge.handleMessage({
      type: 'ast:updateStyles',
      requestId: 'r-target',
      filePath: 'f',
      elementId: 'e',
      styles: {},
    });
    expect(target.messages[0]).toEqual(expect.objectContaining({ type: 'ast:response', requestId: 'r-target' }));
  });

  describe('hypercanvas:resolveServerSourceMap (Approach B)', () => {
    it('returns serverSourceMapResult with null when readFile returns invalid JSON', async () => {
      // Default mock returns 'file content' which is not valid JSON → JSON.parse throws
      const wv = createMockWebview();
      await router.routeMessage(
        { type: 'hypercanvas:resolveServerSourceMap', filePath: '/project/.next/server/hash.js', line: 1, col: 50 },
        wv as never,
      );
      expect(wv.messages[0]).toEqual(
        expect.objectContaining({
          type: 'serverSourceMapResult',
          filePath: '/project/.next/server/hash.js',
          line: 1,
          col: 50,
          result: null,
        }),
      );
    });

    it('returns serverSourceMapResult with resolved location when source map is valid', async () => {
      // Minimal source map: genLine=1, genCol=0 → srcIdx=0, srcLine=4, srcCol=2
      // VLQ encode: 0,0,4,2 → "AAIE" (A=VLQ(0), A=VLQ(0), I=VLQ(4), E=VLQ(2))
      const sourceMap = JSON.stringify({ sources: ['src/Page.tsx'], mappings: 'AAIE' });
      const { readFile } = await import('node:fs/promises');
      (readFile as ReturnType<typeof mock>).mockImplementationOnce(() => Promise.resolve(sourceMap));

      const wv = createMockWebview();
      await router.routeMessage(
        { type: 'hypercanvas:resolveServerSourceMap', filePath: '/project/.next/server/hash.js', line: 1, col: 1 },
        wv as never,
      );
      expect(wv.messages[0]).toEqual(
        expect.objectContaining({
          type: 'serverSourceMapResult',
          result: expect.objectContaining({ fileName: 'src/Page.tsx', line: 5, column: 2 }),
        }),
      );
    });

    it('returns serverSourceMapResult with null when file does not exist', async () => {
      const { readFile } = await import('node:fs/promises');
      (readFile as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.reject(new Error('ENOENT: no such file')),
      );

      const wv = createMockWebview();
      await router.routeMessage(
        { type: 'hypercanvas:resolveServerSourceMap', filePath: '/project/.next/server/missing.js', line: 1, col: 1 },
        wv as never,
      );
      expect(wv.messages[0]).toEqual(expect.objectContaining({ type: 'serverSourceMapResult', result: null }));
    });
  });
});
