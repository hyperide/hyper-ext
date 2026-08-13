import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { detectPreviewPrefix } from '@shared/components/preview-chrome';
import { authFetch } from '@/utils/authFetch';
import type { CanvasComposition, CanvasMode } from '../../../shared/types/canvas';

/**
 * Reboot the preview iframe to the canonical proxied URL, carrying the current in-app route.
 *
 * The iframe's declarative `src` is always `/project-preview/<id>/test-preview?…` — but in app-mode
 * `history-bridge` only the SRC stays proxied; the iframe DOCUMENT has navigated to an unprefixed
 * route (e.g. `/settings?tab=1#x`). We capture that current route and reboot the canonical src with
 * `route=<current>` so the boot driver restores it (a plain `iframe.src = iframe.src` would reboot
 * to `/`, losing the route). Returns the URL it assigned (for tests), or null if no proxy prefix.
 */
function rebootOnProxy(iframe: HTMLIFrameElement, currentRoute: string): string | null {
  try {
    const url = new URL(iframe.src, window.location.origin);
    const prefix = detectPreviewPrefix(url.pathname);
    if (!prefix) return null; // off-proxy / ext — no canonical preview URL to rebuild
    url.pathname = `${prefix}/test-preview`;
    if (currentRoute && currentRoute !== '/') url.searchParams.set('route', currentRoute);
    iframe.src = url.toString();
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Reload the preview iframe, staying ON the proxy.
 *
 * Normally `contentWindow.location.reload()` re-requests the iframe's CURRENT URL — correct while
 * it's on the proxy. But in app-mode `history-bridge` the iframe document navigated to an UNPREFIXED
 * app route, so `location.reload()` would request that route off the proxy and break. In that case
 * we reboot the canonical proxied src carrying `route=<current>` (see rebootOnProxy).
 */
export function reloadPreviewIframe(iframe: HTMLIFrameElement): void {
  let offProxyRoute: string | null = null;
  try {
    const cw = iframe.contentWindow;
    if (cw && detectPreviewPrefix(cw.location.pathname) === '') {
      offProxyRoute = cw.location.pathname + cw.location.search + cw.location.hash;
    }
  } catch {
    // cross-origin read blocked — assume on-proxy and use the cheap reload below.
    offProxyRoute = null;
  }
  if (offProxyRoute !== null) {
    // Navigated off the prefix (history-bridge) → reboot the canonical proxied URL with the route.
    if (rebootOnProxy(iframe, offProxyRoute) === null) {
      iframe.src = iframe.src; // eslint-disable-line no-self-assign -- fallback reload
    }
    return;
  }
  try {
    iframe.contentWindow?.location.reload();
  } catch {
    // cross-origin reload blocked → fall back to re-assigning the canonical src.
    iframe.src = iframe.src; // eslint-disable-line no-self-assign -- reassigning src reloads the iframe
  }
}

interface UseIframeCanvasParams {
  projectId?: string;
  componentPath: string;
  onCanvasModeChange?: (mode: CanvasMode) => void;
  onErrorChange?: (error: string | null, retryCount: number) => void;
  onGatewayError?: (hasError: boolean, errorMessage?: string) => void;
  onLoadingChange?: (loading: boolean) => void;
  serverOffline?: boolean;
  overrideSrc?: string;
  iframeLoadedCounter?: number;
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
}

export function useIframeCanvas({
  projectId,
  componentPath,
  onCanvasModeChange,
  onErrorChange,
  onGatewayError,
  onLoadingChange,
  serverOffline,
  overrideSrc,
  iframeLoadedCounter,
  iframeRef,
}: UseIframeCanvasParams) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [canvasMode, setCanvasMode] = useState<CanvasMode>('single');
  const [canvasComposition, setCanvasComposition] = useState<CanvasComposition | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevServerOfflineRef = useRef(serverOffline);

  const checkForGatewayError = useCallback((): {
    hasError: boolean;
    errorMessage?: string;
  } => {
    const iframe = iframeRef.current;
    if (!iframe) return { hasError: false };

    try {
      const doc = iframe.contentDocument;
      if (!doc) return { hasError: false };

      const title = doc.title?.toLowerCase() || '';
      const bodyText = doc.body?.textContent || '';
      const bodyTextLower = bodyText.toLowerCase();
      const bodyHtml = doc.body?.innerHTML?.toLowerCase() || '';

      const errorPatterns = [
        /bad gateway/i,
        /502/,
        /503/,
        /504/,
        /522/,
        /523/,
        /524/,
        /404/,
        /not found/i,
        /cloudflare/i,
        /nginx/i,
        /upstream/i,
        /gateway timeout/i,
        /service unavailable/i,
        /connection refused/i,
        /failed to connect/i,
      ];

      const content = `${title} ${bodyTextLower}`;

      if (/404|not found/i.test(content)) {
        const requestedUrl = iframe.contentWindow?.location.href || 'unknown';
        return { hasError: true, errorMessage: `404 Not Found: ${requestedUrl}` };
      }

      for (const pattern of errorPatterns) {
        if (pattern.test(content)) {
          const proxyErrorMatch = bodyText.match(/proxy error:\s*(.+)/i);
          return { hasError: true, errorMessage: proxyErrorMatch ? proxyErrorMatch[1].trim() : undefined };
        }
      }

      if (bodyHtml.includes('cf-error-') || bodyHtml.includes('cf-wrapper')) {
        return { hasError: true, errorMessage: 'Cloudflare error' };
      }
    } catch {
      return { hasError: true };
    }

    return { hasError: false };
  }, [iframeRef]);

  const reloadIframe = useCallback(() => {
    if (serverOffline) {
      console.log('[IframeCanvas] Skipping reload, server is offline');
      return;
    }
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    console.log('[IframeCanvas] Reloading iframe, retry count:', retryCount);
    setLoading(true);
    setError(null);
    reloadPreviewIframe(iframe);
    setRetryCount((prev) => prev + 1);
  }, [retryCount, serverOffline, iframeRef]);

  useEffect(() => {
    if (error) {
      onGatewayError?.(true);
    }
  }, [error, onGatewayError]);

  useEffect(() => {
    onErrorChange?.(error, retryCount);
  }, [error, retryCount, onErrorChange]);

  useEffect(() => {
    if (onLoadingChange) {
      onLoadingChange(loading);
    }
  }, [loading, onLoadingChange]);

  useEffect(() => {
    Object.assign(window, { __CANVAS_INSTANCES__: canvasComposition?.instances ?? {} });
  }, [canvasComposition]);

  useEffect(() => {
    if (!projectId || !componentPath) {
      setCanvasComposition(null);
      setCanvasMode('single');
      onCanvasModeChange?.('single');
      return;
    }

    const loadComposition = async () => {
      let composition: CanvasComposition | null = null;
      try {
        const response = await authFetch(`/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}`);
        if (response.ok) {
          const data = await response.json();
          composition = data.composition;
        }
      } catch (error) {
        console.error('[IframeCanvas] Failed to load composition from server:', error);
      }

      const instanceKeys = composition ? Object.keys(composition.instances) : [];
      const isMultiMode = instanceKeys.length > 1 || (instanceKeys.length === 1 && instanceKeys[0] !== 'default');
      const mode = isMultiMode ? 'multi' : 'single';

      setCanvasComposition(composition);
      setCanvasMode(mode);
      onCanvasModeChange?.(mode);
      console.log('[IframeCanvas] Canvas mode:', mode, 'Composition:', composition);
    };

    loadComposition();
  }, [projectId, componentPath, onCanvasModeChange]);

  useEffect(() => {
    const handleCanvasChanged = async () => {
      if (!projectId || !componentPath) return;
      try {
        const response = await authFetch(`/api/canvas-composition/${projectId}/${encodeURIComponent(componentPath)}`);
        if (response.ok) {
          const data = await response.json();
          const composition = data.composition;
          const instanceKeys = composition ? Object.keys(composition.instances) : [];
          const isMultiMode = instanceKeys.length > 1 || (instanceKeys.length === 1 && instanceKeys[0] !== 'default');
          const mode = isMultiMode ? 'multi' : 'single';
          setCanvasComposition(composition);
          setCanvasMode(mode);
          onCanvasModeChange?.(mode);
          console.log('[IframeCanvas] Composition reloaded after canvasCompositionChanged');
        }
      } catch (error) {
        console.error('[IframeCanvas] Failed to reload composition:', error);
      }
    };

    window.addEventListener('canvasCompositionChanged', handleCanvasChanged);
    return () => window.removeEventListener('canvasCompositionChanged', handleCanvasChanged);
  }, [projectId, componentPath, onCanvasModeChange]);

  useEffect(() => {
    if (!projectId || !componentPath) {
      setPreviewReady(false);
      return;
    }
    setPreviewReady(true);
  }, [projectId, componentPath]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewReady) return;

    const handleLoad = () => {
      setTimeout(() => {
        const errorCheck = checkForGatewayError();
        if (errorCheck.hasError) {
          console.log('[IframeCanvas] Gateway error on load, scheduling retry');
          if (retryCount >= 2) {
            onGatewayError?.(true, errorCheck.errorMessage);
          }
          if (serverOffline) {
            setError('Server offline — preview will reload automatically');
            setLoading(false);
            return;
          }
          const delay = Math.min(1000 * 2 ** retryCount, 8000);
          retryTimeoutRef.current = setTimeout(() => {
            if (retryCount < 10) {
              reloadIframe();
            } else {
              setError('Failed to connect to project. Please check if the project is running.');
              setLoading(false);
            }
          }, delay);
        } else {
          setLoading(false);
          setRetryCount(0);
          onGatewayError?.(false);
        }
      }, 100);
    };

    const handleError = () => {
      setLoading(false);
      setError('Failed to load component preview');
    };

    iframe.addEventListener('load', handleLoad);
    iframe.addEventListener('error', handleError);

    return () => {
      iframe.removeEventListener('load', handleLoad);
      iframe.removeEventListener('error', handleError);
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
      }
    };
  }, [previewReady, retryCount, checkForGatewayError, reloadIframe, onGatewayError, serverOffline, iframeRef]);

  useEffect(() => {
    const handleOnline = () => {
      if (serverOffline) return;
      console.log('[IframeCanvas] Network online, checking iframe');
      if (checkForGatewayError().hasError) {
        reloadIframe();
      }
    };

    const handleVisibilityChange = () => {
      if (serverOffline) return;
      if (document.visibilityState === 'visible') {
        console.log('[IframeCanvas] Tab activated, checking iframe');
        setTimeout(() => {
          if (checkForGatewayError().hasError) {
            reloadIframe();
          }
        }, 500);
      }
    };

    window.addEventListener('online', handleOnline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('online', handleOnline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [checkForGatewayError, reloadIframe, serverOffline]);

  useEffect(() => {
    const wasOffline = prevServerOfflineRef.current;
    prevServerOfflineRef.current = serverOffline;
    if (wasOffline && !serverOffline) {
      setRetryCount(0);
      if (checkForGatewayError().hasError || error) {
        console.log('[IframeCanvas] Server back online, reloading iframe');
        setError(null);
        setLoading(true);
        if (iframeRef.current) reloadPreviewIframe(iframeRef.current);
      }
    }
  }, [serverOffline, checkForGatewayError, error, iframeRef]);

  const iframeSize = useMemo(() => {
    if (canvasMode !== 'multi') {
      return null;
    }
    if (!canvasComposition?.instances || Object.keys(canvasComposition.instances).length === 0) {
      return { width: '10000px', height: '10000px' };
    }

    const MIN_PADDING = 5000;
    const QUANTUM = 10000;
    const DEFAULT_SIZE = 500;

    let maxRight = 0;
    let maxBottom = 0;

    for (const instance of Object.values(canvasComposition.instances)) {
      const pos = instance as { x?: number; y?: number; width?: number; height?: number };
      const right = (pos.x ?? 0) + (pos.width ?? DEFAULT_SIZE);
      const bottom = (pos.y ?? 0) + (pos.height ?? DEFAULT_SIZE);
      maxRight = Math.max(maxRight, right);
      maxBottom = Math.max(maxBottom, bottom);
    }

    const rawWidth = maxRight + MIN_PADDING;
    const rawHeight = maxBottom + MIN_PADDING;
    const width = Math.ceil(rawWidth / QUANTUM) * QUANTUM;
    const height = Math.ceil(rawHeight / QUANTUM) * QUANTUM;
    const finalWidth = Math.max(width, QUANTUM);
    const finalHeight = Math.max(height, QUANTUM);

    return {
      width: `${finalWidth}px`,
      height: `${finalHeight}px`,
    };
  }, [canvasMode, canvasComposition]);

  return {
    loading,
    error,
    previewReady,
    canvasMode,
    canvasComposition,
    retryCount,
    iframeSize,
    setLoading,
    setError,
    setRetryCount,
    checkForGatewayError,
    reloadIframe,
  };
}
