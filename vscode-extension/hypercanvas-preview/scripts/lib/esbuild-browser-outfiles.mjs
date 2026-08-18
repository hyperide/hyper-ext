/**
 * @file Extracts browser bundle outfiles declared by esbuild contexts.
 *
 * Accessed via: the webview bundle CLI gate and its unit test, both of which pass
 * the raw esbuild.js source so their coverage list cannot silently drift.
 *
 * Assumptions: each context starts with `esbuild.context({` and declares literal
 * `platform` and `outfile` values inside that context's balanced object block.
 *
 * Hard precondition (HYP-1030 review finding): `extractBalancedBlock` counts raw
 * `{`/`}` characters with no lexer, so it does NOT understand string, template
 * literal, or comment contents. A context block containing a brace inside a string
 * (e.g. a `banner`/`footer` JS payload like `{ js: 'globalThis.x ||= {};' }`) or a
 * commented-out `esbuild.context({...})` will misparse. Today's esbuild.js has
 * neither, so this is safe in practice — but if you add one, this parser must be
 * upgraded (or the offending block special-cased) in the SAME change, since the
 * caller's fail-open guard only catches a parser that finds too FEW contexts, not
 * one that silently extracts a wrong or extra outfile from a miscounted block.
 *
 * Accepted residual gap (HYP-1030 review finding, deliberately not fixed here — see
 * ticket for scope): this is a heuristic textual scan, not a real JS parser. A BRAND
 * NEW `platform:'browser'` context added with an unusual call spelling (extra
 * whitespace: `esbuild.context( {`) or a non-literal `outfile` (e.g. a template
 * literal or `path.join(...)`) is invisible to `extractBrowserOutfiles` — and since
 * it's new, it's also absent from BROWSER_BUNDLES, so `checkBrowserBundleCoverage`'s
 * count-based floor can't distinguish "nothing changed" from "one new bundle both
 * sides silently agree to ignore." Every existing call site in esbuild.js uses the
 * exact same style this parser expects, so this is a real but narrow gap: it does
 * NOT protect against a differently-styled brand-new addition, only against BROWSER_
 * BUNDLES drifting from a NORMALLY-STYLED esbuild.js (the 3-bundle gap this ticket
 * fixes, and the removal/stale-entry case). Closing it fully would need a real AST
 * parse (e.g. via the extension's existing @babel/parser dependency) to handle
 * arbitrary formatting — and even that can't resolve a genuinely computed outfile
 * expression. Out of scope for this change; flag in code review if you add a
 * differently-styled esbuild.context call.
 */

const CONTEXT_START = 'esbuild.context({';

function extractBalancedBlock(source, openBraceIndex) {
  let depth = 0;

  for (let index = openBraceIndex; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] === '}') depth -= 1;
    if (depth === 0) return source.slice(openBraceIndex, index + 1);
  }

  return undefined;
}

export function extractBrowserOutfiles(esbuildSource) {
  const outfiles = [];
  let searchIndex = 0;

  while (searchIndex < esbuildSource.length) {
    const contextIndex = esbuildSource.indexOf(CONTEXT_START, searchIndex);
    if (contextIndex === -1) break;

    const openBraceIndex = contextIndex + CONTEXT_START.length - 1;
    const contextBlock = extractBalancedBlock(esbuildSource, openBraceIndex);
    searchIndex = openBraceIndex + 1;
    if (!contextBlock) continue;

    const isBrowser = /platform:\s*['"]browser['"]/.test(contextBlock);
    const outfileMatch = contextBlock.match(/outfile:\s*['"]out\/([^'"]+)['"]/);
    if (isBrowser && outfileMatch) outfiles.push(outfileMatch[1]);
  }

  return outfiles;
}

/**
 * Decides whether the gate's BROWSER_BUNDLES coverage self-check should fail, and
 * with what message. Pure and side-effect-free (no readFileSync/process.exit) so
 * the CLI gate's failure branches are unit-testable without a real esbuild.js/out/
 * on disk (HYP-1030 review finding).
 *
 * Two distinct failure modes, checked in order:
 *  1. `derivedOutfiles` (from esbuild.js) has fewer UNIQUE entries than
 *     `configuredBundles` (BROWSER_BUNDLES) — either extractBrowserOutfiles's parser
 *     regressed (esbuild.js restructured in a way it can't follow) or a bundle was
 *     removed from esbuild.js and BROWSER_BUNDLES has a stale leftover entry. This
 *     is checked FIRST and takes priority over case 2 below, since a parser that
 *     found too few contexts can't be trusted to report accurate "missing" outfiles
 *     either. Compares Set sizes (not raw .length) so a duplicate in either list
 *     can't skew the count.
 *  2. A derived outfile isn't present in `configuredBundles` — esbuild.js declared
 *     a new platform:'browser' context that BROWSER_BUNDLES hasn't been updated to
 *     scan yet.
 *
 * One-directional by design: this never flags a BROWSER_BUNDLES entry with no
 * matching esbuild.js context (a stale entry after a bundle's removal, where case 1
 * doesn't also trip) — the CLI gate's own per-bundle `out/*.js` existence check
 * catches that case with its own clear error.
 */
export function checkBrowserBundleCoverage(derivedOutfiles, configuredBundles) {
  const derivedCount = new Set(derivedOutfiles).size;
  const configuredCount = new Set(configuredBundles).size;

  if (derivedCount < configuredCount) {
    return {
      ok: false,
      message:
        `BROWSER_BUNDLES lists ${configuredCount} unique bundle(s) but only ${derivedCount} unique ` +
        "platform:'browser' context(s) were found in esbuild.js. Most likely BROWSER_BUNDLES has a " +
        'STALE entry left over from a bundle removed from esbuild.js — remove it. If every entry still ' +
        'has a real esbuild.js context, the parser (scripts/lib/esbuild-browser-outfiles.mjs) failed to ' +
        'recognize one — check its file-header precondition.',
    };
  }

  const missing = [...new Set(derivedOutfiles)].filter((bundle) => !configuredBundles.includes(bundle));
  if (missing.length > 0) {
    return {
      ok: false,
      message:
        `BROWSER_BUNDLES is missing browser outfile(s) declared in esbuild.js: ${missing.join(', ')}\n` +
        'Add them to BROWSER_BUNDLES in scripts/check-webview-bundles.mjs.',
    };
  }

  return { ok: true };
}
