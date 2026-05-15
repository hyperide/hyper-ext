/**
 * @file AdapterFactory — selects the correct I18nAdapter for a given binding.
 *
 * Accessed via: StyleReadService.getAvailableKeys (Task 4) and I18nTextInspector (Task 5)
 * Assumptions: binding.library reliably reflects the project's i18n format;
 *   TsMergedAdapter is selected when discoverLayout finds mergedData (single-file TS format)
 */

import type { FileIO } from '@lib/ast/file-io';
import { discoverLayout } from '@shared/i18n-text/resolve-i18n-resource';
import type { I18nTextBinding } from '@shared/i18n-text/types';
import { CustomJsonAdapter } from './CustomJsonAdapter';
import type { I18nAdapter } from './I18nAdapter';
import { ReactI18nextAdapter } from './ReactI18nextAdapter';
import { TsMergedAdapter } from './TsMergedAdapter';

type AdapterFileIO = Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] };

export class AdapterFactory {
  constructor(
    private readonly workspaceRoot: string,
    private readonly fileIO: AdapterFileIO,
  ) {}

  async forBinding(binding: I18nTextBinding, locale: string): Promise<I18nAdapter> {
    const layout = await discoverLayout(this.workspaceRoot, binding.namespace, locale, this.fileIO).catch(
      () => null,
    );
    if (layout?.mergedData) {
      return new TsMergedAdapter(layout.mergedData, layout.availableLocales);
    }
    switch (binding.library) {
      case 'react-i18next':
      case 'i18next':
        return new ReactI18nextAdapter(this.workspaceRoot, binding.namespace, this.fileIO);
      default:
        return new CustomJsonAdapter(this.workspaceRoot, binding.namespace, this.fileIO);
    }
  }
}
