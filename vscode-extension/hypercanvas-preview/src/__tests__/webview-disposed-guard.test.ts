/**
 * @file Disposed-webview reuse guard tests.
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/webview-disposed-guard.test.ts
 *
 * Bug guarded here: a cached webview reference can outlive the webview it wraps. VS Code
 * fires `onDidDispose` (which nulls the cached ref) ASYNCHRONOUSLY, so between disposal
 * and the callback running there is a window where the ref is non-null but its webview is
 * dead. A plain `ref?.webview.postMessage(...)` guards only `ref === undefined`, NOT
 * "disposed", so it threw `Error: Webview is disposed` — which escaped the per-call guards
 * and poisoned the shared extension-host worker into a cascade of dead-preview failures.
 *
 * Covers all three providers that hold such a cached ref:
 * - `PreviewPanel._panel` (the original #514 cascade) — `_postToWebview` / `_clearDisposedPanel`.
 * - `RightPanelProvider._view` — `notifyCapabilities` and the async `_sendComponentGroups`.
 * - `AIChatPanelProvider._view` — `sendAIPrompt`, the streaming `ai:chat` callback, and `_sendKeyStatus`.
 *
 * The guard converts that worker-poisoning throw into a graceful no-op and drops the
 * stale reference so the next `createOrShow` / `resolveWebviewView` rebuilds a fresh one.
 */

import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { isWebviewDisposedError, postToWebviewSafe } from '../webview-post';
import { injectGeneratedSampleProps, watchSampleInFile } from '../preview-panel-sample';
import { setupPanel, type PanelSetupDeps } from '../preview-panel-setup';
import { PreviewPanel } from '../PreviewPanel';
import { RightPanelProvider } from '../RightPanelProvider';
import { AIChatPanelProvider } from '../AIChatPanelProvider';
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

/**
 * A disposed `WebviewView`: its `webview.postMessage` throws exactly like VS Code does
 * after the underlying webview is torn down. The sidebar providers (RightPanelProvider,
 * AIChatPanelProvider) cache `this._view` and null it only in an ASYNC `onDidDispose`,
 * so the same reuse-after-dispose race PR #514 fixed for PreviewPanel is latent here:
 * a post fired after disposal (workspace switch, secrets/visibility callback, streaming
 * AI event) would throw `Webview is disposed` and poison the extension-host worker.
 */
function disposedWebviewView() {
  return { webview: { postMessage: disposedPostMessage() } } as unknown as vscode.WebviewView;
}

/** Reach the private `_view` field of a sidebar provider in tests. */
type WithView = { _view: vscode.WebviewView | undefined };

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

/** The private surface of RightPanelProvider exercised by these tests. */
type RightInternals = RightPanelProvider &
  WithView & {
    _sendComponentGroups: () => Promise<void>;
  };

describe('RightPanelProvider reuse-after-dispose guard', () => {
  function createProvider(getComponentGroups?: () => Promise<unknown>) {
    return new RightPanelProvider(
      vscode.Uri.file('/extension'),
      { register: mock(() => {}), unregister: mock(() => {}) } as unknown as StateHub,
      { routeMessage: mock(() => Promise.resolve()) } as unknown as PanelRouter,
      undefined,
      getComponentGroups as (() => Promise<import('../services/ComponentService').ScanResult>) | undefined,
    );
  }

  function createProviderWithDisposedView(getComponentGroups?: () => Promise<unknown>) {
    const provider = createProvider(getComponentGroups) as RightInternals;
    Object.assign(provider, { _view: disposedWebviewView() });
    return provider;
  }

  it('does not throw when notifyCapabilities posts to a disposed view', () => {
    const provider = createProviderWithDisposedView();
    expect(() => provider.notifyCapabilities(null)).not.toThrow();
  });

  it('clears the stale _view so the next resolveWebviewView rebuilds', () => {
    const provider = createProviderWithDisposedView();
    provider.notifyCapabilities(null);
    expect(provider._view).toBeUndefined();
  });

  it('survives a view disposed across the _sendComponentGroups await (workspace switch in flight)', async () => {
    // The single most likely real-world hit: a component scan is in flight when the
    // view is torn down. The post lands AFTER the await on an already-dead webview.
    let resolveScan!: (r: unknown) => void;
    const scan = new Promise<unknown>((resolve) => {
      resolveScan = resolve;
    });
    const provider = createProviderWithDisposedView(() => scan);

    const sendPromise = provider._sendComponentGroups();
    // Resolve the scan only now — the post fires here, against the disposed view.
    resolveScan({ data: { atomGroups: [], compositeGroups: [] } });

    await expect(sendPromise).resolves.toBeUndefined();
    expect(provider._view).toBeUndefined();
  });
});

