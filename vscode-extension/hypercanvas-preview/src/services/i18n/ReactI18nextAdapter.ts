/**
 * @file ReactI18nextAdapter — i18n adapter for react-i18next JSON locale files.
 *
 * Accessed via: AdapterFactory.forBinding when binding.library === 'react-i18next'
 * Assumptions: locale files are JSON; layout discovered via discoverLayout (shared)
 */

import type { FileIO } from '@lib/ast/file-io';
import { discoverLayout, resolveI18nResource } from '@shared/i18n-text/resolve-i18n-resource';
import type { I18nAdapter } from './I18nAdapter';
import { extractLeafKeys } from './extract-leaf-keys';

type AdapterFileIO = Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] };

export class ReactI18nextAdapter implements I18nAdapter {
  constructor(
    private readonly workspaceRoot: string,
    private readonly namespace: string | undefined,
    private readonly fileIO: AdapterFileIO,
  ) {}

  async getAvailableKeys(locale: string): Promise<string[]> {
    try {
      const layout = await discoverLayout(this.workspaceRoot, this.namespace, locale, this.fileIO);
      if (!layout || layout.mergedData) return [];

      const filePath = layout.getLocaleFilePath(locale);
      if (filePath.endsWith('.ts') || filePath.endsWith('.js')) return [];

      let content: string;
      try {
        content = await this.fileIO.readFile(filePath);
      } catch {
        const fallback = layout.availableLocales[0];
        if (!fallback || fallback === locale) return [];
        try {
          content = await this.fileIO.readFile(layout.getLocaleFilePath(fallback));
        } catch {
          return [];
        }
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
        library: 'react-i18next',
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

  async writeKey(_elementId: string, _newKey: string): Promise<void> {
    throw new Error('ReactI18nextAdapter.writeKey: route key changes through writeI18nResource RPC (AstBridge handles JSX update)');
  }
}
