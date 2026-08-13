/**
 * @file I18nFormatAdapter — content-first, AST/deterministic per-format i18n adapter contract.
 *
 * Accessed via: the adapter registry (registry.ts), which is consumed by
 *   StyleReadService (VS Code extension) and useElementStyleData (SaaS inspector).
 * Assumptions: pure logic; all host I/O is injected through `AdapterFileIO`. Detection
 *   and resolution are 100% structural/AST — NO embeddings, NO semantic classification.
 *
 * This contract SUBSUMES the older extension `I18nAdapter` (resolve-only, library-selected):
 *   getAvailableKeys -> listKeys, resolveText -> resolveKeyToValue. It ADDS the
 *   content-first pieces: detect() (per-file structural gate) and resolveValueToKey()
 *   (displayed-text -> key direction, the DOM-text recovery path).
 */

import type { FileIO } from '../../../lib/ast/file-io';
import type { I18nLibrary } from '../types';

/** I/O surface an adapter is allowed to touch. Writes are optional and gated by `writable`. */
type AdapterFileIO = Pick<FileIO, 'readFile' | 'access'> & {
  writeFile?: FileIO['writeFile'];
  listFiles?: FileIO['listFiles'];
};

/**
 * Shared per-resolution context. `library`/`namespace` come from the deterministic
 * detectors (detect-i18n-package reads package.json deps; detect-i18n-binding reads the
 * call/hook AST). Neither involves embeddings or semantic inference.
 */
export interface AdapterContext {
  projectRoot: string;
  fileIO: AdapterFileIO;
  /** From detect-i18n-package (package.json). null = unknown library. */
  library: I18nLibrary | null;
  /** From detect-i18n-binding (hook arg / `ns:key` / inline `{ ns }`). */
  namespace?: string;
}

/**
 * One probe per candidate file, computed once by the registry and passed to every
 * adapter's detect(). Cheap path/extension facts only — adapters read content lazily
 * through `ctx.fileIO` when their path gate matches.
 */
export interface FileProbe {
  /** Absolute path to the candidate locale file. */
  filePath: string;
  /** Lowercased file extension. */
  ext: '.json' | '.ts' | '.js' | '.yml' | '.yaml' | '.po' | '.vue';
  /** Path relative to `projectRoot`, POSIX-separated. */
  relToRoot: string;
  /** `relToRoot.split('/')`. */
  segments: string[];
  /** Which LOCALE_DIRS entry this file sits under, if any (the longest match). */
  matchedLocaleDir?: string;
}

/** Stable structural family of a locale file. Reported on every hit. */
export type I18nForm =
  | 'flat-json'
  | 'nested-json'
  | 'namespaced-json'
  | 'next-intl-messages'
  | 'react-intl-catalog'
  | 'merged-ts'
  | 'flat-ts'
  | 'i18next-resources'
  | 'lingui-compiled-js'
  | 'lingui-po'
  | 'vue-sfc-i18n'
  | 'yaml'
  | 'aggregated-index'
  | 'dynamic-unsupported';

/** A value->key (or key->value) match, carrying the form/namespace learned in one shot. */
export interface ResolveHit {
  key: string;
  value: string;
  locale: string;
  namespace?: string;
  form: I18nForm;
}

export interface I18nFormatAdapter {
  /** Stable id, e.g. 'namespaced-json'. */
  readonly name: string;
  /** Structural family this adapter reports. */
  readonly form: I18nForm;
  /** Lower = more specific = tried first by the registry. */
  readonly priority: number;
  /** True when resolveValueToKey/write can be safely backed (JSON + static TS object). */
  readonly writable: boolean;

  /**
   * True when this form scopes the active namespace as a KEY PREFIX inside a per-locale
   * file (next-intl), rather than by path/directory. Such a file reports a path locale but
   * no path namespace, yet still serves `ctx.namespace` via listKeys' prefix strip — so the
   * registry's namespace filter must keep it. Path-namespaced forms leave this falsy.
   */
  readonly namespacePrefixed?: boolean;

  /**
   * DETERMINISTIC structural/AST gate. NO content semantics. Cheap path/ext checks
   * first; JSON.parse / babel-parse only when the path gate matches. Returns true iff
   * THIS file is THIS form.
   */
  detect(probe: FileProbe, ctx: AdapterContext): Promise<boolean>;

  /** key (+ ctx.namespace) -> displayed text for `locale`. null = missing key/locale. */
  resolveKeyToValue(probe: FileProbe, key: string, locale: string, ctx: AdapterContext): Promise<string | null>;

  /**
   * displayed text -> key (content-grep / DOM-text direction). null = value not in this
   * file. Returns the structured hit so the caller learns key + form + namespace at once.
   */
  resolveValueToKey(probe: FileProbe, value: string, locale: string, ctx: AdapterContext): Promise<ResolveHit | null>;

  /** All dot-path keys for `locale` (combobox). Carries over the old getAvailableKeys. */
  listKeys(probe: FileProbe, locale: string, ctx: AdapterContext): Promise<string[]>;

  /** locale<->filePath mapping for this form. null when the probe is not this form. */
  localeFor(probe: FileProbe): { locale: string; namespace?: string } | null;
}
