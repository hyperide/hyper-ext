import { type NavStrategy } from '@shared/components/preview-chrome';
import type { SourceLocation } from '@shared/element-tracing/types';
import { useRef } from 'react';
import { useComponentMeta } from '@/contexts/ComponentMetaContext';
import { useElementTracer } from '@/hooks/useElementTracer';
import { useTracerSelectionSync } from '@/hooks/useTracerSelectionSync';
import { useCanvasEngine } from '@/lib/canvas-engine';
import type { RuntimeError } from '../../shared/runtime-error';
import type { CanvasMode } from '../../shared/types/canvas';
import {
  useIframeCanvas,
  useIframeEventHandlers,
  useIframeRuntimeErrors,
  useIframeStyles,
} from './iframe-canvas-hooks';
import { useReadableSurface } from './iframe-canvas-hooks/useReadableSurface';
import { ReadableSurfaceBadge } from './ReadableSurfaceBadge';

interface IframeCanvasProps {
  componentPath: string;
  iframeLoadedCounter?: number;
  boardModeActive?: boolean;
  activeInstanceId?: string | null;
  instanceSizes?: Record<string, { width?: number; height?: number }>;
  editorMode?: 'design' | 'interact' | 'code';
  isAddingComment?: boolean;
  onElementClick?: (
    nodeRef: string | null,
    element: HTMLElement,
    event: MouseEvent,
    itemIndex: number,
    source: SourceLocation,
  ) => void;
  onElementHover?: (
    nodeRef: string | null,
    element: HTMLElement | null,
    itemIndex: number | null,
    source: SourceLocation | null,
  ) => void;
  onLoadingChange?: (loading: boolean) => void;
  onCanvasModeChange?: (mode: CanvasMode) => void;
  onEmptyClick?: () => void;
  onOtherInstanceClick?: (instanceId: string) => void;
  onAddComment?: (position: { x: number; y: number }, elementId: string | null, instanceId: string | null) => void;
  serverOffline?: boolean;
  onGatewayError?: (hasError: boolean, errorMessage?: string) => void;
  onRuntimeError?: (error: RuntimeError | null) => void;
  onErrorChange?: (error: string | null, retryCount: number) => void;
  overrideSrc?: string;
  /** When true, preview the component AS AN APP — adds `app=1` to the iframe src so the
   *  generated preview renders the entry root raw (its own router/providers run). */
  appMode?: boolean;
  /** In-preview navigation strategy. Emitted as `nav=<strategy>` so the generated app-route driver
   *  knows how to reach the app router under the proxy prefix. Only used in app-mode. */
  navStrategy?: NavStrategy;
  /** Initial in-app route the app should boot at (app-mode only). Carried as `route=<path>`; the
   *  generated boot driver reads it. Used by the src-swap strategy (which reloads the iframe to
   *  navigate) and as the initial address for the others. */
  appRoute?: string;
}

