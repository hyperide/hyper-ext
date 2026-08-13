/**
 * useReadableSurface — readability-aid canvas-surface flip for the SaaS preview (HYP-1002).
 *
 * A component that declares no background of its own but paints low-contrast text relies on an
 * app-level surface the preview does not supply, so its text is near-invisible on the canvas.
 * This hook reads the live (same-origin) preview iframe DOM, asks the shared, DOM-free
 * {@link pickReadableSurface} decision whether to flip the canvas surface, and — when it should —
 * paints a `--hc-canvas-surface` CSS variable on the canvas wrapper (behind the transparent
 * iframe). It NEVER mutates component source and never touches the style-write path.
 *
 * The flip is purely a canvas-layer paint. The inspector's effective-background base is read
 * INSIDE the iframe (which never sees this host-side wrapper var), so the inspector keeps
 * reporting the real app surface — the flip cannot make it lie.
 *
 * Shared decision + collection are consumed identically by the VS Code extension; only the paint
 * differs. Do not fork the decision here.
 */
import { computeEffectiveBackgroundColor } from '@shared/utils/effective-background';
import { pickReadableSurface, readabilitySignature, type SurfaceCandidate } from '@shared/utils/readable-surface';
import { collectReadabilitySamples } from '@shared/utils/readability-samples';
import { useCallback, useEffect, useRef, useState } from 'react';

/** SaaS candidate surfaces — Tailwind `white` / `slate-950`, matching the app tokens. */
const SURFACE_CANDIDATES: SurfaceCandidate[] = [
  { id: 'light', hex: '#ffffff' },
  { id: 'dark', hex: '#020617' },
];

const HEX_BY_ID: Record<string, string> = Object.fromEntries(SURFACE_CANDIDATES.map((c) => [c.id, c.hex]));

/** Trailing debounce after an HMR/reload before re-evaluating (the DOM repaints async). */
const REEVAL_DEBOUNCE_MS = 150;

interface ReadableSurfaceState {
  /** The applied surface id ('light' | 'dark'), or null when the real canvas surface is used. */
  surfaceId: string | null;
  /** The measured minimum text contrast before the flip (for the dismissible badge). */
  minContrastBefore: number;
}

export interface ReadableSurfaceResult extends ReadableSurfaceState {
  /** Dismiss the aid for the current component (session-scoped) and restore the real surface. */
  onDismiss: () => void;
}

interface UseReadableSurfaceParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** The canvas wrapper the surface variable is painted on (behind the transparent iframe). */
  wrapperRef: React.RefObject<HTMLElement | null>;
  previewReady: boolean;
  /** Current component path — a re-evaluation trigger (and reset-on-switch). NOTE: dismissals and
   *  the stale-flip reset are keyed by the sample-content signature, not by this path. */
  componentPath: string;
  /** Bumped on reload/HMR — retriggers evaluation. */
  iframeLoadedCounter?: number;
  /** When false the aid is inert (e.g. app-mode preview, or a user disabled it). */
  enabled?: boolean;
}

/**
 * Resolve the component root inside the preview iframe. The generated preview mounts into
 * `#root`; fall back to `body` for raw previews.
 */
function getIframeRoot(iframe: HTMLIFrameElement): Element | null {
  const doc = iframe.contentDocument;
  if (!doc || doc.location.href === 'about:blank') return null;
  return doc.getElementById('root') ?? doc.body ?? null;
}

