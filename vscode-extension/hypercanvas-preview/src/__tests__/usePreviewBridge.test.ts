/**
 * @file Preview bridge URL helper tests
 *
 * Accessed via: Hyper Canvas preview webview when switching the selected component
 * Assumptions: an iframe at about:blank has not loaded the preview app and must be navigated.
 * Past bugs: HYP-363 — updateUrl was sent as postMessage into about:blank, leaving preview empty.
 * Past bugs: HYP-363 — state:update forwarded raw to iframe instead of as hypercanvas:stateUpdate.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */
import { describe, expect, it, mock } from 'bun:test';
import { act, createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { CanvasAdapter, PlatformMessage } from '@/lib/platform/types';
import {
  buildComponentPreviewUrl,
  canUpdatePreviewComponentInPlace,
  getComponentFromPreviewUrl,
  hasNavigatedPreviewSource,
  shouldNavigateFrameToComponent,
  shouldNavigateFromSharedStateMessage,
  usePreviewBridge,
} from '../webview-preview-panel/usePreviewBridge';

type BridgeSnapshot = {
  previewUrl: string | null;
  devServerRunning: boolean;
};

function createCanvasAdapter(): CanvasAdapter {
  return {
    sendEvent: <T extends PlatformMessage>(_message: T) => {},
    onEvent: () => () => {},
  };
}

function postHostMessage(data: Record<string, unknown>): void {
  window.dispatchEvent(new window.MessageEvent('message', { data }));
}

function BridgeHarness({ onSnapshot }: { onSnapshot: (snapshot: BridgeSnapshot) => void }) {
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);
  const bridge = usePreviewBridge({
    iframeEl,
    canvas: createCanvasAdapter(),
    onStateUpdate: () => {},
  });

  useEffect(() => {
    onSnapshot({
      previewUrl: bridge.previewUrl,
      devServerRunning: bridge.devServerRunning,
    });
  }, [bridge.devServerRunning, bridge.previewUrl, onSnapshot]);

  return createElement('iframe', { ref: setIframeEl, title: 'preview' });
}

function renderBridge(onSnapshot: (snapshot: BridgeSnapshot) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(BridgeHarness, { onSnapshot }));
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

type PostMessageSpy = ReturnType<typeof mock>;

function BridgeWithSpy({ onSpy }: { onSpy: (spy: PostMessageSpy) => void }) {
  const [iframeEl, setIframeEl] = useState<HTMLIFrameElement | null>(null);
  const spy = mock();
  usePreviewBridge({
    iframeEl,
    canvas: createCanvasAdapter(),
    onStateUpdate: () => {},
  });

  const refCallback = (el: HTMLIFrameElement | null) => {
    if (el?.contentWindow) {
      // @ts-expect-error -- override for test spy
      el.contentWindow.postMessage = spy;
      onSpy(spy);
    }
    setIframeEl(el);
  };

  return createElement('iframe', { ref: refCallback, title: 'preview' });
}

function renderBridgeWithSpy(onSpy: (spy: PostMessageSpy) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(BridgeWithSpy, { onSpy }));
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

