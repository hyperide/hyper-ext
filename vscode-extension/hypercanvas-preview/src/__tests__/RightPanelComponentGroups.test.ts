/**
 * @file Inspector component-groups delivery tests (BUG A — component list broken when Explorer closed)
 *
 * Accessed via: RightPanelProvider pushes `inspector:componentGroups` to the Inspector webview,
 *   which renders the ComponentQuickList fallback when the Explorer side bar is hidden.
 * Assumptions: scanner returns atom/composite/PAGE groups; the Inspector must receive ALL of them,
 *   and must get a FRESH push the moment the Explorer is hidden (the list becomes the active UI then).
 *
 * Regression guard for two defects:
 *  1. `_sendComponentGroups` dropped `pageGroups` — page-level components never reached the Inspector.
 *  2. Component groups were sent ONCE on `webview:ready` and never refreshed; if the scan was empty
 *     at mount (cold cache / workspace not ready) the closed-Explorer list stayed permanently empty.
 */
import { describe, expect, it, mock } from 'bun:test';
import * as vscode from 'vscode';
import { RightPanelProvider } from '../RightPanelProvider';
import type { ComponentsData } from '../../../../lib/component-scanner/types';

interface PostCall {
  type?: string;
  [key: string]: unknown;
}

function createMockWebviewView() {
  const messageHandlers: Array<(message: { type?: string }) => void> = [];
  const disposeHandlers: Array<() => void> = [];
  const posts: PostCall[] = [];
  const webview = {
    options: {},
    html: '',
    postMessage: mock((message: PostCall) => {
      posts.push(message);
      return Promise.resolve(true);
    }),
    onDidReceiveMessage(handler: (message: { type?: string }) => void) {
      messageHandlers.push(handler);
      return { dispose: mock() };
    },
    asWebviewUri(uri: vscode.Uri) {
      return uri;
    },
  };
  const visibilityHandlers: Array<() => void> = [];
  return {
    posts,
    view: {
      webview,
      visible: true,
      onDidDispose(handler: () => void) {
        disposeHandlers.push(handler);
        return { dispose: mock() };
      },
      // Inspector self-visibility aggregator (#92) — RightPanelProvider subscribes on resolve.
      onDidChangeVisibility(handler: () => void) {
        visibilityHandlers.push(handler);
        return { dispose: mock() };
      },
    },
    fireVisibility() {
      for (const handler of visibilityHandlers) handler();
    },
    fireMessage(message: { type?: string }) {
      for (const handler of messageHandlers) handler(message);
    },
    fireDispose() {
      for (const handler of disposeHandlers) handler();
    },
  };
}

/** Mock LeftPanelProvider exposing the visibility surface RightPanelProvider consumes. */
function createMockLeftPanel(initialVisible: boolean) {
  let cb: ((visible: boolean) => void) | undefined;
  let visible = initialVisible;
  return {
    get visible() {
      return visible;
    },
    onVisibilityChange(handler: (visible: boolean) => void) {
      cb = handler;
    },
    setVisible(next: boolean) {
      visible = next;
      cb?.(next);
    },
  };
}

function emptyComponentsData(): ComponentsData {
  return { atomGroups: [], compositeGroups: [], pageGroups: [] };
}

function componentsDataWithPages(): ComponentsData {
  return {
    atomGroups: [],
    compositeGroups: [{ dirPath: 'src/components', components: [{ name: 'Tweet', path: 'src/components/Tweet.tsx' }] }],
    pageGroups: [{ dirPath: 'src', components: [{ name: 'App', path: 'src/App.tsx' }] }],
  };
}

/**
 * Monorepo shape: the scanner leaves the FLAT `pageGroups` empty and parks the real pages under
 * `subProjects[].pageGroups` (avoids double-render in the SaaS PagesSection). The Inspector
 * quick-list is one flat list, so it must fold the sub-project pages in via `toPickerGroups`.
 */