/** The private surface of AIChatPanelProvider exercised by these tests. */
type AIChatInternals = AIChatPanelProvider &
  WithView & {
    _ready: boolean;
    _pendingAIPrompt: string | null;
    _chatHistory: { listChats: () => Promise<unknown[]> };
    _postToWebview: (message: unknown) => boolean;
    _sendKeyStatus: () => Promise<void>;
    _handleMessage: (message: { type?: string; [key: string]: unknown }) => Promise<void>;
    _flushPendingPrompt: () => void;
  };

describe('AIChatPanelProvider reuse-after-dispose guard', () => {
  function createProvider() {
    const context = {
      globalStorageUri: { fsPath: '/tmp/hypercanvas-test' },
      secrets: { get: mock(() => Promise.resolve(undefined)), onDidChange: mock(() => ({ dispose: mock() })) },
    } as unknown as vscode.ExtensionContext;
    const provider = new AIChatPanelProvider(vscode.Uri.file('/extension'), '/workspace', context, {
      register: mock(() => {}),
      unregister: mock(() => {}),
    } as unknown as StateHub) as AIChatInternals;
    // Stub history I/O so the chat:* handler test is deterministic — no real fs hit.
    provider._chatHistory = { listChats: mock(() => Promise.resolve([])) };
    return provider;
  }

  function createProviderWithDisposedView() {
    const provider = createProvider();
    // sendAIPrompt only posts when the view is present AND ready.
    Object.assign(provider, { _view: disposedWebviewView(), _ready: true });
    return provider;
  }

  it('does not throw when sendAIPrompt posts to a disposed view', () => {
    const provider = createProviderWithDisposedView();
    expect(() => provider.sendAIPrompt('hello')).not.toThrow();
  });

  it('clears the stale _view so the next resolveWebviewView rebuilds', () => {
    const provider = createProviderWithDisposedView();
    provider.sendAIPrompt('hello');
    expect(provider._view).toBeUndefined();
  });

  it('re-queues the prompt as pending when the disposal race swallows the sendAIPrompt post', () => {
    // Regression guard: the post fails silently on a disposed view, so the prompt must
    // fall back to _pendingAIPrompt to be replayed when the rebuilt view becomes ready.
    const provider = createProviderWithDisposedView();
    provider.sendAIPrompt('hello');
    expect(provider._pendingAIPrompt).toBe('hello');
  });

  it('keeps the pending prompt when the flush itself races a disposal', () => {
    // The view can be disposed between `webview:ready` and _flushPendingPrompt. The flush
    // must NOT clear _pendingAIPrompt unless the post actually landed.
    const provider = createProviderWithDisposedView();
    provider._pendingAIPrompt = 'queued';
    expect(() => provider._flushPendingPrompt()).not.toThrow();
    expect(provider._pendingAIPrompt).toBe('queued');
  });

  it('a late streaming ai:chat event after disposal is a no-op, not a throw', () => {
    // The handleChat callback fires over many ticks; the view can be disposed mid-stream.
    const provider = createProviderWithDisposedView();
    expect(() => provider._postToWebview({ type: 'ai:streamChunk', text: 'x' })).not.toThrow();
    expect(provider._view).toBeUndefined();
  });

  it('a chat:* handler that awaits then posts is a no-op when the view is already disposed', async () => {
    // chat:list/create/load/delete all `await` history I/O then post via _postToWebview —
    // the post-after-await shape. Exercised end-to-end via _handleMessage against a
    // disposed view (history I/O stubbed to keep it deterministic, no real fs).
    const provider = createProviderWithDisposedView();
    await expect(provider._handleMessage({ type: 'chat:list' })).resolves.toBeUndefined();
    expect(provider._view).toBeUndefined();
  });

  it('a _sendKeyStatus from secrets.onDidChange after disposal is a no-op, not a throw', async () => {
    const provider = createProviderWithDisposedView();
    await expect(provider._sendKeyStatus()).resolves.toBeUndefined();
    expect(provider._view).toBeUndefined();
  });
});