describe('preview bridge URL helpers', () => {
  it('builds component preview URL with encoded component path', () => {
    expect(buildComponentPreviewUrl('http://localhost:5173/', 'src/components/Foo Bar.tsx')).toBe(
      'http://localhost:5173/test-preview?component=src%2Fcomponents%2FFoo%20Bar.tsx',
    );
  });

  it('treats about:blank as not navigated', () => {
    expect(hasNavigatedPreviewSource('about:blank')).toBe(false);
    expect(hasNavigatedPreviewSource('')).toBe(false);
    expect(hasNavigatedPreviewSource(null)).toBe(false);
    expect(hasNavigatedPreviewSource('http://localhost:5173/test-preview?component=src%2FApp.tsx')).toBe(true);
  });

  it('reads the current iframe component from preview URL', () => {
    expect(getComponentFromPreviewUrl('http://localhost:5173/test-preview')).toBe(null);
    expect(getComponentFromPreviewUrl('about:blank')).toBe(null);
    expect(getComponentFromPreviewUrl('not a url')).toBe(null);
    expect(getComponentFromPreviewUrl('http://localhost:5173/test-preview?component=src%2FApp.tsx')).toBe(
      'src/App.tsx',
    );
  });

  it('requires navigation when the frame loaded a bare preview route', () => {
    expect(shouldNavigateFrameToComponent('http://localhost:5173/test-preview', 'src/App.tsx')).toBe(true);
    expect(
      shouldNavigateFrameToComponent('http://localhost:5173/test-preview?component=src%2FOther.tsx', 'src/App.tsx'),
    ).toBe(true);
    expect(
      shouldNavigateFrameToComponent('http://localhost:5173/test-preview?component=src%2FApp.tsx', 'src/App.tsx'),
    ).toBe(false);
  });

  it('only updates component in place inside the same preview server route', () => {
    expect(
      canUpdatePreviewComponentInPlace(
        'http://localhost:5173/test-preview?component=src%2FApp.tsx',
        'http://localhost:5173/test-preview?component=src%2FOther.tsx',
      ),
    ).toBe(true);
    expect(
      canUpdatePreviewComponentInPlace(
        'http://localhost:5173/test-preview?component=src%2FApp.tsx',
        'http://localhost:5174/test-preview?component=src%2FApp.tsx',
      ),
    ).toBe(false);
    expect(
      canUpdatePreviewComponentInPlace(
        'http://localhost:5173/test-preview?component=src%2FApp.tsx',
        'http://localhost:5173/other-preview?component=src%2FApp.tsx',
      ),
    ).toBe(false);
  });

  it('does not treat shared StateHub component sync as iframe navigation readiness', () => {
    expect(shouldNavigateFromSharedStateMessage('state:init')).toBe(false);
    expect(shouldNavigateFromSharedStateMessage('state:update')).toBe(false);
    expect(shouldNavigateFromSharedStateMessage('setComponent')).toBe(true);
    expect(shouldNavigateFromSharedStateMessage('updateUrl')).toBe(true);
  });

  it('clears stale preview URL and component when the dev server stops', async () => {
    const snapshots: BridgeSnapshot[] = [];
    const cleanup = renderBridge((snapshot) => snapshots.push(snapshot));

    try {
      await act(async () => {
        postHostMessage({
          type: 'devserver:statusChanged',
          running: true,
          url: 'http://localhost:19000',
        });
        postHostMessage({
          type: 'updateUrl',
          url: 'http://localhost:19000/test-preview?component=src%2FApp.tsx',
        });
      });
      expect(snapshots.at(-1)?.previewUrl).toBe('http://localhost:19000/test-preview?component=src%2FApp.tsx');

      await act(async () => {
        postHostMessage({
          type: 'devserver:statusChanged',
          running: false,
          url: null,
        });
      });
      expect(snapshots.at(-1)?.previewUrl).toBeNull();

      await act(async () => {
        postHostMessage({
          type: 'devserver:statusChanged',
          running: true,
          url: 'http://localhost:19000',
        });
      });
      expect(snapshots.at(-1)?.devServerRunning).toBe(true);
      expect(snapshots.at(-1)?.previewUrl).toBeNull();
    } finally {
      cleanup();
    }
  });
});

describe('state:update → iframe forwarding', () => {
  it('forwards state:update as hypercanvas:stateUpdate with patch fields directly on message', async () => {
    let capturedSpy: PostMessageSpy | null = null;
    const cleanup = renderBridgeWithSpy((spy) => {
      capturedSpy = spy;
    });

    try {
      await act(async () => {
        postHostMessage({
          type: 'state:update',
          patch: { selectedIds: ['node-abc'], hoveredId: null },
        });
      });

      expect(capturedSpy).not.toBeNull();
      // The iframe must receive hypercanvas:stateUpdate (not state:update)
      // with fields from patch spread directly onto the message object.
      const calls = (capturedSpy as PostMessageSpy).mock.calls;
      const stateUpdateCall = calls.find(
        (args) => (args[0] as Record<string, unknown>).type === 'hypercanvas:stateUpdate',
      );
      expect(stateUpdateCall).toBeDefined();
      const sentMsg = stateUpdateCall?.[0] as Record<string, unknown>;
      expect(sentMsg.selectedIds).toEqual(['node-abc']);
      expect(sentMsg.hoveredId).toBeNull();
      // Must NOT forward raw state:update type
      const wrongCall = calls.find((args) => (args[0] as Record<string, unknown>).type === 'state:update');
      expect(wrongCall).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});
