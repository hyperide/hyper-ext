/**
 * HYP-544 Phase 3 — empirical color-probe (preview-panel realm).
 *
 * When an inspector color edit reaches the host from a source the static AST classifier
 * cannot resolve (a prop, a param, a computed/member token, or an unresolvable binding),
 * we cannot know statically WHICH value-bearing token drives the element's color. This
 * module runs in the preview iframe (the only realm with the live DOM + computed style)
 * and answers it EMPIRICALLY: enumerate candidate tokens, then for each, apply the
 * candidate-as-requested to an OFF-SCREEN DETACHED CLONE and read its computed style. The
 * first candidate whose computed color becomes the requested color (and differs from the
 * element's baseline) is "the place that drives the color".
 *
 * Tier 1 (off-screen clone) is the buildable mechanism implemented here. It is invisible by
 * construction (the clone lives in a zero-size, off-screen, hidden container — never in the
 * real layout) and NEVER mutates the real preview node. Tiers 2/3 (CDP
 * `CSS.getMatchedStylesForNode`; single-rAF real-element mutate-restore) are documented
 * follow-ups — Tier 2 needs a host-side CDP connection NOT reachable from page JS in this
 * realm (the iframe communicates only via postMessage; there is no chrome.debugger here).
 *
 * The pure helpers (normalizeColor / colorsEqual / rankCandidates) carry no DOM dependency
 * and are unit-tested directly. The DOM probe is proven against real Tailwind cascade only
 * by Docker e2e (real Chromium); happy-dom unit tests cover the clone+measure MECHANISM
 * with a controlled fixture stylesheet, not the real cascade.
 */

type ColorCandidateKind = 'tailwind-class' | 'inline-style' | 'css-var' | 'module-class';

export interface ColorCandidate {
  kind: ColorCandidateKind;
  /** The token text: a class name, an inline color value, or a `--var` name. */
  token: string;
  /** Where it lives, for the host's write-routing breadcrumb (informational). */
  locationHint: string;
}

export interface ProbeOptions {
  /**
   * For a Tailwind/module class candidate, the request class to swap IN on the clone (the
   * class that paints the requested color, e.g. `bg-red-600`). When absent, class candidates
   * fall back to setting the inline style[prop] on the clone (works for inline/var; a class
   * candidate without a requestClass cannot be empirically swapped and is skipped).
   */
  requestClass?: string;
}

/** Hard cap on probed candidates (§5.5). */
const MAX_CANDIDATES = 8;

/**
 * Normalize a CSS color to a canonical `rgb(r, g, b)` / `rgba(r, g, b, a)` string for
 * tuple-equality comparison. Returns null for values that don't normalize cleanly
 * (color-mix, oklch, relative color, named-but-unknown) — those are treated as "no match"
 * and fall through to the §7 floor (documented in §10).
 *
 * Browsers always REPORT computed colors as rgb()/rgba(), so the measured side normalizes
 * trivially; this primarily canonicalizes the REQUESTED color (often a hex from the palette).
 */
export function normalizeColor(input: string | null | undefined): string | null {
  if (!input) return null;
  const value = input.trim().toLowerCase();
  if (!value) return null;

  // #rgb / #rrggbb (alpha hex #rrggbbaa kept as rgba)
  const hexMatch = /^#([0-9a-f]{3,8})$/.exec(value);
  if (hexMatch) {
    const hex = hexMatch[1];
    if (hex.length === 3) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      return `rgb(${r}, ${g}, ${b})`;
    }
    if (hex.length === 6) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      return `rgb(${r}, ${g}, ${b})`;
    }
    if (hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = parseInt(hex.slice(6, 8), 16) / 255;
      return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${roundAlpha(a)})`;
    }
    return null; // 4-digit / odd lengths not supported
  }

  // rgb()/rgba()
  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)\s*(?:,\s*([0-9.]+)\s*)?\)$/.exec(value);
  if (rgbMatch) {
    const r = clampByte(rgbMatch[1]);
    const g = clampByte(rgbMatch[2]);
    const b = clampByte(rgbMatch[3]);
    const a = rgbMatch[4] === undefined ? 1 : Number(rgbMatch[4]);
    if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b) || Number.isNaN(a)) return null;
    return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${roundAlpha(a)})`;
  }

  // Anything else (color-mix, oklch, hsl, named colors, etc.) → no clean tuple → null.
  return null;
}

