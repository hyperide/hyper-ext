/**
 * @file Adapter registry + content-first discovery router.
 *
 * Accessed via: StyleReadService (extension) and useElementStyleData (SaaS), which call
 *   resolveByDisplayedText (grep-the-DOM-text path) and enumerateLocales (AST-key path).
 * Assumptions: detection is structural/AST only — NO embeddings/semantics. Adapters are
 *   tried most-specific-first; the first detect()===true wins (structure is exclusive).
 */

import { LOCALE_DIRS } from './locale-dirs';
import type { AdapterContext, FileProbe, I18nForm, I18nFormatAdapter } from './I18nFormatAdapter';
import { buildProbe } from './probe';
import { JsonLocaleAdapter } from './JsonLocaleAdapter';
import { NamespacedJsonAdapter } from './NamespacedJsonAdapter';
import { NextIntlMessagesAdapter } from './NextIntlMessagesAdapter';
import { ReactIntlCatalogAdapter } from './ReactIntlCatalogAdapter';
import { MergedTsAdapter } from './MergedTsAdapter';
import { FlatTsAdapter } from './FlatTsAdapter';
import { I18nextResourcesAdapter } from './I18nextResourcesAdapter';
import { DEFERRED_ADAPTERS } from './deferred';

/**
 * All adapters, ordered most-specific-first (ascending priority). The first detect()===true
 * wins; ties are impossible because detect() is structurally exclusive (a 2-segment
 * `{locale}/{ns}.json` cannot also be a 1-segment flat file). The deferred adapters sit
 * after the v1 set and never claim a file in v1 (detect() === false).
 */
export const ADAPTERS: I18nFormatAdapter[] = [
  NamespacedJsonAdapter, // 10
  NextIntlMessagesAdapter, // 20
  ReactIntlCatalogAdapter, // 30
  I18nextResourcesAdapter, // 40
  MergedTsAdapter, // 50
  FlatTsAdapter, // 55
  ...DEFERRED_ADAPTERS, // 58,60,70,72,74 (all disabled in v1)
  JsonLocaleAdapter, // 90 — generic JSON fallback, LAST
].sort((a, b) => a.priority - b.priority);

/** Content-first: first adapter whose structural detect() claims this file, or null. */
export async function detectAdapter(probe: FileProbe, ctx: AdapterContext): Promise<I18nFormatAdapter | null> {
  for (const adapter of ADAPTERS) {
    if (await adapter.detect(probe, ctx)) return adapter;
  }
  return null;
}

/**
 * Locales probed when the FileIO cannot list a directory. Mirrors the well-known set the
 * old discoverLayout / resolve-by-dom-text fall-throughs used, plus the requested locale so
 * a non-English-primary project still resolves.
 */
const PROBE_LOCALES = ['en', 'en-US', 'de', 'fr', 'es', 'ru', 'pl', 'zh', 'ja', 'pt', 'rs'];

/** Candidate locale files for content-first discovery, union of all known layouts. */
async function collectCandidatePaths(
  ctx: AdapterContext,
  activeLocale: string | undefined,
  supplied?: string[],
): Promise<string[]> {
  const out = new Set<string>(supplied ?? []);
  const listFiles = ctx.fileIO.listFiles?.bind(ctx.fileIO);
  if (listFiles) {
    for (const relDir of LOCALE_DIRS) {
      const dir = `${ctx.projectRoot}/${relDir}`;
      for (const f of await listFiles(dir, ['.json', '.ts', '.js']).catch(() => [] as string[])) out.add(f);
    }
    // App-Router messages live under app/, which is not in LOCALE_DIRS.
    const appDir = `${ctx.projectRoot}/app`;
    for (const f of await listFiles(appDir, ['.json']).catch(() => [] as string[])) out.add(f);
  } else {
    // No directory listing — probe well-known `{dir}/{locale}.{json,ts,js}` and namespaced
    // `{dir}/{locale}/{ns}.json` paths via access(), the way the old discoverLayout did. This
    // keeps getAvailableKeys / DOM-text resolution working under minimal FileIO hosts.
    const locales = activeLocale ? [activeLocale, ...PROBE_LOCALES] : PROBE_LOCALES;
    for (const relDir of LOCALE_DIRS) {
      const dir = `${ctx.projectRoot}/${relDir}`;
      for (const locale of locales) {
        for (const ext of ['.json', '.ts', '.js']) {
          await accessInto(out, ctx, `${dir}/${locale}${ext}`);
        }
        if (ctx.namespace) await accessInto(out, ctx, `${dir}/${locale}/${ctx.namespace}.json`);
      }
    }
  }
  // Merged single-file TS candidates (translations.ts etc.) — probed even without listFiles.
  for (const rel of MERGED_CANDIDATE_RELS) {
    await accessInto(out, ctx, `${ctx.projectRoot}/${rel}`);
  }
  return [...out];
}

