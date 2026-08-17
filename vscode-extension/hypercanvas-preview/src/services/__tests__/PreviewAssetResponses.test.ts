/**
 * @file Regression tests for preview proxy static asset response helpers.
 *
 * Accessed via: VS Code extension preview iframe asset loading.
 * Assumptions: dev servers may return history-fallback HTML for missing hashed asset URLs.
 * Architecture: https://hyperide.github.io/reports/2026-03-19-preview-routing-design
 */

import { describe, expect, it } from 'bun:test';
import {
  buildDevServerUnreachableHtml,
  getPreviewAssetContentType,
  shouldFallbackToRootRoute,
  shouldRetryAssetResponse,
  shouldReturnEmptyAssetResponse,
  shouldShowDevServerUnreachable,
  shouldSwallowStaleBundleResponse,
  testPreviewRetryBudget,
} from '../PreviewAssetResponses';

// Mirror of the proxy retry backoff: delay = min(200 * 1.7^N, 4000)ms, summed over N
// retries. Lets the test assert the wall-clock budget the bound buys, proving a
// never-succeeding request gives up in seconds, not the old ~342s.
function totalRetryBudgetMs(retryLimit: number): number {
  let total = 0;
  for (let n = 0; n < retryLimit; n++) {
    total += Math.min(200 * 1.7 ** n, 4000);
  }
  return total;
}

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

describe('testPreviewRetryBudget (HYP-370 Phase 5 walk-back)', () => {
  // Phases 2-4 added the webpack recompile gate (DevServerManager.awaitRecompile),
  // which the iframe-loader callsites (extension.ts) await BEFORE navigating the
  // iframe after an entry-file patch. That serializes the post-patch second compile
  // OUT of the proxy's retry path for webpack — so the inflated 90-retry budget
  // (~342s) that masked the pre-gate race can be walked back to a tight bound.
  //
  // The gate is webpack/parcel-only (armed via onBeforeWebpackEntryPatch; no-op for
  // vite/remix/next). Remix SSR cold-start 403s (~90-155s) are NOT covered by the
  // gate, so Remix keeps its known-good pre-inflation budget (60), while everything
  // else drops to the tight base bound (16).
  it('non-Remix projects get the tight base bound (gate-protected webpack + Vite 504 retry)', () => {
    expect(testPreviewRetryBudget(false)).toBe(16);
  });

  it('Remix projects keep the known-good pre-inflation SSR cold-start bound', () => {
    // Walked back from the inflated 90 to 60 — the gate does not cover Remix SSR
    // compilation, so this is restored to its 682fdf22 value, not the base bound.
    expect(testPreviewRetryBudget(true)).toBe(60);
  });

  it('a never-succeeding non-Remix request gives up in seconds, not the old ~342s', () => {
    const tightMs = totalRetryBudgetMs(testPreviewRetryBudget(false));
    // 16 geometric retries ≈ 46s — comfortably under a minute, and far below the
    // ~342s the inflated 90-retry budget would burn before giving up.
    expect(tightMs).toBeLessThan(60_000);
    expect(totalRetryBudgetMs(90)).toBeGreaterThan(300_000); // sanity: the old bound really was ~342s
  });

  it('Remix bound stays bounded (no unbounded retry) and below the old inflated budget', () => {
    const remixMs = totalRetryBudgetMs(testPreviewRetryBudget(true));
    expect(remixMs).toBeLessThan(totalRetryBudgetMs(90));
    expect(remixMs).toBeGreaterThan(totalRetryBudgetMs(16)); // still covers SSR cold-start
  });
});

