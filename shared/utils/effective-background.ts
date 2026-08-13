/**
 * @file Effective (painted) background-color resolution by ancestor walk.
 *
 * Why: an element with a transparent/unset background paints none of its own color —
 * the color a user actually sees behind its text is whatever opaque ancestor (or the
 * page canvas) sits below it. The a11y/contrast checker must judge text against THAT
 * painted color, not the element's literal `transparent`. Reading only the element's
 * own `background-color` returns `rgba(0, 0, 0, 0)`, which (parsed as a contrast pair)
 * produces a 1:1 ratio and a false "Bad" verdict — and no fix is ever possible.
 *
 * Accessed via: the VS Code preview iframe (extractComputedStyle, capture time) and the
 * SaaS/browser inspector read path. Both have live DOM access; the inspector webview
 * does not, which is why the walk runs at capture time and the result ships in the
 * runtime-style snapshot.
 *
 * Known limitations: ignores ancestor background-images/gradients (their painted color
 * is not statically resolvable) and ancestor `opacity`. The common solid-color /
 * transparent cascade — which is the actual bug — is handled.
 */
import { flattenBackgroundLayers, parseCssColor } from './color';

/**
 * An element background is treated as opaque (it "paints" the surface behind text) once its
 * own `background-color` alpha reaches this. Matches the readability-aid own-background gate
 * (HYP-1002) so a `<Badge>` with a solid fill is recognised as its own backing.
 */
const OPAQUE_ALPHA_THRESHOLD = 0.9;

/** Collect `background-color` values from `el` up through its ancestors, top-first. */
export function collectBackgroundLayers(el: Element): string[] {
  const view = el.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  if (!view) return [];
  const layers: string[] = [];
  let node: Element | null = el;
  while (node) {
    const bg = view.getComputedStyle(node).backgroundColor;
    if (bg) layers.push(bg);
    node = node.parentElement;
  }
  return layers;
}

/** The effective (painted) background behind an element and what layer bottomed the stack. */
export interface EffectiveBackground {
  /** Opaque `#rrggbb` the element's text is painted over. */
  hex: string;
  /**
   * The nearest element (the element itself or an ancestor) whose own background opaquely
   * paints behind the text, or `null` when no opaque backing exists and the **canvas surface**
   * (page/preview background) is what shows through.
   *
   * `paintedBy === null` is the load-bearing signal for the readability aid (HYP-1002): only
   * such "surface-backed" text is affected by a canvas-surface flip. Text on its own opaque
   * backing (a badge, a card) has `paintedBy !== null` and is excluded from the decision, so a
   * surface flip can never be blamed for "breaking" it.
   */
  paintedBy: Element | null;
}

/**
 * Resolve the effective painted background behind `el`, reporting BOTH the opaque `#rrggbb`
 * and which layer bottomed the stack.
 *
 * Walks `el` → ancestors compositing `background-color`. Stops at the first element whose own
 * background opaquely paints (alpha ≥ {@link OPAQUE_ALPHA_THRESHOLD}, or any non-`none`
 * `background-image` — a gradient/image we can't statically colour but which still backs the
 * text). That element becomes `paintedBy`. If the whole chain is transparent, `paintedBy` is
 * `null` and the stack composites over `base` (an opaque stand-in for the canvas surface).
 */
export function computeEffectiveBackgroundLayers(el: Element, base = '#ffffff'): EffectiveBackground {
  const view = el.ownerDocument?.defaultView ?? (typeof window !== 'undefined' ? window : null);
  if (!view) return { hex: flattenBackgroundLayers([], base), paintedBy: null };

  // Collect the FULL ancestor stack (never stop early) so `hex` composites identically to the
  // legacy `computeEffectiveBackgroundColor` — a 90%-opaque layer still lets the layers below it
  // bleed through, so cutting the walk short would return a wrong colour to the inspector.
  const layers: string[] = [];
  let paintedBy: Element | null = null;
  let node: Element | null = el;
  while (node) {
    const cs = view.getComputedStyle(node);
    const bg = cs.backgroundColor;
    if (bg) layers.push(bg);
    // Record the FIRST (nearest) element that opaquely backs the text, but keep walking so the
    // colour stack stays complete. Only the nearest opaque backing matters for the flip decision.
    if (paintedBy === null) {
      const parsed = parseCssColor(bg);
      const bgImage = cs.backgroundImage;
      const hasImage = typeof bgImage === 'string' && bgImage !== '' && bgImage !== 'none';
      if ((parsed && parsed.a >= OPAQUE_ALPHA_THRESHOLD) || hasImage) {
        paintedBy = node;
      }
    }
    node = node.parentElement;
  }

  return { hex: flattenBackgroundLayers(layers, base), paintedBy };
}

/**
 * Resolve the effective painted background behind `el` as an opaque `#rrggbb`.
 *
 * Composites the element's own background over each ancestor down to the page canvas
 * (white fallback). Use this — not the element's own background — as the contrast pair
 * for the element's text color.
 */
export function computeEffectiveBackgroundColor(el: Element): string {
  return computeEffectiveBackgroundLayers(el).hex;
}
