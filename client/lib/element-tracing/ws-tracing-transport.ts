/**
 * @file WebSocket-based TracingTransport for SaaS platform
 *
 * Accessed via: ElementTracer in iframe (SaaS deployment)
 * Assumptions: Server exposes WS endpoint at /api/element-tracing/:projectId.
 *   The socket can drop at any time (proxy restarts, container sleep) — the transport
 *   reconnects with capped exponential backoff instead of dying silently (HYP-594).
 */

import type {
  TracingClientMessage,
  TracingServerMessage,
  TracingTransport,
} from '../../../shared/element-tracing/types';

type WebSocketFactory = () => WebSocket;

export interface WSTracingTransportOptions {
  /** First reconnect delay; doubles per attempt. Injectable for tests. */
  reconnectBaseMs?: number;
  /** Backoff ceiling. */
  reconnectMaxMs?: number;
}

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

/** Capped exponential backoff: base * 2^attempt, clamped to max. */
export function reconnectDelayMs(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(baseMs * 2 ** attempt, maxMs);
}

export class WSTracingTransport implements TracingTransport {
  private _ws: WebSocket;
  private readonly _factory: WebSocketFactory;
  private _connected = false;
  private _disposed = false;
  private _reconnectAttempt = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly _reconnectBaseMs: number;
  private readonly _reconnectMaxMs: number;
  private readonly _messageHandlers = new Set<(msg: TracingServerMessage) => void>();
  private readonly _connectionHandlers = new Set<(connected: boolean) => void>();

  constructor(factory: WebSocketFactory, options: WSTracingTransportOptions = {}) {
    this._factory = factory;
    this._reconnectBaseMs = options.reconnectBaseMs ?? RECONNECT_BASE_MS;
    this._reconnectMaxMs = options.reconnectMaxMs ?? RECONNECT_MAX_MS;
    this._ws = this._open();
  }

  get connected(): boolean {
    return this._connected;
  }

  send(msg: TracingClientMessage): void {
    if (!this._connected) {
      console.debug('[tracing] send dropped — transport not connected', msg.type);
      return;
    }
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
    this._disposed = true;
    if (this._reconnectTimer !== null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    this._messageHandlers.clear();
    this._connectionHandlers.clear();
    this._ws.close();
  }

  private _open(): WebSocket {
    const ws = this._factory();

    ws.onopen = () => {
      this._connected = true;
      this._reconnectAttempt = 0;
      for (const h of this._connectionHandlers) h(true);
    };

    ws.onclose = () => {
      this._setDisconnected();
      if (!this._disposed) {
        this._scheduleReconnect();
      }
    };

    ws.onerror = (event: Event) => {
      // onerror is followed by onclose in browsers — reconnect is scheduled there.
      console.warn('[tracing] WebSocket error', event);
      this._setDisconnected();
    };

    ws.onmessage = (event: MessageEvent) => {
      const msg = JSON.parse(event.data as string) as TracingServerMessage;
      for (const h of this._messageHandlers) h(msg);
    };

    return ws;
  }

  private _setDisconnected(): void {
    if (!this._connected) return;
    this._connected = false;
    for (const h of this._connectionHandlers) h(false);
  }

  private _scheduleReconnect(): void {
    if (this._reconnectTimer !== null) return;
    const delay = reconnectDelayMs(this._reconnectAttempt, this._reconnectBaseMs, this._reconnectMaxMs);
    this._reconnectAttempt++;
    console.warn(`[tracing] WebSocket closed — reconnecting in ${delay}ms (attempt ${this._reconnectAttempt})`);
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null;
      if (this._disposed) return;
      this._ws = this._open();
    }, delay);
  }
}
