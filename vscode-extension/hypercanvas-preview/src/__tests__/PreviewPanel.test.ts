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
import { PreviewPanel } from '../PreviewPanel';
import type { StateHub } from '../StateHub';

interface MockStateHubState {
  currentComponent: { name: string; path: string } | null;
}

function createStateHub(initial: MockStateHubState['currentComponent'] = null) {
  const state: MockStateHubState = { currentComponent: initial };
  return {
    state,
    applyUpdate: mock((patch: Partial<MockStateHubState>) => {
      Object.assign(state, patch);
    }),
  };
}

function createPanel(stateHub: ReturnType<typeof createStateHub>) {
  const panel = new PreviewPanel(
    vscode.Uri.file('/extension'),
    '/workspace',
    stateHub as StateHub,
    {} as PanelRouter,
    {} as vscode.ExtensionContext,
  );
  const postMessage = mock(() => Promise.resolve(true));
  Object.assign(panel as PreviewPanel & { _devServerRunning: boolean; _panel: unknown }, {
    _devServerRunning: true,
    _panel: { webview: { postMessage } },
  });
  return { panel, postMessage };
}

function createEditor(path: string): vscode.TextEditor {
  return {
    document: {
      uri: vscode.Uri.file(path),
    },
  } as vscode.TextEditor;
}

describe('PreviewPanel component selection', () => {
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
});
