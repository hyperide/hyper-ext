/**
 * @file TsMergedAdapter + AdapterFactory tests against bulka-the-dog merged translations.ts shape.
 *
 * Accessed via: bun test
 * Assumptions: bulka exports `translations = { ru: {...}, rs: {...}, en: {...} }`
 *   from `client/lib/translations.ts`. Plan Task 2 — confirm adapter selection
 *   and that getAvailableKeys / resolveText return non-empty results, ruling out
 *   hypothesis C ("getAvailableKeys returns []").
 *
 * Note: the user-visible regression (`editable: false` for merged-TS layouts in
 *   bulka) has root cause `writable: false` in `resolve-i18n-resource.ts`'s
 *   mergedData branch. That dimension is NOT covered end-to-end by these
 *   adapter unit tests — it requires a StyleReadService-level test that
 *   threads through `resolveI18nResource`. See plan Follow-up.
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '@lib/ast/file-io';
import type { I18nTextBinding } from '@shared/i18n-text/types';
import { AdapterFactory } from '../AdapterFactory';
import { TsMergedAdapter } from '../TsMergedAdapter';

// Single source of truth for the bulka-shape fixture. Used both as a TS source
// (for AdapterFactory file-IO tests) and as a JS object (for adapter unit tests).
const BULKA_MERGED = {
  ru: {
    brand: { name: 'Булка' },
    hero: { question: 'Вы потеряли собаку?', cta: 'Помочь' },
    faq: { title: 'Вопросы' },
    nav: { appearance: 'Внешний вид' },
  },
  rs: {
    brand: { name: 'Bulka' },
    hero: { question: 'Da li ste izgubili psa?', cta: 'Pomozi' },
    faq: { title: 'Pitanja' },
    nav: { appearance: 'Izgled' },
  },
  en: {
    brand: { name: 'Bulka' },
    hero: { question: 'Did you lose a dog?', cta: 'Help' },
    faq: { title: 'Questions' },
    nav: { appearance: 'Appearance' },
  },
} as const;

const BULKA_LOCALES = ['ru', 'rs', 'en'] as const;

const BULKA_TRANSLATIONS_TS = `export const translations = ${JSON.stringify(BULKA_MERGED, null, 2)};\n`;

const ROOT = '/workspace';
const BULKA_PATH = `${ROOT}/client/lib/translations.ts`;

function makeFileIO(files: Record<string, string>): FileIO {
  return {
    readFile: async (path: string) => {
      const content = files[path];
      if (content === undefined) throw new Error(`ENOENT: ${path}`);
      return content;
    },
    writeFile: async () => {},
    access: async (path: string) => {
      if (!(path in files)) throw new Error(`ENOENT: ${path}`);
    },
    listFiles: async (dirPath: string, extensions?: string[]) => {
      const results: string[] = [];
      for (const path of Object.keys(files)) {
        if (path.startsWith(`${dirPath}/`)) {
          if (!extensions || extensions.some((ext) => path.endsWith(ext))) {
            results.push(path);
          }
        }
      }
      return results;
    },
  };
}

function stubBinding(): I18nTextBinding {
  return {
    kind: 'i18n',
    library: 'custom',
    key: '',
    activeLocale: 'en',
    availableLocales: [],
    resolvedText: null,
    editable: false,
    writable: false,
    sourceLocation: { filePath: '', line: 0, column: 0 },
  };
}

describe('AdapterFactory — bulka merged translations.ts', () => {
  it('selects TsMergedAdapter when project has merged translations.ts', async () => {
    const fileIO = makeFileIO({ [BULKA_PATH]: BULKA_TRANSLATIONS_TS });
    const factory = new AdapterFactory(ROOT, fileIO);
    const adapter = await factory.forBinding(stubBinding(), 'en');
    expect(adapter).toBeInstanceOf(TsMergedAdapter);
  });
});

describe('TsMergedAdapter on bulka-shape data', () => {
  function bulkaAdapter(): TsMergedAdapter {
    return new TsMergedAdapter(structuredClone(BULKA_MERGED) as Record<string, unknown>, [...BULKA_LOCALES]);
  }

  it('getAvailableKeys returns non-empty dot-path leaf keys for active locale', async () => {
    const adapter = bulkaAdapter();
    const keys = await adapter.getAvailableKeys('en');
    expect(keys.length).toBeGreaterThan(0);
    expect(keys).toContain('hero.question');
    expect(keys).toContain('faq.title');
    expect(keys).toContain('brand.name');
    expect(keys).toContain('nav.appearance');
  });

  it('getAvailableKeys returns same key set across locales (parallel structure)', async () => {
    const adapter = bulkaAdapter();
    const enKeys = (await adapter.getAvailableKeys('en')).sort();
    const ruKeys = (await adapter.getAvailableKeys('ru')).sort();
    expect(ruKeys).toEqual(enKeys);
  });

  it('getAvailableKeys falls back to availableLocales[0] when requested locale is absent', async () => {
    // Asymmetric fixture so the fallback's locale identity is provable, not
    // just "some non-empty result". 'ru' has a key 'only_ru'; en/rs do not.
    const merged = {
      ru: { only_ru: 'значение', shared: { key: 'общий' } },
      en: { shared: { key: 'shared' } },
    };
    const adapter = new TsMergedAdapter(merged, ['ru', 'en']);
    const keys = await adapter.getAvailableKeys('de');
    expect(keys).toContain('only_ru');
  });

  it('resolveText returns the translated value for hero.question in en', async () => {
    const adapter = bulkaAdapter();
    const text = await adapter.resolveText('hero.question', 'en');
    expect(text).toBe('Did you lose a dog?');
  });

  it('resolveText returns the translated value for hero.question in ru', async () => {
    const adapter = bulkaAdapter();
    const text = await adapter.resolveText('hero.question', 'ru');
    expect(text).toBe('Вы потеряли собаку?');
  });

  it('resolveText returns null for missing key', async () => {
    const adapter = bulkaAdapter();
    const text = await adapter.resolveText('does.not.exist', 'en');
    expect(text).toBeNull();
  });

  it('resolveText returns null when key path lands on an object (not a leaf string)', async () => {
    const adapter = bulkaAdapter();
    const text = await adapter.resolveText('hero', 'en');
    expect(text).toBeNull();
  });
});

describe('AdapterFactory + TsMergedAdapter end-to-end (file I/O)', () => {
  it('end-to-end: factory + adapter resolve hero.question from translations.ts source', async () => {
    const fileIO = makeFileIO({ [BULKA_PATH]: BULKA_TRANSLATIONS_TS });
    const adapter = await new AdapterFactory(ROOT, fileIO).forBinding(stubBinding(), 'en');
    const keys = await adapter.getAvailableKeys('en');
    const text = await adapter.resolveText('hero.question', 'en');
    expect(keys).toContain('hero.question');
    expect(text).toBe('Did you lose a dog?');
  });
});
