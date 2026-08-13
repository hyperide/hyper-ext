/**
 * @file App-preview ("preview as app") mode state for the SaaS canvas.
 *
 * Accessed via: rendered by client/pages/Editor/CanvasEditor.tsx. App-mode is a render-failure
 *   FALLBACK, NOT proactive: it engages automatically ONLY when the component-mode render does not
 *   work — when the generated preview posts `hypercanvas:componentMissing` / `componentError` from
 *   the same-origin iframe. (The earlier upfront engage on app-entry CANDIDACY was rejected: a
 *   router-owning root can still render usable UI as a plain component, so router SHAPE ≠ render
 *   FAILURE.) On such a failure signal it candidacy-gates the file (`/api/app-routes`), and only for
 *   an app-entry root re-parses with `app=1` (server marks it an app entry + rebuilds), fetches
 *   code-derived route suggestions for the shared `<AddressBar>`, and drives the previewed app's OWN
 *   router by posting `hypercanvas:navigateRoute` into the preview iframe. Once-per-path so a
 *   re-fired signal (or a wrapped render that ALSO fails) can't loop — the real error then surfaces.
 * Assumptions: the preview iframe is served same-origin via the proxy path
 *   `/project-preview/<id>/…`, so navigate messages target `window.location.origin` (not '*') and
 *   the failure-signal listener trusts only `iframe.contentWindow` as the sender. App-mode
 *   auto-disables whenever the selected component changes — the bar hides and the src stops carrying
 *   `app=1`. Suggestions are best-effort; an empty list renders no dropdown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_NAV_STRATEGY, type NavStrategy, type RouteSuggestionItem } from '@shared/components/preview-chrome';
import { shouldRetryWithAppWrapper } from '@shared/components/preview-chrome/app-mode-fallback';
import { getPreviewIframe } from '@/lib/dom-utils';
import { authFetch } from '@/utils/authFetch';

/** The message the generated preview listens for to navigate its own router (pushState + popstate). */
const NAVIGATE_ROUTE_MESSAGE = 'hypercanvas:navigateRoute';

/** Runtime failure signals the generated preview posts to `window.parent` when a component-mode
 *  render does NOT work — the triggers for the app-mode FALLBACK. `componentMissing` = nothing
 *  renderable; `componentError` = a runtime/render crash. */
