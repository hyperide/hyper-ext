/**
 * @file Locale resource write path for i18n text editing.
 *
 * Accessed via: SaaS /api/write-i18n-resource route and VS Code extension (AstBridge)
 * Assumptions: pure logic, host I/O injected via FileIO adapter
 */

import type { FileIO } from '../../lib/ast/file-io';
import { discoverLayout } from './resolve-i18n-resource';
import { writeTsLocaleValue } from './ts-locale-ast';
import type { I18nLibrary } from './types';

type I18nWriteError = 'missing-locale-file' | 'parse-error' | 'unsupported-format' | 'read-only' | 'io-error';

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
  // `typeof null === 'object'` in JS, so the explicit `=== null` check is required —
  // null would otherwise pass the typeof guard and crash the property writes below.
  // (CodeQL flags this as a redundant comparison; it is a false positive.)
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

  // If the first segment already exists as an object, the file uses nested convention for
  // that subtree — write nested even if other keys elsewhere use flat dot notation.
  const [firstPart] = parts;
  const firstSegmentIsObject =
    parts.length > 1 && typeof obj[firstPart] === 'object' && obj[firstPart] !== null && !Array.isArray(obj[firstPart]);

  if (!firstSegmentIsObject) {
    // If any top-level key already contains dots, the file uses flat-key convention.
    // Write new keys as flat literals to match the existing format.
    const hasFlatDotKeys = Object.keys(obj).some((k) => k.includes('.'));
    if (hasFlatDotKeys) {
      obj[key] = value;
      return true;
    }
  }

  // Dot-path traversal with intermediate object creation.
  // If a path segment exists but is not an object (e.g. "nav" is a string),
  // bail out — overwriting it would corrupt the locale file.
  let current: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    // Re-assert the prototype-pollution barrier at every write sink with
    // EXPLICIT literal comparisons. The up-front `FORBIDDEN_KEY_PARTS` Set
    // check is functionally sufficient, but CodeQL js/prototype-pollution-utility
    // only recognizes literal `key === '__proto__'`-style guards as a barrier,
    // not a `Set.has()` membership test, and does not propagate the up-front
    // check to these sinks.
    if (part === '__proto__' || part === 'constructor' || part === 'prototype') return false;
    if (typeof current[part] !== 'object' || current[part] === null) {
      if (Object.hasOwn(current, part)) return false; // non-object collision
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  const leaf = parts[parts.length - 1];
  if (leaf === '__proto__' || leaf === 'constructor' || leaf === 'prototype') return false;
  current[leaf] = value;
  return true;
}

export async function writeI18nResource(params: WriteI18nResourceParams): Promise<WriteI18nResourceResult> {
  const { projectRoot, key, namespace, activeLocale, newText, fileIO } = params;

  const layout = await discoverLayout(projectRoot, namespace, activeLocale, fileIO);

  if (!layout) {
    return { success: false, filePath: null, error: 'missing-locale-file' };
  }

  const filePath = layout.getLocaleFilePath(activeLocale);

  if (filePath.endsWith('.ts') || filePath.endsWith('.js')) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
      return { success: false, filePath: null, error: 'missing-locale-file' };
    }
    const updated = writeTsLocaleValue(content, activeLocale, key, newText);
    if (updated === null) return { success: false, filePath: null, error: 'unsupported-format' };
    try {
      await fileIO.writeFile(filePath, `${updated}\n`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      const isPermission = code === 'EACCES' || code === 'EROFS' || code === 'EPERM';
      return { success: false, filePath: null, error: isPermission ? 'read-only' : 'io-error' };
    }
    return { success: true, filePath };
  }

  // Read the active locale file
  let content: string;
  try {
    content = await fileIO.readFile(filePath);
  } catch {
    try {
      await fileIO.access(filePath);
      return { success: false, filePath: null, error: 'io-error' };
    } catch {
      return { success: false, filePath: null, error: 'missing-locale-file' };
    }
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

  // Detect original indentation to avoid reformatting files that use tabs or 4-space indent
  const indentMatch = content.match(/^(\t| {2,4})(?=\S)/m);
  const indent = indentMatch ? indentMatch[1] : '  ';
  const updated = `${JSON.stringify(data, null, indent)}\n`;
  try {
    await fileIO.writeFile(filePath, updated);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    const isPermission = code === 'EACCES' || code === 'EROFS' || code === 'EPERM';
    return { success: false, filePath: null, error: isPermission ? 'read-only' : 'io-error' };
  }

  return { success: true, filePath };
}
