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
import { flattenBackgroundLayers } from './color';

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

/**
 * Resolve the effective painted background behind `el` as an opaque `#rrggbb`.
 *
 * Composites the element's own background over each ancestor down to the page canvas
 * (white fallback). Use this — not the element's own background — as the contrast pair
 * for the element's text color.
 */
export function computeEffectiveBackgroundColor(el: Element): string {
  return flattenBackgroundLayers(collectBackgroundLayers(el));
}
