import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { AstService } from '../services/AstService';
import type { ComponentService } from '../services/ComponentService';

/**
 * PanelRouter test.
 *
 * We feed PanelRouter fake leaf services (AstService, ComponentService) through
 * its constructor config — NOT mock.module. bun's mock.module is process-global
 * and irreversible (mock.restore does not undo it), so module-level mocks of
 * '../services/AstService' / '../services/ComponentService' here leaked the stubs
 * into those services' own tests under a non-isolated run, failing them (HYP-579).
 * Constructor injection keeps the fakes local. AstBridge and EditorBridge stay real.
 */

/** Fake AstService PanelRouter receives via config.astService. */
function createFakeAstService(): AstService {
  return {
    ensureInitialized: mock(() => Promise.resolve()),
    setVerifyComputedStyleProvider: mock(),
    updateStyles: mock(() => Promise.resolve({ success: true, className: 'c' })),
    updateProps: mock(() => Promise.resolve({ success: true })),
    insertElement: mock(() => Promise.resolve({ success: true, newId: 'n', index: 0 })),
    deleteElements: mock(() => Promise.resolve({ success: true, data: {} })),
    duplicateElement: mock(() => Promise.resolve({ success: true, newId: 'd' })),
    updateText: mock(() => Promise.resolve({ success: true })),
    wrapElement: mock(() => Promise.resolve({ success: true, wrapperId: 'w' })),
    get nodeMapService() {
      return {
        resolveNodeRef: () => null,
        resolveSourceLocation: () => null,
        getNodeMap: () => [],
        getTrackedFiles: () => [],
      };
    },
  } as unknown as AstService;
}

/** Fake ComponentService PanelRouter receives via config.componentService. */
function createFakeComponentService(): ComponentService {
  return {
    scanComponentGroups: mock(() => Promise.resolve({ data: [], needsSetup: false })),
    scanComponents: mock(() => Promise.resolve([])),
    scanComponentTests: mock(() => Promise.resolve([])),
    getComponent: mock(() => Promise.resolve(null)),
    parseStructure: mock(() => Promise.resolve(null)),
  } as unknown as ComponentService;
}

