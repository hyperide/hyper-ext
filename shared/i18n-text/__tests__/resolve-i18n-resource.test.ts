/**
 * @file Failing tests for locale resource resolution.
 *
 * Tests must fail until Task 7 implements resolve-i18n-resource.ts.
 * Uses in-memory FileIO so no real filesystem access is needed.
 */

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../../lib/ast/file-io';
import { resolveI18nResource } from '../resolve-i18n-resource';

// ---------------------------------------------------------------------------
// In-memory FileIO fixture helper
// ---------------------------------------------------------------------------

class MemoryFileIO implements FileIO {
  private files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }

  async readFile(absolutePath: string): Promise<string> {
    const content = this.files.get(absolutePath);
    if (content == null) throw new Error(`ENOENT: ${absolutePath}`);
    return content;
  }

  async writeFile(absolutePath: string, content: string): Promise<void> {
    this.files.set(absolutePath, content);
  }

  async access(absolutePath: string): Promise<void> {
    if (!this.files.has(absolutePath)) throw new Error(`ENOENT: ${absolutePath}`);
  }

  async listFiles(dirPath: string, extensions?: string[]): Promise<string[]> {
    const results: string[] = [];
    for (const path of this.files.keys()) {
      if (path.startsWith(`${dirPath}/`) || path === dirPath) {
        if (!extensions || extensions.some((ext) => path.endsWith(ext))) {
          results.push(path);
        }
      }
    }
    return results;
  }
}

const ROOT = '/project';

// ---------------------------------------------------------------------------
// Layout: locales/en.json (most common react-i18next layout)
// ---------------------------------------------------------------------------

describe('locales/en.json layout — react-i18next', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello', 'habits.walks': 'Go for walks' }),
    [`${ROOT}/locales/de.json`]: JSON.stringify({ greeting: 'Hallo', 'habits.walks': 'Spazieren gehen' }),
  });

  it('resolves a flat key from active locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hello');
    expect(result.activeLocale).toBe('en');
  });

  it('resolves habits.walks key from active locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'habits.walks',
      activeLocale: 'de',
      fileIO,
    });
    expect(result.resolvedText).toBe('Spazieren gehen');
    expect(result.activeLocale).toBe('de');
  });

  it('returns available locales discovered from the directory', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.availableLocales.sort()).toEqual(['de', 'en']);
  });

  it('returns missing-key reason for unknown key', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'nonexistent.key',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBeNull();
    expect(result.unresolvedReason).toBe('missing-key');
  });
});

// ---------------------------------------------------------------------------
// Layout: src/i18n/en.json
// ---------------------------------------------------------------------------

describe('src/i18n/en.json layout', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/src/i18n/en.json`]: JSON.stringify({ hello: 'Hello world' }),
    [`${ROOT}/src/i18n/fr.json`]: JSON.stringify({ hello: 'Bonjour le monde' }),
  });

  it('resolves a key from src/i18n layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'hello',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hello world');
  });

  it('returns both locales from src/i18n layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'hello',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.availableLocales.sort()).toEqual(['en', 'fr']);
  });
});

// ---------------------------------------------------------------------------
// Layout: messages/en.json (next-intl style)
// ---------------------------------------------------------------------------

describe('messages/en.json layout — next-intl', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/messages/en.json`]: JSON.stringify({ title: 'Welcome', nested: { greeting: 'Hi there' } }),
    [`${ROOT}/messages/pl.json`]: JSON.stringify({ title: 'Witaj', nested: { greeting: 'Cześć' } }),
  });

  it('resolves a flat key from messages layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'title',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Welcome');
  });

  it('resolves nested dot-notation key', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'nested.greeting',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hi there');
  });

  it('resolves nested dot-notation key in different locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'nested.greeting',
      activeLocale: 'pl',
      fileIO,
    });
    expect(result.resolvedText).toBe('Cześć');
  });
});

// ---------------------------------------------------------------------------
// Fallback locale
// ---------------------------------------------------------------------------

describe('fallback locale', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    // 'es' locale file does not exist
  });

  it('falls back to fallbackLocale when activeLocale file is missing', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'es',
      fallbackLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hello');
    expect(result.activeLocale).toBe('en');
  });

  it('returns missing-locale-file when neither active nor fallback exist', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'es',
      fallbackLocale: 'ru',
      fileIO,
    });
    expect(result.resolvedText).toBeNull();
    expect(result.unresolvedReason).toBe('missing-locale-file');
  });
});

