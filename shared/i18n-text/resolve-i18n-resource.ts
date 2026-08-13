/**
 * @file Locale resource resolution for i18n text inspection.
 *
 * Accessed via: SaaS inspector (useElementStyleData) and VS Code extension (StyleReadService)
 * Assumptions: pure logic, host I/O is injected via FileIO adapter
 */

import type { FileIO } from '../../lib/ast/file-io';
import { parseTsLocaleObject, resolveLocaleKey } from './ts-locale-ast';
import type { I18nLibrary, ResolveI18nResourceResult } from './types';

export interface ResolveI18nResourceParams {
  projectRoot: string;
  library: I18nLibrary;
  key: string;
  namespace?: string;
  activeLocale: string;
  fallbackLocale?: string;
  fileIO: Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] };
}

export interface Layout {
  getLocaleFilePath: (locale: string) => string;
  availableLocales: string[];
  /**
   * For merged single-file format: parsed locale data already in memory.
   * Shape: { [locale]: { [key]: string | nested object } }
   */
  mergedData?: Record<string, unknown>;
}

/**
 * Candidate file paths for merged single-file translation format
 * (a single TS/JS file exporting an object keyed by locale).
 */
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

/**
 * Try to discover a merged single-file translation layout
 * (e.g. `translations.ts` with `export const translations = { ru: {...}, en: {...} }`).
 * Returns a Layout with `mergedData` populated, or null if not found.
 */
async function discoverMergedLayout(
  projectRoot: string,
  fileIO: Pick<FileIO, 'readFile' | 'access'>,
): Promise<Layout | null> {
  for (const candidate of MERGED_FILE_CANDIDATES) {
    const filePath = `${projectRoot}/${candidate}`;
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
      continue;
    }
    const parsed = parseTsLocaleObject(content);
    if (!parsed || parsed.kind !== 'merged') continue;
    const locales = parsed.locales;
    if (locales.length === 0) continue;
    return {
      getLocaleFilePath: () => filePath,
      availableLocales: locales,
      mergedData: parsed.data,
    };
  }
  return null;
}

// Well-known flat locale directory layouts, tried in priority order.
// Exported so consumers like StyleReadService can reuse the same list without drift.
export const FLAT_LOCALE_DIRS = ['locales', 'public/locales', 'src/i18n', 'src/locales', 'messages'] as const;

