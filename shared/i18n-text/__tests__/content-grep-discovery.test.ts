/**
 * @file Tests for CONTENT-FIRST i18n discovery — find i18n dictionaries wherever the
 *       visible DOM text lives, regardless of conventional locale directory layout.
 *
 * Accessed via: bun test shared/i18n-text/__tests__/content-grep-discovery.test.ts
 * Assumptions: uses in-memory FileIO; path no longer gates discovery — content does.
 *
 * Red-first contract (TASK HYP-683):
 *   1. Dictionaries in a NON-conventional dir (config/strings/) whose displayed text
 *      greps to a flat/namespaced dict → found + classified by FORM.
 *   2. A node_modules hit with the same string → excluded via the shared exclude list.
 *   3. A random source file containing the same string but NOT dict-shaped → NOT
 *      classified as i18n.
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
      // Mimics NodeFileIO/VSCodeFileIO recursive listing WITHOUT exclude filtering —
      // the content-first discovery must apply the shared excludes itself.
      return Object.keys(files).filter(
        (f) => (f.startsWith(`${dir}/`) || f === dir) && (!exts || exts.some((e) => f.endsWith(e))),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Non-conventional directory — content, not path, finds the dictionary
// ---------------------------------------------------------------------------

describe('non-conventional dir — flat JSON dictionary', () => {
  it('finds a flat dict under config/strings/ (not a known LOCALE_DIR)', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/config/strings/en.json`]: JSON.stringify({ greeting: 'Howdy partner' }),
      [`${ROOT}/config/strings/de.json`]: JSON.stringify({ greeting: 'Hallo Partner' }),
    });

    const result = await resolveI18nByDomText('Howdy partner', ROOT, fileIO);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('greeting');
    expect(result?.locale).toBe('en');
    expect(result?.matchType).toBe('value');
    expect(result?.availableLocales.sort()).toEqual(['de', 'en']);
  });

  it('finds a namespaced dict under a non-conventional dir and classifies the namespace', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/app-text/en/common.json`]: JSON.stringify({ button: { save: 'Persist' } }),
      [`${ROOT}/app-text/fr/common.json`]: JSON.stringify({ button: { save: 'Persister' } }),
    });

    const result = await resolveI18nByDomText('Persist', ROOT, fileIO);
    expect(result?.key).toBe('button.save');
    expect(result?.namespace).toBe('common');
    expect(result?.locale).toBe('en');
    expect(result?.availableLocales.sort()).toEqual(['en', 'fr']);
  });

  it('finds a merged TS dict in a non-conventional location', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/src/strings/dictionary.ts`]: `
        export const translations = {
          en: { hero: { title: 'Welcome aboard' } },
          ru: { hero: { title: 'Добро пожаловать' } },
        };
      `,
    });

    const result = await resolveI18nByDomText('Добро пожаловать', ROOT, fileIO);
    expect(result?.key).toBe('hero.title');
    expect(result?.locale).toBe('ru');
    expect(result?.availableLocales.sort()).toEqual(['en', 'ru']);
  });
});

// ---------------------------------------------------------------------------
// 2. node_modules (and other excluded dirs) must NOT be scanned
// ---------------------------------------------------------------------------

describe('excluded directories are not scanned', () => {
  it('ignores a matching string inside node_modules', async () => {
    const fileIO = makeFileIO({
      // A vendored package ships its own en.json with the same string — must be skipped.
      [`${ROOT}/node_modules/some-lib/locales/en.json`]: JSON.stringify({ greeting: 'Unique vendor text' }),
    });

    const result = await resolveI18nByDomText('Unique vendor text', ROOT, fileIO);
    expect(result).toBeNull();
  });

  it('prefers the project dict over a node_modules dict with the same text', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/node_modules/some-lib/en.json`]: JSON.stringify({ vendored: 'Shared text' }),
      [`${ROOT}/config/strings/en.json`]: JSON.stringify({ greeting: 'Shared text' }),
    });

    const result = await resolveI18nByDomText('Shared text', ROOT, fileIO);
    expect(result?.key).toBe('greeting');
  });
});

// ---------------------------------------------------------------------------
// 3. Random source file with the string but NOT dict-shaped → NOT classified
// ---------------------------------------------------------------------------

describe('non-dictionary files are not classified as i18n', () => {
  it('does not classify a TSX component that merely renders the string', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/components/Hero.tsx`]: `export function Hero() { return <h1>Plain literal text</h1>; }`,
    });

    const result = await resolveI18nByDomText('Plain literal text', ROOT, fileIO);
    expect(result).toBeNull();
  });

  it('does not classify a non-locale JSON (e.g. a config flag map) lacking a locale-coded path', async () => {
    // The string appears as a VALUE in a JSON whose path segment is not a locale code.
    const fileIO = makeFileIO({
      [`${ROOT}/config/settings.json`]: JSON.stringify({ welcomeBanner: 'Some banner text' }),
    });

    const result = await resolveI18nByDomText('Some banner text', ROOT, fileIO);
    expect(result).toBeNull();
  });

  it('does not classify a comment/string inside arbitrary TS source', async () => {
    const fileIO = makeFileIO({
      [`${ROOT}/lib/util.ts`]: `// Some banner text\nexport const x = 'Some banner text';`,
    });

    const result = await resolveI18nByDomText('Some banner text', ROOT, fileIO);
    expect(result).toBeNull();
  });

  it('does NOT mislabel a value in src/data/*.json as locale "src" (denylist gate)', async () => {
    // "src" matches the bare 2–3-letter locale shape but is a source dir, not a locale.
    const fileIO = makeFileIO({
      [`${ROOT}/src/data/settings.json`]: JSON.stringify({ welcomeBanner: 'Some banner text' }),
    });

    const result = await resolveI18nByDomText('Some banner text', ROOT, fileIO);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 4. Cheap pre-filter must not drop valid dictionaries (codex P2 regression guards)
// ---------------------------------------------------------------------------

describe('lenient content pre-filter', () => {
  it('finds a passthrough nested KEY shown verbatim in the DOM (key not in raw file as a dotted string)', async () => {
    // DOM shows "common.greeting" (the key). The JSON stores it nested, so the raw file
    // never contains the literal "common.greeting" substring — only "greeting".
    const fileIO = makeFileIO({
      [`${ROOT}/config/strings/en.json`]: JSON.stringify({ common: { greeting: 'Hi there' } }),
      [`${ROOT}/config/strings/de.json`]: JSON.stringify({ common: { greeting: 'Hallo da' } }),
    });

    const result = await resolveI18nByDomText('common.greeting', ROOT, fileIO);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('common.greeting');
    expect(result?.matchType).toBe('key');
    expect(result?.resolvedText).toBe('Hi there');
  });

  it('finds a value whose JSON contains escaped quotes (cooked text ≠ raw substring)', async () => {
    // Raw JSON stores: "ok": "Click \"OK\"". The cooked value is: Click "OK".
    const fileIO = makeFileIO({
      [`${ROOT}/config/strings/en.json`]: JSON.stringify({ ok: 'Click "OK"' }),
    });

    const result = await resolveI18nByDomText('Click "OK"', ROOT, fileIO);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('ok');
    expect(result?.matchType).toBe('value');
  });
});
