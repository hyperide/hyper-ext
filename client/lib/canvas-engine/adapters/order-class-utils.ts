/**
 * @file Pure helpers for manipulating Tailwind `order-N` / `<bp>:order-N` class tokens.
 *
 * Accessed via: TailwindAdapter.writeOrder during drag-reorder, and unit tests in
 *   `order-class-utils.test.ts`.
 * Assumptions: input is the raw `class="..."` string. We normalise whitespace but do not
 *   sort or canonicalise unrelated tokens.
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
 * Compute the new className after writing/removing `order` at the given breakpoint.
 *
 * Removes any existing token in the targeted order family (preserves other breakpoints
 * untouched), then appends the new order class iff `value` is a number.
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
  const filtered = tokens.filter((token) => !isOrderClassAtBreakpoint(token, breakpoint));
  if (value === null) {
    return filtered.join(' ');
  }
  filtered.push(buildOrderClass(value, breakpoint));
  return filtered.join(' ');
}
