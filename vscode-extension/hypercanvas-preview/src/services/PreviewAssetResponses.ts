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
/**
 * True once the `/test-preview` retry budget (testPreviewRetryBudget) above is
 * exhausted and the dev server is STILL 404/403/503-ing it.
 *
 * HYP-903 (live-verified against conloca's cms-spa): a dev server with no
 * catch-all/SPA-fallback route for `/test-preview` — e.g. Bun's
 * `Bun.serve({ routes: { '/': index } })`, which serves only `/` — 404s FOREVER,
 * not from the FSWatch lag the retry loop above exists to ride out. Contrast the
 * WORKING Bun samples (`hyperide-bun-spa`, `bun-tw-shadcn-sample`), which use a
 * catch-all (`fetch()` fallback / `routes: { '/*': index }`) and so serve
 * `/test-preview` directly — this predicate never fires for them because their
 * retry never exhausts on a real 404.
 *
 * Gates PreviewProxy retrying the SAME request one more time against `/` instead
 * of giving up: the one path a serve-at-root dev server DOES answer. This is
 * PreviewProxy's FIRST recovery attempt once the retry budget is spent —
 * `shouldShowDevServerUnreachable` below is the fallback of THIS fallback, gated
 * on the root retry having already been tried and having ALSO failed.
 */
export function shouldFallbackToRootRoute(
  proxyPath: string,
  statusCode: number | undefined,
  retryCount: number,
  retryBudget: number,
): boolean {
  return (
    (statusCode === 404 || statusCode === 403 || statusCode === 503) &&
    proxyPath.startsWith('/test-preview') &&
    retryCount >= retryBudget
  );
}

/**
 * True once the `/test-preview` retry budget is exhausted AND the one-shot root-route
 * fallback (shouldFallbackToRootRoute, tried first by PreviewProxy) has ALSO come back
 * 404/403/503. At that point retrying again would just repeat the same dead end, so
 * PreviewProxy shows this explicit "dev server unreachable" page instead of letting the
 * (usually empty-bodied) error response pass straight through to the iframe as a silent
 * blank canvas.
 *
 * Shares `shouldFallbackToRootRoute`'s exact trigger formula on purpose — both predicates
 * answer the same underlying question ("is this dev server's /test-preview a permanent
 * dead end, not FSWatch lag?"); PreviewProxy tells them apart by call ORDER
 * (`rootFallbackAttempted`), not by a different boolean condition.
 */
export function shouldShowDevServerUnreachable(
  proxyPath: string,
  statusCode: number | undefined,
  retryCount: number,
  retryBudget: number,
): boolean {
  return shouldFallbackToRootRoute(proxyPath, statusCode, retryCount, retryBudget);
}

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char] ?? char);
}

function stringifyForInlineScript(payload: {
  type: 'hypercanvas:devServerUnreachable';
  proxyPath: string;
  statusCode: number | null;
  targetPort: number;
}): string {
  return JSON.stringify(payload).replace(/<\//g, '<\\/');
}

/**
 * Self-contained HTML page shown INSIDE the preview iframe in place of the raw (usually
 * empty-bodied) error response, once shouldShowDevServerUnreachable is true. Styled to match
 * the extension's own dark-theme warning tone (SupportDimensionsTabs' "needs setup" amber,
 * #d29922) so it reads as a HyperIDE diagnostic, not a generic browser error page. Served
 * with a 200 status (see PreviewProxy) so no browser "friendly error page" heuristic can
 * ever replace this body.
 *
 * The inline script retries the parent announcement until the webview acknowledges it because
 * PreviewPanelApp can remount the iframe while this static page is parsing; a single synchronous
 * postMessage can beat the newly mounted iframe listener. The retry loop is capped so stale
 * webviews do not receive unbounded messages.
 */
export function buildDevServerUnreachableHtml(
  proxyPath: string,
  statusCode: number | undefined,
  targetPort: number,
): string {
  const escapedPath = escapeHtml(proxyPath);
  const statusText = statusCode === undefined ? 'no response' : String(statusCode);
  const announcePayload = stringifyForInlineScript({
    type: 'hypercanvas:devServerUnreachable',
    proxyPath,
    statusCode: statusCode ?? null,
    targetPort,
  });
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>HyperCanvas: preview unreachable</title></head>
<body style="margin:0;padding:48px 32px;background:#1e1e1e;color:#cccccc;font:14px -apple-system,'Segoe UI',sans-serif;">
  <div style="max-width:560px;margin:0 auto;">
    <div style="color:#d29922;font-weight:600;font-size:16px;margin-bottom:8px;">
      &#9888; HyperCanvas can't reach this preview route
    </div>
    <p style="line-height:1.5;margin:0 0 12px;">
      The dev server on <code>localhost:${targetPort}</code> returned <b>${statusText}</b> for
      <code>${escapedPath}</code> and never started serving it.
    </p>
    <p style="line-height:1.5;margin:0;color:#8b949e;">
      This usually means the dev server has no fallback/catch-all route for this path (it only
      serves its own root URL) — not a temporary glitch, so retrying will not help.
    </p>
  </div>
  <script>
    try {
      const ackType = 'hypercanvas:devServerUnreachableAck';
      const maxAttempts = 20;
      let attempts = 0;
      let stopped = false;
      let retryTimer = undefined;

      const stopRetrying = () => {
        stopped = true;
        if (retryTimer !== undefined) {
          clearInterval(retryTimer);
          retryTimer = undefined;
        }
      };

      const postAnnouncement = () => {
        try {
          window.parent.postMessage(${announcePayload}, '*');
        } catch {
          // Ignore postMessage errors.
        }
      };

      window.addEventListener('message', (event) => {
        if (event.source === window.parent && event.data?.type === ackType) {
          stopRetrying();
        }
      });

      postAnnouncement();
      retryTimer = setInterval(() => {
        if (stopped) {
          return;
        }
        attempts += 1;
        postAnnouncement();
        if (attempts >= maxAttempts) {
          stopRetrying();
        }
      }, 300);
    } catch {
      // Ignore postMessage errors.
    }
  </script>
</body>
</html>`;
}
