/**
 * @file PreviewPanel component selection synchronization tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/PreviewPanel.test.ts
 * Assumptions: iframe navigation happens only after preview generation finishes.
 * Architecture: https://hyperide.github.io/reports/preview-routing
 */

import { afterEach, describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import type { PanelRouter } from '../PanelRouter';
import { normalizeSampleComponentName, PreviewPanel, toPickerGroups } from '../PreviewPanel';
import type { ComponentsData } from '../../../../lib/component-scanner/types';
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
      getComponentGroups: mock(() =>
        Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] } }),
      ),
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

describe('toPickerGroups (canvas component-picker payload)', () => {
  const group = (name: string, path: string) => ({
    dirPath: path.replace(/\/[^/]+$/, ''),
    components: [{ name, path }],
  });

  it('passes flat groups through unchanged for a single-package project', () => {
    const data: ComponentsData = {
      atomGroups: [group('Button', 'src/ui/Button.tsx')],
      compositeGroups: [group('Tweet', 'src/Tweet.tsx')],
      pageGroups: [group('App', 'src/App.tsx')],
      isMonorepo: false,
    };
    expect(toPickerGroups(data)).toEqual({
      atomGroups: data.atomGroups,
      compositeGroups: data.compositeGroups,
      pageGroups: data.pageGroups,
    });
  });

  it('folds sub-project page groups into the flat pageGroups for a monorepo', () => {
    // The scanner mirrors sub-project atom/composite into the flat fields but leaves flat
    // pageGroups empty; the picker must still surface monorepo pages.
    const subPage = group('Home', 'apps/web/src/pages/Home.tsx');
    const data: ComponentsData = {
      atomGroups: [group('Button', 'packages/ui/Button.tsx')],
      compositeGroups: [],
      pageGroups: [],
      isMonorepo: true,
      subProjects: [
        {
          name: 'web',
          path: 'apps/web',
          supported: true,
          atomGroups: [],
          compositeGroups: [],
          pageGroups: [subPage],
        },
      ],
    };
    const result = toPickerGroups(data);
    expect(result.pageGroups).toEqual([subPage]);
    expect(result.atomGroups).toEqual(data.atomGroups);
  });

  it('renders nothing-by-omission only when even sub-project pages are empty', () => {
    const data: ComponentsData = {
      atomGroups: [],
      compositeGroups: [],
      pageGroups: [],
      isMonorepo: true,
      subProjects: [
        { name: 'web', path: 'apps/web', supported: true, atomGroups: [], compositeGroups: [], pageGroups: [] },
      ],
    };
    expect(toPickerGroups(data).pageGroups).toEqual([]);
  });
});

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

  it('re-syncs StateHub when repoPath already matches but StateHub has drifted (null)', () => {
    // _updateComponentFromEditor's guard ORs `stateHub.currentComponent?.path !== component`,
    // so _setCurrentComponent is called with _currentComponent === component while StateHub
    // is behind. The lifecycle must still broadcast to re-sync StateHub (legacy behavior).
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string }, { _currentComponent: 'src/App.tsx' });

    (panel as PreviewPanel & { _setCurrentComponent: (c: string) => void })._setCurrentComponent('src/App.tsx');

    expect(stateHub.applyUpdate).toHaveBeenCalledWith({
      currentComponent: { name: 'App', path: 'src/App.tsx' },
    });
  });

  it('does not re-broadcast when StateHub already holds the identical component (host dedup)', () => {
    const stateHub = createStateHub({ name: 'App', path: 'src/App.tsx' });
    const { panel } = createPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string }, { _currentComponent: 'src/App.tsx' });

    (panel as PreviewPanel & { _setCurrentComponent: (c: string) => void })._setCurrentComponent('src/App.tsx');

    expect(stateHub.applyUpdate).not.toHaveBeenCalled();
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
          getComponentGroups: mock(() =>
            Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] } }),
          ),
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
        getComponentGroups: mock(() =>
          Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] } }),
        ),
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

  // Spec HYP-369 Sub-ticket B acceptance: the StateHub.onChange feedback loop must NOT
  // re-fire applyUpdate for a no-op change. Uses a StateHub mock whose applyUpdate actually
  // invokes registered onChange listeners (the default createStateHub mock does not), so the
  // recursion the guard prevents is observable.
  it('StateHub.onChange listener does NOT re-fire applyUpdate on a component broadcast (loop guard)', () => {
    const listeners: Array<(state: unknown, patch: Record<string, unknown>) => void> = [];
    const state = { currentComponent: null as unknown, insertTargetId: null, selectedIds: [] as string[] };
    const applyUpdate = mock((patch: Record<string, unknown>) => {
      Object.assign(state, patch);
      // Broadcast to listeners exactly like the real StateHub.applyUpdate does.
      for (const listener of listeners) listener(state, patch);
    });
    const stateHub = {
      state,
      applyUpdate,
      register: mock(),
      unregister: mock(),
      sendInit: mock(),
      onChange: mock((listener: (s: unknown, p: Record<string, unknown>) => void) => {
        listeners.push(listener);
        return () => {};
      }),
    };

    const mockPanel = createMockPreviewWebviewPanel();
    Object.assign(vscode.window, {
      createWebviewPanel: mock(() => mockPanel),
      onDidChangeActiveTextEditor: mock(() => ({ dispose: mock() })),
    });
    Object.assign(vscode.workspace, {
      onDidChangeConfiguration: mock(() => ({ dispose: mock() })),
      workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
    });

    const panel = new PreviewPanel(
      vscode.Uri.file('/extension'),
      '/workspace',
      stateHub as never,
      {
        astBridge: { astService: {} },
        setAstResponseTarget: mock(),
        getComponentGroups: mock(() =>
          Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] } }),
        ),
      } as never,
      { workspaceState: { get: mock(() => false), update: mock(() => Promise.resolve()) } } as never,
    );
    panel.createOrShow(vscode.ViewColumn.Two);

    // Simulate a cross-panel component selection broadcast (e.g. from the Left Panel list).
    applyUpdate({ currentComponent: { name: 'Feed', path: 'src/Feed.tsx' } });
    const callsAfterFirst = applyUpdate.mock.calls.length;

    // Re-broadcast the SAME component: the listener adopts it (drops navigability) but must
    // NOT call applyUpdate again — otherwise the broadcast loops back into itself.
    applyUpdate({ currentComponent: { name: 'Feed', path: 'src/Feed.tsx' } });
    expect(applyUpdate.mock.calls.length).toBe(callsAfterFirst + 1); // only the one we just made
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

  // HYP-483: in a monorepo the error-boundary reports a SUB-project-relative
  // componentPath ('src/app/ui/HostField.tsx'), but onSampleCreated joins its
  // argument to the REPO root. Passing the sub-rel path verbatim points the
  // post-creation preview regen / navigation at the wrong file. The handler must
  // hand the callback the REPO-relative path ('targets/conloca-app/src/...').
  it('passes the repo-relative path to onSampleCreated in a monorepo', async () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    // _currentComponent is repo-relative, _previewComponent is sub-project-relative;
    // deriveSubProjectPrefix(_currentComponent, _previewComponent) → 'targets/conloca-app/'.
    Object.assign(panel as PreviewPanel & { _currentComponent: string; _previewComponent: string }, {
      _currentComponent: 'targets/conloca-app/src/app/ui/HostField.tsx',
      _previewComponent: 'src/app/ui/HostField.tsx',
    });

    const callbackPaths: string[] = [];
    panel.onSampleCreated((path) => {
      callbackPaths.push(path);
    });

    const hostFieldSource = 'export function HostField({ label }: { label?: string }) { return null; }';
    vscode.workspace.fs.readFile.mockImplementation(() => Promise.resolve(Buffer.from(hostFieldSource)));
    vscode.workspace.fs.writeFile.mockImplementation(() => Promise.resolve());

    type InternalPanel = {
      _handleCreateSampleFromError: (
        path: string | undefined,
        propValues?: Record<string, unknown>,
        sampleName?: string,
        options?: { componentName?: string; revealInEditor?: boolean },
      ) => Promise<boolean>;
    };
    const internal = panel as unknown as InternalPanel;

    // Error boundary reports the sub-project-relative path.
    await internal._handleCreateSampleFromError('src/app/ui/HostField.tsx', undefined, 'SampleDefault', {
      revealInEditor: false,
    });

    // onSampleCreated joins to the repo root, so it must receive the repo-relative path.
    expect(callbackPaths).toEqual(['targets/conloca-app/src/app/ui/HostField.tsx']);
  });

  // HYP-870: rewriting an EXISTING sample kept the `// Sample component for
  // preview` comment line(s) above it in the retained prefix while the
  // replacement scaffold re-added its own copy — every rewrite stacked one
  // more duplicate (observed live: 8 copies in conloca-app's AccountPage.tsx).
  it('does not duplicate the scaffold comment when rewriting an existing sample', async () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    const dupSource = [
      'export function HostField({ label }: { label?: string }) { return null; }',
      '',
      '// Sample component for preview',
      '// Sample component for preview',
      '// Sample component for preview',
      'export const SampleDefault = () => (',
      '  <HostField',
      '  />',
      ');',
    ].join('\n');
    vscode.workspace.fs.readFile.mockImplementation(() => Promise.resolve(Buffer.from(dupSource)));
    vscode.workspace.fs.writeFile.mockImplementation(() => Promise.resolve());

    type InternalPanel = {
      _handleCreateSampleFromError: (
        path: string | undefined,
        propValues?: Record<string, unknown>,
        sampleName?: string,
        options?: { componentName?: string; revealInEditor?: boolean },
      ) => Promise<boolean>;
    };
    const internal = panel as unknown as InternalPanel;

    await internal._handleCreateSampleFromError('src/HostField.tsx', undefined, 'SampleDefault', {
      revealInEditor: false,
    });

    const writeCalls = vscode.workspace.fs.writeFile.mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const written = Buffer.from(writeCalls[writeCalls.length - 1][1] as Uint8Array).toString('utf-8');
    const commentCount = written.split('// Sample component for preview').length - 1;
    expect(commentCount).toBe(1);
    expect(written).toContain('export const SampleDefault');
  });

  // HYP-870 edge: nonstandard whitespace (`export  const`) must not desync the
  // rewrite start from the existence check (indexOf would return -1 and corrupt
  // the replacement slices).
  it('rewrites an existing sample declared with nonstandard whitespace without corrupting the file', async () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    const dupSource = [
      'export function HostField({ label }: { label?: string }) { return null; }',
      '',
      '// Sample component for preview',
      'export  const SampleDefault = () => (',
      '  <HostField',
      '  />',
      ');',
    ].join('\n');
    vscode.workspace.fs.readFile.mockImplementation(() => Promise.resolve(Buffer.from(dupSource)));
    vscode.workspace.fs.writeFile.mockImplementation(() => Promise.resolve());

    type InternalPanel = {
      _handleCreateSampleFromError: (
        path: string | undefined,
        propValues?: Record<string, unknown>,
        sampleName?: string,
        options?: { componentName?: string; revealInEditor?: boolean },
      ) => Promise<boolean>;
    };
    const internal = panel as unknown as InternalPanel;

    await internal._handleCreateSampleFromError('src/HostField.tsx', undefined, 'SampleDefault', {
      revealInEditor: false,
    });

    const writeCalls = vscode.workspace.fs.writeFile.mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const written = Buffer.from(writeCalls[writeCalls.length - 1][1] as Uint8Array).toString('utf-8');
    const commentCount = written.split('// Sample component for preview').length - 1;
    expect(commentCount).toBe(1);
    // The original function declaration must survive intact (no corrupted slices).
    expect(written).toContain('export function HostField');
    expect(written).toContain('export const SampleDefault');
  });

  // HYP-870 edge: stacked copies separated by blank lines must be consumed too.
  it('collapses scaffold comments separated by blank lines when rewriting an existing sample', async () => {
    const stateHub = createStateHub();
    const { panel } = createPanel(stateHub);

    const dupSource = [
      'export function HostField({ label }: { label?: string }) { return null; }',
      '',
      '// Sample component for preview',
      '',
      '// Sample component for preview',
      '',
      'export const SampleDefault = () => (',
      '  <HostField',
      '  />',
      ');',
    ].join('\n');
    vscode.workspace.fs.readFile.mockImplementation(() => Promise.resolve(Buffer.from(dupSource)));
    vscode.workspace.fs.writeFile.mockImplementation(() => Promise.resolve());

    type InternalPanel = {
      _handleCreateSampleFromError: (
        path: string | undefined,
        propValues?: Record<string, unknown>,
        sampleName?: string,
        options?: { componentName?: string; revealInEditor?: boolean },
      ) => Promise<boolean>;
    };
    const internal = panel as unknown as InternalPanel;

    await internal._handleCreateSampleFromError('src/HostField.tsx', undefined, 'SampleDefault', {
      revealInEditor: false,
    });

    const writeCalls = vscode.workspace.fs.writeFile.mock.calls;
    expect(writeCalls.length).toBeGreaterThan(0);
    const written = Buffer.from(writeCalls[writeCalls.length - 1][1] as Uint8Array).toString('utf-8');
    const commentCount = written.split('// Sample component for preview').length - 1;
    expect(commentCount).toBe(1);
    expect(written).toContain('export const SampleDefault');
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

function projectErrorOf(panel: PreviewPanel): { type: string } | null {
  return (panel as PreviewPanel & { _projectError: { type: string } | null })._projectError;
}

describe('PreviewPanel unsupported-project channels (HYP-442/443 race fix)', () => {
  it('setReactNativeUnsupported(null) does NOT clobber a standing framework screen', () => {
    const { panel } = createPanel(createStateHub());

    // Selection path posts the framework compat screen (HYP-442).
    panel.notifyUnsupportedProject({ type: 'framework', message: 'no supported framework' });
    expect(projectErrorOf(panel)?.type).toBe('framework');

    // Background detector (runProjectDetection) finishes AFTER selection with a null
    // result (non-RN project). It must NOT wipe the framework screen back to blank.
    // Token captured after the framework post (fresh) — this exercises the TYPE
    // precedence guard, independent of the HYP-588 staleness guard below.
    panel.setReactNativeUnsupported(null, panel.screenDecisionToken);
    expect(projectErrorOf(panel)?.type).toBe('framework');
  });

  it('setReactNativeUnsupported(null) DOES clear a stale react-native screen', () => {
    const { panel } = createPanel(createStateHub());

    panel.notifyUnsupportedProject({ type: 'react-native', message: 'needs rn-web', fixLabel: 'Fix' });
    expect(projectErrorOf(panel)?.type).toBe('react-native');

    // Switching from an RN project to a supported one: the RN screen must clear.
    panel.setReactNativeUnsupported(null, panel.screenDecisionToken);
    expect(projectErrorOf(panel)).toBeNull();
  });

  it('setReactNativeUnsupported(error) with a current token applies the RN error', () => {
    const { panel } = createPanel(createStateHub());

    panel.setReactNativeUnsupported(
      { type: 'react-native', message: 'needs rn-web', fixLabel: 'Fix' },
      panel.screenDecisionToken,
    );
    expect(projectErrorOf(panel)?.type).toBe('react-native');
  });

  it('clearSelectionBlockingScreen leaves a react-native screen intact (inverse guard)', () => {
    const { panel } = createPanel(createStateHub());

    panel.notifyUnsupportedProject({ type: 'react-native', message: 'needs rn-web', fixLabel: 'Fix' });
    panel.clearSelectionBlockingScreen();
    expect(projectErrorOf(panel)?.type).toBe('react-native');
  });
});

describe('PreviewPanel stale-detection decision-token guard (HYP-588)', () => {
  const rnError = { type: 'react-native' as const, message: 'needs rn-web', fixLabel: 'Fix' };

  it('a stale detection RN error does not re-post the screen the fix command cleared', () => {
    const { panel } = createPanel(createStateHub());

    // Background detection starts: captures the decision token (extension.ts
    // runProjectDetection does this synchronously before awaiting the detectors).
    const token = panel.screenDecisionToken;

    // User clicks "Fix" → react-native-web installed → fix command re-checks the
    // project and clears the screen (extension-commands.ts setupReactNativeWeb).
    // This is a NEWER screen decision than the in-flight detection.
    panel.notifyUnsupportedProject(null);

    // The slow detection (started before package.json gained react-native-web)
    // completes with the now-stale RN error. It must be discarded — type
    // precedence cannot help here because both sides are the RN channel.
    panel.setReactNativeUnsupported(rnError, token);
    expect(projectErrorOf(panel)).toBeNull();
  });

  it('a stale detection RN error does not overwrite a newer framework screen', () => {
    const { panel } = createPanel(createStateHub());

    const token = panel.screenDecisionToken;

    // Selection path posts the framework compat screen (HYP-442) AFTER detection started.
    panel.notifyUnsupportedProject({ type: 'framework', message: 'no supported framework' });

    // Stale detection completes with an RN error — must not clobber the newer decision.
    panel.setReactNativeUnsupported(rnError, token);
    expect(projectErrorOf(panel)?.type).toBe('framework');
  });

  it('a stale detection null result is discarded wholesale', () => {
    const { panel } = createPanel(createStateHub());

    const token = panel.screenDecisionToken;

    // A newer decision posts an RN screen (e.g. a later detection run after a
    // workspace folder change back to an RN root).
    panel.notifyUnsupportedProject(rnError);

    // The stale run's null result must not clear the newer RN screen.
    panel.setReactNativeUnsupported(null, token);
    expect(projectErrorOf(panel)?.type).toBe('react-native');
  });

  it('a fresh detection result still applies (token unchanged)', () => {
    const { panel } = createPanel(createStateHub());

    const token = panel.screenDecisionToken;
    panel.setReactNativeUnsupported(rnError, token);
    expect(projectErrorOf(panel)?.type).toBe('react-native');
  });
});

// HYP-363 regression guard: the preview webview must open in ViewColumn.Two, never
// ViewColumn.Beside. Beside resolves to "the next column", which in a single-column
// E2E layout (the only editor group is column 1) is column 2 — a group that does not
// exist yet — and VS Code parks the webview off-screen, so E2E specs see a blank
// canvas. ViewColumn.Two forces a visible split in any layout. Fixed in 94077019
// "fix(ext): keep preview webview visible (HYP-363)". The earlier suite passed an
// explicit ViewColumn.Two into createOrShow, so the `column || ViewColumn.Two` DEFAULT
// branch (the thing the fix actually changed) was never exercised — a revert to
// `|| ViewColumn.Beside` stayed green. This guard calls createOrShow() with NO column
// to pin the default.
describe('PreviewPanel off-screen webview guard (HYP-363)', () => {
  function buildPanel() {
    const stateHub = {
      state: { currentComponent: null, insertTargetId: null, selectedIds: [] },
      applyUpdate: mock(),
      register: mock(),
      unregister: mock(),
      sendInit: mock(),
      onChange: mock(() => () => {}),
    };
    const mockPanel = createMockPreviewWebviewPanel();
    const createWebviewPanel = mock(() => mockPanel);
    Object.assign(vscode.window, {
      createWebviewPanel,
      onDidChangeActiveTextEditor: mock(() => ({ dispose: mock() })),
      onDidChangeTextEditorSelection: mock(() => ({ dispose: mock() })),
    });
    Object.assign(vscode.workspace, {
      onDidChangeConfiguration: mock(() => ({ dispose: mock() })),
      workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
    });

    const panel = new PreviewPanel(
      vscode.Uri.file('/extension'),
      '/workspace',
      stateHub as never,
      {
        astBridge: { astService: {} },
        setAstResponseTarget: mock(),
        getComponentGroups: mock(() =>
          Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] } }),
        ),
      } as never,
      { workspaceState: { get: mock(() => false), update: mock(() => Promise.resolve()) } } as never,
    );
    return { createWebviewPanel, panel };
  }

  it('createOrShow() with no column opens the webview in ViewColumn.Two (on-screen), never Beside', () => {
    const { createWebviewPanel, panel } = buildPanel();

    // No explicit column — exercises the `column || vscode.ViewColumn.Two` default.
    panel.createOrShow();

    expect(createWebviewPanel).toHaveBeenCalledTimes(1);
    const columnArg = createWebviewPanel.mock.calls[0][2];
    expect(columnArg).toBe(vscode.ViewColumn.Two);
    expect(columnArg).not.toBe(vscode.ViewColumn.Beside);
  });

  it('an explicit column passed to createOrShow is honored', () => {
    const { createWebviewPanel, panel } = buildPanel();

    panel.createOrShow(vscode.ViewColumn.Three);

    expect(createWebviewPanel.mock.calls[0][2]).toBe(vscode.ViewColumn.Three);
  });
});

