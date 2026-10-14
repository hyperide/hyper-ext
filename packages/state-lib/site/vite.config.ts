import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two builds from one source.
 *
 * The default is a single self-contained file: dist/index.html opens straight
 * from disk, which is how the harnesses drive it and how a reader without a
 * server can read it. Module scripts are CORS-blocked on file://, so in this
 * build every `import()` is inlined and resolves synchronously — there is
 * nothing to fetch.
 *
 * SITE_SPLIT=1 is the served build (Vercel): the heavy pieces the playground
 * needs only after a reader reaches it — the editor and the JSX transpiler —
 * become real chunks that load on demand, so the first paint of every other
 * page does not pay for them. Same source, same `import()` calls; only what
 * the bundler does with them differs.
 */
const split = process.env.SITE_SPLIT === '1';

export default defineConfig({
  // Relative for the disk build — a file:// page has no origin to be absolute
  // against. ABSOLUTE for the served build: with './' the entry script resolves
  // against the current path, so /repl/queries asked for /repl/assets/index.js,
  // the SPA rewrite answered with index.html, and the browser refused HTML as a
  // module script. Every two-segment route was blank on the live site.
  base: split ? '/' : './',
  // This package uses plain CSS. An explicit config prevents PostCSS from
  // discovering the parent application's Tailwind plugins in a full checkout.
  css: { postcss: { plugins: [] } },
  plugins: split ? [react()] : [react(), viteSingleFile()],
  build: split
    ? {
        rollupOptions: {
          output: {
            manualChunks: {
              editor: [
                '@codemirror/state',
                '@codemirror/view',
                '@codemirror/commands',
                '@codemirror/language',
                '@codemirror/lang-javascript',
                '@codemirror/autocomplete',
                '@lezer/highlight',
              ],
              transpiler: ['sucrase'],
              others: ['zustand', 'zustand/vanilla', 'valtio', 'valtio/vanilla', 'immer'],
            },
          },
        },
      }
    : undefined,
});
