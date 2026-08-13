/**
 * @file Disposed-webview reuse guard tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/webview-disposed-guard.test.ts
 *
 * Bug guarded here: the cached `PreviewPanel._panel` can be a stale reference to an
 * already-disposed `WebviewPanel`. VS Code fires `onDidDispose` (which nulls `_panel`)
 * asynchronously, and the async ensure-sample/preview pipeline awaits across several
 * ticks during which the panel can be torn down (workspace switch, tab close, or the
 * E2E harness disposing the panel between specs under load). A plain
 * `_panel?.webview.postMessage(...)` guards only `_panel === undefined`, NOT "disposed",
 * so it threw `Error: Webview is disposed` — which escaped the per-call guards and
 * poisoned the shared extension-host worker into a cascade of dead-preview failures.
 *
 * The guard converts that worker-poisoning throw into a graceful no-op and drops the
 * stale reference so the next `createOrShow` rebuilds a fresh panel.
 */

import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { isWebviewDisposedError, postToWebviewSafe } from '../webview-post';
import { injectGeneratedSampleProps, watchSampleInFile } from '../preview-panel-sample';
import { setupPanel, type PanelSetupDeps } from '../preview-panel-setup';
import { PreviewPanel } from '../PreviewPanel';
import type { PanelRouter } from '../PanelRouter';
import type { StateHub } from '../StateHub';

function createStateHub() {
  const state = { currentComponent: null, insertTargetId: null, selectedIds: [] };
  return { state, applyUpdate: mock(() => {}) } as unknown as StateHub;
}

/** A webview.postMessage that throws exactly like a disposed VS Code webview. */
function disposedPostMessage() {
  return mock(() => {
    throw new Error('Webview is disposed');
  });
}

function createPreviewPanelWithDisposedWebview() {
  Object.assign(vscode.workspace, {
    workspaceFolders: [{ uri: vscode.Uri.file('/workspace'), name: 'workspace', index: 0 }],
  });
  const panel = new PreviewPanel(
    vscode.Uri.file('/extension'),
    '/workspace',
    createStateHub(),
    {
      setSubProjectPrefix: mock(() => {}),
      astBridge: { setSubProjectPrefix: mock(() => {}) },
    } as unknown as PanelRouter,
    {} as vscode.ExtensionContext,
  );
  const postMessage = disposedPostMessage();
  const dispose = mock(() => {});
  Object.assign(panel as PreviewPanel & { _panel: unknown }, {
    _panel: { dispose, webview: { postMessage } },
  });
  return { panel, postMessage };
}

describe('isWebviewDisposedError', () => {
  it('matches the VS Code disposed-webview Error', () => {
    expect(isWebviewDisposedError(new Error('Webview is disposed'))).toBe(true);
    expect(isWebviewDisposedError(new Error('WEBVIEW IS DISPOSED'))).toBe(true);
    expect(isWebviewDisposedError('Webview is disposed')).toBe(true);
  });

  it('does not match unrelated errors', () => {
    expect(isWebviewDisposedError(new Error('something else'))).toBe(false);
    expect(isWebviewDisposedError(undefined)).toBe(false);
    expect(isWebviewDisposedError(null)).toBe(false);
  });
});

describe('postToWebviewSafe', () => {
  it('returns false and never throws when the webview is disposed; invokes onDisposed', () => {
    const onDisposed = mock(() => {});
    const panel = { webview: { postMessage: disposedPostMessage() } } as unknown as vscode.WebviewPanel;

    let result: boolean | undefined;
    expect(() => {
      result = postToWebviewSafe(panel, { type: 'x' }, onDisposed);
    }).not.toThrow();

    expect(result).toBe(false);
    expect(onDisposed).toHaveBeenCalledTimes(1);
  });

  it('returns false for an undefined panel without calling onDisposed', () => {
    const onDisposed = mock(() => {});
    expect(postToWebviewSafe(undefined, { type: 'x' }, onDisposed)).toBe(false);
    expect(onDisposed).not.toHaveBeenCalled();
  });

  it('rethrows errors that are NOT the disposed-webview race', () => {
    const panel = {
      webview: {
        postMessage: mock(() => {
          throw new Error('structured clone failed');
        }),
      },
    } as unknown as vscode.WebviewPanel;
    expect(() => postToWebviewSafe(panel, { type: 'x' })).toThrow('structured clone failed');
  });

  it('posts and returns true on a live webview', () => {
    const postMessage = mock(() => Promise.resolve(true));
    const panel = { webview: { postMessage } } as unknown as vscode.WebviewPanel;
    expect(postToWebviewSafe(panel, { type: 'x' })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: 'x' });
  });
});

