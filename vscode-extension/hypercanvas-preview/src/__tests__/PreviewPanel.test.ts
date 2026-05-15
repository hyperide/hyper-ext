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
    {} as PanelRouter,
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
    // State pushed to webview includes setComponent with the preserved value.
    expect(postMessage).toHaveBeenCalledWith({ type: 'setComponent', component: 'src/components/Feed.tsx' });
  });

  it('_pushFullStateToWebview emits devserver/projectError/setComponent/url', () => {
    const stateHub = createStateHub();
    const { panel, postMessage } = createPanel(stateHub);

    Object.assign(panel as PreviewPanel & { _currentComponent: string; _projectError: unknown }, {
      _currentComponent: 'src/App.tsx',
      _projectError: { kind: 'react-native', detail: 'no react-native-web' },
      _previewBaseUrl: 'http://localhost:5173',
    });

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
          options?: { componentName?: string; revealInEditor?: boolean },
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
});
