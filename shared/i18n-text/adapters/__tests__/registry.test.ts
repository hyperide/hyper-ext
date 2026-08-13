/**
 * @file Red-first tests for the adapter registry + content-first discovery router.
 *
 * Verifies ordering (most-specific first, generic JSON last), detectAdapter exclusivity,
 * and resolveByDisplayedText (grep-the-DOM-text -> file -> detect() -> value->key).
 */

import { describe, expect, it } from 'bun:test';
import type { FileIO } from '../../../../lib/ast/file-io';
import type { AdapterContext } from '../I18nFormatAdapter';
import { buildProbe } from '../probe';
import { ADAPTERS, detectAdapter, listKeysForBinding, resolveByDisplayedText } from '../registry';

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

describe('registry ordering', () => {
  it('is sorted by ascending priority (most-specific first)', () => {
    const priorities = ADAPTERS.map((a) => a.priority);
    const sorted = [...priorities].sort((a, b) => a - b);
    expect(priorities).toEqual(sorted);
  });

  it('ends the active (non-deferred) JSON path with the generic json-locale adapter', () => {
    const active = ADAPTERS.filter((a) => a.name === 'json-locale');
    expect(active.length).toBe(1);
    // generic JSON must be lower priority than namespaced/next-intl/react-intl JSON
    const json = ADAPTERS.find((a) => a.name === 'json-locale')!;
    const namespaced = ADAPTERS.find((a) => a.name === 'namespaced-json')!;
    expect(json.priority).toBeGreaterThan(namespaced.priority);
  });
});

describe('detectAdapter — structural exclusivity', () => {
  it('routes a namespaced file to namespaced-json, not generic json', async () => {
    const io = new MemoryFileIO({ [`${ROOT}/locales/en/common.json`]: JSON.stringify({ a: 'b' }) });
    const a = await detectAdapter(probe(`${ROOT}/locales/en/common.json`), ctx(io, { namespace: 'common' }));
    expect(a?.name).toBe('namespaced-json');
  });

  it('routes a flat file to json-locale', async () => {
    const io = new MemoryFileIO({ [`${ROOT}/locales/en.json`]: JSON.stringify({ a: 'b' }) });
    const a = await detectAdapter(probe(`${ROOT}/locales/en.json`), ctx(io));
    expect(a?.name).toBe('json-locale');
  });

  it('routes a next-intl messages file ahead of generic json when library is next-intl', async () => {
    const io = new MemoryFileIO({ [`${ROOT}/messages/en.json`]: JSON.stringify({ NS: { a: 'b' } }) });
    const a = await detectAdapter(
      probe(`${ROOT}/messages/en.json`),
      ctx(io, { library: 'next-intl', namespace: 'NS' }),
    );
    expect(a?.name).toBe('next-intl-messages');
  });

  it('returns null for a non-dictionary file', async () => {
    const io = new MemoryFileIO({ [`${ROOT}/tsconfig.json`]: JSON.stringify({ compilerOptions: {} }) });
    expect(await detectAdapter(probe(`${ROOT}/tsconfig.json`), ctx(io))).toBeNull();
  });
});

describe('resolveByDisplayedText — content-first JSON', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello world' }),
    [`${ROOT}/locales/de.json`]: JSON.stringify({ greeting: 'Hallo Welt' }),
  });

  it('grep displayed text -> key + form + availableLocales', async () => {
    const result = await resolveByDisplayedText('Hello world', 'en', ctx(io));
    expect(result).not.toBeNull();
    expect(result?.key).toBe('greeting');
    expect(result?.form).toBe('flat-json');
    expect(result?.locale).toBe('en');
    expect(result?.availableLocales.sort()).toEqual(['de', 'en']);
    expect(result?.adapterName).toBe('json-locale');
    expect(result?.writable).toBe(true);
  });

  it('returns null when the text is in no dictionary', async () => {
    expect(await resolveByDisplayedText('nonexistent string', 'en', ctx(io))).toBeNull();
  });
});

