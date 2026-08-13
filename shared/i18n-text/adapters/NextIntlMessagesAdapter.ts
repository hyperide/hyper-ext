/**
 * @file NextIntlMessagesAdapter — next-intl `messages/{locale}.json` (and App-Router
 *   `app/{locale}/messages/*.json`), where the namespace is a KEY PREFIX, not a directory.
 *
 * Accessed via: the adapter registry, ahead of generic JSON (the NS prefix would otherwise
 *   be missed). Assumptions: library is next-intl; the JSON value is an object whose top
 *   keys are message namespaces. Lifts the App-Router/messages layout (resolve-i18n-resource
 *   L181-205) and ADDS the namespace-as-key-prefix on resolve.
 */

import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys, findKeyByValue, resolveKeyInData, stripExt } from './probe';

const FORM: I18nForm = 'next-intl-messages';

/** `messages/{locale}.json` (flat) or App-Router `app/{locale}/messages/{file}.json`. */
function localeOf(probe: FileProbe): string | null {
  if (probe.ext !== '.json') return null;
  const parts = probe.segments;
  // messages/{locale}.json
  if (parts.length === 2 && parts[0] === 'messages') return stripExt(parts[1]);
  // app/{locale}/messages/{file}.json
  if (parts.length === 4 && parts[0] === 'app' && parts[2] === 'messages') return parts[1];
  return null;
}

async function parseJson(probe: FileProbe, ctx: AdapterContext): Promise<unknown | null> {
  try {
    return JSON.parse(await ctx.fileIO.readFile(probe.filePath));
  } catch {
    return null;
  }
}

/** Prefix the namespace onto the key, the way next-intl scopes useTranslations('NS'). */
function withNs(namespace: string | undefined, key: string): string {
  return namespace ? `${namespace}.${key}` : key;
}

export const NextIntlMessagesAdapter: I18nFormatAdapter = {
  name: 'next-intl-messages',
  form: FORM,
  priority: 20,
  writable: true,
  // next-intl scopes useTranslations('NS') as a key prefix inside messages/{locale}.json,
  // so the file carries a path locale but no path namespace — the registry filter must
  // keep it on a namespaced binding even though e.namespace is undefined.
  namespacePrefixed: true,

  async detect(probe, ctx) {
    if (ctx.library !== 'next-intl') return false;
    if (localeOf(probe) === null) return false;
    const data = await parseJson(probe, ctx);
    return typeof data === 'object' && data !== null && !Array.isArray(data);
  },

  async resolveKeyToValue(probe, key, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return null;
    return resolveKeyInData(data, withNs(ctx.namespace, key));
  },

  async resolveValueToKey(probe, value, locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return null;
    const fullKey = findKeyByValue(data, value);
    if (fullKey === null) return null;
    // Strip the namespace prefix from the reported key so the UI shows the scoped key.
    const prefix = ctx.namespace ? `${ctx.namespace}.` : '';
    const key = prefix && fullKey.startsWith(prefix) ? fullKey.slice(prefix.length) : fullKey;
    const hit: ResolveHit = { key, value, locale, namespace: ctx.namespace, form: FORM };
    return hit;
  },

  async listKeys(probe, _locale, ctx) {
    const data = await parseJson(probe, ctx);
    if (data === null) return [];
    const all = extractLeafKeys(data);
    if (!ctx.namespace) return all;
    const prefix = `${ctx.namespace}.`;
    return all.filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length));
  },

  localeFor(probe) {
    const locale = localeOf(probe);
    return locale ? { locale } : null;
  },
};
