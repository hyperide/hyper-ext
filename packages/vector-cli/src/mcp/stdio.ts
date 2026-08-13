/**
 * @file Vector-engine MCP stdio runner — `vecli mcp`
 *
 * Accessed via: `vecli mcp` — exposes the vector-engine MCP tools over stdio so an
 *   MCP client (Claude Desktop / Code, etc.) can drive the engine. The in-process
 *   InMemoryTransport path (used in tests / embedding hosts) lives in ./server.
 *
 * Assumptions: stdio owns the process for its lifetime; one EvalContext session per run.
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createVectorMcpServer } from './server';

/**
 * Serve the vector-engine MCP tools over stdio and resolve only when the client
 * closes the pipe. The caller must `await` this so the process stays alive for the
 * server's lifetime — resolving on connect alone would let the process exit before
 * the first request is handled.
 */
export function serveMcpStdio(): Promise<void> {
  return new Promise<void>((resolvePromise, rejectPromise) => {
    const server = createVectorMcpServer();
    const transport = new StdioServerTransport();
    // onclose is the sole resolver. onerror is log-only (same as HyperMcpServer):
    // a single malformed frame or abrupt client disconnect must not reject and
    // tear the process down — the server keeps serving until the pipe closes.
    transport.onclose = () => resolvePromise();
    transport.onerror = (err) => console.error('[vector-mcp] transport error:', err);
    server.connect(transport).catch(rejectPromise);
  });
}
