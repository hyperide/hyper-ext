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

interface UsePreviewBridgeOptions {
  iframeEl: HTMLIFrameElement | null;
  canvas: CanvasAdapter;
  /** Forward state patches to canvas interaction (overlay rendering in iframe) */
  onStateUpdate: (patch: Record<string, unknown>) => void;
}

interface UsePreviewBridgeResult {
  devServerRunning: boolean;
  previewUrl: string | null;
  showNoComponentHint: boolean;
  handleStartDevServer: () => void;
  handleRefresh: () => void;
}

export function usePreviewBridge({ iframeEl, canvas, onStateUpdate }: UsePreviewBridgeOptions): UsePreviewBridgeResult {
  const [devServerRunning, setDevServerRunning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [showNoComponentHint, setShowNoComponentHint] = useState(false);

  // Keep onStateUpdate stable via ref to avoid re-subscribing
  const onStateUpdateRef = useRef(onStateUpdate);
  onStateUpdateRef.current = onStateUpdate;

  // === iframe -> extension message forwarding ===
  useEffect(() => {
    if (!iframeEl) return;

    function handleMessage(event: MessageEvent) {
      if (event.source !== iframeEl?.contentWindow) return;

      const msg = event.data;
      if (!msg?.type) return;

      // hypercanvas:* messages are handled by useCanvasInteraction,
      // except runtimeError and elementContentResult which need to go to extension
      // hypercanvas:* → PlatformMessage bridge: iframe protocol messages are adapted
      // to platform messages via type casts (these types are extension-only, not in the union)
      if (msg.type.startsWith('hypercanvas:')) {
        if (msg.type === 'hypercanvas:runtimeError') {
          canvas.sendEvent({ type: 'runtime:error', error: msg.error } as unknown as PlatformMessage);
        }
        if (msg.type === 'hypercanvas:console') {
          canvas.sendEvent({ type: 'diagnostic:console', entries: msg.entries } as unknown as PlatformMessage);
        }
        if (msg.type === 'hypercanvas:elementContentResult') {
          canvas.sendEvent({
            type: 'elementContentResult',
            requestId: msg.requestId,
            text: msg.text,
            html: msg.html,
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
        canvas.sendEvent({ type: 'previewLoaded' } as unknown as PlatformMessage);
        return;
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe
    return () => window.removeEventListener('message', handleMessage);
  }, [canvas, iframeEl]);

  // Keep iframeEl in a ref so doRefresh callback stays stable
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
  useEffect(() => {
    function handleMessage(event: MessageEvent) {
      const msg = event.data;
      if (!msg?.type) return;

      // Ignore messages from iframe (handled above)
      if (iframeEl && event.source === iframeEl.contentWindow) return;

      switch (msg.type) {
        case 'devserver:statusChanged':
          setDevServerRunning(msg.running);
          break;

        case 'updateUrl':
          setShowNoComponentHint(false);
          setPreviewUrl(msg.url);
          break;

        case 'showNoComponentHint':
          setShowNoComponentHint(true);
          break;

        case 'refresh':
          doRefresh();
          break;

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
      }
    }

    window.addEventListener('message', handleMessage); // nosemgrep: insufficient-postmessage-origin-validation -- VS Code webview, checks event.source against iframe
    return () => window.removeEventListener('message', handleMessage);
  }, [iframeEl, doRefresh]);

  // === Signal webview ready to extension ===
  // 'webview:ready' is an internal extension event, not a PlatformMessage —
  // no type cast needed (unlike platform-bridged commands below)
  useEffect(() => {
    canvas.sendEvent({ type: 'webview:ready' });
  }, [canvas]);

  const handleStartDevServer = useCallback(() => {
    canvas.sendEvent({ type: 'command:startDevServer' } as unknown as PlatformMessage);
  }, [canvas]);

  return {
    devServerRunning,
    previewUrl,
    showNoComponentHint,
    handleStartDevServer,
    handleRefresh: doRefresh,
  };
}
