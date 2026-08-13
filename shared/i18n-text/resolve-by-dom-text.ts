/**
 * @file i18n key resolution by DOM text content (CONTENT-FIRST).
 *
 * Accessed via: StyleReadService i18n text inspection and key creation flows.
 * Assumptions: static TS/JS dictionaries are object literals; dynamic dictionary builders are read-only.
 *
 * Algorithm (path no longer gates discovery — content does):
 *   1. GREP the project for files whose CONTENT contains domText, recursively over
 *      .json/.ts/.js, skipping the shared scan-exclude dirs (node_modules, .git, …).
 *   2. For each hit, classify whether the file is an i18n DICTIONARY and in which FORM
 *      (flat / namespaced / app-router / merged-TS / single-TS).
 *   3. Search the dictionary for domText as a VALUE → dot-path key; else as a KEY
 *      (covers mock/passthrough t = k => k).
 *   4. Derive locale + namespace generically from the hit path (locale-code gated) or
 *      the dictionary shape (merged TS).
 *   5. Collect all matching locale dictionaries → availableLocales.
 *
 * When listFiles is unavailable (host with no recursive enumeration), fall back to a
 * conventional-path PROBE over FLAT_LOCALE_DIRS — a hint, not the primary mechanism.
 */

import type { FileIO } from '../../lib/ast/file-io';
import { isLocaleCode } from './locale-code';
import { isExcludedScanPath } from '../fs/scan-excludes';
// Single source of truth for locale dirs — shared with the adapter registry so the two
// historic copies (here + resolve-i18n-resource's FLAT_LOCALE_DIRS) cannot drift.
import { LOCALE_DIRS } from './adapters/locale-dirs';
import { findTsDomTextHit, parseTsLocaleObject, resolveLocaleKey } from './ts-locale-ast';

/** Extensions a translation dictionary can live in. */
const DICT_EXTENSIONS = ['.json', '.ts', '.js'];

const MERGED_FILE_CANDIDATES = [
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

export interface DomTextI18nMatch {
  key: string;
  /** The locale where the match was first found. */
  locale: string;
  /** The resolved text value in that locale. */
  resolvedText: string;
  namespace?: string;
  availableLocales: string[];
  /** 'value' = domText was a dictionary value; 'key' = domText was the key itself (passthrough mock). */
  matchType: 'value' | 'key';
}

/**
 * Cheap pre-filter for the content grep: is this file WORTH parsing as a dictionary
 * for `domText`? A plain `content.includes(domText)` is too strict and drops valid
 * dictionaries in two cases the downstream parse-based search handles correctly:
 *
 *   1. Passthrough KEY text (`common.greeting` shown verbatim): the raw file stores the
 *      key as nested JSON props (`"common": { "greeting": … }`), so the dotted string is
 *      never present — but the LAST segment (`greeting`) is.
 *   2. JSON/TS-escaped VALUES (`Click "OK"` stored as `Click \"OK\"`, or `\n`, unicode
 *      escapes): the cooked text isn't a substring of the raw source.
 *
 * This returns true for any file that PLAUSIBLY contains the text; the authoritative
 * gate is still the JSON.parse / parseTsLocaleObject + findByValue/findByKey downstream
 * (which compares against the COOKED string). Erring toward inclusion only costs an
 * extra parse of a small dictionary file; a false exclude would lose a real binding.
 */
function fileMightContain(content: string, domText: string): boolean {
  if (content.includes(domText)) return true;
  // Passthrough nested key: look for the deepest segment as a quoted-or-bare token.
  if (domText.includes('.')) {
    const last = domText.slice(domText.lastIndexOf('.') + 1);
    if (last && content.includes(last)) return true;
  }
  // Escaped value: normalize BOTH sides by removing the characters that differ between
  // a cooked string and its raw JSON/TS source (quotes, backslashes, whitespace), then
  // substring-test. This catches `Click "OK"` stored as `Click \"OK\"`, `\n`, etc.
  const strip = (s: string): string => s.replace(/["'`\\\s]/g, '');
  const looseText = strip(domText);
  if (looseText && looseText !== domText && strip(content).includes(looseText)) return true;
  return false;
}

/**
 * Recursively find domText as a dictionary VALUE.
 * Returns the dot-path key (e.g. "nested.greeting") or null if not found.
 */
function findByValue(obj: unknown, target: string, prefix = ''): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string' && v === target) return path;
    if (typeof v === 'object') {
      const found = findByValue(v, target, path);
      if (found !== null) return found;
    }
  }
  return null;
}

/**
 * Check if target is a valid key in the dictionary object (exact literal key, or dot-path traversal).
 * Returns the string value if found, null otherwise.
 */
function findByKey(obj: unknown, key: string): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  const o = obj as Record<string, unknown>;

  // Literal key (handles flat keys like "habits.walks" stored as single entry)
  if (Object.hasOwn(o, key) && typeof o[key] === 'string') return o[key] as string;

  // Dot-path traversal
  const parts = key.split('.');
  let cur: unknown = o;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === 'string' ? cur : null;
}