describe('PreviewPanel reuse-after-dispose guard', () => {
  it('does not throw when posting to a disposed webview (worker is not poisoned)', () => {
    const { panel } = createPreviewPanelWithDisposedWebview();
    // notifyUnsupportedProject posts unconditionally via _postToWebview.
    expect(() => panel.notifyUnsupportedProject(null)).not.toThrow();
  });

  it('clears the stale _panel reference so the next createOrShow rebuilds', () => {
    const { panel } = createPreviewPanelWithDisposedWebview();
    panel.notifyUnsupportedProject(null);
    expect((panel as PreviewPanel & { _panel: unknown })._panel).toBeUndefined();
  });

  it('survives a disposed webview on the setComponentParam ensure path', () => {
    const { panel } = createPreviewPanelWithDisposedWebview();
    Object.assign(panel as PreviewPanel & { _devServerRunning: boolean }, { _devServerRunning: false });
    expect(() => panel.setComponentParam('src/App.tsx', 'src/App.tsx')).not.toThrow();
  });
});

describe('injectGeneratedSampleProps reuse-after-dispose guard', () => {
  it('does not throw and reports onDisposed when the webview is disposed mid-flight', async () => {
    const onDisposed = mock(() => {});
    const panel = { webview: { postMessage: disposedPostMessage() } } as unknown as vscode.WebviewPanel;
    const panelRouter = {
      componentService: { getComponent: mock(() => Promise.resolve({ name: 'App', props: [] })) },
    } as unknown as PanelRouter;

    let result: boolean | undefined;
    await expect(
      (async () => {
        result = await injectGeneratedSampleProps(panel, panelRouter, 'src/App.tsx', 'src/App.tsx', onDisposed);
      })(),
    ).resolves.toBeUndefined();

    expect(result).toBe(false);
    expect(onDisposed).toHaveBeenCalledTimes(1);
  });
});

/**
 * A panel mock whose `dispose()` fires registered onDidDispose handlers — mirrors the
 * pattern in PreviewPanel.test.ts `createMockPreviewWebviewPanel`. The webview is a no-op
 * surface (setupPanel writes html, registers a message listener, and a file listener).
 */
function createDisposablePanelMock() {
  const disposeHandlers: Array<() => void> = [];
  const webview = {
    options: {} as unknown,
    postMessage: mock(() => Promise.resolve(true)),
    onDidReceiveMessage: mock(() => ({ dispose: mock() })),
    asWebviewUri: (uri: vscode.Uri) => uri,
  };
  Object.defineProperty(webview, 'html', { set: mock(), get: () => '' });
  const panel = {
    webview,
    iconPath: undefined as unknown,
    reveal: mock(),
    dispose: mock(() => {
      for (const handler of disposeHandlers) handler();
    }),
    onDidDispose(handler: () => void) {
      disposeHandlers.push(handler);
      return { dispose: mock() };
    },
  };
  return panel as unknown as vscode.WebviewPanel & { dispose: ReturnType<typeof mock> };
}

/**
 * Build PanelSetupDeps backed by mutable fields, like PreviewPanel wires them. getPanel
 * returns the LATEST panel handed to setPanel, so the identity gate can distinguish a
 * superseded panel from the current one.
 */
