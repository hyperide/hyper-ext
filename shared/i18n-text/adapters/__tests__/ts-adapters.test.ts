/**
 * @file Red-first tests for the TS/JS-family i18n adapters.
 *
 * MergedTsAdapter (single file keyed by locale), FlatTsAdapter ({dir}/{locale}.ts object),
 * I18nextResourcesAdapter (i18n.init({resources}) / addResourceBundle / createI18n).
 * In-memory FileIO; detection is AST/structural only.
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../../../lib/ast/file-io';
import { FlatTsAdapter } from '../FlatTsAdapter';
import { I18nextResourcesAdapter } from '../I18nextResourcesAdapter';
import { MergedTsAdapter } from '../MergedTsAdapter';
import type { AdapterContext } from '../I18nFormatAdapter';
import { buildProbe } from '../probe';

class MemoryFileIO implements FileIO {
  private files: Map<string, string>;
  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files));
  }
  async readFile(p: string): Promise<string> {
    const c = this.files.get(p);
    if (c == null) throw new Error(`ENOENT: ${p}`);
    return c;
  }
  async writeFile(p: string, c: string): Promise<void> {
    this.files.set(p, c);
  }
  async access(p: string): Promise<void> {
    if (!this.files.has(p)) throw new Error(`ENOENT: ${p}`);
  }
  async listFiles(dir: string, exts?: string[]): Promise<string[]> {
    const out: string[] = [];
    for (const p of this.files.keys()) {
      if ((p.startsWith(`${dir}/`) || p === dir) && (!exts || exts.some((e) => p.endsWith(e)))) out.push(p);
    }
    return out;
  }
}

const ROOT = '/project';
function ctx(fileIO: FileIO, extra: Partial<AdapterContext> = {}): AdapterContext {
  return { projectRoot: ROOT, fileIO, library: null, ...extra };
}
function probe(path: string) {
  const p = buildProbe(path, ROOT);
  if (!p) throw new Error(`bad probe path ${path}`);
  return p;
}

describe('MergedTsAdapter — translations.ts keyed by locale', () => {
  const src = `export const translations = {
    en: { greeting: 'Hello', nested: { bye: 'Goodbye' } },
    de: { greeting: 'Hallo', nested: { bye: 'Tschuss' } },
  } as const;`;
  const io = new MemoryFileIO({ [`${ROOT}/src/translations.ts`]: src });
  const c = ctx(io);

  it('detect() true for a merged locale-keyed object literal', async () => {
    expect(await MergedTsAdapter.detect(probe(`${ROOT}/src/translations.ts`), c)).toBe(true);
  });

  it('resolveKeyToValue resolves per locale incl. nested', async () => {
    const p = probe(`${ROOT}/src/translations.ts`);
    expect(await MergedTsAdapter.resolveKeyToValue(p, 'greeting', 'de', c)).toBe('Hallo');
    expect(await MergedTsAdapter.resolveKeyToValue(p, 'nested.bye', 'en', c)).toBe('Goodbye');
  });

  it('resolveValueToKey finds the key + locale + merged-ts form', async () => {
    const hit = await MergedTsAdapter.resolveValueToKey(probe(`${ROOT}/src/translations.ts`), 'Hallo', 'de', c);
    expect(hit?.key).toBe('greeting');
    expect(hit?.locale).toBe('de');
    expect(hit?.form).toBe('merged-ts');
  });

  it('listKeys returns leaf keys for the locale', async () => {
    const keys = await MergedTsAdapter.listKeys(probe(`${ROOT}/src/translations.ts`), 'en', c);
    expect(keys.sort()).toEqual(['greeting', 'nested.bye']);
  });
});

describe('FlatTsAdapter — {dir}/{locale}.ts single object', () => {
  const src = `export default { greeting: 'Hi', menu: { home: 'Home' } } satisfies Record<string, unknown>;`;
  const io = new MemoryFileIO({
    [`${ROOT}/src/i18n/en.ts`]: src,
    [`${ROOT}/src/i18n/de.ts`]: `export default { greeting: 'Hallo' };`,
  });
  const c = ctx(io);

  it('detect() true for a single-object TS locale file under a locale dir', async () => {
    expect(await FlatTsAdapter.detect(probe(`${ROOT}/src/i18n/en.ts`), c)).toBe(true);
  });

  it('localeFor derives locale from filename', () => {
    expect(FlatTsAdapter.localeFor(probe(`${ROOT}/src/i18n/de.ts`))).toEqual({ locale: 'de' });
  });

  it('resolveKeyToValue resolves nested key', async () => {
    expect(await FlatTsAdapter.resolveKeyToValue(probe(`${ROOT}/src/i18n/en.ts`), 'menu.home', 'en', c)).toBe('Home');
  });

  it('resolveValueToKey reports flat-ts form', async () => {
    const hit = await FlatTsAdapter.resolveValueToKey(probe(`${ROOT}/src/i18n/en.ts`), 'Hi', 'en', c);
    expect(hit?.key).toBe('greeting');
    expect(hit?.form).toBe('flat-ts');
  });

  it('detect() false for a merged locale-keyed file (that is MergedTsAdapter)', async () => {
    const mio = new MemoryFileIO({
      [`${ROOT}/src/i18n/index.ts`]: `export const messages = { en: { a: '1' }, de: { a: '2' } };`,
    });
    // index.ts is not {locale}.ts; FlatTsAdapter must not claim it.
    expect(await FlatTsAdapter.detect(probe(`${ROOT}/src/i18n/index.ts`), ctx(mio))).toBe(false);
  });
});

describe('I18nextResourcesAdapter — inline resources in init()', () => {
  const src = `import i18n from 'i18next';
    i18n.init({
      lng: 'en',
      resources: {
        en: { translation: { greeting: 'Hello', deep: { x: 'Deep EN' } } },
        de: { translation: { greeting: 'Hallo' } },
      },
    });`;
  const io = new MemoryFileIO({ [`${ROOT}/src/i18n.ts`]: src });
  const c = ctx(io, { library: 'i18next' });

  it('detect() true when i18n.init({resources}) is present and library is i18next', async () => {
    expect(await I18nextResourcesAdapter.detect(probe(`${ROOT}/src/i18n.ts`), c)).toBe(true);
  });

  it('resolveKeyToValue walks locale -> ns -> key', async () => {
    const p = probe(`${ROOT}/src/i18n.ts`);
    // default ns is 'translation' when ctx.namespace is unset
    expect(await I18nextResourcesAdapter.resolveKeyToValue(p, 'greeting', 'de', c)).toBe('Hallo');
    expect(await I18nextResourcesAdapter.resolveKeyToValue(p, 'deep.x', 'en', c)).toBe('Deep EN');
  });

  it('resolveValueToKey returns key + i18next-resources form', async () => {
    const hit = await I18nextResourcesAdapter.resolveValueToKey(probe(`${ROOT}/src/i18n.ts`), 'Hallo', 'de', c);
    expect(hit?.key).toBe('greeting');
    expect(hit?.locale).toBe('de');
    expect(hit?.form).toBe('i18next-resources');
  });

  it('is read-only (writable === false)', () => {
    expect(I18nextResourcesAdapter.writable).toBe(false);
  });

  it('also handles addResourceBundle(locale, ns, obj)', async () => {
    const bundleSrc = `i18n.addResourceBundle('fr', 'translation', { hi: 'Salut' });`;
    const bio = new MemoryFileIO({ [`${ROOT}/src/setup.ts`]: bundleSrc });
    const bc = ctx(bio, { library: 'i18next' });
    expect(await I18nextResourcesAdapter.detect(probe(`${ROOT}/src/setup.ts`), bc)).toBe(true);
    expect(await I18nextResourcesAdapter.resolveKeyToValue(probe(`${ROOT}/src/setup.ts`), 'hi', 'fr', bc)).toBe(
      'Salut',
    );
  });

  it('detect() false for a plain non-init TS file', async () => {
    const pio = new MemoryFileIO({ [`${ROOT}/src/util.ts`]: `export const x = 1;` });
    expect(await I18nextResourcesAdapter.detect(probe(`${ROOT}/src/util.ts`), ctx(pio, { library: 'i18next' }))).toBe(
      false,
    );
  });
});
