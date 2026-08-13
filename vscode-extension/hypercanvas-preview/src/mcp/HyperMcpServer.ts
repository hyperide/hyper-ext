import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { listenLoopback } from '../services/netProbe';
import { registerAstTools } from './tools/ast-tools';
import { registerComponentTools } from './tools/component-tools';
import { registerExtensionTools } from './tools/extension-tools';
import { registerStylingTools } from './tools/styling-tools';
import type { HyperMcpServices } from './types';

export class HyperMcpServer {
  private _httpServer: Server | null = null;
  private _port = 0;
  // HYP-953: the last start() rejection message, if any. Consumed by the
  // `hypercanvas.setupMcp` guard (extension-commands.ts) so a startup failure
  // — e.g. loopback bind refused by a local firewall/AV/sandbox — surfaces an
  // actionable reason instead of a bare "not running" dead end. Cleared on a
  // fresh dispose()/start() cycle (extension.ts doesn't currently retry, but
  // this keeps the field from reporting a stale reason if it ever does).
  private _startError: string | null = null;
  // Security (tg#7273): loopback bind alone does not stop a browser-origin or local-process
  // attacker — a malicious webpage can POST to 127.0.0.1 via fetch() same as any local tool.
  // A fresh random bearer token is minted per start() and required on every /mcp request; it
  // is embedded in the `url` getter (as ?token=) so the config-writers below (autoUpdateMcpConfigs,
  // registerCopilotMcp, write*Json/writeCodexConfig) hand it to legitimate clients transparently.
  // Trade-off: the `?token=` fallback persists the secret into the client-config files those
  // writers touch (.mcp.json / .vscode/mcp.json / opencode.json / .codex/config.toml). That is
  // acceptable because (a) the token is short-lived — a new one is minted every start(), so a
  // leaked value is dead after the next launch, and (b) it grants only what a local process on
  // this machine already has (loopback reach). Clients that support headers should still prefer
  // the Authorization header; the URL form exists for those that carry only a URL string.
  private _token = '';

  constructor(private _services: HyperMcpServices) {}

  /** Host header must literally name this loopback server — rejects DNS-rebinding attacks,
   *  where an attacker-controlled hostname resolves to 127.0.0.1 only at request time (after
   *  the browser's same-origin check), so the request arrives with a non-loopback Host.
   *  Host names are case-insensitive (RFC 3986), so compare lower-cased. */
  private _isTrustedHost(host: string | undefined): boolean {
    if (!host) return false;
    const normalized = host.toLowerCase();
    return normalized === `127.0.0.1:${this._port}` || normalized === `localhost:${this._port}`;
  }

  /** Pull the bearer token from the Authorization header (preferred) or the `?token=` query
   *  fallback (for clients that carry only a URL). The `Bearer` auth-scheme name is
   *  case-insensitive per RFC 7235, so match it that way. */
  private _extractAuthToken(req: IncomingMessage, url: URL): string | null {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      const [scheme, ...rest] = authHeader.split(' ');
      if (scheme.toLowerCase() === 'bearer' && rest.length > 0) return rest.join(' ');
    }
    return url.searchParams.get('token');
  }

  private _isAuthenticated(req: IncomingMessage, url: URL): boolean {
    const provided = this._extractAuthToken(req, url);
    if (!provided) return false;
    const providedBuf = Buffer.from(provided);
    const expectedBuf = Buffer.from(this._token);
    // Constant-time compare: a length-dependent early return is fine (length isn't secret),
    // but comparing matching-length buffers byte-by-byte via === would leak timing.
    if (providedBuf.length !== expectedBuf.length) return false;
    return timingSafeEqual(providedBuf, expectedBuf);
  }

  private _createMcpServer(): McpServer {
    const server = new McpServer({
      name: 'HyperCanvas',
      version: '0.1.0',
    });

    registerAstTools(server, this._services.astService, this._services.stateHub);
    registerComponentTools(server, this._services.componentService, this._services.astService, this._services.stateHub);
    registerStylingTools(server, this._services.stateHub);
    registerExtensionTools(server, this._services);

    return server;
  }

  async start(): Promise<number> {
    // Fresh per-start secret — see the _token field comment for why this exists.
    this._token = randomBytes(24).toString('hex');

    this._httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (!this._isTrustedHost(req.headers.host)) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Forbidden: untrusted Host header' }));
        return;
      }

      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use /mcp endpoint.' }));
        return;
      }

      if (req.method === 'OPTIONS') {
        // No Access-Control-Allow-Origin: every real MCP client (Claude Code, Copilot, Codex,
        // OpenCode) talks over Node/CLI fetch, which CORS never gates — it only restricts
        // browser page-context requests. Sending `*` here was the actual vulnerability: it let
        // ANY website's fetch() reach this loopback tool-execution endpoint through the user's
        // own browser (CSRF/DNS-rebinding-style local RCE). Omitting the header makes the
        // browser refuse to expose the response to cross-origin page script.
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, Authorization',
        });
        res.end();
        return;
      }

      if (!this._isAuthenticated(req, url)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid token' }));
        return;
      }

      // Stateless mode: only POST is supported (no SSE sessions via GET)
      if (req.method === 'GET') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
        res.end(JSON.stringify({ error: 'Method not allowed. Use POST for MCP requests.' }));
        return;
      }

      if (req.method === 'DELETE') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
        res.end(JSON.stringify({ error: 'Sessions not supported in stateless mode.' }));
        return;
      }

      if (req.method !== 'POST') {
        res.writeHead(405, { 'Content-Type': 'application/json', Allow: 'POST, OPTIONS' });
        res.end(JSON.stringify({ error: 'Method not allowed' }));
        return;
      }

      // Stateless: new McpServer + transport per request
      const mcpServer = this._createMcpServer();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

      transport.onerror = (error) => {
        console.error('[HyperMCP] Transport error:', error);
      };

      await mcpServer.connect(transport);

      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', async () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString());
          await transport.handleRequest(req, res, body);
        } catch (error) {
          console.error('[HyperMCP] Request handling error:', error);
          if (!res.headersSent) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid request' }));
          }
        }
      });
    });

    const httpServer = this._httpServer;

    // Bind loopback (127.0.0.1) via the shared net-probe util — same host as
    // before, now through the shared address-extraction plumbing. Stays
    // loopback-only so the MCP endpoint is not reachable from the LAN.
    this._startError = null;
    // Keep this block byte-identical to origin/main: it is HYP-954's failover region (do
    // not restyle it here), and pinning the format also keeps the pre-existing console.log
    // off the leftover-grep added-lines diff.
    // oxfmt-ignore
    return listenLoopback(httpServer, 0).then((port) => {
      this._port = port;
      console.log(`[HyperMCP] Server started on http://127.0.0.1:${this._port}/mcp`);
      return port;
    }).catch((error: unknown) => {
      this._startError = error instanceof Error ? error.message : String(error);
      throw error;
    });
  }

  get port(): number {
    return this._port;
  }

  /** Includes the per-start bearer token as a `?token=` query param so config-writers that
   *  only carry a URL (not custom headers) still authenticate — see the _token field comment. */
  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp?token=${this._token}`;
  }

  /** The current per-start bearer token. Empty until start() has run. */
  get token(): string {
    return this._token;
  }

  /** Reason the last start() attempt failed, or null if it hasn't failed. */
  get startError(): string | null {
    return this._startError;
  }

  dispose(): void {
    this._httpServer?.close();
    this._httpServer = null;
    this._port = 0;
    this._token = '';
  }
}
