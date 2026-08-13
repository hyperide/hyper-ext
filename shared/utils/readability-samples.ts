/**
 * @file DOM sample collection for the readability aid (HYP-1002).
 *
 * Runs in the preview realm (SaaS iframe host / VS Code injected iframe script — both have the
 * live DOM). Gathers the computed text colours that actually sit on the CANVAS SURFACE (no own
 * opaque backing) under a component root, so {@link pickReadableSurface} can decide whether to
 * flip the surface for legibility.
 *
 * The per-element decision logic (own-background gate, badge exclusion via `paintedBy`, hidden
 * skip, colour resolution) lives in pure helpers that are unit-tested against fake element
 * chains — the repo's shared tests run under `bun test` with no jsdom. The `TreeWalker` traversal
 * is a thin shell over those helpers.
 */
import { parseCssColor, rgbToHex } from './color';
import { computeEffectiveBackgroundLayers } from './effective-background';

/** A resolved surface-backed text colour, ready for the pure surface decision. */
export interface ReadabilitySample {
  /** Straight (un-composited) `#rrggbb` computed text colour. */
  hex: string;
  /** Text opacity 0–1 when < 1 (translucent text is composited per-candidate in the decision). */
  alpha?: number;
}

export interface ReadabilityCollection {
  /**
   * True when the component root paints its own opaque background (or a background-image). The
   * aid does nothing in that case — the component supplies its own surface.
   */
  hasOwnBackground: boolean;
  /** Surface-backed text samples (`paintedBy === null`). Empty when the root has its own bg. */
  samples: ReadabilitySample[];
}

/** An element background is opaque once its own `background-color` alpha reaches this. */
const OPAQUE_ALPHA_THRESHOLD = 0.9;
/** Hard cap on visited text nodes so a huge subtree can't stall the preview. */
const MAX_TEXT_NODES = 200;
/**
 * Below this text alpha the glyphs are effectively invisible, so they carry no readability signal.
 * They MUST be dropped, not sampled: an invisible node composites to ~the surface colour on every
 * candidate (contrast ≈ 1:1), which would pin the min-contrast decision at 1:1 and suppress a flip
 * that visible text actually needs (now that de-dup is alpha-aware and no longer folds them away).
 */
const MIN_VISIBLE_TEXT_ALPHA = 0.05;

function viewOf(el: Element): (Window & typeof globalThis) | null {
  return (el.ownerDocument?.defaultView as (Window & typeof globalThis) | null) ??
    (typeof window !== 'undefined' ? window : null);
}

/**
 * True when `root` paints its own opaque background (alpha ≥ threshold) or any background-image.
 * Such a component supplies its own surface — the aid must not touch it.
 */
export function hasOwnBackground(root: Element): boolean {
  const view = viewOf(root);
  if (!view) return false;
  const cs = view.getComputedStyle(root);
  const parsed = parseCssColor(cs.backgroundColor);
  const bgImage = cs.backgroundImage;
  const hasImage = typeof bgImage === 'string' && bgImage !== '' && bgImage !== 'none';
  return (parsed != null && parsed.a >= OPAQUE_ALPHA_THRESHOLD) || hasImage;
}

/** True when `el` OR any ancestor makes its text invisible (display/visibility/opacity). A text
 *  node inside a `display:none` / `opacity:0` container renders nothing, so walking ancestors —
 *  not just the text element — prevents hidden subtrees driving a false surface flip. */
function isHidden(el: Element, view: Window & typeof globalThis): boolean {
  let node: Element | null = el;
  while (node) {
    const cs = view.getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.visibility === 'collapse') return true;
    const opacity = Number.parseFloat(cs.opacity || '1');
    if (!Number.isNaN(opacity) && opacity === 0) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Resolve one text element to a surface-backed sample, or `null` when it must be excluded.
 *
 * Excluded when the element is hidden, when its text sits on its own opaque backing
 * (`paintedBy !== null` — the badge case), or when its computed colour can't be parsed.
 * Semi-transparent text is composited over its effective background before returning.
 */
export function classifySurfaceText(el: Element): ReadabilitySample | null {
  const view = viewOf(el);
  if (!view) return null;
  if (isHidden(el, view)) return null;

  // Badge exclusion: text with an opaque backing is not on the canvas surface, so a surface
  // flip can never affect it — it must not enter the decision set.
  if (computeEffectiveBackgroundLayers(el).paintedBy !== null) return null;

  const color = parseCssColor(view.getComputedStyle(el).color);
  if (!color) return null;
  // Effectively-invisible text carries no readability signal — drop it so it can't pin the
  // min-contrast decision at ~1:1 and suppress a flip that the visible text needs.
  if (color.a < MIN_VISIBLE_TEXT_ALPHA) return null;
  // Keep the straight colour + its alpha; the decision composites translucent text over each
  // candidate surface (compositing here over one fixed base would misjudge the other surface).
  const hex = rgbToHex(color.r, color.g, color.b);
  return color.a >= 1 ? { hex } : { hex, alpha: color.a };
}

/**
 * Collect surface-backed text samples under `root`.
 *
 * Returns immediately (no samples) when `root` has its own background. Otherwise walks text
 * nodes, skipping whitespace-only nodes and text with an opaque backing, capped at
 * {@link MAX_TEXT_NODES}. De-duplicates identical colour+alpha pairs so one dominant colour can't
 * swamp the min-contrast decision (translucent and opaque same-RGB text are kept as distinct
 * samples — they composite differently).
 */
export function collectReadabilitySamples(root: Element): ReadabilityCollection {
  if (hasOwnBackground(root)) return { hasOwnBackground: true, samples: [] };

  const doc = root.ownerDocument;
  const view = viewOf(root);
  if (!doc || !view || typeof doc.createTreeWalker !== 'function') {
    return { hasOwnBackground: false, samples: [] };
  }

  const seen = new Set<string>();
  const samples: ReadabilitySample[] = [];
  const walker = doc.createTreeWalker(root, /* NodeFilter.SHOW_TEXT */ 0x4);
  let visited = 0;
  for (let node = walker.nextNode(); node && visited < MAX_TEXT_NODES; node = walker.nextNode()) {
    visited++;
    const text = node.nodeValue;
    if (!text || !text.trim()) continue;
    const parent = node.parentElement;
    if (!parent) continue;
    const sample = classifySurfaceText(parent);
    if (!sample) continue;
    // De-dup by colour AND alpha: an opaque `#ffffff` and a translucent `rgba(255,255,255,a)`
    // share a straight hex but composite to different rendered colours, so keying on hex alone
    // would let whichever appears first suppress the other — and the dropped translucent variant
    // is usually the actually-unreadable one, so the aid could miss the broken text.
    const key = sample.alpha === undefined ? sample.hex : `${sample.hex}@${sample.alpha}`;
    if (!seen.has(key)) {
      seen.add(key);
      samples.push(sample);
    }
  }

  return { hasOwnBackground: false, samples };
}
