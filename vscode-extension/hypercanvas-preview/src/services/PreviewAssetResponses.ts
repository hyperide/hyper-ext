/**
 * @file Static asset response helpers for the VS Code preview proxy.
 *
 * Accessed via: VS Code extension preview iframe asset loading.
 * Assumptions: dev servers may return history-fallback HTML for missing hashed asset URLs.
 * Architecture: https://hyperide.github.io/reports/2026-03-19-preview-routing-design
 */

import * as path from 'node:path';

const ASSET_CONTENT_TYPES = new Map([
  ['.js', 'application/javascript; charset=utf-8'],
  ['.mjs', 'application/javascript; charset=utf-8'],
  ['.cjs', 'application/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
  ['.ttf', 'font/ttf'],
  ['.otf', 'font/otf'],
]);

export function getPreviewAssetContentType(proxyPath: string): string | null {
  try {
    const pathname = new URL(proxyPath, 'http://localhost').pathname;
    return ASSET_CONTENT_TYPES.get(path.extname(pathname).toLowerCase()) ?? null;
  } catch {
    return null;
  }
}

export function shouldRetryAssetResponse(statusCode: number | undefined, isHtml: boolean): boolean {
  // Also retry 403 — Vite 5.4+ returns 403 for asset requests while still initialising
  // (before the dev server has compiled routes). Worker ordering races cause this for
  // the first worker to start on a project: assets return 403 briefly, JS bundle can't
  // load, React never executes and the SSR initial state persists.
  return isHtml || statusCode === 503 || statusCode === 403 || statusCode === 504;
}

export function shouldReturnEmptyAssetResponse(statusCode: number | undefined, isHtml: boolean): boolean {
  return isHtml && (statusCode === undefined || statusCode < 400);
}

/**
 * Path patterns for bundler-generated chunk URLs whose hash rotates on every
 * rebuild. Stale references to old hashes are unavoidable (cached HTML, fiber
 * `_debugSource` snapshots, source-map fetches in flight). The dev server
 * returns 403/404 for the missing hash; surfacing that as `Failed to load
 * resource: ...` floods the webview console and trips diagnostics auto-capture
 * during E2E. Swallow only those well-known patterns.
 */
const HASHED_BUNDLE_PATH_PATTERNS: readonly RegExp[] = [/(?:^|\/)_bun\/client\//, /(?:^|\/)_next\/static\/chunks\//];
const WEBPACK_ROOT_BUNDLE_PATTERN = /^\/(?:bundle|main|runtime|style|styles|vendor|vendors)\.[a-f0-9]{8,}\.(?:css|js)$/;

function isHashedBundlePath(proxyPath: string): boolean {
  try {
    const pathname = new URL(proxyPath, 'http://localhost').pathname;
    return (
      HASHED_BUNDLE_PATH_PATTERNS.some((pattern) => pattern.test(pathname)) ||
      WEBPACK_ROOT_BUNDLE_PATTERN.test(pathname)
    );
  } catch {
    return false;
  }
}

/**
 * For hashed bundler output (bun's `_bun/client/<hash>.js`, Next.js
 * `_next/static/chunks/<hash>.js`, Webpack root `main.<hash>.css`), 403/404
 * responses are expected fallout from rebuilds — the hash has already rotated.
 * Return an empty 204 instead so the iframe doesn't log a `Failed to load
 * resource` error or stylesheet MIME error from history-fallback HTML.
 */
export function shouldSwallowStaleBundleResponse(proxyPath: string, statusCode: number | undefined): boolean {
  if (statusCode !== 403 && statusCode !== 404) return false;
  return isHashedBundlePath(proxyPath);
}

/**
 * Max retry count for `/test-preview` 404/403/503 responses, before the proxy gives
 * up. Backoff is `min(200 * 1.7^N, 4000)`ms per retry (see PreviewProxy._handleHttp).
 *
 * HYP-370 Phase 5 — walk back the inflated budget. Phases 2-4 added the webpack
 * recompile gate (DevServerManager.awaitRecompile), which the iframe-loader
 * callsites await BEFORE navigating the iframe after an entry-file patch. That
 * serializes webpack's post-patch second compile OUT of this retry path, so the
 * inflated 90-retry budget (~342s, b89b2e55) that masked the pre-gate race can be
 * removed.
 *
 * The gate is webpack/parcel-only (armed via onBeforeWebpackEntryPatch; no-op for
 * vite/remix/next). Remix SSR cold-start returns 403 for ~90-155s while routes
 * compile, and the gate does NOT cover it — so Remix keeps its known-good
 * pre-inflation budget (60 ≈ 222s, 682fdf22). 60 is a deliberate floor for Remix:
 * tightening it further needs the SSR cold-start root-caused, which is out of scope
 * for Phase 5.
 *
 * Everything else (webpack/Vite/Next) drops to the tight base bound (16 ≈ 46s) —
 * the value all frameworks shared BEFORE Remix forced 60 and webpack forced 90.
 * webpack is additionally gate-protected; Vite/Next rest on this restored
 * historical-known-good base (they reach /test-preview after their fast initial
 * compile, so the base FSWatch-lag budget suffices). The separate 504 retry path
 * covers Vite's on-demand-transform 504s on module requests, not /test-preview.
 */
export function testPreviewRetryBudget(isRemixProject: boolean): number {
  return isRemixProject ? 60 : 16;
}
