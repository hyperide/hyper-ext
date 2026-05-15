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
 * Resolve a sibling's effective CSS `order` value for sort purposes at the given breakpoint.
 *
 * Unlike `readOrderForBp` (which returns null for absent / named tokens), this helper
 * mirrors the CSS spec: missing → `0`, `order-none` → `0`, `order-first` → very-low (-9999),
 * `order-last` → very-high (9999). Numeric `order-N` and arbitrary `order-[<int>]` are
 * parsed to their integer value.
 *
 * Used by `computeOrderWritePlan` to build the current visual order before applying the
 * drop. Without CSS-correct semantics, default-ordered siblings get sorted *after*
 * numeric ones, producing wrong renumber sequences when the parent mixes explicit
 * `order-N` with default / named children (codex finding from tw-order review).
 *
 * Tailwind responsive cascade: when `breakpoint` is a known variant (sm/md/lg/xl/2xl),
 * walk that bp → smaller bps → base, returning the first defined token. Mirrors CSS
 * min-width media-query stacking — at an md viewport, an `order-3` (base) or `sm:order-3`
 * still applies if the sibling has no `md:order-*` override. Without this, a parent that
 * mixes `order-2` and `md:order-1` renumbers the base-only sibling as 0 at md and writes
 * wrong dense md:order-* values (codex Task-4 follow-up review finding).
 *
 * Tokens of the form `order-[<not-an-int>]` (true arbitrary CSS) fall through to `0` —
 * we don't know how to safely renumber them anyway, and this matches the "ignore unknown"
 * policy used elsewhere. Callers that intend to *write* dense renumbering should run
 * `hasUnparseableOrderTokenAtBp` first and bail to avoid silently overwriting
 * `order-[var(--x)]` etc. (the parse-as-0 here is for sort positioning only).
 */
// Keep in sync with `TAILWIND_BREAKPOINTS` in `order-drag-detect.ts` — both lists
// must enumerate the same Tailwind v3 default variants.
const RESPONSIVE_BP_CHAIN: ReadonlyArray<string> = ['sm', 'md', 'lg', 'xl', '2xl'];

function parseOrderSortValueForBp(tokens: readonly string[], breakpoint: string | undefined): number | null {
  for (const token of tokens) {
    if (!isOrderClassAtBreakpoint(token, breakpoint)) continue;
    const bare = breakpoint === undefined ? token : token.slice(breakpoint.length + 1);
    const numeric = bare.match(/^order-(\d+)$/);
    if (numeric) return Number.parseInt(numeric[1], 10);
    if (bare === 'order-first') return -9999;
    if (bare === 'order-last') return 9999;
    if (bare === 'order-none') return 0;
    const arbitrary = bare.match(/^order-\[(-?\d+)\]$/);
    if (arbitrary) return Number.parseInt(arbitrary[1], 10);
    return 0;
  }
  return null;
}

export function readOrderSortValueForBp(className: string | undefined, breakpoint: string | undefined): number {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean);
  if (breakpoint === undefined) {
    return parseOrderSortValueForBp(tokens, undefined) ?? 0;
  }
  const idx = RESPONSIVE_BP_CHAIN.indexOf(breakpoint);
  if (idx < 0) {
    // Unknown variant (project-custom prefix): try it directly, then base.
    return parseOrderSortValueForBp(tokens, breakpoint) ?? parseOrderSortValueForBp(tokens, undefined) ?? 0;
  }
  for (let i = idx; i >= 0; i--) {
    const value = parseOrderSortValueForBp(tokens, RESPONSIVE_BP_CHAIN[i]);
    if (value !== null) return value;
  }
  return parseOrderSortValueForBp(tokens, undefined) ?? 0;
}

/**
 * Detect tokens that `applyOrderClassChange` cannot safely round-trip at the given
 * breakpoint — i.e. an `order-[<expr>]` whose payload is NOT a plain integer.
 *
 * Rationale: `isOrderClassAtBreakpoint` matches arbitrary tokens, so a dense renumber
 * pass would silently REPLACE `order-[var(--idx)]` (or `order-[10rem]`) with
 * `order-3`, destroying the user's CSS-var or non-int reference. Callers that intend
 * to write should run this first and bail to the AST-move path.
 */
export function hasUnparseableOrderTokenAtBp(
  className: string | undefined,
  breakpoint: string | undefined,
): boolean {
  const tokens = (className ?? '').split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    if (!isOrderClassAtBreakpoint(token, breakpoint)) continue;
    const bare = breakpoint === undefined ? token : token.slice(breakpoint.length + 1);
    const arbitrary = bare.match(/^order-\[([^\]]+)\]$/);
    if (!arbitrary) continue;
    if (!/^-?\d+$/.test(arbitrary[1])) return true;
  }
  return false;
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
