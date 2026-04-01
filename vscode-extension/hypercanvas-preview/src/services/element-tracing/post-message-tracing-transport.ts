/**
 * @file PostMessage-based TracingTransport for VS Code extension
 *
 * Accessed via: Extension iframe interaction layer
 * Assumptions: Messages flow through VS Code webview postMessage.
 * StateHub broadcasts to all panels — selection state reaches preview, left panel, right panel.
 */

import type { TracingClientMessage, TracingServerMessage, TracingTransport } from '@shared/element-tracing/types';

type MessageHandler = (msg: TracingServerMessage) => void;
type ConnectionHandler = (connected: boolean) => void;

const TRACING_PREFIX = 'element-tracing:';

/**
 * PostMessage transport for iframe ↔ extension host communication.
 *
 * In iframe context: sends to window.parent via postMessage, receives via message event.
 * In extension host context: receives from webview onDidReceiveMessage, sends via webview.postMessage.
 */
export class PostMessageTracingTransport implements TracingTransport {
  private _messageHandlers = new Set<MessageHandler>();
  private _connectionHandlers = new Set<ConnectionHandler>();
  private _connected = true; // postMessage is always "connected" (no network)
  private _listener: ((event: MessageEvent) => void) | null = null;
  private _clientMessageHandlers = new Set<(msg: TracingClientMessage) => void>();

  constructor(private readonly _mode: 'iframe' | 'host') {
    if (_mode === 'iframe' && typeof window !== 'undefined') {
      this._listener = (event: MessageEvent) => {
        const data = event.data;
        if (data && typeof data === 'object' && typeof data.type === 'string' && data.type.startsWith(TRACING_PREFIX)) {
          const innerType = data.type.slice(TRACING_PREFIX.length);
          const msg = { ...data.payload, type: innerType } as TracingServerMessage;
          for (const handler of this._messageHandlers) {
            handler(msg);
          }
        }
      };
      window.addEventListener('message', this._listener);
    }
  }

  get connected(): boolean {
    return this._connected;
  }

  send(msg: TracingClientMessage): void {
    if (this._mode === 'iframe' && typeof window !== 'undefined') {
      // nosemgrep: wildcard-postmessage-configuration -- VS Code webview requires '*' origin for iframe↔host communication
      window.parent.postMessage(
        {
          type: `${TRACING_PREFIX}${msg.type}`,
          payload: msg,
        },
        '*',
      );
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this._messageHandlers.add(handler);
    return () => this._messageHandlers.delete(handler);
  }

  onConnectionChange(handler: ConnectionHandler): () => void {
    this._connectionHandlers.add(handler);
    return () => this._connectionHandlers.delete(handler);
  }

  /**
   * For extension host: feed a message received from webview into the transport.
   * Called by PanelRouter when it receives element-tracing messages.
   */
  receiveFromWebview(msg: TracingClientMessage): void {
    for (const handler of this._clientMessageHandlers) {
      handler(msg);
    }
  }

  /** Extension host: subscribe to messages from client (iframe) */
  onClientMessage(handler: (msg: TracingClientMessage) => void): () => void {
    this._clientMessageHandlers.add(handler);
    return () => {
      this._clientMessageHandlers.delete(handler);
    };
  }

  /**
   * For extension host: send a server message to the iframe via webview.
   * Dispatches to message handlers (which are wired to webview.postMessage by the caller).
   */
  sendToClient(msg: TracingServerMessage): void {
    for (const handler of this._messageHandlers) {
      handler(msg);
    }
  }

  dispose(): void {
    if (this._listener && typeof window !== 'undefined') {
      window.removeEventListener('message', this._listener);
    }
    this._messageHandlers.clear();
    this._connectionHandlers.clear();
    this._clientMessageHandlers.clear();
  }
}
