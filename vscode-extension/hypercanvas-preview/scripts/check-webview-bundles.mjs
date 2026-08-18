#!/usr/bin/env node
/**
 * Build gate: browser webview bundles must NOT contain node-only libraries or
 * raw Node globals. esbuild's `platform: 'browser'` only ERRORS on unresolvable
 * `node:*` imports at build time; it happily bundles libraries like `@babel/*`
 * that reference `process.env` at module init, which then throw
 * `ReferenceError: process is not defined` at runtime in the webview — a blank
 * preview / dead panel with no error in the Extension Host log (HYP-747 gate hole).
 *
 * This gate scans the BUILT bundles (run after `node esbuild.js --production`) for
 * forbidden substrings and fails the build if any leak in. Run in CI right after
 * the extension-build step.
 *
 * Usage: node scripts/check-webview-bundles.mjs
 * Exit 0 = clean, exit 1 = a forbidden token leaked into a browser bundle.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkBrowserBundleCoverage, extractBrowserOutfiles } from './lib/esbuild-browser-outfiles.mjs';

const extensionDir = dirname(dirname(fileURLToPath(import.meta.url)));
const outDir = join(extensionDir, 'out');

// Every browser (platform:'browser') webview bundle. These run in a webview with
// no Node runtime — any of the patterns below crashes them at load.
const BROWSER_BUNDLES = [
  'webview.js',
  'webview-left.js',
  'webview-right.js',
  'webview-preview-panel.js',
  'webview-ai-chat.js',
  'iframe-interaction.js',
  'iframe-error-detection.js',
  'iframe-console-capture.js',
];

// Forbidden tokens. `process.X` access (other than `typeof process`) throws when
// `process` is undefined; `@babel/*` and `node:*` builtins are node-only deps that
// must be stubbed/kept out of the browser graph (see createWebviewPlugins).
const FORBIDDEN = [
  { token: '@babel', why: 'node-only AST lib — stub it out of the webview graph' },
  { token: 'process.env.', why: 'raw Node global — undefined in webview, throws at load' },
  { token: 'process.cwd', why: 'raw Node global — undefined in webview' },
  { token: 'process.platform', why: 'raw Node global — undefined in webview' },
  { token: 'process.versions', why: 'raw Node global — undefined in webview' },
  { token: 'node:fs', why: 'node builtin in a browser bundle' },
  { token: 'node:path', why: 'node builtin in a browser bundle' },
  { token: 'node:crypto', why: 'node builtin in a browser bundle' },
];

// Proven false positives: inert substrings (NOT executable code) that happen to
// contain a forbidden token. Stripped before scanning. Keep this list tiny and
// each entry justified — never add a real code reference here.
const ALLOWLIST = [
  // tailwindcss/package.json `postbuild` script text, bundled as data via a
  // `tailwindcss/colors` import. It's a JSON string, never evaluated as code.
  '--define:process.env.CSS_TRANSFORMER_WASM=false',
];

// Self-check (HYP-1030): BROWSER_BUNDLES above must be a superset of every
// platform:'browser' esbuild.js context, so a newly-added browser bundle can't
// silently ship unscanned. See checkBrowserBundleCoverage's doc comment for the
// exact failure modes this catches (and the one it deliberately doesn't).
const esbuildJsPath = join(extensionDir, 'esbuild.js');
if (!existsSync(esbuildJsPath)) {
  console.error(`✗ esbuild.js not found at ${esbuildJsPath} — can't verify BROWSER_BUNDLES coverage.`);
  process.exit(1);
}
const esbuildSource = readFileSync(esbuildJsPath, 'utf-8');
const coverage = checkBrowserBundleCoverage(extractBrowserOutfiles(esbuildSource), BROWSER_BUNDLES);
if (!coverage.ok) {
  console.error(`✗ ${coverage.message}`);
  process.exit(1);
}

let failed = false;
for (const bundle of BROWSER_BUNDLES) {
  const p = join(outDir, bundle);
  if (!existsSync(p)) {
    console.error(`✗ ${bundle}: not built — run \`node esbuild.js --production\` first`);
    failed = true;
    continue;
  }
  let src = readFileSync(p, 'utf-8');
  for (const benign of ALLOWLIST) src = src.split(benign).join('');
  const hits = FORBIDDEN.filter(({ token }) => src.includes(token));
  if (hits.length === 0) {
    console.log(`✓ ${bundle}: clean`);
  } else {
    failed = true;
    for (const { token, why } of hits) {
      const count = src.split(token).length - 1;
      console.error(`✗ ${bundle}: forbidden "${token}" ×${count} — ${why}`);
    }
  }
}

if (failed) {
  console.error(
    '\nA node-only dependency leaked into a browser webview bundle. Stub it in\n' +
      '`createWebviewPlugins()` (esbuild.js) the way `os`/`monaco` already are, so the\n' +
      'webview never pulls it. Do NOT mask it with a runtime `process` shim.',
  );
  process.exit(1);
}
console.log('\nAll webview bundles clean of node-only deps.');
