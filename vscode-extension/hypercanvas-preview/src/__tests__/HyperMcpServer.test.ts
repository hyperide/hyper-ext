import * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { HyperMcpServer } from '../mcp/HyperMcpServer';
import { type HyperMcpServices, resolveFilePath } from '../mcp/types';

function createMockServices(): HyperMcpServices {
  return {
    astService: {
      insertElement: mock(() => Promise.resolve({ success: true, newId: 'new-uuid', index: 0 })),
      deleteElements: mock(() => Promise.resolve({ success: true, data: { deletedCount: 1 } })),
      updateStyles: mock(() => Promise.resolve({ success: true, className: 'flex flex-col' })),
      updateProps: mock(() => Promise.resolve({ success: true })),
      duplicateElement: mock(() => Promise.resolve({ success: true, newId: 'dup-uuid' })),
      wrapElement: mock(() => Promise.resolve({ success: true, wrapperId: 'wrap-uuid' })),
      getElementLocation: mock(() => Promise.resolve({ line: 10, column: 5 })),
    } as unknown as HyperMcpServices['astService'],
    componentService: {
      parseStructure: mock(() => Promise.resolve([{ id: 'root', tag: 'div', children: [] }])),
      getComponent: mock(() => Promise.resolve({ name: 'Button', props: [] })),
    } as unknown as HyperMcpServices['componentService'],
    stateHub: {
      state: {
        selectedIds: ['elem-1'],
        hoveredId: null,
        currentComponent: { path: 'src/App.tsx', name: 'App' },
        canvasMode: 'select',
        engineMode: 'design',
        projectUIKit: 'tailwind',
      },
      applyUpdate: mock(),
    } as unknown as HyperMcpServices['stateHub'],
    diagnosticHub: {
      getAIContext: mock(() => 'Runtime Error: Cannot read property'),
    } as unknown as HyperMcpServices['diagnosticHub'],
    workspaceRoot: '/test-workspace',
    onNavigate: mock(() => Promise.resolve()),
    onRefresh: mock(),
    onOpenComponent: mock(),
    onScreenshot: mock(() => Promise.resolve(null)),
  };
}

