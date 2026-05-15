/**
 * @file I18nAdapter — abstract interface for per-format i18n adapters.
 *
 * Accessed via: VS Code right panel inspector (i18n key combobox and text field)
 *   when an element with an i18n expression is selected.
 * Assumptions: each adapter operates on a single known i18n layout/format;
 *   format detection happens upstream (AdapterFactory) before the adapter is called.
 * Architecture: https://hyperide.github.io/reports/style-write-unification
 */

export interface I18nAdapter {
  /** Return all translation keys for the given locale, as dot-path strings. */
  getAvailableKeys(locale: string): Promise<string[]>;

  /** Resolve the translated text for a key+locale. Returns null when not found. */
  resolveText(key: string, locale: string): Promise<string | null>;
}
