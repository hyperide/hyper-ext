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

  constructor(private _services: HyperMcpServices) {}

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
    this._httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      if (url.pathname !== '/mcp') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found. Use /mcp endpoint.' }));
        return;
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id',
        });
        res.end();
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

  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp`;
  }

  /** Reason the last start() attempt failed, or null if it hasn't failed. */
  get startError(): string | null {
    return this._startError;
  }

  dispose(): void {
    this._httpServer?.close();
    this._httpServer = null;
    this._port = 0;
  }
}