function clampByte(s: string): number {
  const n = Math.round(Number(s));
  if (Number.isNaN(n)) return NaN;
  return Math.min(255, Math.max(0, n));
}

function roundAlpha(a: number): number {
  return Math.round(a * 1000) / 1000;
}

/**
 * True when two colors normalize to the same rgb/rgba tuple. If either side can't be
 * normalized (color-mix/oklch/etc.), returns false → the candidate is not counted as a
 * driver and the write falls to the §7 per-approach floor.
 */
export function colorsEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeColor(a);
  const nb = normalizeColor(b);
  if (na === null || nb === null) return false;
  return na === nb;
}

const KIND_RANK: Record<ColorCandidateKind, number> = {
  'tailwind-class': 0,
  'inline-style': 1,
  'css-var': 2,
  'module-class': 3,
};

/**
 * Rank candidates per §4: exact same-group Tailwind class first, then inline style, then
 * CSS var, then hashed/module class. Stable within a kind (preserves detection order) so
 * "take first" (§6) is deterministic.
 */
export function rankCandidates(candidates: ColorCandidate[]): ColorCandidate[] {
  return candidates
    .map((c, i) => ({ c, i }))
    .sort((x, y) => KIND_RANK[x.c.kind] - KIND_RANK[y.c.kind] || x.i - y.i)
    .map((x) => x.c);
}

const HEX_RGB_HSL = /#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;

/**
 * Enumerate value-bearing color candidates on/around an element for the changed property
 * (§4). Runs in the preview-panel realm against the live DOM + computed style.
 *
 * @param el          the live (or cloned) element
 * @param prefixes    conflict prefixes for the changed property (getConflictingPrefixes)
 * @param cssProp     the camelCase computed-style property (e.g. 'backgroundColor')
 */