describe('resolveByDisplayedText — content-first merged TS', () => {
  const io = new MemoryFileIO({
    [`${ROOT}/src/translations.ts`]: `export const translations = { en: { hi: 'Hi there' }, de: { hi: 'Hallo da' } };`,
  });

  it('classifies a merged-ts hit via detect() + value->key', async () => {
    const result = await resolveByDisplayedText('Hallo da', 'de', ctx(io));
    expect(result?.key).toBe('hi');
    expect(result?.form).toBe('merged-ts');
    expect(result?.adapterName).toBe('merged-ts');
    expect(result?.writable).toBe(true);
  });
});

describe('resolveByDisplayedText — caller-supplied hit paths', () => {
  it('accepts an extra candidate path outside the standard locale dirs', async () => {
    const io = new MemoryFileIO({
      [`${ROOT}/custom/place/dict.en.json`]: JSON.stringify({ k: 'Custom text' }),
    });
    // Not under a locale dir -> JsonLocaleAdapter wouldn't normally see it; but the path is
    // also not a {dir}/{locale}.json shape, so detect() is false even when supplied.
    // This asserts the supplied-path plumbing runs without throwing and returns null cleanly.
    const result = await resolveByDisplayedText('Custom text', 'en', ctx(io), [`${ROOT}/custom/place/dict.en.json`]);
    expect(result).toBeNull();
  });
});

/** FileIO without optional listFiles — exercises the access()-probe fallback path. */
class NoListFilesFileIO {
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
}

describe('listKeysForBinding — namespace filtering (codex P2)', () => {
  it('returns ONLY the requested namespace keys when multiple ns files share a locale', async () => {
    const io = new MemoryFileIO({
      [`${ROOT}/locales/en/admin.json`]: JSON.stringify({ adminOnly: 'A' }),
      [`${ROOT}/locales/en/common.json`]: JSON.stringify({ save: 'Save', cancel: 'Cancel' }),
    });
    const keys = await listKeysForBinding('en', ctx(io, { namespace: 'common' }));
    expect(keys.sort()).toEqual(['cancel', 'save']);
    expect(keys).not.toContain('adminOnly');
  });

  it('does not fall back to a flat per-locale file when a namespace is requested', async () => {
    // locales/en.json (flat, no namespace) must NOT shadow the requested ns file.
    const io = new MemoryFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ flatKey: 'F' }),
      [`${ROOT}/locales/en/common.json`]: JSON.stringify({ save: 'Save' }),
    });
    const keys = await listKeysForBinding('en', ctx(io, { namespace: 'common' }));
    expect(keys).toEqual(['save']);
    expect(keys).not.toContain('flatKey');
  });

  it('keeps a next-intl messages/{locale}.json catalog for a namespaced binding (key-prefix ns)', async () => {
    // next-intl scopes useTranslations('HomePage') as a key PREFIX inside messages/en.json,
    // so the file reports a path locale but no path namespace. It must stay eligible and
    // listKeys must strip the prefix to the scoped keys. Regression for the codex P2 where
    // the namespace filter dropped it and the combobox returned [].
    const io = new MemoryFileIO({
      [`${ROOT}/messages/en.json`]: JSON.stringify({
        HomePage: { title: 'Hi', cta: 'Go' },
        About: { heading: 'About' },
      }),
    });
    const keys = await listKeysForBinding('en', ctx(io, { library: 'next-intl', namespace: 'HomePage' }));
    expect(keys.sort()).toEqual(['cta', 'title']);
    expect(keys).not.toContain('heading');
  });
});

describe('listKeysForBinding — no listFiles fallback (codex P2)', () => {
  it('still finds flat locale keys via access()-probe when FileIO lacks listFiles', async () => {
    const io = new NoListFilesFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello', bye: 'Bye' }),
    });
    const keys = await listKeysForBinding('en', { projectRoot: ROOT, fileIO: io, library: null });
    expect(keys.sort()).toEqual(['bye', 'greeting']);
  });

  it('still resolves displayed text via access()-probe when FileIO lacks listFiles', async () => {
    const io = new NoListFilesFileIO({
      [`${ROOT}/locales/en.json`]: JSON.stringify({ greeting: 'Hello' }),
    });
    const result = await resolveByDisplayedText('Hello', 'en', { projectRoot: ROOT, fileIO: io, library: null });
    expect(result?.key).toBe('greeting');
    expect(result?.form).toBe('flat-json');
  });
});
