/**
 * @file App-preview ("preview as app") mode state for the SaaS canvas.
 *
 * Accessed via: rendered by client/pages/Editor/CanvasEditor.tsx. App-mode AUTO-engages when
 *   the selected component is a full app-entry wrapper (a router/provider root) — there is no
 *   manual toggle. On selection it re-parses the component with `app=1` (server marks it an app
 *   entry + rebuilds the preview), fetches code-derived route suggestions for the shared
 *   `<AddressBar>`, and drives the previewed app's OWN router by posting
 *   `hypercanvas:navigateRoute` into the preview iframe.
 * Assumptions: the preview iframe is served same-origin via the proxy path
 *   `/project-preview/<id>/…`, so navigate messages target `window.location.origin` (not '*').
 *   App-mode auto-disables whenever the selected component changes — the bar hides and the
 *   src stops carrying `app=1`. Suggestions are best-effort; an empty list renders no dropdown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_NAV_STRATEGY, type NavStrategy, type RouteSuggestionItem } from '@shared/components/preview-chrome';
import { getPreviewIframe } from '@/lib/dom-utils';
import { authFetch } from '@/utils/authFetch';

/** The message the generated preview listens for to navigate its own router (pushState + popstate). */
const NAVIGATE_ROUTE_MESSAGE = 'hypercanvas:navigateRoute';

interface AppRoutesResponse {
  candidates: string[];
  suggestions: RouteSuggestionItem[];
  isCandidate: boolean;
}

export interface UseAppPreviewModeParams {
  /** Project-relative path of the component currently shown in the canvas. */
  componentPath: string | undefined;
  /** Re-parse + rebuild the preview for `componentPath`; `appMode` toggles the `app=1` server
   *  path. Resolves `true` on a successful rebuild, `false` on a handled failure. */
  loadComponent: (componentPath: string, sampleName?: string, appMode?: boolean) => Promise<boolean>;
  /** Active sample name, forwarded to `loadComponent` so the re-parse keeps the same sample. */
  currentSampleName: string | null;
  /**
   * Gate for AUTO app-mode (default `true`). Pass `false` where app-mode must never engage even
   * for an app-entry candidate: the NodePod runtime drives the iframe via `overrideSrc` (bypassing
   * the `app=1` URL the generated preview reads, so the bar would show over a preview that never
   * entered app-mode), and readonly viewers' `parse-component` skips the app-entry rebuild (so a
   * `loadComponent` success would flip the bar on without a real app build). When `false`, the
   * candidacy check still runs but never enters app-mode.
   */
  enabled?: boolean;
  /**
   * In-preview navigation strategy (history-bridge / basename / src-swap). Defaults to the
   * recommended `history-bridge`. Drives how `onNavigate` reaches the previewed app's router and
   * how the iframe URL is built (see IframeCanvas). Selectable so the three approaches can be
   * compared; the default is the one the comparison spec recommends.
   */
  navStrategy?: NavStrategy;
}

export interface UseAppPreviewModeResult {
  /** Whether the current component is being previewed as an app (drives the iframe `app=1` src). */
  appMode: boolean;
  /** Code-derived route suggestions for the address-bar dropdown (empty ⇒ no dropdown). */
  suggestions: RouteSuggestionItem[];
  /** The in-app address currently shown in the preview (resting value for the address bar). */
  currentRoute: string;
  /** Navigate the previewed app to `path` and reflect it in the bar. */
  onNavigate: (path: string) => void;
  /**
   * Reload the SAME component for a new sample WITHOUT dropping app-mode. A plain
   * `loadComponent(path, sample)` rebuilds the preview in component-mode (no `isAppEntry`) while
   * the iframe still carries `app=1` — the generated preview then waits for an app entry that no
   * longer exists and sticks on "Loading app…". This forwards the live app-mode flag so the
   * rebuild keeps the entry root, staying consistent with the iframe's `app=1`. Returns
   * `loadComponent`'s success flag.
   */
  reloadPreservingAppMode: (componentPath: string, sampleName?: string) => Promise<boolean>;
  /** Active navigation strategy — surfaced so IframeCanvas can thread `nav=`/`route=` into the src. */
  navStrategy: NavStrategy;
}

/**
 * Post a route-navigation message into the same-origin preview iframe (history-bridge / basename
 * strategies). The in-iframe driver reads the active `?nav=` strategy and applies the route to the
 * app router without a full reload.
 */
function postNavigateRoute(route: string): void {
  const iframe = getPreviewIframe();
  // Same-origin proxy iframe → target the page origin rather than '*' (the navigate payload is
  // not a secret, but a precise origin avoids leaking it to a future cross-origin preview host).
  iframe?.contentWindow?.postMessage({ type: NAVIGATE_ROUTE_MESSAGE, route }, window.location.origin);
}

