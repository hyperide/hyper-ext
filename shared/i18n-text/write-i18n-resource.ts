/**
 * @file Locale resource write path for i18n text editing.
 *
 * Accessed via: SaaS inspector write route and VS Code extension (AstBridge)
 * Assumptions: pure logic, host I/O injected via FileIO adapter
 *
 * NOT IMPLEMENTED — stub for type correctness. Task 12 adds the implementation.
 */

import type { FileIO } from '../../lib/ast/file-io';
import type { I18nLibrary } from './types';

export type I18nWriteError = 'missing-locale-file' | 'parse-error' | 'unsupported-format' | 'read-only';

export interface WriteI18nResourceParams {
  projectRoot: string;
  library: I18nLibrary;
  key: string;
  namespace?: string;
  activeLocale: string;
  newText: string;
  fileIO: Pick<FileIO, 'readFile' | 'writeFile' | 'access'> & { listFiles?: FileIO['listFiles'] };
}

export interface WriteI18nResourceResult {
  success: boolean;
  /** Absolute path of the locale file that was written, or null on failure. */
  filePath: string | null;
  error?: I18nWriteError;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function writeI18nResource(_params: WriteI18nResourceParams): Promise<WriteI18nResourceResult> {
  throw new Error('writeI18nResource is not implemented — Task 12');
}
