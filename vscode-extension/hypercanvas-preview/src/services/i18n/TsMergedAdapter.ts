/**
 * @file TsMergedAdapter — i18n adapter for merged single-file translations format.
 *
 * Accessed via: AdapterFactory.forBinding when discoverLayout finds layout.mergedData
 * Assumptions: mergedData shape is { [locale]: { [key]: string | nested } };
 *   this is the "bulka-the-dog" format — translations.ts exports one object keyed by locale
 */

import { extractLeafKeys } from './extract-leaf-keys';
import type { I18nAdapter } from './I18nAdapter';

function lookupDotPath(data: Record<string, unknown>, key: string): string | null {
  const parts = key.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

export class TsMergedAdapter implements I18nAdapter {
  constructor(
    private readonly mergedData: Record<string, unknown>,
    private readonly availableLocales: string[],
  ) {}

  async getAvailableKeys(locale: string): Promise<string[]> {
    const localeData = this.mergedData[locale] ?? this.mergedData[this.availableLocales[0]];
    if (!localeData || typeof localeData !== 'object' || Array.isArray(localeData)) return [];
    return extractLeafKeys(localeData);
  }

  async resolveText(key: string, locale: string): Promise<string | null> {
    const localeData = this.mergedData[locale] ?? this.mergedData[this.availableLocales[0]];
    if (!localeData || typeof localeData !== 'object' || Array.isArray(localeData)) return null;
    return lookupDotPath(localeData as Record<string, unknown>, key);
  }

  async writeKey(_elementId: string, _newKey: string): Promise<void> {
    throw new Error(
      'TsMergedAdapter.writeKey: route key changes through writeI18nResource RPC (AstBridge handles JSX update)',
    );
  }
}
