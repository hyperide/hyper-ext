/**
 * @file i18n key resolution by DOM text content.
 *
 * Accessed via: StyleReadService._tryDetectI18n (fallback when AST detection fails)
 * Assumptions: locale files are JSON; project uses one of the well-known directory layouts.
 *
 * Algorithm:
 *   1. List all .json files in known locale directories.
 *   2. Search each file for domText as a VALUE → extract the dot-path key.
 *   3. If not found as value, search for domText as a KEY (covers mock/passthrough t = k => k).
 *   4. Derive locale and namespace from the file path.
 *   5. Collect all matching locale files → availableLocales.
 */

import type { FileIO } from '../../lib/ast/file-io';

/** Locale directories probed in priority order. */
const LOCALE_DIRS = ['locales', 'public/locales', 'src/i18n', 'src/locales', 'messages'];

export interface DomTextI18nMatch {
  key: string;
  /** The locale where the match was first found. */
  locale: string;
  /** The resolved text value in that locale. */
  resolvedText: string;
  namespace?: string;
  availableLocales: string[];
  /** 'value' = domText was a JSON value; 'key' = domText was the key itself (passthrough mock). */
  matchType: 'value' | 'key';
}

/**
 * Recursively find domText as a JSON VALUE.
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
 * Check if target is a valid key in the JSON object (exact literal key, or dot-path traversal).
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
 *   {dir}/{locale}.json          → locale=locale, namespace=undefined
 *   {dir}/{locale}/{ns}.json     → locale=locale, namespace=ns
 *   {root}/app/{locale}/messages/{file}.json → locale=locale, namespace=undefined
 */
function parseLocaleFromPath(filePath: string, dirPrefix: string): { locale: string; namespace?: string } | null {
  const rel = filePath.startsWith(`${dirPrefix}/`) ? filePath.slice(dirPrefix.length + 1) : null;
  if (!rel) return null;
  const parts = rel.split('/');

  if (parts.length === 1 && parts[0].endsWith('.json')) {
    // {dir}/{locale}.json
    const locale = parts[0].slice(0, -5);
    if (locale) return { locale };
  }
  if (parts.length === 2 && parts[1].endsWith('.json')) {
    // {dir}/{locale}/{ns}.json
    const locale = parts[0];
    const namespace = parts[1].slice(0, -5);
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

  // Collect all candidate JSON files with their dir prefix
  const candidates: Array<{ filePath: string; dirPrefix: string; isAppRouter: boolean }> = [];

  if (listFiles) {
    for (const relDir of LOCALE_DIRS) {
      const dir = `${projectRoot}/${relDir}`;
      const files = await listFiles(dir, ['.json']).catch(() => [] as string[]);
      for (const f of files) candidates.push({ filePath: f, dirPrefix: dir, isAppRouter: false });
    }
    // App Router: app/{locale}/messages/*.json
    const appDir = `${projectRoot}/app`;
    const appFiles = await listFiles(appDir, ['.json']).catch(() => [] as string[]);
    for (const f of appFiles) {
      const parts = f.slice(appDir.length + 1).split('/');
      if (parts.length === 3 && parts[1] === 'messages') {
        candidates.push({ filePath: f, dirPrefix: appDir, isAppRouter: true });
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
            candidates.push({ filePath: f, dirPrefix: dir, isAppRouter: false });
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

  for (const { filePath, dirPrefix, isAppRouter } of candidates) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
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
  for (const { filePath, dirPrefix, isAppRouter } of candidates) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
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
