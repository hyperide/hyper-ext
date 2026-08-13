/**
 * @file Module-frame URL predicate: is a React `_debugStack` frame URL a fetchable app
 * module whose source map can be warmed over HTTP?
 *
 * Accessed via: extension iframe-source-maps.ts (`extractClientChunkFrames`) and the SaaS
 *   client ModuleSourceMapResolver (`extractModuleFrame`) — the SINGLE shared copy of this
 *   rule. The two paths previously kept PRIVATE copies that drifted: the SaaS predicate
 *   accepted any http(s) non-`node_modules` URL while the extension additionally required
 *   a `/src/` segment. Vite serves out-of-root files (symlinked workspace packages,
 *   HYP-443 monorepo libraries) via `/@fs/<abs>/…` — a prebuilt workspace-package bundle
 *   (`/@fs/…/packages/cms-spa/dist/ui-*.mjs`) has no `/src/` segment, so the extension
 *   never warmed the frame and click resolution collapsed the element to the host
 *   call-site (HYP-1161).
 *
 * Boundary: `node_modules` frames stay excluded — the browser cannot realpath a symlinked
 * dependency served THROUGH `node_modules/…` (preserveSymlinks / pnpm), and installed
 * package internals are not editable anyway (see editable-source.ts). Server-chunk
 * (`file://…/.next/`) frames are a separate extraction (`extractServerChunkFrames`).
 *
 * Origin boundary (P2): when the runtime origin is known (both consumers run in a DOM — the
 * extension's preview iframe and the SaaS client), the URL must be SAME-ORIGIN with it. Every
 * legitimate frame is: Vite serves `/src/…` and `/@fs/…` from the dev-server origin the preview
 * iframe points at, and the SaaS proxy serves `/project-preview/<id>/…` from the app's own
 * origin. A cross-origin frame is a CDN/import-map dependency (esm.sh, unpkg, …): its map fetch
 * is CORS-blocked, and the warmed `null` would be cached as a definitive miss that poisons
 * click resolution for the later first-party frame (or, worse, a fetched CDN map could
 * misclassify dependency internals as editable).
 */

/**
 * True when `url` is an http(s) module URL outside `node_modules`, same-origin with the
 * preview/dev-server page — i.e. a frame whose source map the dev server can serve. Covers
 * Vite `/src/…` source files, Vite `/@fs/…` out-of-root files (monorepo workspace packages,
 * HYP-1161), Next.js `_next/static/chunks/…`, and the SaaS `/project-preview/<id>/…` proxy form.
 *
 * `baseOrigin` overrides the runtime origin (tests). When no origin is known at all (non-DOM
 * host, no override), the origin check is skipped and the historical http(s)+non-node_modules
 * predicate applies.
 */
/**
 * Runtime page origin, read once and cached. The origin is invariant for the lifetime of the
 * page (both consumers run in a DOM — the extension's preview iframe, the SaaS client — where
 * the page's own origin IS the dev-server / proxy origin), so no invalidation is needed. This
 * predicate runs per `_debugStack` frame (10–25 frames/click); re-reading `location.origin`
 * per frame is pure waste. Non-DOM hosts (tests) leave the origin unknown (`null`) and keep
 * the historical predicate.
 */
let cachedRuntimeOrigin: string | null | undefined;
function runtimeOrigin(): string | null {
  if (cachedRuntimeOrigin === undefined) {
    cachedRuntimeOrigin =
      typeof location !== 'undefined' && typeof location.origin === 'string' && location.origin !== 'null'
        ? location.origin
        : null;
  }
  return cachedRuntimeOrigin;
}

export function isFetchableModuleFrameUrl(url: string, baseOrigin?: string): boolean {
  if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
  if (url.includes('/node_modules/')) return false;
  const origin = baseOrigin ?? runtimeOrigin();
  if (origin === null) return true;
  // Fast path: virtually every frame URL is the origin followed by a path — accept without a
  // `new URL` parse. The trailing '/' is load-bearing: it excludes prefix-collision authorities
  // (`http://localhost:5173.evil.com/…`, `http://localhost:5173@evil.com/…`), which fall
  // through to the parse and are correctly rejected there.
  if (url.startsWith(origin + '/')) return true;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
