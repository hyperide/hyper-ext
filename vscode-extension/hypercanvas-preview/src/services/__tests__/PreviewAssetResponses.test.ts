/**
 * @file Regression tests for preview proxy static asset response helpers.
 *
 * Accessed via: VS Code extension preview iframe asset loading.
 * Assumptions: dev servers may return history-fallback HTML for missing hashed asset URLs.
 * Architecture: https://hyperide.github.io/reports/2026-03-19-preview-routing-design
 */

import { describe, expect, it } from 'bun:test';
import {
  getPreviewAssetContentType,
  shouldRetryAssetResponse,
  shouldReturnEmptyAssetResponse,
  shouldSwallowStaleBundleResponse,
} from '../PreviewAssetResponses';

describe('PreviewAssetResponses', () => {
  it('classifies hashed Webpack script and stylesheet asset paths', () => {
    expect(getPreviewAssetContentType('/bundle.2c5528684dc8c3dd90d4.js')).toBe('application/javascript; charset=utf-8');
    expect(getPreviewAssetContentType('/main.dab7e2e77da0b120b394.css?cache=1')).toBe('text/css; charset=utf-8');
  });

  it('does not classify preview routes or API paths as static assets', () => {
    expect(getPreviewAssetContentType('/test-preview?component=src%2FApp.tsx')).toBeNull();
    expect(getPreviewAssetContentType('/api/projects')).toBeNull();
    expect(getPreviewAssetContentType('/src/App.tsx.map')).toBeNull();
    expect(getPreviewAssetContentType('/foo?asset=main.js')).toBeNull();
  });

  it('retries history-fallback HTML and transient service errors without masking real 404s', () => {
    expect(shouldRetryAssetResponse(200, true)).toBe(true);
    expect(shouldRetryAssetResponse(404, false)).toBe(false);
    expect(shouldRetryAssetResponse(503, false)).toBe(true);
    expect(shouldRetryAssetResponse(200, false)).toBe(false);
  });

  it('returns empty typed asset responses only for successful HTML fallbacks', () => {
    expect(shouldReturnEmptyAssetResponse(200, true)).toBe(true);
    expect(shouldReturnEmptyAssetResponse(404, true)).toBe(false);
    expect(shouldReturnEmptyAssetResponse(503, false)).toBe(false);
    expect(shouldReturnEmptyAssetResponse(200, false)).toBe(false);
  });

  it('swallows stale hashed bundle 403/404 to keep iframe console quiet across rebuilds', () => {
    // Bun's hashed _bun/client/<hash>.js rotates on every rebuild — old hash → 403/404.
    expect(shouldSwallowStaleBundleResponse('/_bun/client/index-abc123.js', 403)).toBe(true);
    expect(shouldSwallowStaleBundleResponse('/_bun/client/index-abc123.js', 404)).toBe(true);
    // Next.js static chunks rotate similarly on rebuild.
    expect(shouldSwallowStaleBundleResponse('/_next/static/chunks/main-abc.js', 403)).toBe(true);
    // Webpack emits root hashed entry assets; stale CSS may be returned as history-fallback HTML.
    expect(shouldSwallowStaleBundleResponse('/main.dab7e2e77da0b120b394.css', 404)).toBe(true);
    expect(shouldSwallowStaleBundleResponse('/bundle.2c5528684dc8c3dd90d4.js', 403)).toBe(true);
    // Other statuses and non-bundle paths must NOT be swallowed.
    expect(shouldSwallowStaleBundleResponse('/_bun/client/index-abc123.js', 500)).toBe(false);
    expect(shouldSwallowStaleBundleResponse('/_bun/client/index-abc123.js', 200)).toBe(false);
    expect(shouldSwallowStaleBundleResponse('/src/App.tsx', 403)).toBe(false);
    expect(shouldSwallowStaleBundleResponse('/api/projects', 403)).toBe(false);
    expect(shouldSwallowStaleBundleResponse('/main.css', 404)).toBe(false);
    expect(shouldSwallowStaleBundleResponse('/src/main.abcdef123456.css', 404)).toBe(false);
    // Query params don't matter — pathname-only check.
    expect(shouldSwallowStaleBundleResponse('/_bun/client/index-abc.js?t=123', 403)).toBe(true);
    expect(shouldSwallowStaleBundleResponse('/main.dab7e2e77da0b120b394.css?cache=1', 404)).toBe(true);
  });
});
