/**
 * @file Failing tests for locale resource write path.
 *
 * Tests must fail until Task 12 implements write-i18n-resource.ts.
 * Uses in-memory FileIO so no real filesystem access is needed.
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../../lib/ast/file-io';
import { writeI18nResource } from '../write-i18n-resource';

// ---------------------------------------------------------------------------
// In-memory FileIO fixture helper (same shape as resolve tests)
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

  /** Test helper: read current in-memory file content. */
  getFile(absolutePath: string): string | undefined {
    return this.files.get(absolutePath);
  }
}

const ROOT = '/project';

// ---------------------------------------------------------------------------
// Update existing key in active locale
// ---------------------------------------------------------------------------

describe('update existing key in active locale', () => {
  it('updates value for a flat key and leaves other keys intact', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello', 'habits.walks': 'Go for walks' }),
      [`${ROOT}/locales/de.json`]: JSON.stringify({ greeting: 'Hallo', 'habits.walks': 'Spazieren gehen' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'habits.walks',
      activeLocale: 'en',
      newText: 'Take walks every day',
      fileIO,
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(`${ROOT}/locales/en.json`);

    const written = JSON.parse(fileIO.getFile(`${ROOT}/locales/en.json`) ?? '{}') as Record<string, string>;
    expect(written['habits.walks']).toBe('Take walks every day');
    // Other keys must remain intact
    expect(written.greeting).toBe('Hello');

    // Other locale files must not be touched
    const de = JSON.parse(fileIO.getFile(`${ROOT}/locales/de.json`) ?? '{}') as Record<string, string>;
    expect(de['habits.walks']).toBe('Spazieren gehen');
  });

  it('updates a nested dot-path key', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/messages/en.json`]: JSON.stringify({ nested: { greeting: 'Hi there' }, title: 'Home' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'next-intl',
      key: 'nested.greeting',
      activeLocale: 'en',
      newText: 'Hey!',
      fileIO,
    });

    expect(result.success).toBe(true);

    const written = JSON.parse(fileIO.getFile(`${ROOT}/messages/en.json`) ?? '{}') as {
      nested: { greeting: string };
      title: string;
    };
    expect(written.nested.greeting).toBe('Hey!');
    // Sibling key unaffected
    expect(written.title).toBe('Home');
  });

  it('updates a key in namespaced layout', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en/common.json`]: JSON.stringify({ button: { save: 'Save', cancel: 'Cancel' } }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'button.save',
      namespace: 'common',
      activeLocale: 'en',
      newText: 'Save changes',
      fileIO,
    });

    expect(result.success).toBe(true);

    const written = JSON.parse(fileIO.getFile(`${ROOT}/locales/en/common.json`) ?? '{}') as {
      button: { save: string; cancel: string };
    };
    expect(written.button.save).toBe('Save changes');
    // Sibling key unaffected
    expect(written.button.cancel).toBe('Cancel');
  });
});

// ---------------------------------------------------------------------------
// Switching key: writing a different key than the one currently bound
// (represents user picking a new key from the dropdown — the locale file
//  update path handles creating or verifying the new target key exists)
// ---------------------------------------------------------------------------

describe('switching key dropdown — write to a different key', () => {
  it('creates a new key entry when switching to a non-existent key', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ 'habits.walks': 'Go for walks' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'habits.runs',
      activeLocale: 'en',
      newText: 'Go running',
      fileIO,
    });

    expect(result.success).toBe(true);

    const written = JSON.parse(fileIO.getFile(`${ROOT}/locales/en.json`) ?? '{}') as Record<string, string>;
    expect(written['habits.runs']).toBe('Go running');
    // Original key untouched
    expect(written['habits.walks']).toBe('Go for walks');
  });

  it('updates existing key when switching to a key that already exists', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({
        'habits.walks': 'Go for walks',
        'habits.runs': 'Go running',
      }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'habits.runs',
      activeLocale: 'en',
      newText: 'Run every morning',
      fileIO,
    });

    expect(result.success).toBe(true);

    const written = JSON.parse(fileIO.getFile(`${ROOT}/locales/en.json`) ?? '{}') as Record<string, string>;
    expect(written['habits.runs']).toBe('Run every morning');
    // Other key unaffected
    expect(written['habits.walks']).toBe('Go for walks');
  });
});

// ---------------------------------------------------------------------------
// Missing locale file — do not corrupt other files or JSX
// ---------------------------------------------------------------------------

