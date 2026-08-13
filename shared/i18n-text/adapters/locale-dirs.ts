/**
 * @file Canonical locale-directory whitelist shared across i18n adapters.
 *
 * Accessed via: registry probe enumeration, JSON/TS adapters, resolve-i18n-resource,
 *   resolve-by-dom-text (re-exported so the two historic copies cannot drift).
 * Assumptions: directories are relative to the project root; ordering is priority
 *   (most conventional first). Detection is purely structural — no content semantics.
 */

/**
 * Well-known flat/namespaced locale directory layouts, tried in priority order.
 *
 * The first five entries match react-i18next / next-intl conventions and predate this
 * registry; the tail adds the directories the enumerated gap report flagged as missed
 * (react-intl `lang`/`compiled-lang`/`extracted`, a top-level `translations`/`i18n`,
 * Chrome-extension `app/_locales`). Keep this the single source of truth — the older
 * `FLAT_LOCALE_DIRS` (resolve-i18n-resource) and `LOCALE_DIRS` (resolve-by-dom-text)
 * now re-export it so they cannot drift.
 */
export const LOCALE_DIRS = [
  'locales',
  'public/locales',
  'src/i18n',
  'src/locales',
  'messages',
  'lang',
  'compiled-lang',
  'extracted',
  'translations',
  'i18n',
  'app/_locales',
] as const;