// ---------------------------------------------------------------------------
// Layout: app/[locale]/messages/en.json (Next.js App Router)
// ---------------------------------------------------------------------------

describe('app/[locale]/messages layout — next-intl App Router', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/app/en/messages/en.json`]: JSON.stringify({ page: { title: 'Home' } }),
    [`${ROOT}/app/de/messages/de.json`]: JSON.stringify({ page: { title: 'Startseite' } }),
  });

  it('resolves nested dot key from app/[locale] layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'page.title',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Home');
  });

  it('resolves the same key for a non-primary locale (de)', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'page.title',
      activeLocale: 'de',
      fileIO,
    });
    expect(result.resolvedText).toBe('Startseite');
  });
});

describe('app/[locale]/messages layout — non-locale filename (e.g. messages.json)', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/app/en/messages/messages.json`]: JSON.stringify({ page: { title: 'Home' } }),
    [`${ROOT}/app/de/messages/messages.json`]: JSON.stringify({ page: { title: 'Startseite' } }),
  });

  it('resolves key when filename differs from locale code', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'page.title',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Home');
  });

  it('does not duplicate locales when multiple json files exist per locale', async () => {
    const multiFileIO = new MemoryFileIO({
      [`${ROOT}/app/en/messages/common.json`]: JSON.stringify({ greeting: 'Hello' }),
      [`${ROOT}/app/en/messages/errors.json`]: JSON.stringify({ notFound: 'Not found' }),
    });
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'greeting',
      activeLocale: 'en',
      fileIO: multiFileIO,
    });
    expect(result.availableLocales.filter((l) => l === 'en').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Namespace support: locales/en/common.json
// ---------------------------------------------------------------------------

describe('namespaced layout — locales/en/common.json', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/locales/en/common.json`]: JSON.stringify({ button: { save: 'Save', cancel: 'Cancel' } }),
    [`${ROOT}/locales/de/common.json`]: JSON.stringify({ button: { save: 'Speichern', cancel: 'Abbrechen' } }),
  });

  it('resolves a key from namespaced common namespace', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'button.save',
      namespace: 'common',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Save');
  });

  it('resolves a key from namespaced common namespace in different locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'button.save',
      namespace: 'common',
      activeLocale: 'de',
      fileIO,
    });
    expect(result.resolvedText).toBe('Speichern');
  });

  it('returns available locales for namespaced layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'button.save',
      namespace: 'common',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.availableLocales.sort()).toEqual(['de', 'en']);
  });
});

// ---------------------------------------------------------------------------
// Layout: public/locales/en.json (next-i18next flat — most common missing layout)
// ---------------------------------------------------------------------------

describe('public/locales/en.json layout — next-i18next flat', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/public/locales/en.json`]: JSON.stringify({
      conditions: { communication: 'Communication policy' },
      greeting: 'Hello',
    }),
    [`${ROOT}/public/locales/ru.json`]: JSON.stringify({
      conditions: { communication: 'Политика коммуникаций' },
      greeting: 'Привет',
    }),
  });

  it('resolves a dot-path key from public/locales flat layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'conditions.communication',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Communication policy');
    expect(result.availableLocales.sort()).toEqual(['en', 'ru']);
  });

  it('resolves the same key in Russian locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'conditions.communication',
      activeLocale: 'ru',
      fileIO,
    });
    expect(result.resolvedText).toBe('Политика коммуникаций');
  });
});

// ---------------------------------------------------------------------------
// Layout: public/locales/en/common.json (next-i18next namespaced)
// ---------------------------------------------------------------------------

describe('public/locales/en/common.json layout — next-i18next namespaced', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/public/locales/en/common.json`]: JSON.stringify({
      conditions: { communication: 'Communication policy' },
    }),
    [`${ROOT}/public/locales/fr/common.json`]: JSON.stringify({
      conditions: { communication: 'Politique de communication' },
    }),
  });

  it('resolves a namespaced dot-path key', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'conditions.communication',
      namespace: 'common',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Communication policy');
    expect(result.availableLocales.sort()).toEqual(['en', 'fr']);
  });

  it('resolves in non-primary locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'conditions.communication',
      namespace: 'common',
      activeLocale: 'fr',
      fileIO,
    });
    expect(result.resolvedText).toBe('Politique de communication');
  });
});

// ---------------------------------------------------------------------------
// Layout: src/locales/en.json
// ---------------------------------------------------------------------------

describe('src/locales/en.json layout', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/src/locales/en.json`]: JSON.stringify({ hello: 'Hello from src/locales' }),
    [`${ROOT}/src/locales/de.json`]: JSON.stringify({ hello: 'Hallo aus src/locales' }),
  });

  it('resolves a key from src/locales layout', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'hello',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hello from src/locales');
    expect(result.availableLocales.sort()).toEqual(['de', 'en']);
  });
});

