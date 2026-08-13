import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { listenLoopback } from '../services/netProbe';
import { BIND_RETRY_BACKOFFS_MS, isRetryableBindError, withJitter } from './bindRetry';
import { registerAstTools } from './tools/ast-tools';
import { registerComponentTools } from './tools/component-tools';
import { registerExtensionTools } from './tools/extension-tools';
import { registerStylingTools } from './tools/styling-tools';
import type { HyperMcpServices } from './types';

/** HYP-954 lifecycle state, driven only by ensureStarted()/dispose() — a direct
 *  start() call (the activation eager-start path used to make) does not touch it. */
export type McpServerState = 'STOPPED' | 'STARTING' | 'STARTED' | 'FAILED';

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Race a promise against a timeout without leaking the timer once either settles. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export class HyperMcpServer {
  private _httpServer: Server | null = null;
  private _port = 0;
  // HYP-953: the last start() rejection message, if any. Consumed by the
  // `hypercanvas.setupMcp` guard (extension-commands.ts) so a startup failure
  // — e.g. loopback bind refused by a local firewall/AV/sandbox — surfaces an
  // actionable reason instead of a bare "not running" dead end. Cleared on a
  // fresh dispose()/start() cycle.
  private _startError: string | null = null;
  // HYP-954: single-flight memo for ensureStarted(). Cleared on failure (so the
  // NEXT call retries instead of replaying a cached rejection forever) and on
  // dispose() (so a fresh ensureStarted() after dispose starts a genuinely new
  // server instead of resolving against the disposed one's stale promise).
  private _startPromise: Promise<void> | null = null;
  private _state: McpServerState = 'STOPPED';
  // HYP-954 (review finding): monotonic epoch for the CURRENT start attempt.
  // Bumped by dispose() and by ensureStarted()'s timeout-abandonment path so a
  // stale in-flight bind — one that's no longer the attempt anyone is waiting on
  // — can detect it was superseded: `_bindWithRetry` checks this before creating
  // each retry's net.Server and again right after a successful bind, so a bind
  // that lands after dispose()/abandonment self-closes instead of resurrecting a
  // listening server nobody references, and `ensureStarted`'s `.then` won't
  // stamp `_state = 'STARTED'` over a since-disposed/-abandoned instance.
  private _generation = 0;
  private _onStartedListeners: Array<(port: number) => void> = [];
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

  get state(): McpServerState {
    return this._state;
  }

  /**
   * Register a listener fired every time a start attempt transitions to STARTED
   * (HYP-954) — whether that's the eager activation start or a later successful
   * `ensureStarted()` retry (e.g. from the `hypercanvas.setupMcp` Retry button).
   * This is the single place "server just came up" side effects (config sync,
   * status bar, Copilot MCP registration) should hook in, so a successful retry
   * gets the SAME treatment as the first start instead of silently skipping them.
   */
  onStarted(listener: (port: number) => void): void {
    this._onStartedListeners.push(listener);
  }

  /**
   * Idempotent, race-safe start (HYP-954). Concurrent callers awaiting this while
   * a start is already in flight share the SAME promise instead of each
   * triggering its own start()/net.Server — that race (a caller synchronously
   * checking `port === 0` right after activation's fire-and-forget start()) was
   * the dominant real-world bug this ticket fixes. A failed attempt clears
   * `_startPromise` so the NEXT call retries rather than being permanently
   * doomed by a cached rejection.
   */
  async ensureStarted(timeoutMs = 3000): Promise<void> {
    if (this._state !== 'STARTED') {
      if (!this._startPromise) {
        const generation = ++this._generation;
        this._state = 'STARTING';
        this._startPromise = this.start()
          .then(() => {
            // Superseded by dispose() or a timeout-abandonment below — this
            // settlement belongs to an attempt nobody is tracking anymore.
            if (generation !== this._generation) return;
            this._state = 'STARTED';
            // Round-3 review finding (both reviewers): isolate each listener.
            // A listener that throws (e.g. autoUpdateMcpConfigs' file I/O) must
            // NOT reject this promise — that would trip the `.catch` below and
            // flip a GENUINELY BOUND, listening server to FAILED, showing a
            // bogus "failed to start" toast and, on Retry, leaking the live
            // socket while trying to bind a second one.
            for (const listener of this._onStartedListeners) {
              try {
                listener(this._port);
              } catch (listenerError) {
                console.error('[HyperMCP] onStarted listener threw:', listenerError);
              }
            }
          })
          .catch((error: unknown) => {
            if (generation === this._generation) {
              this._state = 'FAILED';
              this._startPromise = null;
            }
            throw error;
          });
      }
      // Round-4 review finding: capture the exact attempt (promise identity +
      // generation) THIS caller is waiting on before awaiting it. A slow caller
      // (e.g. activation's 30s ensureStarted()) can still be inside the
      // `withTimeout` below after a faster, concurrent caller (e.g. setupMcp's
      // 3s ensureStarted()) already timed out, abandoned the original attempt,
      // and a subsequent Retry started and finished a brand-new one. Without
      // this capture, the slow caller's own timeout handler had no way to tell
      // "the attempt I gave up on" from "the healthy attempt that superseded
      // it" — it would tear down the new, working server.
      const attemptPromise = this._startPromise;
      const attemptGeneration = this._generation;
      try {
        // `attemptPromise` is guaranteed non-null here: the `if (!this._startPromise)`
        // block above always populates it before this point is reached.
        await withTimeout(attemptPromise!, timeoutMs, `MCP server did not start within ${timeoutMs}ms`);
      } catch (error) {
        // Review finding (HYP-954): a timeout must not leave ensureStarted()
        // permanently re-awaiting the SAME hung promise on every Retry. Abandon
        // this attempt — bump the generation so its eventual settlement (success
        // or failure) is ignored — so the NEXT call starts a genuinely fresh one.
        // Only do this if the attempt we were waiting on is STILL the current
        // one: `_startPromise`/`_generation` may have already moved on to a
        // newer, unrelated attempt (see comment above) — in that case this
        // timeout belongs to an attempt nobody tracks anymore, so just let the
        // error propagate to this caller without touching shared state.
        if (this._startPromise === attemptPromise && this._generation === attemptGeneration) {
          this._generation++;
          this._startPromise = null;
          this._state = 'FAILED';
          // Round-2 review finding: close the abandoned attempt's server NOW,
          // don't rely solely on `_bindWithRetry`'s post-await generation check —
          // if `listenLoopback` never settles at all (a genuine hang, not just a
          // slow bind), that check never runs and the socket leaks. Safe even if
          // the bind hasn't completed yet; `_bindWithRetry`'s own generation
          // check still no-ops a late resolution.
          this._httpServer?.close();
          this._httpServer = null;
        }
        throw error;
      }
    }
  }

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

  private _createHttpServer(): Server {
    return createServer(async (req: IncomingMessage, res: ServerResponse) => {
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
  }

  /**
   * Bind loopback (127.0.0.1), retrying transient failures (HYP-954). Recreates
   * the net.Server per attempt — a server whose listen() already errored can't
   * reliably retry listen() again on all Node versions. Only EADDRINUSE/EAGAIN/
   * ECONNRESET are retried (see bindRetry.ts); everything else (EACCES/EPERM,
   * unclassified) rejects on the first attempt.
   *
   * Generation-checked (review finding): captures the epoch active when this
   * call began and re-checks it before each retry AND right after a successful
   * bind. If dispose() or ensureStarted()'s timeout-abandonment bumped the epoch
   * in the meantime, this attempt is no longer current — a zombie listener that
   * nobody references would otherwise be left running. Close it and abort
   * instead of returning the port.
   */
  private async _bindWithRetry(): Promise<number> {
    const generation = this._generation;
    let lastError: unknown;
    for (let attempt = 0; attempt <= BIND_RETRY_BACKOFFS_MS.length; attempt++) {
      if (generation !== this._generation) {
        throw new Error('HyperMcpServer: start superseded before bind completed');
      }
      const httpServer = this._createHttpServer();
      this._httpServer = httpServer;
      try {
        const port = await listenLoopback(httpServer, 0);
        if (generation !== this._generation) {
          httpServer.close();
          throw new Error('HyperMcpServer: start superseded after bind completed');
        }
        return port;
      } catch (error) {
        lastError = error;
        // Hygiene (review finding, low): drop the failed attempt's server before
        // the next one. Its listen() errored so it holds no socket, but this
        // keeps `this._httpServer` from dangling on a dead instance mid-backoff.
        httpServer.close();
        if (this._httpServer === httpServer) this._httpServer = null;
        if (!isRetryableBindError(error) || attempt === BIND_RETRY_BACKOFFS_MS.length) {
          throw error;
        }
        await delay(withJitter(BIND_RETRY_BACKOFFS_MS[attempt]));
      }
    }
    throw lastError;
  }

  /**
   * Low-level bind primitive: binds the loopback socket (with retry) and returns
   * the port. Does NOT touch the ensureStarted() lifecycle (`_state`,
   * `_startPromise`, `onStarted` listeners).
   *
   * PRODUCTION CODE MUST CALL `ensureStarted()`, NOT this (review finding). The
   * only callers of `start()` directly are unit tests exercising the bind /
   * HTTP-handler layer in isolation. Do not mix `start()` and `ensureStarted()`
   * on the same live instance: a bare `start()` leaves `_state` untouched, so a
   * later `ensureStarted()` would bind a SECOND server and orphan the first.
   */
  async start(): Promise<number> {
    // Bind loopback (127.0.0.1) via the shared net-probe util — same host as
    // before, now through the shared address-extraction plumbing. Stays
    // loopback-only so the MCP endpoint is not reachable from the LAN.
    this._startError = null;
    // Fresh per-start secret — see the _token field comment for why this exists.
    this._token = randomBytes(24).toString('hex');
    try {
      const port = await this._bindWithRetry();
      this._port = port;
      console.log(`[HyperMCP] Server started on http://127.0.0.1:${this._port}/mcp`);
      return port;
    } catch (error) {
      this._startError = error instanceof Error ? error.message : String(error);
      throw error;
    }
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
    // Bump FIRST (review finding): invalidates any start attempt still in
    // flight so `_bindWithRetry` self-aborts/self-closes instead of resurrecting
    // a listening server after this dispose(), and ensureStarted()'s `.then`
    // won't stamp `_state = 'STARTED'` back over the STOPPED set below.
    this._generation++;
    this._httpServer?.close();
    this._httpServer = null;
    this._port = 0;
    // HYP-954: null the memo so a subsequent ensureStarted() starts a fresh
    // server instead of resolving against this disposed instance's promise.
    this._startPromise = null;
    this._state = 'STOPPED';
    this._token = '';
  }
}
