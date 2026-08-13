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
  hasForwardableState,
  hasNavigatedPreviewSource,
  mergeForwardedState,
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

  // The preview iframe is always loaded from the dev-server URL in production, so
  // postToPreviewIframe can derive a concrete target origin (never '*'). Give the
  // test iframe a matching src so the forwarding path exercises that real origin.
  return createElement('iframe', {
    ref: refCallback,
    title: 'preview',
    src: 'http://localhost:5173/test-preview?component=src%2FApp.tsx',
  });
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

  it('forces a real navigation when toggling app-mode (the app= param changes)', () => {
    // Entering app-mode: app=1 appears. The mode is read at iframe mount, so an in-place
    // setComponent would keep component-mode — must reload.
    expect(
      canUpdatePreviewComponentInPlace(
        'http://localhost:5173/test-preview?component=client%2FApp.tsx',
        'http://localhost:5173/test-preview?component=client%2FApp.tsx&app=1',
      ),
    ).toBe(false);
    // Leaving app-mode: app=1 disappears — also a real navigation.
    expect(
      canUpdatePreviewComponentInPlace(
        'http://localhost:5173/test-preview?component=client%2FApp.tsx&app=1',
        'http://localhost:5173/test-preview?component=client%2FApp.tsx',
      ),
    ).toBe(false);
    // Same app flag on both sides still allows an in-place component swap.
    expect(
      canUpdatePreviewComponentInPlace(
        'http://localhost:5173/test-preview?component=client%2FApp.tsx&app=1',
        'http://localhost:5173/test-preview?component=client%2FOther.tsx&app=1',
      ),
    ).toBe(true);
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
      // targetOrigin must be the derived dev-server origin, never the '*' wildcard.
      expect(stateUpdateCall?.[1]).toBe('http://localhost:5173');
      // Must NOT forward raw state:update type
      const wrongCall = calls.find((args) => (args[0] as Record<string, unknown>).type === 'state:update');
      expect(wrongCall).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

describe('iframe:scrollToElement → iframe forwarding', () => {
  // Regression: third leg of the tree → canvas scroll chain.
  // Flow: LeftPanel useElementSelection -> canvas.sendEvent('iframe:scrollToElement')
  //       -> PanelRouter -> StateHub.broadcast -> THIS HANDLER (PreviewPanel webview)
  //       -> iframe contentWindow.postMessage('hypercanvas:scrollToElement')
  //       -> iframe-interaction.ts looks up element, scrollIntoViewCenterSmooth.
  //
  // Prior bug: PanelRouter echoed back to sender (LeftPanel) instead of broadcasting.
  // PanelRouter.test.ts pins the broadcast leg; this test pins the iframe-forwarding leg.
  it('forwards iframe:scrollToElement to iframe as hypercanvas:scrollToElement', async () => {
    let capturedSpy: PostMessageSpy | null = null;
    const cleanup = renderBridgeWithSpy((spy) => {
      capturedSpy = spy;
    });

    try {
      await act(async () => {
        postHostMessage({
          type: 'iframe:scrollToElement',
          elementId: '/project/src/App.tsx:42:8',
        });
      });

      expect(capturedSpy).not.toBeNull();
      const calls = (capturedSpy as PostMessageSpy).mock.calls;
      const scrollCall = calls.find(
        (args) => (args[0] as Record<string, unknown>).type === 'hypercanvas:scrollToElement',
      );
      expect(scrollCall).toBeDefined();
      const sentMsg = scrollCall?.[0] as Record<string, unknown>;
      expect(sentMsg.elementId).toBe('/project/src/App.tsx:42:8');
      // targetOrigin must be the derived dev-server origin, never the '*' wildcard.
      expect(scrollCall?.[1]).toBe('http://localhost:5173');
      // Must NOT echo the host-side type — iframe handler keys on the hypercanvas:* prefix.
      const wrongCall = calls.find((args) => (args[0] as Record<string, unknown>).type === 'iframe:scrollToElement');
      expect(wrongCall).toBeUndefined();
    } finally {
      cleanup();
    }
  });
});

describe('setGeneratedProps → iframe retry delivery (HYP-880)', () => {
  it('routes retries through the origin-scoped channel, never the "*" wildcard', async () => {
    let capturedSpy: PostMessageSpy | null = null;
    const cleanup = renderBridgeWithSpy((spy) => {
      capturedSpy = spy;
    });

    try {
      await act(async () => {
        postHostMessage({
          type: 'setGeneratedProps',
          componentPath: 'src/App.tsx',
          values: { children: 'Section' },
        });
      });

      const calls = (capturedSpy as PostMessageSpy).mock.calls;
      const genPropsCalls = calls.filter(
        (args) => (args[0] as Record<string, unknown>).type === 'hypercanvas:setGeneratedProps',
      );
      expect(genPropsCalls.length).toBeGreaterThan(0);
      // targetOrigin must be the derived dev-server origin, never the '*' wildcard —
      // a raw postMessage(..., '*') would leak componentPath/values to any cross-origin
      // page the preview frame navigates to mid-startup.
      for (const call of genPropsCalls) {
        expect(call[1]).toBe('http://localhost:5173');
      }
    } finally {
      cleanup();
    }
  });

  it('stops an older retry loop once a newer setGeneratedProps for the same path supersedes it', async () => {
    let capturedSpy: PostMessageSpy | null = null;
    const cleanup = renderBridgeWithSpy((spy) => {
      capturedSpy = spy;
    });

    try {
      await act(async () => {
        postHostMessage({
          type: 'setGeneratedProps',
          componentPath: 'src/App.tsx',
          values: { children: 'stale' },
        });
      });
      const callsBeforeSecond = (capturedSpy as PostMessageSpy).mock.calls.length;

      // A second message for the SAME componentPath arrives before the first loop's
      // 10s/40-tick window ends (e.g. reselecting the component) — this must supersede
      // the first loop so it stops posting its now-stale 'stale' payload.
      await act(async () => {
        postHostMessage({
          type: 'setGeneratedProps',
          componentPath: 'src/App.tsx',
          values: { children: 'fresh' },
        });
      });

      // Let one 250ms retry tick elapse for both loops (real timers — generous margin
      // over the single tick this asserts on to avoid CI-load flakiness).
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });

      const genPropsPayloads = (capturedSpy as PostMessageSpy).mock.calls
        .slice(callsBeforeSecond)
        .map((args) => args[0] as Record<string, unknown>)
        .filter((m) => m.type === 'hypercanvas:setGeneratedProps');

      // At least the second loop's immediate synchronous post plus one retry tick.
      expect(genPropsPayloads.length).toBeGreaterThan(1);
      // Every post after the second message must carry the NEW values — the
      // superseded first loop must not have posted 'stale' again in this window.
      for (const payload of genPropsPayloads) {
        expect((payload.values as Record<string, unknown>).children).toBe('fresh');
      }
    } finally {
      cleanup();
    }
  });

  it('does not let a message for a DIFFERENT componentPath cancel an unrelated retry loop', async () => {
    let capturedSpy: PostMessageSpy | null = null;
    const cleanup = renderBridgeWithSpy((spy) => {
      capturedSpy = spy;
    });

    try {
      await act(async () => {
        postHostMessage({
          type: 'setGeneratedProps',
          componentPath: 'src/App.tsx',
          values: { children: 'app-value' },
        });
      });
      const callsBeforeSecond = (capturedSpy as PostMessageSpy).mock.calls.length;

      // A different componentPath must NOT supersede src/App.tsx's retry loop —
      // supersession is scoped per path (switching to another file mid-flight).
      await act(async () => {
        postHostMessage({
          type: 'setGeneratedProps',
          componentPath: 'src/Other.tsx',
          values: { children: 'other-value' },
        });
      });

      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });

      const genPropsPayloads = (capturedSpy as PostMessageSpy).mock.calls
        .slice(callsBeforeSecond)
        .map((args) => args[0] as Record<string, unknown>)
        .filter((m) => m.type === 'hypercanvas:setGeneratedProps');

      const appPaths = genPropsPayloads.filter((m) => m.componentPath === 'src/App.tsx');
      const otherPaths = genPropsPayloads.filter((m) => m.componentPath === 'src/Other.tsx');
      // Both loops must still be alive and posting their own values independently.
      expect(appPaths.length).toBeGreaterThan(0);
      expect(otherPaths.length).toBeGreaterThan(0);
      for (const payload of appPaths) {
        expect((payload.values as Record<string, unknown>).children).toBe('app-value');
      }
      for (const payload of otherPaths) {
        expect((payload.values as Record<string, unknown>).children).toBe('other-value');
      }
    } finally {
      cleanup();
    }
  });
});