describe('missing locale file behavior', () => {
  it('returns error without writing when locale file is not found', async () => {
    const fileIO = new MemoryFileIO({
      // locales directory exists but only 'de' locale file is present
      [`${ROOT}/locales/de.json`]: JSON.stringify({ greeting: 'Hallo' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      newText: 'Hello',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing-locale-file');
    expect(fileIO.getFile(`${ROOT}/locales/en.json`)).toBeUndefined();
  });

  it('returns error without writing when no locale files are found at all', async () => {
    const fileIO = new MemoryFileIO({
      // no locale files, just a source file
      [`${ROOT}/src/App.tsx`]: `export default function App() { return <div /> }`,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'habits.walks',
      activeLocale: 'en',
      newText: 'Go for walks',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing-locale-file');
    expect(fileIO.getFile(`${ROOT}/locales/en.json`)).toBeUndefined();
  });

  it('returns error without writing when no namespaced locale files are found at all', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/src/App.tsx`]: `export default function App() { return <div /> }`,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'button.save',
      namespace: 'common',
      activeLocale: 'en',
      newText: 'Save',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('missing-locale-file');
    expect(fileIO.getFile(`${ROOT}/locales/en/common.json`)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Corrupted / unreadable locale file — parse error
// ---------------------------------------------------------------------------

describe('parse error in locale file', () => {
  it('returns error without corrupting the file when JSON is malformed', async () => {
    const badJson = '{ "key": "value"'; // truncated JSON
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: badJson,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'key',
      activeLocale: 'en',
      newText: 'updated',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('parse-error');
    // Original (broken) content must not be touched
    expect(fileIO.getFile(`${ROOT}/locales/en.json`)).toBe(badJson);
  });
});

// ---------------------------------------------------------------------------
// Read-only filesystem — writeFile throws
// ---------------------------------------------------------------------------

describe('read-only filesystem', () => {
  it('returns io-error when an existing locale file cannot be read', async () => {
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

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      newText: 'Hi',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('io-error');
    expect(fileIO.getFile(`${ROOT}/locales/en.json`)).toBe(JSON.stringify({ greeting: 'Hello' }));
  });

  it('returns read-only error when writeFile throws', async () => {
    class ReadOnlyFileIO extends MemoryFileIO {
      override async writeFile(): Promise<void> {
        throw Object.assign(new Error('EROFS: read-only file system'), { code: 'EROFS' });
      }
    }

    const fileIO = new ReadOnlyFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      newText: 'Hi',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('read-only');
  });

  it('returns io-error when writeFile throws a non-permission error', async () => {
    class BrokenFileIO extends MemoryFileIO {
      override async writeFile(): Promise<void> {
        throw Object.assign(new Error('EIO: i/o error'), { code: 'EIO' });
      }
    }

    const fileIO = new BrokenFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      newText: 'Hi',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('io-error');
  });
});

// ---------------------------------------------------------------------------
// Non-object collision — setKey bail-out to avoid corrupting locale file
// ---------------------------------------------------------------------------

describe('non-object collision in dot-path', () => {
  it('returns unsupported-format when an intermediate segment is a string, not an object', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ nav: 'Home' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'nav.title',
      activeLocale: 'en',
      newText: 'Navigation',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('unsupported-format');
    // Original file must be untouched
    const rawContent = fileIO.getFile(`${ROOT}/locales/en.json`) ?? '{}';
    const written = JSON.parse(rawContent) as Record<string, unknown>;
    expect(written.nav).toBe('Home');
  });
});

// ---------------------------------------------------------------------------
// Prototype pollution prevention
// ---------------------------------------------------------------------------

describe('prototype pollution prevention', () => {
  it('does not pollute Object.prototype via __proto__ dot-path', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: '__proto__.polluted',
      activeLocale: 'en',
      newText: 'injected',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('unsupported-format');
    // No pollution on Object.prototype
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    // The raw file content must not contain __proto__ as a written key
    const rawContent = fileIO.getFile(`${ROOT}/locales/en.json`) ?? '{}';
    expect(rawContent).not.toContain('"__proto__"');
    // Other keys intact
    const written = JSON.parse(rawContent) as Record<string, unknown>;
    expect(written.greeting).toBe('Hello');
  });

  it('does not pollute via constructor.prototype dot-path', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'constructor.prototype.polluted',
      activeLocale: 'en',
      newText: 'injected',
      fileIO,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe('unsupported-format');
    expect((Object.prototype as Record<string, unknown>).polluted).toBeUndefined();
    const rawContent = fileIO.getFile(`${ROOT}/locales/en.json`) ?? '{}';
    expect(rawContent).not.toContain('"constructor"');
    const written = JSON.parse(rawContent) as Record<string, unknown>;
    expect(written.greeting).toBe('Hello');
  });
});

// ---------------------------------------------------------------------------
// TS/JS locale format — AST object-literal writes
// ---------------------------------------------------------------------------

describe('TS/JS locale format', () => {
  it('updates per-locale TS object files', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/messages/en.ts`]: `export default { greeting: 'Hello from TS' } as const;`,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'react-i18next',
      key: 'greeting',
      activeLocale: 'en',
      newText: 'Updated greeting',
      fileIO,
    });

    expect(result.success).toBe(true);
    expect(fileIO.getFile(`${ROOT}/messages/en.ts`)).toContain('Updated greeting');
  });

  it('updates merged translations.ts object files', async () => {
    const fileIO = new MemoryFileIO({
      [`${ROOT}/client/lib/translations.ts`]: `export const translations = { en: { brand: { name: 'Bulka' } }, ru: { brand: { name: 'Булка' } } };`,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'custom',
      key: 'brand.name',
      activeLocale: 'en',
      newText: 'Bagel',
      fileIO,
    });

    expect(result.success).toBe(true);
    const written = fileIO.getFile(`${ROOT}/client/lib/translations.ts`) ?? '';
    expect(written).toContain('Bagel');
    expect(written).toContain('Булка');
  });

  // -------------------------------------------------------------------------
  // Task 1 (HYP merged-TS write) — bulka-the-dog shape (ru/rs/en + typed
  // `Translations` interface), creating a brand-new top-level key inside
  // the active locale of a merged translations.ts file.
  //
  // Reality (verified by these tests on current main):
  //  - The ASCII new-key insertion path WORKS end-to-end through
  //    writeI18nResource → writeTsLocaleValue → setStringProperty.
  //  - The user-reported "q does not appear" is therefore not in this layer
  //    — Task 3 e2e will catch any integration-level breakage.
  //  - HOWEVER: babel-generator default escapes non-ASCII string values
  //    inserted via `t.stringLiteral(...)` (e.g. "Бублик" → "\\u0411…").
  //    Pre-existing string literals are preserved verbatim by retainLines.
  //    The non-ASCII insertion test below is RED on current main and fixed
  //    in Task 2.
  // -------------------------------------------------------------------------

  it('inserts a new top-level ASCII key into the active locale of merged translations.ts', async () => {
    const original = [
      `export type Language = "ru" | "rs" | "en";`,
      ``,
      `export interface Translations {`,
      `  ru: Record<string, any>;`,
      `  rs: Record<string, any>;`,
      `  en: Record<string, any>;`,
      `}`,
      ``,
      `export const translations: Translations = {`,
      `  ru: { brand: { name: "Булка" } },`,
      `  rs: { brand: { name: "Bulka (rs)" } },`,
      `  en: { brand: { name: "Bun" } },`,
      `};`,
      ``,
    ].join('\n');

    const fileIO = new MemoryFileIO({
      [`${ROOT}/client/lib/translations.ts`]: original,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'custom',
      key: 'q',
      activeLocale: 'ru',
      newText: 'Q!',
      fileIO,
    });

    expect(result.success).toBe(true);
    expect(result.filePath).toBe(`${ROOT}/client/lib/translations.ts`);

    const written = fileIO.getFile(`${ROOT}/client/lib/translations.ts`) ?? '';
    // The new key must appear inside the ru sub-object and carry the new value
    expect(written).toMatch(/ru\s*:\s*\{[\s\S]*?q\s*:\s*"Q!"[\s\S]*?\},/);
    // Other locales / existing keys must remain intact (and unescaped)
    expect(written).toContain('Булка');
    expect(written).toContain('Bun');
    expect(written).toContain('Bulka (rs)');
  });

  it('inserts a nested new ASCII key into the active locale of merged translations.ts', async () => {
    const original = [
      `export const translations = {`,
      `  ru: { brand: { name: "Булка" } },`,
      `  en: { brand: { name: "Bun" } },`,
      `};`,
      ``,
    ].join('\n');

    const fileIO = new MemoryFileIO({
      [`${ROOT}/client/lib/translations.ts`]: original,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'custom',
      key: 'e2e.merged.newkey',
      activeLocale: 'ru',
      newText: 'MERGED NEW',
      fileIO,
    });

    expect(result.success).toBe(true);
    const written = fileIO.getFile(`${ROOT}/client/lib/translations.ts`) ?? '';
    expect(written).toContain('MERGED NEW');
    // Pre-existing non-ASCII content untouched
    expect(written).toContain('Булка');
    expect(written).toContain('Bun');
  });

  // RED on current main: babel-generator escapes non-ASCII into \uXXXX when
  // emitting a freshly-constructed t.stringLiteral. Bulka-the-dog uses plain
  // Cyrillic in its translations.ts; emitting "Бул…" would
  // diverge visually and confuse anyone diffing the file. Task 2 fixes this.
  it('preserves non-ASCII characters when inserting a new key', async () => {
    const original = [
      `export const translations = {`,
      `  ru: { brand: { name: "Булка" } },`,
      `  en: { brand: { name: "Bun" } },`,
      `};`,
      ``,
    ].join('\n');

    const fileIO = new MemoryFileIO({
      [`${ROOT}/client/lib/translations.ts`]: original,
    });

    const result = await writeI18nResource({
      projectRoot: ROOT,
      library: 'custom',
      key: 'greeting',
      activeLocale: 'ru',
      newText: 'Привет, Бублик',
      fileIO,
    });

    expect(result.success).toBe(true);
    const written = fileIO.getFile(`${ROOT}/client/lib/translations.ts`) ?? '';
    // Non-ASCII must round-trip verbatim, not as \u escapes
    expect(written).toContain('Привет, Бублик');
    expect(written).not.toContain('\\u04');
  });
});
