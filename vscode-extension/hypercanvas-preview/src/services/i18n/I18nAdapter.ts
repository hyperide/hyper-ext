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

  /**
   * Update the JSX element to reference a different i18n key.
   * elementId is the element's nodeRef. The adapter updates the source expression
   * (e.g. t("old.key") → t("new.key")) without touching the locale JSON file.
   * In practice, key changes are routed through the writeI18nResource RPC channel
   * (which handles JSX update via AstBridge). Implementations that are not wired
   * to an AstService instance should throw.
   */
  writeKey(elementId: string, newKey: string): Promise<void>;
}
