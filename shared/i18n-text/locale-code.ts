/**
 * @file Locale-code recognizer for content-first i18n discovery.
 *
 * Accessed via: resolve-by-dom-text content-first path classification.
 * Assumptions: once discovery no longer trusts conventional dir names (locales/,
 *   public/locales/, …), a path segment must be VALIDATED as a locale code before
 *   it can be read as the locale of a dictionary. Without this, a random
 *   `config/en.json` of feature flags could be misread, and (worse) a hit in
 *   `src/components/Button.json` would be assigned a bogus locale.
 *
 * Grammar (BCP-47 subset, the shapes real i18n projects actually use as file/dir names):
 *   - language: 2–3 ASCII letters            → en, de, fr, ru, fil
 *   - optional script: 4 letters             → zh-Hant
 *   - optional region: 2 letters | 3 digits  → en-US, es-419, pt-BR
 * Separator may be `-` or `_` (some projects use en_US). Case-insensitive on input;
 * comparisons elsewhere stay case-sensitive on the original segment.
 */

const LOCALE_CODE_RE = /^[a-z]{2,3}(?:[-_][a-z]{4})?(?:[-_](?:[a-z]{2}|\d{3}))?$/i;

/**
 * Common 2–3 letter project DIRECTORY / FILE basenames that match the bare-language
 * production of the locale grammar but are never locales. Without this denylist a value
 * matched in e.g. `src/data/settings.json` would be mislabeled as locale "src" and
 * returned as an i18n binding. Lower-cased; comparison is case-insensitive.
 *
 * NOTE: kept deliberately tight — only segments that genuinely collide with the 2–3
 * letter language shape AND are widespread source/tooling names. A real 2-letter locale
 * (en/de/fr/…) must never appear here.
 */
const NON_LOCALE_SEGMENTS = new Set([
  'src',
  'app',
  'lib',
  'api',
  'www',
  'css',
  'img',
  'js',
  'ts',
  'cjs',
  'mjs',
  'bin',
  'doc',
  'pkg',
  'cmd',
  'env',
  'dev',
  'tmp',
  'log',
  'out',
  'web',
  'ios',
]);

/**
 * True when `segment` looks like a BCP-47-ish locale code usable as a dir/file name.
 * Rejects obvious non-locales: `node`, `dist`, `common`, `config`, `messages`, `index`
 * (too long / wrong shape) and the NON_LOCALE_SEGMENTS denylist (`src`, `app`, `lib`, …).
 *
 * The denylist is required even though the VALUE/KEY match gate runs first: a real
 * dictionary VALUE can legitimately appear inside a non-i18n JSON under `src/`, so the
 * shape check alone would mislabel it. Region-qualified codes (`en-US`, `pt-BR`) are
 * always accepted — the denylist only covers bare 2–3 letter segments.
 */
export function isLocaleCode(segment: string): boolean {
  if (!segment) return false;
  if (NON_LOCALE_SEGMENTS.has(segment.toLowerCase())) return false;
  return LOCALE_CODE_RE.test(segment);
}