function createSetupDeps() {
  let currentPanel: vscode.WebviewPanel | undefined;
  let disposables: vscode.Disposable[] = [];
  const stateHub = {
    register: mock(() => {}),
    unregister: mock(() => {}),
    onChange: mock(() => () => {}),
    state: { currentComponent: null },
  } as unknown as StateHub & { register: ReturnType<typeof mock>; unregister: ReturnType<typeof mock> };
  const panelRouter = { setAstResponseTarget: mock(() => {}) } as unknown as PanelRouter;
  const deps: PanelSetupDeps = {
    extensionUri: vscode.Uri.file('/extension'),
    stateHub,
    panelRouter,
    setPanel: (p) => {
      currentPanel = p;
    },
    getPanel: () => currentPanel,
    getDisposables: () => disposables,
    setDisposables: (d) => {
      disposables = d;
    },
    getCurrentComponent: () => undefined,
    getReEmitTimer: () => null,
    setReEmitTimer: () => {},
    getSampleWatcher: () => undefined,
    setSampleWatcher: () => {},
    getSyncService: () => undefined,
    setSyncService: () => {},
    getHtmlForWebview: () => '<html></html>',
    handleMessage: () => Promise.resolve(),
    updateComponentFromEditor: () => {},
    dispatch: () => [],
    startSyncService: () => {},
    initializeComponent: () => {},
  };
  return { deps, stateHub, getPanel: () => currentPanel, getDisposables: () => disposables };
}

describe('setupPanel onDidDispose identity gate', () => {
  it('a superseded panel onDidDispose does NOT tear down the current panel resources', () => {
    const { deps, stateHub, getDisposables } = createSetupDeps();
    const panelA = createDisposablePanelMock();
    const panelB = createDisposablePanelMock();

    setupPanel(deps, panelA, undefined, 'preview');
    // panelB replaces panelA as the current panel and owns the (reset) disposables.
    setupPanel(deps, panelB, undefined, 'preview');

    const currentDisposables = getDisposables();
    const disposeSpies = currentDisposables.map((d) => mock(d.dispose));
    currentDisposables.forEach((d, i) => {
      d.dispose = disposeSpies[i];
    });
    stateHub.unregister.mockClear();

    // Fire the STALE onDidDispose from the superseded panelA.
    panelA.dispose();

    // The gate returns early: panelB's disposables and stateHub registration survive.
    for (const spy of disposeSpies) expect(spy).not.toHaveBeenCalled();
    expect(stateHub.unregister).not.toHaveBeenCalled();
    expect(getPanelStillCurrent(deps, panelB)).toBe(true);
  });

  it('the current panel onDidDispose DOES run teardown', () => {
    const { deps, stateHub } = createSetupDeps();
    const panel = createDisposablePanelMock();

    setupPanel(deps, panel, undefined, 'preview');
    stateHub.unregister.mockClear();

    panel.dispose();

    expect(stateHub.unregister).toHaveBeenCalledTimes(1);
  });
});

function getPanelStillCurrent(deps: PanelSetupDeps, panel: vscode.WebviewPanel): boolean {
  return deps.getPanel() === panel;
}

describe('watchSampleInFile survives a disposed webview', () => {
  it('does not throw and disposes the watcher when onDidDelete posts to a disposed webview', () => {
    let deleteHandler: (() => void) | undefined;
    const watcherDispose = mock(() => {});
    Object.assign(vscode.workspace, {
      createFileSystemWatcher: mock(() => ({
        onDidChange: mock(() => ({ dispose: mock() })),
        onDidCreate: mock(() => ({ dispose: mock() })),
        onDidDelete: mock((handler: () => void) => {
          deleteHandler = handler;
          return { dispose: mock() };
        }),
        dispose: watcherDispose,
      })),
    });

    const webview = { postMessage: disposedPostMessage() } as unknown as vscode.Webview;
    const state: { watcher?: vscode.Disposable } = {};
    watchSampleInFile(state, '/workspace/src/App.tsx', 'SampleDefault', webview);

    expect(deleteHandler).toBeDefined();
    expect(() => deleteHandler?.()).not.toThrow();
    // The watcher is torn down so it can't fire forever against the dead webview.
    expect(watcherDispose).toHaveBeenCalled();
    expect(state.watcher).toBeUndefined();
  });
});
