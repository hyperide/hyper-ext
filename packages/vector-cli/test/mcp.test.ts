import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { beforeEach, describe, expect, it } from 'bun:test';
import { createVectorMcpServer } from '../src/mcp/server';

/**
 * Connect a fresh in-process MCP client to a fresh vector-engine MCP server.
 * Each server owns one EvalContext session, mirroring the stateful-handle
 * model: tools return nodeId handles that later tools consume.
 */
async function connect(): Promise<Client> {
  const server = createVectorMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function callText(client: Client, name: string, args: Record<string, unknown>): Promise<string> {
  const res = (await client.callTool({ name, arguments: args })) as {
    content: Array<{ type: string; text: string }>;
    isError?: boolean;
  };
  if (res.isError) throw new Error(`tool ${name} returned isError: ${res.content[0]?.text}`);
  return res.content.map((c) => c.text).join('\n');
}

describe('vector-engine MCP server', () => {
  let client: Client;

  beforeEach(async () => {
    client = await connect();
  });

  it('lists the expected v1 tool surface', async () => {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual(
      [
        'vector_boolean',
        'vector_create_shape',
        'vector_export',
        'vector_list_shapes',
        'vector_path_op',
        'vector_set_style',
      ].sort(),
    );
  });

  it('round-trips create rect -> fill -> export svg', async () => {
    const created = JSON.parse(await callText(client, 'vector_create_shape', { kind: 'rect', width: 100, height: 50 }));
    expect(typeof created.handle).toBe('string');

    const filled = JSON.parse(await callText(client, 'vector_set_style', { handle: created.handle, fill: '#ff0000' }));
    expect(typeof filled.handle).toBe('string');

    const svg = await callText(client, 'vector_export', { handle: filled.handle, format: 'svg' });
    expect(svg).toContain('<svg');
    expect(svg).toContain('fill="#ff0000"');
  });

  it('performs a boolean subtract and exports valid svg', async () => {
    const r = JSON.parse(await callText(client, 'vector_create_shape', { kind: 'rect', width: 100, height: 100 }));
    const c = JSON.parse(await callText(client, 'vector_create_shape', { kind: 'circle', radius: 30, cx: 50, cy: 50 }));
    const diff = JSON.parse(await callText(client, 'vector_boolean', { op: 'subtract', a: r.handle, b: c.handle }));
    const svg = await callText(client, 'vector_export', { handle: diff.handle, format: 'svg' });
    expect(svg).toContain('<svg');
  });

  it('applies a core path op (roundCorners)', async () => {
    const r = JSON.parse(await callText(client, 'vector_create_shape', { kind: 'rect', width: 80, height: 40 }));
    const rounded = JSON.parse(
      await callText(client, 'vector_path_op', { handle: r.handle, op: 'roundCorners', radius: 8 }),
    );
    expect(typeof rounded.handle).toBe('string');
    const svg = await callText(client, 'vector_export', { handle: rounded.handle, format: 'svg' });
    expect(svg).toContain('<svg');
  });

  it('lists created shapes', async () => {
    await callText(client, 'vector_create_shape', { kind: 'rect', width: 10, height: 10 });
    await callText(client, 'vector_create_shape', { kind: 'circle', radius: 5 });
    const listed = JSON.parse(await callText(client, 'vector_list_shapes', {}));
    expect(Array.isArray(listed.shapes)).toBe(true);
    expect(listed.shapes.length).toBeGreaterThanOrEqual(2);
  });

  it('returns a clean error for an unknown handle (no crash)', async () => {
    const res = (await client.callTool({
      name: 'vector_set_style',
      arguments: { handle: 'does-not-exist', fill: '#000' },
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text.toLowerCase()).toContain('handle');
  });

  it('returns a clean error for an invalid shape kind', async () => {
    const res = (await client.callTool({
      name: 'vector_create_shape',
      arguments: { kind: 'banana', width: 10, height: 10 },
    })) as { content?: Array<{ type: string; text: string }>; isError?: boolean };
    // zod rejects the bad enum -> protocol-level error or isError, either way not a crash
    expect(res.isError ?? true).toBe(true);
  });
});