/** Add `path` to `set` when it exists; swallow the not-found throw. */
async function accessInto(set: Set<string>, ctx: AdapterContext, path: string): Promise<void> {
  try {
    await ctx.fileIO.access(path);
    set.add(path);
  } catch {
    // not present
  }
}

/** Merged single-file translation candidates, probed directly (mirrors discoverMergedLayout). */
const MERGED_CANDIDATE_RELS = [
  'src/translations.ts',
  'src/lib/translations.ts',
  'client/lib/translations.ts',
  'lib/translations.ts',
  'src/i18n.ts',
  'src/translations.js',
  'src/lib/translations.js',
  'client/lib/translations.js',
  'lib/translations.js',
  'src/i18n.js',
];

export interface DisplayedTextResolution {
  key: string;
  value: string;
  locale: string;
  namespace?: string;
  form: I18nForm;
  availableLocales: string[];
  adapterName: string;
  writable: boolean;
}

/**
 * Content-first discovery: given displayed text, find the dictionary file, classify it via
 * detect(), recover the key via resolveValueToKey, and enumerate the locales that hold it.
 *
 * @param supplied optional caller-provided hit paths (e.g. a ripgrep of the literal string)
 *   that may live outside the standard locale dirs.
 */
export async function resolveByDisplayedText(
  text: string,
  locale: string,
  ctx: AdapterContext,
  supplied?: string[],
): Promise<DisplayedTextResolution | null> {
  if (!text.trim()) return null;

  const paths = await collectCandidatePaths(ctx, locale, supplied);

  interface Candidate {
    adapter: I18nFormatAdapter;
    probe: FileProbe;
    hitLocale: string;
  }
  const matched: Array<{ candidate: Candidate; key: string; namespace?: string; form: I18nForm; value: string }> = [];
  const detected: Candidate[] = [];

  for (const filePath of paths) {
    const probe = buildProbe(filePath, ctx.projectRoot);
    if (!probe) continue;
    const adapter = await detectAdapter(probe, ctx);
    if (!adapter) continue;
    const hitLocale = adapter.localeFor(probe)?.locale ?? locale;
    detected.push({ adapter, probe, hitLocale });
    const hit = await adapter.resolveValueToKey(probe, text, hitLocale, ctx);
    if (hit) {
      matched.push({
        candidate: { adapter, probe, hitLocale },
        key: hit.key,
        namespace: hit.namespace,
        form: hit.form,
        value: hit.value,
      });
    }
  }

  if (matched.length === 0) return null;

  // Deterministic ranking: prefer 'en', then keep first-found order (stable sort).
  matched.sort((a, b) => {
    const aEn = a.candidate.hitLocale === 'en';
    const bEn = b.candidate.hitLocale === 'en';
    if (aEn !== bEn) return aEn ? -1 : 1;
    return 0;
  });

  const best = matched[0];

  // availableLocales: every detected file whose adapter resolves best.key for its locale.
  const locales = new Set<string>([best.candidate.hitLocale]);
  for (const cand of detected) {
    if (cand.adapter.resolveKeyToValue) {
      const v = await cand.adapter.resolveKeyToValue(cand.probe, best.key, cand.hitLocale, ctx);
      if (v !== null) locales.add(cand.hitLocale);
    }
  }

  return {
    key: best.key,
    value: best.value,
    locale: best.candidate.hitLocale,
    namespace: best.namespace,
    form: best.form,
    availableLocales: [...locales],
    adapterName: best.candidate.adapter.name,
    writable: best.candidate.adapter.writable,
  };
}