describe('mergeForwardedState (#51 — selection replay accumulator)', () => {
  it('returns prev unchanged for a null/empty patch (no needless allocation)', () => {
    const prev = { selectedIds: ['a'] };
    expect(mergeForwardedState(prev, null)).toBe(prev);
    expect(mergeForwardedState(prev, undefined)).toBe(prev);
    expect(mergeForwardedState(prev, {})).toBe(prev);
    // A patch with only unrelated fields is also a no-op.
    expect(mergeForwardedState(prev, { currentComponent: { path: 'x' } })).toBe(prev);
  });

  it('captures selection fields from the first patch', () => {
    const next = mergeForwardedState(null, { selectedIds: ['node-1'], selectedItemIndices: {} });
    expect(next).toEqual({ selectedIds: ['node-1'], selectedItemIndices: {} });
  });

  it('merges last-write-wins per field, preserving fields absent from the new patch', () => {
    const first = mergeForwardedState(null, { selectedIds: ['node-1'], engineMode: 'design' });
    const second = mergeForwardedState(first, { selectedIds: ['node-2'] });
    // selectedIds updated, engineMode preserved from the earlier patch.
    expect(second).toEqual({ selectedIds: ['node-2'], engineMode: 'design' });
  });

  it('only mirrors the fields the iframe bridge reads (ignores StateHub-only keys)', () => {
    const next = mergeForwardedState(null, {
      selectedIds: ['node-1'],
      hoveredId: 'node-9',
      hoveredItemIndex: 2,
      selectedItemIndices: { 'node-1': 0 },
      engineMode: 'interact',
      // Not part of hypercanvas:stateUpdate — must be dropped.
      currentComponent: { path: 'src/App.tsx' },
      route: '/whatever',
    });
    expect(next).toEqual({
      selectedIds: ['node-1'],
      hoveredId: 'node-9',
      hoveredItemIndex: 2,
      selectedItemIndices: { 'node-1': 0 },
      engineMode: 'interact',
    });
  });
});