describe('shouldFallbackToRootRoute (HYP-903)', () => {
  // cms-spa-shaped dev servers (`Bun.serve({ routes: { '/': index } })`) have no
  // catch-all/SPA-fallback route: `/test-preview` 404s FOREVER, not from FSWatch lag.
  // Once the retry budget above is exhausted, this predicate says "give the dev
  // server's own root a try" instead of giving up outright — root is the one path
  // such a server DOES serve.
  it('is true once the retry budget is exhausted and /test-preview is still erroring', () => {
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 404, 16, 16)).toBe(true);
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 403, 20, 16)).toBe(true);
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 503, 16, 16)).toBe(true);
  });

  it('is false while retries remain — do not shortcut the FSWatch-lag retry loop', () => {
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 404, 15, 16)).toBe(false);
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 0, 16, 16)).toBe(false);
  });

  it('is false for any path other than /test-preview — never redirects asset/API requests', () => {
    expect(shouldFallbackToRootRoute('/src/App.tsx', 404, 16, 16)).toBe(false);
    expect(shouldFallbackToRootRoute('/api/projects', 404, 16, 16)).toBe(false);
    expect(shouldFallbackToRootRoute('/', 404, 16, 16)).toBe(false);
  });

  it('is false for statuses outside the known dead-end set', () => {
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 500, 16, 16)).toBe(false);
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', 502, 16, 16)).toBe(false);
    expect(shouldFallbackToRootRoute('/test-preview?component=src%2FApp.tsx', undefined, 16, 16)).toBe(false);
  });
});

describe('shouldShowDevServerUnreachable (HYP-903 — dev server with no /test-preview route)', () => {
  it('fires only once the retry budget is exhausted for /test-preview 404/403/503', () => {
    expect(shouldShowDevServerUnreachable('/test-preview?component=App', 404, 16, 16)).toBe(true);
    expect(shouldShowDevServerUnreachable('/test-preview?component=App', 403, 20, 16)).toBe(true);
    expect(shouldShowDevServerUnreachable('/test-preview?component=App', 503, 16, 16)).toBe(true);
  });

  it('does not fire while retries remain', () => {
    expect(shouldShowDevServerUnreachable('/test-preview?component=App', 404, 5, 16)).toBe(false);
  });

  it('does not fire for other status codes or other paths', () => {
    expect(shouldShowDevServerUnreachable('/test-preview?component=App', 200, 16, 16)).toBe(false);
    expect(shouldShowDevServerUnreachable('/test-preview?component=App', 500, 16, 16)).toBe(false);
    expect(shouldShowDevServerUnreachable('/src/App.tsx', 404, 16, 16)).toBe(false);
    expect(shouldShowDevServerUnreachable('/', 404, 16, 16)).toBe(false);
  });
});

