/**
 * Preview Bridge hook — handles message routing between iframe, webview, and extension.
 *
 * Replaces the inline JS from PreviewPanel._getHtmlForWebview():
 * - iframe -> extension: forwards runtime errors, platform messages, previewLoaded
 * - extension -> webview: handles devserver status, URL updates, UI state
 * - extension -> iframe: forwards state:update, state:init, ast:response, editor:activeFileChanged
 * - extension -> canvas interaction: forwards state patches for overlay rendering
 */

import type { NonPreviewableReason, NonPreviewableRecommendation, SimplePropInfo } from '@shared/components/overlays';
import type { RouteSuggestionItem } from '@shared/components/preview-chrome';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasAdapter, PlatformMessage } from '@/lib/platform/types';
import type { UnsupportedProjectError } from '../types';
import type { PickerGroupsData } from './CanvasComponentPicker';
import { postToPreviewIframe } from './postToPreviewIframe';

/**
 * The opened file cannot be previewed (entry/bootstrap or no renderable component
 * export). Drives the NonPreviewableFileOverlay instead of the dead iframe spinner.
 */
interface NonPreviewableFile {
  filePath: string;
  reason: NonPreviewableReason;
  recommendations: NonPreviewableRecommendation[];
}

/**
 * App-mode preview state — set by the extension host's `appMode` message when the user
 * previews the SPA entry root AS AN APP. Drives the address bar in the panel chrome.
 */
export interface AppModeState {
  /** Project-relative path of the app entry being previewed (the `?component=` target). */
  entryPath: string;
  /** Code-derived route suggestions for the address-bar dropdown (empty → no dropdown). */
  routeSuggestions: RouteSuggestionItem[];
  /** The in-app address currently shown (resting value of the address bar). */
  currentRoute: string;
}

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
  /**
   * Required props the deterministic auto-sample generator could not satisfy
   * (feature #210). Populated asynchronously alongside propsSchema. The overlay
   * highlights these as "needs attention".
   */
  unsatisfiedProps?: string[];
  /**
   * True when the component file already contains a `SampleDefault` export.
   * Gates `useAutoCreateEmptySample` — prevents silently overwriting a real
   * (possibly broken) sample for components with generic runtime errors (HYP-648 P1 fix).
   */
  hasSample?: boolean;
}

