import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ResolveElement, TracingServerMessage } from '../../../shared/element-tracing/types';
import { reconnectDelayMs, WSTracingTransport } from './ws-tracing-transport';

class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  sentMessages: string[] = [];

  constructor(public url: string) {
    setTimeout(() => {
      this.readyState = MockWebSocket.OPEN;
      this.onopen?.();
    }, 0);
  }

  send(data: string): void {
    this.sentMessages.push(data);
  }
  close(): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.();
  }
  simulateMessage(msg: TracingServerMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('WSTracingTransport', () => {
  let transport: WSTracingTransport;
  let mockWs: MockWebSocket;

  beforeEach(async () => {
    // nosemgrep: detect-insecure-websocket -- test mock, not a real connection
    mockWs = new MockWebSocket('wss://test/element-tracing');
    transport = new WSTracingTransport(() => mockWs as unknown as WebSocket);
    await new Promise((resolve) => setTimeout(resolve, 10));
  });

  it('should report connected after WebSocket opens', () => {
    expect(transport.connected).toBe(true);
  });

  it('should send messages as JSON', () => {
    const msg: ResolveElement = {
      type: 'resolve-element',
      requestId: 'req-1',
      source: { fileName: 'App.tsx', line: 10, column: 4 },
      itemIndex: 0,
    };
    transport.send(msg);
    expect(mockWs.sentMessages.length).toBe(1);
    expect(JSON.parse(mockWs.sentMessages[0])).toEqual(msg);
  });

  it('should dispatch received messages to handlers', () => {
    const handler = mock(() => {});
    transport.onMessage(handler);
    const serverMsg: TracingServerMessage = {
      type: 'node-map-update',
      filePath: 'src/App.tsx',
      fileHash: 'abc123',
      version: 1,
      nodes: [],
    };
    mockWs.simulateMessage(serverMsg);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(serverMsg);
  });

  it('should support unsubscribe from onMessage', () => {
    const handler = mock(() => {});
    const unsub = transport.onMessage(handler);
    unsub();
    mockWs.simulateMessage({ type: 'node-map-invalidate', filePath: 'src/App.tsx' });
    expect(handler).not.toHaveBeenCalled();
  });

  it('should notify on connection change', () => {
    const handler = mock(() => {});
    transport.onConnectionChange(handler);
    mockWs.close();
    expect(handler).toHaveBeenCalledWith(false);
  });

  it('should report disconnected after close', () => {
    mockWs.close();
    expect(transport.connected).toBe(false);
  });
});

/**
 * Poll a condition instead of sleeping a fixed interval: the reconnect path is a
 * two-hop timer chain (reconnect timer → mock onopen timer), so under CI event-loop
 * stalls a fixed sleep scheduled before the chain can fire between the hops.
 */
async function waitFor(condition: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitFor: condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

// HYP-594: the transport used to die silently on the first close — no reconnect,
// no logging — leaving the SaaS tracer without node maps for the rest of the session.
describe('WSTracingTransport reconnect', () => {
  it('reconnects with a fresh socket after close', async () => {
    const sockets: MockWebSocket[] = [];
    const factory = (): WebSocket => {
      // nosemgrep: detect-insecure-websocket -- test mock, not a real connection
      const ws = new MockWebSocket('wss://test/element-tracing');
      sockets.push(ws);
      return ws as unknown as WebSocket;
    };
    const transport = new WSTracingTransport(factory, { reconnectBaseMs: 1 });
    await waitFor(() => transport.connected);

    sockets[0].close();
    expect(transport.connected).toBe(false);

    await waitFor(() => sockets.length === 2 && transport.connected);
    expect(sockets.length).toBe(2);
    expect(transport.connected).toBe(true);
    transport.dispose();
  });

  it('keeps message handlers across reconnects', async () => {
    const sockets: MockWebSocket[] = [];
    const factory = (): WebSocket => {
      // nosemgrep: detect-insecure-websocket -- test mock, not a real connection
      const ws = new MockWebSocket('wss://test/element-tracing');
      sockets.push(ws);
      return ws as unknown as WebSocket;
    };
    const transport = new WSTracingTransport(factory, { reconnectBaseMs: 1 });
    const handler = mock(() => {});
    transport.onMessage(handler);
    await waitFor(() => transport.connected);

    sockets[0].close();
    await waitFor(() => sockets.length === 2 && transport.connected);

    sockets[1].simulateMessage({ type: 'node-map-invalidate', filePath: 'src/App.tsx' });
    expect(handler).toHaveBeenCalledTimes(1);
    transport.dispose();
  });

  it('dispose cancels a scheduled reconnect', async () => {
    let factoryCalls = 0;
    const factory = (): WebSocket => {
      factoryCalls++;
      // nosemgrep: detect-insecure-websocket -- test mock, not a real connection
      return new MockWebSocket('wss://test/element-tracing') as unknown as WebSocket;
    };
    const transport = new WSTracingTransport(factory, { reconnectBaseMs: 1 });
    await new Promise((resolve) => setTimeout(resolve, 10));

    transport.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(factoryCalls).toBe(1);
  });

  it('computes capped exponential backoff delays', () => {
    expect(reconnectDelayMs(0, 1000, 30_000)).toBe(1000);
    expect(reconnectDelayMs(1, 1000, 30_000)).toBe(2000);
    expect(reconnectDelayMs(4, 1000, 30_000)).toBe(16_000);
    expect(reconnectDelayMs(5, 1000, 30_000)).toBe(30_000);
    expect(reconnectDelayMs(20, 1000, 30_000)).toBe(30_000);
  });
});
