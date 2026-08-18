/**
 * @file Unit tests for the pure esbuild.js browser-outfile parser.
 *
 * webview-bundles-superset.test.ts already exercises this module against the REAL
 * esbuild.js (integration-style). This file exercises `extractBrowserOutfiles`
 * against small synthetic fixtures so the parser's own contract — which contexts
 * it includes/excludes, and what it does when there's nothing to find — is
 * verified independently of today's real file content (HYP-1030 review finding:
 * the original test only covered the happy path of 8 real browser contexts).
 */
import { describe, expect, it } from 'bun:test';
import { checkBrowserBundleCoverage, extractBrowserOutfiles } from '../../scripts/lib/esbuild-browser-outfiles.mjs';

describe('extractBrowserOutfiles', () => {
  it('extracts the outfile of a single platform:browser context', () => {
    const source = `
      const ctx = await esbuild.context({
        entryPoints: ['src/foo.ts'],
        platform: 'browser',
        outfile: 'out/foo.js',
      });
    `;
    expect(extractBrowserOutfiles(source)).toEqual(['foo.js']);
  });

  it('excludes a platform:node context', () => {
    const source = `
      const ctx = await esbuild.context({
        entryPoints: ['src/extension.ts'],
        platform: 'node',
        outfile: 'out/extension.js',
      });
    `;
    expect(extractBrowserOutfiles(source)).toEqual([]);
  });

  it('extracts only the browser outfiles from a mix of node and browser contexts', () => {
    const source = `
      const nodeCtx = await esbuild.context({
        platform: 'node',
        outfile: 'out/extension.js',
      });
      const browserCtx = await esbuild.context({
        platform: 'browser',
        outfile: 'out/webview.js',
      });
      const anotherBrowserCtx = await esbuild.context({
        platform: 'browser',
        outfile: 'out/iframe-interaction.js',
      });
    `;
    expect(extractBrowserOutfiles(source)).toEqual(['webview.js', 'iframe-interaction.js']);
  });

  it('returns an empty array when there are no esbuild.context calls', () => {
    expect(extractBrowserOutfiles('const x = 1;')).toEqual([]);
  });

  it('skips a browser context with no outfile field', () => {
    const source = `
      const ctx = await esbuild.context({
        platform: 'browser',
        write: false,
      });
    `;
    expect(extractBrowserOutfiles(source)).toEqual([]);
  });

  it('skips a browser context whose outfile lacks the out/ prefix', () => {
    const source = `
      const ctx = await esbuild.context({
        platform: 'browser',
        outfile: 'dist/foo.js',
      });
    `;
    expect(extractBrowserOutfiles(source)).toEqual([]);
  });

  it('does not hang or throw on an unterminated esbuild.context block', () => {
    // extractBalancedBlock returns undefined when a '{' never balances (source ends
    // mid-object) — this pins the `if (!contextBlock) continue` branch instead of
    // an infinite loop or a thrown error.
    const source = `const ctx = await esbuild.context({ platform: 'browser', outfile: 'out/foo.js'`;
    expect(extractBrowserOutfiles(source)).toEqual([]);
  });

  it('finds outfile past a nested object literal (define/loader) without losing balance', () => {
    // A real object literal nested inside the context (e.g. esbuild.js's `define`/
    // `loader` maps) must not throw off extractBalancedBlock's depth count — this is
    // genuine `{`/`}` nesting, distinct from the (documented, out-of-scope) hazard of
    // braces INSIDE a string.
    const source = `
      const ctx = await esbuild.context({
        platform: 'browser',
        define: { 'process.env.NODE_ENV': '"production"' },
        loader: { '.css': 'text' },
        outfile: 'out/foo.js',
      });
    `;
    expect(extractBrowserOutfiles(source)).toEqual(['foo.js']);
  });
});

describe('checkBrowserBundleCoverage', () => {
  // Locks in the gate's own pass/fail branches (HYP-1030 review finding: the
  // original PR only tested extractBrowserOutfiles, not the CLI gate's decision
  // logic that consumes it — the exact "fails loudly instead of open" behavior
  // this whole ticket exists to guarantee).
  it('passes when derived and configured match exactly', () => {
    const result = checkBrowserBundleCoverage(
      ['webview.js', 'iframe-interaction.js'],
      ['webview.js', 'iframe-interaction.js'],
    );
    expect(result).toEqual({ ok: true });
  });

  it('fails with a stale-entry/parser-mismatch message when derived has fewer unique entries than configured', () => {
    const result = checkBrowserBundleCoverage(['webview.js'], ['webview.js', 'iframe-interaction.js']);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('STALE entry');
  });

  it('fails naming the missing outfile when esbuild.js has a bundle the config lacks', () => {
    const result = checkBrowserBundleCoverage(['webview.js', 'iframe-interaction.js'], ['webview.js']);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('iframe-interaction.js');
  });

  it('does not fail on a duplicate entry in the configured list (Set-based count)', () => {
    // BROWSER_BUNDLES accidentally listing the same bundle twice must not inflate
    // the floor and produce a false "parser found too few" failure.
    const result = checkBrowserBundleCoverage(['webview.js'], ['webview.js', 'webview.js']);
    expect(result).toEqual({ ok: true });
  });
});
