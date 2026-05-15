/**
 * Preview Bridge hook — handles message routing between iframe, webview, and extension.
 *
 * Replaces the inline JS from PreviewPanel._getHtmlForWebview():
 * - iframe -> extension: forwards runtime errors, platform messages, previewLoaded
 * - extension -> webview: handles devserver status, URL updates, UI state
 * - extension -> iframe: forwards state:update, state:init, ast:response, editor:activeFileChanged
 * - extension -> canvas interaction: forwards state patches for overlay rendering
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasAdapter, PlatformMessage } from '@/lib/platform/types';
import type { UnsupportedProjectError } from '../types';
import type { SimplePropInfo } from './PropsForm';

interface UsePreviewBridgeOptions {
  iframeEl: HTMLIFrameElement | null;
  canvas: CanvasAdapter;
  /** Forward state patches to canvas interaction (overlay rendering in iframe) */
  onStateUpdate: (patch: Record<string, unknown>) => void;
}

/** Error info from iframe ErrorBoundary — rendered in webview overlay, not inside iframe */
export interface ComponentError {
  componentPath: string;
  error: string;
  /** Monotonic counter — increments on each error event, even for same component */
  errorSeq: number;
  /** Prop schema from extension's ComponentService (populated asynchronously) */
  propsSchema?: SimplePropInfo[] | null;
}

interface UsePreviewBridgeResult {
  devServerRunning: boolean;
  devServerUrl: string | null;
  /** True when server was running but disconnected (show reconnecting banner) */
  disconnected: boolean;
  previewUrl: string | null;
  showNoComponentHint: boolean;
  /** Set when extension detects an unsupported project type (e.g. React Native / Tamagui) */
  projectError: UnsupportedProjectError | null;
  /** Detected project capabilities — CSS system, readonly mode, etc. */
  projectCapabilities: import('../types').ProjectCapabilities | null;
  /** Set when iframe ErrorBoundary catches a component render error */
  componentError: ComponentError | null;
  handleStartDevServer: () => void;
  handleRefresh: () => void;
  clearComponentError: () => void;
}

export function buildComponentPreviewUrl(devServerUrl: string, component: string): string {
  return `${devServerUrl.replace(/\/$/, '')}/test-preview?component=${encodeURIComponent(component)}`;
}

export function hasNavigatedPreviewSource(src: string | null | undefined): src is string {
  return Boolean(src && src !== 'about:blank');
}

export function getComponentFromPreviewUrl(src: string | null | undefined): string | null {
  if (!src || src === 'about:blank') return null;
  try {
    return new URL(src).searchParams.get('component');
  } catch {
    return null;
  }
}

export function shouldNavigateFrameToComponent(src: string | null | undefined, nextComponent: string): boolean {
  const currentComponent = getComponentFromPreviewUrl(src);
  return currentComponent !== nextComponent;
}

export function shouldNavigateFromSharedStateMessage(messageType: string): boolean {
  return messageType !== 'state:init' && messageType !== 'state:update';
}

export function applyComponentRenderSucceeded(
  prev: ComponentError | null,
  componentPath: string,
): ComponentError | null {
  return prev?.componentPath === componentPath ? null : prev;
}

export function canUpdatePreviewComponentInPlace(
  currentSrc: string | null | undefined,
  nextSrc: string | null | undefined,
): boolean {
  if (!hasNavigatedPreviewSource(currentSrc) || !hasNavigatedPreviewSource(nextSrc)) return false;

  try {
    const currentUrl = new URL(currentSrc);
    const nextUrl = new URL(nextSrc);
    return (
      currentUrl.origin === nextUrl.origin &&
      currentUrl.pathname === nextUrl.pathname &&
      currentUrl.searchParams.has('component') &&
      nextUrl.searchParams.has('component')
    );
  } catch {
    return false;
  }
}