export function detectColorCandidates(el: HTMLElement, prefixes: string[], cssProp: string): ColorCandidate[] {
  const out: ColorCandidate[] = [];
  const seen = new Set<string>();
  const push = (c: ColorCandidate): void => {
    const key = `${c.kind}:${c.token}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(c);
  };

  // 1. Tailwind color classes matching the conflict prefixes (incl. arbitrary bg-[#...]).
  const classAttr = typeof el.className === 'string' ? el.className : (el.getAttribute('class') ?? '');
  const classTokens = classAttr.split(/\s+/).filter(Boolean);
  for (const tok of classTokens) {
    if (prefixes.some((p) => tok.startsWith(p))) {
      push({ kind: 'tailwind-class', token: tok, locationHint: 'class' });
    }
  }

  // 2. Inline style color for the changed property.
  const inlineProp = (el.style as unknown as Record<string, string>)[cssProp];
  if (inlineProp) {
    push({ kind: 'inline-style', token: inlineProp, locationHint: `style.${cssProp}` });
  }

  // 3. CSS custom properties the element reads via var(...) in any inline value, plus
  //    hex/rgb/hsl literals in inline style or class arbitrary-values.
  const styleText = el.getAttribute('style') ?? '';
  for (const varMatch of styleText.matchAll(/var\(\s*(--[\w-]+)/g)) {
    push({ kind: 'css-var', token: varMatch[1], locationHint: 'computed' });
  }
  // Inline value of the changed prop that itself is a var(...) reference.
  if (inlineProp) {
    const v = /var\(\s*(--[\w-]+)/.exec(inlineProp);
    if (v) push({ kind: 'css-var', token: v[1], locationHint: 'computed' });
  }

  // 4. Hashed / CSS-module classes: class tokens NOT matching any Tailwind utility prefix and
  //    not whitespace — candidates whose source mapping is resolved by the host's StyleAdapter.
  for (const tok of classTokens) {
    if (prefixes.some((p) => tok.startsWith(p))) continue; // already a tailwind candidate
    if (/^[A-Za-z_][\w-]*_[A-Za-z0-9]{4,}$|^sc-[\w-]+$/.test(tok)) {
      push({ kind: 'module-class', token: tok, locationHint: 'class' });
    }
  }

  // Bonus: bare color literals anywhere in the style attribute (rare; low rank not modeled —
  // surfaced as inline-style so the floor can write an inline override).
  for (const lit of styleText.matchAll(HEX_RGB_HSL)) {
    push({ kind: 'inline-style', token: lit[0], locationHint: 'style' });
  }

  return rankCandidates(out);
}

/** Map camelCase css prop to the kebab style-property setter name. */
function kebabProp(cssProp: string): string {
  return cssProp.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * Tier-1 off-screen-clone empirical probe (§5.1). For each ranked candidate, clone the
 * element, apply the candidate-as-requested to the clone, attach the clone to a reused
 * off-screen container (so getComputedStyle resolves the cascade), measure, and remove the
 * clone. The candidate "drives the color" when the clone's computed value becomes the
 * requested color AND differs from the element's baseline. Capped at 8 candidates.
 *
 * NEVER mutates the real element. Invisibility is structural (the container is fixed,
 * off-screen, zero-size, hidden) — no timing, no flicker.
 *
 * @returns the ordered list of driving candidates (rank-preserved). Empty = none drive →
 *          host degrades to the §7 floor (Phase 2).
 */
export function probeDrivingCandidates(
  el: HTMLElement,
  candidates: ColorCandidate[],
  requestedColor: string,
  cssProp: string,
  opts: ProbeOptions = {},
): ColorCandidate[] {
  const ranked = rankCandidates(candidates).slice(0, MAX_CANDIDATES);
  if (ranked.length === 0) return [];

  const baseline = readComputed(el, cssProp);
  const container = acquireOffscreenContainer(el.ownerDocument ?? document);
  const driving: ColorCandidate[] = [];

  try {
    for (const cand of ranked) {
      const clone = el.cloneNode(true) as HTMLElement;
      const applied = applyCandidateAsRequested(clone, cand, requestedColor, cssProp, opts);
      if (!applied) continue;
      container.appendChild(clone);
      const measured = readComputed(clone, cssProp);
      container.removeChild(clone);
      // "Drives the color" = the clone's computed value becomes the requested color AND that
      // is a real CHANGE from baseline. Compare baseline via NORMALIZED equality, not raw
      // strings: a candidate whose value already equals the request (just in a different
      // representation — hex vs rgb) is not driving anything (§5.4 baseline guard).
      if (!colorsEqual(measured, baseline) && colorsEqual(requestedColor, measured)) {
        driving.push(cand);
      }
    }
  } finally {
    releaseOffscreenContainer(container);
  }

  return driving;
}

function readComputed(el: HTMLElement, cssProp: string): string {
  const doc = el.ownerDocument ?? document;
  const view = doc.defaultView ?? (typeof window !== 'undefined' ? window : null);
  if (!view) return '';
  return view.getComputedStyle(el).getPropertyValue(kebabProp(cssProp)).trim();
}

/**
 * Apply the candidate-as-requested to the clone. Returns false when the candidate can't be
 * empirically applied (e.g. a class candidate with no requestClass to swap in).
 */
function applyCandidateAsRequested(
  clone: HTMLElement,
  cand: ColorCandidate,
  requestedColor: string,
  cssProp: string,
  opts: ProbeOptions,
): boolean {
  switch (cand.kind) {
    case 'tailwind-class':
    case 'module-class': {
      if (!opts.requestClass) return false;
      clone.classList.remove(cand.token);
      clone.classList.add(opts.requestClass);
      return true;
    }
    case 'inline-style': {
      // codeql[js/remote-property-injection] -- cssProp is a CSS property name from the extension's own color-probe request, written to a CSSStyleDeclaration (not a plain object); no prototype-pollution surface
      (clone.style as unknown as Record<string, string>)[cssProp] = requestedColor;
      return true;
    }
    case 'css-var': {
      // Override the var the element reads → drives the property iff the element resolves it.
      clone.style.setProperty(cand.token, requestedColor);
      return true;
    }
    default:
      return false;
  }
}

// --- Off-screen container (reused across a probe call; structurally invisible) ---

const CONTAINER_ID = 'hypercanvas-color-probe-offscreen';

function acquireOffscreenContainer(doc: Document): HTMLElement {
  const existing = doc.getElementById(CONTAINER_ID);
  if (existing) return existing;
  const container = doc.createElement('div');
  container.id = CONTAINER_ID;
  container.setAttribute(
    'style',
    'position:fixed;left:-99999px;top:0;width:0;height:0;overflow:hidden;visibility:hidden;pointer-events:none;',
  );
  container.setAttribute('aria-hidden', 'true');
  doc.body.appendChild(container);
  return container;
}

function releaseOffscreenContainer(container: HTMLElement): void {
  // Empty and remove so the real DOM has no residue (and child-count assertions hold).
  while (container.firstChild) container.removeChild(container.firstChild);
  container.parentNode?.removeChild(container);
}
