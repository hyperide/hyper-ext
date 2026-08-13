/**
 * Regression tests for the VS Code preview `useReadableSurface` hook (HYP-1002) — specifically the
 * iframe-reset cleanup contract added in PR #669. A dev-server retry/stop remounts the preview
 * <iframe> via its `key`, so `iframeEl` transitions element → null → new element. Because the flip
 * is applied via `--hc-canvas-surface` on `document.body` and only ever re-decided when a NEW
 * iframe posts samples, a replaced/removed iframe must actively clear the prior flip — otherwise
 * the previous component's adjusted surface + badge persist behind a loading/failed preview.
 *
 * Renders through the extension's OWN react-dom/client (not @testing-library/react): the extension
 * declares react/react-dom locally while testing-library resolves from the monorepo root, so
 * driving this stateful hook through testing-library would use two React copies and trip the
 * "Invalid hook call" guard once the extension is tested after its own `npm ci`. Same constraint
 * documented in SupportDimensionsTabs.test.tsx. The editor background is left to the hook's dark
 * fallback (#1e1e1e), so near-black samples always fail contrast and the aid flips to light.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useReadableSurface } from '../useReadableSurface';
import type { ReadableSurfaceResult } from '../useReadableSurface';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SURFACE_VAR = '--hc-canvas-surface';

let latest: ReadableSurfaceResult | null = null;
function Harness({ iframeEl }: { iframeEl: HTMLIFrameElement | null }) {
  latest = useReadableSurface({ iframeEl });
  return null;
}

function postSamples(source: unknown, samples: Array<{ hex: string; alpha?: number }>, hasOwnBackground = false) {
  const ev = new Event('message');
  Object.defineProperty(ev, 'data', {
    value: { type: 'hypercanvas:readabilitySamples', hasOwnBackground, samples },
    configurable: true,
  });
  Object.defineProperty(ev, 'source', { value: source, configurable: true });
  window.dispatchEvent(ev);
}

function surfaceState() {
  return {
    varValue: document.body.style.getPropertyValue(SURFACE_VAR),
    dataAttr: document.body.getAttribute('data-hc-surface'),
  };
}

let root: Root | null = null;
let container: HTMLElement | null = null;
function mount(iframeEl: HTMLIFrameElement | null) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(<Harness iframeEl={iframeEl} />));
}
function rerender(iframeEl: HTMLIFrameElement | null) {
  act(() => root!.render(<Harness iframeEl={iframeEl} />));
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
  latest = null;
  document.body.style.removeProperty(SURFACE_VAR);
  document.body.removeAttribute('data-hc-surface');
});

describe('useReadableSurface — iframe-reset cleanup (HYP-1002 / PR #669)', () => {
  test('clears the applied surface when the iframe element is removed', () => {
    const win = {} as Window;
    const iframeA = { contentWindow: win } as unknown as HTMLIFrameElement;
    mount(iframeA);

    // Near-black text on the dark editor fallback → the aid flips to the light surface.
    act(() => postSamples(win, [{ hex: '#141414' }]));
    expect(latest?.surfaceId).toBe('light');
    expect(surfaceState()).toEqual({ varValue: '#ffffff', dataAttr: 'light' });

    // The iframe is removed (dev server stopped) → the flip must not persist.
    rerender(null);
    expect(latest?.surfaceId).toBeNull();
    expect(surfaceState()).toEqual({ varValue: '', dataAttr: null });
  });

  test('a message from the detached (old) iframe cannot reapply the flip after replacement', () => {
    const winA = {} as Window;
    const winB = {} as Window;
    const iframeA = { contentWindow: winA } as unknown as HTMLIFrameElement;
    const iframeB = { contentWindow: winB } as unknown as HTMLIFrameElement;
    mount(iframeA);

    act(() => postSamples(winA, [{ hex: '#141414' }]));
    expect(latest?.surfaceId).toBe('light');

    // Replace the iframe element; the reset cleanup drops the prior flip.
    rerender(iframeB);
    expect(latest?.surfaceId).toBeNull();
    expect(surfaceState()).toEqual({ varValue: '', dataAttr: null });

    // The old, detached contentWindow must no longer drive the surface (source no longer matches).
    act(() => postSamples(winA, [{ hex: '#141414' }]));
    expect(latest?.surfaceId).toBeNull();
    expect(surfaceState()).toEqual({ varValue: '', dataAttr: null });
  });
});
