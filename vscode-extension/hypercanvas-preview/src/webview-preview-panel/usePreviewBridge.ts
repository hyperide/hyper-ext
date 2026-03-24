/**
 * Preview Bridge hook — handles message routing between iframe, webview, and extension.
 *
 * Replaces the inline JS from PreviewPanel._getHtmlForWebview():
 * - iframe -> extension: forwards runtime errors, platform messages, previewLoaded
 * - extension -> webview: handles devserver status, URL updates, UI state
 * - extension -> iframe: forwards state:update, state:init, ast:response, editor:activeFileChanged
 * - extension -> canvas interaction: forwards state patches for overlay rendering
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasAdapter, PlatformMessage } from '@/lib/platform/types';
import type { UnsupportedProjectError } from '../types';

interface UsePreviewBridgeOptions {
  iframeEl: HTMLIFrameElement | null;
  canvas: CanvasAdapter;
  /** Forward state patches to canvas interaction (overlay rendering in iframe) */
  onStateUpdate: (patch: Record<string, unknown>) => void;
}

interface UsePreviewBridgeResult {
  devServerRunning: boolean;
  devServerUrl: string | null;
  /** True when server was running but disconnected (show reconnecting banner) */
  disconnected: boolean;
  previewUrl: string | null;
  showNoComponentHint: boolean;
  /** Set when extension detects an unsupported project type (e.g. React Native / Tamagui) */
  projectError: UnsupportedProjectError | null;
  handleStartDevServer: () => void;
  handleRefresh: () => void;
}