describe('hasForwardableState (#51)', () => {
  it('is false for null / empty state', () => {
    expect(hasForwardableState(null)).toBe(false);
    expect(hasForwardableState({})).toBe(false);
  });

  it('is true once any selection/interaction field exists — even an empty selection', () => {
    // An explicit deselect (empty array) is still a replayable state, not "nothing known".
    expect(hasForwardableState({ selectedIds: [] })).toBe(true);
    expect(hasForwardableState({ selectedIds: ['a'] })).toBe(true);
    expect(hasForwardableState({ hoveredId: null })).toBe(true);
  });
});

// === Bridge-ready handshake (#51) — the Remix selection round-trip race ===
// A selection forwarded BEFORE the late-loading Remix bridge mounts its message listener
// is dropped. When the bridge finishes setup it posts `hypercanvas:bridgeReady` (from the
// iframe, so event.source === iframe.contentWindow); the parent must replay the current
// selection as `hypercanvas:stateUpdate` so the late bridge still receives it.

interface HandshakeProbe {
  spy: PostMessageSpy;
  iframe: HTMLIFrameElement;
}

function BridgeWithHandshakeProbe({ onProbe }: { onProbe: (probe: HandshakeProbe) => void }) {
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
      onProbe({ spy, iframe: el });
    }
    setIframeEl(el);
  };

  return createElement('iframe', {
    ref: refCallback,
    title: 'preview',
    src: 'http://localhost:5173/test-preview?component=src%2FApp.tsx',
  });
}

function renderBridgeWithHandshakeProbe(onProbe: (probe: HandshakeProbe) => void) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(createElement(BridgeWithHandshakeProbe, { onProbe }));
  });
  return () => {
    act(() => root.unmount());
    host.remove();
  };
}

/** Dispatch a message that LOOKS like it came from the iframe (passes the event.source guard). */
function postIframeMessage(iframe: HTMLIFrameElement, data: Record<string, unknown>): void {
  window.dispatchEvent(new window.MessageEvent('message', { data, source: iframe.contentWindow as unknown as Window }));
}

