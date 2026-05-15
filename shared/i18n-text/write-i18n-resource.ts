/**
 * @file Locale resource write path for i18n text editing.
 *
 * Accessed via: SaaS /api/write-i18n-resource route and VS Code extension (AstBridge)
 * Assumptions: pure logic, host I/O injected via FileIO adapter
 */

import type { FileIO } from '../../lib/ast/file-io';
import { discoverLayout } from './resolve-i18n-resource';
import type { I18nLibrary } from './types';

export type I18nWriteError = 'missing-locale-file' | 'parse-error' | 'unsupported-format' | 'read-only' | 'io-error';

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

/**
 * Set a translation value at key inside an in-memory JSON object.
 * Tries literal key first (for flat keys with dots), then checks if the file
 * uses flat-key convention (any top-level key contains a dot), then falls back
 * to dot-path traversal with intermediate object creation.
 */
const FORBIDDEN_KEY_PARTS = new Set(['__proto__', 'constructor', 'prototype']);

function setKey(data: unknown, key: string, value: string): boolean {
  if (typeof data !== 'object' || data === null) return false;

  // Reject keys that could pollute Object.prototype or Function.prototype
  const parts = key.split('.');
  if (parts.some((p) => FORBIDDEN_KEY_PARTS.has(p))) return false;

  const obj = data as Record<string, unknown>;

  // Literal key first — handles flat keys containing dots (e.g. "habits.walks")
  if (Object.hasOwn(obj, key)) {
    obj[key] = value;
    return true;
  }

  // If any top-level key already contains dots, the file uses flat-key convention.
  // Write new keys as flat literals to match the existing format.
  const hasFlatDotKeys = Object.keys(obj).some((k) => k.includes('.'));
  if (hasFlatDotKeys) {
    obj[key] = value;
    return true;
  }

  // Dot-path traversal with intermediate object creation.
  // If a path segment exists but is not an object (e.g. "nav" is a string),
  // bail out — overwriting it would corrupt the locale file.
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (typeof current[part] !== 'object' || current[part] === null) {
      if (Object.hasOwn(current, part)) return false; // non-object collision
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return true;
}

export async function writeI18nResource(params: WriteI18nResourceParams): Promise<WriteI18nResourceResult> {
  const { projectRoot, key, namespace, activeLocale, newText, fileIO } = params;

  const layout = await discoverLayout(projectRoot, namespace, activeLocale, fileIO);

  if (!layout) {
    return { success: false, filePath: null, error: 'missing-locale-file' };
  }

  const filePath = layout.getLocaleFilePath(activeLocale);

  // TS/JS locale files are read-only — we cannot safely eval or mutate them
  if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    return { success: false, filePath: null, error: 'unsupported-format' };
  }

  // Read the active locale file
  let content: string;
  try {
    content = await fileIO.readFile(filePath);
  } catch {
    return { success: false, filePath: null, error: 'missing-locale-file' };
  }

  // Parse JSON — do not corrupt the file on parse failure
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { success: false, filePath: null, error: 'parse-error' };
  }

  // Locale files must be plain objects — arrays and primitives cannot hold translation keys
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { success: false, filePath: null, error: 'parse-error' };
  }

  const keySet = setKey(data, key, newText);
  if (!keySet) {
    return { success: false, filePath: null, error: 'unsupported-format' };
  }

  const updated = `${JSON.stringify(data, null, 2)}\n`;
  try {
    await fileIO.writeFile(filePath, updated);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const isPermission = code === 'EACCES' || code === 'EROFS' || code === 'EPERM';
    return { success: false, filePath: null, error: isPermission ? 'read-only' : 'io-error' };
  }

  return { success: true, filePath };
}