/** A detected locale file: its adapter, probe, and the locale/namespace it serves (if path-derivable). */
interface EnumeratedProbe {
  adapter: I18nFormatAdapter;
  probe: FileProbe;
  /** Locale derived from the path, or undefined for whole-dictionary files (merged-ts, resources). */
  locale?: string;
  /** Namespace derived from the path (namespaced-json), or undefined. */
  namespace?: string;
}

/**
 * Enumerate every candidate locale file the registry can classify. Mirrors the key-direction
 * (AST detector) path: the caller picks the probe for the active locale and asks listKeys.
 * Whole-dictionary files (merged-ts / i18next-resources) carry no path locale — their
 * listKeys takes the requested locale directly.
 */
async function enumerateLocales(
  ctx: AdapterContext,
  activeLocale: string | undefined,
  supplied?: string[],
): Promise<EnumeratedProbe[]> {
  const paths = await collectCandidatePaths(ctx, activeLocale, supplied);
  const out: EnumeratedProbe[] = [];
  for (const filePath of paths) {
    const probe = buildProbe(filePath, ctx.projectRoot);
    if (!probe) continue;
    const adapter = await detectAdapter(probe, ctx);
    if (!adapter) continue;
    const info = adapter.localeFor(probe);
    out.push({ adapter, probe, locale: info?.locale, namespace: info?.namespace });
  }
  return out;
}

/**
 * All translation keys for the combobox, for the requested locale. Replaces the extension's
 * AdapterFactory + per-format I18nAdapter.getAvailableKeys: it picks the probe matching the
 * active locale (or a whole-dictionary file, or the first available), then delegates to the
 * winning adapter's listKeys. Returns [] when no dictionary is found.
 */
export async function listKeysForBinding(locale: string, ctx: AdapterContext, supplied?: string[]): Promise<string[]> {
  const all = await enumerateLocales(ctx, locale, supplied);
  if (all.length === 0) return [];

  // A project can hold many namespace files for one locale (locales/en/admin.json,
  // locales/en/common.json), and may ALSO have a flat per-locale file (locales/en.json). When
  // ctx.namespace is set, only files for that namespace are valid — otherwise we'd offer/write
  // keys against the wrong namespace. Eligible: the matching-namespace file, OR a whole-dictionary
  // file (merged-ts/resources/next-intl, which carry NO path locale and scope via key prefix).
  // A flat per-locale file (locale defined, namespace undefined) is NOT a namespace match —
  // UNLESS its adapter is namespacePrefixed (next-intl), where the namespace is a key prefix
  // inside the per-locale file and listKeys strips it; that catalog stays eligible.
  const enumerated = ctx.namespace
    ? all.filter((e) => e.namespace === ctx.namespace || e.locale === undefined || e.adapter.namespacePrefixed)
    : all;
  if (enumerated.length === 0) return [];

  // Prefer a file that serves exactly the requested locale; then a whole-dictionary file
  // (merged-ts/resources, which can list any locale); then the first per-locale file.
  const exact = enumerated.find((e) => e.locale === locale);
  const wholeDict = enumerated.find((e) => e.locale === undefined);
  const target = exact ?? wholeDict ?? enumerated[0];

  const keys = await target.adapter.listKeys(target.probe, locale, ctx);
  if (keys.length > 0) return keys;

  // Fall back to the first available locale's keys (matches the old adapter behavior when the
  // requested locale file is missing but a sibling locale exists).
  const fallback = enumerated.find((e) => e.locale !== undefined && e.locale !== locale);
  if (fallback) return fallback.adapter.listKeys(fallback.probe, fallback.locale ?? locale, ctx);
  return [];
}
