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

/**
 * A JS camelCase CSS property name is letters only (`backgroundColor`, `borderTopColor`). The
 * property list here is caller-supplied (ultimately the edited style keys, arriving over a webview
 * postMessage), so validate each against this shape before it is used as a dynamic object key —
 * this both rejects the prototype-chain keys (`__proto__` etc.) and satisfies CodeQL
 * js/remote-property-injection, which treats the regex test as the sanitizing barrier.
 */
const CAMEL_CASE_CSS_PROPERTY = /^[a-zA-Z]+$/;

/**
 * A CSS custom property (`--brand`, `--foo-bar-2`, `--brand_color`). Distinct from the camelCase
 * form because it (a) is a legitimate edited-style key the camelCase regex silently drops (HYP-987
 * P1 #2 — a `--brand` edit never verified, so it was always rolled back + false-warned), and
 * (b) must be read VERBATIM: custom properties are case-sensitive and are NOT kebab-normalized.
 * The body allows underscores (CSS idents permit them — `--brand_color` is valid, HYP-987 review),
 * but the mandatory leading `--` means the result key can never be the bare prototype-chain key
 * `__proto__`/`constructor`; combined with the null-prototype result object it is a safe
 * remote-property-injection barrier.
 */
const CSS_CUSTOM_PROPERTY = /^--[a-zA-Z0-9_-]+$/;

/**
 * Read live computed style for an ARBITRARY, caller-specified property list (HYP-901 write-verify
 * — the edited properties can be anything, unlike {@link extractComputedStyle}'s fixed inspector-
 * display set). Property names are the JS camelCase form (`backgroundColor`); `getPropertyValue`
 * needs kebab-case, so each is converted the same way `client/lib/style-change-detector.ts` does
 * for the SaaS realm's equivalent before/after read. A CSS custom property (`--brand`) is read
 * verbatim (no kebab conversion — HYP-987 P1 #2).
 *
 * ALWAYS includes `effectiveBackgroundColor` (the painted-through background resolved by walking
 * ancestors, same as {@link extractComputedStyle}). This is the load-bearing signal for the
 * HYP-987 auto-wrap verify (P1 #1): the wrap injects a background onto a NEW parent `<div>`, and
 * `backgroundColor` does not inherit, so the wrapped element's OWN `backgroundColor` never changes
 * whether or not the wrapper is actually visible. `effectiveBackgroundColor` DOES change when the
 * wrapper's colour paints through (transparent child) and does NOT when an opaque child root
 * covers the wrapper (the HostRoutePage repro) — so it correctly distinguishes a wrap that became
 * visible from one that was covered, where the child's own `backgroundColor` cannot.
 */
export function extractComputedStyleForProperties(el: HTMLElement, cssProperties: string[]): Record<string, string> {
  const cs = window.getComputedStyle(el);
  const result: Record<string, string> = Object.create(null);
  for (const prop of cssProperties) {
    if (CSS_CUSTOM_PROPERTY.test(prop)) {
      result[prop] = cs.getPropertyValue(prop);
      continue;
    }
    if (!CAMEL_CASE_CSS_PROPERTY.test(prop)) continue;
    result[prop] = cs.getPropertyValue(prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`));
  }
  result.effectiveBackgroundColor = computeEffectiveBackgroundColor(el);
  return result;
}
