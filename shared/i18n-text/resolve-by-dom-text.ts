/**
 * @file i18n key resolution by DOM text content.
 *
 * Accessed via: StyleReadService i18n text inspection and key creation flows.
 * Assumptions: static TS/JS dictionaries are object literals; dynamic dictionary builders are read-only.
 *
 * Algorithm:
 *   1. List known JSON/TS/JS dictionary locations.
 *   2. Search each dictionary for domText as a VALUE → extract the dot-path key.
 *   3. If not found as value, search for domText as a KEY (covers mock/passthrough t = k => k).
 *   4. Derive locale and namespace from the dictionary shape or file path.
 *   5. Collect all matching locale dictionaries → availableLocales.
 */

import type { FileIO } from '../../lib/ast/file-io';
import { findTsDomTextHit, parseTsLocaleObject, resolveLocaleKey } from './ts-locale-ast';

/** Locale directories probed in priority order. */
const LOCALE_DIRS = ['locales', 'public/locales', 'src/i18n', 'src/locales', 'messages'];
const MERGED_FILE_CANDIDATES = [
  'src/translations.ts',
  'src/lib/translations.ts',
  'client/lib/translations.ts',
  'lib/translations.ts',
  'src/i18n.ts',
  'src/translations.js',
  'src/lib/translations.js',
  'client/lib/translations.js',
  'lib/translations.js',
  'src/i18n.js',
];

export interface DomTextI18nMatch {
  key: string;
  /** The locale where the match was first found. */
  locale: string;
  /** The resolved text value in that locale. */
  resolvedText: string;
  namespace?: string;
  availableLocales: string[];
  /** 'value' = domText was a dictionary value; 'key' = domText was the key itself (passthrough mock). */
  matchType: 'value' | 'key';
}

/**
 * Recursively find domText as a dictionary VALUE.
 * Returns the dot-path key (e.g. "nested.greeting") or null if not found.
 */
function findByValue(obj: unknown, target: string, prefix = ''): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' && v === target) return path;
    if (typeof v === 'object') {
      const found = findByValue(v, target, path);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Check if target is a valid key in the dictionary object (exact literal key, or dot-path traversal).
 * Returns the string value if found, null otherwise.
 */
function findByKey(obj: unknown, key: string): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;

  // Literal key (handles flat keys like "habits.walks" stored as single entry)
  if (Object.hasOwn(o, key) && typeof o[key] === 'string') return o[key] as string;

  // Dot-path traversal
  const parts = key.split('.');
  let cur: unknown = o;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : null;
}

/**
 * Parse locale and namespace from a file path.
 *
 * Patterns:
 *   {dir}/{locale}.{json,ts,js}          → locale=locale, namespace=undefined
 *   {dir}/{locale}/{ns}.{json,ts,js}     → locale=locale, namespace=ns
 *   {root}/app/{locale}/messages/{file}.json → locale=locale, namespace=undefined
 */
function parseLocaleFromPath(filePath: string, dirPrefix: string): { locale: string; namespace?: string } | null {
  const rel = filePath.startsWith(`${dirPrefix}/`) ? filePath.slice(dirPrefix.length + 1) : null;
  if (!rel) return null;
  const parts = rel.split('/');

  const localeFileExt = ['.json', '.ts', '.js'].find((ext) => parts.length === 1 && parts[0].endsWith(ext));
  if (localeFileExt) {
    // {dir}/{locale}.{json,ts,js}
    const locale = parts[0].slice(0, -localeFileExt.length);
    if (locale) return { locale };
  }
  const namespaceFileExt = ['.json', '.ts', '.js'].find((ext) => parts.length === 2 && parts[1].endsWith(ext));
  if (namespaceFileExt) {
    // {dir}/{locale}/{ns}.{json,ts,js}
    const locale = parts[0];
    const namespace = parts[1].slice(0, -namespaceFileExt.length);
    if (locale && namespace) return { locale, namespace };
  }
  return null;
}

/**
 * Parse locale from app/{locale}/messages/{file}.json paths.
 */
function parseAppRouterLocale(filePath: string, appDir: string): string | null {
  const rel = filePath.startsWith(`${appDir}/`) ? filePath.slice(appDir.length + 1) : null;
  if (!rel) return null;
  const parts = rel.split('/');
  if (parts.length === 3 && parts[1] === 'messages' && parts[2].endsWith('.json')) {
    return parts[0];
  }
  return null;
}

