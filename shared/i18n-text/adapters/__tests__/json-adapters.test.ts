/**
 * @file Red-first tests for the JSON-family i18n adapters.
 *
 * Covers JsonLocaleAdapter (flat + nested), NamespacedJsonAdapter, NextIntlMessagesAdapter,
 * ReactIntlCatalogAdapter. Uses an in-memory FileIO; detection is structural only.
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../../../lib/ast/file-io';
import { JsonLocaleAdapter } from '../JsonLocaleAdapter';
import { NamespacedJsonAdapter } from '../NamespacedJsonAdapter';
import { NextIntlMessagesAdapter } from '../NextIntlMessagesAdapter';
import { ReactIntlCatalogAdapter } from '../ReactIntlCatalogAdapter';
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

describe('JsonLocaleAdapter — flat JSON', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello', 'habits.walks': 'Go for walks' }),
    [`${ROOT}/locales/de.json`]: JSON.stringify({ greeting: 'Hallo' }),
  });
  const c = ctx(io);

  it('detect() true for a 1-segment json under a locale dir that parses to an object', async () => {
    expect(await JsonLocaleAdapter.detect(probe(`${ROOT}/locales/en.json`), c)).toBe(true);
  });

  it('resolveKeyToValue resolves a flat literal-dotted key', async () => {
    expect(await JsonLocaleAdapter.resolveKeyToValue(probe(`${ROOT}/locales/en.json`), 'habits.walks', 'en', c)).toBe(
      'Go for walks',
    );
  });

  it('resolveValueToKey returns key+form for flat value match', async () => {
    const hit = await JsonLocaleAdapter.resolveValueToKey(probe(`${ROOT}/locales/en.json`), 'Hello', 'en', c);
    expect(hit).not.toBeNull();
    expect(hit?.key).toBe('greeting');
    expect(hit?.form).toBe('flat-json');
    expect(hit?.locale).toBe('en');
  });

  it('listKeys returns all leaf keys', async () => {
    const keys = await JsonLocaleAdapter.listKeys(probe(`${ROOT}/locales/en.json`), 'en', c);
    expect(keys.sort()).toEqual(['greeting', 'habits.walks']);
  });

  it('localeFor derives locale from the filename', () => {
    expect(JsonLocaleAdapter.localeFor(probe(`${ROOT}/locales/de.json`))).toEqual({ locale: 'de' });
  });
});

describe('JsonLocaleAdapter — nested JSON', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ nested: { greeting: 'Hi there' } }),
  });
  const c = ctx(io);

  it('resolveValueToKey reports nested-json form for a traversed match', async () => {
    const hit = await JsonLocaleAdapter.resolveValueToKey(probe(`${ROOT}/locales/en.json`), 'Hi there', 'en', c);
    expect(hit?.key).toBe('nested.greeting');
    expect(hit?.form).toBe('nested-json');
  });

  it('resolveKeyToValue resolves via dot-path traversal', async () => {
    expect(
      await JsonLocaleAdapter.resolveKeyToValue(probe(`${ROOT}/locales/en.json`), 'nested.greeting', 'en', c),
    ).toBe('Hi there');
  });
});

describe('JsonLocaleAdapter — negative detection', () => {
  it('detect() false for a non-dictionary JSON outside any locale dir', async () => {
    const io = new MemoryFileIO({ [`${ROOT}/tsconfig.json`]: JSON.stringify({ compilerOptions: {} }) });
    expect(await JsonLocaleAdapter.detect(probe(`${ROOT}/tsconfig.json`), ctx(io))).toBe(false);
  });

  it('detect() false for a 2-segment namespaced file (that is the namespaced adapter)', async () => {
    const io = new MemoryFileIO({ [`${ROOT}/locales/en/common.json`]: JSON.stringify({ a: 'b' }) });
    expect(await JsonLocaleAdapter.detect(probe(`${ROOT}/locales/en/common.json`), ctx(io))).toBe(false);
  });
});

describe('NamespacedJsonAdapter — {dir}/{locale}/{ns}.json', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/locales/en/common.json`]: JSON.stringify({ save: 'Save' }),
    [`${ROOT}/locales/de/common.json`]: JSON.stringify({ save: 'Speichern' }),
  });
  const c = ctx(io, { namespace: 'common' });

  it('detect() true for a 2-segment locale/ns json under a locale dir', async () => {
    expect(await NamespacedJsonAdapter.detect(probe(`${ROOT}/locales/en/common.json`), c)).toBe(true);
  });

  it('localeFor derives locale + namespace', () => {
    expect(NamespacedJsonAdapter.localeFor(probe(`${ROOT}/locales/de/common.json`))).toEqual({
      locale: 'de',
      namespace: 'common',
    });
  });

  it('resolveKeyToValue + resolveValueToKey round-trip', async () => {
    expect(
      await NamespacedJsonAdapter.resolveKeyToValue(probe(`${ROOT}/locales/en/common.json`), 'save', 'en', c),
    ).toBe('Save');
    const hit = await NamespacedJsonAdapter.resolveValueToKey(
      probe(`${ROOT}/locales/de/common.json`),
      'Speichern',
      'de',
      c,
    );
    expect(hit?.key).toBe('save');
    expect(hit?.namespace).toBe('common');
    expect(hit?.form).toBe('namespaced-json');
  });
});

describe('NextIntlMessagesAdapter — messages/{locale}.json with NS-as-key-prefix', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/messages/en.json`]: JSON.stringify({ HomePage: { title: 'Welcome' } }),
    [`${ROOT}/messages/de.json`]: JSON.stringify({ HomePage: { title: 'Willkommen' } }),
  });
  // next-intl namespace is a KEY PREFIX, not a directory.
  const c = ctx(io, { library: 'next-intl', namespace: 'HomePage' });

  it('detect() true under messages/ when library is next-intl', async () => {
    expect(await NextIntlMessagesAdapter.detect(probe(`${ROOT}/messages/en.json`), c)).toBe(true);
  });

  it('resolveKeyToValue prepends the namespace key prefix', async () => {
    expect(await NextIntlMessagesAdapter.resolveKeyToValue(probe(`${ROOT}/messages/en.json`), 'title', 'en', c)).toBe(
      'Welcome',
    );
  });

  it('resolveValueToKey strips the namespace prefix from the returned key', async () => {
    const hit = await NextIntlMessagesAdapter.resolveValueToKey(
      probe(`${ROOT}/messages/de.json`),
      'Willkommen',
      'de',
      c,
    );
    expect(hit?.key).toBe('title');
    expect(hit?.namespace).toBe('HomePage');
    expect(hit?.form).toBe('next-intl-messages');
  });

  it('detect() false under messages/ when library is NOT next-intl', async () => {
    expect(await NextIntlMessagesAdapter.detect(probe(`${ROOT}/messages/en.json`), ctx(io))).toBe(false);
  });
});

describe('ReactIntlCatalogAdapter — flat dotted-id JSON under lang/ compiled-lang/ extracted/', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/lang/en.json`]: JSON.stringify({ 'app.greeting': 'Hello', 'app.bye': 'Bye' }),
  });
  const c = ctx(io, { library: 'react-intl' });

  it('detect() true for a json under the react-intl catalog dir whitelist', async () => {
    expect(await ReactIntlCatalogAdapter.detect(probe(`${ROOT}/lang/en.json`), c)).toBe(true);
  });

  it('resolveValueToKey reports react-intl-catalog form', async () => {
    const hit = await ReactIntlCatalogAdapter.resolveValueToKey(probe(`${ROOT}/lang/en.json`), 'Hello', 'en', c);
    expect(hit?.key).toBe('app.greeting');
    expect(hit?.form).toBe('react-intl-catalog');
  });

  it('detect() false under a plain locales/ dir (that is JsonLocaleAdapter)', async () => {
    const io2 = new MemoryFileIO({ [`${ROOT}/locales/en.json`]: JSON.stringify({ a: 'b' }) });
    expect(await ReactIntlCatalogAdapter.detect(probe(`${ROOT}/locales/en.json`), ctx(io2))).toBe(false);
  });
});