export default function IframeCanvas({
  componentPath,
  boardModeActive,
  activeInstanceId,
  instanceSizes,
  iframeLoadedCounter,
  editorMode,
  isAddingComment,
  onElementClick,
  onElementHover,
  onLoadingChange,
  onCanvasModeChange,
  onEmptyClick,
  onOtherInstanceClick,
  onAddComment,
  serverOffline,
  onGatewayError,
  onRuntimeError,
  onErrorChange,
  overrideSrc,
  appMode,
  navStrategy,
  appRoute,
}: IframeCanvasProps) {
  const { meta } = useComponentMeta();
  const engine = useCanvasEngine();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const { tracer, clickRetryQueue } = useElementTracer({
    iframe: iframeRef.current,
    projectId: meta?.projectId ?? '',
    enabled: meta?.projectId != null,
    loadCounter: iframeLoadedCounter,
    componentPath,
  });

  const { setPendingSelection } = useTracerSelectionSync({ tracer, engine, clickRetryQueue });

  const { previewReady, canvasMode, iframeSize } = useIframeCanvas({
    projectId: meta?.projectId,
    componentPath,
    onCanvasModeChange,
    onErrorChange,
    onGatewayError,
    onLoadingChange,
    serverOffline,
    overrideSrc,
    iframeLoadedCounter,
    iframeRef,
  });

  useIframeEventHandlers({
    iframeRef,
    engine,
    tracer,
    clickRetryQueue,
    setPendingSelection,
    canvasMode,
    activeInstanceId,
    boardModeActive,
    isAddingComment,
    overrideSrc,
    onElementClick,
    onElementHover,
    onEmptyClick,
    onOtherInstanceClick,
    onAddComment,
    iframeLoadedCounter,
    instanceSizes,
    editorMode,
  });

  useIframeStyles({
    iframeRef,
    previewReady,
    editorMode,
    boardModeActive,
    canvasMode,
    overrideSrc,
    iframeLoadedCounter,
  });

  useIframeRuntimeErrors({
    iframeRef,
    onRuntimeError,
    iframeLoadedCounter,
    overrideSrc,
  });

  // Readability aid (HYP-1002): flip the canvas surface behind the transparent iframe when a
  // no-own-background component paints clearly-unreadable text. Disabled in app-mode (the app
  // supplies its own surface). Works for the standard preview AND NodePod/override previews — a
  // cross-origin override whose DOM can't be read is handled as "no samples" (safe no-op).
  const readableSurface = useReadableSurface({
    iframeRef,
    wrapperRef,
    previewReady,
    componentPath,
    iframeLoadedCounter,
    enabled: !appMode,
  });

  if (!meta?.projectId) {
    return (
      <div className="relative w-full h-full bg-white dark:bg-slate-950">
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100 dark:bg-slate-900">
          <div className="text-center">
            <p className="text-destructive mb-2">No active project</p>
            <p className="text-sm text-muted-foreground">Please select a project first</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={wrapperRef}
      data-testid="IframeCanvas"
      className="relative"
      style={{
        overflow: 'visible',
        // Readability aid (HYP-1002) paints this variable behind the transparent iframe; when
        // unset the canvas surface below shows through unchanged.
        background: 'var(--hc-canvas-surface, transparent)',
        pointerEvents: boardModeActive ? 'none' : 'auto',
        width: canvasMode === 'multi' ? 'fit-content' : '100%',
        height: canvasMode === 'multi' ? 'fit-content' : '100%',
      }}
    >
      {readableSurface.surfaceId && !boardModeActive && (
        <ReadableSurfaceBadge
          minContrast={readableSurface.minContrastBefore}
          onDismiss={readableSurface.onDismiss}
        />
      )}
      <iframe
        id="preview-iframe"
        ref={iframeRef}
        src={
          previewReady
            ? (() => {
                if (overrideSrc) return overrideSrc;
                const baseUrl = `/project-preview/${meta.projectId}/test-preview`;
                const params = new URLSearchParams();
                params.set('component', componentPath);
                if (canvasMode === 'multi') {
                  params.set('mode', 'multi');
                }
                // App-mode: the generated preview reads `app=1` and renders the entry root raw
                // (its own router/providers run); the address bar then drives that router. `nav`
                // selects the in-preview navigation strategy.
                if (appMode) {
                  params.set('app', '1');
                  if (navStrategy) params.set('nav', navStrategy);
                  // `route` belongs in the SRC only for src-swap, whose navigation IS a reload at
                  // the new route — so the declarative src must track currentRoute (otherwise a
                  // re-render would revert the imperative iframe.src set). history-bridge/basename
                  // navigate WITHOUT reloading (postMessage), so putting a changing `route` in the
                  // src would force a full reload on every navigation and defeat the whole point.
                  if (navStrategy === 'src-swap' && appRoute && appRoute !== '/') {
                    params.set('route', appRoute);
                  }
                }
                return `${baseUrl}?${params.toString()}`;
              })()
            : 'about:blank'
        }
        sandbox="allow-scripts allow-same-origin allow-forms allow-modals allow-popups"
        // @ts-expect-error allowtransparency is non-standard but needed for transparent background
        allowtransparency="true"
        className={iframeSize ? 'border-0' : 'w-full h-full border-0'}
        style={{
          width: iframeSize?.width,
          height: iframeSize?.height,
          overflow: 'visible',
          pointerEvents: boardModeActive ? 'none' : 'auto',
          background: 'transparent',
          colorScheme: 'normal',
        }}
        title="Component Preview"
      />
    </div>
  );
}
