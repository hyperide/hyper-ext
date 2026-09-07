/**
 * Single source of truth for "which directory holds the frontend entry module".
 *
 * The answer is sniffed from `index.html`'s `<script type="module" src="/DIR/ENTRY.tsx">`
 * tag. Three call sites need it and each used to carry its OWN regex copy; they drifted,
 * and the drift was a live product bug (HYP-1345):
 *
 *   - `extension-provider-detection.detectFrontendRoot` — tiered patterns (fixed in HYP-1034)
 *   - `preview-file-manager.getPreviewFilePath` — loosened to any entry filename
 *   - `preview-mode-manager._detectFrontendRoot` — still pinned to `main.[jt]sx` ONLY
 *
 * All three now call this module, so "which directory holds the frontend entry" has exactly
 * one answer per project. The tier list therefore has to cover every form ANY of the three
 * used to accept — narrowing it would re-create the same split by the other side.
 *
 * That last copy is why previewing HyperIDE's own repo hung forever on "Loading app…":
 * this repo's entry is `/client/App.tsx`, the `main`-only regex missed it, the root fell
 * back to a non-existent `src/`, `detectRouterFile()` returned null, and the project was
 * patched with the ENTRY-mount shape (preview replaces the app) instead of the ROUTER-route
 * shape (preview renders inside the still-mounted app). App-mode's placeholder then waited
 * forever for an app that was never mounted.
 *
 * Keep this the ONLY place the pattern lives. Callers do their own I/O and pass the HTML.
 */

/**
 * The `src` prefix accepted before the directory segment: root-absolute (`/client/App.tsx`)
 * or explicitly document-relative (`./client/App.tsx`). Requiring one of the two right after
 * the quote is what keeps an absolute URL (`https://cdn.example.com/x/main.tsx`) from being
 * mistaken for a project path — it starts with `h`, not `/` or `./`. Matches the forms
 * `detectHtmlModuleEntry` (framework-routing.ts) accepts, so the two sniffers agree on which
 * directory an entry lives in.
 */
const SRC_PREFIX = String.raw`(?:\.\/|\/)`;

const buildEntryPattern = (filename: string): RegExp =>
  new RegExp(String.raw`\bsrc=["']${SRC_PREFIX}([^/"']+)\/(?:${filename})\.[jt]sx?["']`, 'i');

// Ordered from most- to least-conventional entry filename. Each tier is checked across ALL
// module scripts before the next tier is considered at all — this stops an unrelated module
// script that happens to be named e.g. `app.js` (an analytics/vendor bundle living outside
// the real frontend dir) from outranking the actual `main.tsx` entry just because it appears
// earlier in the document (HYP-1034 review finding).
//
// Tier 3 (any filename) exists because a frontend entry is not obliged to use a conventional
// name at all, and the sibling sniffer `detectHtmlModuleEntry` has always accepted any name.
// While this module accepted only tiers 1-2, `getPreviewFilePath` (which accepts any name)
// and `detectRouterFile` (which used this) could resolve DIFFERENT directories for the same
// index.html — e.g. `/client/entry.tsx` gave `client` to one and the `src` fallback to the
// other, so the preview file was written under one root and looked for under another. That
// is the same drift class as HYP-1345 itself, so the tiers must cover everything the other
// sniffer covers.
//
// Known residual limitation (accepted, not chased further): this is a best-effort regex
// sniff of index.html, not a module-graph analysis. A pathological multi-entry-script HTML
// file could still fool it — e.g. when the real entry has an unconventional name, a vendor
// module script with an equally unconventional name earlier in the document wins tier 3 on
// document order alone. Distinguishing them needs parsing which script actually calls
// `createRoot(...).render()`. Real projects have exactly one entry script, which this
// handles correctly.
const ENTRY_FILENAME_PATTERNS: readonly RegExp[] = [
  buildEntryPattern('main'),
  buildEntryPattern('index|app'),
  buildEntryPattern(String.raw`[^/"']+`),
];

/** The conventional fallback when index.html is absent or names no usable entry dir. */
export const DEFAULT_FRONTEND_ROOT = 'src';

/**
 * The captured segment is later joined onto a project root for filesystem reads, so a
 * `../main.tsx` (or, on Windows, a `..\` segment) src would escape the project root by one
 * level — reject exactly `.`/`..` and any embedded backslash. Deliberately an exact-equality
 * check, not a `.includes('..')` substring check, so a legitimately-named dir like `..cache`
 * isn't dropped.
 */
function isSafeDirSegment(dir: string): boolean {
  return dir !== '.' && dir !== '..' && !dir.includes('\\');
}

/**
 * Extract the frontend root directory name from `index.html` markup.
 *
 * Returns `DEFAULT_FRONTEND_ROOT` ('src') when the HTML names no usable entry directory —
 * which is also the right answer for a conventional `/src/main.tsx` project.
 *
 * @param html Raw `index.html` contents. Callers own the file read (the extension uses
 *   `node:fs/promises`, the preview managers use their `FileIO` abstraction).
 */
export function detectFrontendRootFromHtml(html: string): string {
  // HTML tag names are case-insensitive — match `<SCRIPT>`/`<Script>` too (CodeQL
  // js/bad-tag-filter). Regex HTML parsing is a smell; this only sniffs the module entry
  // script to detect the frontend root dir, it is not a sanitizer.
  const moduleScriptAttrs = [...html.matchAll(/<script\b([^>]*)>/gi)]
    .map((m) => m[1] ?? '')
    .filter((attrs) => /\btype=["']module["']/i.test(attrs));

  for (const pattern of ENTRY_FILENAME_PATTERNS) {
    // Within a tier, a non-`src` match wins immediately (it's the whole reason this
    // function exists — detecting a non-default root). A `src` match in this tier is
    // remembered but NOT returned right away, so a later non-`src` entry of the SAME
    // conventional filename (e.g. `/client/main.tsx` after `/src/main.tsx`) still wins.
    let sawDefaultMatch = false;
    for (const attrs of moduleScriptAttrs) {
      const dir = attrs.match(pattern)?.[1];
      if (!dir || !isSafeDirSegment(dir)) continue;
      if (dir !== DEFAULT_FRONTEND_ROOT) return dir;
      sawDefaultMatch = true;
    }
    if (sawDefaultMatch) return DEFAULT_FRONTEND_ROOT;
  }

  return DEFAULT_FRONTEND_ROOT;
}
