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
  return isHtml || statusCode === 503 || statusCode === 403;
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