describe('buildDevServerUnreachableHtml (HYP-903)', () => {
  // HYP-1275: anchored on the trailing `"targetPort":<digits>}` rather than a lazy
  // `\{[\s\S]*?\}` match. `targetPort` is always the payload's last field and is never
  // attacker-controlled (it's the extension's own numeric port, not derived from
  // proxyPath), so this can't be tricked into stopping early by a proxyPath value that
  // contains a literal `}` or `, '*');` -- both of which JSON.stringify leaves unescaped
  // inside a string value, and only proxyPath is attacker-influenceable.
  function extractAnnouncePayloadSegment(html: string): string {
    const match = html.match(
      /window\.parent\.postMessage\((\{"type":"hypercanvas:devServerUnreachable"[\s\S]*?"targetPort":\d+\}), '\*'\);/,
    );
    if (!match) throw new Error('No dev-server-unreachable postMessage payload found');
    return match[1];
  }

  function extractDevServerUnreachablePayload(html: string): Record<string, unknown> {
    return JSON.parse(extractAnnouncePayloadSegment(html));
  }

  it('renders the target port, status, and requested path into a visible HTML page', () => {
    const html = buildDevServerUnreachableHtml('/test-preview?component=src%2FApp.tsx', 404, 3000);
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('localhost:3000');
    expect(html).toContain('404');
    expect(html).toContain('/test-preview?component=src%2FApp.tsx');
    expect(html).toContain("can't reach this preview route");
  });

  it('escapes the path so it cannot break out of the HTML/attribute context', () => {
    const html = buildDevServerUnreachableHtml('/test-preview?x="><script>alert(1)</script>', 404, 3000);
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('falls back to a plain-language status when none was received', () => {
    const html = buildDevServerUnreachableHtml('/test-preview', undefined, 3000);
    expect(html).toContain('no response');
  });

  it('announces the unreachable route to the parent webview with a parseable postMessage payload', () => {
    const html = buildDevServerUnreachableHtml('/test-preview?component=src%2FApp.tsx', 404, 3000);

    expect(extractDevServerUnreachablePayload(html)).toEqual({
      type: 'hypercanvas:devServerUnreachable',
      proxyPath: '/test-preview?component=src%2FApp.tsx',
      statusCode: 404,
      targetPort: 3000,
    });
  });

  it('retries the parent announcement until ack with a bounded interval', () => {
    const html = buildDevServerUnreachableHtml('/test-preview?component=src%2FApp.tsx', 404, 3000);

    expect(html).toContain('hypercanvas:devServerUnreachableAck');
    expect(html).toContain('setInterval');
    expect(html).toContain('clearInterval');
    expect(html).toContain('maxAttempts = 20');
  });

  it('uses null in the announce payload when no status was received', () => {
    const html = buildDevServerUnreachableHtml('/test-preview', undefined, 3000);

    expect(extractDevServerUnreachablePayload(html).statusCode).toBeNull();
  });

  it('escapes script-breaking proxy paths inside the announce payload', () => {
    const html = buildDevServerUnreachableHtml('/test-preview?</script><script>alert(1)</script>', 404, 3000);

    expect(extractDevServerUnreachablePayload(html).proxyPath).toBe('/test-preview?</script><script>alert(1)</script>');
    expect(html.match(/<\/script>/gi)).toHaveLength(1);
  });

  // HYP-1275: CodeQL reflected-XSS regression guard. The announce payload embeds the raw
  // (non-HTML-escaped) proxyPath inline inside a <script> element via JSON.stringify. An
  // earlier version only replaced `</` sequences, which left a bare `<script>` (no leading
  // slash) -- and any other `<`/`>`/`&` character -- verbatim in the emitted script text.
  // These tests fail if stringifyForInlineScript's escaping regresses to that narrower form.
  it('never emits a raw "<", ">", or "&" character inside the announce payload segment', () => {
    const dangerousPath = '/test-preview?<script>alert(document.cookie)</script>&x=<img src=1 onerror=alert(2)>';
    const html = buildDevServerUnreachableHtml(dangerousPath, 404, 3000);

    expect(extractAnnouncePayloadSegment(html)).not.toMatch(/[<>&]/);
  });

  it('preserves the exact original proxyPath through the JS-escaped announce payload', () => {
    const dangerousPath = '/test-preview?<script>alert(document.cookie)</script>&x=<img src=1 onerror=alert(2)>';
    const html = buildDevServerUnreachableHtml(dangerousPath, 404, 3000);

    expect(extractDevServerUnreachablePayload(html).proxyPath).toBe(dangerousPath);
  });

  it('does not leak a bare (non-slash) <script> tag from the proxy path into the response', () => {
    // A bare `<script>` with no leading `/` was NOT covered by the old `</`-only replace --
    // this is the exact gap CodeQL's reflected-XSS query flagged.
    const html = buildDevServerUnreachableHtml('/test-preview?<script>alert(1)</script>', 404, 3000);

    expect(html).not.toContain('<script>alert(1)');
  });

  it('escapes U+2028/U+2029 (JS string-literal terminators in older engines) inside the announce payload', () => {
    // Built via String.fromCharCode rather than a literal escape in this source file, same
    // reasoning as the production code: these code points are themselves line/paragraph
    // separators and could confuse a text tool reading this test file.
    const lineSeparator = String.fromCharCode(0x2028);
    const paragraphSeparator = String.fromCharCode(0x2029);
    const dangerousPath = `/test-preview?a=${lineSeparator}${paragraphSeparator}b`;
    const html = buildDevServerUnreachableHtml(dangerousPath, 404, 3000);
    const payloadSegment = extractAnnouncePayloadSegment(html);

    expect(payloadSegment.includes(lineSeparator)).toBe(false);
    expect(payloadSegment.includes(paragraphSeparator)).toBe(false);
    expect(extractDevServerUnreachablePayload(html).proxyPath).toBe(dangerousPath);
  });
});