/**
 * HYP-1026 — empty-stack canvas undo/redo native fallback.
 *
 * Background: when the content-based canvas undo stack is empty,
 * PreviewPanel.undo()/redo() fall back to VS Code's native undo/redo. Commit
 * 24d012913 (2026-04-07) proved that 'default:undo'/'default:redo' are NOT
 * valid executable command ids (they only exist for keybinding `when`-clause
 * overriding) and reverted the fallback to the bare 'undo'/'redo' command ids
 * — these tests pin that decision so it is never silently flipped back.
 *
 * The real bug this ticket fixes: the fallback never explicitly focused the
 * previewed document before asking VS Code to undo. When the preview webview
 * has focus (the normal state when the canvasUndo keybinding fires), the
 * bare 'undo' command has no focused text editor to act on and silently
 * no-ops — the user's direct source edit is never reverted. The fix brings
 * the dirtied previewed document into focus first (mirroring the "focuses
 * the target document" design described in the original HYP-151 commit
 * message, which was never actually implemented at this call site).
 */
describe('PreviewPanel native undo/redo fallback (HYP-1026)', () => {
  // Several tests below mutate vscode.window.visibleTextEditors to simulate the
  // previewed document already being open in some column. Reset unconditionally
  // after every test in this describe (not just the tests preceding a mutator) so
  // a stale non-empty array can never leak into a later test in this block or
  // any describe that follows it in the file.
  afterEach(() => {
    Object.assign(vscode.window, { visibleTextEditors: [] });
  });

  function createFallbackPanel(
    stateHub: ReturnType<typeof createStateHub>,
    astBridgeOverrides: {
      undo?: ReturnType<typeof mock>;
      redo?: ReturnType<typeof mock>;
      canUndo?: ReturnType<typeof mock>;
      canRedo?: ReturnType<typeof mock>;
    } = {},
  ) {
    Object.assign(vscode.workspace, {
      workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
    });
    const reveal = mock();
    const astBridge = {
      setSubProjectPrefix: mock(() => {}),
      undo: astBridgeOverrides.undo ?? mock(() => Promise.resolve(false)),
      redo: astBridgeOverrides.redo ?? mock(() => Promise.resolve(false)),
      // Default to "stack empty" — matches the default undo/redo mocks above.
      // Callers exercising the busy/failed-but-non-empty distinction override
      // this explicitly (see the "false does not mean empty" regression tests).
      canUndo: astBridgeOverrides.canUndo ?? mock(() => false),
      canRedo: astBridgeOverrides.canRedo ?? mock(() => false),
    };
    const panel = new PreviewPanel(
      vscode.Uri.file('/extension'),
      '/workspace',
      stateHub as StateHub,
      {
        setSubProjectPrefix: mock(() => {}),
        astBridge,
        getComponentGroups: mock(() =>
          Promise.resolve({ data: { atomGroups: [], compositeGroups: [], pageGroups: [] } }),
        ),
      } as unknown as PanelRouter,
      {} as vscode.ExtensionContext,
    );
    Object.assign(panel as PreviewPanel & { _panel: unknown }, {
      _panel: { reveal, webview: { postMessage: mock(() => Promise.resolve(true)) } },
    });
    return { panel, reveal, astBridge };
  }

  it('undo(): no panel — falls back to bare "undo", never the invalid "default:undo"', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _panel: unknown }, { _panel: undefined });

    await panel.undo();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('undo');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('default:undo');
  });

  it('redo(): no panel — falls back to bare "redo", never the invalid "default:redo"', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _panel: unknown }, { _panel: undefined });

    await panel.redo();

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('redo');
    expect(vscode.commands.executeCommand).not.toHaveBeenCalledWith('default:redo');
  });

  it('undo(): empty canvas stack — focuses the dirtied previewed document before native undo, then reveals the panel', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    const dirtyDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [dirtyDoc] });

    const callOrder: string[] = [];
    (vscode.window.showTextDocument as ReturnType<typeof mock>).mockImplementation(() => {
      callOrder.push('showTextDocument');
      return Promise.resolve({ document: dirtyDoc });
    });
    (vscode.commands.executeCommand as ReturnType<typeof mock>).mockImplementation((id: unknown) => {
      callOrder.push(`executeCommand:${String(id)}`);
      return Promise.resolve();
    });
    Object.assign(vscode.window, { activeTextEditor: { document: dirtyDoc } });

    await panel.undo();

    // The dirtied source document must be focused BEFORE the native undo
    // command runs — otherwise 'undo' has no focused editor to act on and
    // silently does nothing (the HYP-1026 bug).
    expect(callOrder).toEqual(['showTextDocument', 'executeCommand:undo']);
    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      dirtyDoc,
      expect.objectContaining({ preserveFocus: false, viewColumn: vscode.ViewColumn.One }),
    );
    expect(reveal).toHaveBeenCalled();
    expect(dirtyDoc.save).toHaveBeenCalled();
  });

  it('undo(): empty canvas stack — focuses the previewed document even when NOT dirty (undo history survives a save)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // Already saved (isDirty: false) — but VS Code's native undo stack survives
    // a save, so the previewed document must still be focused before 'undo'
    // runs. Gating the focus step on isDirty would leave this exact case
    // silently broken (the HYP-1026 bug, just for an already-saved edit).
    const cleanDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: false,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [cleanDoc] });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      cleanDoc,
      expect.objectContaining({ preserveFocus: false, viewColumn: vscode.ViewColumn.One }),
    );
  });

  it('undo(): empty canvas stack — document not visible in any group — focuses it in ViewColumn.One, the established code column (Codex P2, PR #673)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // Simulate the normal empty-stack-undo trigger: the preview webview (column 2)
    // has focus and the component document isn't open as a visible editor
    // anywhere yet. Without an explicit viewColumn, showTextDocument would
    // default to whatever group is "active" — the preview panel's column,
    // not the code column — disrupting the user's two-column layout.
    const dirtyDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [dirtyDoc] });
    // visibleTextEditors starts empty (shared beforeEach in mock-vscode.ts,
    // reinforced by this describe's own afterEach above).

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      dirtyDoc,
      expect.objectContaining({ viewColumn: vscode.ViewColumn.One }),
    );
  });

  it('undo(): empty canvas stack — document already visible in a DIFFERENT column — reuses that column instead of forcing ViewColumn.One (Codex P2, PR #673)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // The user dragged the component's tab to a third column since it was
    // first opened. Unconditionally forcing ViewColumn.One here would open a
    // SECOND editor for the same document in column One — the exact
    // duplicate-tab symptom the P2 warned hardcoding One could reintroduce.
    const dirtyDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, {
      textDocuments: [dirtyDoc],
    });
    Object.assign(vscode.window, {
      visibleTextEditors: [{ document: dirtyDoc, viewColumn: vscode.ViewColumn.Three }],
    });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      dirtyDoc,
      expect.objectContaining({ viewColumn: vscode.ViewColumn.Three }),
    );
  });

  it('undo(): empty canvas stack — a `git:` diff editor for the same path is visible — NOT mistaken for the real file editor, still falls back to ViewColumn.One', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // The user has a Source Control diff of the same file open in column Three
    // (scheme 'git', same fsPath as the real file). Comparing by fsPath alone
    // would wrongly treat that read-only diff editor as "the document already
    // visible" and reuse its column — focusing a diff editor that native
    // 'undo' can't act on, reintroducing the HYP-1026 no-op. Comparing by full
    // URI (scheme included) must reject this match and fall back to
    // ViewColumn.One instead.
    const realDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    const gitDiffDoc = {
      uri: vscode.Uri.from({ scheme: 'git', path: '/workspace/src/App.tsx' }),
    };
    Object.assign(vscode.workspace, { textDocuments: [realDoc] });
    Object.assign(vscode.window, {
      visibleTextEditors: [{ document: gitDiffDoc, viewColumn: vscode.ViewColumn.Three }],
    });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      realDoc,
      expect.objectContaining({ viewColumn: vscode.ViewColumn.One }),
    );
  });

  it('undo(): empty canvas stack — document visible but hosted outside a normal column (viewColumn undefined) — still falls back to ViewColumn.One, never lets undefined resolve to the active/preview group', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // A visible editor CAN have viewColumn === undefined (e.g. a notebook cell
    // editor, or any host not in one of the main editor groups). Passing that
    // undefined straight through to showTextDocument does NOT "keep it where
    // it is" — VS Code resolves it to the ACTIVE group, which during the
    // normal empty-stack-undo trigger is the preview webview's group. A plain
    // `existingEditor ? existingEditor.viewColumn : One` ternary (instead of
    // `existingEditor?.viewColumn ?? One`) would regress exactly this case.
    const dirtyDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [dirtyDoc] });
    Object.assign(vscode.window, {
      visibleTextEditors: [{ document: dirtyDoc, viewColumn: undefined }],
    });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(
      dirtyDoc,
      expect.objectContaining({ viewColumn: vscode.ViewColumn.One }),
    );
  });

  it('undo(): empty canvas stack — no _currentComponent set — skips the focus step but still runs native undo', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    // _currentComponent left unset (undefined) — nothing to resolve/focus.
    Object.assign(vscode.workspace, {
      textDocuments: [{ uri: vscode.Uri.file('/workspace/src/Other.tsx'), isDirty: true, save: mock() }],
    });

    await panel.undo();

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('undo');
    expect(reveal).toHaveBeenCalled();
  });

  it('undo(): canvas stack handled the edit — never focuses a document or reveals the panel (native fallback is fully skipped)', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub, { undo: mock(() => Promise.resolve(true)) });
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    await panel.undo();

    // handled === true means the content-based canvas stack reverted the
    // file itself — the native-fallback branch (focus/executeCommand/reveal)
    // must not run at all.
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  // NOTE on the undo/redo asymmetry below: this is PRE-EXISTING, deliberate
  // behavior untouched by this diff (redo() itself is not modified here) —
  // see commit 03285a7f "fix(undo-redo): remove native redo fallback that
  // corrupted canvas state". undo()'s native fallback runs whenever the
  // canvas stack is empty (panel present or not); redo()'s native fallback
  // runs ONLY when there is no panel at all (a true last-resort with no
  // canvas context). The two tests below intentionally assert opposite
  // executeCommand outcomes for that reason — it is not a bug in either test.
  it('redo(): empty canvas stack — no native fallback (self-contained by design, confirmed for HYP-1026)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);

    await panel.redo();

    // Canvas redo stays self-contained: applyEdit() writes silently populate
    // VS Code's native undo stack — a native redo fallback here would replay
    // stale content (03285a7f).
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('undo(): empty canvas stack — a `workspace.textDocuments` entry with the same fsPath but a `git:` scheme is NEVER treated as the previewed document (scheme-blind lookup regression)', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // Only a `git:` diff-view document for the same path is open — the real
    // `file:` document is NOT in workspace.textDocuments at all (e.g. only a
    // Source Control diff of App.tsx was ever opened). A lookup that compares
    // by `fsPath` alone would wrongly match this read-only diff document and
    // hand it to showTextDocument/native-undo, which silently no-ops on it —
    // reintroducing the HYP-1026 bug via the OTHER lookup site (the one that
    // decides WHICH document object gets focused, not the visibleTextEditors
    // column lookup already covered above).
    const gitDiffDoc = { uri: vscode.Uri.from({ scheme: 'git', path: '/workspace/src/App.tsx' }) };
    Object.assign(vscode.workspace, { textDocuments: [gitDiffDoc] });

    await panel.undo();

    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('undo');
    expect(reveal).toHaveBeenCalled();
  });

  it('undo(): no panel, but `_currentComponent` is still set (panel was closed, focus is on a sidebar view) — still focuses the previewed document before native undo', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _panel: unknown; _currentComponent: string | undefined }, {
      _panel: undefined,
      _currentComponent: 'src/App.tsx',
    });

    // The preview panel tab was closed but `_currentComponent` survives (this
    // codebase persists it across panel disposal — see the class-level
    // "panel was disposed and re-created" comment). The canvasUndo keybinding
    // still fires while the Explorer/Inspector sidebar view is focused
    // (its own `when` clause), so without this focus step native 'undo' acts
    // on the sidebar webview and silently no-ops — reintroducing HYP-1026 for
    // the no-panel case specifically.
    const dirtyDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [dirtyDoc] });

    const callOrder: string[] = [];
    (vscode.window.showTextDocument as ReturnType<typeof mock>).mockImplementation(() => {
      callOrder.push('showTextDocument');
      return Promise.resolve({ document: dirtyDoc });
    });
    (vscode.commands.executeCommand as ReturnType<typeof mock>).mockImplementation((id: unknown) => {
      callOrder.push(`executeCommand:${String(id)}`);
      return Promise.resolve();
    });

    await panel.undo();

    expect(callOrder).toEqual(['showTextDocument', 'executeCommand:undo']);
  });

  it('undo(): no panel, but the content-based canvas stack still has a handleable entry — restores it via astBridge, never touches native undo (no-panel-undo bypass regression)', async () => {
    const stateHub = createStateHub();
    const undo = mock(() => Promise.resolve(true));
    const { panel } = createFallbackPanel(stateHub, { undo });
    Object.assign(panel as PreviewPanel & { _panel: unknown }, { _panel: undefined });

    await panel.undo();

    // The content-based UndoRedoService stack outlives panel disposal, so it
    // must be tried BEFORE falling back to native undo even with no panel —
    // astBridge.undo() is called with `undefined` (not skipped), and since it
    // reports handled=true, no native fallback runs at all.
    expect(undo).toHaveBeenCalledWith(undefined);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('redo(): no panel, but the content-based canvas stack still has a handleable entry — restores it via astBridge, never touches native redo (no-panel-redo bypass regression)', async () => {
    const stateHub = createStateHub();
    const redo = mock(() => Promise.resolve(true));
    const { panel } = createFallbackPanel(stateHub, { redo });
    Object.assign(panel as PreviewPanel & { _panel: unknown }, { _panel: undefined });

    await panel.redo();

    expect(redo).toHaveBeenCalledWith(undefined);
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('undo(): empty canvas stack — the previewed document is open under a NON-file workspace-folder scheme (e.g. `vscode-remote:`) — still matched and focused (remote-scheme URI regression)', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });

    // Simulate a Remote SSH / WSL / Dev Containers workspace folder: its URI
    // keeps a non-`file` scheme even though `fsPath` is the familiar local
    // path. `Uri.file(componentPath)` would force `file:` and never match
    // this document — reintroducing the HYP-1026 no-op on those hosts.
    Object.assign(vscode.workspace, {
      workspaceFolders: [
        { uri: vscode.Uri.from({ scheme: 'vscode-remote', authority: 'ssh-remote', path: '/workspace' }), name: 'workspace', index: 0 },
      ],
    });
    const remoteDoc = {
      uri: vscode.Uri.from({ scheme: 'vscode-remote', authority: 'ssh-remote', path: '/workspace/src/App.tsx' }),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [remoteDoc] });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(remoteDoc, expect.objectContaining({ preserveFocus: false }));
    expect(reveal).toHaveBeenCalled();
  });

  it('undo(): astBridge.undo() returns false because a snapshot write FAILED (stack was non-empty) — does NOT fall back to native undo ("false" ≠ "empty" regression)', async () => {
    const stateHub = createStateHub();
    // canUndo() reports a real, non-empty stack; undo() itself returns false
    // because the underlying content write failed (UndoRedoService.undo()
    // returns false in that case too, not only when the stack is empty).
    const { panel, reveal } = createFallbackPanel(stateHub, {
      undo: mock(() => Promise.resolve(false)),
      canUndo: mock(() => true),
    });

    await panel.undo();

    // A failed content-based write must NOT trigger native undo — that would
    // revert unrelated editor content instead of surfacing the real failure.
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();
  });

  it('redo(): astBridge.redo() returns false because it is already IN PROGRESS (stack was non-empty), with no panel — does NOT fall back to native redo ("false" ≠ "empty" regression)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub, {
      redo: mock(() => Promise.resolve(false)),
      canRedo: mock(() => true),
    });
    Object.assign(panel as PreviewPanel & { _panel: unknown }, { _panel: undefined });

    await panel.redo();

    // A concurrent in-progress redo returning false must not be treated as
    // "nothing to redo" — native redo would replay unrelated editor history.
    expect(vscode.window.showTextDocument).not.toHaveBeenCalled();
    expect(vscode.commands.executeCommand).not.toHaveBeenCalled();
  });

  it('undo(): empty canvas stack — a multi-root workspace has an ANCESTOR folder (also containing the component) before the actual active folder — the ANCESTOR must NOT win just because it appears first or matches `_workspaceRoot` by fsPath (multi-root scheme regression)', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    // `_currentComponent` is under a nested sub-folder ('sub/'), so
    // `componentPath` is contained by BOTH the shallow `/workspace` folder
    // (which also happens to equal `_workspaceRoot` — this is exactly the
    // case a naive "prefer the exact `_workspaceRoot` match" rule would get
    // wrong) AND a deeper, more specific `/workspace/sub` folder that exposes
    // a DIFFERENT scheme (standing in for a nested Dev Container/virtual
    // filesystem sub-project). The deeper, more specific folder must win —
    // that's the one whose scheme the real open document actually uses.
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'sub/App.tsx',
    });
    Object.assign(vscode.workspace, {
      workspaceFolders: [
        { uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 },
        { uri: vscode.Uri.from({ scheme: 'nested-fs', path: '/workspace/sub' }), name: 'sub', index: 1 },
      ],
    });
    const realDoc = {
      uri: vscode.Uri.from({ scheme: 'nested-fs', path: '/workspace/sub/App.tsx' }),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    // A `file:`-scheme document at the SAME fsPath must be ignored — matching
    // it instead of `realDoc` would be exactly the wrong-scheme regression.
    const wrongSchemeDoc = { uri: vscode.Uri.file('/workspace/sub/App.tsx'), isDirty: true, save: mock() };
    Object.assign(vscode.workspace, { textDocuments: [wrongSchemeDoc, realDoc] });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(realDoc, expect.objectContaining({ preserveFocus: false }));
    expect(reveal).toHaveBeenCalled();
  });

  it('redo(): no panel, empty canvas stack — native redo left the FOCUSED previewed document dirty — saves it, matching undo()\'s behavior (redo/undo save-parity regression)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _panel: unknown; _currentComponent: string | undefined }, {
      _panel: undefined,
      _currentComponent: 'src/App.tsx',
    });

    // The save must be gated on the previewed document actually being found
    // and focused (`_currentComponent` set + a matching open document) — not
    // merely on `activeTextEditor` being dirty, which could be an unrelated
    // editor the user already had open (see the NEXT test).
    const dirtyDoc = { uri: vscode.Uri.file('/workspace/src/App.tsx'), isDirty: true, save: mock(() => Promise.resolve(true)) };
    Object.assign(vscode.workspace, { textDocuments: [dirtyDoc] });
    (vscode.window.showTextDocument as ReturnType<typeof mock>).mockImplementation(() =>
      Promise.resolve({ document: dirtyDoc }),
    );
    Object.assign(vscode.window, { activeTextEditor: { document: dirtyDoc } });

    await panel.redo();

    // Without this, a redone edit in the no-panel last-resort branch stayed
    // unpersisted on disk — undo()'s native fallback always saved; redo()'s
    // didn't (asymmetry flagged in review).
    expect(dirtyDoc.save).toHaveBeenCalled();
  });

  it('redo(): no panel, empty canvas stack — no previewed document was found/focused — does NOT save the merely-coincidentally-active editor (unsafe-save regression)', async () => {
    const stateHub = createStateHub();
    const { panel } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _panel: unknown }, { _panel: undefined });
    // No `_currentComponent` set — nothing was found/focused by this undo/redo
    // at all. `activeTextEditor` here is whatever the user already had open
    // for unrelated reasons.
    const unrelatedDirtyDoc = { uri: vscode.Uri.file('/workspace/src/Unrelated.tsx'), isDirty: true, save: mock(() => Promise.resolve(true)) };
    Object.assign(vscode.window, { activeTextEditor: { document: unrelatedDirtyDoc } });

    await panel.redo();

    expect(unrelatedDirtyDoc.save).not.toHaveBeenCalled();
  });

  it('undo(): no previewed document was found/focused — does NOT save the merely-coincidentally-active editor (unsafe-save regression)', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    // No `_currentComponent` set — the focus step is a no-op.
    const unrelatedDirtyDoc = { uri: vscode.Uri.file('/workspace/src/Unrelated.tsx'), isDirty: true, save: mock(() => Promise.resolve(true)) };
    Object.assign(vscode.window, { activeTextEditor: { document: unrelatedDirtyDoc } });

    await panel.undo();

    expect(unrelatedDirtyDoc.save).not.toHaveBeenCalled();
    expect(reveal).toHaveBeenCalled();
  });

  it('undo(): empty canvas stack — NO workspace folder matches at all (`workspaceFolders` is empty) — `_resolveComponentUri` falls back to plain `Uri.file`, still finds a `file:`-scheme open document', async () => {
    const stateHub = createStateHub();
    const { panel, reveal } = createFallbackPanel(stateHub);
    Object.assign(panel as PreviewPanel & { _currentComponent: string | undefined }, {
      _currentComponent: 'src/App.tsx',
    });
    // No workspace folders at all (e.g. a single-file window, or a monorepo
    // sub-project root that was never itself registered as a workspace
    // folder) — `_resolveComponentUri` has nothing to inherit a scheme from
    // and must fall back to a plain `Uri.file(componentPath)`.
    Object.assign(vscode.workspace, { workspaceFolders: [] });
    const realDoc = {
      uri: vscode.Uri.file('/workspace/src/App.tsx'),
      isDirty: true,
      save: mock(() => Promise.resolve(true)),
    };
    Object.assign(vscode.workspace, { textDocuments: [realDoc] });

    await panel.undo();

    expect(vscode.window.showTextDocument).toHaveBeenCalledWith(realDoc, expect.objectContaining({ preserveFocus: false }));
    expect(reveal).toHaveBeenCalled();
  });
});
