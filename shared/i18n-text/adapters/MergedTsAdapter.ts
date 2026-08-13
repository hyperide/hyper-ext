/**
 * @file MergedTsAdapter — a single TS/JS file exporting an object keyed by locale,
 *   e.g. `export const translations = { en: {...}, de: {...} }` (the "bulka" format).
 *
 * Accessed via: the adapter registry. Detection is content-first (any probed .ts/.js whose
 *   dictionary object classifies as 'merged'), so it is not limited to a hardcoded filename
 *   list. Lifts `parseTsLocaleObject` 'merged' branch + `findTsDomTextHit` merged branch +
 *   `resolveLocaleKey` (ts-locale-ast). Read+write are both AST-backed.
 */

import { findTsDomTextHit, parseTsLocaleObject, resolveLocaleKey } from '../ts-locale-ast';
import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys } from './probe';

const FORM: I18nForm = 'merged-ts';

async function readContent(probe: FileProbe, ctx: AdapterContext): Promise<string | null> {
  try {
    return await ctx.fileIO.readFile(probe.filePath);
  } catch {
    return null;
  }
}

export const MergedTsAdapter: I18nFormatAdapter = {
  name: 'merged-ts',
  form: FORM,
  priority: 50,
  writable: true,

  async detect(probe, ctx) {
    if (probe.ext !== '.ts' && probe.ext !== '.js') return false;
    const content = await readContent(probe, ctx);
    if (content === null) return false;
    const parsed = parseTsLocaleObject(content);
    return parsed?.kind === 'merged' && parsed.locales.length > 0;
  },

  async resolveKeyToValue(probe, key, locale, ctx) {
    const content = await readContent(probe, ctx);
    if (content === null) return null;
    const parsed = parseTsLocaleObject(content, locale);
    if (!parsed || parsed.kind !== 'merged') return null;
    return resolveLocaleKey(parsed.data[locale], key);
  },

  async resolveValueToKey(probe, value, locale, ctx) {
    const content = await readContent(probe, ctx);
    if (content === null) return null;
    const parsed = parseTsLocaleObject(content, locale);
    if (!parsed || parsed.kind !== 'merged') return null;
    const hit = findTsDomTextHit(parsed, value, probe.filePath, locale);
    if (!hit) return null;
    const result: ResolveHit = { key: hit.key, value: hit.resolvedText, locale: hit.locale, form: FORM };
    return result;
  },

  async listKeys(probe, locale, ctx) {
    const content = await readContent(probe, ctx);
    if (content === null) return [];
    const parsed = parseTsLocaleObject(content, locale);
    if (!parsed || parsed.kind !== 'merged') return [];
    const localeData = parsed.data[locale] ?? parsed.data[parsed.locales[0]];
    return extractLeafKeys(localeData);
  },

  // A merged file holds every locale, so a single probe cannot name one locale.
  localeFor() {
    return null;
  },
};
