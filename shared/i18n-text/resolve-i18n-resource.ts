/**
 * @file Locale resource resolution for i18n text inspection.
 *
 * Accessed via: SaaS inspector (useElementStyleData) and VS Code extension (StyleReadService)
 * Assumptions: pure logic, host I/O is injected via FileIO adapter
 */

import type { FileIO } from '../../lib/ast/file-io';
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

interface Layout {
  getLocaleFilePath: (locale: string) => string;
  availableLocales: string[];
}

// Well-known flat locale directory layouts, tried in priority order.
const FLAT_LOCALE_DIRS = ['locales', 'src/i18n', 'messages'];

async function discoverLayout(
  projectRoot: string,
  namespace: string | undefined,
  activeLocale: string,
  fileIO: Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] },
): Promise<Layout | null> {
  const listFiles = fileIO.listFiles?.bind(fileIO);

  // Namespaced: locales/{locale}/{namespace}.json
  if (namespace) {
    const localesDir = `${projectRoot}/locales`;
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
        // namespace layout not found, fall through
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

      // TS/JS files (unsupported format — detect so we can return a precise error)
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

  // App Router: app/{locale}/messages/{locale}.json
  if (listFiles) {
    const appDir = `${projectRoot}/app`;
    const prefix = `${appDir}/`;
    const files = await listFiles(appDir, ['.json']);
    const appLocales: string[] = [];
    for (const f of files) {
      const rel = f.slice(prefix.length);
      const parts = rel.split('/');
      if (parts.length === 3 && parts[1] === 'messages' && parts[2].endsWith('.json')) {
        appLocales.push(parts[0]);
      }
    }
    if (appLocales.length > 0) {
      return {
        getLocaleFilePath: (locale) => `${appDir}/${locale}/messages/${locale}.json`,
        availableLocales: appLocales,
      };
    }
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
    return { availableLocales: [], activeLocale, resolvedText: null, unresolvedReason: 'missing-locale-file' };
  }

  const { getLocaleFilePath, availableLocales } = layout;

  // Detect unsupported format (TS/JS) before attempting to read
  const activeFilePath = getLocaleFilePath(activeLocale);
  if (activeFilePath.endsWith('.ts') || activeFilePath.endsWith('.js')) {
    return { availableLocales, activeLocale, resolvedText: null, unresolvedReason: 'unsupported-format' };
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
    return { availableLocales, activeLocale, resolvedText: null, unresolvedReason: 'missing-locale-file' };
  }

  // Parse JSON
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { availableLocales, activeLocale: effectiveLocale, resolvedText: null, unresolvedReason: 'parse-error' };
  }

  const resolvedText = resolveKey(data, key);

  if (resolvedText === null) {
    return { availableLocales, activeLocale: effectiveLocale, resolvedText: null, unresolvedReason: 'missing-key' };
  }

  return { availableLocales, activeLocale: effectiveLocale, resolvedText };
}
