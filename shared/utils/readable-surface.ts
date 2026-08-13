/**
 * @file Readability-aid surface decision (HYP-1002) — pure, DOM-free, unit-tested.
 *
 * The Hyper Canvas preview paints a component over a static canvas surface. A component that
 * declares no background of its own but paints low-contrast text (dark-on-dark / light-on-light)
 * relies on an app-level surface the preview does not supply, so its text is near-invisible.
 *
 * This module answers ONE question with no AI and no DOM: given the text colours that actually
 * sit on the canvas surface (already filtered to `paintedBy === null` by the collector) and a
 * set of candidate surfaces, should the preview flip its surface, and to which candidate?
 *
 * It is a READABILITY AID, not a WCAG-4.5 guarantee: it flips only when text is *clearly* broken
 * (min contrast below `triggerBelow`) and a candidate lifts the worst text to at least
 * `targetMin` with a real improvement. Dark/light symmetry falls out of "maximise the minimum
 * contrast" — there is no separate light-vs-dark branch.
 *
 * Consumed identically by SaaS (`client/components/IframeCanvas` host) and the VS Code extension
 * webview; only the surface *paint* differs per platform. Every threshold lives here so it is
 * tunable in one place after seeing real components.
 */
import { compositeOver, contrastRatio, parseCssColor, rgbToHex } from './color';

export interface SurfaceCandidate {
  /** Stable id used to apply the surface on each platform (e.g. 'light' | 'dark'). */
  id: string;
  /** Opaque `#rrggbb` the candidate surface paints. */
  hex: string;
}

export interface TextSample {
  /** Straight (un-composited) `#rrggbb` computed text colour of one surface-backed text node. */
  hex: string;
  /**
   * Text opacity 0–1. When < 1 the text colour is composited over EACH candidate surface before
   * measuring contrast, so translucent text is judged against the surface it actually paints on
   * (50%-black text reads ~1:1 on a dark surface, not the ~5:1 a pre-composited grey would imply).
   * Omit (or 1) for fully-opaque text.
   */
  alpha?: number;
}

type SurfaceDecisionReason =
  | 'switch'
  | 'no-improvement'
  | 'no-samples'
  | 'already-readable'
  | 'held-by-hysteresis';

export interface SurfaceDecision {
  /**
   * The candidate id to apply, or `null` to leave the surface alone. `null` NEVER means
   * "revert" implicitly — a revert is expressed as `surfaceId === original.id` with a `switch`.
   */
  surfaceId: string | null;
  reason: SurfaceDecisionReason;
  /** Minimum contrast across samples on the currently-applied surface. */
  minContrastBefore: number;
  /** Minimum contrast across samples on the chosen/best surface. */
  minContrastAfter: number;
}

export interface PickSurfaceOptions {
  /** Flip only when the current surface's min contrast is below this (clearly broken). */
  triggerBelow?: number;
  /** A candidate must lift the worst text to at least this to be worth switching to. */
  targetMin?: number;
  /** A candidate must improve the min contrast by at least this factor over current. */
  minImprovement?: number;
  /**
   * The platform's real, un-flipped surface. When a readability flip is already applied
   * (`current.id !== original.id`), hysteresis keeps it and only reverts to `original` once the
   * original surface itself would be comfortably readable (min ≥ `revertAbove`) — this stops
   * oscillation near the trigger. Defaults to `current` (no flip active → no hysteresis).
   */
  original?: SurfaceCandidate;
  /** Revert an active flip back to `original` only when original's min contrast reaches this. */
  revertAbove?: number;
}

/**
 * A stable signature of a sample set, used to detect when the previewed content actually changed
 * (a new component — including the extension's postMessage in-place switch that keeps the same
 * iframe URL) versus a same-content re-report (HMR no-op). On a signature change the caller resets
 * any applied flip and re-evaluates against the real surface, so a stale flip or a per-content
 * dismissal never leaks across components. Order-independent + deduped.
 */
export function readabilitySignature(samples: TextSample[]): string {
  return [...new Set(samples.map((s) => `${s.hex}@${s.alpha ?? 1}`))].sort().join(',');
}

const DEFAULTS = {
  triggerBelow: 2.0,
  targetMin: 3.0,
  minImprovement: 1.5,
  revertAbove: 4.5,
} as const;

