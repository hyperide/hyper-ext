/**
 * @file NamespacedJsonAdapter — `{dir}/{locale}/{ns}.json` layout.
 *
 * Accessed via: the adapter registry, ahead of the generic JSON fallback.
 * Assumptions: the JSON resolver is the same as JsonLocaleAdapter, scoped to a
 *   2-segment-under-dir path. Namespace comes from the path, not a key prefix.
 *   This lifts `discoverLayout` namespaced branch (resolve-i18n-resource L91-124).
 */

import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys, findKeyByValue, resolveKeyInData, stripExt } from './probe';

const FORM: I18nForm = 'namespaced-json';

async function parseJson(probe: FileProbe, ctx: AdapterContext): Promise<unknown | null> {
  try {
    return JSON.parse(await ctx.fileIO.readFile(probe.filePath));
  } catch {
    return null;
  }
}

/** Path shape: {dir}/{locale}/{ns}.json — exactly two segments after the locale dir. */
function localeNs(probe: FileProbe): { locale: string; namespace: string } | null {
  if (probe.ext !== '.json' || !probe.matchedLocaleDir) return null;
  const rest = probe.relToRoot.slice(probe.matchedLocaleDir.length + 1);
  const parts = rest.split('/');
  if (parts.length !== 2) return null;
  const locale = parts[0];
  const namespace = stripExt(parts[1]);
  if (!locale || !namespace) return null;
  return { locale, namespace };
}

export const NamespacedJsonAdapter: I18nFormatAdapter = {
  name: 'namespaced-json',
  form: FORM,
  priority: 10,
  writable: true,

  async detect(probe, ctx) {
    const info = localeNs(probe);
    if (!info) return false;
    const data = await parseJson(probe, ctx);
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  },

  async resolveKeyToValue(probe, key, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return null;
    return resolveKeyInData(data, key);
  },

  async resolveValueToKey(probe, value, locale, ctx) {
    const info = localeNs(probe);
    const data = await parseJson(probe, ctx);
    if (data === null) return null;
    const key = findKeyByValue(data, value);
    if (key === null) return null;
    const hit: ResolveHit = { key, value, locale, namespace: info?.namespace, form: FORM };
    return hit;
  },

  async listKeys(probe, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return [];
    return extractLeafKeys(data);
  },

  localeFor(probe) {
    return localeNs(probe);
  },
};
