/**
 * @file JsonLocaleAdapter — generic single-locale JSON dictionary (flat + nested).
 *
 * Accessed via: the adapter registry, as the LAST (generic) JSON fallback.
 * Assumptions: layout is `{dir}/{locale}.json` under a known locale dir; the parsed
 *   value is an object. Flat (literal-dotted keys) and nested objects share this layout —
 *   the reported `form` is decided at resolve time (literal hit = flat, traversal = nested).
 *   This lifts `discoverLayout` flat-JSON + `resolveKey` + `findByValue` verbatim.
 */

import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys, findKeyByValue, resolveKeyInData, stripExt } from './probe';

async function parseJson(probe: FileProbe, ctx: AdapterContext): Promise<unknown | null> {
  let content: string;
  try {
    content = await ctx.fileIO.readFile(probe.filePath);
  } catch {
    return null;
  }
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** flat vs nested is decided by whether the leaf was reached by a literal key or by traversal. */
function formOfKey(data: unknown, key: string): I18nForm {
  // Object(data) === data is true only for non-null objects/functions; avoids the explicit
  // `data !== null` comparison CodeQL flags as inconvertible-types.
  if (Object(data) === data && Object.hasOwn(data as Record<string, unknown>, key)) {
    return 'flat-json';
  }
  return 'nested-json';
}

export const JsonLocaleAdapter: I18nFormatAdapter = {
  name: 'json-locale',
  form: 'flat-json',
  priority: 90,
  writable: true,

  async detect(probe, ctx) {
    if (probe.ext !== '.json') return false;
    if (!probe.matchedLocaleDir) return false;
    // 1-segment-after-dir: {dir}/{locale}.json — reject 2-segment namespaced files.
    const rest = probe.relToRoot.slice(probe.matchedLocaleDir.length + 1);
    if (rest.includes('/')) return false;
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
    const hit: ResolveHit = { key, value, locale, form: formOfKey(data, key) };
    return hit;
  },

  async listKeys(probe, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return [];
    return extractLeafKeys(data);
  },

  localeFor(probe) {
    if (probe.ext !== '.json' || !probe.matchedLocaleDir) return null;
    const rest = probe.relToRoot.slice(probe.matchedLocaleDir.length + 1);
    if (rest.includes('/')) return null;
    return { locale: stripExt(rest) };
  },
};
