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
  visible: boolean;
  onDidDispose: (handler: () => void) => { dispose: () => void };
  onDidChangeVisibility: (handler: () => void) => { dispose: () => void };
  fireDispose: () => void;
  fireVisibilityChange: (visible: boolean) => void;
}

interface MockWebviewViewOptions {
  onHtmlWrite?: (webview: MockWebview, writeCount: number) => void;
}

function createMockWebviewView(options: MockWebviewViewOptions = {}): MockWebviewView {
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
      options.onHtmlWrite?.(webview, webview.htmlWrites.length);
    },
  });

  const visibilityHandlers: Array<() => void> = [];
  const view: MockWebviewView = {
    webview,
    visible: true,
    onDidDispose(handler: () => void) {
    disposeHandlers.push(handler);
    return { dispose: mock() };
  },
    onDidChangeVisibility(handler: () => void) {
      visibilityHandlers.push(handler);
      return { dispose: mock() };
    },
    fireDispose() {
    for (const handler of disposeHandlers) handler();
  },
    fireVisibilityChange(visible: boolean) {
      view.visible = visible;
      for (const handler of visibilityHandlers) handler();
    },
  };
  return view;
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

  it('RightPanelProvider accepts webview:ready fired during the initial HTML write', async () => {
    let firedInitialReady = false;
    const view = createMockWebviewView({
      onHtmlWrite(webview, writeCount) {
        if (writeCount === 1 && !firedInitialReady) {
          firedInitialReady = true;
          webview.fireMessage({ type: 'webview:ready' });
        }
      },
    });
    const stateHub = createStateHub();
    const provider = new RightPanelProvider(
      vscode.Uri.file('/extension'),
      stateHub as never,
      { routeMessage: mock(() => Promise.resolve(false)) } as never,
    );

    provider.resolveWebviewView(view as never, {} as never, {} as never);
    await flushPromises();

    expect(stateHub.sendInit).toHaveBeenCalledWith(RightPanelProvider.viewType);

    await provider.resetIfNotReady();
    expect(view.webview.htmlWrites).toHaveLength(1);
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

interface CapturedEvent {
  name: string;
  props: Record<string, string | number | boolean>;
}

function captureSink(): {
  sink: { track: (n: string, p?: Record<string, string | number | boolean>) => void; trackFromWebview: () => void };
  events: CapturedEvent[];
} {
  const events: CapturedEvent[] = [];
  return {
    events,
    sink: {
      track: (name, props) => events.push({ name, props: props ?? {} }),
      trackFromWebview: () => {},
    },
  };
}

function makeRightPanel(): RightPanelProvider {
  return new RightPanelProvider(
    vscode.Uri.file('/extension'),
    createStateHub() as never,
    { routeMessage: mock(() => Promise.resolve(false)) } as never,
  );
}

describe('inspector.toggled telemetry', () => {
  it('emits inspector.toggled { open: true } on initial visible resolve, with no PII', () => {
    const { sink, events } = captureSink();
    const provider = makeRightPanel();
    provider.setTelemetry(sink as never);

    const view = createMockWebviewView();
    view.visible = true;
    provider.resolveWebviewView(view as never, {} as never, {} as never);

    const toggled = events.filter((e) => e.name === 'inspector.toggled');
    expect(toggled).toHaveLength(1);
    expect(toggled[0].props).toEqual({ open: true });
    // Only a boolean — nothing that could carry a path / element / content.
    expect(Object.keys(toggled[0].props)).toEqual(['open']);
  });

  it('emits on each genuine show/hide and dedupes a repeated same-state event', () => {
    const { sink, events } = captureSink();
    const provider = makeRightPanel();
    provider.setTelemetry(sink as never);

    const view = createMockWebviewView();
    view.visible = true;
    provider.resolveWebviewView(view as never, {} as never, {} as never);

    view.fireVisibilityChange(false); // hide  → emit { open: false }
    view.fireVisibilityChange(false); // same  → deduped (no emit)
    view.fireVisibilityChange(true); // show   → emit { open: true }

    const toggled = events.filter((e) => e.name === 'inspector.toggled');
    expect(toggled.map((e) => e.props.open)).toEqual([true, false, true]);
  });

  it('is a no-op when no telemetry sink is set (telemetry disabled / no keys)', () => {
    const provider = makeRightPanel();
    const view = createMockWebviewView();
    // No setTelemetry — must not throw.
    expect(() => {
      provider.resolveWebviewView(view as never, {} as never, {} as never);
      view.fireVisibilityChange(false);
    }).not.toThrow();
  });
});
