/**
 * @file AdapterFactory — selects the correct I18nAdapter for a given binding.
 *
 * Accessed via: StyleReadService.getAvailableKeys (Task 4) and I18nTextInspector (Task 5)
 * Assumptions: binding.library reliably reflects the project's i18n format;
 *   TsMergedAdapter is selected for merged single-file formats (Task 3 wires this)
 */

import type { FileIO } from '@lib/ast/file-io';
import type { I18nTextBinding } from '@shared/i18n-text/types';
import { CustomJsonAdapter } from './CustomJsonAdapter';
import type { I18nAdapter } from './I18nAdapter';
import { ReactI18nextAdapter } from './ReactI18nextAdapter';

type AdapterFileIO = Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] };

export class AdapterFactory {
  constructor(
    private readonly workspaceRoot: string,
    private readonly fileIO: AdapterFileIO,
  ) {}

  forBinding(binding: I18nTextBinding): I18nAdapter {
    switch (binding.library) {
      case 'react-i18next':
      case 'i18next':
        return new ReactI18nextAdapter(this.workspaceRoot, binding.namespace, this.fileIO);
      default:
        return new CustomJsonAdapter(this.workspaceRoot, binding.namespace, this.fileIO);
    }
  }
}