export async function resolveI18nByDomText(
  domText: string,
  projectRoot: string,
  fileIO: Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] },
): Promise<DomTextI18nMatch | null> {
  if (!domText.trim()) return null;

  const listFiles = fileIO.listFiles?.bind(fileIO);

  // Collect candidate dictionaries with enough path context to derive locale metadata.
  const candidates: Array<{ filePath: string; dirPrefix: string; isAppRouter: boolean; kind: 'json' | 'ts' }> = [];

  if (listFiles) {
    for (const relDir of LOCALE_DIRS) {
      const dir = `${projectRoot}/${relDir}`;
      const files = await listFiles(dir, ['.json']).catch(() => [] as string[]);
      for (const f of files) candidates.push({ filePath: f, dirPrefix: dir, isAppRouter: false, kind: 'json' });
      const tsFiles = await listFiles(dir, ['.ts', '.js']).catch(() => [] as string[]);
      for (const f of tsFiles) candidates.push({ filePath: f, dirPrefix: dir, isAppRouter: false, kind: 'ts' });
    }
    for (const relPath of MERGED_FILE_CANDIDATES) {
      const filePath = `${projectRoot}/${relPath}`;
      try {
        await fileIO.access(filePath);
        candidates.push({ filePath, dirPrefix: projectRoot, isAppRouter: false, kind: 'ts' });
      } catch {
        // not found
      }
    }
    // App Router: app/{locale}/messages/*.json
    const appDir = `${projectRoot}/app`;
    const appFiles = await listFiles(appDir, ['.json']).catch(() => [] as string[]);
    for (const f of appFiles) {
      const parts = f.slice(appDir.length + 1).split('/');
      if (parts.length === 3 && parts[1] === 'messages') {
        candidates.push({ filePath: f, dirPrefix: appDir, isAppRouter: true, kind: 'json' });
      }
    }
  } else {
    // No listFiles: probe well-known paths for active locale
    for (const relDir of LOCALE_DIRS) {
      const dir = `${projectRoot}/${relDir}`;
      for (const ext of ['.json']) {
        for (const locale of ['en', 'de', 'fr', 'es', 'ru', 'pl', 'zh', 'ja', 'pt']) {
          const f = `${dir}/${locale}${ext}`;
          try {
            await fileIO.access(f);
            candidates.push({ filePath: f, dirPrefix: dir, isAppRouter: false, kind: 'json' });
          } catch {
            // not found
          }
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Search candidates — two passes: value then key
  interface Hit {
    key: string;
    locale: string;
    namespace?: string;
    resolvedText: string;
    matchType: 'value' | 'key';
  }
  const hits: Hit[] = [];

  for (const { filePath, dirPrefix, isAppRouter, kind } of candidates) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
      continue;
    }

    if (kind === 'ts') {
      const parsed = parseTsLocaleObject(content);
      if (!parsed) continue;
      const info = parseLocaleFromPath(filePath, dirPrefix);
      const hit = findTsDomTextHit(parsed, domText, filePath, info?.locale);
      if (hit) {
        hits.push({
          key: hit.key,
          locale: hit.locale,
          resolvedText: hit.resolvedText,
          matchType: hit.matchType,
        });
      }
      continue;
    }

    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }

    const info = isAppRouter
      ? (() => {
          const appDir = dirPrefix;
          const locale = parseAppRouterLocale(filePath, appDir);
          return locale ? { locale, namespace: undefined } : null;
        })()
      : parseLocaleFromPath(filePath, dirPrefix);

    if (!info) continue;

    // Pass 1: value search
    const keyByValue = findByValue(data, domText);
    if (keyByValue !== null) {
      hits.push({
        key: keyByValue,
        locale: info.locale,
        namespace: info.namespace,
        resolvedText: domText,
        matchType: 'value',
      });
      continue;
    }

    // Pass 2: key search (domText IS the key — mock/passthrough pattern)
    const valueByKey = findByKey(data, domText);
    if (valueByKey !== null) {
      hits.push({
        key: domText,
        locale: info.locale,
        namespace: info.namespace,
        resolvedText: valueByKey,
        matchType: 'key',
      });
    }
  }

  if (hits.length === 0) return null;

  // Prefer value matches over key matches, then prefer 'en' locale
  hits.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'value' ? -1 : 1;
    if (a.locale === 'en' && b.locale !== 'en') return -1;
    if (b.locale === 'en' && a.locale !== 'en') return 1;
    return 0;
  });

  const best = hits[0];

  // Second pass: find all locales that contain the same key (even if their value wasn't the search term).
  // This fills availableLocales for multi-locale projects where the DOM showed only one locale's text.
  const extraLocales: string[] = [];
  for (const { filePath, dirPrefix, isAppRouter, kind } of candidates) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
      continue;
    }
    if (kind === 'ts') {
      const parsed = parseTsLocaleObject(content);
      if (!parsed) continue;
      if (parsed.kind === 'merged') {
        for (const locale of parsed.locales) {
          if (resolveLocaleKey(parsed.data[locale], best.key) !== null) extraLocales.push(locale);
        }
      } else if (resolveLocaleKey(parsed.data, best.key) !== null) {
        const info = parseLocaleFromPath(filePath, dirPrefix);
        extraLocales.push(info?.locale ?? best.locale);
      }
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }
    const info = isAppRouter
      ? (() => {
          const locale = parseAppRouterLocale(filePath, dirPrefix);
          return locale ? { locale, namespace: undefined } : null;
        })()
      : parseLocaleFromPath(filePath, dirPrefix);
    if (!info) continue;
    if (info.namespace !== best.namespace) continue;
    // Check if this locale has the same key
    const val = findByKey(data, best.key);
    if (val !== null) extraLocales.push(info.locale);
  }

  const availableLocales = [...new Set([...hits.map((h) => h.locale), ...extraLocales])];

  return {
    key: best.key,
    locale: best.locale,
    resolvedText: best.resolvedText,
    namespace: best.namespace,
    availableLocales,
    matchType: best.matchType,
  };
}
