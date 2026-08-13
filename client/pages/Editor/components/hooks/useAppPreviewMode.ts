/**
 * @file App-preview ("preview as app") mode state for the SaaS canvas.
 *
 * Accessed via: the floating "preview as app" toggle near the canvas Toolbar
 *   (client/pages/Editor/CanvasEditor.tsx). When enabled it re-parses the current
 *   component with `app=1` (server marks it an app entry + rebuilds the preview), fetches
 *   code-derived route suggestions for the shared `<AddressBar>`, and drives the previewed
 *   app's OWN router by posting `hypercanvas:navigateRoute` into the preview iframe.
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
  /** Whether the current component is a valid "preview as app" target (gates the toggle). */
  canPreviewAsApp: boolean;
  /** Code-derived route suggestions for the address-bar dropdown (empty ⇒ no dropdown). */
  suggestions: RouteSuggestionItem[];
  /** The in-app address currently shown in the preview (resting value for the address bar). */
  currentRoute: string;
  /** Toggle app-mode on/off for the current component. No-op when not a candidate. */
  toggleAppMode: () => void;
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
  navStrategy = DEFAULT_NAV_STRATEGY,
}: UseAppPreviewModeParams): UseAppPreviewModeResult {
  const [appMode, setAppMode] = useState(false);
  const [canPreviewAsApp, setCanPreviewAsApp] = useState(false);
  const [suggestions, setSuggestions] = useState<RouteSuggestionItem[]>([]);
  const [currentRoute, setCurrentRoute] = useState('/');

  // Latest values for the toggle without re-creating it on every keystroke/re-render.
  const componentPathRef = useRef(componentPath);
  const sampleNameRef = useRef(currentSampleName);
  const appModeRef = useRef(appMode);
  const canPreviewRef = useRef(canPreviewAsApp);
  componentPathRef.current = componentPath;
  sampleNameRef.current = currentSampleName;
  appModeRef.current = appMode;
  canPreviewRef.current = canPreviewAsApp;

  // Leaving the component (or selecting another) tears down app-mode: hide the bar, drop `app=1`,
  // and re-evaluate whether the new component can be previewed as an app (gates the toggle).
  // Keyed on the path string so a same-path re-render does not reset an active session.
  useEffect(() => {
    setAppMode(false);
    setSuggestions([]);
    setCurrentRoute('/');
    setCanPreviewAsApp(false);
    if (!componentPath) return;
    let cancelled = false;
    void fetchAppRoutes(componentPath).then((data) => {
      if (!cancelled) setCanPreviewAsApp(data.isCandidate);
    });
    return () => {
      cancelled = true;
    };
  }, [componentPath]);

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

  const toggleAppMode = useCallback(() => {
    const path = componentPathRef.current;
    if (!path) return;
    // Gate: only a real app entry (router/provider root) can enter app-mode raw.
    if (!appModeRef.current && !canPreviewRef.current) return;
    const next = !appModeRef.current;
    setSuggestions([]);
    setCurrentRoute('/');
    // Rebuild the preview for the new mode FIRST (server enable/disableAppEntry regenerates the
    // preview with/without the app entry), and only flip `appMode` when the rebuild actually
    // SUCCEEDED — `loadComponent` resolves `false` (it swallows API/fetch failures), so a `.catch`
    // alone would miss them and leave the address bar + `app=1` on a preview that never rebuilt.
    void loadComponent(path, sampleNameRef.current ?? undefined, next)
      .then(async (ok) => {
        if (!ok) return; // rebuild failed — stay in the previous mode, no half-state
        // Stale-guard: the user may have selected another component while the rebuild was in
        // flight. Apply the result only if THIS path is still the active one — otherwise we'd
        // turn on app-mode (and show old suggestions) for a component that's no longer shown.
        if (componentPathRef.current !== path) return;
        setAppMode(next);
        if (!next) return;
        // App-mode is now ON — fetch the dropdown suggestions (the expensive whole-project scan).
        const fetched = await fetchAppRoutes(path, true);
        if (componentPathRef.current === path) setSuggestions(fetched.suggestions);
      })
      .catch(() => {
        // Unexpected throw — leave app-mode as it was.
      });
  }, [loadComponent]);

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
  const reloadPreservingAppMode = useCallback(
    (componentPath: string, sampleName?: string): Promise<boolean> => {
      return loadComponent(componentPath, sampleName, appModeRef.current);
    },
    [loadComponent],
  );

  return {
    appMode,
    canPreviewAsApp,
    suggestions,
    currentRoute,
    toggleAppMode,
    onNavigate,
    reloadPreservingAppMode,
    navStrategy,
  };
}
