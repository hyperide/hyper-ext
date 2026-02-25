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

// Read pre-built iframe scripts (built by esbuild as IIFE bundles)
const interactionScriptContent = fs.readFileSync(
  path.join(__dirname, 'iframe-interaction.js'),
  'utf-8',
);
const errorDetectionScriptContent = fs.readFileSync(
  path.join(__dirname, 'iframe-error-detection.js'),
  'utf-8',
);
const INJECTED_SCRIPTS = `<script>${interactionScriptContent}</script><script>${errorDetectionScriptContent}</script>`;

export class PreviewProxy {
  private _server: http.Server | null = null;
  private _proxyPort: number | null = null;
  private _targetPort: number;

  constructor(targetPort: number) {
    this._targetPort = targetPort;
  }

  get url(): string | null {
    return this._proxyPort ? `http://localhost:${this._proxyPort}` : null;
  }

  get port(): number | null {
    return this._proxyPort;
  }

  /**
   * Start the proxy server on a random available port
   */
  async start(): Promise<void> {
    if (this._server) return;

    this._server = http.createServer((req, res) => {
      this._handleHttp(req, res);
    });

    // WebSocket upgrade
    this._server.on('upgrade', (req, socket, head) => {
      this._handleUpgrade(req, socket as net.Socket, head);
    });

    // Find random port and listen
    await new Promise<void>((resolve, reject) => {
      this._server!.listen(0, '127.0.0.1', () => {
        const addr = this._server!.address();
        if (addr && typeof addr === 'object') {
          this._proxyPort = addr.port;
          console.log(`[PreviewProxy] Listening on port ${this._proxyPort}, proxying to ${this._targetPort}`);
        }
        resolve();
      });
      this._server!.on('error', reject);
    });
  }

  /**
   * Stop the proxy server
   */
  stop(): void {
    if (this._server) {
      this._server.close();
      this._server = null;
      this._proxyPort = null;
    }
  }

  /**
   * Handle HTTP requests: proxy to target, inject script into HTML
   */
  private _handleHttp(clientReq: http.IncomingMessage, clientRes: http.ServerResponse): void {
    const options: http.RequestOptions = {
      hostname: '127.0.0.1',
      port: this._targetPort,
      path: clientReq.url,
      method: clientReq.method,
      headers: {
        ...clientReq.headers,
        host: `127.0.0.1:${this._targetPort}`,
        // Prevent compressed responses so we can inject script
        'accept-encoding': 'identity',
      },
    };

    const proxyReq = http.request(options, (proxyRes) => {
      const contentType = proxyRes.headers['content-type'] || '';
      const isHtml = contentType.includes('text/html');

      if (isHtml) {
        // Buffer HTML response to inject script
        const chunks: Buffer[] = [];
        proxyRes.on('data', (chunk: Buffer) => chunks.push(chunk));
        proxyRes.on('end', () => {
          let html = Buffer.concat(chunks).toString('utf-8');

          // Inject interaction + error detection scripts after <head>
          const injectedScripts = INJECTED_SCRIPTS;
          const headIndex = html.indexOf('<head>');
          if (headIndex !== -1) {
            html = html.slice(0, headIndex + 6) + injectedScripts + html.slice(headIndex + 6);
          } else {
            // No <head> found, prepend scripts
            html = injectedScripts + html;
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
  private _handleUpgrade(
    req: http.IncomingMessage,
    clientSocket: net.Socket,
    head: Buffer,
  ): void {
    const targetSocket = net.connect(this._targetPort, '127.0.0.1', () => {
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

    targetSocket.on('error', (err) => {
      console.error('[PreviewProxy] WS proxy error:', err.message);
      clientSocket.destroy();
    });

    clientSocket.on('error', () => {
      targetSocket.destroy();
    });
  }
}
