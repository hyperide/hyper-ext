/**
 * @file Tests for resolveI18nByDomText — find i18n key by searching locale files for DOM text.
 *
 * Accessed via: bun test shared/i18n-text/__tests__/resolve-by-dom-text.test.ts
 * Assumptions: uses in-memory FileIO; tests all typical real-world locale layouts.
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../../lib/ast/file-io';
import { resolveI18nByDomText } from '../resolve-by-dom-text';

const ROOT = '/project';

function makeFileIO(files: Record<string, string>): FileIO & { listFiles: NonNullable<FileIO['listFiles']> } {
  return {
    readFile: async (p) => {
      const c = files[p];
      if (c == null) throw new Error(`ENOENT: ${p}`);
      return c;
    },
    writeFile: async () => {},
    access: async (p) => {
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
    },
    listFiles: async (dir, exts) => {
      return Object.keys(files).filter(
        (f) => (f.startsWith(`${dir}/`) || f === dir) && (!exts || exts.some((e) => f.endsWith(e))),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Flat per-locale layout — value search
// ---------------------------------------------------------------------------

describe('flat locales/{locale}.json — value search', () => {
  const fileIO = makeFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello', farewell: 'Goodbye' }),
    [`${ROOT}/locales/de.json`]: JSON.stringify({ greeting: 'Hallo', farewell: 'Auf Wiedersehen' }),
  });

  it('finds key by DOM text value', async () => {
    const result = await resolveI18nByDomText('Hello', ROOT, fileIO);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('greeting');
    expect(result?.locale).toBe('en');
    expect(result?.resolvedText).toBe('Hello');
    expect(result?.matchType).toBe('value');
  });

  it('finds key in non-primary locale', async () => {
    const result = await resolveI18nByDomText('Hallo', ROOT, fileIO);
    expect(result?.key).toBe('greeting');
    expect(result?.locale).toBe('de');
  });

  it('returns availableLocales for all locales that have the same key', async () => {
    const result = await resolveI18nByDomText('Hello', ROOT, fileIO);
    expect(result?.availableLocales.sort()).toEqual(['de', 'en']);
  });

  it('returns null when text not found in any locale file', async () => {
    const result = await resolveI18nByDomText('Bonjour', ROOT, fileIO);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. Nested JSON values — dot-path key extraction
// ---------------------------------------------------------------------------

describe('messages/{locale}.json — nested value, dot-path key', () => {
  const fileIO = makeFileIO({
    [`${ROOT}/messages/en.json`]: JSON.stringify({ page: { title: 'Home', subtitle: 'Welcome back' } }),
    [`${ROOT}/messages/pl.json`]: JSON.stringify({ page: { title: 'Strona główna', subtitle: 'Witaj z powrotem' } }),
  });

  it('resolves nested key as dot-path', async () => {
    const result = await resolveI18nByDomText('Home', ROOT, fileIO);
    expect(result?.key).toBe('page.title');
    expect(result?.resolvedText).toBe('Home');
  });

  it('resolves deeply nested subtitle key', async () => {
    const result = await resolveI18nByDomText('Welcome back', ROOT, fileIO);
    expect(result?.key).toBe('page.subtitle');
  });

  it('finds same key in Polish locale', async () => {
    const result = await resolveI18nByDomText('Witaj z powrotem', ROOT, fileIO);
    expect(result?.key).toBe('page.subtitle');
    expect(result?.locale).toBe('pl');
  });
});

// ---------------------------------------------------------------------------
// 3. Namespaced layout — locales/{locale}/{namespace}.json
// ---------------------------------------------------------------------------

describe('locales/{locale}/{namespace}.json — namespaced layout', () => {
  const fileIO = makeFileIO({
    [`${ROOT}/locales/en/common.json`]: JSON.stringify({ button: { save: 'Save', cancel: 'Cancel' } }),
    [`${ROOT}/locales/de/common.json`]: JSON.stringify({ button: { save: 'Speichern', cancel: 'Abbrechen' } }),
  });

  it('finds key with namespace', async () => {
    const result = await resolveI18nByDomText('Save', ROOT, fileIO);
    expect(result?.key).toBe('button.save');
    expect(result?.namespace).toBe('common');
    expect(result?.locale).toBe('en');
  });

  it('returns availableLocales for namespaced layout', async () => {
    const result = await resolveI18nByDomText('Save', ROOT, fileIO);
    expect(result?.availableLocales.sort()).toEqual(['de', 'en']);
  });
});

// ---------------------------------------------------------------------------
// 4. Mock/passthrough pattern — t = (k) => k, DOM shows the key itself
// ---------------------------------------------------------------------------

describe('key-as-dom-text (passthrough mock t = k => k)', () => {
  const fileIO = makeFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ 'test.greeting': 'Hello', 'test.farewell': 'Goodbye' }),
    [`${ROOT}/locales/ru.json`]: JSON.stringify({ 'test.greeting': 'Привет', 'test.farewell': 'Пока' }),
  });

  it('finds key when DOM shows the key itself', async () => {
    // DOM shows "test.greeting" (the key), not "Hello" (the value)
    const result = await resolveI18nByDomText('test.greeting', ROOT, fileIO);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('test.greeting');
    expect(result?.resolvedText).toBe('Hello');
    expect(result?.matchType).toBe('key');
    expect(result?.availableLocales.sort()).toEqual(['en', 'ru']);
  });

  it('prefers value match over key match when both exist', async () => {
    // "Hello" is a value in en.json → value match wins over potential key match
    const result = await resolveI18nByDomText('Hello', ROOT, fileIO);
    expect(result?.matchType).toBe('value');
    expect(result?.key).toBe('test.greeting');
  });
});

// ---------------------------------------------------------------------------
// 5. public/locales flat layout (next-i18next)
// ---------------------------------------------------------------------------

describe('public/locales/{locale}.json — next-i18next flat', () => {
  const fileIO = makeFileIO({
    [`${ROOT}/public/locales/en.json`]: JSON.stringify({ conditions: { communication: 'Communication policy' } }),
    [`${ROOT}/public/locales/fr.json`]: JSON.stringify({ conditions: { communication: 'Politique de communication' } }),
  });

  it('finds nested key in public/locales flat layout', async () => {
    const result = await resolveI18nByDomText('Communication policy', ROOT, fileIO);
    expect(result?.key).toBe('conditions.communication');
    expect(result?.locale).toBe('en');
    expect(result?.availableLocales.sort()).toEqual(['en', 'fr']);
  });
});

// ---------------------------------------------------------------------------
// 6. App Router layout — app/{locale}/messages/{file}.json
// ---------------------------------------------------------------------------

describe('app/{locale}/messages layout — Next.js App Router', () => {
  const fileIO = makeFileIO({
    [`${ROOT}/app/en/messages/page.json`]: JSON.stringify({ hero: { title: 'Welcome to HyperIDE' } }),
    [`${ROOT}/app/de/messages/page.json`]: JSON.stringify({ hero: { title: 'Willkommen bei HyperIDE' } }),
  });

  it('finds key in App Router layout', async () => {
    const result = await resolveI18nByDomText('Welcome to HyperIDE', ROOT, fileIO);
    expect(result?.key).toBe('hero.title');
    expect(result?.locale).toBe('en');
    expect(result?.availableLocales.sort()).toEqual(['de', 'en']);
  });
});

// ---------------------------------------------------------------------------
// 7. Static TS/JS object-literal dictionaries
// ---------------------------------------------------------------------------

describe('static TS/JS object-literal dictionaries', () => {
  it('finds key by DOM text in merged translations.ts', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/client/lib/translations.ts`]: `
        export const translations = {
          en: { hero: { title: 'Hello Bulka' } },
          ru: { hero: { title: 'Привет, Булка' } },
        };
      `,
    });

    const result = await resolveI18nByDomText('Привет, Булка', ROOT, fileIO);
    expect(result?.key).toBe('hero.title');
    expect(result?.locale).toBe('ru');
    expect(result?.availableLocales.sort()).toEqual(['en', 'ru']);
  });

  it('finds key by DOM text in per-locale TS files', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/messages/en.ts`]: `export default { hero: { title: 'Hello from TS' } } as const;`,
      [`${ROOT}/messages/ru.ts`]: `export default { hero: { title: 'Привет из TS' } } as const;`,
    });

    const result = await resolveI18nByDomText('Hello from TS', ROOT, fileIO);
    expect(result?.key).toBe('hero.title');
    expect(result?.locale).toBe('en');
    expect(result?.availableLocales.sort()).toEqual(['en', 'ru']);
  });
});

// ---------------------------------------------------------------------------
// 8. Empty / edge cases
// ---------------------------------------------------------------------------

describe('edge cases', () => {
  it('returns null for empty string', async () => {
    const fileIO = makeFileIO({ [`${ROOT}/locales/en.json`]: JSON.stringify({ k: 'v' }) });
    expect(await resolveI18nByDomText('', ROOT, fileIO)).toBeNull();
  });

  it('returns null when no locale dirs exist', async () => {
    const fileIO = makeFileIO({});
    expect(await resolveI18nByDomText('Hello', ROOT, fileIO)).toBeNull();
  });

  it('returns null for malformed JSON locale file', async () => {
    const fileIO = makeFileIO({ [`${ROOT}/locales/en.json`]: '{ broken json' });
    expect(await resolveI18nByDomText('Hello', ROOT, fileIO)).toBeNull();
  });
});
