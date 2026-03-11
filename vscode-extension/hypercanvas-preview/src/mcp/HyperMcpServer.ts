import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { registerAstTools } from './tools/ast-tools';
import { registerComponentTools } from './tools/component-tools';
import { registerExtensionTools } from './tools/extension-tools';
import { registerTailwindTools } from './tools/tailwind-tools';
import type { HyperMcpServices } from './types';

export class HyperMcpServer {
  private _httpServer: Server | null = null;
  private _port = 0;

  constructor(private _services: HyperMcpServices) {}

  private _createMcpServer(): McpServer {
    const server = new McpServer({
      name: 'HyperCanvas',
      version: '0.1.0',
    });

    registerAstTools(server, this._services.astService, this._services.stateHub);
    registerComponentTools(server, this._services.componentService, this._services.astService, this._services.stateHub);
    registerTailwindTools(server);
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

    return new Promise((resolve, reject) => {
      httpServer.listen(0, '127.0.0.1', () => {
        const addr = httpServer.address();
        if (addr && typeof addr !== 'string') {
          this._port = addr.port;
          console.log(`[HyperMCP] Server started on http://127.0.0.1:${this._port}/mcp`);
          resolve(this._port);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });

      httpServer.on('error', reject);
    });
  }

  get port(): number {
    return this._port;
  }

  get url(): string {
    return `http://127.0.0.1:${this._port}/mcp`;
  }

  dispose(): void {
    this._httpServer?.close();
    this._httpServer = null;
    this._port = 0;
  }
}
