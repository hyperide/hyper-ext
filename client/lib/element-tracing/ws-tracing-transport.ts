/**
 * @file WebSocket-based TracingTransport for SaaS platform
 *
 * Accessed via: ElementTracer in iframe (SaaS deployment)
 * Assumptions: Server exposes WS endpoint at /api/element-tracing/:projectId
 */

import type {
  TracingClientMessage,
  TracingServerMessage,
  TracingTransport,
} from '../../../shared/element-tracing/types';

type WebSocketFactory = () => WebSocket;

export class WSTracingTransport implements TracingTransport {
  private readonly _ws: WebSocket;
  private _connected = false;
  private readonly _messageHandlers = new Set<(msg: TracingServerMessage) => void>();
  private readonly _connectionHandlers = new Set<(connected: boolean) => void>();

  constructor(factory: WebSocketFactory) {
    this._ws = factory();
    this._wireEvents();
  }

  get connected(): boolean {
    return this._connected;
  }

  send(msg: TracingClientMessage): void {
    if (!this._connected) return;
    this._ws.send(JSON.stringify(msg));
  }

  onMessage(handler: (msg: TracingServerMessage) => void): () => void {
    this._messageHandlers.add(handler);
    return () => {
      this._messageHandlers.delete(handler);
    };
  }

  onConnectionChange(handler: (connected: boolean) => void): () => void {
    this._connectionHandlers.add(handler);
    return () => {
      this._connectionHandlers.delete(handler);
    };
  }

  dispose(): void {
    this._messageHandlers.clear();
    this._connectionHandlers.clear();
    this._ws.close();
  }

  private _wireEvents(): void {
    this._ws.onopen = () => {
      this._connected = true;
      for (const h of this._connectionHandlers) h(true);
    };

    this._ws.onclose = () => {
      this._connected = false;
      for (const h of this._connectionHandlers) h(false);
    };

    this._ws.onerror = () => {
      this._connected = false;
      for (const h of this._connectionHandlers) h(false);
    };

    this._ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as TracingServerMessage;
      for (const h of this._messageHandlers) h(msg);
    };
  }
}
