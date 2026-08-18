/**
 * @file Ensures the webview bundle gate covers every browser esbuild context.
 *
 * Accessed via: the extension unit suite, which compares the gate's literal
 * BROWSER_BUNDLES list with browser outfiles parsed from esbuild.js.
 *
 * Assumptions: BROWSER_BUNDLES remains a literal string array so the test checks
 * the same explicit scan list used by the CLI gate.
 */
import { readFileSync } from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'bun:test';
import { extractBrowserOutfiles } from '../../scripts/lib/esbuild-browser-outfiles.mjs';

const esbuildSource = readFileSync(path.resolve(import.meta.dir, '../../esbuild.js'), 'utf8');
const gateSource = readFileSync(path.resolve(import.meta.dir, '../../scripts/check-webview-bundles.mjs'), 'utf8');

const bundlesMatch = gateSource.match(/const BROWSER_BUNDLES\s*=\s*\[([\s\S]*?)\];/);
if (!bundlesMatch) throw new Error('BROWSER_BUNDLES array not found in check-webview-bundles.mjs');

const browserBundles = [...bundlesMatch[1].matchAll(/['"]([^'"]+)['"]/g)].map((match) => match[1]);
const browserOutfiles = extractBrowserOutfiles(esbuildSource);

describe('webview bundle gate coverage', () => {
  // This count is a sanity floor, not an incidental detail: it's what stops a
  // parser regression (e.g. extractBrowserOutfiles returning []) from making the
  // per-outfile loop below run zero times and vacuously "pass" (HYP-1030 review
  // finding). If esbuild.js legitimately gains/loses a platform:'browser' context,
  // bump this number in the SAME commit as that esbuild.js change.
  it('derives all eight browser outfiles from esbuild.js', () => {
    expect(browserOutfiles).toHaveLength(8);
  });

  for (const outfile of browserOutfiles) {
    it(`BROWSER_BUNDLES contains "${outfile}"`, () => {
      expect(browserBundles).toContain(outfile);
    });
  }
});
