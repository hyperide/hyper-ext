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
  return isHtml || statusCode === 503;
}

export function shouldReturnEmptyAssetResponse(statusCode: number | undefined, isHtml: boolean): boolean {
  return isHtml && (statusCode === undefined || statusCode < 400);
}
