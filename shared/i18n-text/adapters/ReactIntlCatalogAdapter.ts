/**
 * @file ReactIntlCatalogAdapter — flat dotted-id JSON catalog under react-intl's
 *   `lang/`, `compiled-lang/`, `extracted/` directories.
 *
 * Accessed via: the adapter registry, ahead of the generic JSON fallback. It is the
 *   SAME JSON resolver as JsonLocaleAdapter, gated to the react-intl catalog dir set
 *   (+ library === 'react-intl') so the reported form stays honest.
 * Assumptions: catalog is `{catalogDir}/{locale}.json` of flat dotted ids (e.g.
 *   `"app.greeting": "Hello"`). Nested objects also resolve (resolveKeyInData traverses).
 */

import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys, findKeyByValue, resolveKeyInData, stripExt } from './probe';

const FORM: I18nForm = 'react-intl-catalog';
const CATALOG_DIRS = ['lang', 'compiled-lang', 'extracted'] as const;

/** `{catalogDir}/{locale}.json` — exactly one filename segment under a catalog dir. */
function localeOf(probe: FileProbe): string | null {
  if (probe.ext !== '.json') return null;
  const parts = probe.segments;
  if (parts.length !== 2) return null;
  if (!(CATALOG_DIRS as readonly string[]).includes(parts[0])) return null;
  return stripExt(parts[1]);
}

async function parseJson(probe: FileProbe, ctx: AdapterContext): Promise<unknown | null> {
  try {
    return JSON.parse(await ctx.fileIO.readFile(probe.filePath));
  } catch {
    return null;
  }
}

export const ReactIntlCatalogAdapter: I18nFormatAdapter = {
  name: 'react-intl-catalog',
  form: FORM,
  priority: 30,
  writable: true,

  async detect(probe, ctx) {
    if (ctx.library !== 'react-intl') return false;
    if (localeOf(probe) === null) return false;
    const data = await parseJson(probe, ctx);
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  },

  async resolveKeyToValue(probe, key, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return null;
    return resolveKeyInData(data, key);
  },

  async resolveValueToKey(probe, value, locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return null;
    const key = findKeyByValue(data, value);
    if (key === null) return null;
    const hit: ResolveHit = { key, value, locale, form: FORM };
    return hit;
  },

  async listKeys(probe, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return [];
    return extractLeafKeys(data);
  },

  localeFor(probe) {
    const locale = localeOf(probe);
    return locale ? { locale } : null;
  },
};
