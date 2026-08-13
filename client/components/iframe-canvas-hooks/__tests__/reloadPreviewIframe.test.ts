/**
 * @file reloadPreviewIframe — keep a host-triggered preview reload ON the proxy.
 *
 * In app-mode history-bridge the iframe document navigates to an UNPREFIXED app route; a naive
 * `contentWindow.location.reload()` would then re-request that route OFF the proxy and break. This
 * helper re-boots via the canonical proxied `iframe.src` in that case, and uses the cheap reload
 * otherwise.
 */

import { describe, expect, mock, test } from 'bun:test';
import { reloadPreviewIframe } from '../useIframeCanvas';

const CANONICAL =
  'http://localhost/project-preview/abc123/test-preview?component=src%2FApp.tsx&app=1&nav=history-bridge';

function fakeIframe(pathname: string) {
  const reload = mock(() => {});
  const iframe = {
    src: CANONICAL,
    contentWindow: { location: { pathname, reload } },
  } as unknown as HTMLIFrameElement;
  return { iframe, reload };
}

describe('reloadPreviewIframe', () => {
  test('on the proxy → cheap contentWindow.location.reload()', () => {
    const { iframe, reload } = fakeIframe('/project-preview/abc123/test-preview');
    reloadPreviewIframe(iframe);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(iframe.src).toBe(CANONICAL); // src untouched
  });

  test('navigated OFF the proxy (history-bridge) → reboot canonical src CARRYING the current route', () => {
    // The iframe document is at an unprefixed /settings?tab=1#x (history-bridge). The reload must
    // reboot the canonical proxied test-preview URL with route=<current> so the route isn't lost.
    const reload = mock(() => {});
    const iframe = {
      src: CANONICAL,
      contentWindow: { location: { pathname: '/settings', search: '?tab=1', hash: '#x', reload } },
    } as unknown as HTMLIFrameElement;
    reloadPreviewIframe(iframe);
    expect(reload).not.toHaveBeenCalled(); // would have reloaded /settings off-proxy
    const next = new URL(iframe.src, 'http://localhost');
    expect(next.pathname).toBe('/project-preview/abc123/test-preview'); // canonical, on-proxy
    expect(next.searchParams.get('route')).toBe('/settings?tab=1#x'); // current route preserved
    expect(next.searchParams.get('component')).toBe('src/App.tsx'); // component preserved
  });

  test('cross-origin location read blocked → does not crash; re-boots via canonical src', () => {
    let srcSets = 0;
    let srcValue = CANONICAL;
    const iframe = {
      get src() {
        return srcValue;
      },
      set src(v: string) {
        srcValue = v;
        srcSets++;
      },
      contentWindow: {
        get location(): never {
          throw new Error('cross-origin');
        },
      },
    } as unknown as HTMLIFrameElement;
    // location access throws in BOTH the prefix check and the reload → helper must not crash and
    // falls back to re-assigning the canonical src.
    expect(() => reloadPreviewIframe(iframe)).not.toThrow();
    expect(srcSets).toBe(1);
  });
});
