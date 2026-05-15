/**
 * @file Pure helpers for manipulating Tailwind `order-N` / `<bp>:order-N` class tokens.
 *
 * Accessed via:
 *   - `client/lib/canvas-engine/adapters/TailwindAdapter.ts` (`writeOrder` method).
 *   - `iframe-interaction.ts` drag-drop pipeline (order-driven parent reorder), via
 *     `order-drag-detect.ts`.
 *
 * Assumptions: input is the raw `class="..."` string. We normalise whitespace but do not
 *   sort or canonicalise unrelated tokens. `applyOrderClassChange` does in-place
 *   replacement when an existing order token at the targeted breakpoint is found —
 *   preserves source-position so consumer regexes that anchor at `className="order-N`
 *   continue to match after reorder.
 */

/**
 * Tailwind class names matching the `order-*` family, including:
 * - `order-1`, `order-12` (numeric)
 * - `order-none`, `order-first`, `order-last` (named)
 * - `order-[<arbitrary>]` (arbitrary value)
 */
const ORDER_BARE_RE = /^order-(?:none|first|last|\d+|\[[^\]]+\])$/;

/**
 * Build the variant-prefixed class token for a given numeric order value.
 *
 * @param value - Order number (negative values not supported here; Tailwind uses `-order-1`
 *   syntax for those, which is out of scope until requested).
 * @param breakpoint - Tailwind responsive prefix (e.g. 'md'); undefined for base.
 */
export function buildOrderClass(value: number, breakpoint: string | undefined): string {
  const bare = `order-${value}`;
  return breakpoint ? `${breakpoint}:${bare}` : bare;
}

/**
 * Predicate: does the token belong to the targeted order family at the given breakpoint?
 *
 * Targeting `breakpoint=undefined` matches base `order-N` only — does NOT match `md:order-N`.
 * Targeting `breakpoint='md'` matches `md:order-N` only — does NOT match base `order-N`.
 */
export function isOrderClassAtBreakpoint(token: string, breakpoint: string | undefined): boolean {
  if (breakpoint === undefined) {
    // No prefix variants — token must be a bare order class.
    return ORDER_BARE_RE.test(token);
  }
  const prefix = `${breakpoint}:`;
  if (!token.startsWith(prefix)) return false;
  return ORDER_BARE_RE.test(token.slice(prefix.length));
}

/**
 * Read the numeric `order-N` value at the given breakpoint, or null if absent / not numeric.
 *
 * Returns null for `order-none`, `order-first`, `order-last`, `order-[<arbitrary>]` —
 * dense renumbering only operates on numeric tokens. Callers fall back to DOM index.
 */
export function readOrderForBp(className: string | undefined, breakpoint: string | undefined): number | null {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!isOrderClassAtBreakpoint(token, breakpoint)) continue;
    const bare = breakpoint === undefined ? token : token.slice(breakpoint.length + 1);
    const m = bare.match(/^order-(\d+)$/);
    if (m) return Number.parseInt(m[1], 10);
    return null;
  }
  return null;
}

/**
 * Compute the new className after writing/removing `order` at the given breakpoint.
 *
 * In-place replacement when an existing order token at the targeted breakpoint is found —
 * preserves leading-token position so test regexes anchored on `className="order-N`
 * keep matching. Appends to the end only when no existing token is present.
 *
 * @param className - Current className string (may be empty / undefined)
 * @param value - New order number, or `null` to remove the class entirely
 * @param breakpoint - Tailwind variant prefix; undefined for base
 * @returns New className string with single space separators and no leading/trailing spaces
 */
export function applyOrderClassChange(
  className: string | undefined,
  value: number | null,
  breakpoint: string | undefined,
): string {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean);
  const newToken = value === null ? null : buildOrderClass(value, breakpoint);
  let replaced = false;
  const result: string[] = [];
  for (const token of tokens) {
    if (isOrderClassAtBreakpoint(token, breakpoint)) {
      // Drop duplicates outright; replace only the first occurrence in-place.
      if (!replaced && newToken !== null) {
        result.push(newToken);
        replaced = true;
      }
      continue;
    }
    result.push(token);
  }
  if (!replaced && newToken !== null) {
    result.push(newToken);
  }
  return result.join(' ');
}
