/**
 * DOM utility functions for iframe-interaction.ts
 */

import { computeEffectiveBackgroundColor } from '@shared/utils/effective-background';

const COMPUTED_STYLE_PROPS = [
  'backgroundColor',
  'backgroundImage',
  'color',
  'borderColor',
  'borderTopColor',
  'borderWidth',
  'borderStyle',
  'borderRadius',
  'opacity',
  'fontSize',
  'width',
  'height',
] as const;

/**
 * Scroll an element into view, preferring smooth scrolling when supported.
 * Falls back to basic scrollIntoView in older environments.
 */
export function scrollIntoViewCenterSmooth(el: Element): void {
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    try {
      el.scrollIntoView({ block: 'center' });
    } catch {
      el.scrollIntoView();
    }
  }
}

/**
 * Extract computed style properties from an element.
 */
export function extractComputedStyle(el: HTMLElement): Record<string, string> {
  const cs = window.getComputedStyle(el);
  const result: Record<string, string> = {};
  for (const prop of COMPUTED_STYLE_PROPS) {
    const value = cs[prop as keyof CSSStyleDeclaration] as string;
    if (value) result[prop] = value;
  }
  // The element's own `backgroundColor` is `rgba(0,0,0,0)` for a transparent element,
  // which the inspector cannot judge text contrast against. Resolve the real painted
  // background by walking ancestors here (the iframe has the DOM; the inspector doesn't).
  result.effectiveBackgroundColor = computeEffectiveBackgroundColor(el);
  return result;
}
