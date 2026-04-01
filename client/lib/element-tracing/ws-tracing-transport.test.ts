import { beforeEach, describe, expect, it, mock } from 'bun:test';
import type { ResolveElement, TracingServerMessage } from '../../../shared/element-tracing/types';
import { WSTracingTransport } from './ws-tracing-transport';

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
    mockWs = new MockWebSocket('ws://test/element-tracing');
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
