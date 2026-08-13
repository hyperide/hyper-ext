/**
 * @file FileProbe construction + shared key/value primitives for adapters.
 *
 * Accessed via: registry.ts and every adapter. Pure; no host I/O here — the registry
 *   passes a FileIO down through AdapterContext when content is needed.
 * Assumptions: paths are absolute and rooted at `projectRoot`; classification is
 *   structural only (path shape + parsed object shape), never semantic.
 */

import { LOCALE_DIRS } from './locale-dirs';
import type { FileProbe } from './I18nFormatAdapter';

const KNOWN_EXTS: ReadonlyArray<FileProbe['ext']> = ['.json', '.ts', '.js', '.yml', '.yaml', '.po', '.vue'];

function extOf(filePath: string): FileProbe['ext'] | null {
  for (const ext of KNOWN_EXTS) {
    if (filePath.endsWith(ext)) return ext;
  }
  return null;
}

/**
 * Build a FileProbe for an absolute path under `projectRoot`. Returns null for paths
 * outside the root or with an unrecognised extension (registry skips those).
 */
export function buildProbe(filePath: string, projectRoot: string): FileProbe | null {
  const ext = extOf(filePath);
  if (!ext) return null;
  const prefix = `${projectRoot}/`;
  const relToRoot = filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath;
  const segments = relToRoot.split('/');

  // Longest matching locale dir wins so `public/locales` beats `locales` for a nested file.
  let matchedLocaleDir: string | undefined;
  for (const dir of LOCALE_DIRS) {
    if (relToRoot === dir || relToRoot.startsWith(`${dir}/`)) {
      if (!matchedLocaleDir || dir.length > matchedLocaleDir.length) matchedLocaleDir = dir;
    }
  }

  return { filePath, ext, relToRoot, segments, matchedLocaleDir };
}

/** Strip a known extension from a filename segment. */
export function stripExt(segment: string): string {
  const idx = segment.lastIndexOf('.');
  return idx === -1 ? segment : segment.slice(0, idx);
}

/** Object keys that would resolve onto Object.prototype — never traversed. */
const PROTO_KEYS: ReadonlySet<string> = new Set(['__proto__', 'prototype', 'constructor']);

/**
 * Resolve a dot-path (or literal-with-dots) key to a string value.
 * Literal key first — handles flat dotted keys like "habits.walks"; then dot traversal.
 * This is the same algorithm as resolveKey/resolveLocaleKey, lifted for reuse.
 *
 * Each hop is own-property only and rejects prototype keys, so a malicious dotted key
 * can never walk into Object.prototype (also clears the prototype-pollution-loop SAST rule).
 */
export function resolveKeyInData(data: unknown, key: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;
  if (Object.hasOwn(obj, key)) {
    const val = obj[key];
    return typeof val === 'string' ? val : null;
  }
  const found = key.split('.').reduce<unknown>((acc, part) => {
    if (PROTO_KEYS.has(part) || typeof acc !== 'object' || acc === null) return undefined;
    if (!Object.hasOwn(acc as object, part)) return undefined;
    return (acc as Record<string, unknown>)[part];
  }, obj);
  return typeof found === 'string' ? found : null;
}

/** Recursively find `target` as a value; return its dot-path key, or null. */
export function findKeyByValue(obj: unknown, target: string, prefix = ''): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' && v === target) return path;
    if (typeof v === 'object') {
      const found = findKeyByValue(v, target, path);
      if (found !== null) return found;
    }
  }
  return null;
}

/** Recursively collect all leaf dot-path keys (string leaves only). */
export function extractLeafKeys(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    return prefix ? [prefix] : [];
  }
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') {
      keys.push(path);
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      keys.push(...extractLeafKeys(v, path));
    }
  }
  return keys;
}
