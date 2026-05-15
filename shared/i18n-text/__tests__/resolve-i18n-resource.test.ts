/**
 * @file Failing tests for locale resource resolution.
 *
 * Tests must fail until Task 7 implements resolve-i18n-resource.ts.
 * Uses in-memory FileIO so no real filesystem access is needed.
 */

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
// messages/en.ts — TypeScript export (unsupported format)
// ---------------------------------------------------------------------------

describe('messages/en.ts — unsupported TS format', () => {
  const fileIO = new MemoryFileIO({
    [`${ROOT}/messages/en.ts`]: `export default { greeting: 'Hello from TS' } as const;`,
  });

  it('returns unsupported-format reason for TS locale files', async () => {
    const result = await resolveI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      fileIO,
    });
    expect(result.resolvedText).toBeNull();
    expect(result.unresolvedReason).toBe('unsupported-format');
  });
});