// ---------------------------------------------------------------------------
// messages/en.ts — TypeScript export
// ---------------------------------------------------------------------------

describe('messages/en.ts — TS object-literal format', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/messages/en.ts`]: `export default { greeting: 'Hello from TS' } as const;`,
  });

  it('resolves static TS locale files', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hello from TS');
    expect(result.writable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Malformed JSON — parse-error path
// ---------------------------------------------------------------------------

describe('malformed JSON locale file', () => {
  it('returns parse-error unresolvedReason for corrupt JSON', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: '{ "greeting": "Hello"',
    });

    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });

    expect(result.resolvedText).toBeNull();
    expect(result.unresolvedReason).toBe('parse-error');
  });
});

describe('unreadable existing locale file', () => {
  it('marks resource non-writable when the locale file exists but cannot be read', async () => {
    class UnreadableFileIO extends MemoryFileIO {
      override async readFile(absolutePath: string): Promise<string> {
        if (absolutePath.endsWith('/locales/en.json')) {
          throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
        }
        return super.readFile(absolutePath);
      }
    }

    const fileIO = new UnreadableFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    });

    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });

    expect(result.resolvedText).toBeNull();
    expect(result.writable).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Real-filesystem: Bulka project — merged single-file translations.ts
// ---------------------------------------------------------------------------

const BULKA_ROOT = '/Users/ultra/work/ext-test-projects/bulka-the-dog';
describe.skipIf(!existsSync(BULKA_ROOT))('Bulka project — real client/lib/translations.ts', () => {
  const realFileIO = {
    async readFile(path: string): Promise<string> {
      const { readFile } = await import('node:fs/promises');
      return readFile(path, 'utf8');
    },
    async access(path: string): Promise<void> {
      const { access } = await import('node:fs/promises');
      await access(path);
    },
  };

  it('resolves brand.name in "en" locale to "Bulka"', async () => {
    const result = await resolveI18nResource({
      projectRoot: BULKA_ROOT,
      library: 'custom',
      key: 'brand.name',
      activeLocale: 'en',
      fileIO: realFileIO,
    });
    expect(result.resolvedText).toBe('Bulka');
    expect(result.availableLocales).toContain('en');
    expect(result.availableLocales).toContain('ru');
    expect(result.availableLocales).toContain('rs');
  });

  it('resolves brand.name in "ru" locale to "Булка"', async () => {
    const result = await resolveI18nResource({
      projectRoot: BULKA_ROOT,
      library: 'custom',
      key: 'brand.name',
      activeLocale: 'ru',
      fileIO: realFileIO,
    });
    expect(result.resolvedText).toBe('Булка');
  });

  it('marks writable=true for resolved key in merged translations.ts', async () => {
    const result = await resolveI18nResource({
      projectRoot: BULKA_ROOT,
      library: 'custom',
      key: 'brand.name',
      activeLocale: 'en',
      fileIO: realFileIO,
    });
    expect(result.resolvedText).toBe('Bulka');
    expect(result.writable).toBe(true);
  });

  it('marks writable=true for missing key in merged translations.ts', async () => {
    const result = await resolveI18nResource({
      projectRoot: BULKA_ROOT,
      library: 'custom',
      key: 'nonexistent.key.path',
      activeLocale: 'en',
      fileIO: realFileIO,
    });
    expect(result.resolvedText).toBeNull();
    expect(result.unresolvedReason).toBe('missing-key');
    expect(result.writable).toBe(true);
  });
});

describe('i18n/ aggregator index.ts is not a locale named "index"', () => {
  // The shared LOCALE_DIRS now includes `i18n`. A project whose i18n/ holds only an
  // aggregator `index.ts` (re-exporting per-locale modules) must NOT be mistaken for a
  // locale file `index.ts`. The real translations live in a merged file and should win.
  const fileIO = new MemoryFileIO({
    [`${ROOT}/i18n/index.ts`]: 'export const x = 1;',
    [`${ROOT}/src/translations.ts`]: `export const translations = { en: { greeting: 'Hello' }, de: { greeting: 'Hallo' } };`,
  });

  it('resolves from the merged file, not a bogus "index" locale', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'custom',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBe('Hello');
    expect(result.availableLocales.sort()).toEqual(['de', 'en']);
    expect(result.availableLocales).not.toContain('index');
  });
});
