import { useEffect } from 'react';
import { injectDesignStyles } from '@shared/canvas-interaction/style-injector';
import { IFRAME_CONSOLE_CAPTURE_SCRIPT } from '@shared/scripts/iframe-console-capture-content';
import type { CanvasMode } from '../../../shared/types/canvas';

interface UseIframeStylesParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  previewReady: boolean;
  editorMode?: 'design' | 'interact' | 'code';
  boardModeActive?: boolean;
  canvasMode: CanvasMode;
  overrideSrc?: string;
  iframeLoadedCounter?: number;
}

export function useIframeStyles({
  iframeRef,
  previewReady,
  editorMode,
  boardModeActive,
  canvasMode,
  overrideSrc,
  iframeLoadedCounter,
}: UseIframeStylesParams) {
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !previewReady) return;
    try {
      const doc = iframe.contentDocument;
      if (!doc) {
        console.error('Cannot access iframe content');
        return;
      }
      injectDesignStyles(doc, {
        mode: editorMode === 'interact' ? 'interact' : 'design',
        boardModeActive,
        canvasMode,
        transparentBackground: true,
      });
    } catch (err) {
      console.error('Failed to access iframe content:', err);
    }
  }, [previewReady, boardModeActive, editorMode, canvasMode, iframeRef]);

  useEffect(() => {
    if (!overrideSrc || !previewReady) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    const tryInject = () => {
      const doc = iframe.contentDocument;
      if (!doc || !doc.head) return;
      if (doc.location.href === 'about:blank') return;
      if (doc.querySelector('script[data-hyperide-console-capture]')) return;
      const script = doc.createElement('script');
      script.textContent = IFRAME_CONSOLE_CAPTURE_SCRIPT;
      script.setAttribute('data-hyperide-console-capture', '1');
      doc.head.appendChild(script);
    };

    tryInject();
    iframe.addEventListener('load', tryInject);
    return () => iframe.removeEventListener('load', tryInject);
  }, [overrideSrc, previewReady, iframeLoadedCounter, iframeRef]);
}
