/**
 * @file useElementTracer — componentPath prop-change propagation
 *
 * Accessed via: IframeCanvas mounts useElementTracer and passes the currently
 *   rendered component path. When the user switches between components in the
 *   left sidebar, the prop changes but the iframe stays mounted.
 * Assumptions: when `componentPath` changes post-init, `tracer.renderedFile`
 *   MUST update without tearing down the tracer (re-init is expensive — it
 *   opens a websocket and re-detects React inside the iframe).
 * Past bugs: dep array of the init effect was `[iframe, projectId, enabled, loadCounter]`
 *   so a componentPath change after init never wrote through to `tracer.renderedFile`,
 *   leaving stale call-site resolution for clicks (HYP — ralphex hooks plan, Task 4).
 *   Also: a prop change BEFORE async React-detect retries completed used the
 *   stale closure value at the first `tracer.renderedFile = …` write; the
 *   ref-based fix in useElementTracer.ts:tryInit closes that hole.
 *
 * Test infra note: this file used to `mock.module('@/lib/element-tracing/element-tracer')`
 *   with a `FakeElementTracer`. Bun's `mock.module` is process-global, so the
 *   fake class leaked into `client/lib/element-tracing/element-tracer.test.ts`
 *   and broke 13 of its 14 tests (TypeError: tracer.getSourceLocation is not a
 *   function). We now use the real `ElementTracer` with a stub transport that
 *   satisfies its `onMessage`/`send`/`dispose` surface. Tracer instances are
 *   captured via the `setActiveTracer` mock — the hook registers each new
 *   tracer there immediately after construction.
 */

import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ElementTracer } from '@/lib/element-tracing/element-tracer';

// Hook builds `location.protocol`/`location.host` into a websocket URL — happy-dom
// exposes `window.location` but not the bare `location` global. Mirror it here.
if (typeof (globalThis as { location?: Location }).location === 'undefined') {
  (globalThis as { location: Location }).location = window.location;
}

const capturedTracers: ElementTracer[] = [];

// Bun's `mock.module` is process-global — once installed, the fake replaces the
// real module for every test that runs in the same Bun invocation, breaking
// neighboring suites that import the same module (`react-adapter.test.ts`,
// `ws-tracing-transport.test.ts`, `fiber-source-index.test.ts`,
// `active-tracer.test.ts`). For that reason this file mocks ONLY the modules
// whose full real-API surface is mirrored below; react-adapter, fiber-source-index,
// fiber-utils, and ws-tracing-transport are used as-is. WebSocket is stubbed at
// the global level so `new WebSocket(wsUrl)` inside the hook doesn't attempt a
// real connection — the stub is restored when the file's tests finish via the
// `globalThis.WebSocket` reset in the trailing afterAll.
const RealWebSocket = (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
class StubWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onclose: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  send(_data: unknown): void {}
  close(): void {}
  addEventListener(): void {}
  removeEventListener(): void {}
}
(globalThis as { WebSocket: unknown }).WebSocket = StubWebSocket as unknown as typeof WebSocket;

// active-tracer is mocked so we can capture every tracer the hook constructs;
// full export surface is mirrored to avoid breaking active-tracer.test.ts.
let mockActiveTracer: ElementTracer | null = null;
const mockSubscribers = new Set<() => void>();
mock.module('@/lib/element-tracing/active-tracer', () => ({
  setActiveTracer: (tracer: ElementTracer | null) => {
    mockActiveTracer = tracer;
    if (tracer !== null) capturedTracers.push(tracer);
    for (const cb of mockSubscribers) cb();
  },
  getActiveTracer: () => mockActiveTracer,
  subscribeToTracer: (cb: () => void) => {
    mockSubscribers.add(cb);
    return () => mockSubscribers.delete(cb);
  },
}));

const { useElementTracer } = await import('./useElementTracer');

function makeFakeIframe(): HTMLIFrameElement {
  const root = document.createElement('div');
  root.id = 'root';
  Object.defineProperty(root, '__reactFiber$abc', {
    value: { tag: 0, return: null, _debugSource: { fileName: 'foo.tsx', lineNumber: 1 } },
    enumerable: true,
    configurable: true,
  });

  const fakeDoc = {
    querySelector: (sel: string) => (sel === '#root' ? root : null),
    body: { children: { length: 1 } },
  } as unknown as Document;

  const iframe = document.createElement('iframe');
  Object.defineProperty(iframe, 'contentDocument', { value: fakeDoc, configurable: true });
  Object.defineProperty(iframe, 'contentWindow', {
    value: { document: fakeDoc } as unknown as Window,
    configurable: true,
  });

  return iframe as unknown as HTMLIFrameElement;
}