function stripExt(name: string): { base: string; ext: string } | null {
  for (const ext of DICT_EXTENSIONS) {
    if (name.endsWith(ext)) return { base: name.slice(0, -ext.length), ext };
  }
  return null;
}

/**
 * Derive {locale, namespace?} from ANY hit path by recognizing a locale-code segment.
 * Path is no longer trusted by directory NAME (no `locales/` assumption) — instead a
 * BCP-47-ish segment is located and the surrounding shape determines the form:
 *
 *   …/{locale}.{json,ts,js}                  → flat            (locale = basename)
 *   …/{locale}/{ns}.{json,ts,js}             → namespaced      (locale = dir, ns = basename)
 *   …/{locale}/messages/{file}.json          → app-router flat (locale = dir, no ns)
 *   …/{locale}/{seg…}/{leaf}.json            → namespaced      (ns = last dir before leaf)
 *
 * Returns null when no segment is a valid locale code (so a random `config/settings.json`
 * or `components/Button.json` is NOT mislabeled as a locale dictionary).
 */
function deriveLocaleFromPath(filePath: string): { locale: string; namespace?: string } | null {
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  if (parts.length === 0) return null;
  const fileName = parts[parts.length - 1];
  const stripped = stripExt(fileName);
  if (!stripped) return null;

  // Case A — flat: basename itself is a locale code → …/{locale}.ext
  if (isLocaleCode(stripped.base)) {
    return { locale: stripped.base };
  }

  // Case B/C — a directory segment is the locale code.
  // Walk from the deepest dir upward; the first locale-coded dir wins.
  const dirSegments = parts.slice(0, -1);
  for (let i = dirSegments.length - 1; i >= 0; i--) {
    if (!isLocaleCode(dirSegments[i])) continue;
    const after = dirSegments.slice(i + 1); // segments between {locale} and the file
    // app-router: {locale}/messages/{file}.json → flat (no namespace)
    if (after.length === 1 && after[0] === 'messages') {
      return { locale: dirSegments[i] };
    }
    // namespaced: {locale}/…/{ns-leaf}.ext — namespace is the file basename when the
    // locale dir directly parents the file, else the deepest dir under the locale.
    if (after.length === 0) {
      return { locale: dirSegments[i], namespace: stripped.base };
    }
    return { locale: dirSegments[i], namespace: after[after.length - 1] };
  }

  return null;
}

/** True when the hit path is the app-router shape …/{locale}/messages/{file}.json. */
function isAppRouterHit(filePath: string): boolean {
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  if (parts.length < 3) return false;
  // file is at parts[-1]; messages dir at parts[-2]; locale at parts[-3]
  return parts[parts.length - 2] === 'messages' && isLocaleCode(parts[parts.length - 3]);
}

/**
 * For a namespaced/app-router hit where {locale} is a directory, return the directory
 * that PARENTS the {locale} dir (so its siblings de/, fr/, … can be enumerated).
 * Returns null when the locale segment can't be located.
 */