export function usePreviewBridge({ iframeEl, canvas, onStateUpdate }: UsePreviewBridgeOptions): UsePreviewBridgeResult {
  const [devServerRunning, setDevServerRunning] = useState(false);
  const [devServerUrl, setDevServerUrl] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showNoComponentHint, setShowNoComponentHint] = useState(false);
  const [projectError, setProjectError] = useState<UnsupportedProjectError | null>(null);
  // Track whether we were previously connected (for reconnecting banner)
  const wasConnectedRef = useRef(false);
  const [disconnected, setDisconnected] = useState(false);

  // Keep onStateUpdate stable via ref to avoid re-subscribing
  const onStateUpdateRef = useRef(onStateUpdate);
  onStateUpdateRef.current = onStateUpdate;

  // === iframe -> extension message forwarding ===
  // Origin validation: event.source check ensures only messages from our iframe are processed.
  // In VS Code webviews, origin strings are opaque (vscode-webview://<session-id>) so
  // source-based validation is the correct approach, not origin string comparison.
  useEffect(() => {
    if (!iframeEl) return;

    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeEl?.contentWindow) return;

      const msg = event.data;
      // Guard: only process well-formed messages. Property-level validation is not needed —
      // messages originate from our own iframe bundle (controlled code, not external input).
      if (!msg?.type) return;

      // Iframe → extension bridge: hypercanvas:* messages are adapted to PlatformMessage channel.
      // These event types (runtime:error, diagnostic:console, elementContentResult, previewLoaded)
      // are extension-only and intentionally NOT in the PlatformMessage union — adding them
      // would pollute the shared type used by all platform consumers (browser, CLI, etc.).
      // The 'as unknown as PlatformMessage' casts are the deliberate bridging pattern here.
      if (msg.type.startsWith('hypercanvas:')) {
        if (msg.type === 'hypercanvas:runtimeError') {
          canvas.sendEvent({ type: 'runtime:error', error: msg.error } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:console') {
          canvas.sendEvent({ type: 'diagnostic:console', entries: msg.entries } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:elementContentResult') {
          canvas.sendEvent({
            type: 'elementContentResult',
            requestId: msg.requestId,
            text: msg.text,
            html: msg.html,
          } as unknown as PlatformMessage);
        } else if (msg.type === 'hypercanvas:screenshotResult') {
          canvas.sendEvent({
            type: 'screenshotResult',
            requestId: msg.requestId,
            dataUrl: msg.dataUrl,
          } as unknown as PlatformMessage);
        }
        return;
      }

      // Platform messages -> forward to extension
      if (
        msg.type.startsWith('editor:') ||
        msg.type.startsWith('ast:') ||
        msg.type.startsWith('ai:') ||
        msg.type.startsWith('state:')
      ) {
        canvas.sendEvent(msg as PlatformMessage);
        return;
      }

      if (msg.type === 'previewLoaded') {
        // Same bridging pattern as hypercanvas:* above — extension-only event type
        canvas.sendEvent({ type: 'previewLoaded' } as unknown as PlatformMessage);
        return;
      }

      if (msg.type === 'chrome-detected') {
        canvas.sendEvent({ type: 'chrome-detected' } as unknown as PlatformMessage);
        return;
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe
    return () => window.removeEventListener('message', handleMessage);
  }, [canvas, iframeEl]);

  // Keep iframeEl in a ref so doRefresh callback stays stable.
  // Direct assignment during render is intentional — this is the standard React pattern
  // for syncing refs with props. Wrapping in useEffect would create a stale-ref window
  // between render and effect execution, which is worse than synchronous assignment.
  const iframeElRef = useRef(iframeEl);
  iframeElRef.current = iframeEl;

  // === Refresh logic ===
  const doRefresh = useCallback(() => {
    const frame = iframeElRef.current;
    if (!frame) return;
    const currentSrc = frame.src;
    frame.src = '';
    setTimeout(() => {
      frame.src = currentSrc;
    }, 50);
  }, []);

  // === extension -> webview message handling ===
  // NOTE: This is a separate message listener from the iframe handler above — intentionally.
  // Each effect has its own dependency array and lifecycle. Merging them would widen
  // the dependency surface, causing unnecessary re-subscriptions. There is no race
  // condition: the two handlers process disjoint message type domains (hypercanvas:*
  // vs extension commands), and postMessage ordering within each domain is preserved.
  //
  // SECURITY NOTE: All postMessage calls below use '*' as targetOrigin intentionally.
  // In VS Code webviews, the iframe origin is opaque (vscode-webview://<session-id>)
  // and changes every session — specifying a concrete origin is not possible.
  // Messages are scoped to the iframe's contentWindow, which is same-origin within
  // the webview, so '*' does not widen the attack surface.
  //
  // ORIGIN VALIDATION: Messages here come from the VS Code extension host via the
  // webview API (acquireVsCodeApi().postMessage). The extension host is a trusted
  // origin — there is no untrusted sender to validate against. Iframe messages
  // are filtered out by the event.source check below.
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (!msg?.type) return;

      // Ignore messages from iframe (handled above)
      if (iframeEl && event.source === iframeEl.contentWindow) return;

      switch (msg.type) {
        case 'devserver:statusChanged':
          if (!msg.running && wasConnectedRef.current) {
            setDisconnected(true);
          }
          if (msg.running) {
            setDisconnected(false);
            wasConnectedRef.current = true;
          }
          setDevServerRunning(msg.running);
          setDevServerUrl(msg.url ?? null);
          break;

        case 'updateUrl': {
          const url = typeof msg.url === 'string' ? msg.url : undefined;
          if (!url) break;
          setShowNoComponentHint(false);
          const frame = iframeElRef.current;
          if (frame?.src) {
            // Iframe already loaded — extract component param and send via postMessage
            // to avoid iframe navigation flash
            try {
              const component = new URL(url).searchParams.get('component');
              if (component) {
                frame.contentWindow?.postMessage({ type: 'hypercanvas:setComponent', component }, '*'); // nosemgrep: wildcard-postmessage-configuration
                break;
              }
            } catch {
              /* invalid URL — fall through to full navigation */
            }
            frame.src = url;
          } else {
            setPreviewUrl(url);
          }
          break;
        }

        case 'showNoComponentHint':
          setShowNoComponentHint(true);
          break;

        case 'refresh':
          doRefresh();
          break;

        case 'setComponent': {
          const frame = iframeElRef.current;
          if (frame?.contentWindow) {
            // Send via postMessage — no iframe reload
            frame.contentWindow.postMessage({ type: 'hypercanvas:setComponent', component: msg.component }, '*'); // nosemgrep: wildcard-postmessage-configuration
          }
          break;
        }

        case 'goToVisual':
          // Update overlay state (selection highlighting)
          onStateUpdateRef.current({
            selectedIds: [msg.elementId],
            selectedItemIndices: {},
          });
          // Forward to iframe (state sync + scroll to element)
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe, same-origin VS Code context
          iframeEl?.contentWindow?.postMessage({ type: 'hypercanvas:goToVisual', elementId: msg.elementId }, '*');
          break;

        case 'state:update':
          // Forward to canvas interaction (overlay rendering)
          if (msg.patch) {
            onStateUpdateRef.current(msg.patch);
          }
          // Forward to iframe (platform state sync)
          iframeEl?.contentWindow?.postMessage(msg, '*'); // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          break;

        case 'state:init':
          // Forward to canvas interaction (full state)
          if (msg.state) {
            onStateUpdateRef.current(msg.state);
          }
          // Forward to iframe
          iframeEl?.contentWindow?.postMessage(msg, '*'); // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          break;

        case 'ast:response':
        case 'editor:activeFileChanged':
          // Forward to iframe
          iframeEl?.contentWindow?.postMessage(msg, '*'); // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          break;

        // Extension requests element content from iframe (Copy Text / Copy as HTML)
        case 'getElementText':
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:getElementText', elementId: msg.elementId, requestId: msg.requestId },
            '*',
          );
          break;

        case 'getElementHTML':
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:getElementHTML', elementId: msg.elementId, requestId: msg.requestId },
            '*',
          );
          break;

        case 'takeScreenshot':
          // nosemgrep: wildcard-postmessage-configuration -- webview->iframe forwarding
          iframeEl?.contentWindow?.postMessage(
            { type: 'hypercanvas:takeScreenshot', elementId: msg.elementId, requestId: msg.requestId },
            '*',
          );
          break;

        case 'projectError':
          // Extension detected an unsupported project type (e.g. React Native / Tamagui)
          setProjectError((msg.error as UnsupportedProjectError) ?? null);
          break;
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeEl, doRefresh]);

  // === Signal webview ready to extension ===
  // 'webview:ready' is an internal extension event, not a PlatformMessage —
  // no type cast needed (unlike platform-bridged commands below).
  // canvas is a stable CanvasAdapter singleton — this effect fires exactly once on mount.
  // [canvas] is kept in deps for React exhaustive-deps lint compliance (biome enforces it);
  // using [] would trigger a lint error. Since canvas never changes, the behavior is identical.
  useEffect(() => {
    canvas.sendEvent({ type: 'webview:ready' });
  }, [canvas]);

  // Extension-only command — same bridging pattern, not a PlatformMessage type
  const handleStartDevServer = useCallback(() => {
    canvas.sendEvent({ type: 'command:startDevServer' } as unknown as PlatformMessage);
  }, [canvas]);

  return {
    devServerRunning,
    devServerUrl,
    disconnected,
    previewUrl,
    showNoComponentHint,
    projectError,
    handleStartDevServer,
    handleRefresh: doRefresh,
  };
}