// StyleReadService is NOT mocked — it's a leaf class with its own test file (StyleReadService.test.ts).
// Mocking it here would poison that test file (bun mock.module is global). The injected AstService fake
// provides a nodeMapService returning nulls so StyleReadService yields empty results without file I/O.
// VSCodeFileIO is NOT mocked — its constructor is a no-op. The fs/promises mock below covers any read.
// Spread the real module so this global mock can't break other test files (AGENTS.md global-mock rule).
const realFsPromises = await import('node:fs/promises');
mock.module('node:fs/promises', () => ({
  ...realFsPromises,
  default: realFsPromises,
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
    state: { selectedItemIndices: {} as Record<string, number | null> },
    applyUpdate: mock(),
    register: mock(),
    unregister: mock(),
    onChange: mock(() => () => {}),
    sendInit: mock(),
    broadcast: mock(),
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
      astService: createFakeAstService(),
      componentService: createFakeComponentService(),
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

  // HYP-909 follow-up (review-diff on #622): getComponentGroups() must be the
  // single place that threads ComponentsData.monorepoRoot into AstBridge (→
  // UndoRedoService), on EVERY scan — both widening when a monorepoRoot is
  // present and narrowing back to null when it isn't (a stale root from a
  // previous scan must not survive a scan that no longer needs one).
  describe('getComponentGroups → AstBridge additional-workspace-root wiring', () => {
    it('threads monorepoRoot from a scan into AstBridge.setAdditionalWorkspaceRoot', async () => {
      const setAdditionalWorkspaceRootSpy = mock();
      router.astBridge.setAdditionalWorkspaceRoot = setAdditionalWorkspaceRootSpy;
      (router.componentService.scanComponentGroups as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve({
          data: { atomGroups: [], compositeGroups: [], pageGroups: [], monorepoRoot: '/monorepo' },
          needsSetup: false,
        }),
      );

      await router.getComponentGroups();

      expect(setAdditionalWorkspaceRootSpy).toHaveBeenCalledWith('/monorepo');
    });

    it('narrows back to null when a later scan has no monorepoRoot', async () => {
      const setAdditionalWorkspaceRootSpy = mock();
      router.astBridge.setAdditionalWorkspaceRoot = setAdditionalWorkspaceRootSpy;
      (router.componentService.scanComponentGroups as ReturnType<typeof mock>)
        .mockImplementationOnce(() =>
          Promise.resolve({
            data: { atomGroups: [], compositeGroups: [], pageGroups: [], monorepoRoot: '/monorepo' },
            needsSetup: false,
          }),
        )
        .mockImplementationOnce(() =>
          Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] }, needsSetup: false }),
        );

      await router.getComponentGroups();
      await router.getComponentGroups();

      expect(setAdditionalWorkspaceRootSpy).toHaveBeenNthCalledWith(1, '/monorepo');
      expect(setAdditionalWorkspaceRootSpy).toHaveBeenNthCalledWith(2, null);
    });

    it('also threads through the component:listGroups message path', async () => {
      const setAdditionalWorkspaceRootSpy = mock();
      router.astBridge.setAdditionalWorkspaceRoot = setAdditionalWorkspaceRootSpy;
      (router.componentService.scanComponentGroups as ReturnType<typeof mock>).mockImplementationOnce(() =>
        Promise.resolve({
          data: { atomGroups: [], compositeGroups: [], pageGroups: [], monorepoRoot: '/monorepo' },
          needsSetup: false,
        }),
      );
      const wv = createMockWebview();

      await router.routeMessage({ type: 'component:listGroups', requestId: 'r1' }, wv as never);

      expect(setAdditionalWorkspaceRootSpy).toHaveBeenCalledWith('/monorepo');
    });
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

  // HYP-544: live write-time className RPC. The color write originates in the
  // right-panel webview, which has no preview iframe of its own — so the inspector's
  // `getDOMClassesFromIframe` returns '' and `ast:updateStyles` arrives with
  // domClasses empty. Before executing the write, PanelRouter asks the preview-panel
  // (which owns the iframe) for the element's LIVE applied className and awaits it,
  // then threads it as the `domClasses` arg so the DOM-anchored twMerge escalation
  // can fire. No dependency on race-prone push-at-selection state.
  describe('live write-time className RPC (HYP-544)', () => {
    const updateStylesArgs = (r: typeof router) =>
      (r.astBridge.astService.updateStyles as ReturnType<typeof mock>).mock.calls.at(-1);

    it('fetches the live className from the provider and threads it into updateStyles when domClasses is empty', async () => {
      const provider = mock((_elementId: string) => Promise.resolve('px-6 py-4 rounded bg-blue-600'));
      router.setLiveClassNameProvider(provider);
      const wv = createMockWebview();

      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-live',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
        },
        wv as never,
      );

      expect(handled).toBe(true);
      expect(provider).toHaveBeenCalledWith('src/components/Card.tsx:9:2', null);
      // 7th positional arg of AstService.updateStyles is domClasses
      expect(updateStylesArgs(router)?.[6]).toBe('px-6 py-4 rounded bg-blue-600');
    });

    it('does NOT call the provider when domClasses is already populated (SaaS / same-realm read)', async () => {
      const provider = mock((_elementId: string) => Promise.resolve('should-not-be-used'));
      router.setLiveClassNameProvider(provider);
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-prefilled',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
          domClasses: 'p-2 bg-blue-600',
        },
        wv as never,
      );

      expect(provider).not.toHaveBeenCalled();
      expect(updateStylesArgs(router)?.[6]).toBe('p-2 bg-blue-600');
    });

    it('degrades gracefully when the provider returns null — write still fires with empty domClasses', async () => {
      const provider = mock((_elementId: string) => Promise.resolve(null));
      router.setLiveClassNameProvider(provider);
      const wv = createMockWebview();

      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-null',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
        },
        wv as never,
      );

      expect(handled).toBe(true);
      expect(provider).toHaveBeenCalled();
      // Write still proceeds (response posted), domClasses falls back to '' — committed
      // set-diff gate then no-ops and static AST behavior is preserved.
      expect(wv.messages[0]).toEqual(expect.objectContaining({ type: 'ast:response', success: true }));
      expect(updateStylesArgs(router)?.[6]).toBe('');
    });

    it('passes the PRE-re-root (iframe-relative) elementId to the provider in a monorepo', async () => {
      // _reRootMessage converts elementId to repo-relative for the AST write, but the
      // iframe's findElementsByRef matches the sub-project-relative id it emitted. The
      // RPC must use the raw id so the iframe lookup hits.
      router.setSubProjectPrefix('targets/conloca-app/');
      const provider = mock((_elementId: string) => Promise.resolve('bg-blue-600'));
      router.setLiveClassNameProvider(provider);
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-mono',
          filePath: 'src/app/page.tsx',
          elementId: 'src/app/page.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
        },
        wv as never,
      );

      // Provider gets the iframe-relative id, NOT the repo-relative one used for the write.
      expect(provider).toHaveBeenCalledWith('src/app/page.tsx:9:2', null);
      // The AST write still receives the re-rooted id.
      expect(updateStylesArgs(router)?.[1]).toBe('targets/conloca-app/src/app/page.tsx:9:2');
    });

    it('threads the iframe-relative verify id per call (not baked into the provider) in a monorepo', async () => {
      // HYP-987 P1 #3 — the write-verify provider installed on AstService is the STABLE,
      // id-agnostic RPC (no per-call elementId baked in, so two overlapping edits can't race a
      // shared-mutable binding). The iframe-relative (pre-re-root) id is threaded PER CALL through
      // handleMessage → updateStyles instead. AstService drives the AST write with the RE-ROOTED
      // id, but the preview iframe's findElementsByRef only knows the pre-re-root id, so the verify
      // must receive that one or the computed-style read resolves nothing and silently no-ops.
      router.setSubProjectPrefix('targets/conloca-app/');
      const underlying = mock((_id: string, cssProperties: string[]) =>
        Promise.resolve(Object.fromEntries(cssProperties.map((p) => [p, 'rgb(0, 0, 0)']))),
      );
      router.setVerifyComputedStyleProvider(underlying);
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-verify',
          filePath: 'src/app/page.tsx',
          elementId: 'src/app/page.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
        },
        wv as never,
      );

      // The provider installed on AstService is the raw, id-agnostic one — never a per-id closure.
      const setVerify = router.astBridge.astService.setVerifyComputedStyleProvider as ReturnType<typeof mock>;
      expect(setVerify.mock.calls.at(-1)?.[0]).toBe(underlying);

      // The AST write receives the RE-ROOTED id (arg 1); the verify receives the iframe-relative
      // id threaded as the trailing verifyElementId arg (arg 8).
      const args = updateStylesArgs(router);
      expect(args?.[1]).toBe('targets/conloca-app/src/app/page.tsx:9:2');
      expect(args?.[8]).toBe('src/app/page.tsx:9:2');
    });

    it('strips Vite @fs/ from a cross-package elementId when the sub-project prefix is empty', async () => {
      // Bug: a monorepo opened DIRECTLY at the sub-project/target root has an EMPTY
      // sub-project prefix. A cross-package library component (e.g. @conloca-mini/ui's
      // <Button>) is served by Vite from OUTSIDE that root via `@fs/<absolute>`, and that
      // URL leaks into the selected elementId. Element-ops strip `@fs/` unconditionally
      // (AstBridge public methods), but the style path went through _reRootMessage, which
      // used to early-return on an empty prefix and so left `@fs/` intact — the resolver
      // then prepended the target root (`<root>/@fs/...`) and the write 404'd with
      // "Element not found". The strip must run regardless of prefix.
      // No setSubProjectPrefix() call → prefix is empty (project opened at target root).
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-fs',
          filePath: 'src/app/HomeScreen.tsx',
          elementId: '@fs/Users/me/repo/packages/ui/src/Button.tsx:19:4',
          styles: { borderRadius: '24px' },
        },
        wv as never,
      );

      // The AST write must receive the recovered absolute path, NOT the raw `@fs/` URL.
      expect(updateStylesArgs(router)?.[1]).toBe('/Users/me/repo/packages/ui/src/Button.tsx:19:4');
    });

    it('leaves an in-project elementId byte-identical when the prefix is empty (no regression)', async () => {
      // Regression guard: removing the empty-prefix early-return must not alter in-project
      // ids. stripViteFsPrefix is a no-op on non-@fs paths and toRepoRelativeElementId
      // returns the original string when nothing changed.
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-inproj',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { borderRadius: '24px' },
        },
        wv as never,
      );

      expect(updateStylesArgs(router)?.[0]).toBe('src/components/Card.tsx');
      expect(updateStylesArgs(router)?.[1]).toBe('src/components/Card.tsx:9:2');
    });

    it('threads the selected item index (repeated .map() site) to the provider', async () => {
      // At a repeated JSX site the selected occurrence is N>0; the iframe must read the live
      // class off that instance, not always index 0. PanelRouter sources the index from
      // StateHub.selectedItemIndices keyed by the iframe-relative elementId.
      stateHub.state.selectedItemIndices = { 'src/List.tsx:12:6': 2 };
      const provider = mock((_elementId: string, _itemIndex?: number | null) => Promise.resolve('bg-blue-600'));
      router.setLiveClassNameProvider(provider);
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-item',
          filePath: 'src/List.tsx',
          elementId: 'src/List.tsx:12:6',
          styles: { backgroundColor: '#dc2626' },
        },
        wv as never,
      );

      expect(provider).toHaveBeenCalledWith('src/List.tsx:12:6', 2);
    });

    it('skips the RPC when no provider is wired (SaaS / no preview panel)', async () => {
      const wv = createMockWebview();
      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-noprovider',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
        },
        wv as never,
      );
      expect(handled).toBe(true);
      // No provider → no RPC; domClasses stays empty (undefined), the committed gate no-ops.
      expect(updateStylesArgs(router)?.[6]).toBeFalsy();
    });
  });

  // HYP-544 Phase 3: empirical color-probe RPC. When a same-group color is actually applied
  // (live domClasses carries a conflicting class for the changed property) but the source can't
  // be statically resolved, PanelRouter asks the preview-panel iframe which candidate token
  // drives the color, then threads the ranked driving list as the 8th arg of updateStyles. The
  // executor consumes it only in the case-(c) branch (inline/var/module → inline-style override).
  describe('empirical color-probe RPC (HYP-544 Phase 3)', () => {
    const updateStylesArgs = (r: typeof router) =>
      (r.astBridge.astService.updateStyles as ReturnType<typeof mock>).mock.calls.at(-1);

    const driving = [{ kind: 'css-var' as const, token: '--brand', locationHint: 'computed' }];

    it('fires the probe and threads driving candidates when a live same-group conflict exists', async () => {
      const probe = mock(() => Promise.resolve(driving));
      router.setColorProbeProvider(probe);
      const wv = createMockWebview();

      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-probe',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
          domClasses: 'p-2 bg-blue-600', // live same-group bg-* conflict
        },
        wv as never,
      );

      expect(handled).toBe(true);
      expect(probe).toHaveBeenCalledTimes(1);
      // The probe request carries the conflict prefixes, requested color, and css prop.
      const req = probe.mock.calls[0][0] as {
        elementId: string;
        cssProp: string;
        requestedColor: string;
        prefixes: string[];
        requestClass?: string;
      };
      expect(req.elementId).toBe('src/components/Card.tsx:9:2');
      expect(req.cssProp).toBe('backgroundColor');
      expect(req.requestedColor).toBe('#dc2626');
      expect(req.prefixes.some((p) => p.startsWith('bg-'))).toBe(true);
      // codex P2: the host supplies the Tailwind class that paints the requested color, so the iframe
      // probe can verify tailwind-class / hashed-module-class drivers (swap it in on the clone).
      expect(req.requestClass).toMatch(/^bg-/);
      // 8th positional arg of AstService.updateStyles is probeDriving.
      expect(updateStylesArgs(router)?.[7]).toEqual(driving);
    });

    it('does NOT fire the probe when the live DOM shows no same-group conflict class', async () => {
      const probe = mock(() => Promise.resolve(driving));
      router.setColorProbeProvider(probe);
      const wv = createMockWebview();

      await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-noconflict',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
          domClasses: 'p-2 text-white', // no bg-* — nothing to probe
        },
        wv as never,
      );

      expect(probe).not.toHaveBeenCalled();
      expect(updateStylesArgs(router)?.[7]).toBeFalsy();
    });

    it('does NOT thread anything when the probe finds no driving candidate (degrades to floor)', async () => {
      const probe = mock(() => Promise.resolve([]));
      router.setColorProbeProvider(probe);
      const wv = createMockWebview();

      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-empty',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
          domClasses: 'p-2 bg-blue-600',
        },
        wv as never,
      );

      expect(handled).toBe(true);
      expect(probe).toHaveBeenCalledTimes(1);
      expect(updateStylesArgs(router)?.[7]).toBeFalsy();
    });

    it('degrades gracefully when the probe provider throws — write still fires', async () => {
      const probe = mock(() => Promise.reject(new Error('iframe gone')));
      router.setColorProbeProvider(probe);
      const wv = createMockWebview();

      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-throw',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
          domClasses: 'p-2 bg-blue-600',
        },
        wv as never,
      );

      expect(handled).toBe(true);
      expect(wv.messages[0]).toEqual(expect.objectContaining({ type: 'ast:response', success: true }));
      expect(updateStylesArgs(router)?.[7]).toBeFalsy();
    });

    it('skips the probe when no provider is wired (SaaS / no preview panel)', async () => {
      const wv = createMockWebview();
      const handled = await router.routeMessage(
        {
          type: 'ast:updateStyles',
          requestId: 'r-noprobe',
          filePath: 'src/components/Card.tsx',
          elementId: 'src/components/Card.tsx:9:2',
          styles: { backgroundColor: '#dc2626' },
          domClasses: 'p-2 bg-blue-600',
        },
        wv as never,
      );
      expect(handled).toBe(true);
      expect(updateStylesArgs(router)?.[7]).toBeFalsy();
    });
  });

  // HYP-435: PanelRouter is the single shared ingress for ast:/editor:/styles:
  // messages from BOTH the preview and right-sidebar panels. For a monorepo
  // opened at the repo root it re-roots the sub-project-relative paths the iframe
  // emits to repo-relative, once, for every consumer.
  describe('monorepo sub-project path re-rooting', () => {
    type ReRoot = (m: unknown) => { type?: string; [k: string]: unknown };
    const reRoot = (r: typeof router) => (m: unknown) => (r as unknown as { _reRootMessage: ReRoot })._reRootMessage(m);

    it('re-roots ast:* filePath + element-id fields', () => {
      router.setSubProjectPrefix('targets/conloca-app/');
      const out = reRoot(router)({
        type: 'ast:moveElement',
        filePath: 'src/app/page.tsx',
        sourceId: 'src/app/page.tsx:3:1',
        targetId: 'src/app/page.tsx:9:1',
      });
      expect(out.filePath).toBe('targets/conloca-app/src/app/page.tsx');
      expect(out.sourceId).toBe('targets/conloca-app/src/app/page.tsx:3:1');
      expect(out.targetId).toBe('targets/conloca-app/src/app/page.tsx:9:1');
    });

    it('re-roots editor:goToCode path (Go-to-Code navigation)', () => {
      router.setSubProjectPrefix('targets/conloca-app/');
      const out = reRoot(router)({ type: 'editor:goToCode', path: 'src/app/ui/Row.tsx', line: 4, column: 2 });
      expect(out.path).toBe('targets/conloca-app/src/app/ui/Row.tsx');
      expect(out.line).toBe(4);
    });

    it('re-roots styles:readClassName elementId + componentPath (inspector read)', () => {
      router.setSubProjectPrefix('targets/conloca-app/');
      const out = reRoot(router)({
        type: 'styles:readClassName',
        requestId: 'r1',
        elementId: 'src/app/page.tsx:9:2',
        componentPath: 'src/app/page.tsx',
      });
      expect(out.elementId).toBe('targets/conloca-app/src/app/page.tsx:9:2');
      expect(out.componentPath).toBe('targets/conloca-app/src/app/page.tsx');
    });

    it('strips Vite @fs/ from styles:readClassName fields on an empty prefix (inspector style READ)', () => {
      // The READ half of the cross-package regression: StyleReadService.readElementClassName
      // got the raw `@fs/` id/path and failed with ENOENT (`<root>/@fs/...`). The empty-prefix
      // strip must recover the absolute path for the read just like for the write.
      router.setSubProjectPrefix('');
      const out = reRoot(router)({
        type: 'styles:readClassName',
        requestId: 'r-fs-read',
        elementId: '@fs/Users/me/repo/packages/ui/src/Button.tsx:19:4',
        componentPath: '@fs/Users/me/repo/packages/ui/src/Button.tsx',
      });
      expect(out.elementId).toBe('/Users/me/repo/packages/ui/src/Button.tsx:19:4');
      expect(out.componentPath).toBe('/Users/me/repo/packages/ui/src/Button.tsx');
    });

    it('does not double-prefix an already repo-relative path', () => {
      router.setSubProjectPrefix('targets/conloca-app/');
      const out = reRoot(router)({ type: 'editor:openFile', path: 'targets/conloca-app/src/app/page.tsx' });
      expect(out.path).toBe('targets/conloca-app/src/app/page.tsx');
    });

    it('preserves in-project path VALUES on an empty prefix but still strips Vite @fs/', () => {
      // Single-package projects (and monorepos opened at the sub-project/target root)
      // have an empty prefix. The prefix-prepending is then a no-op — an in-project path
      // keeps its VALUE — but the prefix-INDEPENDENT `@fs/` strip must still run so a
      // cross-package library path resolves. (Reference identity is no longer guaranteed
      // for handled message families; only the VALUE contract matters.)
      router.setSubProjectPrefix('');
      const inProject = reRoot(router)({ type: 'editor:goToCode', path: 'src/App.tsx', line: 1, column: 1 });
      expect(inProject.path).toBe('src/App.tsx');
      expect(inProject.line).toBe(1);

      const crossPackage = reRoot(router)({
        type: 'editor:goToCode',
        path: '@fs/Users/me/repo/packages/ui/src/Button.tsx',
      });
      expect(crossPackage.path).toBe('/Users/me/repo/packages/ui/src/Button.tsx');
    });

    it('leaves unrelated message types untouched', () => {
      router.setSubProjectPrefix('targets/conloca-app/');
      const msg = { type: 'state:update', patch: { hoveredId: 'src/app/page.tsx:1:1' } };
      expect(reRoot(router)(msg)).toBe(msg);
    });
  });
});