function parentLocaleRoot(filePath: string, locale: string | undefined): string | null {
  if (!locale) return null;
  const sep = filePath.includes('\\') ? '\\' : '/';
  const parts = filePath.split(/[/\\]/).filter(Boolean);
  const idx = parts.lastIndexOf(locale);
  if (idx <= 0) return null;
  const prefix = filePath.startsWith('/') ? '/' : '';
  return prefix + parts.slice(0, idx).join(sep);
}

export async function resolveI18nByDomText(
  domText: string,
  projectRoot: string,
  fileIO: Pick<FileIO, 'readFile' | 'access'> & { listFiles?: FileIO['listFiles'] },
): Promise<DomTextI18nMatch | null> {
  if (!domText.trim()) return null;

  const listFiles = fileIO.listFiles?.bind(fileIO);

  // CONTENT-FIRST candidate collection. A "candidate" is a dictionary file we will
  // parse and search; `kind` is derived from extension, locale/ns from path shape.
  type Candidate = { filePath: string; kind: 'json' | 'ts' };
  const candidatePaths = new Set<string>();
  const candidates: Candidate[] = [];
  const pushCandidate = (filePath: string): void => {
    if (candidatePaths.has(filePath)) return;
    candidatePaths.add(filePath);
    candidates.push({ filePath, kind: filePath.endsWith('.json') ? 'json' : 'ts' });
  };

  // The directories that produced a content hit — used afterwards to enumerate
  // sibling locale files for availableLocales (path no longer assumed conventional).
  const hitDirs = new Set<string>();

  if (listFiles) {
    // GREP: enumerate every dict-extension file under the project, skip excluded dirs,
    // and keep files whose CONTENT contains the DOM text. This REPLACES the old
    // LOCALE_DIRS / MERGED_FILE_CANDIDATES / app-router PROBE as the primary mechanism.
    const allFiles = await listFiles(projectRoot, DICT_EXTENSIONS).catch(() => [] as string[]);
    for (const filePath of allFiles) {
      if (isExcludedScanPath(filePath.slice(projectRoot.length))) continue;
      let content: string;
      try {
        content = await fileIO.readFile(filePath);
      } catch {
        continue;
      }
      if (!fileMightContain(content, domText)) continue;
      pushCandidate(filePath);
      hitDirs.add(filePath.slice(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))));
    }
  } else {
    // No listFiles (host without recursive enumeration): fall back to the conventional
    // PROBE — a hint, not the gate. Probe well-known dirs for a small locale set.
    for (const relDir of LOCALE_DIRS) {
      const dir = `${projectRoot}/${relDir}`;
      for (const locale of ['en', 'de', 'fr', 'es', 'ru', 'pl', 'zh', 'ja', 'pt']) {
        const f = `${dir}/${locale}.json`;
        try {
          await fileIO.access(f);
          pushCandidate(f);
          hitDirs.add(dir);
        } catch {
          // not found
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Search candidates — value then key. Each file is classified as a dictionary FORM
  // before its locale/namespace is trusted (deriveLocaleFromPath + parseTsLocaleObject).
  interface Hit {
    key: string;
    locale: string;
    namespace?: string;
    resolvedText: string;
    matchType: 'value' | 'key';
  }
  const hits: Hit[] = [];

  for (const { filePath, kind } of candidates) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
      continue;
    }

    if (kind === 'ts') {
      // TS/JS dictionary gate: must parse to a recognized dictionary object literal.
      // Merged dicts carry their own locales; single dicts need a path-derived locale.
      const parsed = parseTsLocaleObject(content);
      if (!parsed) continue;
      const pathInfo = deriveLocaleFromPath(filePath);
      // A single-locale TS dict with no locale-coded path is not a usable locale file.
      if (parsed.kind === 'single' && !pathInfo) continue;
      const hit = findTsDomTextHit(parsed, domText, filePath, pathInfo?.locale);
      if (hit) {
        hits.push({
          key: hit.key,
          locale: hit.locale,
          namespace: pathInfo?.namespace,
          resolvedText: hit.resolvedText,
          matchType: hit.matchType,
        });
      }
      continue;
    }

    // JSON dictionary gate: must JSON.parse AND sit at a locale-coded path.
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }
    const info = deriveLocaleFromPath(filePath);
    if (!info) continue;

    // Pass 1: value search
    const keyByValue = findByValue(data, domText);
    if (keyByValue !== null) {
      hits.push({
        key: keyByValue,
        locale: info.locale,
        namespace: info.namespace,
        resolvedText: domText,
        matchType: 'value',
      });
      continue;
    }

    // Pass 2: key search (domText IS the key — mock/passthrough pattern)
    const valueByKey = findByKey(data, domText);
    if (valueByKey !== null) {
      hits.push({
        key: domText,
        locale: info.locale,
        namespace: info.namespace,
        resolvedText: valueByKey,
        matchType: 'key',
      });
    }
  }

  if (hits.length === 0) return null;

  // Prefer value matches over key matches, then prefer 'en' locale
  hits.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === 'value' ? -1 : 1;
    if (a.locale === 'en' && b.locale !== 'en') return -1;
    if (b.locale === 'en' && a.locale !== 'en') return 1;
    return 0;
  });

  const best = hits[0];

  // Second pass — availableLocales: the content grep only surfaced the ONE file holding
  // the visible text, so enumerate SIBLING dictionary files (same dirs as the hits, plus
  // the parents of any {locale} dir for namespaced/app-router layouts) and check which
  // locales carry the same key. Merged TS dicts already enumerate their own locales.
  const siblingPaths = new Set<string>(candidatePaths);
  if (listFiles) {
    const enumDirs = new Set<string>(hitDirs);
    // For a namespaced/app-router hit (locale lives in a dir, not the basename), the
    // sibling locales live under the locale dir's PARENT — add it so de/, fr/, … surface.
    for (const c of candidates) {
      const info = deriveLocaleFromPath(c.filePath);
      if (!info?.namespace && !isAppRouterHit(c.filePath)) continue;
      const parent = parentLocaleRoot(c.filePath, info?.locale);
      if (parent) enumDirs.add(parent);
    }
    for (const dir of enumDirs) {
      const files = await listFiles(dir, DICT_EXTENSIONS).catch(() => [] as string[]);
      for (const f of files) {
        if (!isExcludedScanPath(f.slice(projectRoot.length))) siblingPaths.add(f);
      }
    }
  }

  const extraLocales: string[] = [];
  for (const filePath of siblingPaths) {
    let content: string;
    try {
      content = await fileIO.readFile(filePath);
    } catch {
      continue;
    }
    const kind: 'json' | 'ts' = filePath.endsWith('.json') ? 'json' : 'ts';
    if (kind === 'ts') {
      const parsed = parseTsLocaleObject(content);
      if (!parsed) continue;
      if (parsed.kind === 'merged') {
        for (const locale of parsed.locales) {
          if (resolveLocaleKey(parsed.data[locale], best.key) !== null) extraLocales.push(locale);
        }
      } else if (resolveLocaleKey(parsed.data, best.key) !== null) {
        const info = deriveLocaleFromPath(filePath);
        if (info) extraLocales.push(info.locale);
      }
      continue;
    }
    let data: unknown;
    try {
      data = JSON.parse(content);
    } catch {
      continue;
    }
    const info = deriveLocaleFromPath(filePath);
    if (!info) continue;
    if (info.namespace !== best.namespace) continue;
    // Check if this locale has the same key
    const val = findByKey(data, best.key);
    if (val !== null) extraLocales.push(info.locale);
  }

  const availableLocales = [...new Set([...hits.map((h) => h.locale), ...extraLocales])];

  return {
    key: best.key,
    locale: best.locale,
    resolvedText: best.resolvedText,
    namespace: best.namespace,
    availableLocales,
    matchType: best.matchType,
  };
}