export function useReadableSurface({
  iframeRef,
  wrapperRef,
  previewReady,
  componentPath,
  iframeLoadedCounter,
  enabled = true,
}: UseReadableSurfaceParams): ReadableSurfaceResult {
  const [state, setState] = useState<ReadableSurfaceState>({ surfaceId: null, minContrastBefore: 21 });
  // Dismissals are keyed by the sample-content signature so a dismissal follows its component.
  const dismissedRef = useRef<Set<string>>(new Set());
  // The surface id currently applied, tracked outside React state so evaluation reads it freshly.
  const appliedIdRef = useRef<string | null>(null);
  // Signature of the last evaluated sample set — a change means the previewed content changed.
  const lastSignatureRef = useRef<string | null>(null);

  const applySurface = useCallback(
    (surfaceId: string | null, minContrastBefore: number) => {
      const wrapper = wrapperRef.current;
      if (wrapper) {
        if (surfaceId) {
          wrapper.style.setProperty('--hc-canvas-surface', HEX_BY_ID[surfaceId]);
          wrapper.setAttribute('data-hc-surface', surfaceId);
        } else {
          wrapper.style.removeProperty('--hc-canvas-surface');
          wrapper.removeAttribute('data-hc-surface');
        }
      }
      appliedIdRef.current = surfaceId;
      setState({ surfaceId, minContrastBefore });
    },
    [wrapperRef],
  );

  const evaluate = useCallback(() => {
    const iframe = iframeRef.current;
    const wrapper = wrapperRef.current;
    if (!iframe || !wrapper || !enabled) {
      if (appliedIdRef.current) applySurface(null, 21);
      return;
    }

    // The iframe is normally same-origin (project-preview), but an arbitrary/NodePod override may
    // be cross-origin — reading its DOM throws. Treat any access failure as "no samples" (safe
    // no-op) rather than letting it bubble.
    let samples: ReturnType<typeof collectReadabilitySamples>['samples'] = [];
    try {
      const root = getIframeRoot(iframe);
      // A cross-origin iframe returns null from contentDocument (no throw), so `!root` and the
      // catch below must BOTH clear any applied flip — otherwise a prior flip stays painted when
      // the preview navigates cross-origin / to about:blank.
      if (!root) {
        if (appliedIdRef.current) applySurface(null, 21);
        return;
      }
      samples = collectReadabilitySamples(root).samples;
    } catch {
      if (appliedIdRef.current) applySurface(null, 21);
      return;
    }

    // A content change (new component, or HMR that altered the text) drops any stale flip so the
    // decision is always made against the REAL surface, never the previous component's flip.
    const signature = readabilitySignature(samples);
    if (signature !== lastSignatureRef.current && appliedIdRef.current) applySurface(null, 21);
    lastSignatureRef.current = signature;

    if (samples.length === 0 || dismissedRef.current.has(signature)) {
      if (appliedIdRef.current) applySurface(null, 21);
      return;
    }

    // The real, un-flipped canvas surface = the first opaque background behind the wrapper in the
    // HOST document. Measure the PARENT, never the wrapper itself (the wrapper carries the flip we
    // just applied — measuring it would read the flipped colour back as the "real" surface).
    const appliedId = appliedIdRef.current;
    const realSurfaceHex = wrapper.parentElement ? computeEffectiveBackgroundColor(wrapper.parentElement) : '#ffffff';
    const original: SurfaceCandidate = { id: 'default', hex: realSurfaceHex };
    const current: SurfaceCandidate = appliedId ? { id: appliedId, hex: HEX_BY_ID[appliedId] } : original;

    const decision = pickReadableSurface(samples, current, SURFACE_CANDIDATES, { original });
    if (decision.reason === 'switch') {
      applySurface(decision.surfaceId === 'default' ? null : decision.surfaceId, decision.minContrastBefore);
    }
  }, [iframeRef, wrapperRef, enabled, applySurface]);

  /** Dismiss the aid for the current component (session-scoped) and restore the real surface. */
  const dismiss = useCallback(() => {
    if (lastSignatureRef.current !== null) dismissedRef.current.add(lastSignatureRef.current);
    applySurface(null, 21);
  }, [applySurface]);

  // Evaluate after the preview is ready + fonts settled + one frame (so the DOM has painted), and
  // re-evaluate on a debounced MutationObserver over the iframe body (HMR / Fast Refresh — no
  // reload, so iframeLoadedCounter does not bump).
  useEffect(() => {
    if (!previewReady) return;
    let cancelled = false;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;

    const run = () => {
      if (cancelled) return;
      raf = requestAnimationFrame(() => {
        if (!cancelled) evaluate();
      });
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(run, REEVAL_DEBOUNCE_MS);
    };

    const kick = () => {
      let body: HTMLElement | null = null;
      try {
        const doc = iframeRef.current?.contentDocument;
        const fontsReady = doc?.fonts?.ready;
        if (fontsReady) fontsReady.then(schedule).catch(schedule);
        else schedule();
        body = doc?.body ?? null;
      } catch {
        schedule();
      }
      if (body && typeof MutationObserver !== 'undefined') {
        observer = new MutationObserver(schedule);
        // Only style/class attribute writes can change contrast — filtering keeps a spinner's
        // constant aria-*/data-* churn from re-arming the debounce every frame.
        observer.observe(body, {
          childList: true,
          subtree: true,
          characterData: true,
          attributes: true,
          attributeFilter: ['style', 'class'],
        });
      }
    };
    // Small initial delay so the preview has painted before the first read + observer attach.
    timer = setTimeout(kick, REEVAL_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      if (raf) cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
      observer?.disconnect();
    };
  }, [previewReady, iframeLoadedCounter, componentPath, evaluate, iframeRef]);

  // Reset the applied flip when switching components so a stale surface never carries over.
  useEffect(() => {
    return () => {
      if (appliedIdRef.current) applySurface(null, 21);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run only on component switch/unmount
  }, [componentPath]);

  return { ...state, onDismiss: dismiss };
}
