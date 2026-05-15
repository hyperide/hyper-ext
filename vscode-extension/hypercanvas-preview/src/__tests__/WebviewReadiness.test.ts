/**
 * @file Webview readiness tests for recovering blank sidebar panels
 *
 * Accessed via: bun test vscode-extension/hypercanvas-preview/src/__tests__/WebviewReadiness.test.ts
 * Assumptions: webview apps post webview:ready after React mounts; providers can
 *   safely rewrite HTML only after the view is focused or when tests call reset directly.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { AIChatPanelProvider } from '../AIChatPanelProvider';
import { RightPanelProvider } from '../RightPanelProvider';

interface MockWebview {
  options: unknown;
  html: string;
  htmlWrites: string[];
  postMessage: ReturnType<typeof mock>;
  onDidReceiveMessage: (handler: (message: { type?: string }) => void) => { dispose: () => void };
  asWebviewUri: (uri: vscode.Uri) => vscode.Uri;
  fireMessage: (message: { type?: string }) => void;
}

interface MockWebviewView {
  webview: MockWebview;
  onDidDispose: (handler: () => void) => { dispose: () => void };
  fireDispose: () => void;
}

function createMockWebviewView(): MockWebviewView {
  const messageHandlers: Array<(message: { type?: string }) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const webview = {
    options: {},
    html: '',
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
    },
  });

  return {
    webview,
    onDidDispose(handler: () => void) {
      disposeHandlers.push(handler);
      return { dispose: mock() };
    },
    fireDispose() {
      for (const handler of disposeHandlers) handler();
    },
  };
}

function createStateHub() {
  return {
    register: mock(),
    unregister: mock(),
    sendInit: mock(),
  };
}

function createContext() {
  return {
    globalStorageUri: vscode.Uri.file('/tmp/hyper-test-storage'),
    secrets: {
      get: mock(() => Promise.resolve(undefined)),
      onDidChange: mock(() => ({ dispose: mock() })),
    },
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('sidebar webview readiness recovery', () => {
  it('RightPanelProvider resets unresolved webview HTML and stops resetting after webview:ready', async () => {
    const view = createMockWebviewView();
    const provider = new RightPanelProvider(
      vscode.Uri.file('/extension'),
      createStateHub() as never,
      { routeMessage: mock(() => Promise.resolve(false)) } as never,
    );

    provider.resolveWebviewView(view as never, {} as never, {} as never);
    expect(view.webview.htmlWrites).toHaveLength(1);

    const pendingReset = provider.resetIfNotReady();
    expect(view.webview.htmlWrites).toHaveLength(2);
    view.webview.fireMessage({ type: 'webview:ready' });
    await pendingReset;

    await provider.resetIfNotReady();
    expect(view.webview.htmlWrites).toHaveLength(2);
  });

  it('AIChatPanelProvider resets unresolved webview HTML and stops resetting after webview:ready', async () => {
    const view = createMockWebviewView();
    const provider = new AIChatPanelProvider(
      vscode.Uri.file('/extension'),
      '/workspace',
      createContext() as never,
      createStateHub() as never,
    );

    provider.resolveWebviewView(view as never, {} as never, {} as never);
    expect(view.webview.htmlWrites).toHaveLength(1);

    const pendingReset = provider.resetIfNotReady();
    expect(view.webview.htmlWrites).toHaveLength(2);
    view.webview.fireMessage({ type: 'webview:ready' });
    await pendingReset;

    await provider.resetIfNotReady();
    expect(view.webview.htmlWrites).toHaveLength(2);
  });

  it('AIChatPanelProvider queues prompts until the chat webview is ready', async () => {
    const view = createMockWebviewView();
    const provider = new AIChatPanelProvider(
      vscode.Uri.file('/extension'),
      '/workspace',
      createContext() as never,
      createStateHub() as never,
    );

    provider.resolveWebviewView(view as never, {} as never, {} as never);
    await flushPromises();
    view.webview.postMessage.mockClear();

    provider.sendAIPrompt('fix the failed dev server');
    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('hypercanvas.aiChatView.focus');
    expect(view.webview.postMessage).not.toHaveBeenCalledWith({
      type: 'ai:openChat',
      prompt: 'fix the failed dev server',
    });

    view.webview.fireMessage({ type: 'webview:ready' });
    await flushPromises();

    expect(view.webview.postMessage).toHaveBeenCalledWith({
      type: 'ai:openChat',
      prompt: 'fix the failed dev server',
    });
  });
});
