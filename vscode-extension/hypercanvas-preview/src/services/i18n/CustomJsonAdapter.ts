/**
 * @file CustomJsonAdapter — i18n adapter for custom locale files.
 *
 * Accessed via: AdapterFactory.forBinding for non-react-i18next non-merged layouts
 * Assumptions: static TS/JS dictionaries are object literals; dynamic modules return no keys.
 */

import type { FileIO } from '@lib/ast/file-io';
import { discoverLayout, resolveI18nResource } from '@shared/i18n-text/resolve-i18n-resource';
import { parseTsLocaleObject } from '@shared/i18n-text/ts-locale-ast';
import { extractLeafKeys } from './extract-leaf-keys';
import type { I18nAdapter } from './I18nAdapter';

type AdapterFileIO = Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] };

export class CustomJsonAdapter implements I18nAdapter {
  constructor(
    private readonly workspaceRoot: string,
    private readonly namespace: string | undefined,
    private readonly fileIO: AdapterFileIO,
  ) {}

  async getAvailableKeys(locale: string): Promise<string[]> {
    try {
      const layout = await discoverLayout(this.workspaceRoot, this.namespace, locale, this.fileIO);
      if (!layout || layout.mergedData) return [];

      let effectiveLocale = locale;
      let filePath = layout.getLocaleFilePath(effectiveLocale);

      let content: string;
      try {
        content = await this.fileIO.readFile(filePath);
      } catch {
        const fallback = layout.availableLocales[0];
        if (!fallback || fallback === locale) return [];
        effectiveLocale = fallback;
        filePath = layout.getLocaleFilePath(effectiveLocale);
        try {
          content = await this.fileIO.readFile(filePath);
        } catch {
          return [];
        }
      }

      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
        const parsed = parseTsLocaleObject(content, effectiveLocale);
        if (!parsed) return [];
        const data = parsed.kind === 'merged' ? parsed.data[effectiveLocale] : parsed.data;
        return extractLeafKeys(data);
      }

      let data: unknown;
      try {
        data = JSON.parse(content);
      } catch {
        return [];
      }

      return extractLeafKeys(data);
    } catch {
      return [];
    }
  }

  async resolveText(key: string, locale: string): Promise<string | null> {
    try {
      const result = await resolveI18nResource({
        projectRoot: this.workspaceRoot,
        library: 'custom',
        key,
        namespace: this.namespace,
        activeLocale: locale,
        fileIO: this.fileIO,
      });
      return result.resolvedText;
    } catch {
      return null;
    }
  }
}