export function usePreviewBridge({ iframeEl, canvas, onStateUpdate }: UsePreviewBridgeOptions): UsePreviewBridgeResult {
  const [devServerRunning, setDevServerRunning] = useState(false);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showNoComponentHint, setShowNoComponentHint] = useState(false);
  const [projectError, setProjectError] = useState<UnsupportedProjectError | null>(null);
  const [projectCapabilities, setProjectCapabilities] = useState<import('../types').ProjectCapabilities | null>(null);
  const [componentError, setComponentError] = useState<ComponentError | null>(null);
  // Track whether we were previously connected (for reconnecting banner)
  const wasConnectedRef = useRef(false);
  const [disconnected, setDisconnected] = useState(false);

  // Keep onStateUpdate stable via ref to avoid re-subscribing
  const onStateUpdateRef = useRef(onStateUpdate);
  onStateUpdateRef.current = onStateUpdate;

  // Track current component for re-sending after HMR full reload.
  // When Vite triggers a full page reload inside the iframe, the React state
  // in CanvasPreview is lost. history.replaceState keeps the URL in sync,
  // but as a safety net we also re-send setComponent after each iframe load.
  const currentComponentRef = useRef<string | null>(null);
  const devServerUrlRef = useRef<string | null>(null);
  const previewUrlRef = useRef<string | null>(null);
  // Keep iframeEl in a ref so callbacks stay stable.
  // Direct assignment during render is intentional — this is the standard React pattern
  // for syncing refs with props. Wrapping in useEffect would create a stale-ref window
  // between render and effect execution, which is worse than synchronous assignment.
  const iframeElRef = useRef(iframeEl);
  iframeElRef.current = iframeEl;
  const setStoredPreviewUrl = useCallback((url: string | null) => {
    previewUrlRef.current = url;
    setPreviewUrl(url);
  }, []);

  const navigateToComponent = useCallback(
    (component: string, baseUrl = devServerUrlRef.current): boolean => {
      if (!baseUrl) return false;
      setShowNoComponentHint(false);
      setStoredPreviewUrl(buildComponentPreviewUrl(baseUrl, component));
      return true;
    },
    [setStoredPreviewUrl],
  );

  const getFrameHref = useCallback((frame: HTMLIFrameElement): string => {
    const frameSrc = frame.getAttribute('src') || frame.src;
    try {
      return frame.contentWindow?.location.href || frameSrc;
    } catch {
      return frameSrc;
    }
  }, []);

  const syncComponentToFrame = useCallback(
    (component: string, frame = iframeElRef.current): boolean => {
      if (!frame || !hasNavigatedPreviewSource(frame.getAttribute('src') || frame.src)) {
        return navigateToComponent(component);
      }

      const frameHref = getFrameHref(frame);
      const baseUrl = devServerUrlRef.current;
      const nextUrl = baseUrl ? buildComponentPreviewUrl(baseUrl, component) : null;
      if (nextUrl && !canUpdatePreviewComponentInPlace(frameHref, nextUrl)) {
        return navigateToComponent(component, baseUrl);
      }

      const currentComponent = getComponentFromPreviewUrl(frameHref);
      if (!currentComponent) {
        return navigateToComponent(component);
      }

      if (currentComponent !== component) {
        frame.contentWindow?.postMessage({ type: 'hypercanvas:setComponent', component }, '*'); // nosemgrep: wildcard-postmessage-configuration
      }
      return true;
    },
    [getFrameHref, navigateToComponent],
  );

  // === iframe -> extension message forwarding ===
  // Origin validation: event.source check ensures only messages from our iframe are processed.
  // In VS Code webviews, origin strings are opaque (vscode-webview://<session-id>) so
  // source-based validation is the correct approach, not origin string comparison.
  useEffect(() => {
    if (!iframeEl) return;

    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeEl?.contentWindow) return;

      const msg = event.data;
      // Guard: only process well-formed messages. Property-level validation is not needed —
      // messages originate from our own iframe bundle (controlled code, not external input).
      if (!msg?.type) return;

      // Iframe → extension bridge: hypercanvas:* messages are adapted to PlatformMessage channel.
      // These event types (runtime:error, diagnostic:console, elementContentResult, previewLoaded)
      // are extension-only and intentionally NOT in the PlatformMessage union — adding them
      // would pollute the shared type used by all platform consumers (browser, CLI, etc.).
      // The 'as unknown as PlatformMessage' casts are the deliberate bridging pattern here.
      if (msg.type.startsWith('hypercanvas:')) {
        if (msg.type === 'hypercanvas:runtimeError') {
          canvas.sendEvent({ type: 'runtime:error', error: msg.error } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:console') {
          canvas.sendEvent({ type: 'diagnostic:console', entries: msg.entries } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:elementContentResult') {
          canvas.sendEvent({
            type: 'elementContentResult',
            requestId: msg.requestId,
            text: msg.text,
            html: msg.html,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:screenshotResult') {
          canvas.sendEvent({
            type: 'screenshotResult',
            requestId: msg.requestId,
            dataUrl: msg.dataUrl,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:resolveServerSourceMap') {
          // Approach B: iframe requests server-side source map resolution from extension host.
          // Forward to extension host which reads the .map file from the local filesystem.
          canvas.sendEvent(msg as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:componentError') {
          // ErrorBoundary caught a render error — show overlay in webview layer.
          // Always update (bump errorSeq) so overlay can detect re-fires and reset state.
          setComponentError((prev) => {
            const sameComponent = prev && prev.componentPath === msg.componentPath;
            if (!sameComponent) {
              canvas.sendEvent({
                type: 'errorBoundary:getPropsSchema',
                componentPath: msg.componentPath,
              } as unknown as PlatformMessage);
            }
            return {
              componentPath: msg.componentPath,
              error: msg.error,
              errorSeq: (prev?.errorSeq ?? 0) + 1,
              // Keep existing schema if same component
              propsSchema: sameComponent ? prev.propsSchema : undefined,
            };
          });
        } else if (msg.type === 'hypercanvas:componentRenderSucceeded') {
          setComponentError((prev) => applyComponentRenderSucceeded(prev, msg.componentPath));
        } else if (msg.type === 'hypercanvas:componentMissing') {
          // Component not in registry — forward to extension host to trigger self-healing.
          canvas.sendEvent({
            type: 'hypercanvas:componentMissing',
            componentPath: msg.componentPath,
          } as unknown as PlatformMessage);
        }
        return;
      }

      // Platform messages -> forward to extension
      if (
        msg.type.startsWith('editor:') ||
        msg.type.startsWith('ast:') ||
        msg.type.startsWith('ai:') ||
        msg.type.startsWith('state:')
      ) {
        canvas.sendEvent(msg as PlatformMessage);
        return;
      }

      if (msg.type === 'previewLoaded') {
        // Same bridging pattern as hypercanvas:* above — extension-only event type
        canvas.sendEvent({ type: 'previewLoaded' } as unknown as PlatformMessage);
        return;
      }

      if (msg.type === 'chrome-detected') {
        canvas.sendEvent({ type: 'chrome-detected' } as unknown as PlatformMessage);
        return;
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe
    return () => window.removeEventListener('message', handleMessage);
  }, [canvas, iframeEl]);

  // === Re-send current component after iframe (re)load ===
  // When Vite HMR triggers a full page reload inside the iframe, the postMessage-based
  // setComponent is lost (the old page is gone). After the new page loads, CanvasPreview
  // reads componentPath from URL params. The history.replaceState fix in generator.ts
  // keeps the URL in sync, but as a safety net we also re-send the component postMessage
  // after each load event — guaranteeing that both the React state AND the
  // iframe-interaction.ts renderedComponentPath are up to date.
  useEffect(() => {
    if (!iframeEl) return;
    let initialLoad = true; // skip the very first load (initial navigation)
    function handleLoad() {
      const comp = currentComponentRef.current;
      if (comp && iframeEl && shouldNavigateFrameToComponent(getFrameHref(iframeEl), comp)) {
        syncComponentToFrame(comp, iframeEl);
        return;
      }
      if (initialLoad) {
        initialLoad = false;
        return;
      }
      if (comp && iframeEl?.contentWindow) {
        // Small delay: wait for iframe scripts to initialize their message listeners
        setTimeout(() => {
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:setComponent', component: comp },
            '*', // nosemgrep: wildcard-postmessage-configuration -- webview->iframe, same-origin VS Code context
          );
        }, 100);
      }
    }
    iframeEl.addEventListener('load', handleLoad);
    return () => iframeEl.removeEventListener('load', handleLoad);
  }, [getFrameHref, iframeEl, syncComponentToFrame]);

  // === Refresh logic ===
  const doRefresh = useCallback(() => {
    const frame = iframeElRef.current;
    if (!frame) return;
    // Prefer contentWindow.location.href — it reflects the current component
    // after history.replaceState updates from setComponent (frame.src still
    // holds the original first-load URL and is never updated to avoid reloads).
    let url: string;
    try {
      url = frame.contentWindow?.location.href || frame.src;
    } catch {
      url = frame.src; // cross-origin fallback
    }
    frame.src = '';
    setTimeout(() => {
      frame.src = url;
    }, 50);
  }, []);

  // === extension -> webview message handling ===
  // NOTE: This is a separate message listener from the iframe handler above — intentionally.
  // Each effect has its own dependency array and lifecycle. Merging them would widen
  // the dependency surface, causing unnecessary re-subscriptions. There is no race
  // condition: the two handlers process disjoint message type domains (hypercanvas:*
  // vs extension commands), and postMessage ordering within each domain is preserved.
  //
  // SECURITY NOTE: All postMessage calls below use '*' as targetOrigin intentionally.
  // In VS Code webviews, the iframe origin is opaque (vscode-webview://<session-id>)
  // and changes every session — specifying a concrete origin is not possible.
  // Messages are scoped to the iframe's contentWindow, which is same-origin within
  // the webview, so '*' does not widen the attack surface.
  //
  // ORIGIN VALIDATION: Messages here come from the VS Code extension host via the
  // webview API (acquireVsCodeApi().postMessage). The extension host is a trusted
  // origin — there is no untrusted sender to validate against. Iframe messages
  // are filtered out by the event.source check below.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (!msg?.type) return;

      // Ignore messages from iframe (handled above)
      if (iframeEl && event.source === iframeEl.contentWindow) return;

      switch (msg.type) {
        case 'devserver:statusChanged':
          if (!msg.running && wasConnectedRef.current) {
            setDisconnected(true);
          }
          if (msg.running) {
            setDisconnected(false);
            wasConnectedRef.current = true;
          }
          setDevServerRunning(msg.running);
          devServerUrlRef.current = msg.url ?? null;
          setDevServerUrl(devServerUrlRef.current);
          if (!msg.running) {
            // Drop the iframe session entirely. VS Code can reuse the same webview
            // when the workspace changes; keeping the old component would navigate
            // the next dev server to a stale path before the new component is ready.
            currentComponentRef.current = null;
            setComponentError(null);
            setShowNoComponentHint(false);
            setStoredPreviewUrl(null);
          }
          if (msg.running && devServerUrlRef.current && currentComponentRef.current && !previewUrlRef.current) {
            navigateToComponent(currentComponentRef.current, devServerUrlRef.current);
          }
          break;

        case 'updateUrl': {
          const url = typeof msg.url === 'string' ? msg.url : undefined;
          if (!url) break;
          setShowNoComponentHint(false);
          // Only clear error when switching to a different component
          try {
            const comp = new URL(url).searchParams.get('component');
            setComponentError((prev) => (prev && prev.componentPath === comp ? prev : null));
            if (comp) currentComponentRef.current = comp;
          } catch {
            /* ignore */
          }
          const frame = iframeElRef.current;
          const frameSrc = frame?.getAttribute('src') || frame?.src;
          if (frame && hasNavigatedPreviewSource(frameSrc)) {
            // Iframe already loaded — extract component param and send via postMessage
            // to avoid iframe navigation flash
            try {
              const component = new URL(url).searchParams.get('component');
              if (component && canUpdatePreviewComponentInPlace(getFrameHref(frame), url)) {
                frame.contentWindow?.postMessage({ type: 'hypercanvas:setComponent', component }, '*'); // nosemgrep: wildcard-postmessage-configuration
                canvas.sendEvent({ type: 'state:update', patch: { selectedElementRuntimeStyle: null } });
                break;
              }
            } catch {
              /* invalid URL — fall through to full navigation */
            }
          }
          setStoredPreviewUrl(url);
          break;
        }

        case 'showNoComponentHint':
          setShowNoComponentHint(true);
          break;

        case 'refresh':
          doRefresh();
          break;

        case 'setComponent': {
          const comp = typeof msg.component === 'string' ? msg.component : null;
          if (comp) currentComponentRef.current = comp;
          // Only clear error when switching to a DIFFERENT component
          setComponentError((prev) => (prev && prev.componentPath === comp ? prev : null));
          // Clear stale runtime style from previous component (postMessage switch skips iframe reload)
          canvas.sendEvent({ type: 'state:update', patch: { selectedElementRuntimeStyle: null } });
          const frame = iframeElRef.current;
          const frameSrc = frame?.getAttribute('src') || frame?.src;
          if (frame?.contentWindow && hasNavigatedPreviewSource(frameSrc)) {
            const currentComponent = getComponentFromPreviewUrl(getFrameHref(frame));
            if (currentComponent) {
              // Send via postMessage — no iframe reload
              frame.contentWindow.postMessage({ type: 'hypercanvas:setComponent', component: msg.component }, '*'); // nosemgrep: wildcard-postmessage-configuration
            } else if (comp) {
              navigateToComponent(comp);
            }
          } else if (comp) {
            navigateToComponent(comp);
          }
          break;
        }

        case 'goToVisual':
          // Update overlay state (selection highlighting)
          onStateUpdateRef.current({
            selectedIds: [msg.elementId],
            selectedItemIndices: {},
          });
          // Forward to iframe (state sync + scroll to element)
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe, same-origin VS Code context
          iframeEl?.contentWindow?.postMessage({ type: 'hypercanvas:goToVisual', elementId: msg.elementId }, '*');
          break;

        case 'state:update':
          // Forward to canvas interaction (overlay rendering)
          if (msg.patch) {
            const component = (msg.patch as { currentComponent?: { path?: unknown } | null }).currentComponent;
            if (component === null) {
              currentComponentRef.current = null;
            }
            if (typeof component?.path === 'string' && shouldNavigateFromSharedStateMessage(msg.type)) {
              currentComponentRef.current = component.path;
              syncComponentToFrame(component.path);
            }
            onStateUpdateRef.current(msg.patch);
          }
          // Forward to iframe (platform state sync)
          iframeEl?.contentWindow?.postMessage(msg, '*'); // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          break;

        case 'state:init':
          // Forward to canvas interaction (full state)
          if (msg.state) {
            const component = (msg.state as { currentComponent?: { path?: unknown } | null }).currentComponent;
            if (component === null) {
              currentComponentRef.current = null;
            }
            if (typeof component?.path === 'string' && shouldNavigateFromSharedStateMessage(msg.type)) {
              currentComponentRef.current = component.path;
              syncComponentToFrame(component.path);
            }
            onStateUpdateRef.current(msg.state);
          }
          // Forward to iframe
          iframeEl?.contentWindow?.postMessage(msg, '*'); // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          break;

        case 'ast:response':
        case 'editor:activeFileChanged':
          // Forward to iframe
          iframeEl?.contentWindow?.postMessage(msg, '*'); // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          break;

        // Extension requests element content from iframe (Copy Text / Copy as HTML)
        case 'getElementText':
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:getElementText', elementId: msg.elementId, requestId: msg.requestId },
            '*',
          );
          break;

        case 'getElementHTML':
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:getElementHTML', elementId: msg.elementId, requestId: msg.requestId },
            '*',
          );
          break;

        case 'takeScreenshot':
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:takeScreenshot', elementId: msg.elementId, requestId: msg.requestId },
            '*',
          );
          break;

        case 'projectError':
          // Extension detected an unsupported project type (e.g. React Native / Tamagui)
          setProjectError((msg.error as UnsupportedProjectError) ?? null);
          break;

        case 'projectCapabilities':
          // Extension detected CSS system and computed read/write capabilities
          setProjectCapabilities(
            (msg as { capabilities?: import('../types').ProjectCapabilities }).capabilities ?? null,
          );
          break;

        case 'errorBoundary:propsSchema':
          // Extension responded with prop type schema — enrich existing componentError
          setComponentError((prev) =>
            prev && prev.componentPath === msg.componentPath
              ? { ...prev, propsSchema: msg.propsSchema as SimplePropInfo[] }
              : prev,
          );
          break;

        case 'serverSourceMapResult':
          // Approach B: extension host resolved a server-side (RSC) source map — forward to iframe.
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          // Spread msg first so our namespaced type wins over msg.type ('serverSourceMapResult')
          iframeEl?.contentWindow?.postMessage({ ...msg, type: 'hypercanvas:serverSourceMapResult' }, '*');
          break;

        case 'canvas:refocusIframe':
          // After reveal(false) steals focus from iframe, refocus it so keyboard events work
          iframeEl?.focus();
          break;

        case 'canvas:keyboard':
          // Forward keyboard command from VS Code keybinding into iframe
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:syntheticKeydown', key: msg.key, shiftKey: msg.shiftKey },
            '*',
          );
          break;
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe
    return () => window.removeEventListener('message', handleMessage);
  }, [canvas, doRefresh, getFrameHref, iframeEl, navigateToComponent, setStoredPreviewUrl, syncComponentToFrame]);

  // === Signal webview ready to extension ===
  // 'webview:ready' is an internal extension event, not a PlatformMessage —
  // no type cast needed (unlike platform-bridged commands below).
  // canvas is a stable CanvasAdapter singleton — this effect fires exactly once on mount.
  // [canvas] is kept in deps for React exhaustive-deps lint compliance (biome enforces it);
  // using [] would trigger a lint error. Since canvas never changes, the behavior is identical.
  useEffect(() => {
    canvas.sendEvent({ type: 'webview:ready' });
  }, [canvas]);

  // Extension-only command — same bridging pattern, not a PlatformMessage type
  const handleStartDevServer = useCallback(() => {
    canvas.sendEvent({ type: 'command:startDevServer' } as unknown as PlatformMessage);
  }, [canvas]);

  const clearComponentError = useCallback(() => setComponentError(null), []);

  return {
    devServerRunning,
    devServerUrl,
    disconnected,
    previewUrl,
    showNoComponentHint,
    projectError,
    projectCapabilities,
    componentError,
    handleStartDevServer,
    handleRefresh: doRefresh,
    clearComponentError,
  };
}