/**
 * Fetch app-routes for a component; best-effort, returns an empty payload on any failure.
 *
 * `withSuggestions` controls the server's two-phase cost. The per-selection candidacy check
 * (gating the toggle) leaves it false so the server only does the cheap single-file
 * `isAppEntryCandidate` check. Only when app-mode is actually enabled do we ask for
 * `suggestions=1`, which triggers the expensive whole-project route scan for the dropdown.
 */
async function fetchAppRoutes(componentPath: string | undefined, withSuggestions = false): Promise<AppRoutesResponse> {
  const empty: AppRoutesResponse = { candidates: [], suggestions: [], isCandidate: false };
  try {
    const params = new URLSearchParams();
    if (componentPath) params.set('component', componentPath);
    if (withSuggestions) params.set('suggestions', '1');
    const query = params.toString() ? `?${params.toString()}` : '';
    const response = await authFetch(`/api/app-routes${query}`);
    if (!response.ok) return empty;
    const data = (await response.json()) as Partial<AppRoutesResponse>;
    return {
      candidates: Array.isArray(data.candidates) ? data.candidates : [],
      suggestions: Array.isArray(data.suggestions) ? data.suggestions : [],
      isCandidate: data.isCandidate === true,
    };
  } catch (error) {
    console.error('[useAppPreviewMode] Failed to fetch app routes:', error);
    return empty;
  }
}

