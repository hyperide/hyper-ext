/**
 * @file I18nextResourcesAdapter — translations declared INLINE in i18n.init({resources}),
 *   addResourceBundle(locale, ns, obj), or createI18n({messages}). Closes the gap where
 *   inline-init translations were invisible to the locale-file scanners.
 *
 * Accessed via: the adapter registry, in the TS/JS tier. READ-ONLY in v1 — writing back
 *   into a two-level inline ObjectExpression is a separate write path (follow-up ticket).
 * Assumptions: resources are static object literals. Detection requires the i18next family
 *   (library i18next / react-i18next) so a stray `init({resources})` in an unrelated lib
 *   is not misclassified. Namespace defaults to 'translation'.
 */

import { parseI18nextResources, type I18nextResources } from './i18next-resources-ast';
import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter, ResolveHit } from './I18nFormatAdapter';
import { extractLeafKeys, findKeyByValue, resolveKeyInData } from './probe';

const FORM: I18nForm = 'i18next-resources';
const DEFAULT_NS = 'translation';

function isI18nextFamily(ctx: AdapterContext): boolean {
  return ctx.library === 'i18next' || ctx.library === 'react-i18next';
}

async function read(probe: FileProbe, ctx: AdapterContext): Promise<I18nextResources | null> {
  if (probe.ext !== '.ts' && probe.ext !== '.js') return null;
  let content: string;
  try {
    content = await ctx.fileIO.readFile(probe.filePath);
  } catch {
    return null;
  }
  return parseI18nextResources(content);
}

function nsData(resources: I18nextResources, locale: string, ns: string): Record<string, unknown> | null {
  const bucket = resources[locale];
  if (!bucket) return null;
  const data = bucket[ns] ?? bucket[DEFAULT_NS];
  return data && typeof data === 'object' ? (data as Record<string, unknown>) : null;
}

export const I18nextResourcesAdapter: I18nFormatAdapter = {
  name: 'i18next-resources',
  form: FORM,
  priority: 40,
  writable: false,

  async detect(probe, ctx) {
    if (!isI18nextFamily(ctx)) return false;
    const resources = await read(probe, ctx);
    return resources !== null && Object.keys(resources).length > 0;
  },

  async resolveKeyToValue(probe, key, locale, ctx) {
    const resources = await read(probe, ctx);
    if (!resources) return null;
    const data = nsData(resources, locale, ctx.namespace ?? DEFAULT_NS);
    if (!data) return null;
    return resolveKeyInData(data, key);
  },

  async resolveValueToKey(probe, value, locale, ctx) {
    const resources = await read(probe, ctx);
    if (!resources) return null;
    const data = nsData(resources, locale, ctx.namespace ?? DEFAULT_NS);
    if (!data) return null;
    const key = findKeyByValue(data, value);
    if (key === null) return null;
    const hit: ResolveHit = { key, value, locale, namespace: ctx.namespace, form: FORM };
    return hit;
  },

  async listKeys(probe, locale, ctx) {
    const resources = await read(probe, ctx);
    if (!resources) return [];
    const data = nsData(resources, locale, ctx.namespace ?? DEFAULT_NS);
    return data ? extractLeafKeys(data) : [];
  },

  // Resources hold every locale inline, so a single probe cannot name one locale.
  localeFor() {
    return null;
  },
};