/** The colour a sample actually paints on `surfaceHex` — the text composited over the surface
 *  when translucent, else the text colour itself. */
function renderedTextHex(sample: TextSample, surfaceHex: string): string {
  const alpha = sample.alpha ?? 1;
  if (alpha >= 1) return sample.hex;
  const text = parseCssColor(sample.hex);
  const surface = parseCssColor(surfaceHex);
  if (!text || !surface) return sample.hex;
  const flat = compositeOver({ ...text, a: alpha }, { ...surface, a: 1 });
  return rgbToHex(flat.r, flat.g, flat.b);
}

/** Minimum WCAG contrast ratio of `samples` against one surface. 21 when there are no samples. */
function minContrast(samples: TextSample[], surfaceHex: string): number {
  let min = Number.POSITIVE_INFINITY;
  for (const s of samples) {
    const ratio = contrastRatio(renderedTextHex(s, surfaceHex), surfaceHex);
    if (ratio < min) min = ratio;
  }
  return Number.isFinite(min) ? min : 21;
}

/** The candidate with the highest min-contrast across samples (ties keep the earlier one). */
function bestCandidate(samples: TextSample[], candidates: SurfaceCandidate[]): { cand: SurfaceCandidate; min: number } {
  let best = candidates[0];
  let bestMin = minContrast(samples, best.hex);
  for (let i = 1; i < candidates.length; i++) {
    const m = minContrast(samples, candidates[i].hex);
    if (m > bestMin) {
      best = candidates[i];
      bestMin = m;
    }
  }
  return { cand: best, min: bestMin };
}

/**
 * Decide whether to flip the preview surface for readability, and to which candidate.
 *
 * @param samples    surface-backed text colours (already filtered to `paintedBy === null`).
 * @param current    the surface currently applied (a prior flip or the platform default).
 * @param candidates all selectable surfaces; MUST be non-empty and SHOULD include `current`/original.
 */
export function pickReadableSurface(
  samples: TextSample[],
  current: SurfaceCandidate,
  candidates: SurfaceCandidate[],
  opts: PickSurfaceOptions = {},
): SurfaceDecision {
  const triggerBelow = opts.triggerBelow ?? DEFAULTS.triggerBelow;
  const targetMin = opts.targetMin ?? DEFAULTS.targetMin;
  const minImprovement = opts.minImprovement ?? DEFAULTS.minImprovement;
  const revertAbove = opts.revertAbove ?? DEFAULTS.revertAbove;
  const original = opts.original ?? current;

  const minBefore = minContrast(samples, current.hex);

  if (samples.length === 0) {
    return { surfaceId: null, reason: 'no-samples', minContrastBefore: minBefore, minContrastAfter: minBefore };
  }
  if (candidates.length === 0) {
    return { surfaceId: null, reason: 'no-improvement', minContrastBefore: minBefore, minContrastAfter: minBefore };
  }

  const flipActive = current.id !== original.id;

  // Current surface is NOT clearly broken.
  if (minBefore >= triggerBelow) {
    if (flipActive) {
      // A readability flip is in effect. Revert to the real surface only once IT is comfortably
      // readable; otherwise hold the flip so we don't oscillate near the trigger.
      const minOriginal = minContrast(samples, original.hex);
      if (minOriginal >= revertAbove) {
        return { surfaceId: original.id, reason: 'switch', minContrastBefore: minBefore, minContrastAfter: minOriginal };
      }
      return { surfaceId: null, reason: 'held-by-hysteresis', minContrastBefore: minBefore, minContrastAfter: minBefore };
    }
    return { surfaceId: null, reason: 'already-readable', minContrastBefore: minBefore, minContrastAfter: minBefore };
  }

  // Current surface is clearly broken — try to improve.
  const { cand, min: minAfter } = bestCandidate(samples, candidates);
  const improves = minAfter >= targetMin && minAfter >= minBefore * minImprovement && cand.id !== current.id;
  if (improves) {
    return { surfaceId: cand.id, reason: 'switch', minContrastBefore: minBefore, minContrastAfter: minAfter };
  }
  return { surfaceId: null, reason: 'no-improvement', minContrastBefore: minBefore, minContrastAfter: minAfter };
}
