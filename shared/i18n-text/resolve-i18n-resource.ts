/**
 * @file Locale resource resolution for i18n text inspection.
 *
 * Accessed via: SaaS inspector (useElementStyleData) and VS Code extension (StyleReadService)
 * Assumptions: pure logic, host I/O is injected via FileIO adapter
 *
 * TODO (Task 7): implement real locale discovery and key resolution.
 * Currently a stub — all calls return unresolvedReason: 'missing-locale-file'.
 */

import type { FileIO } from '../../lib/ast/file-io';
import type { I18nLibrary, I18nUnresolvedReason, ResolveI18nResourceResult } from './types';

export interface ResolveI18nResourceParams {
  projectRoot: string;
  library: I18nLibrary;
  key: string;
  namespace?: string;
  activeLocale: string;
  fallbackLocale?: string;
  fileIO: Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] };
}

export async function resolveI18nResource(_params: ResolveI18nResourceParams): Promise<ResolveI18nResourceResult> {
  const reason: I18nUnresolvedReason = 'missing-locale-file';
  return {
    availableLocales: [],
    activeLocale: _params.activeLocale,
    resolvedText: null,
    unresolvedReason: reason,
  };
}