describe('HyperMcpServer', () => {
  let server: HyperMcpServer;
  let services: HyperMcpServices;

  beforeEach(async () => {
    services = createMockServices();
    server = new HyperMcpServer(services);
    await server.start();
  });

  afterEach(() => {
    server.dispose();
  });

  it('should start on a random port', () => {
    expect(server.port).toBeGreaterThan(0);
    expect(server.url).toContain(`http://127.0.0.1:${server.port}/mcp`);
  });

  it('should return 404 for non-/mcp paths', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/other`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(response.status).toBe(404);
  });

  it('should return 405 for GET on /mcp (stateless mode)', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      headers: { Authorization: `Bearer ${server.token}` },
    });
    expect(response.status).toBe(405);
  });

  it('should handle MCP initialize request', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();
    // Response may be SSE or JSON depending on transport mode
    expect(text).toContain('HyperCanvas');
  });

  it('should list tools via tools/list', async () => {
    // First initialize
    await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0' },
        },
      }),
    });

    // Then list tools
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
    });

    expect(response.status).toBe(200);
    const text = await response.text();

    // Verify all 19 tools are registered
    const toolNames = [
      'hyper_insert_element',
      'hyper_delete_elements',
      'hyper_update_styles',
      'hyper_update_props',
      'hyper_duplicate_element',
      'hyper_wrap_element',
      'hyper_get_component_tree',
      'hyper_get_component_props',
      'hyper_get_element_styles',
      'hyper_suggest_color_token',
      'hyper_list_color_tokens',
      'hyper_get_selection',
      'hyper_select_elements',
      'hyper_get_diagnostics',
      'hyper_navigate_to_element',
      'hyper_refresh_preview',
      'hyper_open_component',
      'hyper_screenshot_preview',
      'hyper_screenshot_element',
    ];

    for (const name of toolNames) {
      expect(text).toContain(name);
    }
  });

  it('should dispose cleanly', () => {
    server.dispose();
    expect(server.port).toBe(0);
  });
});

/**
 * @file tg#7273 — the loopback MCP HTTP server used to set `Access-Control-Allow-Origin: *`
 * with no authentication at all. Binding to 127.0.0.1 does NOT stop a browser-origin
 * attacker: any website the user visits can, via the browser, POST to the loopback server
 * (CORS `*` lets it through) and invoke MCP tools — a CSRF/DNS-rebinding-style local RCE
 * against a server that executes actions (file writes, navigation, etc.). Fix: drop the
 * permissive CORS header, validate Host to defeat rebinding, and require a per-start random
 * bearer token on every /mcp request.
 */
describe('HyperMcpServer — loopback security (tg#7273)', () => {
  let server: HyperMcpServer;

  beforeEach(async () => {
    server = new HyperMcpServer(createMockServices());
    await server.start();
  });

  afterEach(() => {
    server.dispose();
  });

  it('rejects a POST /mcp with no token as 401', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it('rejects a POST /mcp with a wrong token as 401', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer not-the-real-token' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }),
    });
    expect(response.status).toBe(401);
  });

  it('accepts a POST /mcp with the correct bearer token', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });
    expect(response.status).toBe(200);
  });

  it('accepts the token as a ?token= query param (config-writer fallback)', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp?token=${server.token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });
    expect(response.status).toBe(200);
  });

  it('does not send Access-Control-Allow-Origin on the /mcp OPTIONS preflight', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, { method: 'OPTIONS' });
    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('rejects a request with a non-loopback Host header as 403 (anti-DNS-rebinding)', async () => {
    // fetch() to 127.0.0.1 always sends a matching Host, so hit the server on the raw
    // socket via node:http to spoof an attacker-controlled Host header directly.
    const response = await new Promise<{ status: number }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port: server.port,
          path: '/mcp',
          method: 'POST',
          headers: {
            Host: 'attacker.example.com',
            'Content-Type': 'application/json',
            Authorization: `Bearer ${server.token}`,
          },
        },
        (res) => {
          res.resume();
          resolve({ status: res.statusCode ?? 0 });
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }));
    });
    expect(response.status).toBe(403);
  });

  it('generates a fresh token on every start()', async () => {
    const firstToken = server.token;
    server.dispose();
    await server.start();
    expect(server.token).not.toBe(firstToken);
    expect(server.token.length).toBeGreaterThan(0);
  });

  it('url getter carries the current token as a query param', () => {
    expect(server.url).toBe(`http://127.0.0.1:${server.port}/mcp?token=${server.token}`);
  });

  it('clears the token on dispose()', () => {
    expect(server.token.length).toBeGreaterThan(0);
    server.dispose();
    expect(server.token).toBe('');
  });

  it('accepts a case-insensitive bearer auth scheme (RFC 7235)', async () => {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `bearer ${server.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } },
      }),
    });
    expect(response.status).toBe(200);
  });
});

describe('resolveFilePath', () => {
  it('should return provided filePath when given', () => {
    const stateHub = { state: { currentComponent: { path: 'src/App.tsx' } } } as HyperMcpServices['stateHub'];
    expect(resolveFilePath(stateHub, 'src/Button.tsx')).toBe('src/Button.tsx');
  });

  it('should fall back to currentComponent from stateHub', () => {
    const stateHub = {
      state: { currentComponent: { path: 'src/App.tsx', name: 'App' } },
    } as HyperMcpServices['stateHub'];
    expect(resolveFilePath(stateHub)).toBe('src/App.tsx');
  });

  it('should return null when no filePath and no active component', () => {
    const stateHub = { state: { currentComponent: null } } as unknown as HyperMcpServices['stateHub'];
    expect(resolveFilePath(stateHub)).toBeNull();
  });

  it('should return null when currentComponent has no path', () => {
    const stateHub = { state: { currentComponent: { path: '', name: '' } } } as HyperMcpServices['stateHub'];
    expect(resolveFilePath(stateHub, '')).toBeNull();
  });
});