function componentsDataMonorepoPages(): ComponentsData {
  return {
    atomGroups: [],
    compositeGroups: [],
    pageGroups: [],
    isMonorepo: true,
    subProjects: [
      {
        name: 'web',
        path: 'targets/web',
        supported: true,
        atomGroups: [],
        compositeGroups: [],
        pageGroups: [{ dirPath: 'targets/web/app', components: [{ name: 'Home', path: 'targets/web/app/Home.tsx' }] }],
      },
    ],
  };
}

function createStateHub() {
  return { register: mock(), unregister: mock(), sendInit: mock(), applyUpdate: mock() };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function groupPosts(posts: PostCall[]): PostCall[] {
  return posts.filter((p) => p.type === 'inspector:componentGroups');
}

describe('RightPanelProvider component-groups delivery (BUG A)', () => {
  function setup(data: ComponentsData, leftVisible: boolean) {
    const mockView = createMockWebviewView();
    const left = createMockLeftPanel(leftVisible);
    const provider = new RightPanelProvider(
      vscode.Uri.file('/extension'),
      createStateHub() as never,
      { routeMessage: mock(() => Promise.resolve(false)) } as never,
      left as never,
      () => Promise.resolve({ data }),
    );
    provider.resolveWebviewView(mockView.view as never, {} as never, {} as never);
    return { provider, mockView, left };
  }

  it('forwards pageGroups to the Inspector (not just atoms + composites)', async () => {
    const { mockView } = setup(componentsDataWithPages(), true);
    mockView.fireMessage({ type: 'webview:ready' });
    await flushPromises();

    const groups = groupPosts(mockView.posts);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const last = groups.at(-1)!;
    expect(last.pageGroups).toBeDefined();
    expect((last.pageGroups as unknown[]).length).toBe(1);
  });

  it('folds monorepo sub-project pages into the flat pageGroups (toPickerGroups)', async () => {
    // Monorepo scan: flat pageGroups is [] but subProjects[].pageGroups holds the real pages.
    // Without toPickerGroups those pages never reach the Inspector quick-list.
    const { mockView } = setup(componentsDataMonorepoPages(), true);
    mockView.fireMessage({ type: 'webview:ready' });
    await flushPromises();

    const last = groupPosts(mockView.posts).at(-1)!;
    const pageGroups = last.pageGroups as Array<{ components: Array<{ name: string }> }>;
    expect(pageGroups.length).toBe(1);
    expect(pageGroups[0]!.components.map((c) => c.name)).toEqual(['Home']);
  });

  it('re-sends component groups when the Explorer becomes hidden (refresh, not once-only)', async () => {
    const { mockView, left } = setup(componentsDataWithPages(), true);
    mockView.fireMessage({ type: 'webview:ready' });
    await flushPromises();

    const initialCount = groupPosts(mockView.posts).length;
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Explorer is collapsed → Inspector quick-list becomes the active UI → must refresh.
    left.setVisible(false);
    await flushPromises();

    expect(groupPosts(mockView.posts).length).toBeGreaterThan(initialCount);
  });

  it('recovers when the first scan at mount was empty but later returns components', async () => {
    // Simulate cold cache: first call empty, subsequent calls populated.
    const mockView = createMockWebviewView();
    const left = createMockLeftPanel(true);
    let call = 0;
    const provider = new RightPanelProvider(
      vscode.Uri.file('/extension'),
      createStateHub() as never,
      { routeMessage: mock(() => Promise.resolve(false)) } as never,
      left as never,
      () => Promise.resolve({ data: call++ === 0 ? emptyComponentsData() : componentsDataWithPages() }),
    );
    provider.resolveWebviewView(mockView.view as never, {} as never, {} as never);
    mockView.fireMessage({ type: 'webview:ready' });
    await flushPromises();

    // First push was empty.
    expect(groupPosts(mockView.posts).at(-1)!.compositeGroups).toEqual([]);

    // Hiding the Explorer triggers a refresh that now carries the components.
    left.setVisible(false);
    await flushPromises();

    const last = groupPosts(mockView.posts).at(-1)!;
    expect((last.compositeGroups as unknown[]).length).toBe(1);
  });
});