const COMPONENT_MISSING_MESSAGE = 'hypercanvas:componentMissing';
const COMPONENT_ERROR_MESSAGE = 'hypercanvas:componentError';

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
   * Gate for the AUTO app-mode fallback (default `true`). Pass `false` where app-mode must never
   * engage even after a render failure on an app-entry candidate: the NodePod runtime drives the
   * iframe via `overrideSrc` (bypassing the `app=1` URL the generated preview reads, so the bar
   * would show over a preview that never entered app-mode), and readonly viewers' `parse-component`
   * skips the app-entry rebuild (so a `loadComponent` success would flip the bar on without a real
   * app build). When `false`, a render-failure signal is ignored — no candidacy check, no engage.
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
  // Once-per-path latch for the render-failure fallback (mirrors the extension's
  // appModeRetryAttempts): the set of component paths we've already retried AS A FULL APP after a
  // component-mode render failure. Stops a re-fired failure signal from re-engaging (or flip-flopping
  // when the WRAPPED render itself fails) — the real error then surfaces. Cleared per path on switch.
  // It is latched ONLY once we COMMIT to a wrapper retry (after the candidacy fetch returns a true
  // verdict) — NOT on "attempt started" — so a transient candidacy-fetch failure doesn't stick the
  // path forever (codex P2-C).
  const triedAppWrapperPathsRef = useRef<Set<string>>(new Set());
  // Short-lived in-flight marker for the candidacy fetch (the gap between a failure signal and its
  // `/api/app-routes` verdict). Prevents a rapid second failure signal from launching a concurrent
  // candidacy check for the same path, WITHOUT permanently latching it — cleared when the fetch
  // settles, so a transient candidacy miss lets a later failure signal retry (codex P2-C).
  const candidacyInFlightPathsRef = useRef<Set<string>>(new Set());
  // Per-occupancy generation token. Bumped on every selection-reset effect run (the same place the
  // latch clears). Captured when a rebuild is issued; re-checked before raising the bar so an
  // in-flight rebuild from a PREVIOUS occupancy of the same path string (A→B→A before A's rebuild
  // resolves) can't flip app-mode on for the fresh A selection that never failed (codex P1-B).
  const selectionTokenRef = useRef(0);
  componentPathRef.current = componentPath;
  sampleNameRef.current = currentSampleName;
  appModeRef.current = appMode;
  loadComponentRef.current = loadComponent;
  enabledRef.current = enabled;

  // Issue the `app=1` rebuild and raise the bar only when it SUCCEEDS, the selection is still `path`,
  // AND the occupancy token captured at issue time still matches (so a stale rebuild from a previous
  // A→B→A occupancy can't flip the fresh selection — codex P1-B). Split out of engageAppModeOnFailure
  // to keep both functions small.
  const issueAppModeRebuild = useCallback((path: string): void => {
    const issuedToken = selectionTokenRef.current;
    pendingAppModeRequestPathRef.current = path;
    void loadComponentRef
      .current(path, sampleNameRef.current ?? undefined, true)
      .then(async (ok) => {
        if (pendingAppModeRequestPathRef.current === path) pendingAppModeRequestPathRef.current = null;
        // Stale-occupancy guard: the same path string may now be a FRESH selection (it was switched
        // away and back while this rebuild was in flight); its token differs → ignore this result.
        if (!ok || !enabledRef.current || componentPathRef.current !== path) return;
        if (selectionTokenRef.current !== issuedToken) return;
        setAppMode(true);
        // App-mode is now ON — fetch the dropdown suggestions (the expensive whole-project scan).
        const fetched = await fetchAppRoutes(path, true);
        if (componentPathRef.current === path && selectionTokenRef.current === issuedToken) {
          setSuggestions(fetched.suggestions);
        }
      })
      .catch(() => {
        if (pendingAppModeRequestPathRef.current === path) pendingAppModeRequestPathRef.current = null;
        // Unexpected throw — leave app-mode off.
      });
  }, []);

  // Engage app-mode as a render-failure FALLBACK (NOT proactively): called only when the preview
  // iframe reports a component-mode render failure (`componentMissing` / `componentError`) FOR the
  // current selection (the listener path-binds the signal). Mirrors the extension host — app-mode is
  // no longer engaged upfront on candidacy (router SHAPE ≠ render FAILURE). Candidacy-GATED: only an
  // app-entry root (own router/provider) is rendered raw. Once-per-path latch (committed only AFTER
  // a real wrapper retry) so a re-fired signal / a wrapped render that also fails can't loop, while a
  // transient candidacy miss does not stick the path. All in-flight / stale / disabled guards stay.
  const engageAppModeOnFailure = useCallback(
    (path: string): void => {
      // Read live guards off refs (no per-effect `cancelled` flag — staleness is the ref comparison).
      if (!enabledRef.current || appModeRef.current) return; // disabled context, or already in app-mode
      if (componentPathRef.current !== path) return; // a newer selection already landed
      if (triedAppWrapperPathsRef.current.has(path)) return; // once-only per selection (after a real retry)
      if (candidacyInFlightPathsRef.current.has(path)) return; // a candidacy check is already running
      // Capture the occupancy token at SIGNAL time: the candidacy fetch is async, so an A→B→A churn
      // can resolve a STALE A result for a fresh A occupancy. Re-checked before latching below so the
      // stale result can't poison the fresh occupancy's once-only latch (codex P1 — stale candidacy).
      const issuedToken = selectionTokenRef.current;
      // Mark the candidacy check in flight (NOT the once-only latch): a rapid second failure can't
      // double-fire, but a transient candidacy miss won't stick the path forever (codex P2-C).
      candidacyInFlightPathsRef.current.add(path);
      void fetchAppRoutes(path)
        .then((data) => {
          candidacyInFlightPathsRef.current.delete(path);
          // The candidacy fetch is async — re-check the gate (a newer selection / a role flip / a
          // prior real retry / an A→B→A occupancy churn may have landed). Only an app-entry candidate
          // is retried as a full app, and only when the captured occupancy token still matches.
          const retry = shouldRetryWithAppWrapper({
            outcome: 'missing', // SaaS treats both failure signals the same (no client-side HYP-487 path)
            isAppEntryCandidate: data.isCandidate,
            isProviderContextError: false,
            alreadyTriedWrapper: triedAppWrapperPathsRef.current.has(path),
          });
          if (
            !retry ||
            !enabledRef.current ||
            appModeRef.current ||
            componentPathRef.current !== path ||
            selectionTokenRef.current !== issuedToken
          )
            return;
          // COMMIT to the wrapper retry now — latch once-only (a transient miss above never reached
          // here, so the path was not stuck) and issue the `app=1` rebuild; raise the bar on success.
          triedAppWrapperPathsRef.current.add(path);
          issueAppModeRebuild(path);
        })
        .catch(() => {
          candidacyInFlightPathsRef.current.delete(path);
          // A transient candidacy fetch error: clear the in-flight marker so a later failure can retry.
        });
    },
    [issueAppModeRebuild],
  );

  // Switching / leaving the component tears down any active app-mode (hide the bar, drop `app=1`,
  // reset the route) and clears the per-path fallback latch so the new selection can retry. There is
  // NO upfront engage here anymore — a component that renders fine as a plain component STAYS in
  // component-mode; app-mode engages only via engageAppModeOnFailure on a render-failure signal.
  // Keyed ONLY on the path string so a same-path re-render does not reset an active session and
  // `loadComponent`/`enabled` instability cannot retrigger the reset loop (both are read via refs).
  // biome-ignore lint/correctness/useExhaustiveDependencies: loadComponent/enabled are read via refs on purpose (see above)
  useEffect(() => {
    const wasAppMode = appModeRef.current;
    // An app-mode rebuild is "in flight" for THIS path if we issued one and it hasn't resolved.
    const hadPendingRequest = pendingAppModeRequestPathRef.current === componentPath;
    setAppMode(false);
    setSuggestions([]);
    setCurrentRoute('/');
    // Reset the fallback latch for this path so a fresh render attempt (after a switch away and back)
    // can retry the wrapper. Clearing the whole set is simplest and safe — only the current path's
    // latch is ever consulted, and any other path's stale latch is irrelevant after a switch.
    triedAppWrapperPathsRef.current.clear();
    candidacyInFlightPathsRef.current.clear();
    // Bump the per-occupancy token so any in-flight rebuild issued under the PREVIOUS occupancy is
    // invalidated — even when the path string repeats (A→B→A before A's first rebuild resolves), the
    // stale rebuild's captured token no longer matches and it won't raise the bar (codex P1-B).
    selectionTokenRef.current += 1;
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
    // `enabled` IS a dependency: flipping it false mid-session (e.g. role → viewer) re-runs this
    // teardown (the compensating rebuild above drops a stale app entry). componentPath/loadComponent/
    // sample are read via refs.
  }, [componentPath, enabled]);

  // Render-failure fallback trigger: the generated preview posts `componentMissing` /
  // `componentError` to `window.parent` (same-origin iframe) when a component-mode render does NOT
  // work. Engage app-mode then — candidacy-gated, once per path. Only trust the preview iframe as
  // the sender (same guard as the appRouteChanged listener below).
  // biome-ignore lint/correctness/useExhaustiveDependencies: engageAppModeOnFailure is stable (empty-dep useCallback)
  useEffect(() => {
    function onRenderFailure(e: MessageEvent) {
      const type = e.data?.type;
      if (type !== COMPONENT_MISSING_MESSAGE && type !== COMPONENT_ERROR_MESSAGE) return;
      const iframe = getPreviewIframe();
      if (!iframe || e.source !== iframe.contentWindow) return; // only the preview iframe may drive it
      const path = componentPathRef.current;
      if (!path) return;
      // Bind the SIGNAL to the current selection: the runtime includes its `?component=` value
      // (== meta.relativeFilePath, the same identity as componentPathRef) in both payloads. A late
      // failure from the OLD iframe during an A→B switch can still pass the sender guard above —
      // ignore it unless its reported path is the one currently shown, so we never engage app-mode
      // for B on A's stale crash (codex P1-A).
      const reported = e.data?.componentPath;
      if (typeof reported === 'string' && reported !== path) return;
      engageAppModeOnFailure(path);
    }
    window.addEventListener('message', onRenderFailure);
    return () => window.removeEventListener('message', onRenderFailure);
  }, [engageAppModeOnFailure]);

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
  // KNOWN LIMITATION (deferred): `pendingAppModeRequestPathRef` is keyed by path only, not the
  // occupancy token, so in an A-fail → pending → A→B→A churn a sample switch on the FRESH A occupancy
  // could rebuild with `app=1` even though that occupancy never failed. Narrow (pending rebuild +
  // cross-occupancy + a sample switch in the exact window); a tighter fix tokenizes the pending ref.
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