interface UsePreviewBridgeResult {
  devServerRunning: boolean;
  devServerUrl: string | null;
  /** True when server was running but disconnected (show reconnecting banner) */
  disconnected: boolean;
  previewUrl: string | null;
  showNoComponentHint: boolean;
  /** Scanner component groups (atom/composite/page) — drives the canvas component picker. */
  componentGroups: PickerGroupsData | null;
  /** True when BOTH side panels (Explorer + Inspector) are hidden — gates the canvas picker. */
  sidePanelsHidden: boolean;
  /** Pick a component from the canvas picker — drives the normal stateHub selection pipeline. */
  selectComponent: (name: string, path: string) => void;
  /** Set when extension detects an unsupported project type (e.g. React Native / Tamagui) */
  projectError: UnsupportedProjectError | null;
  /** Detected project capabilities — CSS system, readonly mode, etc. */
  projectCapabilities: import('../types').ProjectCapabilities | null;
  /** Set when iframe ErrorBoundary catches a component render error */
  componentError: ComponentError | null;
  /** Set when the opened file is not previewable (entry/bootstrap or no component export). */
  unsupportedFile: NonPreviewableFile | null;
  /** Open + preview a recommended component from the non-previewable overlay. */
  selectRecommendation: (recommendation: NonPreviewableRecommendation) => void;
  /** Current value of hypercanvas.devServer.autoStart setting */
  autoStart: boolean;
  /** Non-null when previewing an app entry AS AN APP (shows the address bar). */
  appMode: AppModeState | null;
  /** Navigate the previewed app to an in-app address (posts into the iframe's own router). */
  navigateAppRoute: (route: string) => void;
  handleStartDevServer: () => void;
  handleRefresh: () => void;
  clearComponentError: () => void;
  handleAutoStartChange: (value: boolean) => void;
  handleOpenAutoStartSettings: () => void;
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

/**
 * Reduce a `hypercanvas:appRouteChanged` message into app-mode state: reflect the route the
 * previewed app navigated to internally (a `<Link>` click or browser back/forward) in the address
 * bar. A no-op (returns `prev` unchanged) when app-mode is off or the route already matches, so it
 * never resurrects a closed app-mode session and skips a needless re-render.
 */
export function applyAppRouteChanged(prev: AppModeState | null, route: string): AppModeState | null {
  // Reject anything that is not an in-app absolute path. Project code runs INSIDE the preview
  // iframe and can post an arbitrary `hypercanvas:appRouteChanged` payload, so only a `/`-rooted
  // route is a legitimate address-bar value (mirrors the SaaS useAppPreviewMode guard). A no-op
  // (returns `prev`) when app-mode is off, the payload is not a route, or the route already matches.
  if (!prev || !route.startsWith('/') || prev.currentRoute === route) return prev;
  return { ...prev, currentRoute: route };
}

/**
 * Selection / interaction fields forwarded into the iframe as `hypercanvas:stateUpdate`. These are
 * the only fields the iframe bridge reads from that message (see iframe-interaction.ts), so they are
 * the complete payload to replay when the bridge announces it is ready (#51).
 */
export interface ForwardedIframeState {
  selectedIds?: string[];
  hoveredId?: string | null;
  hoveredItemIndex?: number | null;
  selectedItemIndices?: Record<string, number | null>;
  engineMode?: string;
}

const FORWARDED_STATE_KEYS: ReadonlyArray<keyof ForwardedIframeState> = [
  'selectedIds',
  'hoveredId',
  'hoveredItemIndex',
  'selectedItemIndices',
  'engineMode',
];

/**
 * Accumulate the latest selection / interaction state forwarded into the iframe (#51).
 *
 * Each `state:init` / `state:update` (and tree `goToVisual`) forwards a `hypercanvas:stateUpdate`
 * to the iframe, applying only the fields it carries (last-write-wins per field). We mirror that
 * here so we hold the current effective state and can re-send it once the late-loading Remix bridge
 * announces `hypercanvas:bridgeReady` — replaying a selection that was issued before the bridge's
 * message listener existed. A `null`/undefined patch leaves the accumulator unchanged; an absent
 * field is preserved (it was not part of this patch), matching the iframe's `!== undefined` guards.
 */
export function mergeForwardedState(
  prev: ForwardedIframeState | null,
  patch: Record<string, unknown> | null | undefined,
): ForwardedIframeState | null {
  if (!patch || typeof patch !== 'object') return prev;
  let next: ForwardedIframeState | null = prev;
  for (const key of FORWARDED_STATE_KEYS) {
    if (!(key in patch)) continue;
    if (next === prev) next = { ...prev };
    // The value originates from our own StateHub patch (controlled shape), spread verbatim into
    // the iframe message — so we store it verbatim too.
    (next as Record<string, unknown>)[key] = patch[key];
  }
  return next;
}

/** True when the accumulated state has at least one selection/interaction field worth replaying. */
export function hasForwardableState(state: ForwardedIframeState | null): state is ForwardedIframeState {
  return state != null && FORWARDED_STATE_KEYS.some((key) => key in state);
}

/**
 * Derive PII-SAFE telemetry props for an in-app route change. We NEVER send the
 * route string itself (it leaks app structure, ids, query params). Instead we
 * emit only structural shape: the path-segment DEPTH (how deep the user is) and
 * whether it is a hash route. Pure + exported so it is unit-testable.
 *
 * `route` is the already-validated `/`-rooted in-app path from
 * `hypercanvas:appRouteChanged`. The leading `/` and any query/hash are split off
 * before counting segments so `/a/b?x=1` and `/a/b` both report depth 2.
 */
export function routeNavigationTelemetryProps(route: string): { routeDepth: number; isHashRoute: boolean } {
  const hashIdx = route.indexOf('#');
  const isHashRoute = hashIdx !== -1;
  // For a hash route (`/#/users/5`) the meaningful path is INSIDE the hash, so
  // count the hash fragment's segments; otherwise count the leading path. Strip
  // the query (`?…`) in both cases. We never emit the route text — only depth.
  const meaningful = isHashRoute ? route.slice(hashIdx + 1) : route;
  const pathOnly = meaningful.split('?', 1)[0];
  const segments = pathOnly.split('/').filter((s) => s.length > 0);
  return { routeDepth: segments.length, isHashRoute };
}

export function canUpdatePreviewComponentInPlace(
  currentSrc: string | null | undefined,
  nextSrc: string | null | undefined,
): boolean {
  if (!hasNavigatedPreviewSource(currentSrc) || !hasNavigatedPreviewSource(nextSrc)) return false;

  try {
    const currentUrl = new URL(currentSrc);
    const nextUrl = new URL(nextSrc);
    // Entering/leaving app-mode flips the `app` param, which the generated preview reads
    // ONLY at mount to choose the render mode. An in-place setComponent would keep the old
    // mode, so a change in `app` forces a real navigation (full iframe reload) instead.
    const sameAppFlag = currentUrl.searchParams.get('app') === nextUrl.searchParams.get('app');
    return (
      sameAppFlag &&
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
  // Canvas component picker (shown when no component is selected AND both side panels are hidden).
  const [componentGroups, setComponentGroups] = useState<PickerGroupsData | null>(null);
  // Default true: with both panels never opened (the exact bug scenario) the host fires no
  // visibility change, so the picker must be allowed by default and only suppressed once a panel
  // reports itself visible.
  const [sidePanelsHidden, setSidePanelsHidden] = useState(true);
  const [projectError, setProjectError] = useState<UnsupportedProjectError | null>(null);
  const [projectCapabilities, setProjectCapabilities] = useState<import('../types').ProjectCapabilities | null>(null);
  const [componentError, setComponentError] = useState<ComponentError | null>(null);
  const [unsupportedFile, setUnsupportedFile] = useState<NonPreviewableFile | null>(null);
  const [autoStart, setAutoStart] = useState(false);
  const [appMode, setAppMode] = useState<AppModeState | null>(null);
  // Last in-app route we emitted canvas.routeNavigated for. A ref (not state) so
  // the dedupe survives re-renders AND the telemetry emit lives OUTSIDE the
  // setAppMode reducer (a reducer must stay pure — React StrictMode invokes it
  // twice in dev, which would double-post a side effect).
  const lastNavTelemetryRouteRef = useRef<string | null>(null);
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
  // Feature #210 — latest in-memory generated sample props per component path.
  // Cached so we can re-forward them into the iframe after a (re)load, when the
  // iframe's message listener was not yet registered the first time around.
  const generatedPropsByPathRef = useRef<Record<string, Record<string, unknown>>>({});
  // #51 — latest selection / interaction state forwarded into the iframe. Mirrors every
  // hypercanvas:stateUpdate we send so we can replay it when the late-loading Remix bridge
  // posts hypercanvas:bridgeReady (its listener mounts several async hops after hydration, so
  // a selection issued before then would otherwise be dropped with no replay).
  const lastForwardedStateRef = useRef<ForwardedIframeState | null>(null);
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
        postToPreviewIframe(frame, { type: 'hypercanvas:setComponent', component });
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
        } else if (msg.type === 'hypercanvas:liveClassNameResult') {
          // HYP-544: iframe answered the write-time live-className request — forward to the
          // extension host, which resolves the pending requestLiveClassName promise.
          canvas.sendEvent({
            type: 'liveClassNameResult',
            requestId: msg.requestId,
            className: msg.className,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:probeColorCandidatesResult') {
          // HYP-544 Phase 3: iframe answered the empirical color-probe — forward the ranked
          // driving-candidate list to the extension host, which resolves the pending
          // requestProbeColorCandidates promise.
          canvas.sendEvent({
            type: 'probeColorCandidatesResult',
            requestId: msg.requestId,
            driving: msg.driving,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:resolveServerSourceMap') {
          // Approach B: iframe requests server-side source map resolution from extension host.
          // Forward to extension host which reads the .map file from the local filesystem.
          canvas.sendEvent(msg as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:componentError') {
          // ErrorBoundary caught a render error — show overlay in webview layer.
          // Always update (bump errorSeq) so overlay can detect re-fires and reset state.
          //
          // Also forward to the extension host (HYP-487): a provider-context error
          // ("useAuth must be used inside <AuthProvider>") in a no-router Vite app
          // means the previewed component rendered OUTSIDE its provider tree. The
          // host inspects the message and, if it matches, auto-generates the
          // .hyperide/preview.tsx wrapper (isolated mode). Same forward pattern as
          // hypercanvas:componentMissing below — the local overlay stays as-is.
          canvas.sendEvent({
            type: 'hypercanvas:componentError',
            componentPath: msg.componentPath,
            error: msg.error,
          } as unknown as PlatformMessage);
          setComponentError((prev) => {
            const sameComponent = prev && prev.componentPath === msg.componentPath;
            if (!sameComponent) {
              canvas.sendEvent({
                type: 'errorBoundary:getPropsSchema',
                componentPath: msg.componentPath,
              });
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
          // Telemetry (host-side): forward the success so the extension host can
          // emit preview.renderSucceeded + the one-shot funnel.firstPreview. The
          // componentPath is consumed host-side only for a coarse componentKind
          // bucket — it is never sent as a telemetry prop.
          canvas.sendEvent({
            type: 'preview:renderSucceeded',
            componentPath: msg.componentPath,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:componentMissing') {
          // Component not in registry — forward to extension host to trigger self-healing.
          canvas.sendEvent({
            type: 'hypercanvas:componentMissing',
            componentPath: msg.componentPath,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:appRouteChanged') {
          // The previewed app navigated INTERNALLY (a <Link> click or browser back/forward); the
          // generated bridge posts the new UNPREFIXED route. Mirror it into the address bar so the
          // bar doesn't show a stale route until the user types one. (The SaaS canvas already does
          // this in useAppPreviewMode; this is the VS Code-panel counterpart.)
          if (typeof msg.route === 'string') {
            const route = msg.route;
            setAppMode((prev) => applyAppRouteChanged(prev, route));
            // Telemetry emitted OUTSIDE the reducer (reducers must be pure). Only a
            // valid in-app `/`-rooted route that differs from the last one we
            // counted — dedupes idle re-fires and rejects payloads the address bar
            // would also reject. Raw event-name string (not a TelemetryEvents
            // import) keeps node-side telemetry out of the webview bundle; the host
            // allow-lists 'canvas.routeNavigated'.
            if (route.startsWith('/') && route !== lastNavTelemetryRouteRef.current) {
              lastNavTelemetryRouteRef.current = route;
              canvas.sendEvent({
                type: 'telemetry:event',
                name: 'canvas.routeNavigated',
                props: routeNavigationTelemetryProps(route),
              } as unknown as PlatformMessage);
            }
          }
        } else if (msg.type === 'hypercanvas:bridgeReady') {
          // #51 — the iframe bridge finished mounting its message listener and announced itself.
          // For Remix the bridge loads several async hops after hydration (a post-mount useEffect
          // in the generated route), so any selection forwarded before this point was dropped with
          // no replay. Re-send the latest selection / interaction state now that the bridge can
          // receive it. Idempotent and harmless for the non-Remix synchronous path (the bridge is
          // already up, the ready fires immediately, and the re-send just re-applies current state).
          if (hasForwardableState(lastForwardedStateRef.current)) {
            postToPreviewIframe(iframeEl, {
              type: 'hypercanvas:stateUpdate',
              ...lastForwardedStateRef.current,
            });
          }
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

  // Tree → canvas scroll is now driven entirely by the `iframe:scrollToElement` message
  // (LeftPanel → extension host → StateHub.broadcast → PreviewPanel webview, handled in
  // the extension-message switch below). The earlier local `hypercanvas:treeSelect`
  // CustomEvent path was deleted: VS Code webviews are isolated iframes, so a CustomEvent
  // dispatched in the LeftPanel window never reached the listener in this PreviewPanel
  // window. SaaS takes the engine.select branch in useElementSelection and never used it.

  // === Tree selection → canvas scroll ===
  // When the user clicks an element in the Elements Tree, useElementSelection dispatches
  // a local CustomEvent. We forward it to the iframe as hypercanvas:goToVisual so the
  // canvas scrolls to the element. This is local-only (no round-trip through extension host).
  useEffect(() => {
    function handleTreeSelect(event: Event) {
      const e = event as CustomEvent<{ elementId: string }>;
      const elementId = e.detail?.elementId;
      if (!elementId) return;
      postToPreviewIframe(iframeElRef.current, { type: 'hypercanvas:goToVisual', elementId });
    }
    window.addEventListener('hypercanvas:treeSelect', handleTreeSelect);
    return () => window.removeEventListener('hypercanvas:treeSelect', handleTreeSelect);
  }, []);

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
      // Feature #210 — re-forward cached generated props after each iframe (re)load.
      // The iframe's message listener is fresh on every load, so any props posted
      // before this load were lost; replay them (small delay to let listeners mount).
      if (comp && iframeEl?.contentWindow) {
        const cachedProps = generatedPropsByPathRef.current[comp];
        if (cachedProps) {
          setTimeout(() => {
            iframeEl?.contentWindow?.postMessage(
              { type: 'hypercanvas:setGeneratedProps', componentPath: comp, values: cachedProps },
              '*', // nosemgrep: wildcard-postmessage-configuration -- webview->iframe, same-origin VS Code context
            );
          }, 100);
        }
      }
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
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:setComponent', component: comp });
          // HYP-649: a non-initial load means the source was edited (HMR full reload)
          // or the iframe re-navigated. Bump the generated CanvasPreview's retryCount
          // so its ErrorBoundary remounts and a now-fixed component clears any stale
          // error overlay without a manual refresh.
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:retryRender' });
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
            // The replay state is scoped to the current component — drop it with the session so a
            // later bridgeReady can't replay the previous component's selection (#51).
            lastForwardedStateRef.current = null;
            setComponentError(null);
            setUnsupportedFile(null);
            setShowNoComponentHint(false);
            setStoredPreviewUrl(null);
          }
          if (msg.running && devServerUrlRef.current && currentComponentRef.current && !previewUrlRef.current) {
            navigateToComponent(currentComponentRef.current, devServerUrlRef.current);
          }
          break;

        case 'devserver:settings':
          if (typeof msg.autoStart === 'boolean') setAutoStart(msg.autoStart);
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
                postToPreviewIframe(frame, { type: 'hypercanvas:setComponent', component });
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

        case 'preview:componentGroups':
          // Scanner groups for the canvas picker — same data the Inspector quick-list uses.
          setComponentGroups({
            atomGroups: Array.isArray(msg.atomGroups) ? msg.atomGroups : [],
            compositeGroups: Array.isArray(msg.compositeGroups) ? msg.compositeGroups : [],
            pageGroups: Array.isArray(msg.pageGroups) ? msg.pageGroups : [],
          });
          break;

        case 'preview:sidePanelsHidden':
          // Host aggregates Explorer + Inspector visibility; true only when BOTH are hidden.
          setSidePanelsHidden(msg.hidden === true);
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
              postToPreviewIframe(frame, { type: 'hypercanvas:setComponent', component: msg.component });
            } else if (comp) {
              navigateToComponent(comp);
            }
          } else if (comp) {
            navigateToComponent(comp);
          }
          break;
        }

        case 'setGeneratedProps': {
          // Feature #210 — in-memory generated sample props. The extension host
          // computed best-effort values for ALL of a component's props and sends
          // them here BEFORE the navigation/setComponent that triggers the render.
          // The preview iframe is cross-origin to this webview, so we CANNOT stash
          // them on a shared window global (a parent-window read would throw
          // SecurityError) — we forward them into the iframe via postMessage, where
          // the generated __canvas_preview__.tsx holds them in React state and
          // injects them at render. They never touch the component source or the
          // generated preview file — pristine source, recomputed per select.
          const comp = typeof msg.componentPath === 'string' ? msg.componentPath : null;
          if (!comp) break;
          const values = msg.values && typeof msg.values === 'object' ? (msg.values as Record<string, unknown>) : {};
          // Remember the latest payload per path so we can re-forward after an iframe
          // (re)load, when the iframe's message listener was not yet registered.
          generatedPropsByPathRef.current[comp] = values;
          iframeElRef.current?.contentWindow?.postMessage(
            { type: 'hypercanvas:setGeneratedProps', componentPath: comp, values },
            '*', // nosemgrep: wildcard-postmessage-configuration -- webview->iframe, same-origin VS Code context
          );
          break;
        }

        case 'goToVisual':
          // Update overlay state (selection highlighting)
          onStateUpdateRef.current({
            selectedIds: [msg.elementId],
            selectedItemIndices: {},
          });
          // Record the selection so a late-mounting bridge can have it replayed (#51).
          // goToVisual selects exactly this element; iframe's goToVisual handler sets the
          // same selectedIds/selectedItemIndices, so a hypercanvas:stateUpdate replay matches.
          lastForwardedStateRef.current = mergeForwardedState(lastForwardedStateRef.current, {
            selectedIds: [msg.elementId],
            selectedItemIndices: {},
          });
          // Forward to iframe (state sync + scroll to element)
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:goToVisual', elementId: msg.elementId });
          break;

        case 'state:update':
          // Forward to canvas interaction (overlay rendering)
          if (msg.patch) {
            const component = (msg.patch as { currentComponent?: { path?: unknown } | null }).currentComponent;
            if (component === null) {
              currentComponentRef.current = null;
              lastForwardedStateRef.current = null; // selection is component-scoped (#51)
            }
            if (typeof component?.path === 'string' && shouldNavigateFromSharedStateMessage(msg.type)) {
              currentComponentRef.current = component.path;
              syncComponentToFrame(component.path);
            }
            onStateUpdateRef.current(msg.patch);
          }
          // Forward to iframe (platform state sync).
          // Iframe handler expects `hypercanvas:stateUpdate` with fields directly on the message
          // (not nested under `patch`). Forwarding raw `state:update` was silently ignored.
          if (msg.patch) {
            lastForwardedStateRef.current = mergeForwardedState(lastForwardedStateRef.current, msg.patch);
            postToPreviewIframe(iframeEl, { type: 'hypercanvas:stateUpdate', ...msg.patch });
          }
          break;

        case 'state:init':
          // Forward to canvas interaction (full state)
          if (msg.state) {
            const component = (msg.state as { currentComponent?: { path?: unknown } | null }).currentComponent;
            if (component === null) {
              currentComponentRef.current = null;
              lastForwardedStateRef.current = null; // selection is component-scoped (#51)
            }
            if (typeof component?.path === 'string' && shouldNavigateFromSharedStateMessage(msg.type)) {
              currentComponentRef.current = component.path;
              syncComponentToFrame(component.path);
            }
            onStateUpdateRef.current(msg.state);
            lastForwardedStateRef.current = mergeForwardedState(lastForwardedStateRef.current, msg.state);
            // Forward to iframe as stateUpdate — same pattern as state:update above.
            postToPreviewIframe(iframeEl, { type: 'hypercanvas:stateUpdate', ...msg.state });
          }
          break;

        case 'iframe:clearGraceCache':
          // Drop stale selection-rect cache entry after i18n write; forces fresh DOM lookup
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:clearGraceCache', elementId: msg.elementId });
          break;

        case 'iframe:scrollToElement':
          // Scroll canvas (iframe) to the specified element without changing selection
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:scrollToElement', elementId: msg.elementId });
          break;

        case 'iframe:writeI18nResource':
          // Freeze the last-known selection overlay rect during an i18n write so the
          // HMR re-render gap doesn't manifest as a visible deselect (Path B in
          // docs/plans/2026-05-06-selection-survives-i18n-write.md).
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:writeI18nResource', phase: msg.phase });
          break;

        case 'ast:response':
        case 'editor:activeFileChanged':
          // Forward to iframe
          postToPreviewIframe(iframeEl, msg);
          break;

        // Extension requests element content from iframe (Copy Text / Copy as HTML)
        case 'getElementText':
          postToPreviewIframe(iframeEl, {
            type: 'hypercanvas:getElementText',
            elementId: msg.elementId,
            requestId: msg.requestId,
          });
          break;

        case 'getElementHTML':
          postToPreviewIframe(iframeEl, {
            type: 'hypercanvas:getElementHTML',
            elementId: msg.elementId,
            requestId: msg.requestId,
          });
          break;

        case 'takeScreenshot':
          postToPreviewIframe(iframeEl, {
            type: 'hypercanvas:takeScreenshot',
            elementId: msg.elementId,
            requestId: msg.requestId,
          });
          break;

        // HYP-544: extension host requests the live applied className of an element from the
        // iframe at write time (DOM-anchored color replace). Forward to the iframe; the result
        // returns via 'hypercanvas:liveClassNameResult' (handled by useCanvasInteraction).
        case 'requestLiveClassName':
          postToPreviewIframe(iframeEl, {
            type: 'hypercanvas:requestLiveClassName',
            elementId: msg.elementId,
            itemIndex: msg.itemIndex,
            requestId: msg.requestId,
          });
          break;

        // HYP-544 Phase 3: extension host requests the empirical color-probe — which candidate
        // token drives the element's color, when the static AST classifier can't resolve it.
        // Forward to the iframe; the result returns via 'hypercanvas:probeColorCandidatesResult'.
        case 'probeColorCandidates':
          postToPreviewIframe(iframeEl, {
            type: 'hypercanvas:probeColorCandidates',
            elementId: msg.elementId,
            itemIndex: msg.itemIndex,
            prefixes: msg.prefixes,
            cssProp: msg.cssProp,
            requestedColor: msg.requestedColor,
            requestClass: msg.requestClass,
            requestId: msg.requestId,
          });
          break;

        case 'projectError':
          // Extension detected an unsupported project type (e.g. React Native / Tamagui)
          setProjectError((msg.error as UnsupportedProjectError) ?? null);
          break;

        case 'previewUnsupportedFile':
          // Extension classified the opened file as non-previewable (entry/bootstrap or
          // no renderable component export). Show the error+recommendations overlay
          // instead of the iframe's infinite "Generating sample…". A null payload clears it.
          setUnsupportedFile((msg as { payload?: NonPreviewableFile | null }).payload ?? null);
          break;

        case 'projectCapabilities':
          // Extension detected CSS system and computed read/write capabilities
          setProjectCapabilities(
            (msg as { capabilities?: import('../types').ProjectCapabilities }).capabilities ?? null,
          );
          break;

        case 'appMode': {
          // Extension host (de)activated app-mode for the SPA entry root. `enabled: false`
          // (or absent payload) tears the address bar down; `true` shows it with the
          // code-derived suggestions. Zero suggestions still shows the bar — the dropdown
          // (not the bar) is what hides on an empty list.
          const enabled = (msg as { enabled?: boolean }).enabled === true;
          if (!enabled) {
            setAppMode(null);
            break;
          }
          const m = msg as {
            entryPath?: string;
            routeSuggestions?: RouteSuggestionItem[];
            currentRoute?: string;
          };
          setAppMode({
            entryPath: typeof m.entryPath === 'string' ? m.entryPath : '',
            routeSuggestions: Array.isArray(m.routeSuggestions) ? m.routeSuggestions : [],
            currentRoute: typeof m.currentRoute === 'string' ? m.currentRoute : '/',
          });
          break;
        }

        case 'errorBoundary:propsSchema':
          // Extension responded with prop type schema — enrich existing componentError
          setComponentError((prev) =>
            prev && prev.componentPath === msg.componentPath
              ? {
                  ...prev,
                  propsSchema: msg.propsSchema as SimplePropInfo[],
                  unsatisfiedProps: (msg as { unsatisfiedProps?: string[] }).unsatisfiedProps ?? [],
                  hasSample: (msg as { hasSample?: boolean }).hasSample ?? false,
                }
              : prev,
          );
          break;

        case 'serverSourceMapResult':
          // Approach B: extension host resolved a server-side (RSC) source map — forward to iframe.
          // Spread msg first so our namespaced type wins over msg.type ('serverSourceMapResult')
          postToPreviewIframe(iframeEl, { ...msg, type: 'hypercanvas:serverSourceMapResult' });
          break;

        case 'canvas:refocusIframe':
          // After reveal(false) steals focus from iframe, refocus it so keyboard events work
          iframeEl?.focus();
          break;

        case 'canvas:keyboard':
          // Forward keyboard command from VS Code keybinding into iframe
          postToPreviewIframe(iframeEl, { type: 'hypercanvas:syntheticKeydown', key: msg.key, shiftKey: msg.shiftKey });
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

  const handleAutoStartChange = useCallback(
    (value: boolean) => {
      setAutoStart(value);
      canvas.sendEvent({ type: 'panel:updateAutoStart', value } as unknown as PlatformMessage);
    },
    [canvas],
  );

  const handleOpenAutoStartSettings = useCallback(() => {
    canvas.sendEvent({
      type: 'panel:openSettings',
      query: 'hypercanvas.devServer.autoStart',
    } as unknown as PlatformMessage);
  }, [canvas]);

  const clearComponentError = useCallback(() => setComponentError(null), []);

  // Recommendation click in the non-previewable overlay → ask the host to select that
  // component (same path as an Explorer click: opens the file + drives the preview).
  const selectRecommendation = useCallback(
    (recommendation: NonPreviewableRecommendation) => {
      canvas.sendEvent({
        type: 'preview:selectComponent',
        path: recommendation.path,
        name: recommendation.name,
      } as unknown as PlatformMessage);
    },
    [canvas],
  );

  // Pick a component from the canvas picker. Reuses the same `preview:selectComponent` host
  // message the non-previewable overlay's recommendation click uses — it drives the stateHub
  // `currentComponent` selection pipeline (reroot, open file, navigate preview), identical to
  // an Explorer/Inspector click.
  const selectComponent = useCallback(
    (name: string, path: string) => {
      canvas.sendEvent({ type: 'preview:selectComponent', name, path } as unknown as PlatformMessage);
    },
    [canvas],
  );

  // Drive the previewed app's own router by posting into the iframe. The generated
  // CanvasPreview handles `hypercanvas:navigateRoute` (pushState + popstate). We also
  // update the resting address locally so the bar reflects the new route immediately.
  const navigateAppRoute = useCallback((route: string) => {
    const target = route.startsWith('/') ? route : `/${route}`;
    postToPreviewIframe(iframeElRef.current, { type: 'hypercanvas:navigateRoute', route: target });
    setAppMode((prev) => (prev ? { ...prev, currentRoute: target } : prev));
  }, []);

  return {
    devServerRunning,
    devServerUrl,
    disconnected,
    previewUrl,
    showNoComponentHint,
    componentGroups,
    sidePanelsHidden,
    selectComponent,
    projectError,
    projectCapabilities,
    componentError,
    unsupportedFile,
    selectRecommendation,
    autoStart,
    appMode,
    navigateAppRoute,
    handleStartDevServer,
    handleRefresh: doRefresh,
    clearComponentError,
    handleAutoStartChange,
    handleOpenAutoStartSettings,
  };
}
