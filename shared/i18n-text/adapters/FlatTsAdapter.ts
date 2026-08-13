/**
 * @file FlatTsAdapter — `{dir}/{locale}.ts` (or .js) exporting a single dictionary object
 *   for that one locale, e.g. `src/i18n/en.ts -> export default { greeting: 'Hi' }`.
 *
 * Accessed via: the adapter registry, ahead of MergedTsAdapter (a per-locale file is more
 *   specific than a merged file). The locale comes from the FILENAME, not the object shape.
 *   Lifts `parseTsLocaleObject` 'single' branch + `findTsDomTextHit` single branch +
 *   `resolveLocaleKey` (ts-locale-ast). Read+write are AST-backed.
 */

import { findTsDomTextHit, parseTsLocaleObject, resolveLocaleKey } from '../ts-locale-ast';
import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys, stripExt } from './probe';

const FORM: I18nForm = 'flat-ts';

/** `{dir}/{locale}.ts` — exactly one filename segment under a known locale dir. */
function localeOf(probe: FileProbe): string | null {
  if (probe.ext !== '.ts' && probe.ext !== '.js') return null;
  if (!probe.matchedLocaleDir) return null;
  const rest = probe.relToRoot.slice(probe.matchedLocaleDir.length + 1);
  if (rest.includes('/')) return null;
  const locale = stripExt(rest);
  // `index` is an aggregator, not a locale file.
  if (!locale || locale === 'index') return null;
  return locale;
}

async function readContent(probe: FileProbe, ctx: AdapterContext): Promise<string | null> {
  try {
    return await ctx.fileIO.readFile(probe.filePath);
  } catch {
    return null;
  }
}

export const FlatTsAdapter: I18nFormatAdapter = {
  name: 'flat-ts',
  form: FORM,
  priority: 55,
  writable: true,

  async detect(probe, ctx) {
    const locale = localeOf(probe);
    if (locale === null) return false;
    const content = await readContent(probe, ctx);
    if (content === null) return false;
    const parsed = parseTsLocaleObject(content, locale);
    // A {locale}.ts file should classify as a single dictionary, not a locale-keyed merge.
    return parsed?.kind === 'single';
  },

  async resolveKeyToValue(probe, key, locale, ctx) {
    const content = await readContent(probe, ctx);
    if (content === null) return null;
    const parsed = parseTsLocaleObject(content, locale);
    if (!parsed || parsed.kind !== 'single') return null;
    return resolveLocaleKey(parsed.data, key);
  },

  async resolveValueToKey(probe, value, locale, ctx) {
    const content = await readContent(probe, ctx);
    if (content === null) return null;
    const parsed = parseTsLocaleObject(content, locale);
    if (!parsed || parsed.kind !== 'single') return null;
    const hit = findTsDomTextHit(parsed, value, probe.filePath, locale);
    if (!hit) return null;
    const result: ResolveHit = { key: hit.key, value: hit.resolvedText, locale, form: FORM };
    return result;
  },

  async listKeys(probe, locale, ctx) {
    const content = await readContent(probe, ctx);
    if (content === null) return [];
    const parsed = parseTsLocaleObject(content, locale);
    if (!parsed || parsed.kind !== 'single') return [];
    return extractLeafKeys(parsed.data);
  },

  localeFor(probe) {
    const locale = localeOf(probe);
    return locale ? { locale } : null;
  },
};
