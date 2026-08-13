/**
 * useReadableSurface — readability-aid canvas-surface flip for the VS Code preview panel
 * (HYP-1002). Mirror of the SaaS `client/components/iframe-canvas-hooks/useReadableSurface`, using
 * the SAME shared decision (`pickReadableSurface`); only the paint differs per platform.
 *
 * The preview iframe (cross-origin) reports its surface-backed text colours via
 * `hypercanvas:readabilitySamples` (see `services/scripts/iframe-readability.ts`). This hook runs
 * the shared decision against the live VS Code editor background and, when a flip helps, sets a
 * `--hc-canvas-surface` variable on the webview body. The preview iframe's `background` reads that
 * variable (inherited down the DOM; see PreviewPanelApp `iframeStyle`), so the surface behind the
 * transparent-bodied component flips. It never mutates component source or the style-write path.
 */
import { pickReadableSurface, readabilitySignature, type SurfaceCandidate } from '@shared/utils/readable-surface';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReadabilitySamplesMessage } from '../services/scripts/iframe-readability';

/**
 * Candidate surfaces for the extension: a near-white and VS Code's default dark editor grey. The
 * decision picks whichever lifts the worst text; the CURRENT/original surface is the live,
 * runtime-resolved editor background (never hardcoded).
 */
const SURFACE_CANDIDATES: SurfaceCandidate[] = [
  { id: 'light', hex: '#ffffff' },
  { id: 'dark', hex: '#1e1e1e' },
];

const HEX_BY_ID: Record<string, string> = Object.fromEntries(SURFACE_CANDIDATES.map((c) => [c.id, c.hex]));

const FALLBACK_EDITOR_BG = '#1e1e1e';

interface ReadableSurfaceState {
  surfaceId: string | null;
  minContrastBefore: number;
}

export interface ReadableSurfaceResult extends ReadableSurfaceState {
  onDismiss: () => void;
}

/** The preview iframe runs arbitrary user app code, which could post this message itself — so the
 *  payload is fully validated (hex shape, alpha ∈ [0,1], bounded length), not just shape-checked. */
const HEX_RE = /^#[0-9a-fA-F]{3,8}$/;
const MAX_SAMPLES = 500;

function isValidSample(s: unknown): boolean {
  if (s == null || typeof s !== 'object') return false;
  const { hex, alpha } = s as { hex?: unknown; alpha?: unknown };
  if (typeof hex !== 'string' || !HEX_RE.test(hex)) return false;
  if (alpha !== undefined && (typeof alpha !== 'number' || !Number.isFinite(alpha) || alpha < 0 || alpha > 1)) {
    return false;
  }
  return true;
}

function isReadabilitySamplesMessage(data: unknown): data is ReadabilitySamplesMessage {
  if (!data || typeof data !== 'object') return false;
  const m = data as Record<string, unknown>;
  if (m.type !== 'hypercanvas:readabilitySamples') return false;
  if (typeof m.hasOwnBackground !== 'boolean') return false;
  if (!Array.isArray(m.samples) || m.samples.length > MAX_SAMPLES) return false;
  return m.samples.every(isValidSample);
}

/** Read the live VS Code editor background (theme-dependent) as an opaque hex. */
function liveEditorBackground(): string {
  if (typeof document === 'undefined') return FALLBACK_EDITOR_BG;
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--vscode-editor-background').trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(raw) ? raw : FALLBACK_EDITOR_BG;
}

interface UseReadableSurfaceParams {
  /** The live preview iframe element (message source check). */
  iframeEl: HTMLIFrameElement | null;
  /** When false the aid is inert (e.g. app-mode preview). */
  enabled?: boolean;
}

export function useReadableSurface({ iframeEl, enabled = true }: UseReadableSurfaceParams): ReadableSurfaceResult {
  const [state, setState] = useState<ReadableSurfaceState>({ surfaceId: null, minContrastBefore: 21 });
  // Dismissals are keyed by the sample-content signature, so a dismissal follows the component it
  // was made on even across the extension's postMessage in-place switches (which keep the same URL).
  const dismissedRef = useRef<Set<string>>(new Set());
  const appliedIdRef = useRef<string | null>(null);
  const lastSignatureRef = useRef<string | null>(null);

  const applySurface = useCallback((surfaceId: string | null, minContrastBefore: number) => {
    if (typeof document !== 'undefined') {
      if (surfaceId) {
        document.body.style.setProperty('--hc-canvas-surface', HEX_BY_ID[surfaceId]);
        document.body.setAttribute('data-hc-surface', surfaceId);
      } else {
        document.body.style.removeProperty('--hc-canvas-surface');
        document.body.removeAttribute('data-hc-surface');
      }
    }
    appliedIdRef.current = surfaceId;
    setState({ surfaceId, minContrastBefore });
  }, []);

  const decide = useCallback(
    (msg: ReadabilitySamplesMessage) => {
      const signature = readabilitySignature(msg.samples);
      // A content change (new component, or HMR that altered the text) drops any stale flip so the
      // decision is always made against the REAL surface, never the previous component's flip.
      if (signature !== lastSignatureRef.current && appliedIdRef.current) applySurface(null, 21);
      lastSignatureRef.current = signature;

      if (!enabled || msg.hasOwnBackground || msg.samples.length === 0 || dismissedRef.current.has(signature)) {
        if (appliedIdRef.current) applySurface(null, 21);
        return;
      }
      const appliedId = appliedIdRef.current;
      const original: SurfaceCandidate = { id: 'default', hex: liveEditorBackground() };
      const current: SurfaceCandidate = appliedId ? { id: appliedId, hex: HEX_BY_ID[appliedId] } : original;

      const decision = pickReadableSurface(msg.samples, current, SURFACE_CANDIDATES, { original });
      if (decision.reason === 'switch') {
        applySurface(decision.surfaceId === 'default' ? null : decision.surfaceId, decision.minContrastBefore);
      }
    },
    [enabled, applySurface],
  );

  const onDismiss = useCallback(() => {
    if (lastSignatureRef.current !== null) dismissedRef.current.add(lastSignatureRef.current);
    applySurface(null, 21);
  }, [applySurface]);

  // Listen for the iframe's readability report. Accept ONLY messages whose source is exactly the
  // preview iframe's contentWindow (matches the strict bridge contract), and only well-formed
  // payloads — an untrusted frame must never be able to drive the canvas surface.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const expected = iframeEl?.contentWindow ?? null;
      if (!expected || event.source !== expected) return;
      if (!isReadabilitySamplesMessage(event.data)) return;
      decide(event.data);
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [iframeEl, decide]);

  // Clear the surface when the aid is turned off (app-mode) and on unmount — the message-driven
  // `decide` path would otherwise never fire to remove a flip that is already applied.
  useEffect(() => {
    if (!enabled && appliedIdRef.current) applySurface(null, 21);
  }, [enabled, applySurface]);
  // Clear any applied flip on unmount AND whenever the iframe element itself is replaced or removed.
  // A dev-server retry/stop remounts the <iframe> via its `key`, so `iframeEl` transitions
  // element → null → new element. The message-driven `decide` path only runs once a NEW iframe
  // successfully posts samples, so without clearing here the previous component's flipped
  // `--hc-canvas-surface` would persist on document.body behind a loading/failed/replaced preview.
  useEffect(() => {
    return () => {
      if (appliedIdRef.current) applySurface(null, 21);
    };
  }, [iframeEl, applySurface]);

  return { ...state, onDismiss };
}
