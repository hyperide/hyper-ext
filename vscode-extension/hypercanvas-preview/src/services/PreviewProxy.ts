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
import {
  getPreviewAssetContentType,
  shouldRetryAssetResponse,
  shouldReturnEmptyAssetResponse,
  shouldSwallowStaleBundleResponse,
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
const INJECTED_SCRIPTS = `<script data-hyper-inject="interaction">${interactionScriptContent}</script><script data-hyper-inject="error-detection">${errorDetectionScriptContent}</script><script data-hyper-inject="console-capture">${consoleCaptureScriptContent}</script>`;
const HYPERCANVAS_SCRIPT_RESPONSES = new Map([
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
  private _isStopping = false;
  private _sockets = new Set<net.Socket>();

  get isIsolatedMode(): boolean {
    return this._isIsolatedMode;
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
    this._isStopping = false;
    this._viteBase = await this._readViteBase();
    this._isRemixProject = await this._detectRemixProject();

    this._server = http.createServer((req, res) => {
      this._handleHttp(req, res);
    });

    // WebSocket upgrade
    this._server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket as net.Socket, head);
    });

    // Find random port and listen
    await new Promise<void>((resolve, reject) => {
      this._server?.listen(0, 'localhost', () => {
        const addr = this._server?.address();
        if (addr && typeof addr === 'object') {
          this._proxyPort = addr.port;
          // Server-side startup log — useful for debugging proxy configuration in extension host
          console.log(`[PreviewProxy] Listening on port ${this._proxyPort}, proxying to ${this._targetPort}`); // nosemgrep: unsafe-formatstring -- JS template literal, not a format string
        }
        resolve();
      });
      this._server?.on('error', reject);
    });
  }

  /**
   * Stop the proxy server
   */
  stop(): void {
    this._isStopping = true;
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
    delete forwardHeaders['origin'];
    delete forwardHeaders['referer'];

    const options: http.RequestOptions = {
      hostname: 'localhost',
      port: this._targetPort,
      path: proxyPath,
      method: clientReq.method,
      headers: {
        ...forwardHeaders,
        host: `127.0.0.1:${this._targetPort}`,
        // Prevent compressed responses so we can inject script
        'accept-encoding': 'identity',
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      // Retry for /test-preview 404/403/503 — handles dev server FSWatch lag after
      // route file creation AND webpack-dev-server's second-compile gap (after
      // _patchEntryFile, webpack rebuilds while iframe requests; retry budget
      // must cover full recompile, not just FS watch). Also covers Remix SSR route
      // compilation: dev server reports "ready" quickly but returns 403 while SSR
      // routes are still compiling (~90-155s cold start).
      // Exponential backoff: 200ms × 1.7^N caps at 4000ms per retry.
      // 60 retries ≈ 222s total budget: 16 geometric + 44 × 4s = 46 + 176s.
      // Covers Remix cold compile (90-155s) with margin for poll-loaded timeout (250s).
      if (
        (proxyRes.statusCode === 404 || proxyRes.statusCode === 403 || proxyRes.statusCode === 503) &&
        proxyPath.startsWith('/test-preview') &&
        retryCount < 60
      ) {
        proxyRes.resume(); // drain response
        const delay = Math.min(200 * 1.7 ** retryCount, 4000);
        setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), delay);
        return;
      }

      const contentTypeHeader = proxyRes.headers['content-type'];
      const contentType = Array.isArray(contentTypeHeader) ? contentTypeHeader.join(';') : (contentTypeHeader ?? '');
      const isHtml = contentType.includes('text/html');
      const assetContentType = getPreviewAssetContentType(proxyPath);
      if (assetContentType && shouldRetryAssetResponse(proxyRes.statusCode, isHtml) && retryCount < 5) {
        proxyRes.resume();
        setTimeout(() => this._handleHttp(clientReq, clientRes, retryCount + 1), 200);
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

      if (assetContentType && shouldSwallowStaleBundleResponse(proxyPath, proxyRes.statusCode, isHtml)) {
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
              html = html.replace(`src="${userScript}"`, 'src="/src/__canvas_preview_standalone__.tsx"');
              console.log(`[PreviewProxy] Tier 1 script swap: ${userScript} → /src/__canvas_preview_standalone__.tsx`); // nosemgrep: unsafe-formatstring
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
      clientRes.writeHead(502);
      clientRes.end('Proxy error');
    });

    clientReq.pipe(proxyReq);
  }

  /**
   * Handle WebSocket upgrade: bidirectional proxy to target
   */
  private _handleUpgrade(req: http.IncomingMessage, clientSocket: net.Socket, head: Buffer): void {
    if (this._isStopping || !this._server) {
      clientSocket.destroy();
      return;
    }

    const targetSocket = net.connect(this._targetPort, 'localhost', () => {
      // Forward the original HTTP upgrade request to target
      const requestLine = `${req.method} ${req.url} HTTP/1.1\r\n`;
      const headers = Object.entries(req.headers)
        .filter(([key]) => key !== 'host')
        .map(([key, val]) => `${key}: ${val}`)
        .join('\r\n');

      const hostHeader = `host: 127.0.0.1:${this._targetPort}`;
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
      if (!this._isStopping) {
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