export function useAppPreviewMode({
  componentPath,
  loadComponent,
  currentSampleName,
  enabled = true,
  navStrategy = DEFAULT_NAV_STRATEGY,
}: UseAppPreviewModeParams): UseAppPreviewModeResult {
  const [appMode, setAppMode] = useState(false);
  const [suggestions, setSuggestions] = useState<RouteSuggestionItem[]>([]);
  const [currentRoute, setCurrentRoute] = useState('/');

  // Latest values read by the auto-enter effect without putting them in its dependency array —
  // `loadComponent` from the parent is not guaranteed stable, and depending on it (or a callback
  // closing over it) would re-run the effect on every parent re-render → an infinite reset loop.
  const componentPathRef = useRef(componentPath);
  const sampleNameRef = useRef(currentSampleName);
  const appModeRef = useRef(appMode);
  const loadComponentRef = useRef(loadComponent);
  const enabledRef = useRef(enabled);
  // True between issuing the auto `loadComponent(…, true)` and its resolution. `appMode` flips to
  // true only AFTER the rebuild resolves, so on a disable that lands WHILE the rebuild is in flight
  // `appMode`/`wasAppMode` are still false — yet the server already ran `enableAppEntry`. This ref
  // lets the disable branch send a compensating component-mode rebuild in that window (final review
  // P2). Keyed per component path so a stale request for a switched-away component doesn't linger.
  const pendingAppModeRequestPathRef = useRef<string | null>(null);
  componentPathRef.current = componentPath;
  sampleNameRef.current = currentSampleName;
  appModeRef.current = appMode;
  loadComponentRef.current = loadComponent;
  enabledRef.current = enabled;

  // Selecting a component AUTO-engages app-mode when that component is a full app-entry
  // wrapper (owns a router/provider root) AND app-mode is `enabled` for this runtime/role
  // (not NodePod overrideSrc, not a readonly viewer) — no manual toggle (Alex's ask: "надо
  // чтобы само работало"). A non-candidate (or a disabled context) stays in component-mode.
  // Leaving / switching the component first tears down any active app-mode (hide the bar, drop
  // `app=1`, reset the route), then re-evaluates. Keyed ONLY on the path string so a same-path
  // re-render does not reset an active session and `loadComponent`/`enabled` instability cannot
  // retrigger the reset loop (both are read via refs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadComponent/enabled are read via refs on purpose (see above)
  useEffect(() => {
    const wasAppMode = appModeRef.current;
    // An app-mode rebuild is "in flight" for THIS path if we issued one and it hasn't resolved.
    const hadPendingRequest = pendingAppModeRequestPathRef.current === componentPath;
    setAppMode(false);
    setSuggestions([]);
    setCurrentRoute('/');
    // Disabled while app-mode was ON — OR while its rebuild was still in flight (e.g. role → viewer
    // mid-activation): hiding the bar is not enough — the server already ran / is running
    // `enableAppEntry` for this path, so the iframe would reload without `app=1` against a raw
    // router/provider shell and render blank. Send a compensating component-mode rebuild so the
    // server drops the app entry and the iframe matches (final review P2; the in-flight case is the
    // deeper edge the first pass missed). Clear the pending marker so the stale `true` rebuild
    // resolving later can't re-raise the bar (it is already guarded by the disabled re-render).
    if (componentPath && !enabledRef.current && (wasAppMode || hadPendingRequest)) {
      pendingAppModeRequestPathRef.current = null;
      void loadComponentRef.current(componentPath, sampleNameRef.current ?? undefined, false).catch(() => {});
    }
    if (!componentPath || !enabledRef.current) return;
    let cancelled = false;
    void fetchAppRoutes(componentPath).then((data) => {
      // Re-check path + enabled: the candidacy fetch is async, so a newer selection or a runtime
      // /role change (NodePod, readonly) may have landed.
      if (cancelled || !enabledRef.current || componentPathRef.current !== componentPath || !data.isCandidate) return;
      // Enter app-mode: rebuild the preview with the app entry (`app=1`) FIRST, and only flip
      // `appMode` when the rebuild actually SUCCEEDED — loadComponent resolves `false` on a
      // handled failure, so we must not raise the bar over a preview that never rebuilt.
      pendingAppModeRequestPathRef.current = componentPath;
      void loadComponentRef
        .current(componentPath, sampleNameRef.current ?? undefined, true)
        .then(async (ok) => {
          if (pendingAppModeRequestPathRef.current === componentPath) pendingAppModeRequestPathRef.current = null;
          // Disabled / switched / cancelled while in flight, or a handled failure → do not raise
          // the bar. The disable branch above already issued the compensating component-mode rebuild.
          if (cancelled || !ok || !enabledRef.current || componentPathRef.current !== componentPath) return;
          setAppMode(true);
          // App-mode is now ON — fetch the dropdown suggestions (the expensive whole-project scan).
          const fetched = await fetchAppRoutes(componentPath, true);
          if (!cancelled && componentPathRef.current === componentPath) setSuggestions(fetched.suggestions);
        })
        .catch(() => {
          if (pendingAppModeRequestPathRef.current === componentPath) pendingAppModeRequestPathRef.current = null;
          // Unexpected throw — leave app-mode off.
        });
    });
    return () => {
      cancelled = true;
    };
    // `enabled` IS a dependency: flipping it false mid-session (e.g. role → viewer) must re-run
    // the effect to tear down an active app-mode (the early-return then keeps the bar hidden);
    // flipping it true re-evaluates candidacy. componentPath/loadComponent/sample are read via refs.
  }, [componentPath, enabled]);

  // Keep the address bar in sync when the user navigates INSIDE the preview (clicks an app <Link>,
  // browser back/forward) — the generated bridge posts `hypercanvas:appRouteChanged` with the
  // UNPREFIXED route. Only trust the same-origin preview iframe as the sender.
  useEffect(() => {
    function onAppRouteChanged(e: MessageEvent) {
      if (e.data?.type !== 'hypercanvas:appRouteChanged') return;
      const iframe = getPreviewIframe();
      if (!iframe || e.source !== iframe.contentWindow) return; // only the preview iframe may drive it
      const route = typeof e.data.route === 'string' ? e.data.route : null;
      if (route?.startsWith('/')) setCurrentRoute(route);
    }
    window.addEventListener('message', onAppRouteChanged);
    return () => window.removeEventListener('message', onAppRouteChanged);
  }, []);

  // Keep the strategy on a ref so onNavigate stays a stable callback yet always reads the live one.
  const navStrategyRef = useRef(navStrategy);
  navStrategyRef.current = navStrategy;

  const onNavigate = useCallback((path: string) => {
    const route = path.startsWith('/') ? path : `/${path}`;
    // history-bridge / basename post a message and the in-iframe driver applies it without a reload.
    // src-swap navigates by RELOADING the iframe at the proxied route — driven by the DECLARATIVE
    // `src` in IframeCanvas (it carries `route=<currentRoute>` only for src-swap). We just update
    // currentRoute here and let the re-render reassign `iframe.src` ONCE. (An imperative
    // `iframe.src =` set in addition would double-reload: React would reassign the declarative src
    // right after — finding fix.)
    if (navStrategyRef.current !== 'src-swap') postNavigateRoute(route);
    setCurrentRoute(route);
  }, []);

  // Sample-switch reload that honors the LIVE app-mode flag (read off the ref, so this callback
  // is stable and never re-creates on an appMode flip). When app-mode is on, the rebuild keeps the
  // entry root (`app=1`), so the preview never strands on "Loading app…" after a sample change.
  // A PENDING auto-activation for the same path counts as app-mode too: `appMode` only flips true
  // AFTER the rebuild resolves, so a sample switch landing mid-activation would otherwise rebuild in
  // component-mode while the `app=1` rebuild is still in flight and strand the iframe (final review).
  const reloadPreservingAppMode = useCallback(
    (componentPath: string, sampleName?: string): Promise<boolean> => {
      const appModeActive = appModeRef.current || pendingAppModeRequestPathRef.current === componentPath;
      return loadComponent(componentPath, sampleName, appModeActive);
    },
    [loadComponent],
  );

  return {
    appMode,
    suggestions,
    currentRoute,
    onNavigate,
    reloadPreservingAppMode,
    navStrategy,
  };
}