export async function discoverLayout(
  projectRoot: string,
  namespace: string | undefined,
  activeLocale: string,
  fileIO: Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] },
): Promise<Layout | null> {
  const listFiles = fileIO.listFiles?.bind(fileIO);

  // Namespaced: {dir}/{locale}/{namespace}.json — same directory candidates as flat layout
  if (namespace) {
    for (const relDir of FLAT_LOCALE_DIRS) {
      const localesDir = `${projectRoot}/${relDir}`;
      if (listFiles) {
        const files = await listFiles(localesDir, ['.json']);
        const prefix = `${localesDir}/`;
        const suffix = `/${namespace}.json`;
        const locales: string[] = [];
        for (const f of files) {
          if (f.startsWith(prefix) && f.endsWith(suffix)) {
            const middle = f.slice(prefix.length, f.length - suffix.length);
            if (!middle.includes('/')) locales.push(middle);
          }
        }
        if (locales.length > 0) {
          return {
            getLocaleFilePath: (locale) => `${localesDir}/${locale}/${namespace}.json`,
            availableLocales: locales,
          };
        }
      } else {
        try {
          await fileIO.access(`${localesDir}/${activeLocale}/${namespace}.json`);
          return {
            getLocaleFilePath: (locale) => `${localesDir}/${locale}/${namespace}.json`,
            availableLocales: [activeLocale],
          };
        } catch {
          // try next directory
        }
      }
    }
  }

  // Flat layouts: {dir}/{locale}.json (or .ts/.js)
  for (const relDir of FLAT_LOCALE_DIRS) {
    const dir = `${projectRoot}/${relDir}`;
    const prefix = `${dir}/`;

    if (listFiles) {
      // JSON files (supported format)
      const jsonFiles = await listFiles(dir, ['.json']);
      const flatJson = jsonFiles.filter((f) => {
        const rel = f.slice(prefix.length);
        return !rel.includes('/') && rel.endsWith('.json');
      });
      if (flatJson.length > 0) {
        const locales = flatJson.map((f) => f.slice(prefix.length, f.length - '.json'.length));
        return {
          getLocaleFilePath: (locale) => `${dir}/${locale}.json`,
          availableLocales: locales,
        };
      }

      // TS/JS files — static object literals are writable via AST; dynamic modules
      // remain unsupported after resolveI18nResource attempts to parse them.
      const tsFiles = await listFiles(dir, ['.ts', '.js']);
      const flatTs = tsFiles.filter((f) => {
        const rel = f.slice(prefix.length);
        return !rel.includes('/') && (rel.endsWith('.ts') || rel.endsWith('.js'));
      });
      if (flatTs.length > 0) {
        const ext = flatTs[0].endsWith('.ts') ? '.ts' : '.js';
        const locales = flatTs.map((f) => {
          const rel = f.slice(prefix.length);
          return rel.slice(0, rel.lastIndexOf('.'));
        });
        return {
          getLocaleFilePath: (locale) => `${dir}/${locale}${ext}`,
          availableLocales: locales,
        };
      }
    } else {
      // No listFiles — probe active locale file directly
      for (const ext of ['.json', '.ts', '.js']) {
        try {
          await fileIO.access(`${dir}/${activeLocale}${ext}`);
          return {
            getLocaleFilePath: (locale) => `${dir}/${locale}${ext}`,
            availableLocales: [activeLocale],
          };
        } catch {
          // try next extension
        }
      }
    }
  }

  // App Router: app/{locale}/messages/*.json
  if (listFiles) {
    const appDir = `${projectRoot}/app`;
    const prefix = `${appDir}/`;
    const files = await listFiles(appDir, ['.json']);
    // Map locale → first discovered file path; Map deduplicates automatically.
    const localeFileMap = new Map<string, string>();
    for (const f of files) {
      const rel = f.slice(prefix.length);
      const parts = rel.split('/');
      if (parts.length === 3 && parts[1] === 'messages' && parts[2].endsWith('.json')) {
        if (!localeFileMap.has(parts[0])) localeFileMap.set(parts[0], f);
      }
    }
    if (localeFileMap.size > 0) {
      // Derive the JSON filename (e.g. "messages.json") from discovered entries so the
      // fallback path for unknown locales matches the project's actual convention.
      const firstDiscoveredPath = localeFileMap.values().next().value as string;
      const discoveredFilename = firstDiscoveredPath.slice(firstDiscoveredPath.lastIndexOf('/') + 1);
      return {
        getLocaleFilePath: (locale) =>
          localeFileMap.get(locale) ?? `${appDir}/${locale}/messages/${discoveredFilename}`,
        availableLocales: Array.from(localeFileMap.keys()),
      };
    }
  }

  // Merged single-file format (last resort — only when no structured layout was found).
  // Handles projects like Bulka where translations live in a single file keyed by locale:
  //   export const translations = { ru: {...}, en: {...}, rs: {...} }
  if (!namespace) {
    const merged = await discoverMergedLayout(projectRoot, fileIO);
    if (merged) return merged;
  }

  return null;
}

function resolveKey(data: unknown, key: string): string | null {
  if (typeof data !== 'object' || data === null) return null;
  const obj = data as Record<string, unknown>;

  // Literal key first — handles keys that contain dots (e.g. "habits.walks" stored flat)
  if (Object.hasOwn(obj, key)) {
    const val = obj[key];
    return typeof val === 'string' ? val : null;
  }

  // Dot-path traversal for nested objects
  const parts = key.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== 'object' || current === null) return null;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === 'string' ? current : null;
}