afterAll(() => {
  if (RealWebSocket !== undefined) {
    (globalThis as { WebSocket: typeof WebSocket }).WebSocket = RealWebSocket;
  } else {
    delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
  }
});

describe('useElementTracer — componentPath propagation', () => {
  it('writes initial componentPath into tracer.renderedFile when the tracer is created', async () => {
    capturedTracers.length = 0;
    const iframe = makeFakeIframe();

    const { result } = renderHook(() =>
      useElementTracer({
        iframe,
        projectId: 'proj-1',
        enabled: true,
        loadCounter: 0,
        componentPath: 'src/A.tsx',
      }),
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(capturedTracers).toHaveLength(1);
    expect(capturedTracers[0].renderedFile).toBe('src/A.tsx');
  });

  it('updates tracer.renderedFile when componentPath prop changes without re-creating the tracer', async () => {
    capturedTracers.length = 0;
    const iframe = makeFakeIframe();

    const { result, rerender } = renderHook(
      ({ componentPath }) =>
        useElementTracer({
          iframe,
          projectId: 'proj-1',
          enabled: true,
          loadCounter: 0,
          componentPath,
        }),
      { initialProps: { componentPath: 'src/A.tsx' } },
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    expect(capturedTracers).toHaveLength(1);
    expect(capturedTracers[0].renderedFile).toBe('src/A.tsx');
    const tracerBefore = capturedTracers[0];
    const disposeSpy = spyOn(tracerBefore, 'dispose');

    await act(async () => {
      rerender({ componentPath: 'src/B.tsx' });
    });

    await waitFor(() => {
      expect(capturedTracers[0].renderedFile).toBe('src/B.tsx');
    });

    // Same tracer instance — must not have torn down + re-initialized.
    expect(capturedTracers).toHaveLength(1);
    expect(capturedTracers[0]).toBe(tracerBefore);
    expect(disposeSpy).not.toHaveBeenCalled();
  });

  it('writes LATEST componentPath when prop changes during the React-detect retry window', async () => {
    capturedTracers.length = 0;

    // Iframe whose root initially has NO __reactFiber$ key — detectReactInIframe returns false,
    // so tryInit schedules retries instead of constructing the tracer synchronously.
    const root = document.createElement('div');
    root.id = 'root';
    const fakeDoc = {
      querySelector: (sel: string) => (sel === '#root' ? root : null),
      body: { children: { length: 1 } },
    } as unknown as Document;
    const iframe = document.createElement('iframe');
    Object.defineProperty(iframe, 'contentDocument', { value: fakeDoc, configurable: true });
    Object.defineProperty(iframe, 'contentWindow', {
      value: { document: fakeDoc } as unknown as Window,
      configurable: true,
    });

    const { rerender } = renderHook(
      ({ componentPath }: { componentPath: string }) =>
        useElementTracer({
          iframe: iframe as unknown as HTMLIFrameElement,
          projectId: 'proj-1',
          enabled: true,
          loadCounter: 0,
          componentPath,
        }),
      { initialProps: { componentPath: 'src/A.tsx' } },
    );

    // No tracer constructed yet — detection failed.
    expect(capturedTracers).toHaveLength(0);

    // Prop changes BEFORE the retry succeeds. The lightweight effect on
    // [componentPath] runs but tracerRef.current is null, so it can't write.
    await act(async () => {
      rerender({ componentPath: 'src/B.tsx' });
    });
    expect(capturedTracers).toHaveLength(0);

    // Make detection succeed by installing the fiber key — next 200ms retry
    // will construct the tracer.
    Object.defineProperty(root, '__reactFiber$abc', {
      value: { tag: 0, return: null, _debugSource: { fileName: 'foo.tsx', lineNumber: 1 } },
      enumerable: true,
      configurable: true,
    });

    await waitFor(
      () => {
        expect(capturedTracers).toHaveLength(1);
      },
      { timeout: 1000 },
    );

    // Tracer was created AFTER prop changed to 'B' — must reflect latest, not stale closure 'A'.
    expect(capturedTracers[0].renderedFile).toBe('src/B.tsx');
  });

  it('clears tracer.renderedFile to null when componentPath becomes undefined', async () => {
    capturedTracers.length = 0;
    const iframe = makeFakeIframe();

    const { result, rerender } = renderHook(
      ({ componentPath }: { componentPath: string | undefined }) =>
        useElementTracer({
          iframe,
          projectId: 'proj-1',
          enabled: true,
          loadCounter: 0,
          componentPath,
        }),
      { initialProps: { componentPath: 'src/A.tsx' as string | undefined } },
    );

    await waitFor(() => {
      expect(result.current.ready).toBe(true);
    });

    await act(async () => {
      rerender({ componentPath: undefined });
    });

    await waitFor(() => {
      expect(capturedTracers[0].renderedFile).toBeNull();
    });
  });
});
