/**
 * Preview Proxy - HTTP/WS proxy with script injection
 *
 * Sits between the VSCode webview iframe and the actual dev server.
 * Injects pre-built iframe scripts into HTML responses:
 * - iframe-interaction.js: click/hover/keyboard handling, overlays, design CSS
 * - iframe-error-detection.js: framework error overlay polling
 * Proxies WebSocket connections for HMR.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as net from 'node:net';
import * as path from 'node:path';
import { listenLoopback } from './netProbe';
import {
  getPreviewAssetContentType,
  shouldRetryAssetResponse,
  shouldReturnEmptyAssetResponse,
  shouldSwallowStaleBundleResponse,
  testPreviewRetryBudget,
} from './PreviewAssetResponses';

// Read pre-built iframe scripts (built by esbuild as IIFE bundles)
const interactionScriptContent = fs.readFileSync(path.join(__dirname, 'iframe-interaction.js'), 'utf-8');
const errorDetectionScriptContent = fs.readFileSync(path.join(__dirname, 'iframe-error-detection.js'), 'utf-8');
const consoleCaptureScriptContent = fs.readFileSync(path.join(__dirname, 'iframe-console-capture.js'), 'utf-8');
const chromeDetectionScriptContent = `
(function() {
  window.addEventListener('load', function() {
    var hasChrome = document.querySelector('nav, header, aside') !== null;
    if (hasChrome) {
      window.parent.postMessage({ type: 'chrome-detected' }, '*');
    }
  }, { once: true });
})();
`;

// Minimal `process` shim for the PREVIEWED USER APP (not the extension's own webview
// bundles — those are kept @babel-free at build time via createWebviewPlugins/esbuild
// `define`; see scripts/check-webview-bundles.mjs).
//
// Why this is needed and why it can't be a build-time define here: the previewed app is
// the USER's project, built and served by THEIR dev server (Vite/etc.), proxied through
// this PreviewProxy. We do not control that bundle's build, so we cannot esbuild-stub or
// `define` into it. A user app whose module graph value-imports a node-ish library that
// reads `process.env` at module init — e.g. hyperide's own `client/`:
//   PlatformContext.tsx -> nodepodRetargetTransport -> @shared/i18n-text/retarget/core
//   -> `import _traverse from '@babel/traverse'` -> @babel/types/lib/definitions/utils.js
//   reads `process.env.BABEL_TYPES_8_BREAKING` at init
// throws `ReferenceError: process is not defined` in the browser realm, blanking the whole
// preview. The SaaS (hyperide.ai) doesn't hit this because its OWN production build
// (Bun.build, target:'browser') shims `process` for it; a plain Vite dev serve does not.
//
// This classic <script> is injected at the very start of <head>, so it runs BEFORE Vite's
// deferred `<script type="module">` entry evaluates the module graph. It's idempotent and
// non-destructive: it only defines `globalThis.process` when absent, and only fills
// `process.env` / `NODE_ENV` when missing — never clobbering a real `process` (e.g. SSR
// hydration shells that already provide one). This makes EVERY previewed user app robust
// to module-init `process.env` reads, not just hyperide.
const processShimScriptContent = `
(function () {
  try {
    var g = typeof globalThis !== 'undefined' ? globalThis : window;
    if (typeof g.process === 'undefined' || g.process === null) {
      g.process = { env: {} };
    }
    if (typeof g.process.env === 'undefined' || g.process.env === null) {
      g.process.env = {};
    }
    if (typeof g.process.env.NODE_ENV === 'undefined') {
      g.process.env.NODE_ENV = 'development';
    }
  } catch (e) {
    /* never let the shim itself break the preview */
  }
})();
`;
const INJECTED_SCRIPTS = `<script data-hyper-inject="process-shim">${processShimScriptContent}</script><script data-hyper-inject="interaction">${interactionScriptContent}</script><script data-hyper-inject="error-detection">${errorDetectionScriptContent}</script><script data-hyper-inject="console-capture">${consoleCaptureScriptContent}</script>`;
const HYPERCANVAS_SCRIPT_RESPONSES = new Map([
  ['/__hypercanvas/process-shim.js', processShimScriptContent],
  ['/__hypercanvas/iframe-interaction.js', interactionScriptContent],
  ['/__hypercanvas/iframe-error-detection.js', errorDetectionScriptContent],
  ['/__hypercanvas/iframe-console-capture.js', consoleCaptureScriptContent],
  ['/__hypercanvas/chrome-detection.js', chromeDetectionScriptContent],
]);
export class PreviewProxy {
  private _server: http.Server | null = null;
  private _proxyPort: number | null = null;
  private _targetPort: number;
  private _isIsolatedMode = false;
  private _isRemixProject = false;
  private _projectRoot: string | undefined;
  private _viteBase: string | undefined;
  // Single source of truth for "are we serving" (HYP-370 Phase 4). The proxy no
  // longer keeps its own private stop flag; instead DevServerManager injects a
  // predicate it owns (proxy liveness: `this._previewProxy === proxy`). This
  // flips to false at the exact instant _stopProxy() nulls the manager's proxy
  // reference — the same moment the old _isStopping used to be set — so behavior
  // is preserved across stop()/exit, while the process-error path (which does NOT
  // call _stopProxy) keeps serving, matching the prior `_isStopping = false` there.
  // Defaults to always-serving so a bare proxy (no manager) still works.
  private _isServing: () => boolean = () => true;
  private _sockets = new Set<net.Socket>();

  get isIsolatedMode(): boolean {
    return this._isIsolatedMode;
  }

  /**
   * Inject the serving-state predicate. DevServerManager passes a closure over
   * its own proxy ownership so there is one source of truth for "are we serving":
   * the proxy short-circuits requests whenever the manager is not serving through
   * it, without the proxy mirroring that state in a private flag.
   */
  setIsServing(isServing: () => boolean): void {
    this._isServing = isServing;
  }

  constructor(targetPort: number, projectRoot?: string) {
    this._targetPort = targetPort;
    this._projectRoot = projectRoot;
  }

  get url(): string | null {
    return this._proxyPort ? `http://localhost:${this._proxyPort}` : null;
  }

  get port(): number | null {
    return this._proxyPort;
  }

  /** Update the target port when the dev server self-assigns a different port than requested. */
  setTargetPort(port: number): void {
    this._targetPort = port;
    console.log(`[PreviewProxy] Target port updated to ${port}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
  }

  /** Switch between App Shell and Isolated mode. Called by PreviewModeManager. */
  setIsolatedMode(isolated: boolean): void {
    this._isIsolatedMode = isolated;
  }

  /** Read vite.config.ts base path (cached on startup, empty string if not found) */
  private async _readViteBase(): Promise<string> {
    if (!this._projectRoot) return '';
    try {
      const configPath = path.join(this._projectRoot, 'vite.config.ts');
      const content = await fs.promises.readFile(configPath, 'utf-8');
      const match = content.match(/base\s*:\s*['"]([^'"]+)['"]/);
      return match?.[1] ?? '';
    } catch {
      return '';
    }
  }

  private async _detectRemixProject(): Promise<boolean> {
    if (!this._projectRoot) return false;
    try {
      const packageJsonPath = path.join(this._projectRoot, 'package.json');
      const packageJson = JSON.parse(await fs.promises.readFile(packageJsonPath, 'utf-8')) as {
        dependencies?: Record<string, string>;
        devDependencies?: Record<string, string>;
      };
      const deps = { ...packageJson.dependencies, ...packageJson.devDependencies };
      return Boolean(deps['@remix-run/react'] || deps['@remix-run/node']);
    } catch {
      return false;
    }
  }

  /**
   * Start the proxy server on a random available port
   */
  async start(): Promise<void> {
    if (this._server) return;
    this._viteBase = await this._readViteBase();
    this._isRemixProject = await this._detectRemixProject();

    this._server = http.createServer((req, res) => {
      this._handleHttp(req, res);
    });

    // WebSocket upgrade
    this._server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket as net.Socket, head);
    });

    // Find random port and listen on loopback ('localhost', same as before) via
    // the shared net-probe util. The webview addresses the proxy by 'localhost'
    // (see get url()); binding 'localhost' keeps it loopback-only and reachable
    // by that client.
    const server = this._server;
    if (!server) {
      throw new Error('PreviewProxy server not initialized');
    }
    try {
      this._proxyPort = await listenLoopback(server, 0, 'localhost');
      // Server-side startup log — useful for debugging proxy configuration in extension host
      console.log(`[PreviewProxy] Listening on port ${this._proxyPort}, proxying to ${this._targetPort}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
    } catch (err) {
      this._server = null;
      throw err;
    }
  }

  /**
   * Stop the proxy server
   */
  stop(): void {
    for (const socket of this._sockets) {
      socket.destroy();
    }
    this._sockets.clear();

    if (this._server) {
      this._server.close();
      this._server = null;
      this._proxyPort = null;
    }
  }

  /**
   * Handle HTTP requests: proxy to target, inject script into HTML.
   * Retries up to 5 times for /test-preview 404/503 to handle dev server FSWatch lag.
   */
  private _handleHttp(clientReq: http.IncomingMessage, clientRes: http.ServerResponse, retryCount = 0): void {
    if (!this._isServing()) {
      clientRes.writeHead(503);
      clientRes.end();
      return;
    }
    const proxyPath = clientReq.url || '/';
    const virtualScript = HYPERCANVAS_SCRIPT_RESPONSES.get(proxyPath);
    if (virtualScript !== undefined) {
      clientRes.writeHead(200, {
        'content-type': 'application/javascript; charset=utf-8',
        'cache-control': 'no-cache, no-store, must-revalidate',
      });
      clientRes.end(virtualScript);
      return;
    }

    // Strip origin/referer before forwarding: Vite 5.4+ rejects requests with
    // non-localhost origins (DNS-rebinding protection). The VS Code webview sends
    // Origin: vscode-webview://... which Vite blocks with 403. The proxy is a
    // localhost-to-localhost bridge so origin semantics don't apply here.
    const forwardHeaders = { ...clientReq.headers };
    delete forwardHeaders.origin;
    delete forwardHeaders.referer;

    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: this._targetPort,
      path: proxyPath,
      method: clientReq.method,
      headers: {
        ...forwardHeaders,
        // Use 'localhost' (not '127.0.0.1') to satisfy Vite's allowedHosts
        // DNS-rebinding protection. Many vite.config.ts files declare
        // `server.allowedHosts: ['localhost', ...]` (e.g. bulka-the-dog), and
        // Vite matches the literal hostname — '127.0.0.1' doesn't satisfy
        // 'localhost' and the request gets dropped (manifests as 504 in
        // browser console for /client/main.tsx). Both forms are equivalent
        // on the wire because /etc/hosts maps localhost → 127.0.0.1.
        host: `localhost:${this._targetPort}`,
        // Prevent compressed responses so we can inject script
        'accept-encoding': 'identity',
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      // Retry GET requests that return 504 — Vite's on-demand transform timeout (10s
      // default) fires when optimizeDeps hasn't run yet (cold Docker start). By the
      // next retry the .vite/deps cache is warm and transforms complete instantly.
      // Applies to all paths (module files, HTML, assets) to cover any cold-start 504.
      if (
        proxyRes.statusCode === 504 &&
        clientReq.method === 'GET' &&
        retryCount < 5 &&
        !clientRes.headersSent &&
        !clientReq.destroyed
      ) {
        proxyRes.resume();
        const delay = 500 * (retryCount + 1);
        console.log(`[PreviewProxy] 504 on GET, retry ${retryCount + 1}/5 in ${delay}ms: ${proxyPath}`); // nosemgrep: unsafe-formatstring
        setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), delay);
        return;
      }

      // Retry for /test-preview 404/403/503 — handles dev server FSWatch lag after
      // route file creation. Exponential backoff: 200ms × 1.7^N caps at 4000ms per
      // retry. The budget is framework-split (see testPreviewRetryBudget):
      //
      // HYP-370 Phase 5 — the budget previously inflated to 90 retries (~342s) to
      // mask the webpack second-compile gap: after _patchEntryFile writes
      // __canvas_preview__.tsx, webpack triggers a second full compile (20-40s under
      // Docker load) during which /test-preview returns 404. Phases 2-4 fixed the
      // root ordering — the iframe-loader callsites now await DevServerManager's
      // recompile gate (armRecompileGate / awaitRecompile) BEFORE navigating the
      // iframe, so the post-patch compile is serialized out of this retry path for
      // webpack. With that masking removed, the bound drops to a tight base of 16
      // (~46s) for non-Remix — the value all frameworks shared before Remix/webpack
      // forced inflation.
      //
      // The gate is webpack/parcel-only (no-op for vite/remix/next), and does NOT
      // cover Remix SSR cold-start (403 for ~90-155s while routes compile), so Remix
      // keeps its known-good pre-inflation budget of 60 (~222s, 682fdf22). Vite/Next
      // also use 16 (gate is a no-op for them but their fast initial compile fits
      // the base budget); webpack is additionally gate-protected.
      if (
        (proxyRes.statusCode === 404 || proxyRes.statusCode === 403 || proxyRes.statusCode === 503) &&
        proxyPath.startsWith('/test-preview') &&
        clientReq.method === 'GET' &&
        retryCount < testPreviewRetryBudget(this._isRemixProject)
      ) {
        proxyRes.resume(); // drain response
        if (!clientReq.destroyed && !clientRes.headersSent) {
          const delay = Math.min(200 * 1.7 ** retryCount, 4000);
          setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), delay);
        }
        return;
      }

      const contentTypeHeader = proxyRes.headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader.join(';') : (contentTypeHeader ?? '');
      const isHtml = contentType.includes('text/html');
      const assetContentType = getPreviewAssetContentType(proxyPath);
      // 403 on assets: Vite not fully initialised — allow more retries (30 × 200ms = 6s).
      // Other retry conditions (wrong content-type / 503): 5 retries is sufficient.
      const assetRetryLimit = proxyRes.statusCode === 403 ? 30 : 5;
      if (assetContentType && shouldRetryAssetResponse(proxyRes.statusCode, isHtml) && retryCount < assetRetryLimit) {
        proxyRes.resume();
        if (!clientReq.destroyed && !clientRes.headersSent) {
          setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), 200);
        }
        return;
      }

      if (assetContentType && shouldReturnEmptyAssetResponse(proxyRes.statusCode, isHtml)) {
        proxyRes.resume();
        clientRes.writeHead(204, {
          'content-type': assetContentType,
          'cache-control': 'no-cache, no-store, must-revalidate',
        });
        clientRes.end();
        return;
      }

      if (assetContentType && shouldSwallowStaleBundleResponse(proxyPath, proxyRes.statusCode)) {
        proxyRes.resume();
        clientRes.writeHead(204, {
          'content-type': assetContentType,
          'cache-control': 'no-cache, no-store, must-revalidate',
        });
        clientRes.end();
        return;
      }

      if (isHtml) {
        // Buffer HTML response to inject script
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');

          if (!this._isRemixProject) {
            // Inject interaction + error detection scripts after <head>.
            // Remix hydrates the full document, so its generated route renders
            // these scripts itself via /__hypercanvas/* endpoints to avoid
            // proxy-added nodes causing hydration mismatch.
            const injectedScripts = INJECTED_SCRIPTS;
            const headIndex = html.indexOf('<head>');
            if (headIndex !== -1) {
              html = html.slice(0, headIndex + 6) + injectedScripts + html.slice(headIndex + 6);
            } else {
              // No <head> found, prepend scripts
              html = injectedScripts + html;
            }
          }

          // Tier 1 isolated mode: swap user entry script to standalone canvas preview entry
          if (this._isIsolatedMode && proxyPath.startsWith('/test-preview')) {
            const base = this._viteBase ?? '';
            const scriptRegex = /<script\s+type="module"\s+src="([^"]+)"\s*>/g;
            let userScript: string | null = null;
            for (const match of html.matchAll(scriptRegex)) {
              const src = match[1];
              if (!src.startsWith('/@') && !src.startsWith('https://') && !src.startsWith(`${base}@`)) {
                userScript = src;
                break;
              }
            }
            if (userScript) {
              // Derive standalone path from the user script's directory (handles client/, src/, etc.)
              const standalonePath = userScript.replace(/\/[^/]+\.[jt]sx?$/, '/__canvas_preview_standalone__.tsx');
              html = html.replace(`src="${userScript}"`, `src="${standalonePath}"`);
              console.log(`[PreviewProxy] Tier 1 script swap: ${userScript} → ${standalonePath}`); // nosemgrep: unsafe-formatstring
            } else {
              console.warn('[PreviewProxy] Tier 1: could not find user entry script, falling back to App Shell');
            }
          }

          // Inject chrome-detection script for /test-preview requests (App Shell mode)
          if (proxyPath.startsWith('/test-preview') && !this._isRemixProject) {
            const chromeDetectScript = `<script>${chromeDetectionScriptContent}</script>`;
            html = html.replace('</head>', `${chromeDetectScript}</head>`);
          }

          // Update content-length
          const headers = { ...proxyRes.headers };
          delete headers['content-length'];
          delete headers['content-encoding'];
          headers['transfer-encoding'] = 'chunked';

          clientRes.writeHead(proxyRes.statusCode || 200, headers);
          clientRes.end(html);
        });
      } else {
        // Non-HTML: pipe directly
        clientRes.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(clientRes);
      }
    });

    proxyReq.on('error', (err) => {
      console.error('[PreviewProxy] HTTP proxy error:', err.message);
      // Retry GET requests on socket errors (ECONNRESET, socket hang up, ECONNREFUSED).
      // Vite's keep-alive pool can drop a connection immediately after the initial HTML
      // response; subsequent @vite/client and module fetches hit the stale socket and
      // get ECONNRESET. Without retry these requests return 502 and React never mounts.
      // Only retrying GET because POST/PUT bodies are consumed after the first attempt.
      if (clientReq.method === 'GET' && retryCount < 5 && !clientRes.headersSent && !clientReq.destroyed) {
        const retryDelay = 300 * (retryCount + 1);
        console.log(`[PreviewProxy] socket error on GET, retry ${retryCount + 1}/5 in ${retryDelay}ms: ${proxyPath}`);
        setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), retryDelay);
        return;
      }
      if (!clientRes.headersSent) {
        clientRes.writeHead(502);
        clientRes.end('Proxy error');
      }
    });

    // On retry, clientReq body stream is already consumed. For GET requests there is
    // no body anyway — end the proxy request directly to trigger the upstream send.
    if (retryCount > 0 && clientReq.method === 'GET') {
      proxyReq.end();
    } else {
      clientReq.pipe(proxyReq);
    }
  }

  /**
   * Handle WebSocket upgrade: bidirectional proxy to target
   */
  private _handleUpgrade(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    if (!this._isServing() || !this._server) {
      clientSocket.destroy();
      return;
    }

    // Snapshot port before async ops — setTargetPort() may race with net.connect callback
    const targetPort = this._targetPort;
    const targetSocket = net.connect(targetPort, 'localhost', () => {
      // Forward the original HTTP upgrade request to target
      const requestLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
      const headers = Object.entries(req.headers)
        .filter(([key]) => key !== 'host')
        .map(([key, val]) => `${key}: ${val}`)
        .join('\r\n');

      const hostHeader = `host: 127.0.0.1:${targetPort}`;
      targetSocket.write(`${requestLine}${hostHeader}\r\n${headers}\r\n\r\n`);

      if (head.length > 0) {
        targetSocket.write(head);
      }

      // Bidirectional pipe
      targetSocket.pipe(clientSocket);
      clientSocket.pipe(targetSocket);
    });

    this._trackSocket(clientSocket);
    this._trackSocket(targetSocket);

    targetSocket.on('error', (err) => {
      if (this._isServing()) {
        console.error('[PreviewProxy] WS proxy error:', err.message);
      }
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      targetSocket.destroy();
    });
  }

  private _trackSocket(socket: net.Socket): void {
    this._sockets.add(socket);
    socket.once('close', () => {
      this._sockets.delete(socket);
    });
  }
}