export async function resolveI18nResource(params: ResolveI18nResourceParams): Promise<ResolveI18nResourceResult> {
  const { projectRoot, key, namespace, activeLocale, fallbackLocale, fileIO } = params;

  const layout = await discoverLayout(projectRoot, namespace, activeLocale, fileIO);

  if (!layout) {
    return {
      availableLocales: [],
      activeLocale,
      resolvedText: null,
      unresolvedReason: 'missing-locale-file',
      writable: false,
    };
  }

  const { getLocaleFilePath, availableLocales, mergedData } = layout;

  // Merged single-file format (translations.ts): data already parsed, no file I/O needed.
  if (mergedData) {
    const localeData = mergedData[activeLocale] ?? (fallbackLocale ? mergedData[fallbackLocale] : undefined);
    const effectiveLocale = mergedData[activeLocale] !== undefined ? activeLocale : (fallbackLocale ?? activeLocale);
    if (!localeData) {
      return {
        availableLocales,
        activeLocale: effectiveLocale,
        resolvedText: null,
        unresolvedReason: 'missing-locale-file',
        writable: true,
      };
    }
    const resolvedText = resolveKey(localeData, key);
    if (resolvedText === null) {
      return {
        availableLocales,
        activeLocale: effectiveLocale,
        resolvedText: null,
        unresolvedReason: 'missing-key',
        writable: true,
      };
    }
    return { availableLocales, activeLocale: effectiveLocale, resolvedText, writable: true };
  }

  // Static TS/JS object-literal locale files are writable via AST.
  const activeFilePath = getLocaleFilePath(activeLocale);
  if (activeFilePath.endsWith('.ts') || activeFilePath.endsWith('.js')) {
    let content: string;
    try {
      content = await fileIO.readFile(activeFilePath);
    } catch {
      return {
        availableLocales,
        activeLocale,
        resolvedText: null,
        unresolvedReason: 'missing-locale-file',
        writable: false,
      };
    }
    const parsed = parseTsLocaleObject(content, activeLocale);
    if (parsed) {
      const localeData = parsed.kind === 'merged' ? parsed.data[activeLocale] : parsed.data;
      const resolvedText = resolveLocaleKey(localeData, key);
      if (resolvedText === null) {
        return {
          availableLocales: parsed.kind === 'merged' ? parsed.locales : availableLocales,
          activeLocale,
          resolvedText: null,
          unresolvedReason: 'missing-key',
          writable: true,
        };
      }
      return {
        availableLocales: parsed.kind === 'merged' ? parsed.locales : availableLocales,
        activeLocale,
        resolvedText,
        writable: true,
      };
    }
    return {
      availableLocales,
      activeLocale,
      resolvedText: null,
      unresolvedReason: 'unsupported-format',
      writable: false,
    };
  }

  // Read active locale file, fall back if needed
  let content: string | null = null;
  let effectiveLocale = activeLocale;

  try {
    content = await fileIO.readFile(activeFilePath);
  } catch {
    if (fallbackLocale) {
      const fallbackPath = getLocaleFilePath(fallbackLocale);
      if (!fallbackPath.endsWith('.ts') && !fallbackPath.endsWith('.js')) {
        try {
          content = await fileIO.readFile(fallbackPath);
          effectiveLocale = fallbackLocale;
        } catch {
          // both failed
        }
      }
    }
  }

  if (content === null) {
    return {
      availableLocales,
      activeLocale,
      resolvedText: null,
      unresolvedReason: 'missing-locale-file',
      writable: false,
    };
  }

  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    // Corrupt JSON — `writeI18nResource` refuses (`parse-error`), so not writable.
    return {
      availableLocales,
      activeLocale: effectiveLocale,
      resolvedText: null,
      unresolvedReason: 'parse-error',
      writable: false,
    };
  }

  const resolvedText = resolveKey(data, key);

  // JSON layouts: the file exists and parses, so writes (including missing-key) succeed.
  if (resolvedText === null) {
    return {
      availableLocales,
      activeLocale: effectiveLocale,
      resolvedText: null,
      unresolvedReason: 'missing-key',
      writable: true,
    };
  }

  return { availableLocales, activeLocale: effectiveLocale, resolvedText, writable: true };
}
