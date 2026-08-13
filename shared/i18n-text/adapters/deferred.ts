/**
 * @file Deferred i18n format adapters — registered placeholders, NOT half-built.
 *
 * Accessed via: the registry, after the v1 adapters. Each `detect()` returns false (the
 *   adapter is feature-flagged OFF in v1) so the registry never routes to an unimplemented
 *   resolver. They exist so the I18nForm taxonomy is complete and each follow-up ticket has
 *   a concrete anchor. Implementing one = flip its detect() + fill resolve, behind a flag.
 *
 * Follow-up tickets (one per form):
 *   - lingui-compiled-js (HYP-697): `const messages = JSON.parse('...')` — JSON.parse the
 *       string literal; write needs re-stringify-into-StringLiteral (own write path).
 *   - lingui-po          (HYP-698): `.po`/gettext — needs a line-structural parser (no babel).
 *   - vue-sfc-i18n       (HYP-699): `<i18n>` SFC block + inline createI18n({messages}); needs
 *       @vue/compiler-sfc + YAML body support.
 *   - yaml               (HYP-700): `.yml`/`.yaml` — needs a YAML parser; format-preserving
 *       write needs a CST (`yaml` lib).
 *   - aggregated-index   (HYP-701): `i18n/index.ts` re-exporting per-locale modules /
 *       getDictionary dynamic import() — needs cross-file import-specifier following; leaf
 *       files are already covered, so this is a resolver mapping locale -> module then delegating.
 * (i18next-resources write-back is tracked separately in HYP-702.)
 */

import type { I18nForm, I18nFormatAdapter } from './I18nFormatAdapter';

/** Build a registered-but-disabled adapter for a deferred form. */
function deferredAdapter(name: string, form: I18nForm, priority: number, writable: boolean): I18nFormatAdapter {
  return {
    name,
    form,
    priority,
    writable,
    // Disabled in v1: never claim a file, so the registry skips straight past.
    async detect() {
      return false;
    },
    async resolveKeyToValue() {
      return null;
    },
    async resolveValueToKey() {
      return null;
    },
    async listKeys() {
      return [];
    },
    localeFor() {
      return null;
    },
  };
}

const LinguiCompiledJsAdapter = deferredAdapter('lingui-compiled-js', 'lingui-compiled-js', 60, false);
const LinguiPoAdapter = deferredAdapter('lingui-po', 'lingui-po', 70, false);
const VueSfcI18nAdapter = deferredAdapter('vue-sfc-i18n', 'vue-sfc-i18n', 72, false);
const YamlLocaleAdapter = deferredAdapter('yaml-locale', 'yaml', 74, false);
const AggregatedIndexAdapter = deferredAdapter('aggregated-index', 'aggregated-index', 58, false);

/** All deferred adapters, in registry order. The only export — individual handles are internal. */
export const DEFERRED_ADAPTERS: I18nFormatAdapter[] = [
  AggregatedIndexAdapter,
  LinguiCompiledJsAdapter,
  LinguiPoAdapter,
  VueSfcI18nAdapter,
  YamlLocaleAdapter,
];