describe('hypercanvas:bridgeReady handshake → selection replay (#51)', () => {
  it('re-sends the current selection as hypercanvas:stateUpdate when the bridge announces ready', async () => {
    let probe: HandshakeProbe | null = null;
    const cleanup = renderBridgeWithHandshakeProbe((p) => {
      probe = p;
    });

    try {
      expect(probe).not.toBeNull();
      const { spy, iframe } = probe as HandshakeProbe;

      // 1. A selection is forwarded BEFORE the (late Remix) bridge is ready. The first
      //    hypercanvas:stateUpdate the iframe never sees because its listener isn't mounted yet.
      await act(async () => {
        postHostMessage({
          type: 'state:update',
          patch: { selectedIds: ['src/App.tsx:10:4'], selectedItemIndices: {} },
        });
      });

      const callsBefore = spy.mock.calls.length;

      // 2. The bridge finishes setup and announces itself (from the iframe → event.source matches).
      await act(async () => {
        postIframeMessage(iframe, { type: 'hypercanvas:bridgeReady' });
      });

      // 3. The parent replays the selection so the now-mounted bridge receives it.
      const replay = spy.mock.calls
        .slice(callsBefore)
        .map((args) => args[0] as Record<string, unknown>)
        .find((m) => m.type === 'hypercanvas:stateUpdate');
      expect(replay).toBeDefined();
      expect(replay?.selectedIds).toEqual(['src/App.tsx:10:4']);
      expect(replay?.selectedItemIndices).toEqual({});
    } finally {
      cleanup();
    }
  });

  it('does not replay when no selection has been issued yet (nothing to replay)', async () => {
    let probe: HandshakeProbe | null = null;
    const cleanup = renderBridgeWithHandshakeProbe((p) => {
      probe = p;
    });

    try {
      const { spy, iframe } = probe as HandshakeProbe;
      const callsBefore = spy.mock.calls.length;

      await act(async () => {
        postIframeMessage(iframe, { type: 'hypercanvas:bridgeReady' });
      });

      const stateUpdateAfter = spy.mock.calls
        .slice(callsBefore)
        .some((args) => (args[0] as Record<string, unknown>).type === 'hypercanvas:stateUpdate');
      expect(stateUpdateAfter).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('does not replay a previous component selection after the iframe session is dropped (component-scoped)', async () => {
    let probe: HandshakeProbe | null = null;
    const cleanup = renderBridgeWithHandshakeProbe((p) => {
      probe = p;
    });

    try {
      const { spy, iframe } = probe as HandshakeProbe;

      // Select an element in component A.
      await act(async () => {
        postHostMessage({
          type: 'state:update',
          patch: { selectedIds: ['src/A.tsx:1:1'] },
        });
      });

      // The dev server stops → the iframe session is dropped; the replay state must go with it
      // so the next component's bridge never inherits A's selection.
      await act(async () => {
        postHostMessage({ type: 'devserver:statusChanged', running: false, url: null });
      });

      const callsBefore = spy.mock.calls.length;
      await act(async () => {
        postIframeMessage(iframe, { type: 'hypercanvas:bridgeReady' });
      });

      const replayed = spy.mock.calls
        .slice(callsBefore)
        .some((args) => (args[0] as Record<string, unknown>).type === 'hypercanvas:stateUpdate');
      expect(replayed).toBe(false);
    } finally {
      cleanup();
    }
  });

  it('ignores a bridgeReady that is NOT from the iframe (source guard)', async () => {
    let probe: HandshakeProbe | null = null;
    const cleanup = renderBridgeWithHandshakeProbe((p) => {
      probe = p;
    });

    try {
      const { spy } = probe as HandshakeProbe;

      await act(async () => {
        postHostMessage({
          type: 'state:update',
          patch: { selectedIds: ['src/App.tsx:10:4'] },
        });
      });
      const callsBefore = spy.mock.calls.length;

      // bridgeReady WITHOUT a matching source (postHostMessage → source is null) must be ignored
      // by the iframe→parent handler's event.source check; no replay.
      await act(async () => {
        postHostMessage({ type: 'hypercanvas:bridgeReady' });
      });

      const replayed = spy.mock.calls
        .slice(callsBefore)
        .some((args) => (args[0] as Record<string, unknown>).type === 'hypercanvas:stateUpdate');
      expect(replayed).toBe(false);
    } finally {
      cleanup();
    }
  });
});
