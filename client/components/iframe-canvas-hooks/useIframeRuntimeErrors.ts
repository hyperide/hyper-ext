import { useEffect, useRef } from 'react';
import type { RuntimeError } from '../../../shared/runtime-error';

interface UseIframeRuntimeErrorsParams {
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  onRuntimeError?: (error: RuntimeError | null) => void;
  iframeLoadedCounter?: number;
  overrideSrc?: string;
}

export function useIframeRuntimeErrors({
  iframeRef,
  onRuntimeError,
  iframeLoadedCounter,
  overrideSrc,
}: UseIframeRuntimeErrorsParams) {
  const errorSourceRef = useRef<'overlay' | 'postMessage' | null>(null);
  const postMessageTimeRef = useRef(0);

  const isIgnorableRuntimeError = (message: string) =>
    message.includes('ResizeObserver loop completed with undelivered notifications') ||
    message.includes('ResizeObserver loop limit exceeded');

  useEffect(() => {
    if (!onRuntimeError) return;
    const effectStartTime = Date.now();
    postMessageTimeRef.current = 0;

    const checkForRuntimeError = (): RuntimeError | null => {
      const iframe = iframeRef.current;
      const doc = iframe?.contentDocument;
      if (!doc) return null;

      const nextjsPortal = doc.querySelector('nextjs-portal');
      const nextjsShadow = nextjsPortal?.shadowRoot;
      const nextjsOverlay = nextjsShadow?.querySelector('[data-nextjs-dialog-overlay]');
      if (nextjsOverlay && nextjsShadow) {
        const errorLabel = nextjsShadow.querySelector('#nextjs__container_errors_label');
        const errorType = errorLabel?.textContent?.trim() || 'Error';
        const errorDesc = nextjsShadow.querySelector('#nextjs__container_errors_desc');
        const errorMessage = errorDesc?.textContent?.trim() || 'Unknown error';
        const codeframeLink = nextjsShadow.querySelector('[data-nextjs-codeframe] [data-text]');
        const fileLine = codeframeLink?.textContent?.trim() || '';
        const codeframePre = nextjsShadow.querySelector('[data-nextjs-codeframe] pre');
        const codeframe = codeframePre?.textContent?.trim().slice(0, 500) || '';
        const fileMatch = fileLine.match(/^(.+?)\s*\((\d+)/);
        const file = fileMatch?.[1] || fileLine || undefined;
        const line = fileMatch?.[2] ? Number.parseInt(fileMatch[2], 10) : undefined;
        const fullText = `${errorType}: ${errorMessage}\n\nFile: ${fileLine}\n\n${codeframe}`;
        return {
          framework: 'nextjs',
          type: errorType,
          message: errorMessage,
          file,
          line,
          codeframe: codeframe || undefined,
          fullText,
        };
      }

      const viteOverlay = doc.querySelector('vite-error-overlay');
      if (viteOverlay?.shadowRoot) {
        const shadowRoot = viteOverlay.shadowRoot;
        const messageEl = shadowRoot.querySelector('.message-body');
        const errorMessage = messageEl?.textContent?.trim() || 'Unknown error';
        if (isIgnorableRuntimeError(errorMessage)) return null;
        const fileEl = shadowRoot.querySelector('.file');
        const file = fileEl?.textContent?.trim() || undefined;
        const frameEl = shadowRoot.querySelector('.frame');
        const codeframe = frameEl?.textContent?.trim().slice(0, 500) || undefined;
        const fullText = `Vite Error: ${errorMessage}\n\nFile: ${file || 'unknown'}\n\n${codeframe || ''}`;
        return { framework: 'vite', type: 'Build Error', message: errorMessage, file, codeframe, fullText };
      }

      const bunHmr = doc.querySelector('bun-hmr');
      if (bunHmr?.shadowRoot) {
        const shadowRoot = bunHmr.shadowRoot;
        const errorContent = shadowRoot.querySelector('.error-content');
        if (errorContent) {
          const messageDesc = errorContent.querySelector('.message-desc');
          let errorType = 'Error';
          let errorMessage = 'Unknown error';
          if (messageDesc) {
            const nameEl = messageDesc.querySelector('code.name');
            if (nameEl?.textContent) errorType = nameEl.textContent;
            const codeElements = messageDesc.querySelectorAll('code');
            for (const code of codeElements) {
              if (!code.classList.contains('name') && !code.classList.contains('muted') && code.textContent) {
                errorMessage = code.textContent;
              }
            }
          }
          const stackTrace = errorContent.querySelector('.r-error-trace');
          const codeframe = stackTrace?.textContent?.trim().slice(0, 500) || undefined;
          const fullText = `${errorType}: ${errorMessage}\n\n${codeframe || ''}`;
          return { framework: 'bun', type: errorType, message: errorMessage, codeframe, fullText };
        }
      }

      if (!overrideSrc && Date.now() - effectStartTime > 2000) {
        const root = doc.getElementById('root') || doc.getElementById('__next') || doc.getElementById('app');
        if (root && root.children.length === 0) {
          return {
            framework: 'vite',
            type: 'Module Error',
            message: 'Component failed to render. Check browser console for import errors.',
            fullText: 'The component module loaded but React never mounted. This usually means a module import error.',
          };
        }
      }

      return null;
    };

    const handleRuntimeMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (event.data?.type !== 'hypercanvas:runtimeError') return;
      const error = event.data.error as RuntimeError;
      if (error && !isIgnorableRuntimeError(error.message)) {
        errorSourceRef.current = 'postMessage';
        postMessageTimeRef.current = Date.now();
        onRuntimeError(error);
      }
    };
    window.addEventListener('message', handleRuntimeMessage);

    const timeoutId = setTimeout(() => {
      const initialError = checkForRuntimeError();
      if (initialError) {
        if (errorSourceRef.current !== 'postMessage') {
          errorSourceRef.current = 'overlay';
          onRuntimeError(initialError);
        }
      } else if (errorSourceRef.current === 'postMessage' && effectStartTime - postMessageTimeRef.current < 2000) {
        // keep postMessage error
      } else {
        errorSourceRef.current = null;
        onRuntimeError(null);
      }
    }, 500);

    const intervalId = setInterval(() => {
      const error = checkForRuntimeError();
      if (error) {
        if (errorSourceRef.current !== 'postMessage') {
          errorSourceRef.current = 'overlay';
          onRuntimeError(error);
        }
      } else if (errorSourceRef.current === 'overlay') {
        errorSourceRef.current = null;
        onRuntimeError(null);
      }
    }, 2000);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(intervalId);
      window.removeEventListener('message', handleRuntimeMessage);
    };
  }, [onRuntimeError, iframeLoadedCounter, overrideSrc, iframeRef]);
}
