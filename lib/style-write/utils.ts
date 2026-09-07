/**
 * @file Shared helpers for style-write planning and execution
 *
 * Accessed via: StyleWriteManager, StyleWritePlanner, and StyleWriteExecutor internals
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

export function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/**
 * True for a CSS custom property name (`--brandColor`). Custom property names are
 * case-sensitive, so — unlike a standard CSS/React style key — they must never be
 * `camelToKebab`'d: `toReactStyleKey` (`lib/ast/inline-style-mutator.ts`) already leaves them
 * untouched when writing inline, so any downstream label/match derived from
 * `camelToKebab(key)` would silently diverge from the name that was actually written.
 *
 * Not exported: `styleKeyToCssProperty` below is the single call-site every consumer should
 * use instead (see its own doc comment) — this stays module-private so knip's unused-export
 * check doesn't flag it (no other file imports it directly). CI ("Lint & Typecheck") caught
 * this as a required-check failure on this PR.
 */
function isCssCustomProperty(key: string): boolean {
  return key.startsWith('--');
}

/**
 * CSS property name for a style key, safe to use for a user-facing label (the D2/HYP-706
 * "where it landed" badge) or a property-identity comparison. Review finding (GLM, HYP-706):
 * a naive `camelToKebab` on every applied key mangles a custom property's case-sensitive name
 * (`--brandColor` → `--brand-color`, a DIFFERENT name than what was written). Single source of
 * truth for this conversion — every call site that used to hand-roll `camelToKebab` on a style
 * key must route through here instead.
 */
export function styleKeyToCssProperty(key: string): string {
  return isCssCustomProperty(key) ? key : camelToKebab(key);
}
