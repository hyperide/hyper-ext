/**
 * @file PreviewPanel component selection synchronization tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewPanel.test.ts
 * Assumptions: iframe navigation happens only after preview generation finishes.
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import type { PanelRouter } from '../PanelRouter';
import { normalizeSampleComponentName, PreviewPanel } from '../PreviewPanel';
import type { StateHub } from '../StateHub';

interface MockStateHubState {
  currentComponent: { name: string; path: string } | null;
  insertTargetId: string | null;
  selectedIds: string[];
}

function createStateHub(initial: MockStateHubState['currentComponent'] = null) {
  const state: MockStateHubState = {
    currentComponent: initial,
    insertTargetId: null,
    selectedIds: [],
  };
  return {
    state,
    applyUpdate: mock((patch: Partial<MockStateHubState>) => {
      Object.assign(state, patch);
    }),
  };
}

function createPanel(stateHub: ReturnType<typeof createStateHub>) {
  Object.assign(vscode.workspace, {
    workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
  });
  const panel = new PreviewPanel(
    vscode.Uri.file('/extension'),
    '/workspace',
    stateHub as StateHub,
    {
      setSubProjectPrefix: mock(() => {}),
      astBridge: { setSubProjectPrefix: mock(() => {}) },
    } as unknown as PanelRouter,
    {} as vscode.ExtensionContext,
  );
  const postMessage = mock(() => Promise.resolve(true));
  const dispose = mock(() => {});
  Object.assign(panel as PreviewPanel & { _devServerRunning: boolean; _panel: unknown }, {
    _devServerRunning: true,
    _panel: { dispose, webview: { postMessage } },
  });
  return { dispose, panel, postMessage };
}

function createEditor(path: string): vscode.TextEditor {
  return {
    document: {
      uri: vscode.Uri.file(path),
    },
  } as vscode.TextEditor;
}

interface MockPreviewWebview {
  options: unknown;
  htmlWrites: string[];
  postMessage: ReturnType<typeof mock>;
  onDidReceiveMessage: (handler: (message: { type?: string }) => void) => { dispose: () => void };
  asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
  fireMessage: (message: { type?: string }) => void;
}

function createMockPreviewWebviewPanel(options: { onHtmlWrite?: (webview: MockPreviewWebview) => void } = {}) {
  const messageHandlers: Array<(message: { type?: string }) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const webview = {
    options: {},
    htmlWrites: [] as string[],
    postMessage: mock(() => Promise.resolve(true)),
    onDidReceiveMessage(handler: (message: { type?: string }) => void) {
      messageHandlers.push(handler);
      return { dispose: mock() };
    },
    asWebviewUri(uri: vscode.Uri) {
      return uri;
    },
    fireMessage(message: { type?: string }) {
      for (const handler of messageHandlers) handler(message);
    },
  };

  Object.defineProperty(webview, 'html', {
    get() {
      return webview.htmlWrites.at(-1) ?? '';
    },
    set(value: string) {
      webview.htmlWrites.push(value);
      options.onHtmlWrite?.(webview);
    },
  });

  const panel = {
    webview,
    reveal: mock(),
    dispose: mock(() => {
      for (const handler of disposeHandlers) handler();
    }),
    onDidDispose(handler: () => void) {
      disposeHandlers.push(handler);
      return { dispose: mock() };
    },
  };
  return panel;
}

describe('PreviewPanel component selection', () => {
  it('normalizes path-like sample component names to JSX-safe identifiers', () => {
    expect(normalizeSampleComponentName('components/Sidebar.tsx')).toBe('Sidebar');
    expect(normalizeSampleComponentName('src/components/user-card.tsx')).toBe('UserCard');
    expect(normalizeSampleComponentName('App')).toBe('App');
  });

  it('does not navigate the iframe before preview generation completes', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    (panel as PreviewPanel & { _initializeComponent: (editor: vscode.TextEditor) => void })._initializeComponent(
      createEditor('/workspace/src/App.tsx'),
    );

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      currentComponent: { name: 'App', path: 'src/App.tsx' },
    });
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('does not re-emit the same current component from an existing preview panel', () => {
    const stateHub = createStateHub({ name: 'App', path: 'src/App.tsx' });
    const { panel, postMessage } = createPanel(stateHub);

    (panel as PreviewPanel & { _initializeComponent: (editor: vscode.TextEditor) => void })._initializeComponent(
      createEditor('/workspace/src/App.tsx'),
    );

    expect(stateHub.applyUpdate).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
  });

  it('falls back to a visible component editor when active editor is unavailable', () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);
    vscode.window.activeTextEditor = undefined;
    Object.assign(vscode.window, { visibleTextEditors: [createEditor('/workspace/src/App.tsx')] });

    (panel as PreviewPanel & { _initializeComponent: () => void })._initializeComponent();

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      currentComponent: { name: 'App', path: 'src/App.tsx' },
    });
  });

  it('falls back to an open text tab when VS Code has no active text editor', () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);
    vscode.window.activeTextEditor = undefined;
    Object.assign(vscode.window, { visibleTextEditors: [] });
    Object.assign(vscode.window, {
      tabGroups: {
        all: [
          {
            tabs: [
              {
                input: new vscode.TabInputText(vscode.Uri.file('/workspace/src/App.tsx')),
              },
            ],
          },
        ],
      },
    });

    (panel as PreviewPanel & { _initializeComponent: () => void })._initializeComponent();

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      currentComponent: { name: 'App', path: 'src/App.tsx' },
    });
  });

  it('resolves components against the current VS Code workspace after project switch', () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: vscode.Uri.file('/next-workspace'), name: 'next', index: 0 }],
    });

    (panel as PreviewPanel & { _initializeComponent: (editor: vscode.TextEditor) => void })._initializeComponent(
      createEditor('/next-workspace/App.tsx'),
    );

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      currentComponent: { name: 'App', path: 'App.tsx' },
    });
  });

  it('clears shared selection when disposing the preview panel', () => {
    const stateHub = createStateHub();
    stateHub.state.selectedIds = ['src/components/Feed.tsx:13:8'];
    stateHub.state.insertTargetId = 'src/components/Feed.tsx:13:8';
    const { dispose, panel } = createPanel(stateHub);

    panel.dispose();

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      insertTargetId: null,
      selectedIds: [],
    });
    expect(dispose).toHaveBeenCalled();
  });

  it('requires preview regeneration again after disposing the preview panel', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string; _navigableComponent: string }, {
      _currentComponent: 'src/App.tsx',
      _navigableComponent: 'src/App.tsx',
    });

    panel.dispose();
    (panel as PreviewPanel & { _pushFullStateToWebview: () => void })._pushFullStateToWebview();

    const calls = postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).not.toContain('setComponent');
    expect(calls).not.toContain('updateUrl');
  });

  it('re-emits the same current component once after preview panel disposal', () => {
    const stateHub = createStateHub({ name: 'App', path: 'src/App.tsx' });
    const { panel } = createPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string; _navigableComponent: string }, {
      _currentComponent: 'src/App.tsx',
      _navigableComponent: 'src/App.tsx',
    });

    panel.dispose();
    stateHub.applyUpdate.mockClear();
    (panel as PreviewPanel & { _initializeComponent: (editor: vscode.TextEditor) => void })._initializeComponent(
      createEditor('/workspace/src/App.tsx'),
    );

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      currentComponent: { name: 'App', path: 'src/App.tsx' },
    });
  });

  it('does not overwrite an already-set currentComponent when re-attaching panel', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    // Simulate a panel that was previously initialized with a component:
    // user picked "src/components/Feed.tsx", then closed and reopened the tab.
    // The active editor at reopen is unrelated to the previewed component.
    Object.assign(panel as PreviewPanel & { _currentComponent: string }, {
      _currentComponent: 'src/components/Feed.tsx',
    });

    (panel as PreviewPanel & { _initializeComponent: (editor: vscode.TextEditor) => void })._initializeComponent(
      createEditor('/workspace/src/App.tsx'),
    );

    // Component must NOT be re-derived from editor — preserved from previous session.
    expect((panel as PreviewPanel & { _currentComponent?: string })._currentComponent).toBe('src/components/Feed.tsx');
    expect(stateHub.applyUpdate).not.toHaveBeenCalledWith(
      expect.objectContaining({ currentComponent: { name: 'App', path: 'src/App.tsx' } }),
    );
    // Pending component state is preserved locally, but iframe navigation waits for setComponentParam().
    const calls = postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).not.toContain('setComponent');
  });

  it('_pushFullStateToWebview emits devserver/projectError/setComponent/url for prepared component', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    Object.assign(
      panel as PreviewPanel & { _currentComponent: string; _navigableComponent: string; _projectError: unknown },
      {
        _currentComponent: 'src/App.tsx',
        _navigableComponent: 'src/App.tsx',
        _projectError: { kind: 'react-native', detail: 'no react-native-web' },
        _previewBaseUrl: 'http://localhost:5173',
      },
    );

    (panel as PreviewPanel & { _pushFullStateToWebview: () => void })._pushFullStateToWebview();

    expect(postMessage).toHaveBeenCalledWith({
      type: 'devserver:statusChanged',
      running: true,
      url: 'http://localhost:5173',
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'projectError',
      error: { kind: 'react-native', detail: 'no react-native-web' },
    });
    expect(postMessage).toHaveBeenCalledWith({
      type: 'setComponent',
      component: 'src/App.tsx',
    });
    // _updatePreviewUrl posts updateUrl when devServerRunning
    expect(postMessage).toHaveBeenCalledWith({
      type: 'updateUrl',
      url: 'http://localhost:5173/test-preview?component=src%2FApp.tsx',
    });
  });

  it('does not push component navigation state until the component is prepared', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    Object.assign(panel as PreviewPanel & { _currentComponent: string; _previewBaseUrl: string }, {
      _currentComponent: 'src/App.tsx',
      _previewBaseUrl: 'http://localhost:5173',
    });

    (panel as PreviewPanel & { _pushFullStateToWebview: () => void })._pushFullStateToWebview();

    const calls = postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).not.toContain('setComponent');
    expect(calls).not.toContain('updateUrl');
  });

  it('waits for setComponentParam before navigating after dev server starts', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    Object.assign(panel as PreviewPanel & { _currentComponent: string; _devServerRunning: boolean }, {
      _currentComponent: 'src/App.tsx',
      _devServerRunning: false,
    });

    panel.setPreviewUrl('http://localhost:5173');

    let calls = postMessage.mock.calls.map((c) => c[0] as { type: string; url?: string });
    expect(calls.some((message) => message.type === 'updateUrl')).toBe(false);

    panel.setComponentParam('src/App.tsx');

    calls = postMessage.mock.calls.map((c) => c[0] as { type: string; url?: string });
    expect(calls).toContainEqual({
      type: 'updateUrl',
      url: 'http://localhost:5173/test-preview?component=src%2FApp.tsx',
    });
  });

  it('does not post setComponent or updateUrl when state is empty (idempotent on first load)', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    Object.assign(panel as PreviewPanel & { _devServerRunning: boolean }, { _devServerRunning: false });

    (panel as PreviewPanel & { _pushFullStateToWebview: () => void })._pushFullStateToWebview();

    // Always emits devserver status (even when stopped) so React app reaches a known state.
    expect(postMessage).toHaveBeenCalledWith({
      type: 'devserver:statusChanged',
      running: false,
      url: null,
    });
    // No component, no error, no URL: those messages must NOT be sent.
    const calls = postMessage.mock.calls.map((c) => (c[0] as { type: string }).type);
    expect(calls).not.toContain('setComponent');
    expect(calls).not.toContain('projectError');
    expect(calls).not.toContain('updateUrl');
  });

  it('uses a valid JSX component name when sample scaffold receives a path-like name', () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    const scaffold = (
      panel as PreviewPanel & {
        _buildSampleScaffold: (
          componentName: string,
          exportName: string,
          propEntries: Array<[string, unknown]>,
        ) => string;
      }
    )._buildSampleScaffold('components/Sidebar.tsx', 'SampleDefault', []);

    expect(scaffold).toContain('<Sidebar');
    expect(scaffold).not.toContain('<components/Sidebar.tsx');
  });

  it('creates visible sample content for Alert-style optional-prop containers', () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);
    const sourceCode = `
const Alert = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>((props, ref) => (
  <div ref={ref} {...props} />
));
const AlertTitle = React.forwardRef<HTMLHeadingElement, React.HTMLAttributes<HTMLHeadingElement>>((props, ref) => (
  <h5 ref={ref} {...props} />
));
const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>((props, ref) => (
  <p ref={ref} {...props} />
));
export { Alert, AlertTitle, AlertDescription };
`;

    const scaffold = (
      panel as PreviewPanel & {
        _buildSampleScaffold: (
          componentName: string,
          exportName: string,
          propEntries: Array<[string, unknown]>,
          sourceCode?: string,
        ) => string;
      }
    )._buildSampleScaffold('Alert', 'SampleDefault', [], sourceCode);

    expect(scaffold).toContain('<Alert>');
    expect(scaffold).toContain('<AlertTitle>Preview title</AlertTitle>');
    expect(scaffold).toContain(
      '<AlertDescription>This sample shows the component with visible content.</AlertDescription>',
    );
    expect(scaffold).not.toContain('TODO');
  });

  describe('injectGeneratedSampleProps (#210)', () => {
    function panelWithPropDefs(propDefs: unknown, componentName = 'Sample') {
      const stateHub = createStateHub();
      const { panel, postMessage } = createPanel(stateHub);
      Object.assign(panel as PreviewPanel & { _panelRouter: unknown }, {
        _panelRouter: {
          componentService: {
            // injectGeneratedSampleProps reads getComponent (props + display name);
            // the name feeds the meaningful children placeholder.
            getComponent: mock(() => Promise.resolve({ name: componentName, props: propDefs })),
          },
        },
      });
      return { panel, postMessage };
    }

    it('posts generated values keyed by the previewKey (relative path), not componentPath', async () => {
      const { panel, postMessage } = panelWithPropDefs([{ name: 'title', type: 'string', required: true }]);

      await panel.injectGeneratedSampleProps('/abs/workspace/src/Tweet.tsx', 'src/Tweet.tsx');

      const call = postMessage.mock.calls.find((c) => (c[0] as { type?: string })?.type === 'setGeneratedProps');
      expect(call).toBeDefined();
      const payload = call?.[0] as { componentPath: string; values: Record<string, unknown> };
      expect(payload.componentPath).toBe('src/Tweet.tsx');
      expect(payload.values).toEqual({ title: 'Sample title' });
    });

    it('deep-strips nested function values so the payload is structured-clone safe', async () => {
      const { panel, postMessage } = panelWithPropDefs([
        {
          name: 'actions',
          type: 'Actions',
          required: true,
          objectFields: [
            { name: 'label', type: 'string', required: true },
            { name: 'onSave', type: '() => void', required: true },
          ],
        },
        { name: 'onClick', type: '() => void', required: true },
      ]);

      await panel.injectGeneratedSampleProps('src/Card.tsx', 'src/Card.tsx');

      const call = postMessage.mock.calls.find((c) => (c[0] as { type?: string })?.type === 'setGeneratedProps');
      const payload = call?.[0] as { values: Record<string, unknown> };
      // structuredClone throws if any function survived at any depth.
      expect(() => structuredClone(payload.values)).not.toThrow();
      expect(payload.values).toEqual({ actions: { label: 'Sample label' } });
      expect(payload.values).not.toHaveProperty('onClick');
    });

    it('uses the component display name as the required children placeholder', async () => {
      const { panel, postMessage } = panelWithPropDefs(
        [{ name: 'children', type: 'ReactNode', required: true }],
        'LocalButton',
      );

      await panel.injectGeneratedSampleProps('src/LocalButton.tsx', 'src/LocalButton.tsx');

      const call = postMessage.mock.calls.find((c) => (c[0] as { type?: string })?.type === 'setGeneratedProps');
      const payload = call?.[0] as { values: Record<string, unknown> };
      expect(payload.values.children).toBe('Local Button');
    });

    it('posts an empty payload (readiness signal) when the component has no props', async () => {
      const { panel, postMessage } = panelWithPropDefs([]);

      const result = await panel.injectGeneratedSampleProps('src/Plain.tsx', 'src/Plain.tsx');

      const call = postMessage.mock.calls.find((c) => (c[0] as { type?: string })?.type === 'setGeneratedProps');
      expect(call).toBeDefined();
      expect((call?.[0] as { values: Record<string, unknown> }).values).toEqual({});
      expect(result).toBe(false);
    });
  });

  it('accepts webview:ready fired during the initial preview HTML write', async () => {
    const originalLog = console.log;
    console.log = mock();
    const stateHub = {
      state: {
        currentComponent: null,
        insertTargetId: null,
        selectedIds: [],
      },
      applyUpdate: mock(),
      register: mock(),
      unregister: mock(),
      sendInit: mock(),
      onChange: mock(() => () => {}),
    };
    let firedInitialReady = false;
    const mockPanel = createMockPreviewWebviewPanel({
      onHtmlWrite(webview) {
        if (!firedInitialReady) {
          firedInitialReady = true;
          webview.fireMessage({ type: 'webview:ready' });
        }
      },
    });

    Object.assign(vscode.window, {
      createWebviewPanel: mock(() => mockPanel),
      onDidChangeTextEditorSelection: mock(() => ({ dispose: mock() })),
    });
    Object.assign(vscode.workspace, {
      onDidChangeConfiguration: mock(() => ({ dispose: mock() })),
    });
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
    });

    const panel = new PreviewPanel(
      vscode.Uri.file('/extension'),
      '/workspace',
      stateHub as never,
      {
        astBridge: { astService: {} },
        setAstResponseTarget: mock(),
      } as never,
      { workspaceState: { get: mock(() => false), update: mock(() => Promise.resolve()) } } as never,
    );

    try {
      panel.createOrShow(vscode.ViewColumn.Two);
      await Promise.resolve();
    } finally {
      console.log = originalLog;
    }

    expect(stateHub.sendInit).toHaveBeenCalledWith('preview');
    expect(mockPanel.webview.postMessage).toHaveBeenCalledWith({
      type: 'devserver:statusChanged',
      running: false,
      url: null,
    });
  });

  it('uses the real default export name (Home) instead of the filename (page) for Next.js page.tsx', async () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    const pageSource = `
export default function Home() {
  return <div>Hello</div>;
}
`.trim();

    // Override readFile to return our page source
    vscode.workspace.fs.readFile.mockImplementation(() => Promise.resolve(Buffer.from(pageSource)));
    // Override writeFile so the test doesn't fail on the actual write
    vscode.workspace.fs.writeFile.mockImplementation(() => Promise.resolve());

    await (
      panel as PreviewPanel & {
        _handleCreateSampleFromError: (
          componentPath: string | undefined,
          propValues?: Record<string, unknown>,
          sampleName?: string,
          options?: {
            componentName?: string;
            notifySampleCreated?: boolean;
            revealInEditor?: boolean;
            suggestAIKey?: boolean;
          },
        ) => Promise<boolean>;
      }
    )._handleCreateSampleFromError('app/page.tsx', undefined, 'SampleDefault', { revealInEditor: false });

    // writeFile must have been called with scaffold containing <Home />, not <Page /> or <page />
    const writeCalls = vscode.workspace.fs.writeFile.mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const writtenContent = Buffer.from(writeCalls[0][1] as Uint8Array).toString('utf-8');
    expect(writtenContent).toContain('<Home');
    expect(writtenContent).not.toContain('<Page');
    expect(writtenContent).not.toContain('<page');
  });

  it('fires onSampleCreated callback when sample is created via error boundary message', async () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    const callbackPaths: string[] = [];
    panel.onSampleCreated((path) => {
      callbackPaths.push(path);
    });

    const alertSource = 'export function Alert({ variant }: { variant?: string }) { return null; }';
    vscode.workspace.fs.readFile.mockImplementation(() => Promise.resolve(Buffer.from(alertSource)));
    vscode.workspace.fs.writeFile.mockImplementation(() => Promise.resolve());

    // _handleCreateSampleFromError fires _onSampleCreatedCallback internally (notifySampleCreated=true
    // by default). The message handler does NOT call it again after the function returns.
    type InternalPanel = {
      _handleCreateSampleFromError: (
        path: string | undefined,
        propValues?: Record<string, unknown>,
        sampleName?: string,
        options?: { componentName?: string; revealInEditor?: boolean },
      ) => Promise<boolean>;
    };
    const internal = panel as unknown as InternalPanel;

    const componentPath = 'client/components/ui/alert.tsx';
    await internal._handleCreateSampleFromError(componentPath, undefined, 'SampleDefault', {
      revealInEditor: false,
    });

    expect(callbackPaths).toEqual([componentPath]);
  });
});

// HYP-435: setComponentParam(repoRel, subRel) must derive and forward the
// sub-project prefix to PanelRouter (which re-roots iframe paths for all panels).
describe('PreviewPanel monorepo prefix wiring', () => {
  it('forwards the derived sub-project prefix to PanelRouter on select', () => {
    const stateHub = createStateHub();
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
    });
    const setSubProjectPrefix = mock(() => {});
    const panel = new PreviewPanel(
      vscode.Uri.file('/extension'),
      '/workspace',
      stateHub as StateHub,
      { setSubProjectPrefix, astBridge: { setSubProjectPrefix: mock(() => {}) } } as unknown as PanelRouter,
      {} as vscode.ExtensionContext,
    );
    Object.assign(panel as PreviewPanel & { _devServerRunning: boolean; _panel: unknown }, {
      _devServerRunning: true,
      _panel: { dispose: mock(), webview: { postMessage: mock(() => Promise.resolve(true)) } },
    });

    panel.setComponentParam('targets/conloca-app/src/app/page.tsx', 'src/app/page.tsx');
    expect(setSubProjectPrefix).toHaveBeenCalledWith('targets/conloca-app/');

    // Single-package: both args coincide → empty prefix.
    panel.setComponentParam('src/App.tsx');
    expect(setSubProjectPrefix).toHaveBeenLastCalledWith('');
  });
});
